// The Mapterhorn lidar coverage index (public/data/mapterhorn-coverage.json, scripts/mapterhorn/buildCoverage.mjs):
// loading and lookups, without Leaflet (the map layer is services/lidarCoverageLayer.js).
export const COVERAGE_URL = '/data/mapterhorn-coverage.json';

let loading = null;
/** The index as { z, generated, rows: Map(y -> [[x0, length], ...]) } on the z13 grid. */
export function loadLidarCoverage(fetchImpl = fetch) {
  if (!loading) {
    loading = fetchImpl(COVERAGE_URL).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => ({ z: d.z, generated: d.generated, rows: new Map(Object.entries(d.rows).map(([y, runs]) => [Number(y), runs])) }))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** Whether the index cell (x, y) is covered. */
export const coveredCell = (index, x, y) => (index.rows.get(y) || []).some(([x0, len]) => x >= x0 && x < x0 + len);

/** Whether the z13 cell holding (lat, lng) is covered. */
export function isCoveredAt(index, lat, lng) {
  const n = 2 ** index.z; const s = Math.sin((lat * Math.PI) / 180);
  return coveredCell(index, Math.floor(((lng + 180) / 360) * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n));
}
