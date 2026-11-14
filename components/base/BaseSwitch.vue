<template>
  <!-- The app's one on/off switch (role="switch"). It holds no state: the
       parent passes `on` and flips its own value on `toggle`. Inside a <label>
       a click on the label's text toggles it too. -->
  <button
    type="button"
    role="switch"
    :aria-checked="String(!!on)"
    :aria-label="label"
    :disabled="disabled"
    class="relative shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
    :class="on ? 'bg-brand' : 'bg-gray-400 dark:bg-gray-600'"
    :style="{ width: `${dims.w}px`, height: `${dims.h}px` }"
    @click.prevent="onClick"
  >
    <span
      class="absolute top-[3px] rounded-full bg-white transition-all"
      :style="{ width: `${dims.k}px`, height: `${dims.k}px`, left: on ? `${dims.w - dims.k - 3}px` : '3px' }"
    />
  </button>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  on: { type: Boolean, default: false },
  label: { type: String, default: undefined },   // aria-label
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' },         // 'sm' | 'md'
});
const emit = defineEmits(['toggle']);

// (track width and height, knob size, in px)
const dims = computed(() => (props.size === 'sm' ? { w: 28, h: 16, k: 10 } : { w: 34, h: 20, k: 14 }));
const onClick = () => { if (!props.disabled) emit('toggle'); };
</script>
