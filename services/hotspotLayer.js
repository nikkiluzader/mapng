// The 2D map's export hotspot overlay (composables/useExportHotspots.js):
// the ~5 km cells where people exported, merged into dots for the zoom level
// (cells closer than a dot's spacing on screen add up), bigger and darker
// with more exports. Drawn on one canvas: thousands of cells stay cheap.
//
// - hover: count and how long ago the last export was
// - click a merged dot: zoom in until it splits into its cells
// - click a single cell: a popup with the web/desktop split and a button
//   that moves the selection there
// - dots exported in the last week pulse (their rings on a canvas of their own,
//   so the pulse never redraws the dots)
import L from 'leaflet';
import { binHotspots, daysSince, HOTSPOT_RECENT_DAYS } from './exportHotspots.js';

// (one hue, light to dark: magnitude, not categories; a white ring keeps the
// dots readable on satellite and dark maps alike)
const RAMP = ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#7c2d12'];
const PULSE_COLOR = '#ea580c';
const MAX_RINGS = 150;        // pulsing rings drawn at once (those in view)
const PULSE_MS = 1800;
const SPLIT_MAX_ZOOM = 13;    // clicking a merged dot never zooms past this

export function hotspotStyle(total, maxTotal) {
  const t = maxTotal > 1 ? Math.log(total) / Math.log(maxTotal) : 0;   // 0..1
  return {
    radius: Math.min(20, 4 + 3 * Math.log2(Math.max(1, total))),
    fillColor: RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))],
  };
}

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
 * Show the cells on the map, merged afresh at every zoom.
 * text: { tooltip(dot), count(dot), when(dot), web, desktop, moveHere }
 * onPick(dot): "move the selection here" from a cell's popup.
 * Returns { remove() }.
 */
export function addHotspotLayer(map, cells, text, onPick) {
  const renderer = L.canvas({ padding: 0.3, tolerance: 4 });
  // (the rings' canvas sits under the dots' and never takes the mouse)
  if (!map.getPane('mapngHotspotRings')) {
    const pane = map.createPane('mapngHotspotRings');
    pane.style.zIndex = '390';
    pane.style.pointerEvents = 'none';
  }
  const ringRenderer = L.canvas({ padding: 0.1, pane: 'mapngHotspotRings' });
  const group = L.layerGroup().addTo(map);
  const rings = L.layerGroup().addTo(map);
  let ringList = [];
  let frame = 0;
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

  let recentDots = [];   // [{ dot, radius }] exported in the last week
  const draw = () => {
    group.clearLayers();
    recentDots = [];
    const z = map.getZoom();
    const dots = binHotspots(cells.filter((c) => c.total > 0), (lat, lon) => map.project([lat, lon], z));
    const maxTotal = dots.reduce((m, d) => Math.max(m, d.total), 1);
    // (smallest first: the busiest dots draw on top)
    for (const dot of dots.sort((a, b) => a.total - b.total)) {
      const { radius, fillColor } = hotspotStyle(dot.total, maxTotal);
      L.circleMarker([dot.lat, dot.lon], {
        renderer, radius, fillColor, fillOpacity: 0.75, color: '#ffffff', weight: 2, opacity: 0.9, bubblingMouseEvents: false,
      }).bindTooltip(text.tooltip(dot), { direction: 'top', offset: [0, -radius] })
        .on('click', () => onDotClick(dot))
        .addTo(group);
      const age = daysSince(dot.lastDay);
      if (age !== null && age < HOTSPOT_RECENT_DAYS) recentDots.push({ dot, radius });
    }
    drawRings();
  };

  // Rings only for the recent dots in view (a pan redraws these, not the dots).
  const drawRings = () => {
    rings.clearLayers();
    ringList = [];
    const view = map.getBounds().pad(0.2);
    for (const { dot, radius } of recentDots) {
      if (ringList.length >= MAX_RINGS) break;
      if (!view.contains([dot.lat, dot.lon])) continue;
      const ring = L.circleMarker([dot.lat, dot.lon], {
        renderer: ringRenderer, radius, color: PULSE_COLOR, weight: 2, fill: false, opacity: 0, interactive: false,
      }).addTo(rings);
      ringList.push({ ring, radius, offset: Math.random() * PULSE_MS });
    }
    if (ringList.length && !frame) frame = requestAnimationFrame(pulse);
  };

  let lastPulse = 0;
  const pulse = (now) => {
    frame = 0;
    if (!ringList.length) return;
    frame = requestAnimationFrame(pulse);
    if (now - lastPulse < 33) return;     // ~30 fps is plenty for a soft pulse
    lastPulse = now;
    for (const r of ringList) {
      const phase = ((now + r.offset) % PULSE_MS) / PULSE_MS;   // 0..1
      r.ring.setStyle({ opacity: 0.8 * (1 - phase) });
      r.ring.setRadius(r.radius + 2 + phase * 10);
    }
  };

  draw();
  map.on('zoomend', draw);
  map.on('moveend', drawRings);
  return {
    remove() {
      map.off('zoomend', draw);
      map.off('moveend', drawRings);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      ringList = [];
      if (popup) map.closePopup(popup);
      group.remove();
      rings.remove();
    },
  };
}
