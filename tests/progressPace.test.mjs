import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressPace } from '../services/progressPace.js';

// Replay a run: stages [key, weight, actual seconds] (weight 0 or actual null: not run), sampled every 0.2 s.
// Returns the overall share over time and the share when the last stage ends.
const replay = (stages) => {
  let clock = 0;
  const pace = createProgressPace({ now: () => clock * 1000 });
  const fine = stages.map(([k, w]) => [k, w]);
  const out = [];
  for (const [k, , secs] of stages) {
    if (secs == null) continue;
    for (let t = 0; t < secs; t += 0.2) { clock += Math.min(0.2, secs - t); out.push({ t: clock, v: pace.update({ fine, activeStage: k }).overall }); }
  }
  return { out, last: out[out.length - 1].v };
};
const maxJump = (out) => out.reduce((m, s, i) => (i ? Math.max(m, s.v - out[i - 1].v) : m), 0);

test('stages on time: the bar follows the weights and never goes backwards', () => {
  const { out, last } = replay([['a', 1, 1], ['b', 3, 3], ['c', 2, 2], ['d', 4, 4]]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].v >= out[i - 1].v);
  // halfway through the time, about halfway along
  const mid = out.find((s) => s.t >= 5).v;
  assert.ok(Math.abs(mid - 0.5) < 0.12, `mid ${mid}`);
  assert.ok(last > 0.85, `last ${last}`);
});

test('a weighted stage that never runs leaves no jump', () => {
  const { out } = replay([['a', 2, 2], ['skip', 3, null], ['b', 2, 2], ['c', 2, 2]]);
  assert.ok(maxJump(out) < 0.06, `jump ${maxJump(out)}`);
});

// The recorded Generate at 1024 (Mapterhorn lidar, Chicago, 2026-11-19): OSM's mirrors busy for 25 s against a 2 s
// weight, the ground filter weighted and skipped; by weights the bar sat at 56 % and ran to 100 in a second.
test('a slow download, then a fast rest: the bar ends near the end, with no big jump', () => {
  const { out, last } = replay([['prepare', 0.3, 0.1], ['source', 1.19, 0.4], ['tiles', 1.13, 2.6], ['repair', 0.3, 0.2], ['resample', 0.64, 0.5],
    ['osm', 2.02, 25.4], ['landcover', 1.01, 0.2], ['ground', 1.6, null], ['roads', 0.35, 0.3], ['finalize', 0.36, 0.3], ['textures', 0.88, 0.6]]);
  assert.ok(last > 0.85, `last ${last}`);
  assert.ok(maxJump(out) < 0.08, `jump ${maxJump(out)}`);
  // a long wait neither holds the bar still nor pegs it at the end
  const during = out.filter((s) => s.t > 10 && s.t < 30).map((s) => s.v);
  assert.ok(during[during.length - 1] - during[0] > 0.1 && during[during.length - 1] < 0.9, `${during[0]} .. ${during[during.length - 1]}`);
});

test('reported progress moves the stage share on; finished is 1', () => {
  let clock = 0; const pace = createProgressPace({ now: () => clock });
  const fine = [['a', 1], ['b', 1]];
  assert.equal(pace.update({ fine, activeStage: 'a', activeFraction: 0.6 }).stageShare, 0.6);
  clock = 100; assert.ok(pace.update({ fine, activeStage: 'a', activeFraction: 0.2 }).stageShare >= 0.6);
  assert.equal(pace.update({ fine, activeStage: 'b', finished: true }).overall, 1);
});
