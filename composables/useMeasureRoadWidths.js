import { ref, watch } from 'vue';
import { MEASURE_WIDTHS_STORAGE_KEY } from '../services/satRoadWidth.js';

// Map data > Measure road widths from the satellite picture, shared by the setting itself (ControlPanel) and
// the line in Fine-tuning that points to it (WhatToBuild): on/off, and a request to be shown the setting.
const read = () => { try { return localStorage.getItem(MEASURE_WIDTHS_STORAGE_KEY) === 'true'; } catch { return false; } };
const on = ref(read());
watch(on, (v) => { try { localStorage.setItem(MEASURE_WIDTHS_STORAGE_KEY, String(v)); } catch { /* not kept */ } });
const showRequest = ref(0);   // (counted up by "Change it in Map data"; the control panel goes there)

export const useMeasureRoadWidths = () => ({ on, showRequest, show: () => { showRequest.value += 1; } });
