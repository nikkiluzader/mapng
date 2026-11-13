// A road on the hillside over a tunnel, running along it, is not a road inside it (synthetic scene).
// (Route de la Sassière 20 m over the D 902's tunnel at Tignes: its kerbs were put on the tunnel's floor and
// the ground under them dug down to it, hillside hanging into the tube. Fizz_Mechanic's "holes in the terrain
// above a tunnel, with texture glitches inside it".)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneTerrain, sceneWay } from './helpers/structureScenes.mjs';
import { generateDecalRoads } from '../services/exportBeamNGLevel.js';

const SQ = 1000 / 511;
const quiet = (fn) => { const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = log; console.warn = warn; } };

test('a road along the top of a hill a tunnel runs under keeps its own height, kerbs and all', () => {
  // a hill 40 m high across y = 0; the main road in a tunnel under it, a lane over the top along the same line
  const hill = (x, y) => 10 + 40 * Math.exp(-((y / 150) ** 2));
  const td = sceneTerrain(hill, [
    sceneWay(1, [[0, -450], [0, -220]], { highway: 'primary' }),
    sceneWay(2, [[0, -220], [0, 220]], { highway: 'primary', tunnel: 'yes', layer: '-1' }),
    sceneWay(3, [[0, 220], [0, 450]], { highway: 'primary' }),
    sceneWay(4, [[-120, -60], [2, -30], [3, 30], [120, 60]], { highway: 'unclassified' }),
  ]);
  const groups = quiet(() => generateDecalRoads(td, SQ, { structureSolver: 'v2' }));
  assert.equal(groups.tunnels.tunnels.length, 1, 'one bore');
  const t = groups.tunnels.tunnels[0];
  const floor = t.line[Math.floor((t.iS + t.iN) / 2)].z;
  // every point of the lane, over the tube or not, stands on the hill, far over the tunnel's road
  const lane = (groups.carriageways || []).filter((c) => c.highway === 'unclassified').flatMap((c) => c.nodes);
  const overTube = lane.filter((q) => Math.abs(q[0]) < 6 && Math.abs(q[1]) < 40);
  assert.ok(overTube.length > 5, `the lane's points over the tube were found (${overTube.length})`);
  const low = lane.filter((q) => q[2] < floor + 10).map((q) => q.slice(0, 3).map((v) => +v.toFixed(1)));
  assert.equal(low.length, 0, `lane points on the tunnel's floor (${floor.toFixed(1)}): ${JSON.stringify(low.slice(0, 4))}`);
});
