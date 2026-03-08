<template>
  <div class="space-y-2">
    <LocationSearch @select="handleSearchSelect" />

    <div class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Latitude</label>
        <input type="text" v-model="latInput" @change="handleManualLocationChange"
          @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
          placeholder="Latitude" />
      </div>
      <div class="space-y-1">
        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Longitude</label>
        <input type="text" v-model="lngInput" @change="handleManualLocationChange"
          @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
          placeholder="Longitude" />
      </div>
    </div>

    <select @change="handleLocationSelect"
      class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none">
      <option v-for="(loc, index) in presetLocations" :key="index" :value="index" :disabled="loc.disabled"
        :selected="index === 0">
        {{ loc.name }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import LocationSearch from './LocationSearch.vue';

const props = defineProps({
  center: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['locationChange']);

const latInput = ref(props.center.lat.toString());
const lngInput = ref(props.center.lng.toString());

const presetLocations = [
  { name: "Select a location...", lat: 0, lng: 0, disabled: true },
  { name: "Devils Tower, USA", lat: 44.59056, lng: -104.71511 },
  { name: "Glacier View Car Launch, USA", lat: 61.79551798203474, lng: -147.86878824234012 },
  { name: "Johnson Valley OHV, USA", lat: 34.49523, lng: -116.82180 },
  { name: "Mount Panorama Bathurst NSW, Australia", lat: -33.45568593217826, lng: 149.5507173600283 },
  { name: "Mount Fuji, Japan", lat: 35.3606, lng: 138.7274 },
  { name: "Matterhorn, Switzerland", lat: 45.9763, lng: 7.6586 },
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
      latInput.value = a.toString();
      lngInput.value = b.toString();
      emit('locationChange', { lat: a, lng: b });
    }
    return;
  }
  nextTick(() => {
    handleManualLocationChange();
  });
};

const handleSearchSelect = (location) => {
  latInput.value = location.lat.toString();
  lngInput.value = location.lng.toString();
  emit('locationChange', { lat: location.lat, lng: location.lng });
};

const handleLocationSelect = (event) => {
  const index = event.target.value;
  const loc = presetLocations[index];
  if (loc && !loc.disabled) {
    latInput.value = loc.lat.toString();
    lngInput.value = loc.lng.toString();
    emit('locationChange', { lat: loc.lat, lng: loc.lng });
  }
  event.target.value = 0;
};

watch(() => props.center, (newVal) => {
  if (parseFloat(latInput.value) !== newVal.lat) {
    latInput.value = newVal.lat.toString();
  }
  if (parseFloat(lngInput.value) !== newVal.lng) {
    lngInput.value = newVal.lng.toString();
  }
}, { deep: true });
</script>
