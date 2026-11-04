// Export hotspots: where people export MapNG levels, for the 2D map overlay.
// Opt in only. What is sent is the export's grid cell (0.05°, about 5 km),
// never the exact spot, and the worker stores per cell only counts and the
// day it was last seen (worker.js, ExportHotspots). Shared by the page, the
// worker and the tests: keep it free of browser and Vue imports.

export const HOTSPOT_CELL_DEG = 0.05;
const ROWS = Math.round(180 / HOTSPOT_CELL_DEG);   // 3600
const COLS = Math.round(360 / HOTSPOT_CELL_DEG);   // 7200

/** The grid cell { y, x } of a point, or null for a point that is not on Earth. */
export function hotspotCell(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const y = Math.min(ROWS - 1, Math.floor((lat + 90) / HOTSPOT_CELL_DEG));
  const x = Math.min(COLS - 1, Math.floor((lon + 180) / HOTSPOT_CELL_DEG));
  return { y, x };
}

/** A cell's centre { lat, lon }. */
export function hotspotCellCenter(y, x) {
  return { lat: -90 + (y + 0.5) * HOTSPOT_CELL_DEG, lon: -180 + (x + 0.5) * HOTSPOT_CELL_DEG };
}

/** Is { y, x } a cell of the grid? (the worker checks what it is sent) */
export function isHotspotCell(y, x) {
  return Number.isInteger(y) && Number.isInteger(x) && y >= 0 && y < ROWS && x >= 0 && x < COLS;
}

export const HOTSPOT_PLATFORMS = ['web', 'desktop'];

const BIN_PX = 28;   // cells within one such screen square make one dot

/**
 * The cells merged per BIN_PX screen square, for the map's dots (project:
 * lat, lon -> map pixels at the zoom shown): [{ lat, lon, total, web, desktop }]. */
export function binHotspots(cells, project) {
  const bins = new Map();
  for (const cell of cells) {
    const { lat, lon } = hotspotCellCenter(cell.y, cell.x);
    const p = project(lat, lon);
    const key = `${Math.floor(p.x / BIN_PX)},${Math.floor(p.y / BIN_PX)}`;
    const bin = bins.get(key) || { latSum: 0, lonSum: 0, total: 0, web: 0, desktop: 0 };
    // (the dot sits at the exports' weighted middle)
    bin.latSum += lat * cell.total; bin.lonSum += lon * cell.total;
    bin.total += cell.total; bin.web += cell.web; bin.desktop += cell.desktop;
    bins.set(key, bin);
  }
  return [...bins.values()].map((b) => ({ lat: b.latSum / b.total, lon: b.lonSum / b.total, total: b.total, web: b.web, desktop: b.desktop }));
}
