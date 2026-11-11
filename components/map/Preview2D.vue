<template>
  <!-- The 2D preview: the generated area flat, under the base texture chosen
       for the export, with what will be built drawn over it in its group's
       colour (faint where switched off). Pan, zoom, hover a feature. -->
  <div class="relative w-full h-full bg-gray-200 dark:bg-gray-900">
    <div ref="mapEl" class="absolute inset-0" />

    <div class="absolute top-4 left-4 z-[500] w-60 space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur p-3 shadow-lg text-xs text-gray-700 dark:text-gray-200">
      <label class="flex items-center justify-between gap-2" :class="terrainView === 'normal' ? '' : 'opacity-50'">
        <span>{{ t('preview2d.texture') }}</span>
        <select v-model="texture" :disabled="terrainView !== 'normal'" class="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-xs">
          <option v-for="o in textureOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
      </label>
      <!-- the land's photo, or its shape (as the 3D preview's terrain view) -->
      <div class="flex gap-0.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 p-0.5" role="radiogroup" :aria-label="t('preview.terrainView')">
        <button
          v-for="v in TERRAIN_VIEWS" :key="v" type="button" role="radio" :aria-checked="terrainView === v"
          class="flex-1 rounded px-1 py-1 text-caption transition-colors"
          :class="terrainView === v ? 'bg-brand text-white font-medium shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'"
          @click="terrainView = v"
        >{{ t(`preview.view_${v}`) }}</button>
      </div>
      <div v-if="terrainView === 'slope'" class="space-y-0.5">
        <div class="flex h-2 rounded overflow-hidden"><div v-for="b in SLOPE_BANDS" :key="b.deg" class="flex-1" :style="{ background: b.color }" /></div>
        <div class="flex text-micro text-gray-500 dark:text-gray-400"><span v-for="b in SLOPE_BANDS" :key="b.deg" class="flex-1">{{ b.deg }}°</span></div>
      </div>
      <div v-else-if="terrainView === 'elevation'" class="space-y-0.5">
        <div class="h-2 rounded" :style="{ background: `linear-gradient(to right, ${ELEVATION_RAMP.join(', ')})` }" />
        <div class="flex justify-between text-micro text-gray-500 dark:text-gray-400"><span>{{ Math.round(terrainData.minHeight) }} m</span><span>{{ Math.round(terrainData.maxHeight) }} m</span></div>
      </div>
      <label class="flex items-center justify-between gap-2 cursor-pointer">
        <span>{{ t('preview.contours', { m: contourStep }) }}</span>
        <input type="checkbox" v-model="showContours" class="accent-brand w-4 h-4" />
      </label>
      <!-- the export's backdrop: the eight tiles around the map, as satellite imagery -->
      <label v-if="hasBackdrop" class="flex items-center justify-between gap-2 cursor-pointer">
        <span>{{ t('preview2d.backdrop') }}</span>
        <input type="checkbox" v-model="showBackdrop" class="accent-brand w-4 h-4" />
      </label>
      <label class="flex items-center justify-between gap-2 cursor-pointer">
        <span>{{ t('preview2d.features') }}</span>
        <input type="checkbox" v-model="colourMap" class="accent-brand w-4 h-4" :disabled="!hasFeatures" />
      </label>
      <p v-if="!hasFeatures" class="text-caption text-amber-700 dark:text-amber-300">{{ t('preview2d.noFeatures') }}</p>
      <ul v-else-if="colourMap" class="space-y-0.5 pt-1 border-t border-gray-100 dark:border-gray-700/60">
        <li v-for="g in legend" :key="g.id" class="flex items-center gap-1.5 min-w-0" :class="g.on ? '' : 'opacity-40'">
          <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ background: g.colour }" />
          <span class="truncate text-caption">{{ g.label }}</span>
        </li>
      </ul>
      <p class="text-micro text-gray-500 dark:text-gray-400">{{ t('preview2d.hint') }}</p>
      <!-- what was downloaded for it: coarser than the map's own picture unless asked otherwise -->
      <p v-if="hasBackdrop && showBackdrop && backdropStatus === 'ready' && store.backdropImagery?.metresPerPixel && store.backdropSource === 'global30m'" class="text-micro text-gray-500 dark:text-gray-400">
        {{ t('preview2d.backdropQuality', { quality: t(`exportPanel.ui.backdropImagery_${store.backdropImagery.quality}`), mpp: store.backdropImagery.metresPerPixel.toFixed(1) }) }}
      </p>
      <p v-if="hasBackdrop && showBackdrop && backdropStatus !== 'ready'" class="text-micro text-gray-500 dark:text-gray-400" role="status">
        {{ backdropStatus === 'downloading' ? t('preview2d.backdropDownloading', { pct: backdropProgress })
          : backdropStatus === 'loading' ? t('preview2d.backdropLoading')
            : backdropStatus === 'failed' ? t('preview2d.backdropFailed') : t('preview2d.backdropWaiting') }}
      </p>
    </div>

    <div class="absolute bottom-4 right-4 z-[500] flex items-center gap-2">
      <!-- something looks off in the map data: straight to the editor, where the view is -->
      <button
        type="button"
        class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 px-3 py-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-200 shadow"
        :title="t('map.editInOsm')"
        @click="openInOsm"
      >{{ t('map.editInOsm') }}</button>
      <button
        type="button"
        class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 shadow hover:text-brand"
        @click="fit"
      >{{ t('preview2d.fit') }}</button>
    </div>

    <div
      v-if="hover"
      class="pointer-events-none absolute z-[600] max-w-xs rounded-md bg-gray-900/90 px-2 py-1 text-xs text-white shadow"
      :style="{ left: `${hover.x + 14}px`, top: `${hover.y + 14}px` }"
    >
      <div class="flex items-center gap-1.5 font-semibold">
        <span class="w-2 h-2 rounded-sm" :style="{ background: hover.colour }" />{{ hover.title }}
      </div>
      <div v-if="hover.name" class="opacity-90">{{ hover.name }}</div>
      <div class="opacity-75">{{ hover.on ? t('preview2d.built') : t('preview2d.notBuilt') }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, toRaw } from 'vue';
import { useI18n } from 'vue-i18n';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { attachContentLayer } from './contentLayer.js';
import { useMainStore } from '../../stores/mainStore';
import { useBaseTexture } from '../../composables/useBaseTexture.js';
import { colourMap, effectiveOff } from '../../composables/useBuildContent.js';
import { CONTENT_GROUPS, ROAD_CLASS_IDS } from '../../services/buildContent.js';
import { GROUP_COLOURS } from '../../services/buildContentColours.js';
import { terrainView, showContours } from '../../composables/useTerrainView.js';
import { TERRAIN_VIEWS, SLOPE_BANDS, ELEVATION_RAMP, contourInterval } from '../three/terrainView.js';
import { sampleHeights, shadeTerrain, contourPixels } from '../../services/terrainView2d.js';
import { POSITIONS, getAdjacentBounds } from '../../services/surroundingTiles.js';

const props = defineProps({ terrainData: { type: Object, required: true } });
const { t } = useI18n({ useScope: 'global' });
const store = useMainStore();
const { baseTexture, setBaseTexture } = useBaseTexture();

const mapEl = ref(null);
const hover = ref(null);
let map = null; let overlay = null; let content = null; let outline = null;

const td = () => toRaw(props.terrainData);
const hasFeatures = computed(() => !!props.terrainData?.osmFeatures?.length);
const off = computed(() => effectiveOff(store.advancedMode));

// the textures this terrain has, in the export panel's words
const urlOf = (kind) => {
  const d = td(); if (!d) return null;
  const canvasUrl = (c) => { try { return c?.toDataURL ? c.toDataURL('image/jpeg', 0.9) : null; } catch { return null; } };
  if (kind === 'game') return d.gameTextureUrl || canvasUrl(d.gameTextureCanvas);
  if (kind === 'hybrid') return d.hybridTextureUrl || canvasUrl(d.hybridTextureCanvas);
  if (kind === 'satellite') return d.satelliteTextureUrl || null;
  if (kind === 'osm') return d.osmTextureUrl || null;
  return null;
};
const textureOptions = computed(() => {
  void store.textureRevision;
  return [
    { id: 'game', label: t('exportPanel.gameTexture') },
    { id: 'hybrid', label: t('exportPanel.satelliteHybrid') },
    { id: 'satellite', label: t('exportPanel.satellite') },
    { id: 'osm', label: t('exportPanel.osm') },
  ].filter((o) => !!urlOf(o.id)).concat([{ id: 'none', label: t('exportPanel.none') }]);
});
// (shared with the export panel and the 3D preview; 'painted' shows the texture it was painted on)
const texture = computed({
  get: () => {
    const want = baseTexture.value === 'painted' ? (td()?.paintedTextureSource || 'hybrid') : baseTexture.value;
    if (want === 'none' || urlOf(want)) return want;
    return textureOptions.value[0]?.id || 'none';
  },
  set: (v) => setBaseTexture(v),
});

const legend = computed(() => CONTENT_GROUPS.map((g) => ({
  id: g.id, colour: GROUP_COLOURS[g.id], label: t(`build.group_${g.id}`),
  on: g.items.some((it) => !off.value.includes(it.id)),
})));

const bounds = () => { const b = td()?.bounds; return b ? L.latLngBounds([b.south, b.west], [b.north, b.east]) : null; };
// (clear of the panel on the left and the view tabs along the top)
const fit = () => { const b = bounds(); if (map && b) map.fitBounds(b, { paddingTopLeft: [264, 72], paddingBottomRight: [24, 24], animate: false }); };

// The backdrop (the export's "Include backdrop"): the eight tiles around the
// map, as the export's data step downloaded them (services/exportData.js):
// each tile's own satellite picture, or its terrain in the view chosen. Read
// back from the cache once that step is done; nothing is fetched for the
// preview. Until then the tiles' outlines, and how the download is going.
const hasBackdrop = computed(() => !!store.backdropSource && store.backdropSource !== 'off');
const readBackdropPref = () => { try { return localStorage.getItem('mapng_preview2d_backdrop') !== 'false'; } catch { return true; } };
const showBackdrop = ref(readBackdropPref());
watch(showBackdrop, (v) => { try { localStorage.setItem('mapng_preview2d_backdrop', String(v)); } catch { /* not kept */ } });
const ringBounds = () => {
  const b = td()?.bounds; if (!b) return null;
  const lat = b.north - b.south; const lng = b.east - b.west;
  return L.latLngBounds([b.south - lat, b.west - lng], [b.north + lat, b.east + lng]);
};
const backdropStatus = ref('idle');     // idle | waiting | downloading | loading | ready | failed
const backdropProgress = ref(0);
let backdropTiles = null; let backdropKey = '';
let backdropGroup = null; let dataApi = null; let offData = null; let loadTicket = 0;
const BACKDROP_VIEW_PX = 512;            // (a tile's terrain view, a side)
const tileLayer = (pos, tile) => {
  const tb = L.latLngBounds([tile.bounds.south, tile.bounds.west], [tile.bounds.north, tile.bounds.east]);
  const opts = { interactive: false, pane: 'mapngBackdrop', className: 'mapng-preview2d-backdrop' };
  if (terrainView.value !== 'normal' && tile.heightMap && tile.width > 1) {
    const d = td(); const metres = ((tile.bounds.north - tile.bounds.south) * 111320) / tile.height;
    const s = sampleHeights(tile.heightMap, tile.width, tile.height, metres, BACKDROP_VIEW_PX);
    // (heights on the map's own scale: one ramp across the map and its surroundings)
    const pixels = shadeTerrain(s, terrainView.value, { minHeight: Number(d?.minHeight) || 0, maxHeight: Number(d?.maxHeight) || 1 });
    return new CanvasOverlay(canvasOf(pixels, s.w, s.hgt), tb, opts);
  }
  return tile.satelliteDataUrl ? L.imageOverlay(tile.satelliteDataUrl, tb, opts) : null;
};
const drawBackdrop = () => {
  if (!map) return;
  if (backdropGroup) { map.removeLayer(backdropGroup); backdropGroup = null; }
  const b = td()?.bounds; const ring = ringBounds(); const area = bounds();
  const on = hasBackdrop.value && showBackdrop.value && !!b && !!ring;
  if (area) {
    // (no further out than the whole of what is shown, with a margin)
    const extent = on ? ring : area;
    map.setMaxBounds(extent.pad(0.5));
    map.setMinZoom(Math.max(1, map.getBoundsZoom(extent.pad(0.25)) - 0.5));
  }
  if (!on) return;
  const layers = [];
  for (const pos of POSITIONS) {
    const tile = backdropTiles?.[pos.key];
    const layer = tile ? tileLayer(pos.key, tile) : null;
    if (layer) layers.push(layer);
    const t = getAdjacentBounds(b, pos.key);
    layers.push(L.rectangle([[t.south, t.west], [t.north, t.east]], { color: tile ? '#ffffff' : '#6b7280', weight: 1, opacity: 0.7, dashArray: '4 4', fill: !tile, fillColor: '#9ca3af', fillOpacity: 0.12, interactive: false, pane: 'mapngBackdrop' }));
  }
  backdropGroup = L.layerGroup(layers).addTo(map);
};
// where the data step is with the backdrop, and its tiles once it is done
const syncBackdrop = async () => {
  const d = td(); const opts = store.exportDataOptions;
  if (!hasBackdrop.value || !d || !opts) { backdropTiles = null; backdropKey = ''; backdropStatus.value = 'idle'; drawBackdrop(); return; }
  dataApi = dataApi || await import('../../services/exportData.js');
  if (!offData) offData = dataApi.onExportDataChange(() => { syncBackdrop(); });
  const needs = dataApi.exportDataNeeds(d, opts);
  const st = dataApi.exportDataState(d, opts);
  if (!needs?.backdrop || !st) { backdropStatus.value = 'idle'; return; }
  if (needs.key !== backdropKey) { backdropTiles = null; backdropKey = needs.key; drawBackdrop(); }
  if (st.status === 'failed') { backdropStatus.value = 'failed'; return; }
  if (st.status !== 'done') { backdropStatus.value = st.status === 'running' ? 'downloading' : 'waiting'; backdropProgress.value = Math.round((st.fraction || 0) * 100); return; }
  if (backdropTiles || backdropStatus.value === 'loading') { if (backdropTiles) backdropStatus.value = 'ready'; return; }
  backdropStatus.value = 'loading';
  const ticket = ++loadTicket;
  try {
    const tiles = await dataApi.loadBackdropTiles(d, opts);
    if (ticket !== loadTicket || needs.key !== backdropKey) return;
    backdropTiles = tiles; backdropStatus.value = 'ready'; drawBackdrop();
  } catch (err) {
    console.warn('[2D preview] the backdrop could not be read back:', err?.message || err);
    if (ticket === loadTicket) backdropStatus.value = 'failed';
  }
};

// OpenStreetMap's editor on what the view shows (it edits from zoom 16 in)
const openInOsm = () => {
  const c = map ? map.getCenter() : bounds()?.getCenter();
  if (!c) return;
  const zoom = Math.max(16, Math.min(21, Math.round(map ? map.getZoom() : 17)));
  window.open(`https://www.openstreetmap.org/edit?editor=id#map=${zoom}/${c.lat.toFixed(6)}/${c.lng.toFixed(6)}`, '_blank', 'noopener,noreferrer');
};

// The Game texture from its own canvas, when it has one: a display copy (at
// most DISPLAY_MAX_PX a side) redrawn whenever the texture is repainted in
// place, which is every frame while the Satellite detail slider moves. An
// image overlay from a URL would need the texture encoded again each time.
const DISPLAY_MAX_PX = 2048;
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const el = this._image = this._url;   // (a canvas element)
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    if (this.options.className) L.DomUtil.addClass(el, this.options.className);
    el.onselectstart = L.Util.falseFn; el.onmousemove = L.Util.falseFn;
  },
});
let display = null; let shownKind = null;
const paintDisplay = () => {
  const source = td()?.gameTextureCanvas; if (!display || !source) return;
  const size = Math.min(DISPLAY_MAX_PX, source.width);
  if (display.width !== size) { display.width = size; display.height = size; }
  const ctx = display.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
};

// The terrain views (relief, slope, height) and the contour lines, drawn from
// the heightmap (services/terrainView2d.js) at up to DISPLAY_MAX_PX a side.
const contourStep = computed(() => contourInterval((Number(props.terrainData?.maxHeight) || 0) - (Number(props.terrainData?.minHeight) || 0)));
let sampled = null; let sampledFor = null;
const heights = () => {
  const d = td(); if (!d?.heightMap || !(d.width > 1)) return null;
  if (sampledFor !== d.heightMap) { sampled = sampleHeights(d.heightMap, d.width, d.height, Number(d.processingMetersPerPixel) || 1, DISPLAY_MAX_PX); sampledFor = d.heightMap; }
  return sampled;
};
const canvasOf = (pixels, w, hgt, canvas) => {
  const c = canvas || document.createElement('canvas');
  if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
  c.getContext('2d').putImageData(new ImageData(pixels, w, hgt), 0, 0);
  return c;
};
let shadeCanvas = null; let contourCanvas = null; let contourOverlay = null;
const drawContours = () => {
  if (!map) return;
  const b = bounds(); const s = showContours.value ? heights() : null;
  if (contourOverlay) { map.removeLayer(contourOverlay); contourOverlay = null; }
  if (!s || !b) return;
  contourCanvas = canvasOf(contourPixels(s, contourStep.value, { light: terrainView.value === 'normal' && texture.value !== 'none' }), s.w, s.hgt, contourCanvas);
  contourOverlay = new CanvasOverlay(contourCanvas, b, { interactive: false, className: 'mapng-preview2d-contours', pane: 'mapngContours' }).addTo(map);
};

const drawTexture = () => {
  if (!map) return;
  const b = bounds(); if (!b) return;
  // (a terrain view: the land's shape in place of its photo)
  const shape = terrainView.value !== 'normal' ? heights() : null;
  if (shape) {
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    const d = td();
    shadeCanvas = canvasOf(shadeTerrain(shape, terrainView.value, { minHeight: Number(d.minHeight) || 0, maxHeight: Number(d.maxHeight) || 1 }), shape.w, shape.hgt, shadeCanvas);
    shownKind = `view:${terrainView.value}`;
    overlay = new CanvasOverlay(shadeCanvas, b, { interactive: false, className: 'mapng-preview2d-texture', pane: 'mapngTexture' }).addTo(map);
    if (!outline) outline = L.rectangle(b, { color: '#f97316', weight: 1.5, fill: false, interactive: false }).addTo(map); else outline.setStyle({ fill: false });
    return;
  }
  const kind = texture.value;
  const fromCanvas = kind === 'game' && !!td()?.gameTextureCanvas;
  // (the same canvas overlay still up: only its pixels change)
  if (fromCanvas && overlay && shownKind === 'game:canvas') { paintDisplay(); return; }
  const url = kind === 'none' || fromCanvas ? null : urlOf(kind);
  if (overlay) { map.removeLayer(overlay); overlay = null; }
  shownKind = fromCanvas ? 'game:canvas' : kind;
  // (its own pane, under the features' canvas: Leaflet's overlay pane lies over it)
  const opts = { interactive: false, className: 'mapng-preview2d-texture', pane: 'mapngTexture' };
  if (fromCanvas) { display = display || document.createElement('canvas'); paintDisplay(); overlay = new CanvasOverlay(display, b, opts).addTo(map); }
  else if (url) overlay = L.imageOverlay(url, b, opts).addTo(map);
  const shown = fromCanvas || !!url;
  if (!outline) outline = L.rectangle(b, { color: '#f97316', weight: 1.5, fill: !shown, fillColor: '#9ca3af', fillOpacity: 0.25, interactive: false }).addTo(map);
  else outline.setStyle({ fill: !shown });
};

// what is under the cursor: the content layer's own hit test
let hoverRaf = 0;
const onMove = (e) => {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const hit = colourMap.value ? content?.hitTest(e.containerPoint) : null;
    if (!hit) { hover.value = null; return; }
    hover.value = {
      x: e.containerPoint.x, y: e.containerPoint.y,
      colour: GROUP_COLOURS[hit.group] || '#64748b',
      title: t(`build.item_${hit.item}`),
      name: hit.feature?.tags?.name || hit.feature?.tags?.ref || '',
      on: !off.value.includes(hit.item),
    };
  });
};

onMounted(() => {
  map = L.map(mapEl.value, { zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, maxZoom: 22, minZoom: 8, inertia: true });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.createPane('mapngBackdrop').style.zIndex = '240';
  map.getPane('mapngBackdrop').style.pointerEvents = 'none';
  map.createPane('mapngTexture').style.zIndex = '250';
  map.createPane('mapngContours').style.zIndex = '260';
  map.getPane('mapngContours').style.pointerEvents = 'none';
  const b = bounds();
  if (b) fit();
  drawBackdrop();
  syncBackdrop();
  drawTexture();
  drawContours();
  content = attachContentLayer(map, {
    getFeatures: () => td()?.osmFeatures || null,
    isShown: () => colourMap.value && hasFeatures.value,
    // (a road class shows as built only while Road surfaces is on too)
    isOn: (id) => !off.value.includes(id) && !(ROAD_CLASS_IDS.includes(id) && off.value.includes('roadSurfaces')),
  });
  content.update();
  map.on('mousemove', onMove);
  map.on('mouseout', () => { hover.value = null; });
  if (import.meta.env.DEV) window.__mapngPreview2d = map;
});
onBeforeUnmount(() => { offData?.(); loadTicket++; if (hoverRaf) cancelAnimationFrame(hoverRaf); content?.remove(); map?.remove(); map = null; });

watch(() => [texture.value, store.textureRevision, terrainView.value], drawTexture);
watch(() => [hasBackdrop.value, store.exportDataOptions], syncBackdrop);
watch(() => [hasBackdrop.value, showBackdrop.value, terrainView.value], drawBackdrop);
watch(() => [showContours.value, contourStep.value, terrainView.value === 'normal', texture.value === 'none'], drawContours);
watch(() => [colourMap.value, off.value, store.advancedMode], () => { content?.update(); if (!colourMap.value) hover.value = null; });
watch(() => props.terrainData, () => { outline && map?.removeLayer(outline); outline = null; shownKind = null; sampledFor = null; backdropTiles = null; backdropKey = ''; drawTexture(); drawContours(); drawBackdrop(); syncBackdrop(); content?.update(); fit(); });
</script>

<style>
/* (the texture's own pixels when zoomed in, not a blur) */
.mapng-preview2d-texture { image-rendering: auto; }
.mapng-preview2d-contours { image-rendering: auto; pointer-events: none; }
</style>
