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
 * points: [{ lat, lon, count }]. Returns a Leaflet layer.
 * Options: radius, blur (px), minOpacity, full (the count drawn darkest).
 */
export function heatLayer(points, { radius = 22, blur = 18, minOpacity = 0.25, full = 100, gradient = GRADIENT } = {}) {
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
    // Points summed per radius/2 cell. The cells are fixed to the world (the
    // map's own pixel grid at this zoom), not to the window: panning never
    // regroups them, so a place keeps its glow wherever it sits on screen.
    // Strength is the number of exports in the cell on one fixed scale
    // (`full` exports and more: the darkest), the same at every zoom and for
    // every view, never relative to what happens to be visible.
    const cell = radius / 2;
    const z = map.getZoom();
    const origin = map.getPixelBounds().min;
    const grid = new Map();
    for (const p of points) {
      const wp = map.project([p.lat, p.lon], z);
      const x = wp.x - origin.x; const y = wp.y - origin.y;
      if (x < -pad || y < -pad || x > size.x + pad || y > size.y + pad) continue;
      const key = `${Math.floor(wp.x / cell)},${Math.floor(wp.y / cell)}`;
      const g = grid.get(key);
      const w = p.count;
      if (!g) grid.set(key, { x: x * w, y: y * w, w });
      else { g.x += x * w; g.y += y * w; g.w += w; }
    }
    const scale = Math.log1p(full);
    // (faintest first: a busy cell's glow is never dimmed by a neighbour's)
    for (const g of [...grid.values()].sort((u, v) => u.w - v.w)) {
      ctx.globalAlpha = Math.min(1, minOpacity + (1 - minOpacity) * (Math.log1p(g.w) / scale));
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
