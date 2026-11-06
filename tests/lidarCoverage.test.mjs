import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadLidarCoverage, isCoveredAt } from '../services/lidarCoverageLayer.js';

const file = new URL('../public/data/mapterhorn-coverage.json', import.meta.url);
const fetchImpl = async () => new Response(fs.readFileSync(file), { status: 200 });

test('the shipped coverage index: lidar countries covered, places without lidar not', async () => {
  const index = await loadLidarCoverage(fetchImpl);
  assert.equal(index.z, 13);
  for (const [name, lat, lng] of [['Zurich', 47.37, 8.54], ['London', 51.51, -0.08], ['Frankfurt', 50.11, 8.67], ['Lauterbrunnen', 46.59, 7.91]]) {
    assert.ok(isCoveredAt(index, lat, lng), name);
  }
  for (const [name, lat, lng] of [['Sao Paulo', -23.57, -46.69], ['Hong Kong', 22.28, 114.16], ['Mexico City', 19.43, -99.17]]) {
    assert.ok(!isCoveredAt(index, lat, lng), name);
  }
});
