// The catalogue of the game's models (every model photographed, sorted by its picture, marked use / maybe / skip
// and given the OSM tags it stands for: refs/output/tag-library, not in the repository) written into the two
// tracked files the code and the tests read:
//
//   data/game-model-catalogue.json   one record per model MapNG can use: what it is, its size, anchor box,
//                                    materials, category and OSM tags. Keyed by the model's path: facts about
//                                    the model, whatever it is used for.
//   data/osm-tag-library.json        keyed by OSM tag (the question an export asks: "amenity=bench here: what do
//                                    I place?"). Each tag's model list is made here from the catalogue; the
//                                    models the code names today stay, with a note where the picture disagrees.
//
// Run again after the catalogue changes: node scripts/tag-library/from-catalogue.mjs
import fs from 'node:fs';

const REFS = 'refs/output/tag-library';
const data = JSON.parse(fs.readFileSync(`${REFS}/organizer-data.json`, 'utf8'));
const mine = fs.existsSync(`${REFS}/organizer-result.json`) ? JSON.parse(fs.readFileSync(`${REFS}/organizer-result.json`, 'utf8')) : {};
const lib = JSON.parse(fs.readFileSync('data/osm-tag-library.json', 'utf8'));
const TODAY = '2026-11-15';

// The catalogue as it stands: the first sort, with the owner's own moves, marks and tags on top.
const catName = Object.fromEntries([...data.categories, ...(mine.customCategories || [])].map((c) => [c.id, c.name]));
const models = data.models.map((m) => ({
  ...m,
  cat: mine.assignments?.[m.id] && catName[mine.assignments[m.id]] ? mine.assignments[m.id] : m.cat,
  use: mine.marks?.[m.id] ?? m.use,
  osm: mine.osmTags?.[m.id] ?? m.osm ?? [],
}));
const byId = new Map(models.map((m) => [m.id, m]));
const REVIEW = new Set(['missing_materials', 'bad_photo', 'sky_photo', 'retake']);

// A level's look: which part of the world its models suit.
const REGION = { west_coast_usa: 'north-america', east_coast_usa: 'north-america', Utah: 'north-america', johnson_valley: 'north-america', italy: 'europe', jungle_rock_island: 'tropical', small_island: 'tropical' };
const regionOf = (m) => REGION[m.level] || 'any';
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const kept = models.filter((m) => (m.use === 'use' || m.use === 'maybe') && !REVIEW.has(m.cat));
const copiesOf = {};
for (const m of models) if (m.use === 'copy' && m.copyOf && byId.get(m.copyOf)) (copiesOf[byId.get(m.copyOf).path] ||= []).push(m.path);
const record = (m) => ({
  shape: m.path, name: m.name, level: m.level, region: regionOf(m), category: m.kind && !catName[m.cat]?.startsWith('custom') ? (REVIEW.has(m.cat) ? m.kind : m.cat) : m.cat,
  mark: m.use, is: m.useWhy || '', tags: m.osm,
  size: m.size ? m.size.map((v) => round(v, 2)) : null, box: m.box ? m.box.map((v) => round(v, 2)) : null,
  materials: m.materials || [], ...(copiesOf[m.path] ? { copies: copiesOf[m.path].sort() } : {}),
});
const records = kept.map(record).sort((a, b) => a.shape.localeCompare(b.shape));
const inCatalogue = new Map(records.map((r) => [r.shape, r]));
const usedCats = [...new Set(records.map((r) => r.category))];
const libraryTags = new Set([...Object.keys(lib.tags), ...Object.values(lib.tags).flatMap((t) => t.also || [])]);
const notInLibrary = {};
for (const r of records) if (r.mark === 'use') for (const t of r.tags) if (!libraryTags.has(t)) notInLibrary[t] = (notInLibrary[t] || 0) + 1;

const catalogue = {
  version: 1,
  about: 'The game\'s own models MapNG can place, one record each, keyed by the model\'s path (shape). Every model in the game was photographed alone on a grid floor and sorted by its picture; here are the ones marked use (placeable as it is) or maybe (needs a decision: a kit piece, a fixed-length span, a one-sided building ...). Skipped models, whole-level meshes and copies of a kept model in other levels are left out (a kept model lists its copies). size: metres across, deep, high. box: the model\'s own box around its origin (min x, y, z, max x, y, z): where its anchor sits. tags: the OpenStreetMap tags it stands for; data/osm-tag-library.json lists the same models by tag. Made by scripts/tag-library/from-catalogue.mjs from the full catalogue (photos and all 5,566 models: kept outside the repository).',
  made: TODAY,
  counts: { use: records.filter((r) => r.mark === 'use').length, maybe: records.filter((r) => r.mark === 'maybe').length },
  categories: Object.fromEntries(data.categories.concat((mine.customCategories || []).map((c) => ({ ...c, group: 'Own' }))).filter((c) => usedCats.includes(c.id)).map((c) => [c.id, { name: c.name, group: c.group || '' }])),
  tagsNotInLibrary: Object.fromEntries(Object.entries(notInLibrary).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  models: records,
};

// The tag library's model lists.
// (a model the code names stays listed even where it is not marked as placed today: the test asks for it)
const code = fs.readdirSync('services').filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(`services/${f}`, 'utf8')).join('\n').toLowerCase();
const namedInCode = (shape) => code.includes(shape.toLowerCase()) || code.includes(shape.toLowerCase().replace(/^\//, ''));
const verdictOf = new Map(models.map((m) => [m.path, m]));
let removed = 0; let noted = 0; let added = 0; let keptCurated = 0;
const changes = [];
for (const [tag, e] of [...Object.entries(lib.tags), ...Object.entries(lib.untagged || {}).map(([k, v]) => [`(untagged) ${k}`, v])]) {
  const untagged = tag.startsWith('(untagged)');
  const out = [];
  for (const a of e.assets) {
    if (a.from === 'catalogue') continue;                                   // (made here last time: made again below)
    const m = verdictOf.get(a.shape); const r = inCatalogue.get(a.shape);
    const confirmed = untagged || (r && r.tags.includes(tag));
    if (a.usedToday || namedInCode(a.shape)) {
      // The code places it today: it stays listed. Where the picture says it is something else, or not fit to
      // place, the entry says so, for a decision in the code.
      const { picture, ...rest } = a;
      if (m && !confirmed) { out.push({ ...rest, picture: `${m.use === 'skip' ? 'Not fit to place: ' : ''}${m.useWhy || 'see the catalogue'}` }); noted++; changes.push(`noted   ${tag}: ${a.shape.split('/').pop()} (${m.useWhy})`); }
      else out.push(rest);
      continue;
    }
    // Matched by its name only, never placed by the code: it stays where the picture confirms it.
    if (confirmed && r) { out.push({ ...a, ...(r.mark === 'maybe' ? { maybe: true } : {}) }); keptCurated++; }
    else { removed++; changes.push(`removed ${tag}: ${a.shape.split('/').pop()} (${m ? `${m.use}: ${m.useWhy}` : 'ruled out of the catalogue'})`); }
  }
  if (!untagged) {
    const have = new Set(out.map((a) => a.shape));
    for (const r of records) if (r.mark === 'use' && r.tags.includes(tag) && !have.has(r.shape)) { out.push({ shape: r.shape, region: r.region, usedToday: false, is: r.is, from: 'catalogue' }); added++; }
  }
  e.assets = out;
}
lib.about = 'Every OpenStreetMap tag MapNG cares about, what it builds for it, and the game\'s own models that stand for it. status: built | partial | planned | ignored. tests/osmTagLibrary.test.mjs keeps it in step with the code (What to build, what is fetched, the models the code names) and with data/game-model-catalogue.json, where each model\'s size, anchor and materials are. A model\'s entry: usedToday (the code places it now), from: "catalogue" (listed by scripts/tag-library/from-catalogue.mjs from the picture review of ' + TODAY + '), maybe (needs a decision before use), picture (what its photo shows, where that is not what the code uses it for), seen (looked at in the running game). A model from another level needs that level\'s materials shipped with the export: public/beamng_shape_materials.json, made by scripts/build-shape-material-library.py.';

// Written with one model per line, so the files stay readable and their diffs small.
const oneLine = (key) => (k, v) => (k === key && Array.isArray(v) ? v.map((x) => `\u0001${JSON.stringify(x)}\u0001`) : v);
const write = (file, obj, key) => fs.writeFileSync(file, JSON.stringify(obj, oneLine(key), 1).replace(/"\\u0001(.*?)\\u0001"/g, (_, s) => JSON.parse(`"${s}"`)) + '\n');
write('data/game-model-catalogue.json', catalogue, 'models');
write('data/osm-tag-library.json', lib, 'assets');
fs.writeFileSync(`${REFS}/use/library-changes.txt`, changes.sort().join('\n') + '\n');
const refs = Object.values(lib.tags).reduce((n, t) => n + t.assets.length, 0);
console.log(`data/game-model-catalogue.json: ${records.length} models (${catalogue.counts.use} use, ${catalogue.counts.maybe} maybe), ${Object.keys(notInLibrary).length} of their tags not in the library yet`);
console.log(`data/osm-tag-library.json: ${removed} name-matched listings removed, ${noted} used-today listings noted, ${keptCurated} confirmed and kept, ${added} added from the catalogue; ${refs} model references on ${Object.values(lib.tags).filter((t) => t.assets.length).length} tags`);
