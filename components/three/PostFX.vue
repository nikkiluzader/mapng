<script setup>
// The preview's look (Visual quality "Cinematic"): the scene rendered through
// a post-processing chain instead of straight to the screen.
//   ambient occlusion (GTAO): soft contact shadow in valleys, at building
//     bases and under trees, which gives the terrain its depth;
//   bloom: a gentle glow where sunlit water and pale ground are brightest;
//   grade: vibrance and a little contrast (satellite imagery is flat), a
//     subtle vignette pulling the eye to the middle;
//   output: tone mapping and sRGB, as the renderer does without a chain.
// The render target is multisampled, so edges stay smooth without SMAA.
// "Standard" (the default where the GPU is software or weak) unmounts this
// and Tres renders as before.
import { onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { useTresContext, useLoop } from '@tresjs/core';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const props = defineProps({
  ao: { type: Boolean, default: true },
  bloom: { type: Number, default: 0.22 },
  vibrance: { type: Number, default: 0.28 },
  contrast: { type: Number, default: 0.12 },
  vignette: { type: Number, default: 0.32 },
});

const { renderer, scene, camera, sizes } = useTresContext();
const { render } = useLoop();

// vibrance (saturation that spares what is already saturated), contrast
// around mid grey, and a soft vignette; in linear light, before the output pass
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vibrance: { value: props.vibrance },
    contrast: { value: props.contrast },
    vignette: { value: props.vignette },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float vibrance; uniform float contrast; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float mx = max(col.r, max(col.g, col.b)); float mn = min(col.r, min(col.g, col.b));
      float sat = mx - mn;
      col = mix(vec3(l), col, 1.0 + vibrance * (1.0 - smoothstep(0.0, 0.6, sat)));
      // (contrast in a perceptual-ish space: around a mid grey of the linear image)
      col = max(col, 0.0);
      vec3 p = pow(col, vec3(1.0 / 2.2));
      p = (p - 0.5) * (1.0 + contrast) + 0.5;
      col = pow(max(p, 0.0), vec3(2.2));
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.35, 0.95, length(d * vec2(1.15, 1.0)) * 1.25);
      gl_FragColor = vec4(col, c.a);
    }`,
};

let composer = null;
let gtao = null;
let bloomPass = null;
let grade = null;

function build() {
  dispose();
  const r = renderer.value; const s = scene.value; const cam = camera.value;
  if (!r || !s || !cam) return;
  const w = Math.max(1, sizes.width.value); const h = Math.max(1, sizes.height.value);
  const pr = r.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: r.capabilities.isWebGL2 ? 4 : 0 });
  composer = new EffectComposer(r, target);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(s, cam));
  if (props.ao) {
    gtao = new GTAOPass(s, cam, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    // (scene units: the map is 100 across; a building is ~0.5, a valley ~5)
    gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.2, thickness: 3, scale: 1.2, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 1.0;
    composer.addPass(gtao);
  }
  if (props.bloom > 0) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), props.bloom, 0.55, 0.92);
    composer.addPass(bloomPass);
  }
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
}

function dispose() {
  if (composer) {
    composer.passes.forEach((p) => p.dispose?.());
    composer.renderTarget1?.dispose(); composer.renderTarget2?.dispose();
  }
  composer = null; gtao = null; bloomPass = null; grade = null;
}

watch([renderer, scene, camera], build, { immediate: true });
watch([sizes.width, sizes.height], ([w, h]) => {
  if (!composer) return;
  composer.setSize(Math.max(1, w), Math.max(1, h));
  gtao?.setSize(Math.max(1, w), Math.max(1, h));
});
watch(() => [props.ao, props.bloom], build);
watch(() => [props.vibrance, props.contrast, props.vignette], () => {
  if (!grade) return;
  grade.uniforms.vibrance.value = props.vibrance;
  grade.uniforms.contrast.value = props.contrast;
  grade.uniforms.vignette.value = props.vignette;
});

// (the camera Tres renders with can be replaced: the passes follow it)
const registration = render(({ renderer: r, scene: s, camera: cam }) => {
  if (!composer) { if (r && s && cam) r.render(s, cam); return; }
  const c = cam || camera.value;
  for (const p of composer.passes) { if ('camera' in p && p.camera !== c) p.camera = c; }
  composer.render();
});

// (unmounted: Tres goes back to its own render)
onUnmounted(() => { registration?.off?.(); dispose(); });
</script>

<template>
  <!-- nothing drawn itself: it renders the scene -->
</template>
