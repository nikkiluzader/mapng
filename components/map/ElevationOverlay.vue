<template>
  <div class="absolute bottom-6 left-4 z-[401] pointer-events-none select-none">
    <!-- Expanded window -->
    <div
      v-if="visible"
      class="rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 overflow-hidden bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
    >
      <div class="pointer-events-auto bg-gray-50 dark:bg-gray-700 px-3 py-1.5 border-b border-gray-200 dark:border-gray-600 flex items-center gap-2 text-xs font-medium">
        <Mountain :size="13" class="text-brand shrink-0" />
        <span class="flex-1 truncate">{{ t('mapSelector.elevationOverlay.title') }}</span>
        <button
          class="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          :title="t('mapSelector.elevationOverlay.hide')"
          @click="setVisible(false)"
        >
          <X :size="13" />
        </button>
      </div>
      <!-- pointer-events stay off so users can pan/zoom the main map through the window -->
      <div ref="miniMapEl" class="w-60 h-44 bg-gray-200 dark:bg-gray-900"></div>
      <div class="pointer-events-auto px-3 py-1 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex items-center gap-1.5 text-micro text-gray-500 dark:text-gray-400">
        <span class="inline-block w-2 h-2 rounded shrink-0" style="background:#FF00FF"></span>
        <span class="truncate">{{ t('mapSelector.elevationOverlay.legend') }}</span>
      </div>
    </div>

    <!-- Collapsed toggle button -->
    <button
      v-else
      class="pointer-events-auto p-2 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      :title="t('mapSelector.elevationOverlay.show')"
      @click="setVisible(true)"
    >
      <Mountain :size="16" class="text-brand" />
    </button>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import L from 'leaflet';
import { Mountain, X } from 'lucide-vue-next';
import { TERRAIN_ZOOM, TILE_API_URL } from '../../services/terrain';

const props = defineProps({
  // Selection area {north, south, east, west} the minimap stays fitted to:
  // the export bounding box, crop box, or batch grid extent.
  bounds: { type: Object, default: null },
});

const { t } = useI18n({ useScope: 'global' });

const VISIBLE_KEY = 'mapng_elev_overlay_visible';
const visible = ref(localStorage.getItem(VISIBLE_KEY) !== '0');
const miniMapEl = ref(null);

const NODATA_COLOR = [255, 0, 255];

// Hypsometric tint stops: [elevation m, [r, g, b]]. Fixed globally so the same
// terrain always gets the same color regardless of the current view.
// Bathymetry stops are deliberately compressed: depth detail is irrelevant
// for terrain exports, and Terrarium's coastal depth spikes must stay
// readable as "blue water", never near-black. The -1..+3 m "tidal band"
// fades water into land gradually because Terrarium's ocean is noisy
// (±1 m around zero) — a hard 0 split turns shallow seas into a green/blue
// patchwork.
const RAMP = [
  [-11000, [44, 80, 138]],
  [-3000, [56, 94, 154]],
  [-200, [76, 120, 180]],
  [-1, [120, 160, 195]],
  [0, [148, 176, 196]],
  [1, [140, 165, 140]],
  [3, [96, 136, 82]],
  [250, [114, 148, 74]],
  [700, [180, 174, 102]],
  [1400, [160, 122, 72]],
  [2200, [128, 96, 76]],
  [3000, [182, 172, 162]],
  [4000, [255, 255, 255]],
];

const rampColor = (h) => {
  if (h <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) {
      const [h0, c0] = RAMP[i - 1];
      const [h1, c1] = RAMP[i];
      const f = (h - h0) / (h1 - h0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
};

// Deeper than any real point on Earth (Challenger Deep ≈ -10935 m). Terrarium
// coastline tiles contain pixels blended between land values and the -32768
// nodata sentinel, yielding garbage like -8000..-30000 m along shores; treat
// everything below this floor as corrupt so it shows magenta, not deep ocean.
const CORRUPT_FLOOR = -12000;

// Same decode rule as services/terrain.js (<= -32760 is the nodata sentinel),
// widened to the plausibility floor above.
const decodeHeight = (r, g, b) => {
  const h = r * 256 + g + b / 256 - 32768;
  return h < CORRUPT_FLOOR ? null : h;
};

const drawMissingTile = (canvas) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = 'rgba(120, 120, 120, 0.35)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
  ctx.lineWidth = 3;
  for (let x = -canvas.height; x < canvas.width; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, canvas.height);
    ctx.lineTo(x + canvas.height, 0);
    ctx.stroke();
  }
};

// Web-mercator ground resolution (m/px) at this tile's latitude, used to scale
// the hillshade gradients so relief looks consistent across latitudes.
const tileMetersPerPixel = (coords) => {
  const n = Math.PI * (1 - (2 * (coords.y + 0.5)) / 2 ** coords.z);
  const latRad = Math.atan(Math.sinh(n));
  return (156543.03392 * Math.cos(latRad)) / 2 ** coords.z;
};

const SUN_AZIMUTH = (315 * Math.PI) / 180;
const SUN_ZENITH = (45 * Math.PI) / 180;

const renderTerrariumTile = async (canvas, coords, signal) => {
  const url = `${TILE_API_URL}/${coords.z}/${coords.x}/${coords.y}.png`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`tile ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());

  const w = bitmap.width;
  const h = bitmap.height;
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sCtx = scratch.getContext('2d', { willReadFrequently: true });
  sCtx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const src = sCtx.getImageData(0, 0, w, h).data;

  // Decode all heights first so hillshading can read neighbors.
  const heights = new Float32Array(w * h);
  const nodata = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
    const height = decodeHeight(src[p], src[p + 1], src[p + 2]);
    if (height === null) {
      nodata[i] = 1;
      heights[i] = 0;
    } else {
      heights[i] = height;
    }
  }

  const mpp = tileMetersPerPixel(coords);
  const out = sCtx.createImageData(w, h);
  const dst = out.data;
  const cosZ = Math.cos(SUN_ZENITH);
  const sinZ = Math.sin(SUN_ZENITH);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (nodata[i]) {
        dst[p] = NODATA_COLOR[0];
        dst[p + 1] = NODATA_COLOR[1];
        dst[p + 2] = NODATA_COLOR[2];
        dst[p + 3] = 255;
        continue;
      }

      // Horn hillshade over a 3x3 window, clamped at tile edges. Nodata
      // neighbors fall back to the center height so holes stay flat instead
      // of casting fake cliffs around them. Heights are floored at sea level
      // for shading only: Terrarium coastal bathymetry is coarse and
      // misaligned (thousand-meter steps a pixel off the beach), and shading
      // it paints black cliff shadows along every coastline.
      const cH = heights[i];
      const base = Math.max(0, cH);
      const at = (xx, yy) => {
        const cx = Math.min(w - 1, Math.max(0, xx));
        const cy = Math.min(h - 1, Math.max(0, yy));
        const ci = cy * w + cx;
        return nodata[ci] ? base : Math.max(0, heights[ci]);
      };
      const nw = at(x - 1, y - 1); const nn = at(x, y - 1); const ne = at(x + 1, y - 1);
      const ww = at(x - 1, y); const ee = at(x + 1, y);
      const sw = at(x - 1, y + 1); const ss = at(x, y + 1); const se = at(x + 1, y + 1);
      const dzdx = ((ne + 2 * ee + se) - (nw + 2 * ww + sw)) / (8 * mpp);
      const dzdy = ((sw + 2 * ss + se) - (nw + 2 * nn + ne)) / (8 * mpp);
      const slope = Math.atan(1.3 * Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(SUN_AZIMUTH - aspect));

      const color = rampColor(cH);
      const light = 0.45 + 0.55 * shade;
      dst[p] = color[0] * light;
      dst[p + 1] = color[1] * light;
      dst[p + 2] = color[2] * light;
      dst[p + 3] = 255;
    }
  }

  canvas.getContext('2d').putImageData(out, 0, 0);
};

const TerrariumHillshadeLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize();
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    tile.width = size.x;
    tile.height = size.y;
    const controller = new AbortController();
    tile._abort = controller;
    renderTerrariumTile(tile, coords, controller.signal)
      .then(() => done(null, tile))
      .catch((error) => {
        if (error?.name !== 'AbortError') drawMissingTile(tile);
        done(null, tile);
      });
    return tile;
  },
  _removeTile(key) {
    this._tiles[key]?.el?._abort?.abort();
    L.GridLayer.prototype._removeTile.call(this, key);
  },
});

let miniMap = null;
let selectionRect = null;

const hasValidBounds = () => {
  const b = props.bounds;
  return !!b && [b.north, b.south, b.east, b.west].every((v) => Number.isFinite(v));
};

const syncToBounds = () => {
  if (!miniMap || !hasValidBounds()) return;
  const b = props.bounds;
  const llBounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
  selectionRect.setBounds(llBounds);
  miniMap.fitBounds(llBounds, { animate: false });
};

const initMiniMap = () => {
  if (miniMap || !hasValidBounds() || !miniMapEl.value) return;
  miniMap = L.map(miniMapEl.value, {
    attributionControl: false,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    minZoom: 0,
    maxZoom: 22,
  });
  new TerrariumHillshadeLayer({
    maxNativeZoom: TERRAIN_ZOOM,
    updateWhenIdle: true,
    keepBuffer: 1,
  }).addTo(miniMap);
  // Mirror of the main map's selection rectangle so the matching area is explicit.
  selectionRect = L.rectangle([[0, 0], [0, 0]], {
    color: '#FF6600',
    weight: 1.5,
    fill: false,
    dashArray: '2, 8',
    lineCap: 'round',
    interactive: false,
  }).addTo(miniMap);
  syncToBounds();
};

const destroyMiniMap = () => {
  if (miniMap) {
    miniMap.remove();
    miniMap = null;
    selectionRect = null;
  }
};

const setVisible = (value) => {
  visible.value = value;
  localStorage.setItem(VISIBLE_KEY, value ? '1' : '0');
};

watch(
  [() => props.bounds, visible],
  async ([bounds, isVisible]) => {
    if (bounds && isVisible) {
      await nextTick();
      if (miniMap) {
        syncToBounds();
      } else {
        initMiniMap();
      }
    } else if (!isVisible) {
      destroyMiniMap();
    }
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(destroyMiniMap);
</script>
