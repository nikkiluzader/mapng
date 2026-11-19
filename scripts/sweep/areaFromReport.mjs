#!/usr/bin/env node
// A test area from a tester's report: the map data in export_report.json (mapData: the export's input features and
// the map's centre, size, metres per pixel and bounds) written as <MAPNG_AREAS>/<name>/{osm.json, meta.json}, the
// format scripts/sweep/exportArea.mjs reads. The elevation is fetched after, as for any area
// (fetchMapterhorn.mjs <name>, or fetchArea.mjs for GPXZ and 30 m), over the same bounds.
//
//   node scripts/sweep/areaFromReport.mjs <export_report.json | report zip> <name>
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const [src, name] = process.argv.slice(2);
if (!src || !name) { console.error('usage: areaFromReport.mjs <export_report.json | _mapng_report.zip | level zip> <name>'); process.exit(2); }
let text;
if (/\.zip$/i.test(src)) {
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  const entry = Object.keys(zip.files).find((n) => n.endsWith('export_report.json'));
  if (!entry) { console.error('no export_report.json in', src); process.exit(1); }
  text = await zip.file(entry).async('string');
} else text = fs.readFileSync(src, 'utf8');
const report = JSON.parse(text);
const data = report.mapData;
if (!data?.features?.length) { console.error('the report carries no map data (switched off under Fine-tuning, or an older report)'); process.exit(1); }
const dir = path.join(process.env.MAPNG_AREAS || new URL('../../scratch/levelprobe/data', import.meta.url).pathname, name);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(data.features));
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...data.meta, name, fromReport: { level: report.level, build: report.build, sessionCode: report.sessionCode, checksum: data.checksum } }, null, 1));
console.log(`${name}: ${data.features.length} features, ${data.meta.size} px at ${data.meta.mpp} m/px, centre ${data.meta.center.lat}, ${data.meta.center.lng} -> ${dir}`);
console.log('next: the elevation, e.g. node scripts/sweep/fetchMapterhorn.mjs ' + name);
