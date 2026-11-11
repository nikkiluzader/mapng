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
    parts.push({ item, group: groupOfItem(item), kind, xy, feature: f, width: f.type === 'road' ? (item === 'paths' || item === 'tracks' || item === 'serviceRoads' ? 1 : item === 'motorways' ? 3.5 : 2.5) : item === 'railways' ? 2 : 1.2 });
  }
  // (areas first, lines over them, points on top)
  const order = { area: 0, line: 1, point: 2 };
  parts.sort((a, b) => order[a.kind] - order[b.kind]);
  return parts;
}

const ContentCanvas = L.Layer.extend({
  onAdd(map) {
    // (leaflet-zoom-animated: Leaflet's own transition while a zoom animates)
    this._canvas = L.DomUtil.create('canvas', 'mapng-content-canvas leaflet-zoom-animated');
    Object.assign(this._canvas.style, { position: 'absolute', pointerEvents: 'none' });
    map.getPane('mapngContent').appendChild(this._canvas);
    map.on('move zoom resize viewreset zoomend moveend', this._schedule, this);
    map.on('zoomanim', this._onZoomAnim, this);
    this._schedule();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('move zoom resize viewreset zoomend moveend', this._schedule, this);
    map.off('zoomanim', this._onZoomAnim, this);
    if (this._raf) cancelAnimationFrame(this._raf);
  },
  // While a zoom animates, the canvas as last drawn is scaled and moved with
  // the map (as Leaflet does its tiles and image overlays), and drawn afresh
  // when the animation ends: it stood still until then, sliding against the
  // texture under it.
  _onZoomAnim(e) {
    const map = this._map; if (!map || !this._drawnBounds) return;
    const scale = map.getZoomScale(e.zoom, this._drawnZoom);
    const offset = map._latLngBoundsToNewLayerBounds(this._drawnBounds, e.zoom, e.center).min;
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },
  setData(parts, isOn) { this._parts = parts; this._isOn = isOn; this._schedule(); },
  _schedule() {
    // (not in the middle of a zoom animation: a redraw there snapped the canvas back)
    if (this._raf || !this._map || this._map._animatingZoom) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  },
  _draw() {
    const map = this._map; if (!map) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const c = this._canvas;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    this._drawnZoom = map.getZoom(); this._drawnBounds = map.getBounds();
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
    /**
     * What is drawn under a point of the map's container: { item, group, feature } or null.
     * The topmost: points, then lines within a few pixels, then the smallest area holding it.
     */
    hitTest(pt) {
      if (!map.hasLayer(layer) || !parts.length) return null;
      const scale = 2 ** map.getZoom(); const origin = map.getPixelBounds().min;
      const wx = (pt.x + origin.x) / scale; const wy = (pt.y + origin.y) / scale;   // (zoom-0 world, as the parts')
      const tol = 5 / scale;
      let best = null; let bestRank = -1; let bestSize = Infinity;
      for (const p of parts) {
        const xy = p.xy;
        // (its box first)
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        if (p.box) [x0, y0, x1, y1] = p.box;
        else { for (let k = 0; k < xy.length; k += 2) { if (xy[k] < x0) x0 = xy[k]; if (xy[k] > x1) x1 = xy[k]; if (xy[k + 1] < y0) y0 = xy[k + 1]; if (xy[k + 1] > y1) y1 = xy[k + 1]; } p.box = [x0, y0, x1, y1]; }
        if (wx < x0 - tol || wx > x1 + tol || wy < y0 - tol || wy > y1 + tol) continue;
        if (p.kind === 'point') {
          if (Math.hypot(xy[0] - wx, xy[1] - wy) <= tol && bestRank < 3) { best = p; bestRank = 3; }
        } else if (p.kind === 'line') {
          if (bestRank >= 2) continue;
          for (let k = 0; k + 3 < xy.length; k += 2) {
            const ax = xy[k]; const ay = xy[k + 1]; const dx = xy[k + 2] - ax; const dy = xy[k + 3] - ay;
            const L2 = dx * dx + dy * dy; const u = L2 > 0 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / L2)) : 0;
            if (Math.hypot(ax + dx * u - wx, ay + dy * u - wy) <= tol) { best = p; bestRank = 2; break; }
          }
        } else if (bestRank <= 1) {
          let inside = false;
          for (let k = 0, j = xy.length - 2; k < xy.length; j = k, k += 2) {
            if ((xy[k + 1] > wy) !== (xy[j + 1] > wy) && wx < ((xy[j] - xy[k]) * (wy - xy[k + 1])) / (xy[j + 1] - xy[k + 1]) + xy[k]) inside = !inside;
          }
          const size = (x1 - x0) * (y1 - y0);
          if (inside && size < bestSize) { best = p; bestRank = 1; bestSize = size; }
        }
      }
      return best ? { item: best.item, group: best.group, feature: best.feature } : null;
    },
  };
}
