#!/usr/bin/env node
// The data and thumbnails of the asset review page (/asset-review.html, shown on the dev site only): every OSM tag in
// the tag library with the game models MapNG has for it, each model with its photo from the private catalogue.
//   node scripts/tag-library/asset-page.mjs <catalogue dir> <out dir>
// Writes <out>/data.json and <out>/t/<id>.jpg. Nothing is written into the repository: the photos are of the game's
// own assets and stay in private storage (r2 asset-page/, served by worker/assetPage.js where ASSET_PAGE is set).
import fs from 'node:fs'; import path from 'node:path';
const [cat, out] = process.argv.slice(2);
if (!cat || !out) { console.error('usage: asset-page.mjs <catalogue dir> <out dir>'); process.exit(1); }
const repo = new URL('../../', import.meta.url).pathname;
const lib = JSON.parse(fs.readFileSync(path.join(repo, 'data/osm-tag-library.json'), 'utf8'));
const models = JSON.parse(fs.readFileSync(path.join(repo, 'data/tag-models.json'), 'utf8'));
const org = JSON.parse(fs.readFileSync(path.join(cat, 'organizer-data.json'), 'utf8'));
const byPath = new Map(org.models.map((m) => [m.path.toLowerCase(), m]));
const thumbs = new Set(fs.readdirSync(path.join(cat, 'thumbs')));
fs.mkdirSync(path.join(out, 't'), { recursive: true });
const used = new Map();   // shape -> model record of the page
let missing = 0;
const modelOf = (shape) => {
  const key = String(shape).toLowerCase();
  if (used.has(key)) return used.get(key);
  const m = byPath.get(key);
  let thumb = null;
  if (m) {
    const file = [`${m.id}_${m.face}.jpg`, ...[...thumbs].filter((f) => f.startsWith(`${m.id}_`))].find((f) => thumbs.has(f));
    if (file) { thumb = `${m.id}.jpg`; fs.copyFileSync(path.join(cat, 'thumbs', file), path.join(out, 't', thumb)); }
  }
  if (!thumb) missing++;
  const rec = { shape, name: m?.name || path.basename(shape, '.dae'), level: m?.level || (shape.split('/')[2] || ''), size: m?.size || null, kind: m?.kindName || '', thumb };
  used.set(key, rec); return rec;
};
// the models the export places today, by tag (data/tag-models.json: picks per region, and the named parts)
const placed = new Set();
for (const regions of Object.values(models.tags || {})) for (const list of Object.values(regions)) for (const m of list) placed.add(String(m.shape).toLowerCase());
for (const p of Object.values(models.parts || {})) if (p.shape) placed.add(String(p.shape).toLowerCase());
const tags = [];
for (const [tag, e] of Object.entries(lib.tags)) {
  const assets = (e.assets || []).filter((a) => a.shape).map((a) => {
    const m = modelOf(a.shape);
    return { shape: a.shape, region: a.region || 'any', used: !!a.usedToday || placed.has(a.shape.toLowerCase()), is: a.is || '' };
  });
  tags.push({ tag, what: e.what || '', group: e.group || '', item: e.item || '', status: e.status || '', builds: e.builds || '', count: e.count || 0, assets });
}
// parts the code places that no tag entry lists (lamps, hydrants, signals...)
const listed = new Set(tags.flatMap((t) => t.assets.map((a) => a.shape.toLowerCase())));
const parts = [];
for (const [id, p] of Object.entries(models.parts || {})) {
  if (!p.shape || listed.has(p.shape.toLowerCase())) continue;
  modelOf(p.shape); parts.push({ id, tag: p.tag || '', shape: p.shape });
}
const data = { made: new Date().toISOString().slice(0, 10), libraryVersion: lib.version, regions: lib.regions || null, tags, parts, models: Object.fromEntries([...used.values()].map((m) => [m.shape, m])) };
fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data));
console.log(`${tags.length} tags (${tags.filter((t) => t.assets.length).length} with models), ${parts.length} other parts, ${used.size} models, ${used.size - missing} with a photo, ${missing} without; data.json ${(fs.statSync(path.join(out, 'data.json')).size / 1024).toFixed(0)} KB`);
