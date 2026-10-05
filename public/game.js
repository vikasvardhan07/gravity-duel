(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const { C, advance } = GDPhys; // shared with the server: identical movement maths on both sides
const COL = ['#c6ff3d', '#ff5b2e'];
const RGB = ['198,255,61', '255,91,46'];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const sess = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

// ---------------------------------------------------------------- state
let view = 'menu';               // menu | lobby | how | play | result
let me = 0, names = ['', ''], code = '', roomBot = false, queued = false;
let snap = null, recvAt = 0, prevTm = 90, lastCount = null, shrinkWarned = false, endMsg = null;
let resultTimer = 0, oppLeft = false, rematchSent = false;
const disp = [0, 1].map(() => ({ x: 0, y: 0, bx: 0, by: 0, bvx: 0, bvy: 0, bpush: 0, alive: 1, inv: 0, push: 0, score: 0, trail: [], seen: false }));
let rtt = 0.12, ack = 0;       // smoothed round-trip (s); last of our inputs the server has applied
let pickups = [];                // {id,x,y,type,ttl,born}
const parts = [], texts = [];
let shake = 0, T = 0, curRad = C.R, lastT = performance.now();

// ---------------------------------------------------------------- audio (all synthesized, no assets)
const AU = { ctx: null, master: null, on: store.get('gd_mute') !== '1', noiseBuf: null, drone: null };
function auInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    AU.master = AU.ctx.createGain(); AU.master.gain.value = AU.on ? 0.55 : 0; AU.master.connect(AU.ctx.destination);
    const n = AU.ctx.sampleRate, b = AU.ctx.createBuffer(1, n, n), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    AU.noiseBuf = b;
  } catch {}
}
function tone(f, d, type = 'sine', v = 0.25, slide = 0, delay = 0) {
  if (!AU.ctx || !AU.on) return;
  const t = AU.ctx.currentTime + delay, o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(AU.master); o.start(t); o.stop(t + d + 0.05);
}
function noise(d, v, fc, type = 'lowpass', delay = 0) {
  if (!AU.ctx || !AU.on) return;
  const t = AU.ctx.currentTime + delay, s = AU.ctx.createBufferSource(), f = AU.ctx.createBiquadFilter(), g = AU.ctx.createGain();
  s.buffer = AU.noiseBuf; f.type = type; f.frequency.value = fc;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(AU.master); s.start(t); s.stop(t + d + 0.05);
}
const SFX = {
  pick: () => { tone(660, 0.12, 'triangle', 0.3, 2); tone(990, 0.16, 'sine', 0.2, 1.5, 0.05); },
  gold: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.28, 1, i * 0.06)),
  hit: (s) => { noise(0.18, Math.min(0.7, 0.2 + s / 900), 900); tone(120, 0.15, 'sine', 0.5, 0.4); },
  die: () => { noise(0.5, 0.6, 1800, 'lowpass'); tone(300, 0.5, 'sawtooth', 0.22, 0.12); },
  ko: () => { tone(196, 0.3, 'square', 0.18, 1, 0); tone(392, 0.4, 'square', 0.18, 1, 0.1); tone(784, 0.5, 'triangle', 0.22, 1, 0.2); },
  spawn: () => tone(300, 0.25, 'sine', 0.15, 3),
  tick: () => tone(520, 0.1, 'square', 0.12),
  go: () => { tone(880, 0.35, 'square', 0.18); tone(1320, 0.4, 'triangle', 0.2, 1, 0.05); },
  warn: () => { tone(220, 0.5, 'sawtooth', 0.14, 0.5); tone(165, 0.6, 'sawtooth', 0.14, 0.5, 0.2); },
  ot: () => { tone(110, 0.8, 'sawtooth', 0.2, 2); tone(440, 0.5, 'square', 0.12, 1, 0.1); },
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.28, 1, i * 0.1)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'sine', 0.25, 1, i * 0.14)),
  push: () => tone(180, 0.07, 'sine', 0.05, 1.6),
  pull: () => tone(260, 0.07, 'sine', 0.05, 0.6),
};
function droneSet(on) {
  if (!AU.ctx) return;
  if (on && !AU.drone) {
    const g = AU.ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.05, AU.ctx.currentTime + 1.5);
    const o1 = AU.ctx.createOscillator(), o2 = AU.ctx.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 55; o2.type = 'sine'; o2.frequency.value = 82.6;
    o1.connect(g); o2.connect(g); g.connect(AU.master); o1.start(); o2.start();
    AU.drone = { g, o: [o1, o2] };
  } else if (!on && AU.drone) {
    const d = AU.drone; AU.drone = null;
    d.g.gain.exponentialRampToValueAtTime(0.0001, AU.ctx.currentTime + 0.6);
    d.o.forEach((o) => o.stop(AU.ctx.currentTime + 0.7));
  }
}
const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} };
$('mute').onclick = () => {
  auInit(); AU.on = !AU.on; store.set('gd_mute', AU.on ? '0' : '1');
  if (AU.master) AU.master.gain.value = AU.on ? 0.55 : 0;
  $('mute').textContent = AU.on ? 'SND ON' : 'SND OFF';
};
$('mute').textContent = AU.on ? 'SND ON' : 'SND OFF';

// ---------------------------------------------------------------- networking
let ws = null, retry = 0;
const queueOut = [];
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    retry = 0; $('toast').classList.remove('show');
    const c = sess.get('gd_code'), t = sess.get('gd_tok');
    if (c && t) ws.send(JSON.stringify({ t: 'resume', code: c, tok: t }));
    else {
      const r = new URLSearchParams(location.search).get('r');
      if (r && !sess.get('gd_tried')) { sess.set('gd_tried', '1'); gate('Join room ' + r.toUpperCase(), () => { toast('Joining room ' + r.toUpperCase() + '…'); send({ t: 'join', code: r }); }); }
    }
    while (queueOut.length) ws.send(queueOut.shift());
  };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    if (view !== 'menu') toast('Reconnecting…', 60000);
    setTimeout(connect, Math.min(3000, 400 + retry++ * 400));
  };
  ws.onerror = () => {};
}
function send(o) {
  o.name = myName();
  const s = JSON.stringify(o);
  if (ws && ws.readyState === 1) ws.send(s); else if (o.t !== 'in') queueOut.push(s);
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping","ts":' + performance.now() + '}'); }, 1000);

function myName() {
  let n = $('name').value.trim();
  if (!n) { n = store.get('gd_name') || ('Player' + (100 + Math.floor(Math.random() * 900))); }
  store.set('gd_name', n);
  return n;
}

function onMsg(m) {
  switch (m.t) {
    case 'joined':
      me = m.you; names = m.names; code = m.code; roomBot = m.bot;
      sess.set('gd_code', m.code); sess.set('gd_tok', m.tok);
      if (!m.started && !m.bot) showLobby();
      break;
    case 'queued': queued = true; code = ''; showLobby(); break;
    case 'wait': queued = false; showLobby(); break;
    case 'names': names = m.names; setNames(); break;
    case 'pong': { const r = (performance.now() - m.ts) / 1000; if (r > 0 && r < 3) rtt = rtt === 0.12 && !onMsg.ponged ? r : rtt * 0.8 + r * 0.2; onMsg.ponged = true; break; }
    case 'start': onStart(m); break;
    case 's': onSnap(m); break;
    case 'end': onEnd(m); break;
    case 'opp':
      if (m.left) { oppLeft = true; toast('Opponent left'); if (view === 'result') { $('bRematch').disabled = true; $('bRematch').querySelector('b').textContent = 'Opponent left'; } }
      else if (m.away) toast('Opponent disconnected — waiting up to 15s…', 4000);
      else if (m.back) toast('Opponent is back!');
      break;
    case 'rem': toast('Opponent wants a rematch!'); if (view === 'result' && !rematchSent) $('bRematch').querySelector('b').textContent = 'Accept rematch'; break;
    case 'err':
      toast(m.m, 3500);
      if (m.fatal) {
        clearSession(); show('menu');
        const r = new URLSearchParams(location.search).get('r');
        if (m.expired && r && !sess.get('gd_tried')) { // stale session was blocking an invite link: follow the invite now
          sess.set('gd_tried', '1'); toast('Joining room ' + r.toUpperCase() + '…'); send({ t: 'join', code: r });
        } else history.replaceState(null, '', location.pathname);
      }
      break;
  }
}

function clearSession() { sess.del('gd_code'); sess.del('gd_tok'); }

// ---------------------------------------------------------------- screens
function show(v) {
  view = v;
  for (const id of ['menu', 'lobby', 'tdone', 'result']) $(id).classList.toggle('hidden', id !== v);
  $('tut').classList.toggle('hidden', v !== 'tut');
  const playing = v === 'play' || v === 'result';
  $('hud').classList.toggle('hidden', !playing);
  if (v !== 'play') $('hint').classList.add('hidden');
  if (v !== 'tut' && v !== 'tdone' && tut) { tut = null; disp[0].seen = false; pickups = []; }
  if (v === 'menu') { snap = null; droneSet(false); refreshOnline(); }
}
let toastT = 0;
function toast(t, ms = 2200) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}
function showLobby() {
  show('lobby');
  const link = location.origin + '/?r=' + code;
  $('lobbyTitle').textContent = queued ? 'Finding an opponent' : 'Waiting for opponent';
  $('lobbyState').textContent = queued ? 'SEARCHING' : 'ROOM OPEN';
  $('lobbyCode').classList.toggle('hidden', queued);
  $('lobbyCode').innerHTML = code.split('').map((c) => '<span>' + c + '</span>').join('');
  $('lobbySub').textContent = queued ? 'You’ll be matched with the next player who hits Quick Match.' : 'Send this link to a friend — it works on any phone or laptop.';
  $('bCopy').classList.toggle('hidden', queued);
  $('bShare').classList.toggle('hidden', queued || !navigator.share);
  $('bCopy').dataset.link = link;
}
function setNames() {
  $('n0').textContent = (names[0] || '') + (me === 0 ? ' · you' : '');
  $('n1').textContent = (names[1] || '') + (me === 1 ? ' · you' : '');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
}
let onlineT = 0;
function refreshOnline() {
  clearTimeout(onlineT);
  fetch('/stats').then((r) => r.json()).then((s) => {
    $('online').textContent = s.online >= 3 ? '● ' + s.online + ' ONLINE' : '';
  }).catch(() => {});
  if (view === 'menu') onlineT = setTimeout(refreshOnline, 10000);
}

// ---------------------------------------------------------------- menu wiring
$('name').value = store.get('gd_name') || '';
// First-time players do the interactive training before any way into a match; it never repeats once finished or skipped.
const gate = (label, action) => (store.get('gd_tut') === '1' ? action() : startTutorial(label, action));
$('bQuick').onclick = () => { auInit(); gate('Find a match', () => send({ t: 'quick' })); };
$('bCreate').onclick = () => { auInit(); gate('Create my room', () => send({ t: 'create' })); };
$('bJoin').onclick = () => {
  auInit(); const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) return toast('Enter the 4-letter room code');
  gate('Join room ' + c, () => send({ t: 'join', code: c }));
};
$('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
$('bBot').onclick = () => { auInit(); gate('Start vs bot', () => send({ t: 'bot' })); };
$('bTut').onclick = () => { auInit(); startTutorial('Back to menu', () => show('menu')); };
$('bLobbyBot').onclick = () => { auInit(); send({ t: 'bot' }); };
$('bLobbyBack').onclick = () => { send({ t: 'leave' }); clearSession(); history.replaceState(null, '', location.pathname); show('menu'); };
$('bCopy').onclick = async () => { toast((await copyText($('bCopy').dataset.link)) ? 'Invite link copied!' : 'Copy failed — share the code ' + code); };
$('bShare').onclick = () => { navigator.share({ title: 'Gravity Duel', text: 'Join my Gravity Duel match! Room ' + code, url: $('bCopy').dataset.link }).catch(() => {}); };
$('bRematch').onclick = () => {
  auInit(); send({ t: 'rematch' }); rematchSent = true;
  if (!roomBot) { $('bRematch').disabled = true; $('bRematch').querySelector('b').textContent = 'Waiting…'; }
};
$('bMenu').onclick = () => { send({ t: 'leave' }); clearSession(); history.replaceState(null, '', location.pathname); clearTimeout(resultTimer); show('menu'); };

// ---------------------------------------------------------------- game flow
function onStart(m) {
  names = m.names; roomBot = m.bot; setNames();
  clearTimeout(resultTimer); endMsg = null; oppLeft = false; rematchSent = false;
  snap = null; pickups = []; parts.length = 0; texts.length = 0; shake = 0;
  prevTm = 90; lastCount = null; shrinkWarned = false; curRad = C.R;
  disp.forEach((d) => { d.trail.length = 0; d.seen = false; });
  $('s0').textContent = '0'; $('s1').textContent = '0';
  $('bRematch').disabled = false; $('bRematch').querySelector('b').textContent = 'Rematch';
  show('play'); queued = false; pushState = 0; seq = 0; inputs.length = 0; ack = 0; evalPush();
  $('timer').textContent = '90'; $('timer').classList.remove('low');
  const h = $('hint'); h.classList.remove('hidden'); h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
  clearTimeout(onStart.ht); onStart.ht = setTimeout(() => { if (view === 'play') h.classList.add('hidden'); }, m.resumed ? 1 : 14000);
  droneSet(true);
  const u = new URL(location.href); if (u.searchParams.has('r')) history.replaceState(null, '', location.pathname);
}
function banner(text, cls) {
  const b = $('banner'); b.className = ''; void b.offsetWidth;
  b.textContent = text; b.className = 'show ' + (cls || '');
}
function popScore(i) {
  const el = $('s' + i); el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 160);
}
function radOf(s) {
  if (!s || s.ph === 'count') return C.R;
  if (s.ph === 'overtime') return C.R_MIN;
  return C.R - (C.R - C.R_MIN) * Math.min(1, Math.max(0, 1 - s.tm / C.SHRINK_T));
}

function onSnap(s) {
  if (view !== 'play' && view !== 'result') return;
  const first = !snap;
  snap = s; recvAt = performance.now();
  if (s.a) { ack = s.a[me] | 0; while (inputs.length && inputs[0].seq <= ack) inputs.shift(); }
  for (let i = 0; i < 2; i++) {
    const p = s.p[i], d = disp[i];
    d.bx = p[0]; d.by = p[1]; d.bvx = p[2]; d.bvy = p[3]; d.bpush = p[7];
    const wasAlive = d.alive;
    d.alive = p[4]; d.inv = p[5];
    if (p[6] !== d.score) { d.score = p[6]; $('s' + i).textContent = p[6]; popScore(i); }
    if (!d.seen || (p[4] && !wasAlive)) { d.x = d.bx; d.y = d.by; d.seen = true; d.trail.length = 0; }
  }
  // pickups
  const ids = new Set();
  for (const k of s.k) {
    ids.add(k[0]);
    let o = pickups.find((q) => q.id === k[0]);
    if (!o) { o = { id: k[0], born: T }; pickups.push(o); }
    o.x = k[1]; o.y = k[2]; o.type = k[3]; o.ttl = k[4];
  }
  pickups = pickups.filter((q) => ids.has(q.id));
  // timer / countdown
  if (s.ph === 'count') {
    const v = s.cd > 3 ? 'READY' : String(Math.ceil(s.cd));
    if (v !== lastCount) { lastCount = v; banner(v); if (v !== 'READY') SFX.tick(); }
    $('timer').textContent = '90';
  } else if (s.ph === 'overtime') { $('timer').textContent = 'OT'; $('timer').classList.add('low'); }
  else if (s.ph === 'play') {
    $('timer').textContent = Math.ceil(s.tm);
    $('timer').classList.toggle('low', s.tm <= 10);
    if (!shrinkWarned && s.tm <= C.SHRINK_T && prevTm > C.SHRINK_T - 1) { shrinkWarned = true; banner('ARENA SHRINKING', 'sd'); SFX.warn(); shake += 6; }
    if (s.tm <= 10 && Math.ceil(s.tm) !== Math.ceil(prevTm)) SFX.tick();
  }
  prevTm = s.tm;
  for (const e of s.e) onEvent(e);
}

function onEvent(e) {
  switch (e.k) {
    case 'go': banner('GO!'); SFX.go(); break;
    case 'ot': banner('SUDDEN DEATH', 'sd'); SFX.ot(); break;
    case 'pick': {
      burst(e.x, e.y, e.v > 1 ? '236,230,216' : RGB[e.i], e.v > 1 ? 40 : 20, 260, 0.7, 3.2);
      text(e.x, e.y - 24, '+' + e.v, e.v > 1 ? '#ece6d8' : COL[e.i], e.v > 1 ? 34 : 26);
      e.v > 1 ? SFX.gold() : SFX.pick(); if (e.i === me) buzz(14);
      break;
    }
    case 'hit':
      burst(e.x, e.y, '236,230,216', Math.min(34, 8 + e.s / 18), 200 + e.s * 0.5, 0.45, 2.4);
      shake = Math.max(shake, Math.min(14, e.s / 40)); SFX.hit(e.s); if (e.s > 180) buzz(30);
      break;
    case 'die':
      burst(e.x, e.y, RGB[e.i], 70, 380, 0.9, 3.6); burst(e.x, e.y, '236,230,216', 25, 240, 0.5, 2.4);
      shake = Math.max(shake, 11); SFX.die(); if (e.i === me) buzz([60, 40, 90]);
      break;
    case 'ko':
      text(e.x, e.y - 30, 'KO +2', '#ece6d8', 38); shake = Math.max(shake, 15); SFX.ko(); if (e.i === me) buzz(70);
      break;
    case 'spawn': burst(e.x, e.y, RGB[e.i], 24, 200, 0.6, 2.6); if (e.i === me) SFX.spawn(); break;
  }
}

function onEnd(m) {
  endMsg = m; names = m.names; droneSet(false);
  const won = m.w === me;
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    $('resTitle').textContent = won ? 'Victory' : 'Defeat';
    $('resTitle').className = won ? 'win' : 'lose';
    $('resSub').textContent = (m.reason === 'forfeit' ? 'OPPONENT LEFT' : m.reason === 'overtime' ? 'SUDDEN DEATH' : 'FULL TIME');
    $('rn0').textContent = names[0]; $('rn1').textContent = names[1];
    $('rs0').textContent = m.s[0].score; $('rs1').textContent = m.s[1].score;
    const rows = [['pk', 'Shards'], ['ko', 'KOs'], ['deaths', 'Falls']];
    $('resStats').innerHTML = rows.map(([k, l]) => {
      const a = m.s[0][k], b = m.s[1][k], t = Math.max(1, a + b);
      return `<div class="srow"><span>${a}</span><div><label>${l}</label><div class="bars"><i style="flex-grow:${a / t}"></i><i style="flex-grow:${b / t}"></i></div></div><span>${b}</span></div>`;
    }).join('');
    const rb = $('bRematch'); rb.disabled = oppLeft; rb.querySelector('b').textContent = oppLeft ? 'Opponent left' : 'Rematch';
    show('result');
    won ? SFX.win() : SFX.lose();
    if (won) for (let i = 0; i < 6; i++) setTimeout(() => burst((Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500, ['236,230,216', '198,255,61', '255,91,46'][i % 3], 40, 340, 1.2, 3), i * 150);
  }, m.reason === 'forfeit' ? 300 : 1400);
}

// ---------------------------------------------------------------- effects
function burst(x, y, rgb, n, spd, life, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = spd * (0.2 + Math.random() * 0.8);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life * (0.6 + Math.random() * 0.4), rgb, size: size * (0.5 + Math.random()) });
  }
  if (parts.length > 700) parts.splice(0, parts.length - 700);
}
function text(x, y, t, col, size) { texts.push({ x, y, t, col, size, life: 1 }); }

// ---------------------------------------------------------------- interactive training
// Offline sandbox running the exact same physics as a match. Four short tasks; each one teaches one rule by doing it.
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
const HOLD = coarse ? 'Touch and hold anywhere' : 'Hold the mouse button or SPACE';
$('tutKeyLabel').textContent = coarse ? 'Touch & hold anywhere' : 'Mouse button · SPACE';
const TUT = [
  { title: 'Hold to push away', body: HOLD + ' — your orb accelerates away from the black hole. Push it out to the dashed ring.', test: (t) => pushState === 1 && t.d > 300 },
  { title: 'Release to fall in', body: 'Let go — gravity drags you back toward the hole, and you speed up the closer you get. Fall inside the dashed ring.', test: (t) => pushState === 0 && t.d < 170 },
  { title: 'Catch the shard', body: 'Time your hold and release to meet the glowing diamond. Hold = outward, release = inward.', shard: 0 },
  { title: 'Mind the edges', body: 'Grab the gold shard (worth 3), but stay out of the hatched zones. In a match they knock you out for 2 seconds.', shard: 1 },
];
let tut = null;
const tutOrb = () => ({ x: C.START_D, y: 0, vx: 0, vy: C.START_V });
function startTutorial(label, after) {
  clearTimeout(resultTimer);
  snap = null; pickups = []; parts.length = 0; texts.length = 0; me = 0; curRad = C.R; shake = 0;
  disp.forEach((d) => { d.trail.length = 0; d.seen = false; });
  tut = { step: 0, o: tutOrb(), label, after, hazardT: -9, stepT: 0, shardT: 0, done: false, d: C.START_D };
  Object.assign(disp[0], { seen: true, alive: 1, inv: 0, push: 0, x: tut.o.x, y: tut.o.y });
  $('tutGoLabel').textContent = label; droneSet(false);
  show('tut'); tutGo(0);
}
function tutGo(step) {
  tut.step = step; tut.stepT = 0; pickups = [];
  const t = TUT[step];
  $('tutStep').textContent = 'STEP ' + (step + 1) + ' / ' + TUT.length;
  $('tutTitle').textContent = t.title; $('tutBody').textContent = t.body;
  $('tutDots').innerHTML = TUT.map((_, i) => '<i class="' + (i < step ? 'ok' : i === step ? 'on' : '') + '"></i>').join('');
  if (t.shard !== undefined) tutShard(t.shard, false);
}
function tutShard(gold, retry) { // place the diamond ahead of the orb, on a path it can actually reach
  const o = tut.o, w = o.x * o.vy - o.y * o.vx, d = Math.hypot(o.x, o.y);
  const a = Math.atan2(o.y, o.x) + Math.sign(w || 1) * (retry ? 0.9 : gold ? 1.3 : 1.0);
  const r = retry ? Math.min(330, Math.max(130, d)) : gold ? 335 : 230;
  pickups = [{ id: 900 + tut.step, born: T, x: Math.cos(a) * r, y: Math.sin(a) * r, type: gold, ttl: 99 }];
  tut.shardT = 0;
}
function tutStepDone() {
  const d = disp[0];
  burst(d.x, d.y, '198,255,61', 26, 280, 0.7, 3.2); text(d.x, d.y - 34, 'NICE', '#c6ff3d', 26);
  TUT[tut.step].shard === 1 ? SFX.gold() : SFX.pick(); buzz(14);
  if (tut.step + 1 < TUT.length) tutGo(tut.step + 1);
  else { tut.done = true; pickups = []; store.set('gd_tut', '1'); SFX.win(); show('tdone'); }
}
function tutorialStep(dt) {
  tut.stepT += dt;
  const o = tut.o, n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, dd = disp[0];
  for (let k = 0; k < n; k++) advance(o, tut.done ? 0 : pushState, h);
  const d = Math.hypot(o.x, o.y); tut.d = d;
  const lo = C.CORE + C.ORB, hi = C.R - C.ORB, grace = tut.done || T - tut.hazardT <= 1.2;
  if (grace && (d < lo || d > hi)) { // protected (just respawned / demo finished): bounce off the hazards like a spawn shield
    const nx = o.x / d, ny = o.y / d, k = (d < lo ? lo : hi) / d; o.x *= k; o.y *= k;
    const vr = o.vx * nx + o.vy * ny;
    if ((d < lo && vr < 0) || (d > hi && vr > 0)) { o.vx -= 1.6 * vr * nx; o.vy -= 1.6 * vr * ny; }
  } else if (!grace && (d < lo || d > hi)) { // hazard: show a knockout, then reset
    burst(o.x, o.y, RGB[0], 60, 360, 0.9, 3.6); SFX.die(); shake = Math.max(shake, 10);
    text(o.x * 0.75, o.y * 0.75, 'KNOCKED OUT', '#ece6d8', 24); buzz(60);
    tut.o = tutOrb(); tut.hazardT = T; dd.trail.length = 0; tut.shardT = 0;
  }
  dd.x = tut.o.x; dd.y = tut.o.y; dd.alive = 1; dd.push = pushState; dd.inv = Math.max(0, tut.hazardT + 1.2 - T);
  dd.trail.push(dd.x, dd.y); if (dd.trail.length > 46) dd.trail.splice(0, 2);
  const st = $('tutState'); st.textContent = pushState ? 'PUSHING ▲' : 'FALLING ▼'; st.classList.toggle('on', !!pushState);
  if (tut.done) return;
  const t = TUT[tut.step];
  if (t.shard !== undefined) {
    const k = pickups[0]; tut.shardT += dt;
    if (k && Math.hypot(k.x - dd.x, k.y - dd.y) < C.ORB + C.PICK_R) tutStepDone();
    else if (tut.shardT > 9) tutShard(t.shard, true);
  } else if (t.test(tut) && tut.stepT > 0.5) tutStepDone();
}
function drawTutOverlay() {
  if (!tut || tut.done || TUT[tut.step].shard !== undefined) return;
  const r = tut.step === 0 ? 300 : 170, pulse = 0.5 + 0.5 * Math.sin(T * 4);
  ctx.save(); ctx.setLineDash([10, 8]); ctx.lineDashOffset = -T * 22; ctx.strokeStyle = 'rgba(198,255,61,' + (0.5 + 0.4 * pulse) + ')'; ctx.lineWidth = 3;
  ringOn(ctx, r); ctx.stroke(); ctx.restore();
  ctx.font = '600 11px ' + FONT_M; ctx.textAlign = 'center'; ctx.fillStyle = '#c6ff3d';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(tut.step === 0 ? 'REACH THE RING' : 'FALL INSIDE THE RING', 0, -r - 12);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
const endTutorial = () => { const a = tut.after; tut = null; disp[0].seen = false; pickups = []; parts.length = 0; texts.length = 0; show('menu'); a(); };
$('tutSkip').onclick = () => { store.set('gd_tut', '1'); endTutorial(); };
$('bTutGo').onclick = () => { auInit(); endTutorial(); };
$('bTutAgain').onclick = () => startTutorial(tut ? tut.label : 'Start', tut ? tut.after : () => show('menu'));

// ---------------------------------------------------------------- input
// Pressed state lives in Sets keyed by pointer id / key code (never a ++/-- counter), and is wiped by every
// escape route (blur, tab hide, right-click, release outside the window), so a lost key-up can't leave you stuck.
let pushState = 0, seq = 0;
const inputs = [];                       // our inputs the server hasn't acknowledged yet: {seq, push, t}
const ptrs = new Set(), keysDown = new Set();
function setPush(v) {
  v = v ? 1 : 0;
  if (v === pushState) return;
  pushState = v;
  if (view === 'tut') { (v ? SFX.push : SFX.pull)(); return; }
  if (view !== 'play') return;
  seq++; inputs.push({ seq, push: v, t: performance.now() });
  if (inputs.length > 64) inputs.splice(0, inputs.length - 64);
  if (ws && ws.readyState === 1) ws.send('{"t":"in","p":' + v + ',"s":' + seq + ',"l":' + Math.round(Math.min(0.25, rtt / 2) * 1000) + '}');
  if (snap && snap.ph !== 'count') (v ? SFX.push : SFX.pull)();
}
const evalPush = () => setPush(ptrs.size > 0 || keysDown.size > 0);
const unfocus = () => { const a = document.activeElement; if (a && a !== document.body && a.tagName !== 'INPUT') a.blur(); }; // Space must never "click" a focused button
const cv = $('c'), ctx = cv.getContext('2d');
cv.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  auInit(); unfocus(); ptrs.add(e.pointerId);
  try { cv.setPointerCapture(e.pointerId); } catch {}
  evalPush(); e.preventDefault();
});
const pointerUp = (e) => { if (ptrs.delete(e.pointerId)) evalPush(); };
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => cv.addEventListener(ev, pointerUp));
addEventListener('pointerup', pointerUp); addEventListener('pointercancel', pointerUp);   // released outside the canvas/window
cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && ptrs.has(e.pointerId) && !(e.buttons & 1)) pointerUp(e); });
cv.addEventListener('contextmenu', (e) => { e.preventDefault(); ptrs.clear(); evalPush(); });
const KEYSET = new Set(['Space', 'ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight']);
const typing = (e) => e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
addEventListener('keydown', (e) => {
  if (!KEYSET.has(e.code) || typing(e)) return;
  e.preventDefault(); auInit(); unfocus();
  if (!keysDown.has(e.code)) { keysDown.add(e.code); evalPush(); }
});
addEventListener('keyup', (e) => {
  if (!KEYSET.has(e.code)) return;
  if (!typing(e)) e.preventDefault();      // otherwise Space-release would "click" the focused button
  if (keysDown.delete(e.code)) evalPush();
});
const releaseAll = () => { ptrs.clear(); keysDown.clear(); evalPush(); };
addEventListener('blur', releaseAll); addEventListener('pagehide', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
addEventListener('pointerdown', () => auInit(), { once: true });

// ---------------------------------------------------------------- rendering
// Look: ink-black chart paper, bone-white linework, cartographic hatching for hazards,
// and only two saturated colours (the players).
const BONE = '236,230,216';
const FONT_D = "'Unbounded','Arial Black',sans-serif", FONT_M = "'Martian Mono',ui-monospace,Menlo,monospace";
let W = 0, H = 0, DPR = 1, dprCap = 2, S = 1, CX = 0, CY = 0, IX = 0, IY = 0, IS = 1, bg = null, hatchCv = null, stat = null, rim = null, rimRad = -1;
const HALF = C.R + 70;
const idle = [0, 1].map(() => ({ x: 0, y: 0, trail: [] }));
const mkCanvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function makeHatch() {
  hatchCv = mkCanvas(14);
  const g = hatchCv.getContext('2d'); g.strokeStyle = `rgb(${BONE})`; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(-2, 16); g.lineTo(16, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(12, 16); g.lineTo(16, 12); g.stroke();
}
function ringOn(g, r) { g.beginPath(); g.arc(0, 0, r, 0, TAU); }
function hatchBand(g, r0, r1, a) {
  if (r1 <= r0 || r1 <= 0) return;
  g._pat = g._pat || g.createPattern(hatchCv, 'repeat');
  g.save(); g.beginPath(); g.arc(0, 0, r1, 0, TAU); g.arc(0, 0, Math.max(0, r0), 0, TAU, true);
  g.globalAlpha = a; g.fillStyle = g._pat; g.fill('evenodd'); g.restore();
}

function resize() {
  DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, dprCap));
  W = innerWidth; H = innerHeight;
  if (W * H * DPR * DPR > 5e6) DPR = Math.max(1, Math.sqrt(5e6 / (W * H)));
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const land = W > H * 1.15, top = land ? 18 : 104, bot = land ? 18 : 52;
  S = Math.min(W / (2 * C.R + 110), (H - top - bot) / (2 * C.R + 110));
  CX = W / 2; CY = top + (H - top - bot) / 2;
  if (W > 860) { IX = W * 0.69; IY = H * 0.5; IS = Math.min(W * 0.3, H * 0.4) / C.R; }
  else { IX = W / 2; IY = H * 0.36; IS = Math.min(W * 0.44, H * 0.2) / C.R; }
  // background (with vignette + film grain baked in once, so nothing full-screen is composited per frame)
  bg = mkCanvas(cv.width, cv.height);
  const b = bg.getContext('2d'), g = b.createRadialGradient(bg.width * 0.6, bg.height * 0.45, 0, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.8);
  g.addColorStop(0, '#15151c'); g.addColorStop(1, '#07070a'); b.fillStyle = g; b.fillRect(0, 0, bg.width, bg.height);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) { b.fillStyle = `rgba(${BONE},${0.08 + rnd() * 0.22})`; const r = (0.5 + rnd() * 0.9) * DPR; b.fillRect(rnd() * bg.width, rnd() * bg.height, r, r); }
  const v = b.createRadialGradient(bg.width / 2, bg.height * 0.46, Math.min(bg.width, bg.height) * 0.3, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)'); b.fillStyle = v; b.fillRect(0, 0, bg.width, bg.height);
  const nz = mkCanvas(160), nd = nz.getContext('2d'), im = nd.createImageData(160, 160);
  for (let i = 0; i < im.data.length; i += 4) { im.data[i] = 236; im.data[i + 1] = 230; im.data[i + 2] = 216; im.data[i + 3] = rnd() * 22; }
  nd.putImageData(im, 0, 0); b.fillStyle = b.createPattern(nz, 'repeat'); b.fillRect(0, 0, bg.width, bg.height);
  makeHatch(); buildStatic();
}
let rzT = 0;
addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(resize, 120); }); resize();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildStatic()); // re-paint labels once the real fonts are in

// The arena's unchanging parts are painted once into an offscreen layer; the shrinking rim into another that is
// only repainted when the radius actually changes. Per frame the arena is two drawImage calls + a few strokes.
function buildStatic() {
  const size = Math.ceil(2 * HALF * Math.max(S, IS) * DPR);
  stat = mkCanvas(size); rim = mkCanvas(size); rimRad = -1;
  const g = stat.getContext('2d'); g.translate(size / 2, size / 2); const sc = size / (2 * HALF); g.scale(sc, sc);
  paintStatic(g);
}
function paintStatic(g) {
  const R = C.R;
  let gr = g.createRadialGradient(0, 0, C.CORE, 0, 0, R);
  gr.addColorStop(0, '#181821'); gr.addColorStop(1, '#0d0d12');
  g.fillStyle = gr; ringOn(g, R); g.fill();
  g.lineWidth = 1; g.strokeStyle = `rgba(${BONE},.1)`;
  for (const r of [100, 180, 260, 340]) { ringOn(g, r); g.stroke(); }
  g.strokeStyle = `rgba(${BONE},.07)`; g.beginPath();
  const r0 = C.CORE + C.ORB + 4;
  for (let a = 0; a < 12; a++) { const t = a * TAU / 12; g.moveTo(Math.cos(t) * r0, Math.sin(t) * r0); g.lineTo(Math.cos(t) * R, Math.sin(t) * R); }
  g.stroke();
  const t1 = new Path2D(), t2 = new Path2D(), t3 = new Path2D();
  for (let d = 0; d < 360; d += 2) {
    const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), len = d % 30 === 0 ? 15 : d % 10 === 0 ? 9 : 4, p = d % 30 === 0 ? t3 : d % 10 === 0 ? t2 : t1;
    p.moveTo(c * (R + 8), s * (R + 8)); p.lineTo(c * (R + 8 + len), s * (R + 8 + len));
  }
  g.lineWidth = 1; g.strokeStyle = `rgba(${BONE},.28)`; g.stroke(t1); g.strokeStyle = `rgba(${BONE},.5)`; g.stroke(t2);
  g.lineWidth = 1.5; g.strokeStyle = `rgba(${BONE},.9)`; g.stroke(t3);
  g.font = `500 10px ${FONT_M}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = `rgba(${BONE},.55)`;
  for (let d = 0; d < 360; d += 30) { const a = d * Math.PI / 180; g.fillText(String(d).padStart(3, '0'), Math.cos(a) * (R + 32), Math.sin(a) * (R + 32)); }
  g.textBaseline = 'alphabetic';
  gr = g.createRadialGradient(0, 0, C.CORE, 0, 0, C.CORE + 90);
  gr.addColorStop(0, `rgba(${BONE},.26)`); gr.addColorStop(1, `rgba(${BONE},0)`);
  g.fillStyle = gr; ringOn(g, C.CORE + 90); g.fill();
  hatchBand(g, C.CORE, C.CORE + C.ORB, 0.5);
  g.fillStyle = '#000'; ringOn(g, C.CORE); g.fill();
  g.strokeStyle = `rgb(${BONE})`; g.lineWidth = 2.5; ringOn(g, C.CORE); g.stroke();
}
function paintRim(rad) {
  const g = rim.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, rim.width, rim.height);
  g.translate(rim.width / 2, rim.height / 2); const sc = rim.width / (2 * HALF); g.scale(sc, sc);
  if (rad < C.R - 1) { // collapsed (already lethal) zone
    g.fillStyle = `rgba(${BONE},.05)`; g.beginPath(); g.arc(0, 0, C.R, 0, TAU); g.arc(0, 0, rad, 0, TAU, true); g.fill('evenodd');
    hatchBand(g, rad, C.R, 0.2);
  }
  hatchBand(g, rad - 22, rad, 0.55); hatchBand(g, rad - 42, rad - 22, 0.3); hatchBand(g, rad - 62, rad - 42, 0.13);
  g.strokeStyle = `rgba(${BONE},.16)`; g.lineWidth = 9; ringOn(g, rad); g.stroke();
  g.strokeStyle = `rgb(${BONE})`; g.lineWidth = 2.5; ringOn(g, rad); g.stroke();
}

function update(dt) {
  T += dt;
  const now = performance.now();
  const live = snap && (snap.ph === 'play' || snap.ph === 'overtime');
  if (tut) tutorialStep(dt);
  // Client-side prediction. The latest server state is `owd` old and doesn't yet contain our unacknowledged inputs,
  // so re-simulate it forward to "now" with the same physics the server runs, applying our inputs as pressed.
  const owd = Math.min(0.25, rtt / 2), ahead = Math.min(0.4, (now - recvAt) / 1000 + owd), w0 = recvAt - owd * 1000;
  for (let i = 0; i < 2; i++) {
    const d = disp[i];
    if (!d.seen || tut) continue;
    let tx = d.bx, ty = d.by;
    if (live && d.alive && ahead > 0.001) {
      const o = { x: d.bx, y: d.by, vx: d.bvx, vy: d.bvy }, n = Math.max(1, Math.ceil(ahead * 60)), h = ahead / n;
      for (let k = 0; k < n; k++) {
        let p = d.bpush;
        if (i === me) { const w = w0 + (k + 0.5) * h * 1000; for (const q of inputs) { if (q.t <= w) p = q.push; else break; } }
        advance(o, p, h);
      }
      tx = o.x; ty = o.y;
    }
    d.push = i === me ? pushState : d.bpush;
    if (Math.hypot(d.x - tx, d.y - ty) > 90) { d.x = tx; d.y = ty; d.trail.length = 0; }
    else { const k = 1 - Math.exp(-dt * (i === me ? 32 : 24)); d.x += (tx - d.x) * k; d.y += (ty - d.y) * k; }
    if (d.alive && live) { d.trail.push(d.x, d.y); if (d.trail.length > 46) d.trail.splice(0, 2); }
    else if (d.trail.length) d.trail.splice(0, 2);
  }
  if (!snap && !tut) idle.forEach((o, i) => { // attract-mode orbit behind the menu
    const a = T * (0.62 + i * 0.06) + i * Math.PI, r = 235 + Math.sin(T * 0.7 + i * 2.1) * 90;
    o.x = Math.cos(a) * r; o.y = Math.sin(a) * r; o.trail.push(o.x, o.y); if (o.trail.length > 70) o.trail.splice(0, 2);
  });
  curRad += (radOf(snap) - curRad) * (1 - Math.exp(-dt * 8));
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; const f = Math.exp(-2.4 * dt); p.vx *= f; p.vy *= f;
  }
  for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.life -= dt * 1.05; t.y -= 34 * dt; if (t.life <= 0) texts.splice(i, 1); }
  shake *= Math.exp(-7 * dt); if (shake < 0.1) shake = 0;
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (bg) ctx.drawImage(bg, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!snap && !tut) {
    ctx.save(); ctx.translate(IX, IY); ctx.scale(IS, IS);
    drawArena(C.R);
    idle.forEach((o, i) => { trailOf(o.trail, i); orbBody(o.x, o.y, i, 1); });
    ctx.restore();
    return;
  }
  const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.save(); ctx.translate(CX + sx, CY + sy); ctx.scale(S, S);
  drawArena(curRad);
  drawTutOverlay();
  drawPickups();
  for (let i = 0; i < 2; i++) trailOf(disp[i].trail, i);
  for (let i = 0; i < 2; i++) drawOrb(i);
  drawParts(); drawTexts();
  ctx.restore();
}

function drawArena(rad) {
  const pulse = 0.5 + 0.5 * Math.sin(T * 3);
  ctx.drawImage(stat, -HALF, -HALF, HALF * 2, HALF * 2);
  ctx.lineWidth = 2;   // gravity flow: dashes drifting inward on three rings
  [140, 220, 300].forEach((r, i) => {
    if (r > rad - 80) return;
    ctx.setLineDash([1, 26 + i * 6]); ctx.lineDashOffset = T * (16 + i * 5); ctx.strokeStyle = `rgba(${BONE},.3)`; ringOn(ctx, r); ctx.stroke();
  });
  ctx.setLineDash([]);
  if (Math.abs(rad - rimRad) > 0.6) { paintRim(rad); rimRad = rad; }
  ctx.drawImage(rim, -HALF, -HALF, HALF * 2, HALF * 2);
  ctx.strokeStyle = `rgba(${BONE},${0.05 + pulse * 0.1})`; ctx.lineWidth = 15; ringOn(ctx, rad); ctx.stroke();   // pulsing rim glow (no shadowBlur)
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = T * (1.9 - i * 0.45) + i * 2.1; ctx.strokeStyle = `rgba(${BONE},${0.85 - i * 0.2})`;
    ctx.beginPath(); ctx.arc(0, 0, C.CORE + C.ORB + 10 + i * 7, a, a + 1.1 + i * 0.35); ctx.stroke();
  }
}

function drawPickups() {
  for (const k of pickups) {
    const gold = k.type === 1, born = Math.min(1, (T - k.born) * 4), blink = k.ttl < 2 && Math.sin(T * 18) < 0;
    if (blink) continue;
    const sz = (gold ? 15 : 10) * born, y = k.y + Math.sin(T * 3 + k.id) * 2.5;
    ctx.save(); ctx.translate(k.x, y);
    if (gold) { // pulsing sonar rings mark the 3-pointer
      for (let r = 0; r < 2; r++) { const f = ((T * 0.9 + r * 0.5) % 1); ctx.strokeStyle = `rgba(${BONE},${(1 - f) * 0.7})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 14 + f * 34, 0, TAU); ctx.stroke(); }
    }
    ctx.rotate(T * (gold ? 1.8 : 1.1) + k.id);
    ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.7, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.7, 0); ctx.closePath();
    if (gold) { const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, 34); gg.addColorStop(0, `rgba(${BONE},.45)`); gg.addColorStop(1, `rgba(${BONE},0)`); ctx.save(); ctx.rotate(-(T * 1.8 + k.id)); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill(); ctx.restore(); ctx.fillStyle = `rgb(${BONE})`; ctx.fill(); }
    else { ctx.strokeStyle = `rgb(${BONE})`; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = `rgba(${BONE},.9)`; ctx.fillRect(-1.6, -1.6, 3.2, 3.2); }
    ctx.restore();
  }
}

function trailOf(t, i) {
  if (t.length < 4) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const n = t.length / 2;
  for (let j = 1; j < n; j++) {
    const f = j / n;
    ctx.strokeStyle = `rgba(${RGB[i]},${f * f * 0.6})`; ctx.lineWidth = C.ORB * 1.5 * f;
    ctx.beginPath(); ctx.moveTo(t[(j - 1) * 2], t[(j - 1) * 2 + 1]); ctx.lineTo(t[j * 2], t[j * 2 + 1]); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function orbBody(x, y, i, alpha) {
  ctx.globalAlpha = alpha;
  let g = ctx.createRadialGradient(x, y, C.ORB * 0.6, x, y, C.ORB * 3);
  g.addColorStop(0, `rgba(${RGB[i]},.35)`); g.addColorStop(1, `rgba(${RGB[i]},0)`);
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, C.ORB * 3, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = COL[i]; ctx.beginPath(); ctx.arc(x, y, C.ORB, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(9,9,12,.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, C.ORB - 6, 0, TAU); ctx.stroke();
  ctx.fillStyle = `rgb(${BONE})`; ctx.beginPath(); ctx.arc(x - 6, y - 7, 3.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = `rgba(${BONE},.55)`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, C.ORB + 4, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawOrb(i) {
  const d = disp[i];
  if (!d.seen || !d.alive) return;
  const blink = d.inv > 0 ? (Math.sin(T * 28) > -0.3 ? 1 : 0.35) : 1;
  orbBody(d.x, d.y, i, blink);
  const dist = Math.hypot(d.x, d.y) || 1, nx = d.x / dist, ny = d.y / dist, dir = d.push ? 1 : -1, px = -ny, py = nx;
  // gravity-mode chevrons: outward while holding, inward while released
  ctx.strokeStyle = `rgb(${BONE})`; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.95 * blink;
  for (let c = 0; c < 2; c++) {
    const off = C.ORB + 13 + c * 8, tx = d.x + nx * dir * off, ty = d.y + ny * dir * off, bx = tx - nx * dir * 5.5, by = ty - ny * dir * 5.5;
    ctx.beginPath(); ctx.moveTo(bx + px * 7, by + py * 7); ctx.lineTo(tx, ty); ctx.lineTo(bx - px * 7, by - py * 7); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (d.inv > 0) { ctx.strokeStyle = `rgba(${BONE},${0.6 * blink})`; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(d.x, d.y, C.ORB + 10 + Math.sin(T * 12), 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  // callsign tag: filled chip for you, plain text for the rival
  ctx.textAlign = 'center'; ctx.font = `600 10px ${FONT_M}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
  const ty = d.y - C.ORB - 22;
  if (i === me) {
    ctx.fillStyle = COL[i]; ctx.fillRect(d.x - 18, ty - 10, 36, 15);
    ctx.fillStyle = '#09090c'; ctx.fillText('YOU', d.x + 0.75, ty + 1);
  } else { ctx.fillStyle = `rgba(${BONE},.85)`; ctx.fillText((names[i] || '').toUpperCase().slice(0, 10), d.x, ty + 1); }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function drawParts() { // spark streaks
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const p of parts) {
    const a = Math.max(0, p.life / p.max);
    ctx.strokeStyle = `rgba(${p.rgb},${a})`; ctx.lineWidth = Math.max(0.8, p.size * 0.55 * a);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawTexts() {
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, t.life * 1.8); ctx.font = `800 ${t.size}px ${FONT_D}`;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(9,9,12,.9)'; ctx.strokeText(t.t, t.x, t.y);
    ctx.fillStyle = t.col; ctx.fillText(t.t, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

let ftAvg = 16.7, lastDrop = 0;
function frame(now) {
  const raw = now - lastT, dt = Math.min(0.05, raw / 1000); lastT = now;
  ftAvg = ftAvg * 0.95 + Math.min(raw, 100) * 0.05;
  if (ftAvg > 27 && DPR > 1 && now - lastDrop > 4000) { lastDrop = now; dprCap = Math.max(1, DPR - 0.5); ftAvg = 16.7; resize(); } // struggling GPU: drop resolution, keep framerate
  update(dt); draw(); requestAnimationFrame(frame);
}
if (typeof window !== 'undefined' && window.__GD_TEST) window.__GD_TEST.api = { disp, inputs, get tut() { return tut; }, TUT, pickupsRef: () => pickups, get seq() { return seq; }, get rtt() { return rtt; } }; // test hook (no-op in production)
requestAnimationFrame(frame);
refreshOnline();
connect();
})();
