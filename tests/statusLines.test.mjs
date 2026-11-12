// The lines under the progress bar in every language (services/statusLines.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localizeStatus, compilePatterns } from '../services/statusLines.js';

const load = (lang) => JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const LANGS = fs.readdirSync(new URL('../locales/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const tFor = (lang) => { const lines = load(lang).statusLines; return (key, values) => String(lines[key]).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? ''); };

// Lines the app really showed in the end-to-end runs, and the ones with optional endings.
const REAL = [
  'Checking Mapterhorn lidar coverage...', 'Fetching Mapterhorn lidar tiles (z17, 9)...', 'Downloaded 20/26 global tiles...',
  'Resampling heightmap to 1m/px: Mapping satellite imagery to the output grid (42%)', 'Resampling heightmap to 0.5m/px...',
  'Fetching OpenStreetMap data...', 'Reading OpenStreetMap data from MapNG tiles...', 'Adding missing buildings and heights from Overture Maps...',
  'Loading land cover (ESA WorldCover)…', 'Finalizing terrain data...', 'Reading which trees grow here (iNaturalist records)...',
  'Blending satellite imagery with vector overlays...', 'Drawing land cover and roads on the game map...', 'Drawing vector maps (roads, buildings, landuse)...', 'Saving the terrain…',
  'Preparing…', 'Handing the map to the desktop exporter…', 'Preparing 512×512 terrain and 2140 OSM features…',
  'Laying out 366 OSM roads: DecalRoads, lane markings, junctions, bridge decks and tunnels, and shaping the terrain under them…',
  'Laying out 12 OSM roads: DecalRoads, lane markings, junctions, bridge decks and tunnels (terrain under them left as it is)…',
  'Building sidewalks, curbs and ramps along 118 carriageways…', 'Building sidewalks, curbs and ramps along 118 carriageways (3 bridge decks built)…',
  'Placing street props (hydrants, bins, benches, utility poles, power lines) and traffic signals…', 'Generating the OSM base texture for the 512×512 terrain…',
  'Fitting the base texture to the 512×512 grid (313 KB source)…', 'Painting terrain materials from OSM land use (512×512 layer map)…',
  'Writing the terrain binary (terrain.ter, 512×512 heights + material layers)…', 'Encoding the 16-bit heightmap PNG (512×512)…', 'Rendering the level preview thumbnail…',
  'Building the surrounding backdrop (global 30 m elevation + satellite imagery, 8 tiles)…', 'Backdrop: Building the backdrop meshes and textures…',
  'Building textured 3D buildings (174 OSM footprints)…', 'Building textured 3D buildings (174 OSM footprints, 2 dams)…', 'Building water: sea level plane, lakes and rivers…',
  'Placing barriers, fences, road signs, traffic lights, lamps, benches and fuel stations…',
  'Planting trees and bushes where the land cover (ESA WorldCover) has them, rocks, ground cover and props…',
  'Loading bundled assets (MapNG flag, reflection cubemap)…', 'Assembling the level files (levels/cordova_street/…)…',
  'Compressing 497 files (66.7 MB) into the level ZIP…', 'Compressing the level ZIP (66.7 MB, 497 files): art/cubemaps/skybox4.hdr.dds (5.3 MB)…', 'Done',
  'Downloading NMT EVRF2007 tile 3/12 (2023)...', 'Fetching GPXZ tiles... 3/9 (87 API calls remaining today)', 'Combined level: Compressing ZIP...',
];

test('every language has every status line, with the same gaps', () => {
  const en = load('en').statusLines; const keys = Object.keys(en).sort();
  assert.ok(keys.length > 100);
  const gaps = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const lang of LANGS) {
    const lines = load(lang).statusLines;
    assert.deepEqual(Object.keys(lines).sort(), keys, lang);
    for (const k of keys) { assert.equal(gaps(lines[k]), gaps(en[k]), `${lang}.${k}`); assert.ok(!/[|@]/.test(lines[k]), `${lang}.${k} has a character vue-i18n reads as syntax`); }
  }
});

test('real progress lines come out in the language, with their numbers kept', () => {
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    const t = tFor(lang);
    for (const line of REAL) {
      const out = localizeStatus(line, t);
      assert.notEqual(out, line.replace(/\.{3}/g, '…'), `${lang}: "${line}" was not translated`);
      for (const n of line.match(/\d+(?:\.\d+)?/g) || []) assert.ok(out.includes(n), `${lang}: "${out}" lost ${n}`);
      assert.ok(!/\{\w+\}/.test(out), `${lang}: "${out}" has an unfilled gap`);
    }
  }
});

test('English comes back as it was; an unknown line is shown as it is; the ending is kept', () => {
  const t = tFor('en');
  for (const line of REAL) assert.equal(localizeStatus(line, t), line.replace(/\.{3}/g, '…'));
  const de = tFor('de');
  assert.equal(localizeStatus('Some new step nobody listed…', de), 'Some new step nobody listed…');
  assert.equal(localizeStatus('', de), '');
  assert.ok(localizeStatus('Finalizing terrain data...', de).endsWith('…'));
  assert.ok(!localizeStatus('Done', de).endsWith('…'));
  assert.equal(localizeStatus('Backdrop: Building the backdrop meshes and textures…', de), 'Kulisse: Netze und Texturen der Kulisse werden erstellt…');
});

test('the most specific pattern wins', () => {
  const c = compilePatterns({ a: 'Building {n} things', b: 'Building {n} things ({d} extra)' });
  assert.equal(localizeStatus('Building 4 things (2 extra)', (k, v) => `${k}:${v.n}:${v.d ?? ''}`, c), 'b:4:2');
  assert.equal(localizeStatus('Building 4 things', (k, v) => `${k}:${v.n}`, c), 'a:4');
});
