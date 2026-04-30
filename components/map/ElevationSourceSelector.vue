<template>
  <div class="space-y-2">
    <button 
      @click="showElevationSource = !showElevationSource"
      class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
    >
      <span class="flex items-center gap-2">
        <Mountain :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
        {{ t('map.elevationDataSource') }}
      </span>
      <ChevronDown :size="14" :class="['transition-transform duration-200', showElevationSource ? 'rotate-180' : '']" />
    </button>
    
    <div v-if="showElevationSource" class="space-y-2 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
        <!-- Default -->
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
            <input type="radio" v-model="localElevationSource" value="default" class="mt-0.5 accent-[#FF6600]" />
            <div class="space-y-0.5">
              <span class="block text-xs font-medium text-gray-900 dark:text-white">{{ t('map.standard30m') }}</span>
                <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                {{ t('map.standardDescription') }}
                </span>
            </div>
        </label>

        <!-- NMT EVRF2007 -->
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
          <input type="radio" v-model="localElevationSource" value="kron86" class="mt-0.5 accent-[#FF6600]" />
          <div class="space-y-0.5">
            <span class="block text-xs font-medium text-gray-900 dark:text-white">{{ t('map.kron86Poland') }}</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
            {{ t('map.kron86Description') }}
            </span>
          </div>
        </label>

        <!-- USGS -->
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
            <input type="radio" v-model="localElevationSource" value="usgs" class="mt-0.5 accent-[#FF6600]" />
            <div class="space-y-0.5">
                <div class="flex items-center gap-2">
                <span class="block text-xs font-medium text-gray-900 dark:text-white">{{ t('map.usgs1m') }}</span>
                <span v-if="usgsStatus" class="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold px-1 bg-emerald-100 dark:bg-emerald-900/30 rounded">{{ t('map.online') }}</span>
                <span v-else-if="usgsStatus === false" class="text-[9px] text-red-600 dark:text-red-400 font-bold px-1 bg-red-100 dark:bg-red-900/30 rounded">{{ t('map.offline') }}</span>
                </div>
                <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                {{ t('map.usgsDescription') }}
                </span>
            </div>
        </label>

        <!-- GPXZ -->
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
            <input type="radio" v-model="localElevationSource" value="gpxz" class="mt-0.5 accent-[#FF6600]" />
            <div class="space-y-0.5 w-full">
                <span class="block text-xs font-medium text-gray-900 dark:text-white">{{ t('map.gpxzPremium') }}</span>
                <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                    {{ t('map.gpxzDescription') }} <a href="https://www.gpxz.io/docs/dataset#coverage" target="_blank" class="text-[#FF6600] hover:underline" @click.stop>{{ t('map.checkCoverage') }}</a>
                </span>
                
                <div v-if="localElevationSource === 'gpxz'" class="mt-2 animate-in fade-in slide-in-from-top-1">
                    <input 
                        type="password" 
                        v-model="localGpxzApiKey"
                        :placeholder="t('map.enterGpxzKey')"
                        class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                    />
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-1">
                        {{ t('map.freeTier') }} <a href="https://www.gpxz.io/" target="_blank" class="text-[#FF6600] hover:underline">{{ t('map.getKey') }}</a>
                    </p>
                    <p v-if="isBatchMode" class="text-[10px] text-amber-600 dark:text-amber-500 font-medium mt-1">
                      ⚠️ {{ t('map.gpxzBatchWarning', { tiles: totalTiles }) }}
                    </p>
                    <!-- GPXZ Account Status -->
                    <div v-if="localGpxzApiKey" class="mt-2">
                      <button @click="verifyGpxzKey" :disabled="isCheckingGPXZ"
                        class="text-[10px] text-[#FF6600] hover:underline disabled:opacity-50 disabled:no-underline">
                        {{ isCheckingGPXZ ? t('map.checking') : (gpxzStatus ? t('map.refreshStatus') : t('map.checkAccount')) }}
                      </button>
                      <div v-if="gpxzStatus" class="mt-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 p-2 space-y-1">
                        <div class="flex items-center justify-between text-[10px]">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.plan') }}</span>
                          <span :class="['font-bold uppercase', gpxzStatus.plan === 'free' ? 'text-gray-600 dark:text-gray-300' : 'text-emerald-600 dark:text-emerald-400']">{{ gpxzStatus.plan }}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px]">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.today') }}</span>
                          <span class="text-gray-700 dark:text-gray-300">{{ gpxzStatus.used }} / {{ gpxzStatus.limit }}</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 mt-0.5">
                          <div class="h-1 rounded-full transition-all" :class="gpxzStatus.remaining < 20 ? 'bg-red-500' : 'bg-emerald-500'" :style="{ width: Math.min(100, (gpxzStatus.used / gpxzStatus.limit) * 100) + '%' }"></div>
                        </div>
                        <div class="flex items-center justify-between text-[10px]">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.concurrency') }}</span>
                          <span class="text-gray-700 dark:text-gray-300">{{ t('map.parallel', { count: gpxzStatus.concurrency }) }}</span>
                        </div>
                        <p v-if="!gpxzStatus.valid" class="text-[10px] text-red-500 font-medium">⚠️ {{ t('map.invalidApiKey') }}</p>
                      </div>
                    </div>
                    <p v-if="isAreaLargeForGPXZ" class="text-[10px] text-orange-600 dark:text-orange-400 font-medium leading-tight mt-1">
                        ⚠️ {{ t('map.largeAreaWarning', { area: areaSqKm.toFixed(2) }) }}
                    </p>
                </div>
            </div>
        </label>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Mountain, ChevronDown } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  elevationSource: {
    type: String,
    required: true
  },
  usgsStatus: {
    type: Boolean,
    default: null
  },
  gpxzApiKey: {
    type: String,
    default: ''
  },
  gpxzStatus: {
    type: Object,
    default: null
  },
  isCheckingGPXZ: {
    type: Boolean,
    default: false
  },
  isAreaLargeForGPXZ: {
    type: Boolean,
    default: false
  },
  areaSqKm: {
    type: Number,
    default: 0
  },
  isBatchMode: {
    type: Boolean,
    default: false
  },
  totalTiles: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['update:elevationSource', 'update:gpxzApiKey', 'verifyGpxzKey']);

const localElevationSource = ref(props.elevationSource);
const localGpxzApiKey = ref(props.gpxzApiKey);
const showElevationSource = ref(localStorage.getItem('mapng_showElevationSource') === 'true');

watch(showElevationSource, (v) => localStorage.setItem('mapng_showElevationSource', String(v)));

watch(localElevationSource, (newVal) => {
  emit('update:elevationSource', newVal);
});

watch(() => props.elevationSource, (newVal) => {
  localElevationSource.value = newVal;
});

watch(localGpxzApiKey, (newVal) => {
  emit('update:gpxzApiKey', newVal);
});

watch(() => props.gpxzApiKey, (newVal) => {
  localGpxzApiKey.value = newVal;
});

const verifyGpxzKey = () => {
  emit('verifyGpxzKey');
};
</script>
