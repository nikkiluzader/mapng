// Synthetic road/bridge/tunnel situations for the structure solver
// (refs/output/bridge-tunnel-plan.md, step 2). Generated geometry only: no
// scene is, or is tuned to, a real place. Each returns the terrainData and
// squareSize generateDecalRoads takes; world (0, 0) is the map centre, y north.

const SIZE = 1000;            // m across
const N = 512;                // heightmap samples per side
const SQ = SIZE / (N - 1);
const DEG = SIZE / 111320;

const ll = (x, y) => ({ lat: (y / SIZE) * DEG, lng: (x / SIZE) * DEG });
const way = (id, pts, tags) => ({ id: String(id), type: 'road', geometry: pts.map(([x, y]) => ll(x, y)), tags });
const water = (id, pts, tags) => ({ id: String(id), type: 'water', geometry: pts.map(([x, y]) => ll(x, y)), tags });

// terrain from height(x, y), world metres
function terrain(height, features) {
  const hm = new Float32Array(N * N);
  let min = Infinity; let max = -Infinity;
  for (let r = 0; r < N; r++) {
    const y = (0.5 - r / (N - 1)) * SIZE;
    for (let c = 0; c < N; c++) {
      const x = (c / (N - 1) - 0.5) * SIZE;
      const h = height(x, y);
      hm[r * N + c] = h;
      if (h < min) min = h; if (h > max) max = h;
    }
  }
  return {
    width: N, height: N, minHeight: min, maxHeight: max, heightMap: hm,
    bounds: { south: -DEG / 2, north: DEG / 2, west: -DEG / 2, east: DEG / 2 },
    roadRules: { countryCode: 'US', region: 'Americas' },
    osmFeatures: features,
  };
}

const flat = () => 10;

export const STRUCTURE_SCENES = [
  {
    name: 'overpass on flat ground',
    build: () => terrain(flat, [
      way(1, [[-400, 0], [-40, 0]], { highway: 'secondary' }),
      way(2, [[-40, 0], [40, 0]], { highway: 'secondary', bridge: 'yes', layer: '1' }),
      way(3, [[40, 0], [400, 0]], { highway: 'secondary' }),
      way(4, [[0, -450], [0, 450]], { highway: 'motorway', oneway: 'yes' }),
    ]),
  },
  {
    name: 'three-level stack',
    build: () => terrain(flat, [
      way(1, [[-450, 0], [450, 0]], { highway: 'motorway', oneway: 'yes' }),
      way(2, [[0, -450], [0, -60]], { highway: 'trunk' }),
      way(3, [[0, -60], [0, 60]], { highway: 'trunk', bridge: 'yes', layer: '1' }),
      way(4, [[0, 60], [0, 450]], { highway: 'trunk' }),
      way(5, [[-300, -300], [-90, -90]], { highway: 'motorway_link', oneway: 'yes' }),
      way(6, [[-90, -90], [90, 90]], { highway: 'motorway_link', oneway: 'yes', bridge: 'yes', layer: '2' }),
      way(7, [[90, 90], [300, 300]], { highway: 'motorway_link', oneway: 'yes' }),
    ]),
  },
  {
    name: 'bridge over a river between banks',
    // banks at 10 m, a 60 m wide channel down to 2 m along x = 0
    build: () => terrain((x) => 10 - 8 * Math.exp(-((x / 40) ** 4)), [
      way(1, [[-400, 0], [-60, 0]], { highway: 'primary' }),
      way(2, [[-60, 0], [60, 0]], { highway: 'primary', bridge: 'yes', layer: '1' }),
      way(3, [[60, 0], [400, 0]], { highway: 'primary' }),
      water(4, [[0, -480], [0, 480]], { waterway: 'river' }),
    ]),
  },
  {
    name: 'short bridge over a ship channel in a town',
    // a town at 4 m either side of a 240 m channel (0 m) marked for ships; the
    // 300 m bridge can't climb to a ship's clearance: it stays a town bridge
    build: () => terrain((x) => 4 - 4 * Math.exp(-((x / 120) ** 6)), [
      way(1, [[-450, 0], [-150, 0]], { highway: 'primary' }),
      way(2, [[-150, 0], [150, 0]], { highway: 'primary', bridge: 'yes', layer: '1' }),
      way(3, [[150, 0], [450, 0]], { highway: 'primary' }),
      ...[-400, -300, -200, 200, 300, 400].map((x, i) => way(10 + i, [[x, -300], [x, 0], [x, 300]], { highway: 'residential' })),
      water(5, [[0, -480], [0, 480]], { waterway: 'river', width: '200', ship: 'yes' }),
    ]),
  },
  {
    name: 'mountain tunnel through a ridge',
    // a 60 m ridge along y = 0, the road crossing it north-south
    build: () => terrain((x, y) => 10 + 60 * Math.exp(-((y / 140) ** 2)), [
      way(1, [[0, -450], [0, -160]], { highway: 'primary' }),
      way(2, [[0, -160], [0, 160]], { highway: 'primary', tunnel: 'yes', layer: '-1' }),
      way(3, [[0, 160], [0, 450]], { highway: 'primary' }),
    ]),
  },
  {
    name: 'urban cut-and-cover under a street grid',
    build: () => terrain(flat, [
      way(1, [[-450, 0], [-150, 0]], { highway: 'trunk', oneway: 'yes' }),
      way(2, [[-150, 0], [150, 0]], { highway: 'trunk', oneway: 'yes', tunnel: 'yes', layer: '-1' }),
      way(3, [[150, 0], [450, 0]], { highway: 'trunk', oneway: 'yes' }),
      ...[-100, -50, 0, 50, 100].map((x, i) => way(10 + i, [[x, -300], [x, 300]], { highway: 'residential' })),
    ]),
  },
  {
    name: 'ramp joint between decks of different layers',
    // a layer-2 ramp deck joins a layer-1 deck at a shared node over a road
    build: () => terrain(flat, [
      way(1, [[-450, 0], [-80, 0]], { highway: 'motorway', oneway: 'yes' }),
      way(2, [[-80, 0], [-40, 0], [80, 0]], { highway: 'motorway', oneway: 'yes', bridge: 'yes', layer: '1' }),
      way(3, [[80, 0], [450, 0]], { highway: 'motorway', oneway: 'yes' }),
      way(4, [[-250, 140], [-40, 0]], { highway: 'motorway_link', oneway: 'yes', bridge: 'yes', layer: '2' }),
      way(5, [[-450, 140], [-250, 140]], { highway: 'motorway_link', oneway: 'yes' }),
      way(6, [[0, -450], [0, 450]], { highway: 'primary' }),
    ]),
  },
  {
    name: 'bridge tagged over nothing (culvert)',
    build: () => terrain(flat, [
      way(1, [[-400, 0], [-8, 0]], { highway: 'residential' }),
      way(2, [[-8, 0], [8, 0]], { highway: 'residential', bridge: 'yes', layer: '1' }),
      way(3, [[8, 0], [400, 0]], { highway: 'residential' }),
    ]),
  },
  {
    name: 'tunnel tagged on flat ground',
    build: () => terrain(flat, [
      way(1, [[-400, 0], [-120, 0]], { highway: 'secondary' }),
      way(2, [[-120, 0], [120, 0]], { highway: 'secondary', tunnel: 'yes', layer: '-1' }),
      way(3, [[120, 0], [400, 0]], { highway: 'secondary' }),
    ]),
  },
  {
    name: 'deck running off the map edge',
    build: () => terrain(flat, [
      way(1, [[0, 0], [380, 0]], { highway: 'primary' }),
      way(2, [[380, 0], [520, 0]], { highway: 'primary', bridge: 'yes', layer: '1' }),
      way(3, [[450, -450], [450, 450]], { highway: 'secondary' }),
    ]),
  },
  {
    name: 'two crossings closer than a ramp',
    // one bridge over two parallel motorways 45 m apart
    build: () => terrain(flat, [
      way(1, [[-400, 0], [-70, 0]], { highway: 'secondary' }),
      way(2, [[-70, 0], [70, 0]], { highway: 'secondary', bridge: 'yes', layer: '1' }),
      way(3, [[70, 0], [400, 0]], { highway: 'secondary' }),
      way(4, [[-22, -450], [-22, 450]], { highway: 'motorway', oneway: 'yes' }),
      way(5, [[23, 450], [23, -450]], { highway: 'motorway', oneway: 'yes' }),
    ]),
  },
  {
    name: 'footbridge over a road (not built yet)',
    future: true,
    build: () => terrain(flat, [
      way(1, [[0, -450], [0, 450]], { highway: 'primary' }),
      way(2, [[-120, 0], [-20, 0]], { highway: 'footway' }),
      way(3, [[-20, 0], [20, 0]], { highway: 'footway', bridge: 'yes', layer: '1' }),
      way(4, [[20, 0], [120, 0]], { highway: 'footway' }),
    ]),
  },
  {
    name: 'path under a road (not built yet)',
    future: true,
    build: () => terrain(flat, [
      way(1, [[-450, 0], [450, 0]], { highway: 'primary' }),
      way(2, [[0, -120], [0, -15]], { highway: 'footway' }),
      way(3, [[0, -15], [0, 15]], { highway: 'footway', tunnel: 'yes', layer: '-1' }),
      way(4, [[0, 15], [0, 120]], { highway: 'footway' }),
    ]),
  },
];

export const SCENE_SQUARE_SIZE = SQ;

/**
 * A scene through today's road, bridge and tunnel passes, measured with the
 * structure checks: { groups, checks, summary } (summary: the counts the
 * baseline tracks).
 */
export async function runStructureScene(scene) {
  const { generateDecalRoads, getTerrainHeightAtWorldXY } = await import('../../services/exportBeamNGLevel.js');
  const { measureStructures, roadLinesFromDecals } = await import('../../services/structures/metrics.js');
  const td = scene.build();
  const groups = generateDecalRoads(td, SQ);
  const checks = measureStructures({
    carriageways: roadLinesFromDecals(groups),
    decks: groups.bridges?.decks || [],
    tunnels: groups.tunnels?.tunnels || [],
    groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, td, SQ),
    grid: { heightMap: td.heightMap, width: td.width, height: td.height, worldSize: td.width * SQ },
  });
  const summary = {
    decks: (groups.bridges?.decks || []).length,
    tunnels: (groups.tunnels?.tunnels || []).length,
    steps: checks.joints.steps,
    steepStructure: checks.grades.structure.count,
    steepGround: checks.grades.ground.count,
    shortCrossings: checks.crossings.short,
    groundGaps: checks.groundGaps.off,
    throughDeck: checks.throughDecks.through,
    spikes: checks.spikes.spikes,
  };
  return { groups, checks, summary, td, squareSize: SQ };
}
