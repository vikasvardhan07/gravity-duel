'use strict';
// End-to-end check against a deployed URL:  node test/remote.js https://your-app.onrender.com
const WebSocket = require('ws');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: node test/remote.js <url>'); process.exit(2); }
const wsUrl = base.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')); if (!c) fails++; };
function client(name) {
  const ws = new WebSocket(wsUrl); const c = { ws, msgs: [], snaps: 0, rtt: [] };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 's') { c.snaps++; c.last = m; } if (m.t === 'pong') c.rtt.push(Date.now() - m.ts); });
  c.send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(Object.assign({ name }, o)));
  c.has = (t) => c.msgs.find((m) => m.t === t);
  c.open = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return c;
}
(async () => {
  let t = Date.now();
  const h = await fetch(base + '/healthz'); ok(h.status === 200, 'healthz 200', `(${Date.now() - t} ms)`);
  t = Date.now(); const idx = await fetch(base + '/'); const html = await idx.text();
  ok(idx.status === 200 && html.includes('<title>Gravity Duel</title>'), 'index served is OUR game', `(${Date.now() - t} ms)`);
  for (const f of ['style.css', 'game.js', 'cover.png', 'fonts/unbounded.woff2', 'fonts/martian-mono.woff2', 'fonts/instrument-sans.woff2']) {
    const r = await fetch(`${base}/${f}`); ok(r.status === 200, `asset ${f}`, `(${r.headers.get('content-type')}, ${r.headers.get('content-length') || '?'} B)`);
  }
  ok((await fetch(base + '/%00')).status === 400, 'NUL path returns 400 (crash fix is deployed)');
  // quick match + play over the public internet
  const a = client('Alice'), b = client('Bob'); await Promise.all([a.open, b.open]);
  ok(true, 'wss connect (TLS) for 2 clients');
  a.send({ t: 'quick' }); await sleep(200); b.send({ t: 'quick' }); await sleep(1500);
  ok(a.has('start') && b.has('start'), 'quick match pairs strangers');
  const ping = setInterval(() => { a.send({ t: 'ping', ts: Date.now() }); }, 400);
  a.send({ t: 'in', p: 1 }); await sleep(7000); clearInterval(ping);
  const rate = a.snaps / 7;
  ok(rate > 24, 'snapshot rate over the internet', `(${rate.toFixed(1)}/s, want ≈30)`);
  const rtt = a.rtt.sort((x, y) => x - y); const med = rtt[Math.floor(rtt.length / 2)] || -1, p95 = rtt[Math.floor(rtt.length * 0.95)] || -1;
  ok(med > 0 && med < 400, 'round-trip latency from this machine', `(median ${med} ms, p95 ${p95} ms)`);
  ok(a.last && a.last.ph === 'play', 'match is in play phase after countdown');
  // reconnect
  const j = a.has('joined'); a.ws.close(); await sleep(500);
  const a2 = client('Alice'); await a2.open; a2.send({ t: 'resume', code: j.code, tok: j.tok }); await sleep(1200);
  ok(a2.has('start') && a2.snaps > 5, 'reconnect/resume works through the proxy');
  b.send({ t: 'leave' }); await sleep(500);
  ok(a2.has('end') && a2.has('end').reason === 'forfeit', 'forfeit on leave');
  // private room
  const c = client('Cat'), d = client('Dan'); await Promise.all([c.open, d.open]);
  c.send({ t: 'create' }); await sleep(400); const code = c.has('wait').code; d.send({ t: 'join', code }); await sleep(800);
  ok(c.has('start') && d.has('start'), 'private room by code', `(${code})`);
  // bot
  const e = client('Eve'); await e.open; e.send({ t: 'bot' }); await sleep(6500);
  ok(e.last && e.last.ph === 'play', 'practice vs bot starts');
  console.log(fails ? `\n${fails} FAILED` : '\nREMOTE: ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
