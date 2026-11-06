// "Free lidar coverage" on the 2D map: where Mapterhorn has elevation finer than the global 30 m (its z13+ tiles,
// national lidar and 1-10 m models), drawn from a prebuilt index of z13 tiles (public/data/mapterhorn-coverage.json,
// scripts/mapterhorn/buildCoverage.mjs) on a canvas grid layer: no tile requests to anyone while panning.
import L from 'leaflet';
import { coveredCell } from './lidarCoverage.js';

export { loadLidarCoverage, isCoveredAt } from './lidarCoverage.js';

const FILL = 'rgba(16, 185, 129, 0.30)';     // emerald, apart from the orange hotspots and the selection
const EDGE = 'rgba(5, 150, 105, 0.85)';

export function createLidarCoverageLayer(index) {
  const Layer = L.GridLayer.extend({
    createTile(coords) {
      const size = this.getTileSize();
      const c = document.createElement('canvas'); c.width = size.x; c.height = size.y;
      const ctx = c.getContext('2d');
      const dz = index.z - coords.z;                       // > 0: one map tile spans 2^dz index cells
      const scale = dz >= 0 ? size.x / 2 ** dz : size.x * 2 ** -dz;   // pixels per index cell
      const span = dz >= 0 ? 2 ** dz : 1;
      const cx0 = dz >= 0 ? coords.x * span : Math.floor(coords.x / 2 ** -dz);
      const cy0 = dz >= 0 ? coords.y * span : Math.floor(coords.y / 2 ** -dz);
      const offX = dz >= 0 ? 0 : -(coords.x % 2 ** -dz) * size.x, offY = dz >= 0 ? 0 : -(coords.y % 2 ** -dz) * size.y;
      ctx.fillStyle = FILL;
      for (let y = cy0; y < cy0 + span; y++) {
        const runs = index.rows.get(y); if (!runs) continue;
        for (const [x0, len] of runs) {
          const a = Math.max(x0, cx0), b = Math.min(x0 + len, cx0 + span);
          if (b <= a) continue;
          ctx.fillRect(offX + (a - cx0) * scale, offY + (y - cy0) * scale, Math.max(1, (b - a) * scale), Math.max(1, scale));
        }
      }
      // a crisp outline where coverage ends, once cells are big enough to see
      if (scale >= 6) {
        ctx.strokeStyle = EDGE; ctx.lineWidth = 1.5;
        const has = (x, y) => coveredCell(index, x, y);
        for (let y = cy0; y < cy0 + span; y++) for (let x = cx0; x < cx0 + span; x++) {
          if (!has(x, y)) continue;
          const px = offX + (x - cx0) * scale, py = offY + (y - cy0) * scale;
          ctx.beginPath();
          if (!has(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + scale, py); }
          if (!has(x, y + 1)) { ctx.moveTo(px, py + scale); ctx.lineTo(px + scale, py + scale); }
          if (!has(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + scale); }
          if (!has(x + 1, y)) { ctx.moveTo(px + scale, py); ctx.lineTo(px + scale, py + scale); }
          ctx.stroke();
        }
      }
      return c;
    },
  });
  return new Layer({ tileSize: 256, opacity: 1, pane: 'overlayPane', noWrap: true, className: 'mapng-lidar-coverage' });
}
