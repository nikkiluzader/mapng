// A soft heat glow for the 2D map (the export hotspot overlay when zoomed
// out): each point is drawn as a blurred spot of alpha on an offscreen
// canvas, then the alpha is coloured through a gradient. The same technique
// as leaflet.heat / simpleheat, kept here so it adds no dependency.
import L from 'leaflet';

const GRADIENT = { 0.2: '#fed7aa', 0.45: '#fb923c', 0.7: '#ea580c', 1: '#9a3412' };

const makePalette = (stops) => {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [at, color] of Object.entries(stops)) g.addColorStop(Number(at), color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);
  return ctx.getImageData(0, 0, 1, 256).data;
};

const makeSpot = (radius, blur) => {
  const r = radius + blur;
  const c = document.createElement('canvas');
  c.width = c.height = r * 2;
  const ctx = c.getContext('2d');
  // (the shadow is the blur: the circle itself is drawn off-canvas)
  ctx.shadowOffsetX = ctx.shadowOffsetY = r * 2;
  ctx.shadowBlur = blur;
  ctx.shadowColor = 'black';
  ctx.beginPath();
  ctx.arc(-r, -r, radius, 0, Math.PI * 2);
  ctx.fill();
  return { canvas: c, r };
};

/**
 * points: [{ lat, lon, weight }] with weight 0..1. Returns a Leaflet layer.
 * Options: radius, blur (px), minOpacity.
 */
export function heatLayer(points, { radius = 22, blur = 18, minOpacity = 0.25, maxZoom = 8, gradient = GRADIENT } = {}) {
  const palette = makePalette(gradient);
  const spot = makeSpot(radius, blur);
  let map = null;
  let canvas = null;

  const redraw = () => {
    if (!map || !canvas) return;
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size.x, size.y);
    const pad = spot.r;
    // As leaflet.heat: points summed per radius/2 screen cell, each weighed
    // down by how far out the map is (so a lone export stays a faint spot and
    // a busy city builds up), then drawn at that strength.
    const cell = radius / 2;
    const v = 1 / 2 ** Math.max(0, Math.min(maxZoom - map.getZoom(), 12));
    const grid = new Map();
    for (const p of points) {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) continue;
      const key = `${Math.floor(pt.x / cell)},${Math.floor(pt.y / cell)}`;
      const g = grid.get(key);
      const w = p.weight * v;
      if (!g) grid.set(key, { x: pt.x * w, y: pt.y * w, w });
      else { g.x += pt.x * w; g.y += pt.y * w; g.w += w; }
    }
    for (const g of grid.values()) {
      ctx.globalAlpha = Math.min(1, Math.max(minOpacity, g.w));
      ctx.drawImage(spot.canvas, g.x / g.w - spot.r, g.y / g.w - spot.r);
    }
    const img = ctx.getImageData(0, 0, size.x, size.y);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      if (!a) continue;
      const j = a * 4;
      d[i - 3] = palette[j]; d[i - 2] = palette[j + 1]; d[i - 1] = palette[j + 2];
      d[i] = a;
    }
    ctx.putImageData(img, 0, 0);
  };

  const Layer = L.Layer.extend({
    onAdd(m) {
      map = m;
      canvas = L.DomUtil.create('canvas', 'mapng-heat leaflet-zoom-hide');
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      m.getPanes().overlayPane.appendChild(canvas);
      m.on('moveend zoomend resize', redraw);
      redraw();
    },
    onRemove(m) {
      m.off('moveend zoomend resize', redraw);
      canvas?.remove();
      canvas = null;
      map = null;
    },
  });
  return new Layer();
}
