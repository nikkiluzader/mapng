// "Colour the map by group" (What to build, step 4): the area's OSM features
// drawn over the 2D map in their group's colour, faint where switched off.
// One canvas over the map, redrawn on move; the features projected once to
// Web Mercator at zoom 0, so a redraw is a scale and an offset per point.
import L from 'leaflet';
import { itemOfFeature, groupOfItem } from '../../services/buildContent.js';
import { GROUP_COLOURS } from '../../services/buildContentColours.js';

const AREA_TYPES = new Set(['building', 'water', 'vegetation', 'parking', 'landuse', 'leisure', 'amenity_area']);
const MAX_FEATURES = 250000;

const mercX = (lng) => ((lng + 180) / 360) * 256;
const mercY = (lat) => {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};

/** Features → drawable parts: { item, group, kind: 'area' | 'line' | 'point', xy: Float64Array }. */
export function prepareContent(features) {
  const parts = [];
  if (!Array.isArray(features)) return parts;
  for (let i = 0; i < features.length && parts.length < MAX_FEATURES; i++) {
    const f = features[i];
    const g = f?.geometry;
    if (!Array.isArray(g) || !g.length) continue;
    const item = itemOfFeature(f);
    if (!item) continue;
    const xy = new Float64Array(g.length * 2);
    let ok = true;
    for (let k = 0; k < g.length; k++) {
      const p = g[k];
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) { ok = false; break; }
      xy[k * 2] = mercX(p.lng); xy[k * 2 + 1] = mercY(p.lat);
    }
    if (!ok) continue;
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;
    const kind = g.length === 1 ? 'point' : closed && (AREA_TYPES.has(f.type) || f.tags?.area === 'yes' || f.type === 'road' && f.tags?.area === 'yes') ? 'area' : 'line';
    parts.push({ item, group: groupOfItem(item), kind, xy, width: f.type === 'road' ? (item === 'paths' ? 1 : 2.5) : item === 'railways' ? 2 : 1.2 });
  }
  // (areas first, lines over them, points on top)
  const order = { area: 0, line: 1, point: 2 };
  parts.sort((a, b) => order[a.kind] - order[b.kind]);
  return parts;
}

const ContentCanvas = L.Layer.extend({
  onAdd(map) {
    this._canvas = L.DomUtil.create('canvas', 'mapng-content-canvas');
    Object.assign(this._canvas.style, { position: 'absolute', pointerEvents: 'none' });
    map.getPane('mapngContent').appendChild(this._canvas);
    map.on('move zoom resize viewreset zoomend moveend', this._schedule, this);
    this._schedule();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('move zoom resize viewreset zoomend moveend', this._schedule, this);
    if (this._raf) cancelAnimationFrame(this._raf);
  },
  setData(parts, isOn) { this._parts = parts; this._isOn = isOn; this._schedule(); },
  _schedule() {
    if (this._raf || !this._map) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  },
  _draw() {
    const map = this._map; if (!map) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const c = this._canvas;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr);
    c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const parts = this._parts || []; if (!parts.length) return;
    const scale = 2 ** map.getZoom();
    const origin = map.getPixelBounds().min;   // (world pixels at this zoom, top-left of the view)
    const ox = origin.x; const oy = origin.y;
    const isOn = this._isOn || (() => true);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of parts) {
      const on = isOn(p.item);
      const colour = GROUP_COLOURS[p.group] || '#64748b';
      ctx.globalAlpha = on ? 1 : 0.12;
      ctx.beginPath();
      const xy = p.xy;
      if (p.kind === 'point') {
        const x = xy[0] * scale - ox; const y = xy[1] * scale - oy;
        if (x < -4 || y < -4 || x > size.x + 4 || y > size.y + 4) continue;
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = colour; ctx.fill();
        continue;
      }
      for (let k = 0; k < xy.length; k += 2) {
        const x = xy[k] * scale - ox; const y = xy[k + 1] * scale - oy;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (p.kind === 'area') {
        ctx.closePath();
        ctx.globalAlpha = on ? 0.45 : 0.06; ctx.fillStyle = colour; ctx.fill();
        ctx.globalAlpha = on ? 0.9 : 0.1; ctx.lineWidth = 0.8; ctx.strokeStyle = colour; ctx.stroke();
      } else {
        ctx.lineWidth = p.width; ctx.strokeStyle = colour; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
});

/** The layer, shown while `isShown()`; update() after the features, the switches or the step change. */
export function attachContentLayer(map, { getFeatures, isShown, isOn }) {
  if (!map.getPane('mapngContent')) {
    map.createPane('mapngContent').style.zIndex = '390';
    map.getPane('mapngContent').style.pointerEvents = 'none';
  }
  const layer = new ContentCanvas();
  let features = null; let parts = [];
  return {
    update() {
      const shown = isShown();
      if (!shown) { if (map.hasLayer(layer)) map.removeLayer(layer); return; }
      const f = getFeatures();
      if (f !== features) { features = f; parts = prepareContent(f); }
      if (!map.hasLayer(layer)) layer.addTo(map);
      layer.setData(parts, isOn);
    },
    remove() { if (map.hasLayer(layer)) map.removeLayer(layer); },
  };
}
