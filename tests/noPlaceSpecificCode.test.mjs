// Guard: no code path in services/ targets a specific place. Behaviour must
// come from geometry, tags, road class or region data; places may appear in
// comments (as examples), tests and docs only (refs/output/bridge-tunnel-plan.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../services/', import.meta.url).pathname;
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) files.push(p);
  }
};
walk(root);

// code without comments (block comments, and // comments not inside a string)
function codeOf(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

// places the test areas and past fixes are named after
const PLACES = [
  'Deck Park', 'Dames Point', 'St. Augustine', 'St Augustine', 'Jacksonville', 'Phoenix', 'Naldo', 'Butler',
  'Manhattan', 'Central Park', 'Pendleton', 'Zion', 'Twirly', 'Mill Cove', 'San Marco', 'Prudential',
  'Acosta', 'Fuller Warren', 'Papago', 'North 3rd', 'North 7th', 'I-295', 'I-95', 'I-10', 'I-65', 'SR 114',
];
// region and data-coverage logic that legitimately compares coordinates
const LATLNG_ALLOWED = new Map([
  ['beamngRegion.js', 'continental / climate regions for the level look'],
  ['beamngTrees.js', 'climate regions for the tree mix'],
  ['beamngBuildings.js', 'building style regions'],
  ['geoUtils.js', 'UTM hemisphere and zone maths'],
  ['exportBeamNGLevel.js', 'North American town utility poles (region)'],
  ['terrain.js', 'elevation dataset coverage (CONUS / Alaska / Hawaii)'],
]);
const LATLNG = /(?:\b|\.)(?:lat|lng|lon)\s*[<>]=?\s*-?\d+(?:\.\d+)?\b|\b-?\d+(?:\.\d+)?\s*[<>]=?\s*(?:[\w.]*\.)?(?:lat|lng|lon)\b/;
const OSM_ID = /\b(?:id|wayId|osmId)\s*===?\s*['"]?\d{5,}/;

test('no place names in services code (comments may use them as examples)', () => {
  const hits = [];
  for (const f of files) {
    const code = codeOf(fs.readFileSync(f, 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const place of PLACES) if (line.includes(place)) hits.push(`${path.relative(root, f)}:${i + 1} ${place}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('no OSM id literals in services code', () => {
  const hits = [];
  for (const f of files) {
    codeOf(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => { if (OSM_ID.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});

test('coordinate comparisons only in region / coverage modules', () => {
  const hits = [];
  for (const f of files) {
    if (LATLNG_ALLOWED.has(path.basename(f))) continue;
    codeOf(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => { if (LATLNG.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(hits, []);
});
