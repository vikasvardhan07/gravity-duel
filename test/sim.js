'use strict';
const { Game, botDecide } = require('../game');
const N = 200;
let agg = { score: 0, deaths: 0, ko: 0, pk: 0, ot: 0, draws: 0, secs: 0, w0: 0, hits: 0, stuck: 0 };
for (let m = 0; m < N; m++) {
  const g = new Game();
  let steps = 0, think = 0;
  while (g.phase !== 'over' && steps < 60 * 400) {
    if (think-- <= 0) { think = 5; g.setPush(0, botDecide(g, g.players[0], 0.9)); g.setPush(1, botDecide(g, g.players[1], 0.9)); }
    g.step(1 / 60); steps++;
    for (const e of g.events) if (e.k === 'hit') agg.hits++;
    g.events.length = 0;
  }
  if (g.phase !== 'over') agg.stuck++;
  if (g.reason === 'overtime') agg.ot++;
  agg.secs += steps / 60;
  agg.w0 += g.winner === 0 ? 1 : 0;
  for (const p of g.players) { agg.score += p.score; agg.deaths += p.deaths; agg.ko += p.ko; agg.pk += p.pk; }
}
const f = (v) => (v / N).toFixed(2);
console.log(`matches=${N} stuck=${agg.stuck}`);
console.log(`avg match secs=${f(agg.secs)}  overtime rate=${f(agg.ot)}  P0 winrate=${f(agg.w0)}`);
console.log(`per match: score(total both)=${f(agg.score)} pickups=${f(agg.pk)} deaths=${f(agg.deaths)} KOs=${f(agg.ko)} hits=${f(agg.hits)}`);
if (agg.stuck) { console.error('FAIL: matches did not terminate'); process.exit(1); }
