'use strict';
// Audit: soak (many rooms), full match to completion + rematch, hostile input.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 3998;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails++; };
function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], snaps: 0, last: null, t0: 0, closed: false };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 's') { if (!c.t0) c.t0 = Date.now(); c.snaps++; c.last = m; } });
  ws.on('close', () => { c.closed = true; });
  c.send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(Object.assign({ name }, o)));
  c.has = (t) => c.msgs.find((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}
const cpu = () => { const u = process.cpuUsage(); return u; };

(async () => {
  await sleep(600);

  // ---- 1. Full real-time match vs bot (also checks rematch + stats), run alongside the soak test
  const hero = client('Hero'); await hero.open; hero.send({ t: 'bot' });
  let pushState = 0; const pump = setInterval(() => { pushState ^= 1; hero.send({ t: 'in', p: pushState }); }, 450);

  // ---- 2. Soak: 40 rooms (80 clients) matched via the queue, all mashing input
  const N = 80; const bots = [];
  for (let i = 0; i < N; i++) { const c = client('P' + i); bots.push(c); }
  await Promise.all(bots.map((c) => c.open));
  bots.forEach((c) => c.send({ t: 'quick' }));
  const mash = setInterval(() => bots.forEach((c) => c.send({ t: 'in', p: Math.random() < 0.5 ? 1 : 0 })), 120);
  await sleep(9000);
  const started = bots.filter((c) => c.has('start')).length;
  ok(started === N, `soak: all ${N} clients matched & started`, `(${started})`);
  const secs = (Date.now() - bots[0].t0) / 1000;
  const rates = bots.filter((c) => c.t0).map((c) => c.snaps / ((Date.now() - c.t0) / 1000));
  const minRate = Math.min(...rates), avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  ok(minRate > 26, 'soak: every client gets ~30 snapshots/s under load', `(min ${minRate.toFixed(1)}, avg ${avgRate.toFixed(1)})`);
  const stats = await (await fetch(`http://localhost:${PORT}/stats`)).json();
  ok(stats.rooms >= 41, 'soak: server tracks 41 rooms', JSON.stringify(stats));
  clearInterval(mash);
  bots.forEach((c) => c.ws.close());
  await sleep(500);

  // ---- 3. Hostile input
  const evil = client('Evil'); await evil.open;
  evil.ws.send('not json'); evil.ws.send('{}'); evil.ws.send('{"t":123}'); evil.ws.send('null'); evil.ws.send('[]');
  evil.send({ t: 'in', p: 1 }); evil.send({ t: 'rematch' }); evil.send({ t: 'resume', code: 'ZZZZ', tok: 'x' });
  evil.send({ t: 'join', code: { a: 1 } }); evil.send({ t: 'join', code: '<script>' });
  await sleep(300);
  ok(!evil.closed, 'hostile: malformed messages do not crash/close the connection');
  const big = client('Big'); await big.open; big.ws.send('x'.repeat(5000)); await sleep(300);
  ok(big.closed, 'hostile: oversize payload (5KB) is rejected by closing');
  const xss = client('<img src=x onerror=alert(1)>'); await xss.open; xss.send({ t: 'create' }); await sleep(200);
  const nm = xss.has('joined').names[0];
  ok(!/[<>"&]/.test(nm), 'hostile: name sanitized server-side', JSON.stringify(nm));
  const flood = client('Flood'); await flood.open; flood.send({ t: 'create' });
  for (let i = 0; i < 1000; i++) flood.send({ t: 'ping', ts: i });
  await sleep(500);
  ok(flood.msgs.filter((m) => m.t === 'pong').length <= 130, 'hostile: >120 msgs/s is rate limited', `(${flood.msgs.filter((m) => m.t === 'pong').length} pongs)`);
  const http = await fetch(`http://localhost:${PORT}/..%2f..%2fetc/passwd`); ok(http.status !== 200, 'hostile: encoded path traversal blocked', `(${http.status})`);
  const http2 = await fetch(`http://localhost:${PORT}/%00`); ok(http2.status >= 400, 'hostile: NUL byte path handled', `(${http2.status})`);

  // ---- 4. finish the full match
  const t0 = Date.now();
  while (!hero.has('end') && Date.now() - t0 < 120000) await sleep(1000);
  clearInterval(pump);
  const end = hero.has('end');
  ok(!!end, 'full match: reaches end (real time, vs bot)', end ? `reason=${end.reason} scores=${end.s.map((x) => x.score)}` : '');
  if (end) {
    ok(end.s.every((p) => ['score', 'pk', 'ko', 'deaths'].every((k) => Number.isInteger(p[k]))), 'full match: stats well-formed');
    ok(end.w === 0 || end.w === 1, 'full match: has a winner');
    const sawTimerEnd = hero.msgs.some((m) => m.t === 's' && m.ph === 'play' && m.tm <= 30 && m.tm > 0);
    ok(sawTimerEnd, 'full match: passed through shrink phase');
    hero.send({ t: 'rematch' }); await sleep(800);
    ok(hero.msgs.filter((m) => m.t === 'start').length === 2, 'rematch vs bot restarts instantly');
  }
  const mem = process.memoryUsage().rss / 1e6;
  console.log(`\n(test-process rss ${mem.toFixed(0)}MB)`);
  console.log(fails ? `${fails} FAILED` : 'AUDIT PASSED');
  srv.kill(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
