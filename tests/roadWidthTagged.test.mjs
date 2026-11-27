import test from 'node:test';
import assert from 'node:assert/strict';

test('a tagged width is kept down to 2.5 m on every class; the class minimum is for estimated widths only', async () => {
  // (thecoachtoma, Discord 2026-11-27: a one-lane residential street tagged width=2.8 came out 4.4 m)
  const { estimateRoadCrossSection, estimateRoadHalfWidth } = await import('../services/roadWidth.js');
  const w = (tags) => 2 * estimateRoadCrossSection(tags, tags.highway, false, 3.5).carriagewayHalfWidth;
  assert.ok(Math.abs(w({ highway: 'residential', lanes: '1', width: '2.8' }) - 2.8) < 1e-9);
  assert.ok(Math.abs(w({ highway: 'service', width: '2.8' }) - 2.8) < 1e-9);
  assert.ok(Math.abs(w({ highway: 'primary', width: '4' }) - 4) < 1e-9);
  assert.ok(Math.abs(w({ highway: 'residential', width: '1.2' }) - 2.5) < 1e-9, 'never under 2.5 m');
  assert.ok(Math.abs(2 * estimateRoadHalfWidth({ width: '2.8' }, 'residential') - 2.8) < 1e-9);
  // (untagged, the class's own minimum still holds)
  assert.ok(w({ highway: 'residential' }) >= 4.4);
});
