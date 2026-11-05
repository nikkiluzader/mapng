<template>
  <div class="space-y-2">
    <LocationSearch @select="handleSearchSelect" />

    <div class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <label class="text-micro text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">{{ t('map.latitude') }}</label>
        <input type="text" v-model="latInput" @change="handleManualLocationChange"
          @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none"
          :placeholder="t('map.latitude')" />
      </div>
      <div class="space-y-1">
        <label class="text-micro text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">{{ t('map.longitude') }}</label>
        <input type="text" v-model="lngInput" @change="handleManualLocationChange"
          @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none"
          :placeholder="t('map.longitude')" />
      </div>
    </div>

    <select @change="handleLocationSelect"
      :class="SELECT_SM">
      <option v-for="(loc, index) in presetLocations" :key="index" :value="index" :disabled="loc.disabled"
        :selected="index === 0">
        {{ loc.name }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import LocationSearch from './LocationSearch.vue';
import { SELECT_SM } from '../base/controlStyles.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  center: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['locationChange']);

// (at most 6 decimals, about 10 cm: full float precision showed 15 digits)
const fmtCoord = (v) => String(Number(Number(v).toFixed(6)));
const latInput = ref(fmtCoord(props.center.lat));
const lngInput = ref(fmtCoord(props.center.lng));

const presetLocations = [
  { name: t('map.selectLocation'), lat: 0, lng: 0, disabled: true },
  { name: t('map.myLocation'), lat: 0, lng: 0, isMyLocation: true },
  { name: "Devils Tower, USA", lat: 44.59056, lng: -104.71511 },
  { name: "Eye of the Sahara, Mauritania", lat: 21.11460876603993, lng: -11.393508911132812 },
  { name: "Glacier View Car Launch, USA", lat: 61.79551798203474, lng: -147.86878824234012 },
  { name: "Johnson Valley OHV, USA", lat: 34.49523, lng: -116.82180 },
  { name: "Kim Jong Un's Mansion", lat: 39.116331473160436, lng: 125.80600069245881 },
  { name: "Mount Panorama Bathurst NSW, Australia", lat: -33.45568593217826, lng: 149.5507173600283 },
  { name: "Mount Fuji, Japan", lat: 35.3606, lng: 138.7274 },
  { name: "Matterhorn, Switzerland", lat: 45.9763, lng: 7.6586 },
  { name: "Niedzwiedz, Poland", lat: 49.62110908759179, lng: 20.079467296600345 },
  { name: "Rossfeld Panoramastraße, Germany", lat: 47.6087, lng: 13.0234 },
  { name: "Tail of the Dragon, USA", lat: 35.50323405090838, lng: -83.94679069519044 },
];

const handleManualLocationChange = () => {
  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lngInput.value);
  
  if (!isNaN(lat) && !isNaN(lng)) {
    emit('locationChange', { lat, lng });
  }
};

const handleCoordinatePaste = (e) => {
  const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
  const match = pasted.match(/^([\-]?\d+\.?\d*)\s*[,\s\t]+\s*([\-]?\d+\.?\d*)$/);
  if (match) {
    e.preventDefault();
    const a = parseFloat(match[1]);
    const b = parseFloat(match[2]);
    if (!isNaN(a) && !isNaN(b)) {
      latInput.value = fmtCoord(a);
      lngInput.value = fmtCoord(b);
      emit('locationChange', { lat: a, lng: b });
    }
    return;
  }
  nextTick(() => {
    handleManualLocationChange();
  });
};

const handleSearchSelect = (location) => {
  latInput.value = fmtCoord(location.lat);
  lngInput.value = fmtCoord(location.lng);
  emit('locationChange', { lat: location.lat, lng: location.lng });
};

const handleLocationSelect = (event) => {
  const index = event.target.value;
  const loc = presetLocations[index];
  if (loc && !loc.disabled) {
    if (loc.isMyLocation) {
      if (!('geolocation' in navigator)) {
        console.debug('[CoordinatesInput] Geolocation is not supported by this browser.');
      } else {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            latInput.value = fmtCoord(lat);
            lngInput.value = fmtCoord(lng);
            emit('locationChange', { lat, lng });
          },
          (err) => {
            console.debug('[CoordinatesInput] Geolocation access denied or failed.', err);
          },
          {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 600000,
          },
        );
      }
    } else {
      latInput.value = fmtCoord(loc.lat);
      lngInput.value = fmtCoord(loc.lng);
      emit('locationChange', { lat: loc.lat, lng: loc.lng });
    }
  }
  event.target.value = 0;
};

watch(() => props.center, (newVal) => {
  if (parseFloat(latInput.value) !== newVal.lat) {
    latInput.value = fmtCoord(newVal.lat);
  }
  if (parseFloat(lngInput.value) !== newVal.lng) {
    lngInput.value = fmtCoord(newVal.lng);
  }
}, { deep: true });
</script>
