'use strict';
// Runs the REAL browser code (public/physics.js + public/game.js) in a vm with a stub DOM, fake WebSocket and virtual clock.
const vm = require('vm'), fs = require('fs'), path = require('path');
function boot({ storage = {} } = {}) {
  const B = { vt: 0, sent: [], handlers: {}, rafs: [], els: {}, store: new Map(Object.entries(storage)), ws: null };
  const loose = (over = {}) => {
    const t = Object.assign(function () {}, over);
    return new Proxy(t, {
      get: (t, k) => (k in t && k !== 'name' && k !== 'length' ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === 'toJSON' ? undefined : loose()),
      apply: () => loose(), construct: () => loose(), set: (t, k, v) => { t[k] = v; return true },
    });
  };
  class FakeWS { constructor() { B.ws = this; this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); } send(m) { B.sent.push({ t: B.vt, m: JSON.parse(m) }); } }
  const doc = loose({
    getElementById: (id) => (B.els[id] = B.els[id] || loose({ classList: loose({ toggle() {}, add() {}, remove() {} }), value: '', dataset: {}, querySelector: () => loose() })),
    createElement: () => loose({ getContext: () => loose({ createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }) }) }),
    addEventListener: (t, f) => { (B.handlers['doc:' + t] = B.handlers['doc:' + t] || []).push(f); },
    activeElement: null, body: {}, fonts: undefined, hidden: false,
  });
  const ls = { getItem: (k) => (B.store.has(k) ? B.store.get(k) : null), setItem: (k, v) => B.store.set(k, String(v)), removeItem: (k) => B.store.delete(k) };
  const ctx = {
    console, Math, JSON, Date, Set, Map, Proxy, Path2D: function () { return loose(); }, URL, URLSearchParams, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, fetch: () => Promise.resolve({ json: () => ({}) }),
    document: doc, localStorage: ls, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {},
    location: { protocol: 'https:', host: 'x', href: 'https://x/', search: '', origin: 'https://x', pathname: '/' },
    history: { replaceState() {} }, innerWidth: 1000, innerHeight: 600, devicePixelRatio: 2, performance: { now: () => B.vt },
    requestAnimationFrame: (f) => { B.rafs.push(f); return 1; }, WebSocket: FakeWS, AudioContext: undefined,
    addEventListener: (t, f) => { (B.handlers[t] = B.handlers[t] || []).push(f); },
    __GD_TEST: {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/physics.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8'), ctx);
  B.api = ctx.__GD_TEST.api;
  B.fire = (type, e) => (B.handlers[type] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: { tagName: 'BODY' } }, e)));
  B.frame = (ms = 1000 / 60) => { B.vt += ms; const f = B.rafs.shift(); if (f) f(B.vt); };
  B.click = (id) => B.els[id].onclick();
  B.msg = (o) => B.ws.onmessage({ data: JSON.stringify(o) });
  return B;
}
module.exports = { boot };
