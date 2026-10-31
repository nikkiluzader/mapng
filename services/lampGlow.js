// A street lamp's glow seen from afar, for night only. The lamp's own head is
// a few pixels at 60 m and gone past ~150 m: at night a lit street faded out
// a block from the camera. One shared shape at every lamp head: a speck near
// the camera (the head itself shows there), then balls that grow with
// distance so each stays about GLOW_PX pixels across, in the engine's camera
// detail levels (base00 > start01, a mesh named <name><size> drawn while the
// shape's on-screen size is at least <size>). Its material adds light only
// (black by day, the night emissive at night: nothing to see in daylight).

import * as THREE from 'three';
import { ColladaExporter } from './ColladaExporter.js';

export const LAMP_GLOW_MATERIAL = 'mapng_lamp_glow';
export const LAMP_GLOW_SHAPE = 'mapng_lamp_glow.dae';

const RADII = [0.25, 0.45, 0.8, 1.4, 2.4, 4];   // m, nearest first
const SPECK_R = 0.01;
const NEAR_M = 60;            // the speck nearer than this (the lamp head shows)
const GLOW_PX = 4;            // a ball's width on screen when the next one takes over
const SCREEN_PX = 1130;       // px per radian at 1440 px high and a 65 degree field of view
const ENGINE_PX = 4100;       // the engine's detail size per (shape radius / distance), measured in game
const LAST_PX = 2;

/** The detail sizes where the speck and each ball begin, falling. */
export function glowDetailSizes() {
  const R = RADII.at(-1) * Math.sqrt(3);   // the shape's radius: its box's half diagonal
  const ends = [NEAR_M, ...RADII.slice(0, -1).map((r) => (2 * r * SCREEN_PX) / GLOW_PX)];
  return [...ends.map((d) => Math.max(LAST_PX + 1, Math.round((R * ENGINE_PX) / d))), LAST_PX];
}

function ball(r) {
  const g = new THREE.SphereGeometry(r, 8, 5);
  return g.toNonIndexed();
}

/** The glow shape as Collada text. */
export function buildLampGlowDAE() {
  const sizes = glowDetailSizes();
  const base00 = new THREE.Group(); base00.name = 'base00';
  const start01 = new THREE.Group(); start01.name = 'start01';
  const mat = new THREE.MeshStandardMaterial({ name: LAMP_GLOW_MATERIAL });
  [SPECK_R, ...RADII].forEach((r, i) => {
    const m = new THREE.Mesh(ball(r), mat);
    m.name = `glow${String.fromCharCode(97 + i)}${sizes[i]}`;
    start01.add(m);
  });
  base00.add(start01);
  base00.updateMatrixWorld(true);
  return new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' })?.data ?? null;
}

/** The glow's material: adds its colour only, black by day (the night emissive lights it). */
export function lampGlowMaterialDef(color = [1, 0.8, 0.55]) {
  return {
    name: LAMP_GLOW_MATERIAL,
    mapTo: LAMP_GLOW_MATERIAL,
    class: 'Material',
    version: 1.5,
    Stages: [{
      baseColorFactor: [0, 0, 0, 1],
      emissiveFactor: color,
      instanceEmissive: true,
      emissiveIntensityNits: 150,   // (400 bloomed into smears at dusk, when the night emissive comes on in a lit sky)
      roughnessFactor: 1,
      metallicFactor: 0,
    }, {}, {}, {}],
    translucent: true,
    translucentBlendOp: 'Add',
    translucentZWrite: false,
    castShadows: false,
    doubleSided: false,
  };
}
