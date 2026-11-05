import test from 'node:test';
import assert from 'node:assert/strict';

// An area across two planet pieces reads tiles from both archives and merges
// them; nothing goes to Overpass. (Own file: the manifest is cached per process.)
test('fetchOSMData reads an area across two planet archives', async () => {
  const z3 = (x, y) => {
    const n = 8; const lat = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
    return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
  };
  const manifest = { archives: [
    { region: 'planet-3-0-2', key: 'osm/planet-3-0-2.pmtiles', bounds: z3(0, 2), built_at: '2026-11-06T00:00:00Z' },
    { region: 'planet-3-1-2', key: 'osm/planet-3-1-2.pmtiles', bounds: z3(1, 2), built_at: '2026-11-06T00:00:00Z' },
  ] };
  const way = (id, lon) => ({ type: 'way', id, tags: { highway: 'residential' }, geometry: [{ lat: 58.005, lon }, { lat: 58.006, lon: lon + 0.002 }] });
  const { PMTiles } = await import('pmtiles');
  const { fetchOSMData, getLastOSMRequestInfo } = await import('../services/osm.js');
  const origGetZxy = PMTiles.prototype.getZxy;
  const read = new Set();
  PMTiles.prototype.getZxy = async function getZxy() {
    const key = this.source.getKey();
    read.add(key);
    const payload = { elements: [key.includes('3-0-2') ? way(1, -135.01) : way(2, -134.99)] };
    return { data: new TextEncoder().encode(JSON.stringify(payload)).buffer };
  };
  const origFetch = globalThis.fetch;
  const origLocation = globalThis.location;
  globalThis.location = { protocol: 'https:' };
  globalThis.fetch = async (url) => {
    if (String(url) === '/api/osm-tiles/manifest') return new Response(JSON.stringify(manifest), { status: 200 });
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const features = await fetchOSMData({ south: 58.0, west: -135.02, north: 58.02, east: -134.98 });
    assert.equal(getLastOSMRequestInfo().endpointUsed, 'mapng-osm-tiles');
    assert.deepEqual([...read].sort(), ['/api/osm-tiles/osm/planet-3-0-2.pmtiles', '/api/osm-tiles/osm/planet-3-1-2.pmtiles']);
    const ids = new Set(features.filter((f) => f.type === 'road').map((f) => f.id));
    assert.ok(ids.size >= 2, `roads from both archives (got ${[...ids]})`);
  } finally {
    PMTiles.prototype.getZxy = origGetZxy;
    globalThis.fetch = origFetch;
    globalThis.location = origLocation;
  }
});
