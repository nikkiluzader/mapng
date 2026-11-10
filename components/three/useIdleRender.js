// A still scene is not drawn 60 times a second. The preview drew every frame
// whether or not anything moved, and its Cinematic chain (a 4x multisampled
// half-float target, ambient occlusion and its denoise, bloom) is the dearest
// thing the window does: the whole app lagged behind it from the moment the
// preview opened. shouldDraw(camera) says whether this frame is worth a draw:
// every frame while the camera moves, the pointer works the view, anything in
// the window is clicked or changed, and for IDLE_AFTER_MS after any of those;
// then IDLE_FPS, enough for what loads late (a texture, the sky, the trees) to
// appear and the water to shimmer.
import { watch, onUnmounted } from 'vue';
import * as THREE from 'three';

export const IDLE_AFTER_MS = 1500;
export const IDLE_FPS = 4;

/** The rule alone (no DOM): for tests. now and times in ms. */
export function idleDrawRule({ now, lastActive, lastDrawn, idleAfter = IDLE_AFTER_MS, idleFps = IDLE_FPS }) {
  return now - lastActive < idleAfter || now - lastDrawn >= 1000 / idleFps;
}

export function useIdleRender(renderer, wakeOn = () => null) {
  let lastActive = performance.now();
  let lastDrawn = 0;
  const lastView = new THREE.Matrix4(); const lastProj = new THREE.Matrix4();
  const wake = () => { lastActive = performance.now(); };
  // (pointermove counts only with a button down: hovering the view is not using it)
  const onMove = (ev) => { if (ev.buttons) wake(); };
  const CANVAS_EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart', 'touchmove'];
  // (a click or a change anywhere in the window: the scene settings, the texture buttons, the panel)
  const DOC_EVENTS = ['pointerdown', 'change', 'input'];
  let target = null;
  const detach = () => {
    if (!target) return;
    for (const e of CANVAS_EVENTS) target.removeEventListener(e, wake);
    target.removeEventListener('pointermove', onMove);
    target = null;
  };
  watch(renderer, (r) => {
    detach();
    target = r?.domElement || null;
    if (!target) return;
    for (const e of CANVAS_EVENTS) target.addEventListener(e, wake, { passive: true });
    target.addEventListener('pointermove', onMove, { passive: true });
    wake();
  }, { immediate: true });
  if (typeof document !== 'undefined') for (const e of DOC_EVENTS) document.addEventListener(e, wake, { passive: true, capture: true });
  watch(wakeOn, wake);
  onUnmounted(() => {
    detach();
    if (typeof document !== 'undefined') for (const e of DOC_EVENTS) document.removeEventListener(e, wake, { capture: true });
  });

  const shouldDraw = (cam) => {
    const now = performance.now();
    if (cam && (!lastView.equals(cam.matrixWorld) || !lastProj.equals(cam.projectionMatrix))) {
      lastView.copy(cam.matrixWorld); lastProj.copy(cam.projectionMatrix); lastActive = now;
    }
    if (!idleDrawRule({ now, lastActive, lastDrawn })) return false;
    lastDrawn = now;
    return true;
  };
  return { shouldDraw, wake };
}
