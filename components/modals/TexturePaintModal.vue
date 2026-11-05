<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full h-full max-w-[1400px] max-h-[92vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800 shrink-0">
        <div class="flex items-center gap-2.5">
          <div class="p-1.5 bg-brand rounded-lg shadow-sm">
            <Paintbrush :size="15" class="text-white" />
          </div>
          <div>
            <h2 class="text-sm font-bold text-gray-900 dark:text-white leading-tight">{{ t('exportPanel.texturePaint.title') }}</h2>
            <p class="text-micro text-gray-500 dark:text-gray-400">{{ sourceLabel }} · {{ nativeWidth }}×{{ nativeHeight }}px</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="handleSave"
            :disabled="!hasUnsavedChanges || isSaving"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand text-white hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Loader2 v-if="isSaving" :size="12" class="animate-spin" />
            <Check v-else :size="12" />
            {{ t('exportPanel.texturePaint.save') }}
          </button>
          <button
            @click="requestClose"
            class="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap bg-white dark:bg-gray-900 shrink-0 text-gray-600 dark:text-gray-300">
        <!-- Tools -->
        <div class="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            v-for="toolDef in TOOLS"
            :key="toolDef.id"
            @click="tool = toolDef.id"
            :title="t(`exportPanel.texturePaint.${toolDef.id}`) + ` (${toolDef.key})`"
            :class="['p-1.5 rounded-lg transition-colors', tool === toolDef.id ? 'bg-brand text-white shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
          >
            <component :is="toolDef.icon" :size="14" />
          </button>
        </div>

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>

        <!-- Color -->
        <div class="relative">
          <button
            @click="showColorPicker = !showColorPicker"
            :title="t('exportPanel.texturePaint.color')"
            class="w-7 h-7 rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-inner"
            :style="{ background: color }"
          ></button>
          <!-- Color picker popover -->
          <div
            v-if="showColorPicker"
            class="absolute top-9 left-0 z-20 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-600 space-y-2.5"
            @pointerdown.stop
          >
            <canvas
              ref="pickerCanvas"
              width="176"
              height="176"
              class="cursor-crosshair touch-none"
              @pointerdown="onPickerPointerDown"
            ></canvas>
            <div class="flex items-center gap-1.5">
              <span class="text-micro text-gray-400">{{ t('exportPanel.texturePaint.hex') }}</span>
              <input
                v-model="hexInput"
                @change="applyHexInput"
                maxlength="7"
                spellcheck="false"
                class="w-20 text-caption font-mono bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5"
              />
              <div class="w-5 h-5 rounded border border-gray-300 dark:border-gray-600" :style="{ background: color }"></div>
            </div>
            <div class="flex flex-wrap gap-1 max-w-[176px]">
              <button
                v-for="swatch in PRESET_SWATCHES"
                :key="'preset-' + swatch"
                @click="setColor(swatch)"
                class="w-4.5 h-4.5 w-[18px] h-[18px] rounded border border-black/10 dark:border-white/10"
                :style="{ background: swatch }"
              ></button>
            </div>
            <div v-if="recentColors.length" class="space-y-1">
              <div class="text-nano uppercase tracking-wider text-gray-400">{{ t('exportPanel.texturePaint.recent') }}</div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="(swatch, idx) in recentColors"
                  :key="'recent-' + idx"
                  @click="setColor(swatch)"
                  class="w-[18px] h-[18px] rounded border border-black/10 dark:border-white/10"
                  :style="{ background: swatch }"
                ></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Brush size -->
        <div class="flex items-center gap-1.5">
          <span class="text-micro text-gray-400">{{ t('exportPanel.texturePaint.size') }}</span>
          <input type="range" min="1" max="400" v-model.number="brushSize" class="w-96 accent-brand" />
          <span class="text-micro w-8 tabular-nums">{{ brushSize }}px</span>
        </div>

        <!-- Opacity -->
        <div class="flex items-center gap-1.5">
          <span class="text-micro text-gray-400">{{ t('exportPanel.texturePaint.opacity') }}</span>
          <input type="range" min="5" max="100" v-model.number="brushOpacity" class="w-20 accent-brand" />
          <span class="text-micro w-8 tabular-nums">{{ brushOpacity }}%</span>
        </div>

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>

        <!-- History -->
        <button @click="undo" :disabled="!canUndo" :title="t('exportPanel.texturePaint.undo')" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed">
          <Undo2 :size="14" />
        </button>
        <button @click="redo" :disabled="!canRedo" :title="t('exportPanel.texturePaint.redo')" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed">
          <Redo2 :size="14" />
        </button>
        <button @click="resetStrokes" :title="t('exportPanel.texturePaint.reset')" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-red-400 hover:text-red-500">
          <RotateCcw :size="14" />
        </button>

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>

        <!-- View -->
        <button @click="fitToView(); requestRedraw()" :title="t('exportPanel.texturePaint.fit')" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <Maximize :size="14" />
        </button>
        <button @click="zoomToActual" title="100%" class="px-1.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-micro tabular-nums">
          {{ Math.round(zoom * 100) }}%
        </button>
        <button
          @pointerdown="peekOriginal = true"
          @pointerup="peekOriginal = false"
          @pointerleave="peekOriginal = false"
          :title="t('exportPanel.texturePaint.peek')"
          :class="['p-1.5 rounded-lg transition-colors', peekOriginal ? 'bg-brand text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800']"
        >
          <Eye :size="14" />
        </button>
      </div>

      <!-- Canvas area -->
      <div
        ref="viewportEl"
        class="flex-1 relative overflow-hidden mapng-paint-checker touch-none"
        :style="{ cursor: viewportCursor }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
      >
        <canvas ref="displayCanvas" class="absolute inset-0 w-full h-full"></canvas>
        <!-- Brush cursor preview -->
        <div
          v-if="showBrushCursor"
          class="absolute pointer-events-none rounded-full border border-white"
          style="box-shadow: 0 0 0 1px rgba(0,0,0,0.6); transform: translate(-50%, -50%);"
          :style="{
            left: cursorPos.x + 'px',
            top: cursorPos.y + 'px',
            width: Math.max(4, brushSize * zoom) + 'px',
            height: Math.max(4, brushSize * zoom) + 'px',
          }"
        ></div>
        <div v-if="isLoadingSource" class="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-950/70">
          <Loader2 :size="32" class="text-brand animate-spin" />
        </div>

        <!-- Polygon selection chip -->
        <div
          v-if="selectedPolygon"
          class="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/95 dark:bg-gray-800/95 shadow-lg border border-gray-200 dark:border-gray-600 text-caption text-gray-700 dark:text-gray-200"
          @pointerdown.stop
        >
          <Hexagon :size="12" class="text-brand" />
          <span>{{ t('exportPanel.texturePaint.polygonSelected') }}</span>
          <button
            @click="applyPolygonRecolor"
            class="flex items-center gap-1 px-2 py-0.5 rounded bg-brand text-white font-medium hover:bg-brand-500 transition-colors"
          >
            <span class="w-2.5 h-2.5 rounded border border-white/60" :style="{ background: color }"></span>
            {{ t('exportPanel.texturePaint.applyColor') }}
          </button>
          <button @click="clearPolygonSelection" class="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X :size="12" />
          </button>
        </div>

        <!-- Polygon draft hint -->
        <div
          v-else-if="tool === 'polygon' && polygonDraftCount > 0"
          class="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-white/95 dark:bg-gray-800/95 shadow-lg border border-gray-200 dark:border-gray-600 text-micro text-gray-500 dark:text-gray-400 pointer-events-none"
        >
          {{ t('exportPanel.texturePaint.polygonDraftHint') }}
        </div>

        <!-- Clone source hint -->
        <div
          v-else-if="tool === 'clone' && !hasCloneSource"
          class="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-white/95 dark:bg-gray-800/95 shadow-lg border border-gray-200 dark:border-gray-600 text-micro text-gray-500 dark:text-gray-400 pointer-events-none"
        >
          {{ t('exportPanel.texturePaint.cloneSourceHint') }}
        </div>
      </div>

      <!-- Footer hint -->
      <div class="px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0 flex items-center justify-between">
        <span class="text-nano text-gray-400 dark:text-gray-500">{{ t('exportPanel.texturePaint.hint') }}</span>
        <span class="text-nano text-gray-400 dark:text-gray-500">{{ t('exportPanel.texturePaint.eraserHint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Paintbrush, Eraser, Pipette, Hand, Undo2, Redo2, RotateCcw,
  Maximize, Check, X, Eye, Loader2, Hexagon, Stamp,
} from 'lucide-vue-next';

const props = defineProps({
  // Blob/object URL of the texture being touched up (native resolution).
  sourceUrl: { type: String, required: true },
  // Optional transparent paint-layer URL from a previous session to resume.
  resumeUrl: { type: String, default: '' },
  sourceLabel: { type: String, default: '' },
});

const emit = defineEmits(['close', 'save']);
const { t } = useI18n({ useScope: 'global' });

// ─── Constants ──────────────────────────────────────────────────────
const MAX_HISTORY = 20;
// Paint layer works at most at this resolution; the original base texture is
// always kept and composited at native resolution on save, so only stroke
// edges soften on very large textures. Keeps memory bounded (4 offscreen
// canvases even for an 8192px source would be ~1 GB unclamped).
const EDIT_MAX = 4096;
const PRESET_SWATCHES = [
  '#4c7a44', '#729449', '#b4ae66', '#a07a48', '#806054', '#b6aca2',
  '#8fb0c4', '#3f6a90', '#c9c1b1', '#e0d8c8', '#5c5c5c', '#2e2e2e',
];

const TOOLS = [
  { id: 'brush', icon: Paintbrush, key: 'B' },
  { id: 'eraser', icon: Eraser, key: 'E' },
  { id: 'polygon', icon: Hexagon, key: 'P' },
  { id: 'clone', icon: Stamp, key: 'S' },
  { id: 'eyedropper', icon: Pipette, key: 'I' },
  { id: 'pan', icon: Hand, key: 'H' },
];

// ─── UI state ───────────────────────────────────────────────────────
const tool = ref('brush');
const color = ref('#4c7a44');
const hexInput = ref('#4c7a44');
const brushSize = ref(48);
const brushOpacity = ref(100);
const recentColors = ref([]);
const showColorPicker = ref(false);
const peekOriginal = ref(false);
const isLoadingSource = ref(true);
const isSaving = ref(false);
const hasUnsavedChanges = ref(false);
const zoom = ref(1);
const cursorPos = ref({ x: 0, y: 0 });
const cursorInside = ref(false);
const nativeWidth = ref(0);
const nativeHeight = ref(0);
const historyLength = ref(0);
const redoLength = ref(0);

const viewportEl = ref(null);
const displayCanvas = ref(null);
const pickerCanvas = ref(null);

const canUndo = computed(() => historyLength.value > 0);
const canRedo = computed(() => redoLength.value > 0);
const hasCloneSource = ref(false);
const polygonDraftCount = ref(0);
// shallowRef: identity against raw stroke objects in `strokes` must hold.
const selectedPolygon = shallowRef(null); // committed polygon action being recolored
const showBrushCursor = computed(() =>
  cursorInside.value && !isPanning
  && (tool.value === 'brush' || tool.value === 'eraser' || (tool.value === 'clone' && hasCloneSource.value)));
const viewportCursor = computed(() => {
  if (isPanning || tool.value === 'pan') return isPanning ? 'grabbing' : 'grab';
  if (tool.value === 'eyedropper' || tool.value === 'polygon') return 'crosshair';
  if (tool.value === 'clone' && !hasCloneSource.value) return 'crosshair';
  return 'none';
});

// ─── Painting state (non-reactive: canvases + raw view transform) ──
let baseCanvas = null;      // native-res source texture
let paintCanvas = null;     // edit-res committed strokes (incl. baked + resumed)
let bakedCanvas = null;     // edit-res strokes older than the undo horizon
let strokeCanvas = null;    // edit-res live/replay stroke scratch (also clone mask)
let compositeCanvas = null; // edit-res base+paint for eyedropper / eraser / clone sampling
let cloneScratch = null;    // edit-res shifted clone patch
let compositeBaseDirty = true;
let editScale = 1;
let editW = 0;
let editH = 0;
let panX = 0;
let panY = 0;
let strokes = [];           // committed stroke objects within the undo window
let redoStack = [];
let activeStroke = null;    // { tool, color, size, opacity, points, sourceOffset? }
let polygonDraft = [];      // in-progress polygon nodes (edit coords)
let cloneSource = null;     // clone sampling point (edit coords)
let cursorEdit = null;      // pointer position in edit coords (overlay drawing)
let strokeIdCounter = 0;
let isPanning = false;
let panPointerStart = null;
let spaceHeld = false;
let toolBeforeEyedropper = '';
let rafPending = false;
let resizeObserver = null;

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ─── Setup / teardown ───────────────────────────────────────────────
const loadImageEl = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Failed to load texture image'));
  img.src = url;
});

const initFromSource = async () => {
  const img = await loadImageEl(props.sourceUrl);
  nativeWidth.value = img.naturalWidth;
  nativeHeight.value = img.naturalHeight;

  baseCanvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  baseCanvas.getContext('2d').drawImage(img, 0, 0);

  editScale = Math.min(1, EDIT_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  editW = Math.max(1, Math.round(img.naturalWidth * editScale));
  editH = Math.max(1, Math.round(img.naturalHeight * editScale));

  paintCanvas = makeCanvas(editW, editH);
  bakedCanvas = makeCanvas(editW, editH);
  strokeCanvas = makeCanvas(editW, editH);
  compositeCanvas = makeCanvas(editW, editH);
  cloneScratch = makeCanvas(editW, editH);

  if (props.resumeUrl) {
    try {
      const resumeImg = await loadImageEl(props.resumeUrl);
      bakedCanvas.getContext('2d').drawImage(resumeImg, 0, 0, editW, editH);
      paintCanvas.getContext('2d').drawImage(bakedCanvas, 0, 0);
    } catch (e) {
      console.warn('[TexturePaint] Could not resume previous paint layer:', e);
    }
  }

  compositeBaseDirty = true;
  isLoadingSource.value = false;
  await nextTick();
  syncDisplaySize();
  fitToView();
  requestRedraw();
};

const syncDisplaySize = () => {
  const vp = viewportEl.value;
  const canvas = displayCanvas.value;
  if (!vp || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(vp.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(vp.clientHeight * dpr));
};

const fitToView = () => {
  const vp = viewportEl.value;
  if (!vp || !baseCanvas) return;
  const scale = Math.min(vp.clientWidth / baseCanvas.width, vp.clientHeight / baseCanvas.height) * 0.96;
  zoom.value = scale;
  panX = (vp.clientWidth - baseCanvas.width * scale) / 2;
  panY = (vp.clientHeight - baseCanvas.height * scale) / 2;
};

const zoomToActual = () => {
  const vp = viewportEl.value;
  if (!vp || !baseCanvas) return;
  const cx = vp.clientWidth / 2;
  const cy = vp.clientHeight / 2;
  applyZoom(1 / zoom.value, cx, cy);
};

// ─── Rendering ──────────────────────────────────────────────────────
const requestRedraw = () => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw();
  });
};

const draw = () => {
  const canvas = displayCanvas.value;
  if (!canvas || !baseCanvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(panX, panY);
  ctx.scale(zoom.value, zoom.value);
  ctx.imageSmoothingEnabled = zoom.value < 3;
  ctx.imageSmoothingQuality = 'high';

  const W = baseCanvas.width;
  const H = baseCanvas.height;
  ctx.drawImage(baseCanvas, 0, 0, W, H);

  if (peekOriginal.value) return;

  const erasingLive = activeStroke && activeStroke.tool === 'eraser';
  if (erasingLive) {
    // Live eraser preview: paint layer minus the in-flight stroke.
    const cctx = compositeCanvas.getContext('2d');
    cctx.clearRect(0, 0, editW, editH);
    cctx.drawImage(paintCanvas, 0, 0);
    cctx.save();
    cctx.globalCompositeOperation = 'destination-out';
    cctx.globalAlpha = activeStroke.opacity;
    cctx.drawImage(strokeCanvas, 0, 0);
    cctx.restore();
    compositeBaseDirty = true;
    ctx.drawImage(compositeCanvas, 0, 0, W, H);
  } else {
    ctx.drawImage(paintCanvas, 0, 0, W, H);
    if (activeStroke && activeStroke.tool === 'clone') {
      // Live clone preview from the current mask.
      buildClonePatch(activeStroke.sourceOffset, paintCanvas);
      ctx.save();
      ctx.globalAlpha = activeStroke.opacity;
      ctx.drawImage(cloneScratch, 0, 0, W, H);
      ctx.restore();
    } else if (activeStroke) {
      ctx.save();
      ctx.globalAlpha = activeStroke.opacity;
      ctx.drawImage(strokeCanvas, 0, 0, W, H);
      ctx.restore();
    }
  }

  drawOverlays(ctx);
};

// Tool overlays drawn in texture space with constant screen-width lines:
// the polygon draft (rubber band + nodes), the selected polygon outline,
// and the clone source/sampling markers.
const drawOverlays = (ctx) => {
  const toTex = editScale > 0 ? 1 / editScale : 1;
  const px = (n) => n / zoom.value; // n screen px expressed in texture units

  const tracePolyline = (pts, close) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * toTex, pts[0].y * toTex);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * toTex, pts[i].y * toTex);
    if (close) ctx.closePath();
  };

  const drawNodes = (pts, highlightFirst) => {
    for (let i = 0; i < pts.length; i++) {
      const r = px(i === 0 && highlightFirst ? 6 : 4);
      ctx.beginPath();
      ctx.arc(pts[i].x * toTex, pts[i].y * toTex, r, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 && highlightFirst ? '#FF6600' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = px(1.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  };

  if (polygonDraft.length > 0) {
    const preview = cursorEdit && !isPanning ? [...polygonDraft, cursorEdit] : polygonDraft;
    if (preview.length >= 3) {
      tracePolyline(preview, true);
      ctx.save();
      ctx.globalAlpha = 0.3 * (brushOpacity.value / 100);
      ctx.fillStyle = color.value;
      ctx.fill();
      ctx.restore();
    }
    tracePolyline(preview, false);
    ctx.lineWidth = px(1.5);
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([px(6), px(4)]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineDashOffset = px(6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    drawNodes(polygonDraft, polygonDraft.length >= 3);
  }

  if (selectedPolygon.value) {
    tracePolyline(selectedPolygon.value.points, true);
    ctx.lineWidth = px(2);
    ctx.strokeStyle = '#FF6600';
    ctx.setLineDash([px(7), px(5)]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawNodes(selectedPolygon.value.points, false);
  }

  if (tool.value === 'clone' && cloneSource) {
    const marks = [{ p: cloneSource, main: true }];
    if (activeStroke?.tool === 'clone' && cursorEdit) {
      marks.push({
        p: { x: cursorEdit.x + activeStroke.sourceOffset.dx, y: cursorEdit.y + activeStroke.sourceOffset.dy },
        main: false,
      });
    }
    for (const { p, main } of marks) {
      const x = p.x * toTex;
      const y = p.y * toTex;
      const r = px(main ? 9 : 7);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = px(main ? 2 : 1.5);
      ctx.strokeStyle = main ? '#FF6600' : 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 1.5, y);
      ctx.lineTo(x + r * 1.5, y);
      ctx.moveTo(x, y - r * 1.5);
      ctx.lineTo(x, y + r * 1.5);
      ctx.lineWidth = px(1);
      ctx.stroke();
    }
  }
};

// ─── Stroke engine ──────────────────────────────────────────────────
const strokePathInto = (targetCtx, stroke) => {
  targetCtx.strokeStyle = stroke.color;
  targetCtx.fillStyle = stroke.color;
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  const pts = stroke.points;
  if (stroke.tool === 'polygon') {
    targetCtx.beginPath();
    targetCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) targetCtx.lineTo(pts[i].x, pts[i].y);
    targetCtx.closePath();
    targetCtx.fill();
    // Thin same-color outline smooths the fill's aliased edge.
    targetCtx.lineWidth = 1;
    targetCtx.stroke();
    return;
  }
  targetCtx.lineWidth = Math.max(0.5, stroke.size * editScale);
  if (pts.length === 1) {
    targetCtx.beginPath();
    targetCtx.arc(pts[0].x, pts[0].y, Math.max(0.25, (stroke.size * editScale) / 2), 0, Math.PI * 2);
    targetCtx.fill();
    return;
  }
  targetCtx.beginPath();
  targetCtx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) targetCtx.lineTo(pts[i].x, pts[i].y);
  targetCtx.stroke();
};

// Build the shifted clone patch for a mask held in strokeCanvas: the composite
// (base + `paintSource`, the paint state underneath this stroke) is offset by
// the stroke's source offset and clipped to the mask. Result in cloneScratch.
const buildClonePatch = (sourceOffset, paintSource) => {
  const cctx = compositeCanvas.getContext('2d');
  cctx.clearRect(0, 0, editW, editH);
  cctx.drawImage(baseCanvas, 0, 0, editW, editH);
  cctx.drawImage(paintSource, 0, 0);
  compositeBaseDirty = true;
  const kctx = cloneScratch.getContext('2d');
  kctx.clearRect(0, 0, editW, editH);
  // out[p] must equal composite[p + offset]; drawImage(img, X, Y) yields
  // out[p] = img[p - (X,Y)], so the shift is the negated offset.
  kctx.drawImage(compositeCanvas, -sourceOffset.dx, -sourceOffset.dy);
  kctx.save();
  kctx.globalCompositeOperation = 'destination-in';
  kctx.drawImage(strokeCanvas, 0, 0);
  kctx.restore();
};

// Render a whole stroke into the scratch canvas at full alpha, then composite
// onto `targetCtx` with the stroke's opacity/blend. Full alpha first keeps
// self-overlapping segments from doubling up within one stroke. Clone strokes
// sample base + targetCtx's own canvas, so replaying history stays exact.
const compositeStroke = (targetCtx, stroke) => {
  const sctx = strokeCanvas.getContext('2d');
  sctx.clearRect(0, 0, editW, editH);
  strokePathInto(sctx, stroke);
  if (stroke.tool === 'clone') {
    buildClonePatch(stroke.sourceOffset, targetCtx.canvas);
    targetCtx.save();
    targetCtx.globalAlpha = stroke.opacity;
    targetCtx.drawImage(cloneScratch, 0, 0);
    targetCtx.restore();
    return;
  }
  targetCtx.save();
  targetCtx.globalAlpha = stroke.opacity;
  if (stroke.tool === 'eraser') targetCtx.globalCompositeOperation = 'destination-out';
  targetCtx.drawImage(strokeCanvas, 0, 0);
  targetCtx.restore();
};

const rebuildPaintCanvas = () => {
  const pctx = paintCanvas.getContext('2d');
  pctx.clearRect(0, 0, editW, editH);
  pctx.drawImage(bakedCanvas, 0, 0);
  for (const stroke of strokes) compositeStroke(pctx, stroke);
  strokeCanvas.getContext('2d').clearRect(0, 0, editW, editH);
  compositeBaseDirty = true;
};

const pushCommittedStroke = (stroke) => {
  compositeStroke(paintCanvas.getContext('2d'), stroke);
  strokeCanvas.getContext('2d').clearRect(0, 0, editW, editH);
  strokes.push(stroke);
  if (strokes.length > MAX_HISTORY) {
    compositeStroke(bakedCanvas.getContext('2d'), strokes.shift());
  }
  redoStack = [];
  historyLength.value = strokes.length;
  redoLength.value = 0;
  hasUnsavedChanges.value = true;
  compositeBaseDirty = true;
  syncPolygonSelection();
  requestRedraw();
};

const commitActiveStroke = () => {
  if (!activeStroke) return;
  const stroke = activeStroke;
  activeStroke = null;
  pushCommittedStroke(stroke);
};

// Selection must always point at a stroke still in the undo window.
const syncPolygonSelection = () => {
  if (selectedPolygon.value && !strokes.includes(selectedPolygon.value)) {
    selectedPolygon.value = null;
  }
};

const undo = () => {
  if (!strokes.length) return;
  redoStack.push(strokes.pop());
  rebuildPaintCanvas();
  historyLength.value = strokes.length;
  redoLength.value = redoStack.length;
  hasUnsavedChanges.value = true;
  syncPolygonSelection();
  requestRedraw();
};

const redo = () => {
  if (!redoStack.length) return;
  const stroke = redoStack.pop();
  compositeStroke(paintCanvas.getContext('2d'), stroke);
  strokes.push(stroke);
  historyLength.value = strokes.length;
  redoLength.value = redoStack.length;
  hasUnsavedChanges.value = true;
  compositeBaseDirty = true;
  requestRedraw();
};

const resetStrokes = () => {
  if (!window.confirm(t('exportPanel.texturePaint.resetConfirm'))) return;
  strokes = [];
  redoStack = [];
  bakedCanvas.getContext('2d').clearRect(0, 0, editW, editH);
  rebuildPaintCanvas();
  historyLength.value = 0;
  redoLength.value = 0;
  hasUnsavedChanges.value = true;
  selectedPolygon.value = null;
  cancelPolygonDraft();
};

// ─── Pointer / view interaction ─────────────────────────────────────
const viewportPoint = (e) => {
  const rect = viewportEl.value.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

const toEditCoords = (vp) => ({
  x: ((vp.x - panX) / zoom.value) * editScale,
  y: ((vp.y - panY) / zoom.value) * editScale,
});

const sampleColorAt = (vp) => {
  const ex = Math.floor(((vp.x - panX) / zoom.value) * editScale);
  const ey = Math.floor(((vp.y - panY) / zoom.value) * editScale);
  if (ex < 0 || ey < 0 || ex >= editW || ey >= editH) return null;
  if (compositeBaseDirty) {
    const cctx = compositeCanvas.getContext('2d', { willReadFrequently: true });
    cctx.clearRect(0, 0, editW, editH);
    cctx.drawImage(baseCanvas, 0, 0, editW, editH);
    cctx.drawImage(paintCanvas, 0, 0);
    compositeBaseDirty = false;
  }
  const d = compositeCanvas.getContext('2d', { willReadFrequently: true }).getImageData(ex, ey, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
};

const pointInPolygon = (pt, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > pt.y) !== (b.y > pt.y)
      && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

// Newest still-undoable polygon under the point (baked ones are pixels now).
const hitTestPolygons = (pt) => {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i].tool === 'polygon' && pointInPolygon(pt, strokes[i].points)) return strokes[i];
  }
  return null;
};

const cancelPolygonDraft = () => {
  polygonDraft = [];
  polygonDraftCount.value = 0;
  requestRedraw();
};

const clearPolygonSelection = () => {
  if (!selectedPolygon.value) return;
  selectedPolygon.value = null;
  requestRedraw();
};

const completePolygonDraft = () => {
  if (polygonDraft.length < 3) return;
  const stroke = {
    id: ++strokeIdCounter,
    tool: 'polygon',
    color: color.value,
    opacity: brushOpacity.value / 100,
    points: polygonDraft,
  };
  polygonDraft = [];
  polygonDraftCount.value = 0;
  pushRecentColor(stroke.color);
  pushCommittedStroke(stroke);
};

// Refill the selected polygon's shape with the current color, as its own
// undoable action layered on top of the history.
const applyPolygonRecolor = () => {
  const target = selectedPolygon.value;
  if (!target) return;
  const stroke = {
    id: ++strokeIdCounter,
    tool: 'polygon',
    color: color.value,
    opacity: brushOpacity.value / 100,
    points: target.points,
  };
  pushRecentColor(stroke.color);
  pushCommittedStroke(stroke);
  selectedPolygon.value = stroke;
};

const onPointerDown = (e) => {
  if (showColorPicker.value) {
    // First click only dismisses the picker; it must not also paint.
    showColorPicker.value = false;
    return;
  }
  const vp = viewportPoint(e);
  viewportEl.value.setPointerCapture(e.pointerId);

  const wantsPan = tool.value === 'pan' || e.button === 1 || spaceHeld;
  if (wantsPan) {
    isPanning = true;
    panPointerStart = { x: vp.x - panX, y: vp.y - panY };
    return;
  }
  if (e.button !== 0) return;

  const pickWithAlt = e.altKey
    && (tool.value === 'brush' || tool.value === 'eraser' || tool.value === 'polygon');
  if (tool.value === 'eyedropper' || pickWithAlt) {
    const picked = sampleColorAt(vp);
    if (picked) {
      setColor(picked);
      if (tool.value === 'eyedropper' && toolBeforeEyedropper) {
        tool.value = toolBeforeEyedropper;
        toolBeforeEyedropper = '';
      }
    }
    return;
  }

  if (tool.value === 'polygon') {
    const pt = toEditCoords(vp);
    if (polygonDraft.length === 0) {
      // Idle: clicking an existing polygon selects it for recoloring;
      // clicking empty space starts a new draft.
      const hit = hitTestPolygons(pt);
      if (hit) {
        selectedPolygon.value = hit;
        requestRedraw();
        return;
      }
      clearPolygonSelection();
      polygonDraft = [pt];
      polygonDraftCount.value = 1;
      requestRedraw();
      return;
    }
    // Close when clicking the first node again, or on double click.
    const first = polygonDraft[0];
    const closeRadius = (12 / zoom.value) * editScale;
    const nearFirst = Math.hypot(pt.x - first.x, pt.y - first.y) < closeRadius;
    if ((nearFirst && polygonDraft.length >= 3) || (e.detail >= 2 && polygonDraft.length >= 3)) {
      completePolygonDraft();
      return;
    }
    polygonDraft.push(pt);
    polygonDraftCount.value = polygonDraft.length;
    requestRedraw();
    return;
  }

  if (tool.value === 'clone') {
    const pt = toEditCoords(vp);
    if (e.altKey || !cloneSource) {
      cloneSource = pt;
      hasCloneSource.value = true;
      requestRedraw();
      return;
    }
    activeStroke = {
      tool: 'clone',
      color: '#000000', // mask color only; alpha is what matters
      size: brushSize.value,
      opacity: brushOpacity.value / 100,
      points: [pt],
      sourceOffset: { dx: cloneSource.x - pt.x, dy: cloneSource.y - pt.y },
    };
    strokePathInto(strokeCanvas.getContext('2d'), activeStroke);
    requestRedraw();
    return;
  }

  if (tool.value === 'brush' || tool.value === 'eraser') {
    activeStroke = {
      tool: tool.value,
      color: tool.value === 'eraser' ? '#000000' : color.value,
      size: brushSize.value,
      opacity: brushOpacity.value / 100,
      points: [toEditCoords(vp)],
    };
    if (tool.value === 'brush') pushRecentColor(color.value);
    strokePathInto(strokeCanvas.getContext('2d'), activeStroke);
    requestRedraw();
  }
};

const onPointerMove = (e) => {
  const vp = viewportPoint(e);
  cursorPos.value = vp;
  cursorInside.value = true;
  cursorEdit = toEditCoords(vp);

  if (isPanning && panPointerStart) {
    panX = vp.x - panPointerStart.x;
    panY = vp.y - panPointerStart.y;
    requestRedraw();
    return;
  }
  if (tool.value === 'polygon' && polygonDraft.length > 0) {
    requestRedraw(); // rubber band follows the cursor
    return;
  }
  if (!activeStroke) return;

  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
  const sctx = strokeCanvas.getContext('2d');
  for (const ev of events) {
    const pt = toEditCoords(viewportPoint(ev));
    const prev = activeStroke.points[activeStroke.points.length - 1];
    if (Math.abs(pt.x - prev.x) < 0.15 && Math.abs(pt.y - prev.y) < 0.15) continue;
    activeStroke.points.push(pt);
    sctx.strokeStyle = activeStroke.color;
    sctx.lineWidth = Math.max(0.5, activeStroke.size * editScale);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    sctx.beginPath();
    sctx.moveTo(prev.x, prev.y);
    sctx.lineTo(pt.x, pt.y);
    sctx.stroke();
  }
  requestRedraw();
};

const onPointerUp = (e) => {
  if (viewportEl.value?.hasPointerCapture?.(e.pointerId)) {
    viewportEl.value.releasePointerCapture(e.pointerId);
  }
  if (isPanning) {
    isPanning = false;
    panPointerStart = null;
    return;
  }
  commitActiveStroke();
};

const applyZoom = (factor, cx, cy) => {
  const next = Math.min(32, Math.max(0.02, zoom.value * factor));
  const applied = next / zoom.value;
  panX = cx - (cx - panX) * applied;
  panY = cy - (cy - panY) * applied;
  zoom.value = next;
  requestRedraw();
};

const onWheel = (e) => {
  const vp = viewportPoint(e);
  applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, vp.x, vp.y);
};

// ─── Color helpers / picker ─────────────────────────────────────────
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const rgbToHsv = ({ r, g, b }) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

const hsvToRgb = ({ h, s, v }) => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: Math.round((rgb[0] + m) * 255), g: Math.round((rgb[1] + m) * 255), b: Math.round((rgb[2] + m) * 255) };
};

const hsv = ref(rgbToHsv(hexToRgb('#4c7a44')));

const setColor = (hex, fromHsv = false) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  color.value = rgbToHex(rgb.r, rgb.g, rgb.b);
  hexInput.value = color.value;
  if (!fromHsv) hsv.value = rgbToHsv(rgb);
  drawPicker();
};

const pushRecentColor = (hex) => {
  const list = recentColors.value.filter((c) => c !== hex);
  list.unshift(hex);
  recentColors.value = list.slice(0, 8);
};

const applyHexInput = () => {
  const rgb = hexToRgb(hexInput.value);
  if (rgb) setColor(hexInput.value);
  else hexInput.value = color.value;
};

// Picker geometry: hue ring + inner saturation/value square.
const PICKER_SIZE = 176;
const RING_OUTER = 86;
const RING_INNER = 70;
const SV_HALF = Math.floor((RING_INNER - 6) / Math.SQRT2);

const drawPicker = () => {
  const canvas = pickerCanvas.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const c = PICKER_SIZE / 2;
  ctx.clearRect(0, 0, PICKER_SIZE, PICKER_SIZE);

  // Hue ring
  const grad = ctx.createConicGradient(0, c, c);
  for (let i = 0; i <= 360; i += 15) {
    const { r, g, b } = hsvToRgb({ h: i % 360, s: 1, v: 1 });
    grad.addColorStop(i / 360, rgbToHex(r, g, b));
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, RING_OUTER, 0, Math.PI * 2);
  ctx.arc(c, c, RING_INNER, 0, Math.PI * 2, true);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // SV square
  const sx = c - SV_HALF;
  const sy = c - SV_HALF;
  const side = SV_HALF * 2;
  const hueRgb = hsvToRgb({ h: hsv.value.h, s: 1, v: 1 });
  const satGrad = ctx.createLinearGradient(sx, 0, sx + side, 0);
  satGrad.addColorStop(0, '#ffffff');
  satGrad.addColorStop(1, rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b));
  ctx.fillStyle = satGrad;
  ctx.fillRect(sx, sy, side, side);
  const valGrad = ctx.createLinearGradient(0, sy, 0, sy + side);
  valGrad.addColorStop(0, 'rgba(0,0,0,0)');
  valGrad.addColorStop(1, '#000000');
  ctx.fillStyle = valGrad;
  ctx.fillRect(sx, sy, side, side);

  // Markers
  const hueAngle = (hsv.value.h * Math.PI) / 180;
  const hueR = (RING_OUTER + RING_INNER) / 2;
  drawMarker(ctx, c + Math.cos(hueAngle) * hueR, c + Math.sin(hueAngle) * hueR);
  drawMarker(ctx, sx + hsv.value.s * side, sy + (1 - hsv.value.v) * side);
};

const drawMarker = (ctx, x, y) => {
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
};

let pickerMode = null;

const applyPickerPoint = (e) => {
  const rect = pickerCanvas.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const c = PICKER_SIZE / 2;
  const dx = x - c;
  const dy = y - c;
  if (pickerMode === 'hue') {
    hsv.value = { ...hsv.value, h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 };
  } else {
    const side = SV_HALF * 2;
    const s = Math.min(1, Math.max(0, (x - (c - SV_HALF)) / side));
    const v = Math.min(1, Math.max(0, 1 - (y - (c - SV_HALF)) / side));
    hsv.value = { ...hsv.value, s, v };
  }
  const { r, g, b } = hsvToRgb(hsv.value);
  setColor(rgbToHex(r, g, b), true);
};

const onPickerPointerDown = (e) => {
  const rect = pickerCanvas.value.getBoundingClientRect();
  const dx = e.clientX - rect.left - PICKER_SIZE / 2;
  const dy = e.clientY - rect.top - PICKER_SIZE / 2;
  const dist = Math.hypot(dx, dy);
  pickerMode = dist >= RING_INNER - 2 ? 'hue' : 'sv';
  pickerCanvas.value.setPointerCapture(e.pointerId);
  applyPickerPoint(e);
  const move = (ev) => applyPickerPoint(ev);
  const up = () => {
    pickerCanvas.value?.removeEventListener('pointermove', move);
    pickerCanvas.value?.removeEventListener('pointerup', up);
    pickerMode = null;
  };
  pickerCanvas.value.addEventListener('pointermove', move);
  pickerCanvas.value.addEventListener('pointerup', up);
};

watch(showColorPicker, async (open) => {
  if (open) {
    await nextTick();
    drawPicker();
  }
});

// ─── Save / close ───────────────────────────────────────────────────
const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
});

const handleSave = async () => {
  if (isSaving.value || !baseCanvas) return;
  isSaving.value = true;
  try {
    const out = makeCanvas(baseCanvas.width, baseCanvas.height);
    const octx = out.getContext('2d');
    octx.drawImage(baseCanvas, 0, 0);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(paintCanvas, 0, 0, baseCanvas.width, baseCanvas.height);
    const [compositeBlob, paintLayerBlob] = await Promise.all([
      canvasToBlob(out),
      canvasToBlob(paintCanvas),
    ]);
    out.width = 0;
    out.height = 0;
    hasUnsavedChanges.value = false;
    emit('save', { compositeBlob, paintLayerBlob });
  } catch (error) {
    console.error('[TexturePaint] Save failed:', error);
    alert(t('exportPanel.texturePaint.saveFailed'));
  } finally {
    isSaving.value = false;
  }
};

const requestClose = () => {
  if (hasUnsavedChanges.value && !window.confirm(t('exportPanel.texturePaint.discardConfirm'))) return;
  emit('close');
};

// ─── Keyboard shortcuts ─────────────────────────────────────────────
const onKeyDown = (e) => {
  const tag = String(e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

  if (e.code === 'Space') {
    spaceHeld = true;
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'escape':
      if (showColorPicker.value) showColorPicker.value = false;
      else if (polygonDraft.length > 0) cancelPolygonDraft();
      else if (selectedPolygon.value) clearPolygonSelection();
      else requestClose();
      break;
    case 'enter':
      if (polygonDraft.length >= 3) completePolygonDraft();
      else if (selectedPolygon.value) applyPolygonRecolor();
      break;
    case 'backspace':
      if (polygonDraft.length > 0) {
        polygonDraft.pop();
        polygonDraftCount.value = polygonDraft.length;
        requestRedraw();
        e.preventDefault();
      }
      break;
    case 'b': tool.value = 'brush'; break;
    case 'e': tool.value = 'eraser'; break;
    case 'p': tool.value = 'polygon'; break;
    case 's': tool.value = 'clone'; break;
    case 'i':
      if (tool.value !== 'eyedropper') toolBeforeEyedropper = tool.value;
      tool.value = 'eyedropper';
      break;
    case 'h': tool.value = 'pan'; break;
    case '[': brushSize.value = Math.max(1, Math.round(brushSize.value / 1.25)); break;
    case ']': brushSize.value = Math.min(400, Math.max(brushSize.value + 1, Math.round(brushSize.value * 1.25))); break;
  }
};

const onKeyUp = (e) => {
  if (e.code === 'Space') spaceHeld = false;
};

watch(peekOriginal, requestRedraw);

// Leaving the polygon tool drops any in-progress draft and selection.
watch(tool, (next, prev) => {
  if (prev === 'polygon') {
    cancelPolygonDraft();
    clearPolygonSelection();
  }
  requestRedraw();
});

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  resizeObserver = new ResizeObserver(() => {
    syncDisplaySize();
    requestRedraw();
  });
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
  initFromSource().catch((error) => {
    console.error('[TexturePaint] Failed to load source texture:', error);
    alert(t('exportPanel.texturePaint.loadFailed'));
    emit('close');
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  resizeObserver?.disconnect();
  // Free the working canvases eagerly; textures can be large.
  for (const c of [baseCanvas, paintCanvas, bakedCanvas, strokeCanvas, compositeCanvas, cloneScratch]) {
    if (c) { c.width = 0; c.height = 0; }
  }
  baseCanvas = paintCanvas = bakedCanvas = strokeCanvas = compositeCanvas = cloneScratch = null;
});
</script>

<style scoped>
.mapng-paint-checker {
  background-color: #d9dde3;
  background-image:
    linear-gradient(45deg, rgba(0,0,0,0.07) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.07) 75%),
    linear-gradient(45deg, rgba(0,0,0,0.07) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.07) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
:global(.dark) .mapng-paint-checker {
  background-color: #111827;
}
</style>
