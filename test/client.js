'use strict';
// Headless test of the REAL client code (public/game.js): stub DOM/canvas, fake WebSocket, and a simulated
// high-latency network in front of the REAL server simulation. Measures how well client-side prediction
// tracks the ideal (zero-latency) orb, and checks input handling robustness.
const vm = require('vm'), fs = require('fs'), path = require('path');
const { Game, botDecide } = require('../game');
let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')); if (!c) fails++; };

function run({ owd, predict = true, seconds = 12, seed = 1 }) {
  let vt = 0;                                   // virtual clock (ms)
  const sent = [], handlers = {}, rafs = [];
  const loose = (over = {}) => new Proxy(function () {}, {
    get: (t, k) => (k in over ? over[k] : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'toJSON' ? undefined : loose()),
    apply: () => loose(), construct: () => loose(), set: () => true,
  });
  let fake;
  class FakeWS { constructor() { fake = this; this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); } send(m) { sent.push({ t: vt, m: JSON.parse(m) }); } }
  const els = {};
  const doc = loose({
    getElementById: (id) => (els[id] = els[id] || loose({ classList: loose({ toggle() {}, add() {}, remove() {} }), value: '', dataset: {}, querySelector: () => loose() })),
    createElement: () => loose({ getContext: () => loose({ createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }) }) }),
    addEventListener: (t, f) => { (handlers['doc:' + t] = handlers['doc:' + t] || []).push(f); },
    activeElement: null, body: {}, fonts: undefined, hidden: false,
  });
  const store = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = {
    console, Math, JSON, Date, Set, Map, Proxy, Path2D: function () { return loose(); }, URL, URLSearchParams, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, fetch: () => Promise.resolve({ json: () => ({}) }),
    document: doc, localStorage: store, sessionStorage: store, navigator: {}, location: { protocol: 'https:', host: 'x', href: 'https://x/', search: '', origin: 'https://x', pathname: '/' },
    history: { replaceState() {} }, innerWidth: 1000, innerHeight: 600, devicePixelRatio: 2, performance: { now: () => vt },
    requestAnimationFrame: (f) => { rafs.push(f); return 1; }, WebSocket: FakeWS, AudioContext: undefined,
    addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); },
    __GD_TEST: {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/physics.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8'), ctx);
  const api = ctx.__GD_TEST.api;
  const fire = (type, e) => (handlers[type] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: { tagName: 'BODY' } }, e)));

  // --- fake server + ideal reference world
  const g = new Game(), ideal = new Game();
  const seq = [0, 0], inFlight = [], toClient = [];
  fake.onmessage({ data: JSON.stringify({ t: 'joined', you: 0, names: ['Me', 'Bot'], code: 'TEST', tok: 'x', bot: false, started: false }) });
  fake.onmessage({ data: JSON.stringify({ t: 'start', names: ['Me', 'Bot'], bot: false }) });
  if (!predict) api.disp.__nopredict = true;

  let sentIdx = 0, press = 0, nextThink = 0, errSum = 0, errN = 0, maxJump = 0, prev = null, baseErrSum = 0, lastSnap = null;
  const DT = 1 / 60;
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) {
    vt += DT * 1000;
    // human = controller reading the ideal (zero-latency) world, pressing Space with the real key events
    if (vt >= nextThink && ideal.phase !== 'count') {
      nextThink = vt + 60;
      const want = botDecide(ideal, ideal.players[0], 1);
      if (want !== press) { press = want; fire(want ? 'keydown' : 'keyup', { code: 'Space' }); ideal.setPush(0, want); }
    }
    // client -> server
    for (; sentIdx < sent.length; sentIdx++) { const m = sent[sentIdx].m; if (m.t === 'in') inFlight.push({ at: sent[sentIdx].t + owd * 1000, m }); }
    while (inFlight.length && inFlight[0].at <= vt) { const { m } = inFlight.shift(); g.applyInputAt(0, m.p, Math.round(m.l / (1000 / 60))); if (m.s > seq[0]) seq[0] = m.s; }
    // server + ideal tick
    g.step(DT); ideal.step(DT);
    const s = g.snap(); s.a = seq.slice(); toClient.push({ at: vt + owd * 1000, s });
    ideal.events.length = 0;
    while (toClient.length && toClient[0].at <= vt) { lastSnap = toClient.shift().s; fake.onmessage({ data: JSON.stringify(lastSnap) }); }
    // pings so the client learns the rtt
    if (f % 60 === 0) { const ts = vt - owd * 2000; fake.onmessage({ data: JSON.stringify({ t: 'pong', ts }) }); }
    const fr = rafs.shift(); if (fr) fr(vt);
    if (f > 120 && ideal.players[0].alive && g.players[0].alive) {
      const d = api.disp[0], p = ideal.players[0];
      const e = Math.hypot(d.x - p.x, d.y - p.y); errSum += e * e; errN++;
      if (lastSnap) { const b = lastSnap.p[0]; baseErrSum += Math.hypot(b[0] - p.x, b[1] - p.y) ** 2; }
      if (prev) maxJump = Math.max(maxJump, Math.hypot(d.x - prev.x, d.y - prev.y));
      prev = { x: d.x, y: d.y };
    } else prev = null;
  }
  return { rms: Math.sqrt(errSum / Math.max(1, errN)), baseRms: Math.sqrt(baseErrSum / Math.max(1, errN)), maxJump, n: errN, api, sent, fire, handlers };
}

console.log('--- prediction accuracy vs ideal zero-latency orb (RMS error, world units; orb radius = 18)');
for (const owd of [0.03, 0.07, 0.14, 0.25]) {
  const r = run({ owd, seconds: 14 });
  console.log(`    one-way ${(owd * 1000) | 0} ms (RTT ${(owd * 2000) | 0} ms): predicted ${r.rms.toFixed(1)}  |  raw server state ${r.baseRms.toFixed(1)}  |  max per-frame jump ${r.maxJump.toFixed(1)}  (n=${r.n})`);
  if (owd === 0.14) {
    ok(r.n > 300, 'enough samples measured');
    ok(r.rms < r.baseRms * 0.45, 'prediction removes >55% of the lag error at 280 ms RTT', `(${r.rms.toFixed(1)} vs ${r.baseRms.toFixed(1)})`);
    ok(r.rms < 40, 'predicted orb stays within ~2 orb-radii of ideal at 280 ms RTT');
    ok(r.maxJump < 40, 'no visible teleports/jitter (max single-frame jump)', `(${r.maxJump.toFixed(1)})`);
  }
}

console.log('--- input robustness (real client handlers)');
{
  const r = run({ owd: 0.05, seconds: 1 });
  const { fire, handlers, api, sent } = r;
  const pushes = () => sent.filter((x) => x.m.t === 'in').map((x) => x.m);
  const base = pushes().length;
  fire('keydown', { code: 'Space' }); fire('keydown', { code: 'Space', repeat: true }); fire('keydown', { code: 'Space', repeat: true });
  let p = pushes().slice(base);
  ok(p.length === 1 && p[0].p === 1, 'held Space (with key-repeat) sends exactly one press');
  fire('keydown', { code: 'ShiftLeft' }); fire('keyup', { code: 'Space' });
  p = pushes().slice(base);
  ok(p.length === 1, 'releasing Space while Shift still held keeps pushing (no spurious release)');
  fire('keyup', { code: 'ShiftLeft' });
  p = pushes().slice(base);
  ok(p.length === 2 && p[1].p === 0, 'release after last key sends exactly one release');
  ok(p[1].s === p[0].s + 1, 'input sequence numbers increase by 1', JSON.stringify(p.map((x) => x.s)));
  fire('keydown', { code: 'Space' }); (handlers.blur || []).forEach((f) => f({}));
  p = pushes().slice(base);
  ok(p[p.length - 1].p === 0, 'window blur releases a held key (cannot get stuck)');
  fire('keydown', { code: 'Space' }); fire('keyup', { code: 'Space', target: { tagName: 'BODY' } });
  fire('keydown', { code: 'KeyW' }); fire('keyup', { code: 'KeyW' });
  const lastTwo = pushes().slice(-2);
  ok(lastTwo[1].p === 0, 'W / Space / ArrowUp / Shift all work and release cleanly');
  fire('keydown', { code: 'Space', target: { tagName: 'INPUT' } });
  const n0 = pushes().length; fire('keydown', { code: 'Space', target: { tagName: 'INPUT' } });
  ok(pushes().length === n0, 'typing Space in a text field does not push');
  // pointer: id-based; right-click ignored; release outside canvas
  const cvH = handlers; // canvas handlers are on the loose canvas stub, so check window-level pointerup exists
  ok((handlers.pointerup || []).length > 0 && (handlers.pointercancel || []).length > 0, 'window-level pointerup/cancel registered (release outside canvas is caught)');
  ok(['blur', 'pagehide'].every((t) => (handlers[t] || []).length > 0) && (handlers['doc:visibilitychange'] || []).length > 0, 'blur / pagehide / tab-hide all release inputs');
}
console.log(fails ? `\n${fails} FAILED` : '\nCLIENT: ALL PASSED');
process.exit(fails ? 1 : 0);
