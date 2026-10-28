<template>
  <div class="space-y-1">
    <label class="text-xs text-gray-500 dark:text-gray-400">{{ t('controlPanel.processingResolutionLabel') }}</label>
    <!-- the common choices one click away; any value can still be typed -->
    <div class="flex flex-wrap gap-1">
      <button
        v-for="choice in CHOICES"
        :key="choice.mpp"
        type="button"
        @click="pick(choice.mpp)"
        :title="t(choice.hint)"
        :class="[
          'px-1.5 py-0.5 rounded border text-[10px] leading-tight',
          current === choice.mpp
            ? 'bg-[#FF6600] border-[#FF6600] text-white'
            : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-[#FF6600]',
        ]"
      >
        {{ choice.mpp }} m<span v-if="choice.mpp === 1"> ★</span>
      </button>
    </div>
    <input
      v-model="inputValue"
      type="text"
      inputmode="decimal"
      @input="handleInput"
      @blur="clampOnBlur"
      class="w-full border rounded px-2 py-2 text-sm outline-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600]"
    />
    <p v-if="outOfRange" class="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
      {{ t('controlPanel.processingResolutionRange', { min: MIN_MPP, max: MAX_MPP }) }}
    </p>
    <!-- what this setting means with the chosen output size -->
    <p v-if="coverageKm" class="text-[10px] text-gray-700 dark:text-gray-300 font-medium">
      {{ t(perTile ? 'controlPanel.processingResolutionCoverageTile' : 'controlPanel.processingResolutionCoverage', { km: coverageKm, px: resolution, mpp: current }) }}
      · {{ t(detailKey) }}
    </p>
    <p class="text-[10px] text-gray-500 dark:text-gray-400">{{ t('controlPanel.processingResolutionGuide') }}</p>
    <p v-if="current > COARSE_MPP" class="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
      <AlertTriangle :size="11" class="shrink-0 mt-px" />
      <span>
        {{ t('controlPanel.processingResolutionCoarse', { mpp: current }) }}
        <template v-if="suggestedPx">{{ t('controlPanel.processingResolutionSuggest', { px: suggestedPx }) }}</template>
      </span>
    </p>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  // Processing resolution in metres per pixel.
  modelValue: { type: [Number, String], default: 1 },
  // The output size (px) it applies to, for the coverage summary.
  resolution: { type: Number, default: 0 },
  // Batch: the output size is per tile.
  perTile: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const CHOICES = [
  { mpp: 0.25, hint: 'controlPanel.processingResolutionPickUltra' },
  { mpp: 0.5, hint: 'controlPanel.processingResolutionPickHigh' },
  { mpp: 1, hint: 'controlPanel.processingResolutionPickStandard' },
  { mpp: 2, hint: 'controlPanel.processingResolutionPickLarge' },
  { mpp: 4, hint: 'controlPanel.processingResolutionPickHuge' },
];
// Past this, roads (5-10 m wide) are a pixel or two of terrain: they and
// small features come out coarse (a user's 8 km export at 8 m/px).
const COARSE_MPP = 2;
// 0.1 m: the finest custom uploads (0.1-0.99 m natives); 10 m: past the
// ~30 m free elevation underneath nothing is gained (16384 px at 10 m
// already spans 164 km).
const MIN_MPP = 0.1;
const MAX_MPP = 10;
const clampMpp = (v) => Math.min(MAX_MPP, Math.max(MIN_MPP, v));
const OUTPUT_SIZES = [1024, 2048, 4096, 8192, 16384];

// Allow only positive decimals (free-typed; up to 10 decimal places).
const PATTERN = /^\d*\.?\d*$/;
const inputValue = ref('1');

const parseInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === '.') return null;
  if (!PATTERN.test(trimmed)) return null;
  if ((trimmed.split('.')[1] || '').length > 10) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const outOfRange = ref(false);

const current = computed(() => {
  const parsed = Number(props.modelValue);
  return Number.isFinite(parsed) && parsed > 0 ? clampMpp(parsed) : 1;
});

const coverageKm = computed(() => {
  if (!(props.resolution > 0)) return '';
  const km = (props.resolution * current.value) / 1000;
  return km >= 10 ? km.toFixed(0) : km >= 1 ? km.toFixed(1) : km.toFixed(2);
});

const detailKey = computed(() => {
  const m = current.value;
  if (m < 0.5) return 'controlPanel.processingResolutionDetailUltra';
  if (m < 1) return 'controlPanel.processingResolutionDetailHigh';
  if (m <= COARSE_MPP) return 'controlPanel.processingResolutionDetailStandard';
  return 'controlPanel.processingResolutionDetailCoarse';
});

// The output size covering the same ground at 1 m/px, when there is one.
const suggestedPx = computed(() => {
  if (!(props.resolution > 0) || props.perTile) return 0;
  const needed = props.resolution * current.value;
  return OUTPUT_SIZES.find((s) => s >= needed && s <= needed * 1.05) || 0;
});

const pick = (mpp) => {
  inputValue.value = String(mpp);
  emit('update:modelValue', mpp);
};

const handleInput = () => {
  const parsed = parseInput(inputValue.value);
  outOfRange.value = parsed !== null && (parsed < MIN_MPP || parsed > MAX_MPP);
  if (parsed === null || outOfRange.value) return;
  emit('update:modelValue', parsed);
};

// leaving the field: an out-of-range value snaps to the nearest limit
const clampOnBlur = () => {
  const parsed = parseInput(inputValue.value);
  if (parsed === null) { inputValue.value = String(current.value); outOfRange.value = false; return; }
  const v = clampMpp(parsed);
  outOfRange.value = false;
  inputValue.value = String(v);
  if (v !== current.value) emit('update:modelValue', v);
};

// Keep the field in sync with the source of truth (e.g. config load).
watch(() => props.modelValue, (newValue) => {
  const parsed = Number(newValue);
  inputValue.value = Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '1';
}, { immediate: true });
</script>
