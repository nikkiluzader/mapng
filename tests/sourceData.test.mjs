import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceMapData, reportToMarkdown, buildReportJson } from '../services/exportBeamNGLevel.js';

const features = [
  { id: '1_seg_0', type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: 45.5, lng: 6.9 }, { lat: 45.501, lng: 6.901 }] },
  { id: '2', type: 'building', tags: { building: 'yes' }, geometry: [{ lat: 45.5, lng: 6.9 }, { lat: 45.5, lng: 6.9001 }, { lat: 45.5001, lng: 6.9001 }] },
];
const bounds = { north: 45.51, south: 45.49, east: 6.91, west: 6.89 };
const terrainData = { width: 2048, height: 2048, processingMetersPerPixel: 1, bounds };

// The map data for a bug report: the features as the export had them, the map's test-area meta, and a checksum.
test('map data: the features, a test area\'s meta, and a checksum of exactly them', () => {
  const d = sourceMapData({ features, terrainData, center: { lat: 45.5, lng: 6.9 }, levelName: 't' });
  assert.deepEqual(d.features, features);
  assert.equal(d.count, 2);
  assert.deepEqual(d.meta, { name: 't', center: { lat: 45.5, lng: 6.9 }, size: 2048, mpp: 1, bounds, fetchBounds: bounds, preprocessed: true });
  assert.match(d.checksum, /^[0-9a-f]{14}$/);
  assert.equal(sourceMapData({ features, terrainData, center: {}, levelName: 'u' }).checksum, d.checksum, 'the same data, the same checksum');
  assert.notEqual(sourceMapData({ features: features.slice(1), terrainData, center: {}, levelName: 'u' }).checksum, d.checksum);
  assert.match(d.license, /Open Database License/);
  assert.equal(sourceMapData({ features: [], terrainData, center: {}, levelName: 't' }), null);
});

// The report for people in Markdown: titles and sections as headings, each bridge its own, the console log in a block.
test('the export report in Markdown', () => {
  const md = reportToMarkdown([
    'MapNG BeamNG Level Export Report', '================================', '', 'Summary', '- Level: t', '',
    'Bridges', '-------', '- Bridge decks: 1', '', 'Bridge b001: unnamed [primary]', '  - Length 12 m', '',
    'Left on the ground (drawn over the terrain as before):', '  - unnamed [track]', '',
    'Job Console Log', '---------------', '- 2 line(s)', '', '[    0.01s] LOG   start', '[    0.02s] WARN  <b>x</b>', '',
  ].join('\n'));
  assert.match(md, /^# MapNG BeamNG Level Export Report$/m);
  assert.match(md, /^## Summary$/m);
  assert.match(md, /^## Bridges$/m);
  assert.match(md, /^### Bridge b001: unnamed \[primary\]$/m);
  assert.match(md, /^Left on the ground \(drawn over the terrain as before\):$/m, 'a line ending in a colon stays text');
  assert.match(md, /```text\n\[ {4}0\.01s\] LOG {3}start\n\[ {4}0\.02s\] WARN {2}<b>x<\/b>\n```/, 'the log as a block, untouched');
});

// The report to send: every part as data, no keys or tokens, the map data when it is left in.
test('the JSON report: the checks as data, no secrets, the map data', () => {
  const mapData = sourceMapData({ features, terrainData, center: { lat: 45.5, lng: 6.9 }, levelName: 't' });
  const j = JSON.parse(JSON.stringify(buildReportJson({
    levelName: 't', center: { lat: 45.5, lng: 6.9 }, terrainData,
    osmRequest: { endpointUsed: 'mapng-osm-tiles', osmSnapshot: '2026-11-02' },
    options: { includeBridges: true, gpxzApiKey: 'SECRET1', customOverpass: { url: 'u', token: 'SECRET2' }, onProgress: () => {}, sessionCode: 'mapng:1:x', big: new Array(600).fill(1) },
    structureChecks: { joints: { steps: 0 } }, processingLog: [{ step: 'a', durationMs: 5 }], reportMarkdown: '# r', jobLog: { lines: ['l1'] }, mapData,
  })));
  assert.equal(j.format, 'mapng-export-report');
  assert.equal(j.sessionCode, 'mapng:1:x');
  assert.equal(j.options.includeBridges, true);
  assert.ok(!JSON.stringify(j).includes('SECRET'), 'no keys or tokens');
  assert.equal(j.options.big, '[Array 600]');
  assert.deepEqual(j.structureChecks, { joints: { steps: 0 } });
  assert.equal(j.osmRequest.osmSnapshot, '2026-11-02');
  assert.deepEqual(j.mapData.features, features);
  assert.equal(j.report, '# r');
});

// A tester's report back into a test area (scripts/sweep/areaFromReport.mjs), as exportArea.mjs reads one.
test('a JSON report becomes a test area', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-area-'));
  const mapData = sourceMapData({ features, terrainData, center: { lat: 45.5, lng: 6.9 }, levelName: 't' });
  fs.writeFileSync(path.join(tmp, 'export_report.json'), JSON.stringify(buildReportJson({ levelName: 't', center: { lat: 45.5, lng: 6.9 }, terrainData, options: {}, reportMarkdown: '', mapData })));
  execFileSync('node', [new URL('../scripts/sweep/areaFromReport.mjs', import.meta.url).pathname, path.join(tmp, 'export_report.json'), 'fz_t'], { env: { ...process.env, MAPNG_AREAS: tmp }, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'fz_t', 'osm.json'), 'utf8')), features);
  const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'fz_t', 'meta.json'), 'utf8'));
  assert.equal(meta.size, 2048); assert.equal(meta.preprocessed, true); assert.equal(meta.name, 'fz_t');
  fs.rmSync(tmp, { recursive: true });
});
