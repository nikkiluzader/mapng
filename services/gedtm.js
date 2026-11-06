// GEDTM30 (OpenGeoHub, CC-BY 4.0): a global 30 m bare-earth terrain model in one cloud-optimised GeoTIFF that
// browsers can read by range requests (CORS open). The ground filter (dsmGround.js) uses it as a second opinion
// where our global 30 m is a radar surface model. https://zenodo.org/records/18887460
import { fromUrl } from 'geotiff';

export const GEDTM_URL = 'https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif';
export const GEDTM_ATTRIBUTION = 'GEDTM30 (OpenGeoHub, CC-BY 4.0)';

let tiffPromise = null;
const image = () => {
  if (!tiffPromise) tiffPromise = fromUrl(GEDTM_URL).then((t) => t.getImage()).catch((e) => { tiffPromise = null; throw e; });
  return tiffPromise;
};

/**
 * GEDTM30 heights on an n x n grid of cell centres over bounds (row 0 north), bilinear; NaN where it has no data
 * (the sea, Antarctica). Throws when unreachable.
 */
export async function fetchGedtmGrid(bounds, n, { signal } = {}) {
  const img = await image();
  const [x0, , , y1] = img.getBoundingBox(); const [rx, ry] = img.getResolution();
  const c0 = Math.floor((bounds.west - x0) / rx) - 2, c1 = Math.ceil((bounds.east - x0) / rx) + 2;
  const r0 = Math.floor((bounds.north - y1) / ry) - 2, r1 = Math.ceil((bounds.south - y1) / ry) + 2;
  const [d] = await img.readRasters({ window: [c0, r0, c1, r1], signal });
  const w = c1 - c0, h = r1 - r0, west = x0 + c0 * rx, north = y1 + r0 * ry;
  const at = (i, j) => { const v = d[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]; return v > -1000 && v < 1e30 ? v : NaN; };
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const lat = bounds.north - ((y + 0.5) / n) * (bounds.north - bounds.south);
    const lng = bounds.west + ((x + 0.5) / n) * (bounds.east - bounds.west);
    const fx = (lng - west) / rx - 0.5, fy = (lat - north) / ry - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    out[y * n + x] = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  return out;
}
