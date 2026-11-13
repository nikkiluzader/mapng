import { ref, computed, watch } from 'vue';
import { useMainStore } from '../stores/mainStore.js';

// What is being made, chosen at the Generate step (Advanced mode): a BeamNG level, assets for creators
// (heightmaps, textures, 3D models, map files), or both. The Export step shows only what the choice needs.
// Basic mode makes a level. The choice binds nothing: it can be changed after generating.
export const WORKFLOW_STORAGE_KEY = 'mapng_workflow';
export const WORKFLOWS = ['level', 'assets', 'both'];
const read = () => { try { const v = localStorage.getItem(WORKFLOW_STORAGE_KEY); return WORKFLOWS.includes(v) ? v : 'level'; } catch { return 'level'; } };
const workflow = ref(read());
watch(workflow, (v) => { try { localStorage.setItem(WORKFLOW_STORAGE_KEY, v); } catch { /* not kept */ } });

export function useWorkflow() {
  const store = useMainStore();
  /** The choice in effect: Basic mode has none to make. */
  const active = computed(() => (store.advancedMode ? workflow.value : 'level'));
  return { workflow, active, showLevel: computed(() => active.value !== 'assets'), showAssets: computed(() => active.value !== 'level') };
}
