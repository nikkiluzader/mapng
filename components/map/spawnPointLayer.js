// Spawn and quicktravel points on the 2D map (Leaflet, imperative): a pin
// per point with an arrow for its heading (gold for the level's spawn, red
// and dashed outside the box: kept, not exported), dragged to move; the
// selected one has a handle at the arrow's tip, dragged to aim it. With the
// Place tool on, press on the map to drop a point and drag before letting go
// to aim it. State: store.points (services/spawnPoints.js); actions:
// composables/usePointsEditor.js; list: components/controls/SpawnPoints.vue.
import L from 'leaflet';
import { bearingDeg, pointInBounds, pointLabel } from '../../services/spawnPoints.js';

const HANDLE_PX = 44;     // the aim handle this far out along the arrow
const AIM_MIN_PX = 8;     // a press dragged less than this places without aiming

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pinHtml({ heading, isDefault, outside, selected }) {
  const fill = outside ? '#9ca3af' : isDefault ? '#f5b301' : 'var(--brand, #FF6600)';
  const ring = outside ? '#dc2626' : selected ? '#111827' : '#ffffff';
  const dash = outside ? 'stroke-dasharray="3 2"' : '';
  // a disc with a white arrow turned to the heading; the default one has a star
  return `<div class="mapng-point-pin${selected ? ' is-selected' : ''}${outside ? ' is-outside' : ''}">
    <svg viewBox="-16 -16 32 32" width="32" height="32" aria-hidden="true">
      <circle r="11" fill="${fill}" stroke="${ring}" stroke-width="${selected ? 3 : 2}" ${dash}/>
      <g transform="rotate(${Number(heading) || 0})">
        <path d="M0 -15 L5.5 -6 L-5.5 -6 Z" fill="${ring === '#ffffff' ? '#111827' : ring}" stroke="#fff" stroke-width="1"/>
        ${isDefault ? '<path d="M0 -6 L1.8 -1.6 L6.4 -1.6 L2.7 1.2 L4 5.6 L0 3 L-4 5.6 L-2.7 1.2 L-6.4 -1.6 L-1.8 -1.6 Z" fill="#fff"/>' : '<path d="M0 -7 L4 4 L0 2 L-4 4 Z" fill="#fff"/>'}
      </g>
    </svg>
  </div>`;
}

export function attachSpawnPointLayer(map, opts) {
  const { getPoints, getBounds, getTool, getSelected, setSelected, isActive, editor, t } = opts;
  const group = L.layerGroup().addTo(map);
  const markers = new Map();   // id -> marker
  let handle = null;           // the aim handle of the selected point
  let draft = null;            // { latlng, start, heading, marker } while placing

  const iconFor = (p, outside, selected) => L.divIcon({
    className: 'mapng-point-icon',
    html: pinHtml({ heading: p.heading, isDefault: p.isDefault, outside, selected }),
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  function handleLatLng(p) {
    const c = map.latLngToContainerPoint([p.lat, p.lng]);
    const h = (p.heading * Math.PI) / 180;
    return map.containerPointToLatLng(L.point(c.x + Math.sin(h) * HANDLE_PX, c.y - Math.cos(h) * HANDLE_PX));
  }

  function placeHandle() {
    const sel = getSelected();
    const p = isActive() ? getPoints().find((q) => q.id === sel) : null;
    if (!p) { if (handle) { group.removeLayer(handle); handle = null; } return; }
    if (!handle) {
      handle = L.marker(handleLatLng(p), {
        draggable: true,
        keyboard: false,
        zIndexOffset: 1000,
        title: t('spawnPoints.aimHandle'),
        icon: L.divIcon({ className: 'mapng-point-handle', html: '<span></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      });
      handle.on('drag', (e) => {
        const q = getPoints().find((x) => x.id === getSelected());
        if (!q) return;
        const heading = Math.round(bearingDeg({ lat: q.lat, lng: q.lng }, e.target.getLatLng()));
        markers.get(q.id)?.setIcon(iconFor({ ...q, heading }, false, true));
        handle._mapngHeading = heading;
      });
      handle.on('dragend', () => {
        const id = getSelected();
        if (id && Number.isFinite(handle?._mapngHeading)) editor.updatePoint(id, { heading: handle._mapngHeading });
      });
      group.addLayer(handle);
    } else {
      handle.setLatLng(handleLatLng(p));
    }
  }

  function update() {
    const active = isActive();
    const points = active ? getPoints() : [];
    const bounds = getBounds();
    const sel = getSelected();
    const seen = new Set();
    points.forEach((p, index) => {
      seen.add(p.id);
      const outside = !pointInBounds(p, bounds);
      const label = pointLabel(p, index);
      const tip = `${escapeHtml(label)}${p.isDefault ? ` · ${escapeHtml(t('spawnPoints.spawnTag'))}` : ''}${outside ? `<br><span class="mapng-point-tip-warn">${escapeHtml(t('spawnPoints.outside'))}</span>` : ''}`;
      let m = markers.get(p.id);
      if (!m) {
        m = L.marker([p.lat, p.lng], { draggable: true, keyboard: false, riseOnHover: true });
        m.on('click', (e) => { L.DomEvent.stop(e); setSelected(p.id); });
        m.on('dragstart', () => setSelected(p.id));
        m.on('drag', () => { if (handle && getSelected() === p.id) handle.setLatLng(handleLatLng({ ...p, ...latLngOf(m), heading: currentHeading(p.id) })); });
        m.on('dragend', () => editor.updatePoint(p.id, latLngOf(m)));
        // (a press on a pin is the pin's, not a new point's)
        m.on('mousedown', (e) => L.DomEvent.stopPropagation(e));
        m.bindTooltip('', { direction: 'top', offset: [0, -14] });
        group.addLayer(m);
        markers.set(p.id, m);
      }
      m.setLatLng([p.lat, p.lng]);
      m.setIcon(iconFor(p, outside, p.id === sel));
      m.setTooltipContent(tip);
      m.setZIndexOffset(p.id === sel ? 500 : p.isDefault ? 200 : 0);
    });
    for (const [id, m] of markers) if (!seen.has(id)) { group.removeLayer(m); markers.delete(id); }
    placeHandle();
    map.getContainer().classList.toggle('mapng-placing-point', active && getTool());
    if (active && getTool()) map.dragging.disable(); else if (!draft) map.dragging.enable();
  }

  const latLngOf = (m) => { const ll = m.getLatLng(); return { lat: ll.lat, lng: ((ll.lng + 540) % 360) - 180 }; };
  const currentHeading = (id) => getPoints().find((x) => x.id === id)?.heading || 0;

  // the Place tool: press drops a point, a drag before letting go aims it
  function onDown(e) {
    if (!isActive() || !getTool() || e.originalEvent?.button !== 0) return;
    e.originalEvent.preventDefault();   // (or a native drag of a tile eats the mouseup)
    draft = {
      latlng: e.latlng,
      start: e.containerPoint,
      heading: 0,
      marker: L.marker(e.latlng, { interactive: false, keyboard: false, icon: iconFor({ heading: 0, isDefault: false }, false, true) }).addTo(group),
    };
  }
  function onMove(e) {
    if (!draft) return;
    if (e.containerPoint.distanceTo(draft.start) < AIM_MIN_PX) return;
    draft.heading = Math.round(bearingDeg({ lat: draft.latlng.lat, lng: draft.latlng.lng }, e.latlng));
    draft.marker.setIcon(iconFor({ heading: draft.heading, isDefault: false }, false, true));
  }
  function onUp() {
    if (!draft) return;
    const d = draft;
    draft = null;
    group.removeLayer(d.marker);
    // (the first point is the level's spawn: that is what most people place one for)
    const first = getPoints().length === 0;
    editor.addPoint({ lat: d.latlng.lat, lng: ((d.latlng.lng + 540) % 360) - 180, heading: d.heading, isDefault: first });
  }
  map.on('mousedown', onDown);
  map.on('mousemove', onMove);
  map.on('mouseup', onUp);
  document.addEventListener('mouseup', onUp);
  map.on('zoomend moveend', placeHandle);
  // a click on the map itself lets go of the selection
  map.on('click', () => { if (!getTool() && getSelected()) setSelected(null); });

  return {
    update,
    destroy() {
      map.off('mousedown', onDown); map.off('mousemove', onMove); map.off('mouseup', onUp);
      document.removeEventListener('mouseup', onUp);
      map.off('zoomend moveend', placeHandle);
      group.remove();
    },
  };
}
