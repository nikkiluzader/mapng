<!-- A short line of help with the rest behind a "More about this" link. -->
<template>
  <div class="text-caption leading-snug text-gray-500 dark:text-gray-400">
    <span v-if="short">{{ short }}</span>{{ short ? ' ' : '' }}
    <button v-if="more" type="button" data-testid="hint-more" class="text-brand hover:underline" :aria-expanded="open" @click.prevent.stop="open = !open">{{ open ? t('build.tune.less') : t('build.tune.more') }}</button>
    <p v-if="open && more" data-testid="hint-more-text" class="mt-1 rounded bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-2 py-1.5 text-gray-600 dark:text-gray-300">{{ more }} <slot /></p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
defineProps({ short: { type: String, default: '' }, more: { type: String, default: '' } });
const { t } = useI18n();
const open = ref(false);
</script>
