// The preview's terrain views: the terrain's material drawn to show the
// land's shape instead of its photo. One shader for all of them (switching
// is a uniform, no rebuild):
//   relief:    plain clay, lit by the sun: the shape alone;
//   slope:     coloured by steepness (flat green to cliff purple), what a
//              car can climb at a glance;
//   elevation: coloured by height, valley green to summit white;
// and contour lines over any of them, every `interval` metres (each fifth
// bold), crisp at any zoom.
export const TERRAIN_VIEWS = ['normal', 'relief', 'slope', 'elevation'];

// (slope bands in degrees, for the legend and the shader)
export const SLOPE_BANDS = [
  { deg: 0, color: '#4caf50' }, { deg: 6, color: '#a5d65a' }, { deg: 12, color: '#ffe14d' },
  { deg: 20, color: '#ff9a2e' }, { deg: 30, color: '#e5392f' }, { deg: 40, color: '#6a1b9a' },
];
export const ELEVATION_RAMP = ['#2e7d32', '#8fc45a', '#e8d98f', '#b98c55', '#8a6a5a', '#f4f4f2'];

/** A round contour interval (m) giving 15-30 lines over the relief. */
export function contourInterval(reliefM) {
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const r = Math.max(1, Number(reliefM) || 1);
  return steps.find((s) => r / s <= 25) || 1000;
}

const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2).toFixed(4)); };
const vec = (hex) => `vec3(${lin(hex).join(', ')})`;

/** Uniforms shared with the material (change .value to switch views). */
export function terrainViewUniforms() {
  return { uView: { value: 0 }, uContour: { value: 0 }, uInterval: { value: 10 }, uUpm: { value: 1 }, uMinH: { value: 0 }, uMaxH: { value: 1 } };
}

/** An onBeforeCompile for a MeshStandardMaterial using these uniforms. */
export function terrainViewPatch(uniforms) {
  const slopeRamp = SLOPE_BANDS.map((b, i) => (i === 0 ? `vec3 c = ${vec(b.color)};` : `c = mix(c, ${vec(b.color)}, smoothstep(${(b.deg - 1.5).toFixed(2)}, ${(b.deg + 1.5).toFixed(2)}, s));`)).join('\n      ');
  const elevRamp = ELEVATION_RAMP.map((h, i) => (i === 0 ? `vec3 c = ${vec(h)};` : `c = mix(c, ${vec(h)}, smoothstep(${((i - 0.5) / (ELEVATION_RAMP.length - 1)).toFixed(3)} - 0.06, ${((i - 0.5) / (ELEVATION_RAMP.length - 1)).toFixed(3)} + 0.06, t));`)).join('\n      ');
  const patch = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTvPos;\nvarying vec3 vTvN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTvPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTvN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uView; uniform float uContour; uniform float uInterval; uniform float uUpm; uniform float uMinH; uniform float uMaxH;
varying vec3 vTvPos; varying vec3 vTvN;
vec3 tvSlope(float s) {
      ${slopeRamp}
      return c;
}
vec3 tvElev(float t) {
      ${elevRamp}
      return c;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float tvElevM = vTvPos.y / uUpm + uMinH;
if (uView > 0.5) {
  vec3 tvN = normalize(vTvN);
  float tvS = degrees(acos(clamp(abs(tvN.y), 0.0, 1.0)));
  vec3 tvC = uView < 1.5 ? ${vec('#b3a999')} : uView < 2.5 ? tvSlope(tvS) : tvElev(clamp((tvElevM - uMinH) / max(1.0, uMaxH - uMinH), 0.0, 1.0));
  diffuseColor.rgb = tvC;
}
if (uContour > 0.5) {
  float f = tvElevM / uInterval;
  float w = max(fwidth(f), 1e-4);
  float d = abs(fract(f + 0.5) - 0.5);
  float isMajor = 1.0 - step(0.5, abs(mod(floor(f + 0.5), 5.0)));
  float line = 1.0 - smoothstep(w * (0.6 + isMajor * 0.6), w * (1.4 + isMajor * 0.8), d);
  diffuseColor.rgb = mix(diffuseColor.rgb, ${vec('#2b2118')}, line * (0.5 + 0.35 * isMajor));
}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
if (uView > 0.5) { metalnessFactor = 0.0; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (uView > 0.5) { roughnessFactor = 0.95; }`);
  };
  return patch;
}
