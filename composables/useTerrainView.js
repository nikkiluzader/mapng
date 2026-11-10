import { ref, watch } from 'vue';
import { TERRAIN_VIEWS } from '../components/three/terrainView.js';

// The terrain view (the land's photo, or its shape: relief, slope, height)
// and the contour lines: one choice for the 2D and the 3D preview.
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const stored = read('mapng_preview_terrain_view', 'normal');

export const terrainView = ref(TERRAIN_VIEWS.includes(stored) ? stored : 'normal');
export const showContours = ref(read('mapng_preview_contours', '0') === '1');
watch(terrainView, (v) => { try { localStorage.setItem('mapng_preview_terrain_view', v); } catch { /* not kept */ } });
watch(showContours, (v) => { try { localStorage.setItem('mapng_preview_contours', v ? '1' : '0'); } catch { /* not kept */ } });
