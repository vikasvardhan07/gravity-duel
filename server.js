'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game, botDecide } = require('./game');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TICK = 1 / 60;
const RECONNECT_MS = 15000;
const MAX_ROOMS = 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---- static files -----------------------------------------------------------------------------
const bad = (res, code = 400) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(code === 404 ? 'Not found' : 'Bad request'); };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ rooms: rooms.size, online: wss.clients.size, queue: queue.length }));
    }
    const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); // throws on bad %-escapes
    if (rel.includes('\0')) return bad(res);
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep) && file !== PUB) return bad(res, 403);
    fs.readFile(file, (err, buf) => {
      if (err) return bad(res, 404);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  } catch { bad(res); }
});
// Last line of defence: a bug in one request/room must never take the whole game down.
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));

// ---- rooms ------------------------------------------------------------------------------------
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const rooms = new Map();
let queue = [];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 14) || 'Player';
const token = () => Math.random().toString(36).slice(2, 10);

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}

function makeRoom(bot) {
  const room = {
    code: newCode(), bot: !!bot, ws: [null, null], names: ['', ''], tok: [token(), token()],
    game: null, seq: [0, 0], rematch: [false, false], dc: [null, null], tick: 0, acc: 0, last: Date.now(), botT: 0, ended: false,
  };
  if (bot) { room.names[1] = 'Orbit-Bot'; }
  rooms.set(room.code, room);
  return room;
}

function toRoom(room, o) { for (const w of room.ws) send(w, o); }

function attach(ws, room, idx) {
  ws.room = room; ws.idx = idx;
  room.ws[idx] = ws;
  room.names[idx] = ws.name;
  if (room.dc[idx]) { clearTimeout(room.dc[idx]); room.dc[idx] = null; }
  send(ws, { t: 'joined', code: room.code, you: idx, tok: room.tok[idx], names: room.names, bot: room.bot, started: !!room.game });
  toRoom(room, { t: 'names', names: room.names });
}

function startGame(room) {
  room.game = new Game();
  room.seq = [0, 0];
  room.rematch = [false, false];
  room.ended = false;
  room.last = Date.now(); room.acc = 0; room.tick = 0;
  toRoom(room, { t: 'start', names: room.names, bot: room.bot });
}

function joinRoom(ws, room) {
  const idx = room.ws[0] ? 1 : 0;
  if (room.ws[idx] || (room.bot && idx === 1)) return send(ws, { t: 'err', m: 'Room is full' });
  attach(ws, room, idx);
  if (room.bot || (room.ws[0] && room.ws[1])) startGame(room);
  else send(ws, { t: 'wait', code: room.code });
}

function leaveRoom(ws, explicit) {
  const room = ws.room;
  queue = queue.filter((q) => q !== ws);
  if (!room) return;
  const idx = ws.idx;
  ws.room = null;
  if (room.ws[idx] === ws) room.ws[idx] = null;
  const other = room.ws[1 - idx];
  if (explicit) {
    if (room.bot || !other) { rooms.delete(room.code); return; }
    forfeit(room, 1 - idx); // no-op unless a match is in progress
    send(other, { t: 'opp', left: 1 });
    return;
  }
  // connection dropped: keep the seat so the player can resume
  room.dc[idx] = setTimeout(() => {
    room.dc[idx] = null;
    if (room.game && room.game.phase !== 'over' && room.ws[1 - idx]) forfeit(room, 1 - idx);
    send(room.ws[1 - idx], { t: 'opp', left: 1 });
    if (!room.ws[0] && !room.ws[1]) rooms.delete(room.code);
  }, RECONNECT_MS);
  send(other, { t: 'opp', left: 0, away: 1 });
}

function forfeit(room, winner) {
  const g = room.game;
  if (!g || g.phase === 'over') return;
  g.finish(winner, 'forfeit');
  flush(room, true);
}

// snapshot + the last input sequence number applied per player (lets clients reconcile their prediction)
function snapOf(room) { const s = room.game.snap(); s.a = room.seq; return s; }

function flush(room, withEnd) {
  const g = room.game;
  if (!g) return;
  toRoom(room, snapOf(room));
  if (withEnd && g.phase === 'over' && !room.ended) {
    room.ended = true;
    toRoom(room, Object.assign({ t: 'end', names: room.names }, g.stats()));
  }
}

// ---- main loop (all rooms, fixed 60 Hz sim, 30 Hz snapshots) -----------------------------------
function tickRoom(room, now) {
  const g = room.game;
  if (!g || g.phase === 'over') { room.last = now; return; }
  room.acc += Math.min(0.1, (now - room.last) / 1000);
  room.last = now;
  while (room.acc >= TICK) {
    room.acc -= TICK;
    if (room.bot && (room.botT -= TICK) <= 0) {
      room.botT = 0.15;
      g.setPush(1, botDecide(g, g.players[1], 0.45));
    }
    g.step(TICK);
    room.tick++;
    if (g.phase === 'over') break;
    toRoom(room, snapOf(room)); // 60 Hz
  }
  if (g.phase === 'over') flush(room, true);
}
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    try { tickRoom(room, now); } catch (e) { // isolate failures: drop only the broken room
      console.error('room', code, 'crashed:', e);
      toRoom(room, { t: 'err', m: 'Match crashed — please start a new one', fatal: 1, expired: 1 });
      rooms.delete(code);
    }
  }
}, 1000 / 60);

// ---- sockets ----------------------------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.alive = true; ws.name = 'Player'; ws.msgs = 0; ws.room = null;
  ws.on('pong', () => { ws.alive = true; });
  const rl = setInterval(() => { ws.msgs = 0; }, 1000);

  ws.on('message', (raw) => {
    if (++ws.msgs > 120) return; // flood guard
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.name !== undefined && !ws.room) ws.name = cleanName(m.name);

    switch (m.t) {
      case 'in': {
        const room = ws.room;
        if (room && room.game) {
          const lag = Number.isFinite(m.l) ? Math.round(Math.min(250, Math.max(0, m.l)) / (1000 / 60)) : 0;   // sender's one-way latency in ticks
          room.game.applyInputAt(ws.idx, m.p, lag);
          if (Number.isInteger(m.s) && m.s > room.seq[ws.idx]) room.seq[ws.idx] = m.s;
        }
        break;
      }
      case 'ping': send(ws, { t: 'pong', ts: m.ts }); break;
      case 'quick': {
        if (ws.room) leaveRoom(ws, true);
        queue = queue.filter((q) => q !== ws && q.readyState === 1);
        const opp = queue.shift();
        if (opp) {
          const room = makeRoom(false);
          joinRoom(opp, room); joinRoom(ws, room);
        } else { queue.push(ws); send(ws, { t: 'queued' }); }
        break;
      }
      case 'create': {
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: 'Server busy, try again' });
        if (ws.room) leaveRoom(ws, true);
        joinRoom(ws, makeRoom(false));
        break;
      }
      case 'join': {
        const room = rooms.get(String(m.code || '').toUpperCase().slice(0, 4));
        if (!room) return send(ws, { t: 'err', m: 'Room not found — check the code', fatal: 1 });
        if (ws.room) leaveRoom(ws, true);
        joinRoom(ws, room);
        break;
      }
      case 'bot': {
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: 'Server busy, try again' });
        if (ws.room) leaveRoom(ws, true);
        joinRoom(ws, makeRoom(true));
        break;
      }
      case 'resume': {
        const room = rooms.get(String(m.code || '').toUpperCase());
        const idx = room ? room.tok.indexOf(m.tok) : -1;
        if (!room || idx < 0 || room.ws[idx]) return send(ws, { t: 'err', m: 'Session expired', fatal: 1, expired: 1 });
        ws.name = room.names[idx] || ws.name;
        attach(ws, room, idx);
        send(room.ws[1 - idx], { t: 'opp', left: 0, back: 1 });
        if (room.game) { send(ws, { t: 'start', names: room.names, bot: room.bot, resumed: 1 }); if (room.game.phase === 'over') send(ws, Object.assign({ t: 'end', names: room.names }, room.game.stats())); }
        else send(ws, { t: 'wait', code: room.code });
        break;
      }
      case 'rematch': {
        const room = ws.room;
        if (!room || !room.game || room.game.phase !== 'over') return;
        room.rematch[ws.idx] = true;
        if (room.bot) room.rematch[1] = true;
        if (room.rematch[0] && room.rematch[1]) startGame(room);
        else send(room.ws[1 - ws.idx], { t: 'rem' });
        break;
      }
      case 'leave': leaveRoom(ws, true); break;
    }
  });

  ws.on('close', () => { clearInterval(rl); leaveRoom(ws, false); });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
  // sweep empty / abandoned rooms
  for (const [code, room] of rooms) {
    if (!room.ws[0] && !room.ws[1] && !room.dc[0] && !room.dc[1]) rooms.delete(code);
  }
}, 25000);

server.listen(PORT, () => console.log(`Gravity Duel listening on :${PORT}`));
