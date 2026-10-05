(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const C = { R: 420, CORE: 40, ORB: 18, RMIN: 300, SHRINK: 30 };
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
const disp = [0, 1].map(() => ({ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, alive: 1, inv: 0, push: 0, score: 0, trail: [], seen: false }));
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
      if (r && !sess.get('gd_tried')) { sess.set('gd_tried', '1'); toast('Joining room ' + r.toUpperCase() + '…'); send({ t: 'join', code: r }); }
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
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 10000);

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
  for (const id of ['menu', 'lobby', 'how', 'result']) $(id).classList.toggle('hidden', id !== v);
  const playing = v === 'play' || v === 'result';
  $('hud').classList.toggle('hidden', !playing);
  if (v !== 'play') $('hint').classList.add('hidden');
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
$('bQuick').onclick = () => { auInit(); send({ t: 'quick' }); };
$('bCreate').onclick = () => { auInit(); send({ t: 'create' }); };
$('bJoin').onclick = () => {
  auInit(); const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) return toast('Enter the 4-letter room code');
  send({ t: 'join', code: c });
};
$('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
$('bBot').onclick = () => { auInit(); if (store.get('gd_seen')) send({ t: 'bot' }); else show('how'); };
$('bHowGo').onclick = () => { auInit(); store.set('gd_seen', '1'); send({ t: 'bot' }); };
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
  show('play'); queued = false; setPush(0);
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
  if (s.ph === 'overtime') return C.RMIN;
  return C.R - (C.R - C.RMIN) * Math.min(1, Math.max(0, 1 - s.tm / C.SHRINK));
}

function onSnap(s) {
  if (view !== 'play' && view !== 'result') return;
  const first = !snap;
  snap = s; recvAt = performance.now();
  for (let i = 0; i < 2; i++) {
    const p = s.p[i], d = disp[i];
    d.tx = p[0]; d.ty = p[1]; d.vx = p[2]; d.vy = p[3];
    const wasAlive = d.alive;
    d.alive = p[4]; d.inv = p[5];
    if (p[6] !== d.score) { d.score = p[6]; $('s' + i).textContent = p[6]; popScore(i); }
    d.push = i === me && pushState !== null ? pushState : p[7];
    if (!d.seen || (p[4] && !wasAlive) || Math.hypot(d.x - d.tx, d.y - d.ty) > 90) { d.x = d.tx; d.y = d.ty; d.seen = true; d.trail.length = 0; }
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
    if (!shrinkWarned && s.tm <= C.SHRINK && prevTm > C.SHRINK - 1) { shrinkWarned = true; banner('ARENA SHRINKING', 'sd'); SFX.warn(); shake += 6; }
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

// ---------------------------------------------------------------- input
let pushState = null, pointers = 0, keys = 0;
function setPush(v) {
  if (v === pushState) return;
  pushState = v;
  if (view === 'play') {
    send({ t: 'in', p: v });
    disp[me].push = v;
    if (snap && snap.ph !== 'count') (v ? SFX.push : SFX.pull)();
  }
}
const evalPush = () => setPush(pointers > 0 || keys > 0 ? 1 : 0);
const cv = $('c'), ctx = cv.getContext('2d');
cv.addEventListener('pointerdown', (e) => { auInit(); pointers++; cv.setPointerCapture?.(e.pointerId); evalPush(); e.preventDefault(); });
const up = () => { pointers = Math.max(0, pointers - 1); evalPush(); };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('lostpointercapture', () => { if (pointers > 0) { pointers = 0; evalPush(); } });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
const KEYS = new Set([' ', 'Space', 'ArrowUp', 'w', 'W', 'Shift']);
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (KEYS.has(e.key) || KEYS.has(e.code)) { auInit(); if (!e.repeat) { keys++; evalPush(); } e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (KEYS.has(e.key) || KEYS.has(e.code)) { keys = Math.max(0, keys - 1); evalPush(); }
});
const releaseAll = () => { pointers = 0; keys = 0; evalPush(); };
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
addEventListener('pointerdown', () => auInit(), { once: true });

// ---------------------------------------------------------------- rendering
// Look: ink-black chart paper, bone-white linework, cartographic hatching for hazards,
// and only two saturated colours (the players).
const BONE = '236,230,216';
const FONT_D = "'Unbounded','Arial Black',sans-serif", FONT_M = "'Martian Mono',ui-monospace,Menlo,monospace";
let W = 0, H = 0, DPR = 1, S = 1, CX = 0, CY = 0, IX = 0, IY = 0, IS = 1, bg = null, hatch = null;
const idle = [0, 1].map(() => ({ x: 0, y: 0, trail: [] }));

function makeHatch() {
  const c = document.createElement('canvas'); c.width = c.height = 14;
  const g = c.getContext('2d'); g.strokeStyle = `rgb(${BONE})`; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(-2, 16); g.lineTo(16, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(12, 16); g.lineTo(16, 12); g.stroke();
  return ctx.createPattern(c, 'repeat');
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const land = W > H * 1.15, top = land ? 18 : 104, bot = land ? 18 : 52;
  S = Math.min(W / (2 * C.R + 110), (H - top - bot) / (2 * C.R + 110));
  CX = W / 2; CY = top + (H - top - bot) / 2;
  if (W > 860) { IX = W * 0.69; IY = H * 0.5; IS = Math.min(W * 0.3, H * 0.4) / C.R; }
  else { IX = W / 2; IY = H * 0.36; IS = Math.min(W * 0.44, H * 0.2) / C.R; }
  bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
  const b = bg.getContext('2d'), g = b.createRadialGradient(bg.width * 0.6, bg.height * 0.45, 0, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.8);
  g.addColorStop(0, '#15151c'); g.addColorStop(1, '#07070a'); b.fillStyle = g; b.fillRect(0, 0, bg.width, bg.height);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    b.fillStyle = `rgba(${BONE},${0.08 + rnd() * 0.22})`; const r = (0.5 + rnd() * 0.9) * DPR;
    b.fillRect(rnd() * bg.width, rnd() * bg.height, r, r);
  }
  hatch = makeHatch();
}
addEventListener('resize', resize); resize();
if (document.fonts && document.fonts.load) { ['800 20px Unbounded', '600 12px "Martian Mono"'].forEach((f) => document.fonts.load(f).catch(() => {})); }

function update(dt) {
  T += dt;
  const age = Math.min(0.1, (performance.now() - recvAt) / 1000);
  const live = snap && snap.ph !== 'count' && snap.ph !== 'over';
  for (const d of disp) {
    if (!d.seen) continue;
    const px = d.tx + (live && d.alive ? d.vx * age : 0), py = d.ty + (live && d.alive ? d.vy * age : 0);
    const k = 1 - Math.exp(-dt * 22);
    d.x += (px - d.x) * k; d.y += (py - d.y) * k;
    if (d.alive && live) { d.trail.push(d.x, d.y); if (d.trail.length > 46) d.trail.splice(0, 2); }
    else if (d.trail.length) d.trail.splice(0, 2);
  }
  if (!snap) idle.forEach((o, i) => { // attract-mode orbit behind the menu
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
  if (!snap) {
    ctx.save(); ctx.translate(IX, IY); ctx.scale(IS, IS);
    drawArena(C.R);
    idle.forEach((o, i) => { trailOf(o.trail, i); orbBody(o.x, o.y, i, 1); });
    ctx.restore();
    return;
  }
  const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.save(); ctx.translate(CX + sx, CY + sy); ctx.scale(S, S);
  drawArena(curRad);
  drawPickups();
  for (let i = 0; i < 2; i++) trailOf(disp[i].trail, i);
  for (let i = 0; i < 2; i++) drawOrb(i);
  drawParts(); drawTexts();
  ctx.restore();
}

function hatchBand(r0, r1, a) {
  if (r1 <= r0 || r1 <= 0 || !hatch) return;
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r1, 0, TAU); ctx.arc(0, 0, Math.max(0, r0), 0, TAU, true);
  ctx.globalAlpha = a; ctx.fillStyle = hatch; ctx.fill('evenodd'); ctx.restore();
}
function ring(r) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); }

function drawArena(rad) {
  const R = C.R, pulse = 0.5 + 0.5 * Math.sin(T * 3);
  // floor
  let g = ctx.createRadialGradient(0, 0, C.CORE, 0, 0, R);
  g.addColorStop(0, '#181821'); g.addColorStop(1, '#0d0d12');
  ctx.fillStyle = g; ring(rad); ctx.fill();
  // collapsed (already lethal) zone between the shrinking rim and the original one
  if (rad < R - 1) { ctx.fillStyle = `rgba(${BONE},.05)`; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.arc(0, 0, rad, 0, TAU, true); ctx.fill('evenodd'); hatchBand(rad, R, 0.2); }
  // polar grid: rings + 12 spokes
  ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${BONE},.1)`;
  for (const r of [100, 180, 260, 340]) if (r < rad - 70) { ring(r); ctx.stroke(); }
  ctx.strokeStyle = `rgba(${BONE},.07)`; ctx.beginPath();
  const r0 = C.CORE + C.ORB + 4;
  for (let a = 0; a < 12; a++) { const t = a * TAU / 12; ctx.moveTo(Math.cos(t) * r0, Math.sin(t) * r0); ctx.lineTo(Math.cos(t) * rad, Math.sin(t) * rad); }
  ctx.stroke();
  // gravity flow: dashes drifting inward on three rings
  ctx.lineWidth = 2;
  [140, 220, 300].forEach((r, i) => {
    if (r > rad - 80) return;
    ctx.setLineDash([1, 26 + i * 6]); ctx.lineDashOffset = T * (16 + i * 5); ctx.strokeStyle = `rgba(${BONE},.3)`; ring(r); ctx.stroke();
  });
  ctx.setLineDash([]);
  // lethal band at the rim (stepped hatch fade)
  hatchBand(rad - 22, rad, 0.55); hatchBand(rad - 42, rad - 22, 0.3); hatchBand(rad - 62, rad - 42, 0.13);
  ctx.save(); ctx.shadowColor = `rgba(${BONE},.9)`; ctx.shadowBlur = 8 + pulse * 10; ctx.strokeStyle = `rgb(${BONE})`; ctx.lineWidth = 2.5; ring(rad); ctx.stroke(); ctx.restore();
  // protractor ticks on the ORIGINAL rim (they stay while the live rim shrinks)
  const t1 = new Path2D(), t2 = new Path2D(), t3 = new Path2D();
  for (let d = 0; d < 360; d += 2) {
    const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), len = d % 30 === 0 ? 15 : d % 10 === 0 ? 9 : 4, p = d % 30 === 0 ? t3 : d % 10 === 0 ? t2 : t1;
    p.moveTo(c * (R + 8), s * (R + 8)); p.lineTo(c * (R + 8 + len), s * (R + 8 + len));
  }
  ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${BONE},.28)`; ctx.stroke(t1); ctx.strokeStyle = `rgba(${BONE},.5)`; ctx.stroke(t2);
  ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${BONE},.9)`; ctx.stroke(t3);
  ctx.font = `500 10px ${FONT_M}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = `rgba(${BONE},.55)`;
  for (let d = 0; d < 360; d += 30) { const a = d * Math.PI / 180; ctx.fillText(String(d).padStart(3, '0'), Math.cos(a) * (R + 32), Math.sin(a) * (R + 32)); }
  ctx.textBaseline = 'alphabetic';
  // black hole
  g = ctx.createRadialGradient(0, 0, C.CORE, 0, 0, C.CORE + 90);
  g.addColorStop(0, `rgba(${BONE},.26)`); g.addColorStop(1, `rgba(${BONE},0)`);
  ctx.fillStyle = g; ring(C.CORE + 90); ctx.fill();
  hatchBand(C.CORE, C.CORE + C.ORB, 0.5);
  ctx.fillStyle = '#000'; ring(C.CORE); ctx.fill();
  ctx.strokeStyle = `rgb(${BONE})`; ctx.lineWidth = 2.5; ring(C.CORE); ctx.stroke();
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
    if (gold) { ctx.fillStyle = `rgb(${BONE})`; ctx.shadowColor = `rgb(${BONE})`; ctx.shadowBlur = 16; ctx.fill(); }
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

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  update(dt); draw(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
refreshOnline();
connect();
})();
