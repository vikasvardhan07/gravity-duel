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
    VR: 230,         // steady radial speed while holding (out) / released (in)
    TAU_R: 0.13,     // how quickly radial speed eases to +/-VR (s)
    TAU_T: 0.3,      // how quickly orbital speed eases to its radius-dependent target (s)
    VT_MAX: 800,
    VMAX: 910,       // speed cap
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

  // Integrate one orb for dt seconds. `push` = 1 climbs away from the well, 0 sinks toward it.
  // Radial speed eases to +/-VR (steady, predictable climb/sink); orbital speed eases to VT(r) (closer = faster).
  function advance(o, push, dt) {
    const d = Math.max(Math.hypot(o.x, o.y), 1e-6);
    const nx = o.x / d, ny = o.y / d;
    let vr = o.vx * nx + o.vy * ny;
    const tx = -ny, ty = nx;
    let vt = o.vx * tx + o.vy * ty;
    const dir = vt < 0 ? -1 : 1;
    vr += ((push ? C.VR : -C.VR) - vr) * (1 - Math.exp(-dt / C.TAU_R));
    const want = Math.min(C.VT_MAX, C.START_V * Math.sqrt(C.START_D / Math.max(d, C.CORE)));
    vt = dir * (Math.abs(vt) + (want - Math.abs(vt)) * (1 - Math.exp(-dt / C.TAU_T)));
    o.vx = nx * vr + tx * vt; o.vy = ny * vr + ty * vt;
    // integrate in polar coordinates so orbits stay circular-ish (no centrifugal drift), then rebuild the cartesian state
    const nr = Math.max(d + vr * dt, 1e-3);
    const th = Math.atan2(o.y, o.x) + (vt / d) * dt;
    const cx = Math.cos(th), cy = Math.sin(th);
    o.x = cx * nr; o.y = cy * nr;
    o.vx = cx * vr - cy * vt; o.vy = cy * vr + cx * vt;
  }

  return { C, advance };
});
