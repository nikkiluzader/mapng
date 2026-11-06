// Copernicus GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS
// by the European Union and ESA; free and open licence) through Mapterhorn's z12 tiles: outside national lidar,
// Mapterhorn's z12 is GLO-30. The ground filter (dsmGround.js) averages it with our global 30 m where both are
// radar surface models: their errors are partly independent, and GLO-30 (2011-2015) is newer than SRTM (2000).
// In a lidar region z12 is downsampled lidar instead, so nothing is returned there (the "Global 30 m only" source
// stays the global 30 m).
import { loadMapterhornTile } from './mapterhorn.js';
import { sampleTerrariumHeights } from './terrariumSampling.js';

export const COPERNICUS_ATTRIBUTION = 'Copernicus GLO-30 (DLR e.V., Airbus Defence and Space; EU and ESA) via Mapterhorn';
const Z = 12, T = 512, NO_DATA = -99999;
const px = (lng) => ((lng + 180) / 360) * 2 ** Z * T;
const py = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** Z * T; };

/** GLO-30 on an n x n grid of cell centres over bounds (row 0 north), or null (lidar region, or unreachable). */
export async function fetchCopernicusGrid(bounds, n, { signal, loadTile = loadMapterhornTile } = {}) {
  const lat = (bounds.north + bounds.south) / 2, lng = (bounds.west + bounds.east) / 2;
  // national lidar here? (z13 tiles exist only over it)
  const s13 = Math.sin((lat * Math.PI) / 180);
  const t13 = { x: Math.floor(((lng + 180) / 360) * 2 ** 13), y: Math.floor((0.5 - Math.log((1 + s13) / (1 - s13)) / (4 * Math.PI)) * 2 ** 13) };
  if (await loadTile(13, t13.x, t13.y, { signal })) return null;
  const x0 = Math.floor(px(bounds.west) / T) - 1, x1 = Math.floor(px(bounds.east) / T) + 1;
  const y0 = Math.floor(py(bounds.north) / T) - 1, y1 = Math.floor(py(bounds.south) / T) + 1;
  const MW = (x1 - x0 + 1) * T, MH = (y1 - y0 + 1) * T;
  const mosaic = new Float32Array(MW * MH).fill(NO_DATA);
  let got = 0;
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push((async () => {
    const h = await loadTile(Z, tx, ty, { signal }); if (!h) return; got++;
    for (let r = 0; r < T; r++) mosaic.set(h.subarray(r * T, (r + 1) * T), ((ty - y0) * T + r) * MW + (tx - x0) * T);
  })());
  await Promise.all(jobs);
  if (!got) return null;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const la = bounds.north - ((y + 0.5) / n) * (bounds.north - bounds.south), lo = bounds.west + ((x + 0.5) / n) * (bounds.east - bounds.west);
    const v = sampleTerrariumHeights(mosaic, MW, MH, px(lo) - x0 * T, py(la) - y0 * T, NO_DATA);
    out[y * n + x] = v === NO_DATA ? NaN : v;
  }
  return out;
}
