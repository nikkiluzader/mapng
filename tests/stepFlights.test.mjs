import test from 'node:test';
import assert from 'node:assert/strict';
import { planStepFlights, buildStepFlightMeshes, RISE_MAX_M } from '../services/stepFlights.js';

const slope = (x, y) => 0.12 * y;   // a 12 % hillside rising north
const flight = () => planStepFlights([{ nodes: [[0, 0], [0, 20]], width: 2 }], slope);

test('a flight up a slope: level treads on or over the ground, risers of at most 17 cm, buried', () => {
  const [f] = flight();
  // (the ground smoothed over 2 m: each end pulled in by up to 6 cm on this slope)
  assert.ok(Math.abs(f.rise - 2.4) < 0.15);
  for (let i = 0; i < f.treads.length; i++) {
    const t = f.treads[i];
    for (const p of t.pts) assert.ok(t.top >= slope(p.x, p.y) - 0.15, `tread ${i} under the ground`);
    assert.ok(t.bottom < Math.min(...t.pts.map((p) => slope(p.x, p.y))), `tread ${i} not buried`);
    if (i) assert.ok(Math.abs(t.top - f.treads[i - 1].top) <= RISE_MAX_M + 1e-6, `riser ${i}`);
  }
});

test('every face of a flight looks outward (the game draws one side only)', () => {
  const { meshes } = buildStepFlightMeshes(flight());
  for (const m of meshes) {
    const pos = m.geometry.attributes.position.array;
    for (let k = 0; k < pos.length; k += 9) {
      const a = [pos[k], pos[k + 1], pos[k + 2]]; const b = [pos[k + 3], pos[k + 4], pos[k + 5]]; const c = [pos[k + 6], pos[k + 7], pos[k + 8]];
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const cx = (a[0] + b[0] + c[0]) / 3;
      if (m.name === 'steps_top') assert.ok(n[2] > 0, 'a tread facing down');
      // sides: the left side (x < 0) faces -x, the right +x; risers face along y
      else if (Math.abs(n[0]) > Math.abs(n[1])) assert.ok(Math.sign(n[0]) === Math.sign(cx), `a side facing in at x ${cx.toFixed(2)}`);
    }
  }
});

test('a flight on flat ground is a raised paved strip', () => {
  const [f] = planStepFlights([{ nodes: [[0, 0], [10, 0]], width: 1.5 }], () => 4);
  assert.ok(f.flat);
  assert.equal(f.treads.length, 1);
  assert.ok(f.treads[0].top > 4 && f.treads[0].bottom < 4);
});
