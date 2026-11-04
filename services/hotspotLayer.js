// The 2D map's export hotspot overlay (composables/useExportHotspots.js):
// the ~5 km cells where people exported, merged into dots for the zoom level
// (cells closer than a dot's spacing on screen add up), bigger and darker
// with more exports. Drawn on one canvas: thousands of cells stay cheap.
import L from 'leaflet';
import { binHotspots } from './exportHotspots.js';

// (one hue, light to dark: magnitude, not categories; a white ring keeps the
// dots readable on satellite and dark maps alike)
const RAMP = ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#7c2d12'];

export function hotspotStyle(total, maxTotal) {
  const t = maxTotal > 1 ? Math.log(total) / Math.log(maxTotal) : 0;   // 0..1
  return {
    radius: Math.min(20, 4 + 3 * Math.log2(Math.max(1, total))),
    fillColor: RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))],
  };
}

/**
 * Show the cells on the map, merged afresh at every zoom. label(dot) gives a
 * dot's hover text. Returns { remove() }.
 */
export function addHotspotLayer(map, cells, label) {
  const renderer = L.canvas({ padding: 0.3, tolerance: 4 });
  const group = L.layerGroup().addTo(map);
  const draw = () => {
    group.clearLayers();
    const z = map.getZoom();
    const dots = binHotspots(cells.filter((c) => c.total > 0), (lat, lon) => map.project([lat, lon], z));
    const maxTotal = dots.reduce((m, d) => Math.max(m, d.total), 1);
    // (smallest first: the busiest dots draw on top)
    for (const dot of dots.sort((a, b) => a.total - b.total)) {
      const { radius, fillColor } = hotspotStyle(dot.total, maxTotal);
      L.circleMarker([dot.lat, dot.lon], {
        renderer, radius, fillColor, fillOpacity: 0.75, color: '#ffffff', weight: 2, opacity: 0.9,
      }).bindTooltip(label(dot), { direction: 'top', offset: [0, -radius] }).addTo(group);
    }
  };
  draw();
  map.on('zoomend', draw);
  return { remove() { map.off('zoomend', draw); group.remove(); } };
}
