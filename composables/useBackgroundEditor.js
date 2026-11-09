// The background-areas editor's shared state: the sidebar section
// (components/controls/BackgroundAreas.vue) holds the tools, the 2D map
// (components/map/backgroundLayer.js) draws and takes the clicks. The mask
// itself lives in the store (store.backgroundMask); this keeps undo, the
// lock question and the roads offered to "Keep road".
import { ref, computed } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { emptyMask } from '../services/backgroundMask.js';

const history = ref([]);
const pendingLock = ref(null);     // the edit waiting on "Lock the area box?"
const readFlag = () => { try { return localStorage.getItem('mapng_background_noLockAsk') === 'true'; } catch { return false; } };
const dontAskLock = ref(readFlag());
const roadChoices = ref([]);        // [{ id, name, pts: [[lat, lng]] }] for Keep road
const roadStatus = ref('idle');     // idle | loading | ready | failed
const hint = ref('');
// Unmask tool: the shape (brush | rect | lasso), the brush's half-width in metres, and
// whether it paints background back instead (also while Shift is held)
const readNum = (k, d) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } };
const unmaskShape = ref((() => { try { return localStorage.getItem('mapng_background_shape') || 'brush'; } catch { return 'brush'; } })());
const brushM = ref(readNum('mapng_background_brush', 150));
const paintBackground = ref(false);
// No smoothing tool: false marks ground left unsmoothed, true smooths it again (also with Shift)
const paintSmooth = ref(false);
const remember = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* blocked */ } };
const hintBad = ref(false);

export function useBackgroundEditor() {
  const store = useMainStore();

  const mask = computed(() => store.backgroundMask);
  const tool = computed({ get: () => store.backgroundTool, set: (v) => { store.backgroundTool = v; } });

  const snapshot = () => JSON.stringify(store.backgroundMask);
  /** Apply a change to the mask: (mask) => newMask, after the lock question when needed. */
  function edit(change, { bounds } = {}) {
    const run = () => {
      history.value = [...history.value.slice(-59), snapshot()];
      const base = store.backgroundMask?.bounds ? store.backgroundMask : { ...emptyMask(), bounds };
      store.setBackgroundMask(change(JSON.parse(JSON.stringify(base))));
    };
    if (store.boxLocked || dontAskLock.value) return run();
    pendingLock.value = run;
  }
  function confirmLock(dontAsk) {
    if (dontAsk) { dontAskLock.value = true; try { localStorage.setItem('mapng_background_noLockAsk', 'true'); } catch { /* blocked */ } }
    const run = pendingLock.value; pendingLock.value = null; run?.();
  }
  function cancelLock() { pendingLock.value = null; }
  function undo() {
    const last = history.value[history.value.length - 1];
    if (!last) return;
    history.value = history.value.slice(0, -1);
    store.setBackgroundMask(JSON.parse(last));
  }
  function clearAll() {
    history.value = [...history.value.slice(-59), snapshot()];
    store.clearBackgroundMask();
    setHint('');
  }
  function setHint(text, bad = false) { hint.value = text; hintBad.value = bad; }

  return {
    unmaskShape, brushM, paintBackground, paintSmooth,
    setShape: (v) => { unmaskShape.value = v; remember('mapng_background_shape', v); },
    setBrush: (v) => { brushM.value = Number(v) || 150; remember('mapng_background_brush', brushM.value); },
    mask, tool, history, pendingLock, dontAskLock, roadChoices, roadStatus, hint, hintBad,
    edit, confirmLock, cancelLock, undo, clearAll, setHint,
  };
}
