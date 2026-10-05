'use strict';
// Plays the REAL training flow in the real client code with a scripted pilot.
const { boot } = require('./harness');
const { botDecide } = require('../game');
let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')); if (!c) fails++; };
const actions = (B) => B.sent.map((s) => s.m).filter((m) => m.t !== 'in' && m.t !== 'ping');

// ---- 1. first-time player: every route into a match is gated behind the training
for (const [btn, expect] of [['bQuick', 'quick'], ['bCreate', 'create'], ['bBot', 'bot']]) {
  const B = boot();
  B.click(btn);
  ok(!!B.api.tut, `${btn}: training starts instead of the match`);
  ok(!actions(B).some((m) => m.t === expect), `${btn}: no network action before training is finished`);
}

// ---- 2. full run through all four steps with a scripted pilot
{
  const B = boot();
  B.frame(); B.click('bBot');
  const steps = []; let press = 0, last = -1, hazards = 0, t = 0;
  const pilot = () => {
    const tut = B.api.tut; if (!tut) return;
    const st = tut.step, sh = B.api.pickupsRef()[0], o = tut.o;
    let want;
    if (st === 0) want = 1;                                         // hold until the outer ring
    else if (st === 1) want = 0;                                    // release until inside the inner ring
    else want = botDecide({ pickups: sh ? [{ x: sh.x, y: sh.y, type: sh.type, ttl: 9 }] : [], rad: () => 420 }, { alive: true, x: o.x, y: o.y, vx: o.vx, vy: o.vy }, 1);
    if (want !== press) { press = want; B.fire(want ? 'keydown' : 'keyup', { code: 'Space' }); }
  };
  while (t < 90 * 60 && !(B.api.tut && B.api.tut.done)) {
    if (t % 4 === 0) pilot();
    B.frame(); t++;
    const s = B.api.tut && B.api.tut.step; if (s !== last) { steps.push(s); last = s; }
  }
  ok(B.api.tut && B.api.tut.done, 'scripted pilot completes the training', `(${(t / 60).toFixed(1)} s virtual, steps seen ${JSON.stringify(steps)})`);
  ok(steps.join() === '0,1,2,3', 'steps run in order: hold → release → shard → gold shard');
  ok(B.store.get('gd_tut') === '1', 'completion is remembered (shown once)');
  ok(!actions(B).some((m) => m.t === 'bot'), 'match action still NOT sent while the "Demo complete" card is up');
  B.click('bTutGo');
  ok(actions(B).some((m) => m.t === 'bot'), '"Demo complete → Start" then sends the chosen action (bot match)');
  ok(!B.api.tut, 'training state cleared after continuing');

  // returning player skips straight to the match
  const B2 = boot({ storage: { gd_tut: '1' } }); B2.click('bQuick');
  ok(!B2.api.tut && actions(B2).some((m) => m.t === 'quick'), 'returning player: no training, goes straight to matchmaking');
}

// ---- 3. skip button + hazard reset + replay from menu
{
  const B = boot(); B.click('bQuick');
  B.els.tutSkip.onclick();
  ok(B.store.get('gd_tut') === '1' && actions(B).some((m) => m.t === 'quick'), 'Skip marks training done and continues to the chosen action');

  const C = boot({ storage: { gd_tut: '1' } }); C.click('bTut');
  ok(!!C.api.tut && !actions(C).length, '"How to play" replays the demo for returning players (no match started)');
  // hold forever → orb must hit the rim → reset, never stuck outside
  C.fire('keydown', { code: 'Space' });
  let maxD = 0, resets = 0, prevHaz = C.api.tut.hazardT;
  for (let i = 0; i < 60 * 8; i++) { C.frame(); const o = C.api.tut.o; maxD = Math.max(maxD, Math.hypot(o.x, o.y)); if (C.api.tut.hazardT !== prevHaz) { resets++; prevHaz = C.api.tut.hazardT; } }
  ok(resets >= 1, 'touching the edge triggers a knock-out + reset (teaches the hazard)', `(${resets} resets in 8 s of holding)`);
  ok(maxD < 440, 'orb never escapes the arena', `(max radius ${maxD.toFixed(0)})`);
}
console.log(fails ? `\n${fails} FAILED` : '\nTUTORIAL: ALL PASSED');
process.exit(fails ? 1 : 0);
