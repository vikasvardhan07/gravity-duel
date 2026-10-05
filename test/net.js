'use strict';
// Integration test: boots the real server, drives it with real WebSocket clients.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 3999;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], snaps: 0, last: null };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 's') { c.snaps++; c.last = m; } });
  c.send = (o) => ws.send(JSON.stringify(Object.assign({ name }, o)));
  c.has = (t) => c.msgs.find((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

(async () => {
  await sleep(600);
  // 1. HTTP
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  ok(/<canvas/.test(html), 'GET / serves index.html');
  ok((await fetch(`http://localhost:${PORT}/healthz`)).status === 200, '/healthz ok');
  ok((await fetch(`http://localhost:${PORT}/../server.js`)).status !== 200, 'path traversal blocked');

  // 2. quick match pairs two clients
  const a = client('Alice'), b = client('Bob');
  await a.open; await b.open;
  a.send({ t: 'quick' }); await sleep(100); b.send({ t: 'quick' }); await sleep(600);
  ok(a.has('joined') && b.has('joined'), 'quick match joins both');
  ok(a.has('start') && b.has('start'), 'game starts for both');
  ok(a.has('joined').you !== b.has('joined').you, 'distinct player slots');
  ok(a.snaps > 5 && b.snaps > 5, 'both receive snapshots');
  ok(a.last.ph === 'count', 'countdown phase first');
  for (let i = 0; i < 80 && a.last.ph !== 'play'; i++) await sleep(100);
  a.send({ t: 'in', p: 1 }); b.send({ t: 'in', p: 1 });
  ok(a.last.ph === 'play', 'moves to play after countdown');
  a.send({ t: 'in', p: 1 }); b.send({ t: 'in', p: 0 }); await sleep(80);
  const ia = a.has('joined').you;
  const x0 = a.last.p[ia][0], y0 = a.last.p[ia][1];
  await sleep(250);
  ok(Math.hypot(a.last.p[ia][0] - x0, a.last.p[ia][1] - y0) > 20, 'orb moves in play');
  ok(a.last.tm < 90, 'match timer ticking');

  // 3. reconnect: drop Alice, resume with token
  const tok = a.has('joined').tok, code = a.has('joined').code;
  a.ws.close(); await sleep(300);
  ok(b.msgs.some((m) => m.t === 'opp' && m.away), 'opponent told of disconnect');
  const a2 = client('Alice'); await a2.open;
  a2.send({ t: 'resume', code, tok }); await sleep(500);
  ok(a2.has('joined') && a2.has('start'), 'resume restores seat');
  ok(a2.snaps > 3, 'resumed client gets snapshots');
  ok(b.msgs.some((m) => m.t === 'opp' && m.back), 'opponent told of return');

  // 4. forfeit on explicit leave
  b.send({ t: 'leave' }); await sleep(400);
  ok(a2.has('end') && a2.has('end').reason === 'forfeit' && a2.has('end').w === a2.has('joined').you, 'leaver forfeits, opponent wins');

  // 5. private room + code join + bad code
  const c = client('Cat'), d = client('Dan'), e = client('Eve');
  await c.open; await d.open; await e.open;
  c.send({ t: 'create' }); await sleep(200);
  const rc = c.has('wait').code;
  ok(/^[A-Z]{4}$/.test(rc), 'room code is 4 letters');
  d.send({ t: 'join', code: rc.toLowerCase() }); await sleep(300);
  ok(c.has('start') && d.has('start'), 'join by code (case-insensitive) starts game');
  e.send({ t: 'join', code: rc }); await sleep(200);
  ok(e.has('err'), 'third player rejected');
  e.send({ t: 'join', code: 'ZZZZ' }); await sleep(200);
  ok(e.msgs.filter((m) => m.t === 'err').length === 2, 'unknown code rejected');

  // 6. bot room runs to completion with rematch
  const f = client('Fay'); await f.open;
  f.send({ t: 'bot' }); await sleep(5000);
  ok(f.has('start') && f.last && f.last.ph === 'play', 'bot room auto-starts');
  const bp = f.last.p[1];
  await sleep(2000);
  ok(f.last.p[1][0] !== bp[0] || f.last.p[1][1] !== bp[1], 'bot orb moves');
  f.send({ t: 'leave' });
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  srv.kill(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
