import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTwinCarriageways } from '../services/twinCarriageways.js';
import { estimateRoadCrossSection } from '../services/roadWidth.js';

const M = 111320;
// a one-way line along +x (east) at y metres north, length L m
const way = (id, y, tags, L = 400, rev = false) => {
  const pts = [0, L].map((x) => ({ lat: 40 + y / M, lng: -100 + x / (M * Math.cos((40 * Math.PI) / 180)) }));
  return { id, type: 'road', tags: { oneway: 'yes', ...tags }, geometry: rev ? pts.reverse() : pts };
};

test('twin carriageways closer than their widths: capped to meet between them', () => {
  const tags = { highway: 'motorway', lanes: '3' };
  const { features, fitted } = fitTwinCarriageways([way('a', 0, tags), way('b', 11, tags, 400, true)]);
  assert.equal(fitted.length, 2);
  const w = features.map((f) => parseFloat(f.tags['mapng:carriageway_max']));
  for (const x of w) assert.ok(x <= 11 - 0.2 + 0.01 && x >= 9, `width ${x}`);
  // the drawn carriageways no longer overlap
  const halfs = features.map((f) => estimateRoadCrossSection(f.tags, f.tags.highway, true, { urban: false }).carriagewayHalfWidth);
  assert.ok(halfs[0] + halfs[1] <= 11 + 0.01, `${halfs.map((h) => h.toFixed(2))} overlap`);
});

test('twin carriageways: lanes keep 3 m; apart already, a two-way road, or a tagged width: untouched', () => {
  const tags = { highway: 'motorway', lanes: '3' };
  const tight = fitTwinCarriageways([way('a', 0, tags), way('b', 6, tags, 400, true)]);
  for (const f of tight.features) assert.ok(parseFloat(f.tags['mapng:carriageway_max']) >= 9);
  assert.equal(fitTwinCarriageways([way('a', 0, tags), way('b', 30, tags, 400, true)]).fitted.length, 0);
  assert.equal(fitTwinCarriageways([way('a', 0, { ...tags, width: '14' }), way('b', 11, { ...tags, width: '14' }, 400, true)]).fitted.length, 0);
  assert.equal(fitTwinCarriageways([way('a', 0, { highway: 'primary', oneway: 'no' }), way('b', 8, { highway: 'primary', oneway: 'no' })]).fitted.length, 0);
});

test('a short overlap (a fork\'s branches) is left alone', () => {
  const tags = { highway: 'motorway', lanes: '2' };
  // b runs beside a for 60 m of a's 400 m
  const { fitted } = fitTwinCarriageways([way('a', 0, tags), way('b', 9, tags, 60)]);
  assert.equal(fitted.filter((f) => f.id === 'a').length, 0);
});

test('the cap never widens a road (an urban default narrower than it)', () => {
  const t = { highway: 'secondary', oneway: 'yes', 'mapng:carriageway_max': '30' };
  const a = estimateRoadCrossSection(t, 'secondary', true, { urban: true }).carriagewayHalfWidth;
  const b = estimateRoadCrossSection({ highway: 'secondary', oneway: 'yes' }, 'secondary', true, { urban: true }).carriagewayHalfWidth;
  assert.equal(a, b);
});
