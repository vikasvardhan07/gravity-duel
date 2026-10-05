'use strict';
// Shared by the server (authoritative) and the browser (client-side prediction).
// One source of truth for constants and movement so both sides compute identical trajectories.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GDPhys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    R: 420,          // arena radius (outer hazard ring)
    CORE: 40,        // black-hole radius (inner hazard)
    ORB: 18,         // orb radius
    A: 1080,         // gravity acceleration (push outward / pull inward)
    VMAX: 910,       // speed cap
    RDAMP: 0.35,     // damping on radial velocity only (tangential speed is conserved); low so a push swings you out and a release swings you back in past the middle ring
    MATCH: 90,       // seconds
    COUNT: 4,        // pre-match countdown (1s READY + 3,2,1)
    RESPAWN: 1.6,    // seconds out after dying
    INV: 1.5,        // spawn invulnerability
    PICK_R: 13,
    MAXPICK: 4,
    HIT_WINDOW: 2.5, // a death within this many seconds of being bumped credits a KO
    KO_BONUS: 2,
    START_D: 250,
    START_V: 494,
    SHRINK_T: 30,    // rim contracts during the last N seconds...
    R_MIN: 300,      // ...down to this radius
  };

  // Integrate one orb for dt seconds. `push` = 1 accelerates away from the well, 0 toward it.
  function advance(o, push, dt) {
    const d = Math.hypot(o.x, o.y) || 1e-6;
    const nx = o.x / d, ny = o.y / d;
    const a = push ? C.A : -C.A;
    o.vx += nx * a * dt; o.vy += ny * a * dt;
    const vr = o.vx * nx + o.vy * ny;
    const dv = vr * (1 - Math.exp(-C.RDAMP * dt));
    o.vx -= nx * dv; o.vy -= ny * dv;
    const sp = Math.hypot(o.vx, o.vy);
    if (sp > C.VMAX) { const k = C.VMAX / sp; o.vx *= k; o.vy *= k; }
    o.x += o.vx * dt; o.y += o.vy * dt;
  }

  return { C, advance };
});
