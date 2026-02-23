<template>
  <div class="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700">

      <!-- Header -->
      <div class="p-5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div :class="['p-2 rounded-lg', headerBgClass]">
            <component :is="headerIcon" :size="20" :class="headerIconClass" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-white">{{ headerTitle }}</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ gridCols }}×{{ gridRows }} grid · {{ state.resolution }}px per tile</p>
          </div>
        </div>
        <button v-if="!isRunning" @click="$emit('close')"
          class="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
          <X :size="20" />
        </button>
      </div>

      <!-- Content -->
      <div class="p-5 overflow-y-auto custom-scrollbar space-y-5 flex-1">

        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500 dark:text-gray-400">Instrumentation</span>
          <button
            @click="showDetails = !showDetails"
            class="text-xs font-medium text-[#FF6600] hover:underline"
          >
            {{ showDetails ? 'Hide Details' : 'Details' }}
          </button>
        </div>

        <!-- Grid Visualization -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Tile Grid</span>
            <span>{{ completedCount }}/{{ totalTiles }} completed{{ failedCount > 0 ? ` · ${failedCount} failed` : '' }}</span>
          </div>
          <div :style="gridStyle" class="gap-1 mx-auto" style="max-width: 400px;">
            <div v-for="tile in state.tiles" :key="tile.id || tile.index" :class="tileClass(tile)"
              class="aspect-square rounded-sm flex items-center justify-center text-[7px] font-medium transition-all duration-300 select-none overflow-hidden relative"
              :title="`R${tile.row + 1} C${tile.col + 1}${tile.lastError?.message ? ': ' + tile.lastError.message : ''}`">
              <!-- Snapshot background for completed tiles -->
              <img v-if="tile.snapshot && (tile.status === 'done' || tile.status === 'completed')" :src="tile.snapshot"
                class="absolute inset-0 w-full h-full object-cover" />
              <div v-if="tile.snapshot && (tile.status === 'done' || tile.status === 'completed')"
                class="absolute inset-0 bg-emerald-500/30 flex items-center justify-center">
                <Check :size="10" class="text-white drop-shadow" />
              </div>
              <template v-else>
                <Loader2 v-if="tile.status === 'processing'" :size="10" class="animate-spin" />
                <Check v-else-if="tile.status === 'done' || tile.status === 'completed'" :size="10" />
                <XIcon v-else-if="tile.status === 'failed'" :size="10" />
                <span v-else class="opacity-40">•</span>
              </template>
              <div class="absolute bottom-0 left-0 right-0 bg-black/45 text-white text-[8px] leading-none py-0.5 text-center">
                R{{ tile.row + 1 }}C{{ tile.col + 1 }}
              </div>
            </div>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="space-y-1">
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ease-out"
              :class="progressBarClass" :style="{ width: progressPercent + '%' }">
            </div>
          </div>
          <div class="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
            <span>{{ progressPercent.toFixed(0) }}%</span>
            <span v-if="etaText && isRunning">~{{ etaText }} remaining</span>
            <span v-else-if="elapsedText">{{ elapsedText }} elapsed</span>
          </div>
        </div>

        <!-- Current Tile Status (during processing) -->
        <div v-if="isRunning && currentStep"
          class="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-3 space-y-1">
          <div class="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-200">
            <Loader2 :size="14" class="animate-spin text-blue-500" />
            Processing tile R{{ currentTile?.row + 1 }}C{{ currentTile?.col + 1 }}
            <span class="text-xs font-normal text-blue-600 dark:text-blue-400">({{ currentTileDisplayIndex }}/{{ totalTiles }})</span>
          </div>
          <p class="text-xs text-blue-600 dark:text-blue-400 animate-pulse">{{ currentStep }}</p>
        </div>

        <!-- Completion Summary -->
        <div v-if="isDone" class="space-y-3">
          <div :class="['rounded-lg p-4 text-center', summaryBgClass]">
            <component :is="summaryIcon" :size="32" class="mx-auto mb-2" :class="summaryIconClass" />
            <p class="font-bold text-lg" :class="summaryTextClass">{{ summaryTitle }}</p>
            <p class="text-sm mt-1" :class="summarySubtextClass">
              {{ completedCount }} tile{{ completedCount !== 1 ? 's' : '' }} exported successfully
              <span v-if="failedCount > 0"> · {{ failedCount }} failed</span>
            </p>
            <p v-if="elapsedText" class="text-xs mt-2 opacity-70" :class="summarySubtextClass">
              Total time: {{ elapsedText }}
            </p>
          </div>

          <!-- Failed Tiles List -->
          <div v-if="failedTiles.length > 0" class="space-y-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400">Failed Tiles</h4>
            <div class="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
              <div v-for="tile in failedTiles" :key="tile.index"
                class="flex items-start gap-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded p-2">
                <XCircle :size="12" class="text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span class="font-medium text-red-800 dark:text-red-200">R{{ tile.row + 1 }}C{{ tile.col + 1 }}</span>
                  <span class="text-red-600 dark:text-red-400 ml-1">{{ tile.lastError?.message || tile.error || 'Unknown error' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showDetails" class="space-y-3">
          <div class="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Job Summary</h4>
            <div class="text-xs text-gray-600 dark:text-gray-300 space-y-1">
              <p>Total queue wait: <span class="font-medium">{{ formatDuration(jobSummary?.totalWaitMs) }}</span></p>
              <p v-if="jobSummary?.slowestTile">Slowest tile: <span class="font-medium">R{{ jobSummary.slowestTile.row + 1 }}C{{ jobSummary.slowestTile.col + 1 }}</span> ({{ formatDuration(jobSummary.slowestTile.totalMs) }})</p>
              <p v-if="benchmarkReport?.comparison">Composite score: <span class="font-medium">{{ benchmarkReport.comparison.compositeScore }}</span> (lower is better)</p>
              <p v-if="benchmarkReport?.comparison">Recommendation: <span class="font-medium">{{ benchmarkReport.comparison.recommendation }}</span></p>
              <p v-if="jobSummary?.memory?.supported">Peak JS heap: <span class="font-medium">{{ formatBytes(jobSummary.memory.peakUsedBytes) }}</span> / {{ formatBytes(jobSummary.memory.peakTotalBytes) }}</p>
              <p v-if="jobSummary?.memory?.supported">Memory samples: <span class="font-medium">{{ jobSummary.memory.sampleCount }}</span></p>
              <p v-if="jobSummary?.memory?.peakTile">Peak tile heap: <span class="font-medium">R{{ jobSummary.memory.peakTile.row + 1 }}C{{ jobSummary.memory.peakTile.col + 1 }}</span> ({{ formatBytes(jobSummary.memory.peakTile.peakUsedBytes) }})</p>
              <p v-if="!jobSummary?.memory?.supported" class="text-[10px]">Memory sampling unavailable in this browser; timings still captured.</p>
            </div>
            <div class="flex items-center justify-between gap-2">
              <button
                @click="copyBenchmarkReport"
                class="py-1.5 px-2 text-[10px] font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Copy Benchmark Report
              </button>
              <span v-if="benchmarkCopyStatus" class="text-[10px] text-gray-500 dark:text-gray-400">{{ benchmarkCopyStatus }}</span>
            </div>
            <div v-if="jobSummary?.byStage" class="max-h-36 overflow-y-auto custom-scrollbar">
              <div v-for="(stats, stage) in jobSummary.byStage" :key="stage" class="text-[10px] text-gray-600 dark:text-gray-300 grid grid-cols-4 gap-2 py-0.5">
                <span class="truncate" :title="stage">{{ stage }}</span>
                <span>avg {{ formatDuration(stats.avgMs) }}</span>
                <span>med {{ formatDuration(stats.medianMs) }}</span>
                <span>max {{ formatDuration(stats.maxMs) }}</span>
              </div>
            </div>
          </div>

          <div class="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Per-tile Instrumentation</h4>
            <div class="max-h-56 overflow-y-auto custom-scrollbar space-y-2">
              <div v-for="tile in tilesWithInstrumentation" :key="tile.id || tile.index" class="border border-gray-200 dark:border-gray-700 rounded p-2 bg-white dark:bg-gray-900">
                <div class="text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">R{{ tile.row + 1 }}C{{ tile.col + 1 }} · {{ tile.status }}</div>
                <div v-if="tile.lifecycle?.totalMs" class="text-[10px] text-gray-600 dark:text-gray-300 mb-1">total {{ formatDuration(tile.lifecycle.totalMs) }}</div>
                <div v-if="tile.memory" class="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap start</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.startUsedBytes) }}</div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap after fetch</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.afterFetchUsedBytes) }}</div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap before zip</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.beforeZipUsedBytes) }}</div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap after zip</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.afterZipUsedBytes) }}</div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap end</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.endUsedBytes) }}</div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">heap peak</div>
                  <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatBytes(tile.memory.peakUsedBytes) }}</div>
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <template v-for="(ms, stage) in tile.stageTimings" :key="stage">
                    <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate" :title="stage">{{ stage }}</div>
                    <div class="text-[10px] text-gray-700 dark:text-gray-300 text-right">{{ formatDuration(ms) }}</div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Paused State -->
        <div v-if="isPaused"
          class="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg p-3 text-center">
          <Pause :size="24" class="mx-auto mb-2 text-amber-500" />
          <p class="font-medium text-amber-800 dark:text-amber-200">Batch Job Paused</p>
          <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">
            {{ completedCount }} tile{{ completedCount !== 1 ? 's' : '' }} completed. You can resume where you left off.
          </p>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center gap-3">
        <template v-if="isRunning">
          <button @click="$emit('cancel')"
            class="flex-1 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
            <Square :size="14" />
            Cancel Batch
          </button>
        </template>

        <template v-else-if="isPaused">
          <button @click="$emit('resume')"
            class="flex-1 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E65C00] text-white transition-colors">
            <Play :size="14" />
            Resume
          </button>
          <button @click="$emit('close')"
            class="py-2.5 px-4 text-sm font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
            Close
          </button>
        </template>

        <template v-else-if="isDone">
          <button v-if="failedCount > 0" @click="$emit('retryFailed')"
            class="flex-1 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E65C00] text-white transition-colors">
            <RotateCcw :size="14" />
            Retry {{ failedCount }} Failed Tile{{ failedCount !== 1 ? 's' : '' }}
          </button>
          <button @click="$emit('close')"
            :class="['py-2.5 text-sm font-medium rounded-lg transition-colors', failedCount > 0
              ? 'px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              : 'flex-1 flex items-center justify-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100']">
            {{ failedCount > 0 ? 'Close' : 'Done' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import {
  Loader2, Check, X, XCircle, Square, Play, Pause, RotateCcw,
  CheckCircle2, AlertTriangle, Package,
} from 'lucide-vue-next';
import { estimateTimeRemaining, formatDuration } from '../services/batchJob';
import { summarizeStageTimings, buildBatchBenchmarkReport } from '../services/batchRuntime';

// Alias X icon to avoid conflict with the X used for close
const XIcon = X;

const props = defineProps({
  state: { type: Object, required: true },
  currentStep: { type: String, default: '' },
});

defineEmits(['close', 'cancel', 'resume', 'retryFailed']);

const now = ref(Date.now());
const showDetails = ref(false);
const doneAt = ref(null);
const benchmarkCopyStatus = ref('');
let timer = null;

onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => { clearInterval(timer); });

// Derived state
const gridCols = computed(() => props.state.gridCols);
const gridRows = computed(() => props.state.gridRows);
const totalTiles = computed(() => props.state.tiles.length);
const completedCount = computed(() => props.state.tiles.filter(t => t.status === 'done' || t.status === 'completed').length);
const failedCount = computed(() => props.state.tiles.filter(t => t.status === 'failed').length);
const failedTiles = computed(() => props.state.tiles.filter(t => t.status === 'failed'));
const tilesWithInstrumentation = computed(() => props.state.tiles.filter((t) => {
  const hasTimings = t.stageTimings && Object.keys(t.stageTimings).length > 0;
  const hasMemory = t.memory && Object.values(t.memory).some((v) => Number(v) > 0);
  return hasTimings || hasMemory;
}));
const benchmarkReport = computed(() => buildBatchBenchmarkReport(props.state));
const jobSummary = computed(() => props.state.summary || summarizeStageTimings(props.state));
const currentTile = computed(() => {
  if (props.state.currentTileId) {
    const byId = props.state.tiles.find((tile) => tile.id === props.state.currentTileId);
    if (byId) return byId;
  }
  return props.state.currentTileIndex >= 0 ? props.state.tiles[props.state.currentTileIndex] : null;
});

const currentTileDisplayIndex = computed(() => {
  if (!currentTile.value) return 0;
  const i = props.state.tiles.findIndex((tile) => (tile.id || tile.index) === (currentTile.value.id || currentTile.value.index));
  return i >= 0 ? i + 1 : Math.max(1, (props.state.currentTileIndex || 0) + 1);
});

const isTerminalByCounts = computed(() => {
  if (!totalTiles.value) return false;
  return completedCount.value + failedCount.value >= totalTiles.value;
});

const isRunning = computed(() => props.state.status === 'running' && !isTerminalByCounts.value);
const isPaused = computed(() => props.state.status === 'paused');
const isDone = computed(() =>
  props.state.status === 'completed' ||
  props.state.status === 'failed' ||
  props.state.status === 'canceled' ||
  props.state.status === 'completed_with_errors' ||
  isTerminalByCounts.value
);

watch(isDone, (done) => {
  if (done && !doneAt.value) {
    doneAt.value = props.state.completedAt || Date.now();
  }
  if (!done) {
    doneAt.value = null;
  }
});

const progressPercent = computed(() =>
  totalTiles.value > 0 ? (completedCount.value / totalTiles.value) * 100 : 0
);

const progressBarClass = computed(() => {
  if (isDone.value && failedCount.value === 0) return 'bg-emerald-500';
  if (isDone.value && failedCount.value > 0) return 'bg-amber-500';
  return 'bg-[#FF6600]';
});

// Time calculations
const etaText = computed(() => {
  const ms = estimateTimeRemaining(props.state);
  return ms ? formatDuration(ms) : null;
});

const elapsedText = computed(() => {
  if (!props.state.startedAt) return null;
  const end = props.state.completedAt || doneAt.value || now.value;
  return formatDuration(end - props.state.startedAt);
});

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const fixed = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fixed)} ${units[unit]}`;
};

const copyBenchmarkReport = async () => {
  try {
    const report = benchmarkReport.value;
    if (!report) {
      benchmarkCopyStatus.value = 'No benchmark data available.';
      return;
    }
    const text = JSON.stringify(report, null, 2);
    if (!navigator.clipboard?.writeText) {
      benchmarkCopyStatus.value = 'Clipboard unavailable.';
      return;
    }
    await navigator.clipboard.writeText(text);
    benchmarkCopyStatus.value = 'Benchmark report copied.';
  } catch {
    benchmarkCopyStatus.value = 'Failed to copy benchmark report.';
  }
};

// Grid style
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${gridCols.value}, minmax(0, 1fr))`,
}));

// Tile cell classes
const tileClass = (tile) => {
  switch (tile.status) {
    case 'processing':
      return 'bg-blue-400 dark:bg-blue-500 text-white ring-2 ring-blue-300 dark:ring-blue-400 animate-pulse';
    case 'done':
    case 'completed':
      return 'bg-emerald-400 dark:bg-emerald-500 text-white';
    case 'failed':
      return 'bg-red-400 dark:bg-red-500 text-white';
    default:
      return 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
  }
};

// Header
const headerTitle = computed(() => {
  if (isDone.value) return failedCount.value > 0 ? 'Batch Complete (with errors)' : 'Batch Complete';
  if (isPaused.value) return 'Batch Paused';
  return 'Batch Job Running';
});

const headerBgClass = computed(() => {
  if (isDone.value && failedCount.value === 0) return 'bg-emerald-100 dark:bg-emerald-900/30';
  if (isDone.value) return 'bg-amber-100 dark:bg-amber-900/30';
  if (isPaused.value) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-[#FF6600]/10';
});

const headerIcon = computed(() => {
  if (isDone.value && failedCount.value === 0) return CheckCircle2;
  if (isDone.value) return AlertTriangle;
  if (isPaused.value) return Pause;
  return Package;
});

const headerIconClass = computed(() => {
  if (isDone.value && failedCount.value === 0) return 'text-emerald-600 dark:text-emerald-400';
  if (isDone.value) return 'text-amber-600 dark:text-amber-400';
  if (isPaused.value) return 'text-amber-600 dark:text-amber-400';
  return 'text-[#FF6600]';
});

// Summary
const summaryBgClass = computed(() =>
  failedCount.value > 0
    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800'
    : 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800'
);
const summaryIcon = computed(() => failedCount.value > 0 ? AlertTriangle : CheckCircle2);
const summaryIconClass = computed(() =>
  failedCount.value > 0 ? 'text-amber-500' : 'text-emerald-500'
);
const summaryTitle = computed(() =>
  failedCount.value > 0 ? 'Completed with Errors' : 'All Tiles Exported!'
);
const summaryTextClass = computed(() =>
  failedCount.value > 0
    ? 'text-amber-900 dark:text-amber-100'
    : 'text-emerald-900 dark:text-emerald-100'
);
const summarySubtextClass = computed(() =>
  failedCount.value > 0
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-emerald-700 dark:text-emerald-300'
);
</script>
