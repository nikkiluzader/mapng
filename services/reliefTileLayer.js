// Three base layers for the location map, drawn here from the global
// elevation tiles the app already reads (AWS Terrain Tiles, Terrarium): no
// other service is asked.
//
//   height  the ground coloured by height, low to high over what is on screen
//           (so a town's 40 m of relief reads as clearly as a mountain's 2 km),
//           with shading; for seeing hilltops and valleys when drawing
//           background areas (SailorSunny405, Discord, 2026-11-11)
//   relief  grey shaded relief: the land's shape alone
//   slope   steepness in colour: where a road can go and where it cannot
//
// The pure parts (decode, shade, colours) are tested in
// tests/reliefTileLayer.test.mjs; the Leaflet layer wraps them.
import { TILE_API_URL } from './terrain.js';

export const RELIEF_MODES = ['height', 'relief', 'slope'];
const SIZE = 256;
const MAX_NATIVE_ZOOM = 15;
const EARTH_M_PER_PX_Z0 = 156543.03392;

/** Ground metres per pixel of a 256 px web-mercator tile. */
export const tileMetersPerPixel = (zoom, latDeg) => (EARTH_M_PER_PX_Z0 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;

/** Terrarium RGBA to metres (no-data, which AWS blends along coasts, reads as sea level). */
export function decodeTerrariumTile(rgba, size = SIZE) {
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const p = i * 4;
    const v = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
    h[i] = v <= -32760 ? 0 : v;
  }
  return h;
}

/** Lowest and highest land height in a tile, sampled every 4th pixel: [lo, hi], or null for open sea. */
export function tileLandRange(heights, size = SIZE) {
  let lo = Infinity; let hi = -Infinity;
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const v = heights[y * size + x];
      if (v < SEA_BELOW_M) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

// (below this the height layer paints sea; Dead Sea shores and polders stay land colours near it)
const SEA_BELOW_M = -3;

const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1]; const [v1, c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return stops[stops.length - 1][1];
}

// Height: an atlas tint over 0..1 of the range on screen.
const HEIGHT_STOPS = [
  [0.00, [72, 132, 96]], [0.18, [128, 172, 110]], [0.38, [214, 212, 140]],
  [0.58, [200, 160, 104]], [0.78, [150, 116, 96]], [0.92, [196, 190, 186]], [1.00, [250, 250, 250]],
];
const SEA_STOPS = [[-4000, [24, 52, 96]], [-200, [48, 96, 150]], [0, [120, 170, 205]]];
// Slope, in degrees (a car climbs about 20 on tarmac; past 35 is cliff)
export const SLOPE_STOPS = [
  [0, [246, 246, 240]], [3, [214, 234, 190]], [8, [244, 226, 134]],
  [15, [242, 166, 90]], [25, [217, 83, 79]], [35, [142, 44, 107]], [45, [59, 26, 74]],
];
export const slopeColour = (deg) => ramp(SLOPE_STOPS, deg).map(Math.round);
export const heightColour = (t) => ramp(HEIGHT_STOPS, Math.min(1, Math.max(0, t))).map(Math.round);

/**
 * One tile's picture: RGBA for `heights` (size x size, metres) at `mpp` ground
 * metres per pixel. range [lo, hi] is what the height colours stretch over.
 * Light comes from the north-west, as on printed maps.
 */
export function shadeReliefTile(heights, { size = SIZE, mpp = 30, mode = 'height', range = [0, 1000] } = {}) {
  const out = new Uint8ClampedArray(size * size * 4);
  // (coarse tiles have gentle numbers for steep land: the shading is exaggerated there, the slope colours never)
  const zf = Math.min(12, Math.max(1, mpp / 40));
  const [lo, hi] = range;
  const span = Math.max(1, hi - lo);
  const L = [-0.5, -0.5, Math.SQRT1_2];           // towards the light: (east, south, up)
  for (let y = 0; y < size; y++) {
    const y0 = y > 0 ? y - 1 : y; const y1 = y < size - 1 ? y + 1 : y;
    for (let x = 0; x < size; x++) {
      const x0 = x > 0 ? x - 1 : x; const x1 = x < size - 1 ? x + 1 : x;
      const dzdx = (heights[y * size + x1] - heights[y * size + x0]) / ((x1 - x0) * mpp);
      const dzdy = (heights[y1 * size + x] - heights[y0 * size + x]) / ((y1 - y0) * mpp);
      const nx = -dzdx * zf; const ny = -dzdy * zf;
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / Math.sqrt(nx * nx + ny * ny + 1));   // flat ground: 0.707
      const h = heights[y * size + x];
      let c;
      if (mode === 'relief') {
        const g = 40 + 215 * Math.min(1, shade / 0.9);
        c = [g, g, g];
      } else if (mode === 'slope') {
        const deg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
        const k = 0.82 + 0.18 * Math.min(1, shade / 0.707);
        c = ramp(SLOPE_STOPS, deg).map((v) => v * k);
      } else if (h < SEA_BELOW_M) {
        c = ramp(SEA_STOPS, h);
      } else {
        const k = 0.5 + 0.5 * Math.min(1.25, shade / 0.707);
        c = ramp(HEIGHT_STOPS, (h - lo) / span).map((v) => v * k);
      }
      const p = (y * size + x) * 4;
      out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
    }
  }
  return out;
}

/**
 * The Leaflet layer. L is passed in (the map component's Leaflet).
 * options.onRange(lo, hi) is told the height range on screen (height mode).
 */
export function createReliefLayer(L, mode, options = {}) {
  const { onRange = null, ...layerOptions } = options;
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = L.DomUtil.create('canvas', 'leaflet-tile');
      canvas.width = SIZE; canvas.height = SIZE;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const scratch = document.createElement('canvas');
          scratch.width = SIZE; scratch.height = SIZE;
          const sctx = scratch.getContext('2d', { willReadFrequently: true });
          sctx.drawImage(img, 0, 0, SIZE, SIZE);
          canvas._heights = decodeTerrariumTile(sctx.getImageData(0, 0, SIZE, SIZE).data);
          canvas._range = tileLandRange(canvas._heights);
          canvas._coords = coords;
          this._paint(canvas);
          done(null, canvas);
          this._rangeSoon();
        } catch (e) { done(e, canvas); }
      };
      img.onerror = () => done(new Error('elevation tile failed'), canvas);
      img.src = `${TILE_API_URL}/${coords.z}/${coords.x}/${coords.y}.png`;
      return canvas;
    },
    _paint(canvas) {
      if (!canvas._heights) return;
      const c = canvas._coords;
      const n = 2 ** c.z;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (c.y + 0.5)) / n))) * 180) / Math.PI;
      const data = shadeReliefTile(canvas._heights, { mpp: tileMetersPerPixel(c.z, lat), mode, range: this._range || canvas._range || [0, 1000] });
      canvas.getContext('2d').putImageData(new ImageData(data, SIZE, SIZE), 0, 0);
    },
    // (height colours stretch over the land on screen: worked out again, a moment
    // after tiles arrive or the map stops, and every tile repainted when it changed)
    _rangeSoon() {
      if (mode !== 'height') return;
      clearTimeout(this._rangeTimer);
      this._rangeTimer = setTimeout(() => this._updateRange(), 180);
    },
    _updateRange() {
      if (!this._map) return;
      const view = this._map.getPixelBounds();
      let lo = Infinity; let hi = -Infinity;
      for (const key of Object.keys(this._tiles || {})) {
        const t = this._tiles[key];
        if (!t.current || !t.el?._range) continue;
        const p = t.coords.scaleBy(this.getTileSize());
        if (p.x > view.max.x || p.y > view.max.y || p.x + this.getTileSize().x < view.min.x || p.y + this.getTileSize().y < view.min.y) continue;
        lo = Math.min(lo, t.el._range[0]); hi = Math.max(hi, t.el._range[1]);
      }
      if (!Number.isFinite(lo)) return;
      const old = this._range;
      const span = Math.max(1, hi - lo);
      if (old && Math.abs(old[0] - lo) < span * 0.02 && Math.abs(old[1] - hi) < span * 0.02) return;
      this._range = [lo, hi];
      for (const key of Object.keys(this._tiles)) this._paint(this._tiles[key].el);
      onRange?.(Math.round(lo), Math.round(hi));
    },
    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      map.on('moveend', this._rangeSoon, this);
    },
    onRemove(map) {
      map.off('moveend', this._rangeSoon, this);
      clearTimeout(this._rangeTimer);
      L.GridLayer.prototype.onRemove.call(this, map);
    },
  });
  return new Layer({
    tileSize: SIZE, maxNativeZoom: MAX_NATIVE_ZOOM, minNativeZoom: 0, maxZoom: 22, updateWhenZooming: false, keepBuffer: 1,
    attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (AWS Open Data)',
    ...layerOptions,
  });
}
