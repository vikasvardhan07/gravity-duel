'use strict';
// Gravity Duel — authoritative game simulation (server side, no I/O).
// One input per player: `push` (hold = accelerate away from the well, release = fall toward it).
// Tangential speed is NOT damped, so angular momentum is conserved: moving inward speeds you up,
// moving outward slows you down. Collisions are the only way to change your angular momentum.

const C = {
  R: 420,          // arena radius (outer hazard ring)
  CORE: 40,        // black-hole radius (inner hazard)
  ORB: 18,         // orb radius
  A: 640,          // gravity acceleration (push or pull)
  VMAX: 700,       // speed cap
  RDAMP: 0.9,      // damping applied to radial velocity only
  MATCH: 90,       // seconds
  COUNT: 4,        // pre-match countdown (1s READY + 3,2,1)
  RESPAWN: 2,      // seconds out after dying
  INV: 1.6,        // spawn invulnerability
  PICK_R: 13,
  MAXPICK: 3,
  HIT_WINDOW: 2.5, // a death within this many seconds of being bumped credits a KO
  KO_BONUS: 2,
  START_D: 250,
  START_V: 380,
  SHRINK_T: 30,    // arena contracts during the last N seconds...
  R_MIN: 300,      // ...down to this radius
};
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

class Game {
  constructor() {
    this.phase = 'count'; // count | play | overtime | over
    this.timer = C.COUNT;
    this.time = C.MATCH;
    this.t = 0;
    this.nextId = 1;
    this.pickups = [];
    this.spawnT = 1.2;
    this.events = [];
    this.winner = -1;
    this.reason = '';
    this.players = [0, 1].map((i) => this.mkPlayer(i));
    this.addPickup(Math.PI / 2, 250, 0);
    this.addPickup(-Math.PI / 2, 250, 0);
  }

  mkPlayer(i) {
    const a = i === 0 ? 0 : Math.PI;
    return {
      i, x: Math.cos(a) * C.START_D, y: Math.sin(a) * C.START_D,
      vx: -Math.sin(a) * C.START_V, vy: Math.cos(a) * C.START_V,
      push: 0, alive: true, respT: 0, inv: 0,
      score: 0, pk: 0, ko: 0, deaths: 0, hitBy: -1, hitT: -99,
    };
  }

  addPickup(a, d, type) {
    this.pickups.push({ id: this.nextId++, x: Math.cos(a) * d, y: Math.sin(a) * d, type, ttl: type ? 6 : 9 });
  }

  // current outer-ring radius (shrinks in the final SHRINK_T seconds, stays small in overtime)
  rad() {
    if (this.phase === 'count') return C.R;
    if (this.phase === 'overtime') return C.R_MIN;
    const f = Math.min(1, Math.max(0, 1 - this.time / C.SHRINK_T));
    return C.R - (C.R - C.R_MIN) * f;
  }

  setPush(i, v) { if (this.players[i]) this.players[i].push = v ? 1 : 0; }

  addScore(p, n) {
    p.score += n;
    if (this.phase === 'overtime') this.finish(p.i, 'overtime');
  }

  finish(w, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = w;
    this.reason = reason || 'time';
    this.events.push({ k: 'end', w });
  }

  kill(p) {
    p.alive = false;
    p.respT = C.RESPAWN;
    p.deaths++;
    this.events.push({ k: 'die', i: p.i, x: r1(p.x), y: r1(p.y) });
    if (p.hitBy >= 0 && this.t - p.hitT <= C.HIT_WINDOW) {
      const o = this.players[p.hitBy];
      o.ko++;
      this.events.push({ k: 'ko', i: o.i, x: r1(p.x), y: r1(p.y) });
      this.addScore(o, C.KO_BONUS);
    }
    p.hitBy = -1;
  }

  respawn(p) {
    const o = this.players[1 - p.i];
    const a = o.alive ? Math.atan2(o.y, o.x) + Math.PI : rnd(0, TAU);
    p.x = Math.cos(a) * C.START_D; p.y = Math.sin(a) * C.START_D;
    p.vx = -Math.sin(a) * C.START_V; p.vy = Math.cos(a) * C.START_V;
    p.alive = true; p.inv = C.INV; p.hitBy = -1;
    this.events.push({ k: 'spawn', i: p.i, x: r1(p.x), y: r1(p.y) });
  }

  move(p, dt) {
    if (!p.alive) { p.respT -= dt; if (p.respT <= 0) this.respawn(p); return; }
    if (p.inv > 0) p.inv -= dt;
    let d = Math.hypot(p.x, p.y) || 1e-6;
    let nx = p.x / d, ny = p.y / d;
    const a = p.push ? C.A : -C.A;
    p.vx += nx * a * dt; p.vy += ny * a * dt;
    const vr = p.vx * nx + p.vy * ny;
    const dv = vr * (1 - Math.exp(-C.RDAMP * dt));
    p.vx -= nx * dv; p.vy -= ny * dv;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > C.VMAX) { const k = C.VMAX / sp; p.vx *= k; p.vy *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    d = Math.hypot(p.x, p.y) || 1e-6;
    const inner = C.CORE + C.ORB, outer = this.rad() - C.ORB;
    if (d < inner || d > outer) {
      if (p.inv > 0) { // spawn shield: bounce off hazards instead of dying
        nx = p.x / d; ny = p.y / d;
        const dd = d < inner ? inner : outer;
        p.x = nx * dd; p.y = ny * dd;
        const vr2 = p.vx * nx + p.vy * ny;
        if ((d < inner && vr2 < 0) || (d > outer && vr2 > 0)) { p.vx -= 1.6 * vr2 * nx; p.vy -= 1.6 * vr2 * ny; }
      } else this.kill(p);
    }
  }

  collide() {
    const [a, b] = this.players;
    if (!a.alive || !b.alive) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    if (dist >= C.ORB * 2) return;
    dx /= dist; dy /= dist;
    const ov = C.ORB * 2 - dist;
    a.x -= dx * ov / 2; a.y -= dy * ov / 2; b.x += dx * ov / 2; b.y += dy * ov / 2;
    const rv = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy; // >0 means approaching
    if (rv > 0) {
      const j = (1 + 1.15) * rv / 2;
      a.vx -= j * dx; a.vy -= j * dy; b.vx += j * dx; b.vy += j * dy;
      a.hitBy = 1; b.hitBy = 0; a.hitT = b.hitT = this.t;
      this.events.push({ k: 'hit', x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2), s: Math.round(rv) });
    }
  }

  collect() {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (let n = this.pickups.length - 1; n >= 0; n--) {
        const k = this.pickups[n];
        if (Math.hypot(k.x - p.x, k.y - p.y) < C.ORB + C.PICK_R) {
          this.pickups.splice(n, 1);
          const v = k.type ? 3 : 1;
          p.pk++;
          this.events.push({ k: 'pick', i: p.i, x: r1(k.x), y: r1(k.y), v });
          this.addScore(p, v);
        }
      }
    }
  }

  spawn(dt) {
    const lim = this.rad() - C.ORB - 10;
    for (let n = this.pickups.length - 1; n >= 0; n--) {
      const k = this.pickups[n];
      k.ttl -= dt;
      if (k.ttl <= 0 || Math.hypot(k.x, k.y) > lim) this.pickups.splice(n, 1);
    }
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.pickups.length >= C.MAXPICK) return;
    this.spawnT = rnd(0.9, 1.6);
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd(0, TAU), d = rnd(C.CORE + C.ORB + 40, this.rad() - C.ORB - 40);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (this.players.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < 90)) continue;
      this.addPickup(a, d, Math.random() < 0.2 ? 1 : 0);
      return;
    }
  }

  step(dt) {
    this.t += dt;
    if (this.phase === 'over') return;
    if (this.phase === 'count') {
      this.timer -= dt;
      if (this.timer <= 0) { this.phase = 'play'; this.timer = 0; this.events.push({ k: 'go' }); }
      return;
    }
    if (this.phase === 'play') this.time = Math.max(0, this.time - dt);
    for (const p of this.players) this.move(p, dt);
    this.collide();
    this.collect();
    this.spawn(dt);
    if (this.phase === 'play' && this.time <= 0) {
      const [a, b] = this.players;
      if (a.score !== b.score) this.finish(a.score > b.score ? 0 : 1, 'time');
      else { this.phase = 'overtime'; this.events.push({ k: 'ot' }); }
    }
  }

  snap() {
    const ev = this.events; this.events = [];
    return {
      t: 's', ph: this.phase, tm: r2(this.time), cd: r2(this.timer), w: this.winner,
      p: this.players.map((p) => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.alive ? 1 : 0,
        r2(Math.max(0, p.inv)), p.score, p.push, r2(Math.max(0, p.respT))]),
      k: this.pickups.map((k) => [k.id, r1(k.x), r1(k.y), k.type, r1(k.ttl)]),
      e: ev,
    };
  }

  stats() {
    return {
      w: this.winner, reason: this.reason,
      s: this.players.map((p) => ({ score: p.score, pk: p.pk, ko: p.ko, deaths: p.deaths })),
    };
  }
}

// ---- Practice bot -----------------------------------------------------------------------------
// Bang-bang radial controller: pick the pickup it will reach soonest (angular momentum is fixed,
// so it can only choose WHEN to be at which radius), then steer radius toward it. Avoids hazards.
function botDecide(g, p, level = 0.85) {
  if (!p.alive) return 0;
  const d = Math.hypot(p.x, p.y) || 1;
  const nx = p.x / d, ny = p.y / d;
  const vr = p.vx * nx + p.vy * ny;
  const w = (p.x * p.vy - p.y * p.vx) / (d * d); // angular velocity
  const th = Math.atan2(p.y, p.x);
  let tr = 230, best = 1e9;
  for (const k of g.pickups) {
    const ph = Math.atan2(k.y, k.x);
    let dth = (ph - th) * Math.sign(w || 1);
    dth = ((dth % TAU) + TAU) % TAU;
    const tt = dth / Math.max(Math.abs(w), 0.2) - (k.type ? 0.8 : 0);
    if (tt < best && tt < k.ttl) { best = tt; tr = Math.hypot(k.x, k.y); }
  }
  const lo = C.CORE + C.ORB + 60, hi = g.rad() - C.ORB - 60;
  tr = Math.min(hi, Math.max(lo, tr));
  const want = Math.max(-260, Math.min(260, (tr - d) * 2.4));
  let push = vr < want ? 1 : 0;
  if (d < lo - 5 && vr < 90) push = 1;       // too close to the black hole
  if (d > hi + 5 && vr > -90) push = 0;      // too close to the edge
  if (Math.random() > level) push = 1 - push; // human-ish mistakes
  return push;
}

module.exports = { Game, C, botDecide };
