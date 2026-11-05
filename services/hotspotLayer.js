// The 2D map's export hotspot overlay (composables/useExportHotspots.js):
// the ~5 km cells where people exported, merged into dots for the zoom level
// (cells closer than a dot's spacing on screen add up), bigger and darker
// with more exports. Drawn on one canvas: thousands of cells stay cheap.
//
// - zoomed out (below HEAT_MAX_ZOOM): a soft heat glow (services/heatLayer.js),
//   with invisible targets on it so hover and click still work
// - zoomed in: small flat dots
// - hover: count and how long ago the last export was
// - click a merged dot: zoom in until it splits into its cells
// - click a single cell: a popup with the web/desktop split and a button
//   that moves the selection there
import L from 'leaflet';
import { binHotspots } from './exportHotspots.js';
import { heatLayer } from './heatLayer.js';

const HEAT_MAX_ZOOM = 8;

const SPLIT_MAX_ZOOM = 13;    // clicking a merged dot never zooms past this

function popupContent(dot, text, onPick) {
  const root = document.createElement('div');
  root.className = 'mapng-hotspot-popup';
  const title = document.createElement('div');
  title.className = 'mapng-hotspot-popup__title';
  title.textContent = text.count(dot);
  root.appendChild(title);

  // web / desktop split: a two-part bar, each part also named with its number
  if (dot.total > 0) {
    const bar = document.createElement('div');
    bar.className = 'mapng-hotspot-popup__bar';
    for (const [key, n] of [['web', dot.web], ['desktop', dot.desktop]]) {
      if (!n) continue;
      const part = document.createElement('span');
      part.className = `mapng-hotspot-popup__${key}`;
      part.style.flexGrow = String(n);
      bar.appendChild(part);
    }
    root.appendChild(bar);
    const legend = document.createElement('div');
    legend.className = 'mapng-hotspot-popup__legend';
    legend.innerHTML = '<span class="mapng-hotspot-popup__key mapng-hotspot-popup__web"></span>';
    legend.append(`${text.web} ${dot.web.toLocaleString()}`);
    const k2 = document.createElement('span');
    k2.className = 'mapng-hotspot-popup__key mapng-hotspot-popup__desktop';
    legend.append(k2, `${text.desktop} ${dot.desktop.toLocaleString()}`);
    root.appendChild(legend);
  }
  const when = text.when(dot);
  if (when) {
    const line = document.createElement('div');
    line.className = 'mapng-hotspot-popup__when';
    line.textContent = when;
    root.appendChild(line);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mapng-hotspot-popup__button';
  button.textContent = text.moveHere;
  button.addEventListener('click', () => onPick(dot));
  root.appendChild(button);
  return root;
}

/**
 * Show the cells on the map: a heat glow zoomed out, dots up close, merged
 * afresh at every zoom.
 * text: { tooltip(dot), count(dot), when(dot), web, desktop, moveHere }
 * onPick(dot): "move the selection here" from a cell's popup.
 * Returns { remove() }.
 */
export function addHotspotLayer(map, cells, text, onPick) {
  const renderer = L.canvas({ padding: 0.3, tolerance: 4 });
  const group = L.layerGroup().addTo(map);
  const live = cells.filter((c) => c.total > 0);
  const maxCell = live.reduce((m, c) => Math.max(m, c.total), 1);
  const heat = heatLayer(live.map((c) => {
    const lat = -90 + (c.y + 0.5) * 0.05;
    const lon = -180 + (c.x + 0.5) * 0.05;
    return { lat, lon, weight: Math.sqrt(c.total / maxCell) };
  }));
  let popup = null;

  const pick = (dot) => {
    map.closePopup();
    onPick(dot);
  };

  const onDotClick = (dot) => {
    if (dot.cells > 1 && map.getZoom() < SPLIT_MAX_ZOOM) {
      // zoom in until this dot's cells come apart (at least two levels)
      const target = Math.min(SPLIT_MAX_ZOOM, Math.max(map.getZoom() + 2, map.getBoundsZoom(dot.bounds, false, L.point(80, 80))));
      map.flyTo([dot.lat, dot.lon], target, { duration: 0.6 });
      return;
    }
    popup = L.popup({ offset: [0, -4], autoPanPadding: [40, 40], className: 'mapng-hotspot-popup-wrap' })
      .setLatLng([dot.lat, dot.lon])
      .setContent(popupContent(dot, text, pick))
      .openOn(map);
  };

  const draw = () => {
    group.clearLayers();
    const z = map.getZoom();
    const glow = z < HEAT_MAX_ZOOM;
    if (glow && !map.hasLayer(heat)) heat.addTo(map);
    if (!glow && map.hasLayer(heat)) heat.remove();
    const dots = binHotspots(live, (lat, lon) => map.project([lat, lon], z));
    // (smallest first: the busiest dots draw on top)
    for (const dot of dots.sort((a, b) => a.total - b.total)) {
      const radius = glow ? 14 : Math.min(16, 5 + 2 * Math.log2(Math.max(1, dot.total)));
      L.circleMarker([dot.lat, dot.lon], glow
        ? { renderer, radius, stroke: false, fillOpacity: 0, bubblingMouseEvents: false }
        : { renderer, radius, fillColor: '#ea580c', fillOpacity: 0.85, color: '#ffffff', weight: 1.5, opacity: 0.95, bubblingMouseEvents: false })
        .bindTooltip(text.tooltip(dot), { direction: 'top', offset: [0, -radius] })
        .on('click', () => onDotClick(dot))
        .addTo(group);
    }
  };

  draw();
  map.on('zoomend', draw);
  return {
    remove() {
      map.off('zoomend', draw);
      if (popup) map.closePopup(popup);
      if (map.hasLayer(heat)) heat.remove();
      group.remove();
    },
  };
}
