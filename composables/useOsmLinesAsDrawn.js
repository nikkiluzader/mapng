import { ref, watch } from 'vue';
import { OSM_LINES_AS_DRAWN_KEY } from '../services/roadCurves.js';

// Map data > Keep map lines as drawn (services/roadCurves.js): off by default, so Generate rounds the corners of
// roads, railways and paths. Shared by the setting (ControlPanel) and the generation key (App.vue).
const read = () => { try { return localStorage.getItem(OSM_LINES_AS_DRAWN_KEY) === 'true'; } catch { return false; } };
const on = ref(read());
watch(on, (v) => { try { localStorage.setItem(OSM_LINES_AS_DRAWN_KEY, String(v)); } catch { /* not kept */ } });

export const useOsmLinesAsDrawn = () => ({ on });
