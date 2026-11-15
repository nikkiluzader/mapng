// data/osm-tag-library.json: the OSM tags MapNG cares about and the game's models for them, kept in step with the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONTENT_GROUPS } from '../services/buildContent.js';
import { OSM_FILTER } from '../services/overpassQuery.js';

const root = new URL('../', import.meta.url);
const lib = JSON.parse(fs.readFileSync(new URL('data/osm-tag-library.json', root), 'utf8'));
const tags = lib.tags;
const known = new Set([...Object.keys(tags), ...Object.values(tags).flatMap((t) => t.also || [])]);
const covered = (k, v) => known.has(`${k}=${v}`) || known.has(`${k}=*`) || (v === '*' && [...known].some((t) => t.startsWith(`${k}=`)));
const sources = fs.readdirSync(new URL('services/', root)).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(new URL(`services/${f}`, root), 'utf8')]);
const MODEL_RE = /['"`](\/?(?:levels|art|assets)\/[A-Za-z0-9_./ -]+\.c?dae)['"`]/gi;
const norm = (p) => (p.startsWith('/') ? p : `/${p}`).toLowerCase().replace(/\.cdae$/, '.dae');
const everyAsset = [...Object.entries(tags), ...Object.entries(lib.untagged || {})].flatMap(([name, e]) => e.assets.map((a) => [name, a]));

test('every entry is well formed', () => {
  const groups = new Set([...CONTENT_GROUPS.map((g) => g.id), 'landmarks', 'industry', 'airfields']);   // (the last three: proposed, not in What to build yet)
  for (const [tag, e] of Object.entries(tags)) {
    assert.match(tag, /^[a-z_:]+=[A-Za-z0-9_:*-]+$/, tag);
    assert.ok(e.what && Array.isArray(e.on) && e.on.length && e.on.every((o) => ['node', 'way', 'area'].includes(o)), `${tag}: what, on`);
    assert.ok(['built', 'partial', 'planned', 'ignored'].includes(e.status), `${tag}: status`);
    assert.ok(Array.isArray(e.assets), `${tag}: assets`);
    if (e.status === 'ignored') assert.ok(e.why, `${tag}: an ignored tag says why`);
    else assert.ok(e.builds, `${tag}: what it builds`);
    if (e.status === 'built' || e.status === 'partial') assert.ok(e.code || e.note, `${tag}: where it is built`);
    if (e.group) assert.ok(groups.has(e.group), `${tag}: group ${e.group}`);
    if (!e.assets.length && e.status !== 'ignored') assert.ok(e.generated || e.fallback || e.note || e.builds, `${tag}: no model, so what is made`);
    for (const a of e.assets) assert.match(a.shape, /^\/(levels|art|assets)\/.+\.dae$/i, `${tag}: ${a.shape}`);
    for (const also of e.also || []) assert.ok(!tags[also], `${tag}: variant ${also} has an entry of its own too`);
  }
});

test('every tag What to build switches on has an entry', () => {
  const missing = [];
  for (const g of CONTENT_GROUPS) for (const it of g.items) for (const sel of it.tags || []) { const [k, v] = sel.split('='); if (!covered(k, v)) missing.push(`${it.id}: ${sel}`); }
  assert.deepEqual(missing, []);
});

test('every tag fetched by exact value has an entry, and says it is fetched', () => {
  const missing = [...OSM_FILTER.nodeTags, ...OSM_FILTER.wayTags].filter(([k, v]) => `${k}=${v}` !== 'area=yes' && !covered(k, v)).map((p) => p.join('='));
  assert.deepEqual(missing, []);
  const wrong = OSM_FILTER.nodeTags.map(([k, v]) => `${k}=${v}`).filter((t) => tags[t] && tags[t].on[0] === 'node' && tags[t].fetched === false);
  assert.deepEqual(wrong, [], 'fetched as a node, but the library says it is not');
});

test('every model the code names is in the library (trees, bushes and rocks are in libraries of their own)', () => {
  const inLibrary = new Set(everyAsset.map(([, a]) => norm(a.shape)));
  const own = new Set(Object.values(lib.assetLibraries).map((l) => l.file.replace('services/', '')));
  const missing = [];
  for (const [file, text] of sources) {
    if (own.has(file)) continue;
    for (const m of text.matchAll(MODEL_RE)) if (!inLibrary.has(norm(m[1]))) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual([...new Set(missing)], [], 'add each to its tag in data/osm-tag-library.json (or to "untagged"), marked usedToday');
  for (const l of Object.values(lib.assetLibraries)) assert.ok(fs.existsSync(new URL(l.file, root)), l.file);
});

test('a model marked as used today is one the code really names', () => {
  // (the code names a model in its own text, or through the picks it reads: data/tag-models.json)
  const all = (sources.map(([, t]) => t).join('\n') + fs.readFileSync(new URL('data/tag-models.json', root), 'utf8')).toLowerCase();
  const stale = everyAsset.filter(([, a]) => a.usedToday).filter(([, a]) => {
    const p = norm(a.shape); const base = p.split('/').pop().replace(/\.dae$/, '');
    // (named whole, or put together from a folder and a name: the road signs)
    return !(all.includes(p) || all.includes(p.replace(/\.dae$/, '')) || all.includes(base) || all.includes(base.replace(/^(italy_traf_sign_|sign_)/, ''))
      // (a speed sign's file is its folder, 'speed_' and the number)
      || all.includes(base.replace(/^(italy_traf_sign_|sign_)/, '').replace(/\d+$/, '')));
  }).map(([name, a]) => `${name}: ${a.shape}`);
  assert.deepEqual(stale, []);
});

test('every model exists in the game (checked where the catalogue of the game\'s models is at hand)', (t) => {
  const catalogue = new URL('refs/output/tag-library/game-models.json', root);
  if (!fs.existsSync(catalogue)) return t.skip('no catalogue here: refs/ is not in the repository');
  const have = new Set(JSON.parse(fs.readFileSync(catalogue, 'utf8')).map((m) => m.path));
  assert.deepEqual(everyAsset.filter(([, a]) => !have.has(a.shape)).map(([name, a]) => `${name}: ${a.shape}`), []);
});

// data/game-model-catalogue.json: the models MapNG can place, by path; the library lists the same models by tag.
const cat = JSON.parse(fs.readFileSync(new URL('data/game-model-catalogue.json', root), 'utf8'));
const inCat = new Map(cat.models.map((m) => [m.shape, m]));

test('the model catalogue is well formed', () => {
  assert.equal(inCat.size, cat.models.length, 'a model is listed once');
  for (const m of cat.models) {
    assert.match(m.shape, /^\/(levels|art|assets)\/.+\.dae$/i, m.shape);
    assert.ok(['use', 'maybe'].includes(m.mark), `${m.shape}: mark`);
    assert.ok(cat.categories[m.category], `${m.shape}: category ${m.category}`);
    assert.ok(lib.regions.includes(m.region), `${m.shape}: region`);
    assert.ok(m.size === null || (m.size.length === 3 && m.size.every((v) => v >= 0)), `${m.shape}: size`);
    assert.ok(m.box === null || m.box.length === 6, `${m.shape}: box`);
    for (const tag of m.tags) assert.match(tag, /^[A-Za-z0-9_:]+=[^\s=]+$/, `${m.shape}: ${tag}`);
    // (a copy of a kept model is not a model of its own)
    for (const c of m.copies || []) assert.ok(!inCat.has(c), `${m.shape}: its copy ${c} is listed too`);
  }
  assert.deepEqual(cat.counts, { use: cat.models.filter((m) => m.mark === 'use').length, maybe: cat.models.filter((m) => m.mark === 'maybe').length });
});

test('a model listed under a tag is in the catalogue with that tag, unless the code places it today', () => {
  const wrong = [];
  for (const [tag, e] of Object.entries(tags)) for (const a of e.assets) {
    if (a.usedToday || a.picture) continue;   // (named by the code: listed whatever its picture shows, with a note)
    const m = inCat.get(a.shape);
    if (!m) wrong.push(`${tag}: ${a.shape} is not in the catalogue`);
    else if (!m.tags.includes(tag)) wrong.push(`${tag}: ${a.shape} does not carry the tag`);
    else if ((m.mark === 'maybe') !== Boolean(a.maybe)) wrong.push(`${tag}: ${a.shape} is ${m.mark} in the catalogue`);
  }
  assert.deepEqual(wrong, [], 'run node scripts/tag-library/from-catalogue.mjs');
});

test('every catalogue model marked use is listed under each of its tags the library has', () => {
  const missing = [];
  for (const m of cat.models) if (m.mark === 'use') for (const tag of m.tags) if (tags[tag] && !tags[tag].assets.some((a) => a.shape === m.shape)) missing.push(`${tag}: ${m.shape}`);
  assert.deepEqual(missing, [], 'run node scripts/tag-library/from-catalogue.mjs');
  for (const tag of Object.keys(cat.tagsNotInLibrary)) assert.ok(!tags[tag], `${tag} is in the library`);
});

// data/tag-models.json: what the export reads, made from the picks (data/model-picks.json).
test('the models picked per tag are catalogue models marked use', async () => {
  const picked = JSON.parse(fs.readFileSync(new URL('data/tag-models.json', root), 'utf8')).tags;
  const picks = JSON.parse(fs.readFileSync(new URL('data/model-picks.json', root), 'utf8')).picks;
  assert.deepEqual(Object.keys(picked).sort(), Object.keys(picks).sort(), 'run node scripts/tag-library/from-catalogue.mjs');
  for (const [key, byRegion] of Object.entries(picked)) {
    const tag = key.split('#')[0];   // (a variant of the tag's object after #)
    assert.ok(tags[tag], `${tag} is in the library`);
    assert.ok(Object.values(byRegion).some((m) => m.length), `${key}: a model somewhere`);
    for (const [region, models] of Object.entries(byRegion)) {
      assert.ok(lib.regions.includes(region), `${tag}: region ${region}`);
      assert.deepEqual(models.map((m) => m.shape), picks[key][region], `${key} ${region}: run node scripts/tag-library/from-catalogue.mjs`);
      for (const m of models) { assert.equal(inCat.get(m.shape)?.mark, 'use', `${tag}: ${m.shape}`); assert.ok(Number.isFinite(m.yaw) && m.size?.length === 3 && m.box?.length === 6, `${tag}: ${m.shape} yaw, size, box`); }
    }
  }
  const { tagModel, tagModelsFor, regionOfBiome } = await import('../services/tagModels.js');
  assert.equal(regionOfBiome('italy'), 'europe'); assert.equal(regionOfBiome('nowhere'), 'any');
  // (the export hands the regional look itself)
  const { BEAMNG_BIOMES } = await import('../services/beamngBiomeCatalog.js');
  assert.equal(regionOfBiome(BEAMNG_BIOMES.find((b) => b.id === 'west_coast_usa')), 'north-america');
  for (const b of BEAMNG_BIOMES) assert.ok(lib.regions.includes(regionOfBiome(b)), b.id);
  const bench = tagModel('amenity=bench', 'italy');
  assert.ok(bench.shapeFile.endsWith('.dae') && Number.isFinite(bench.yawOffset));
  // (the same n, the same model; a tag with no pick, none)
  assert.equal(tagModel('amenity=bench', 'utah', 7).shapeFile, tagModel('amenity=bench', 'utah', 7).shapeFile);
  assert.equal(tagModel('amenity=nothing_picked', 'utah'), null); assert.deepEqual(tagModelsFor('amenity=nothing_picked', 'utah'), []);
});

test('a mapped point falls under one object rule, and stands beside its road facing it', async () => {
  const { tagObjectFor, standTagObject, tagObjectNodeTags, isTagObjectNode, tagModel } = await import('../services/tagModels.js');
  assert.equal(tagObjectFor({ highway: 'bus_stop', shelter: 'yes' }).id, 'busShelter');
  assert.equal(tagObjectFor({ highway: 'bus_stop' }).id, 'busStopSign');
  assert.equal(tagObjectFor({ highway: 'bus_stop', shelter: 'no' }).id, 'busStopSign');
  assert.equal(tagObjectFor({ tourism: 'information', information: 'board' }).id, 'infoBoard');
  assert.equal(tagObjectFor({ tourism: 'information', information: 'office' }), null);
  assert.equal(tagObjectFor({ amenity: 'recycling', recycling_type: 'centre' }), null);
  assert.equal(tagObjectFor({ amenity: 'bench' }), null);
  assert.ok(isTagObjectNode({ tourism: 'information' }) && !isTagObjectNode({ amenity: 'cafe' }));
  // every object's tag is asked for, and its pick has a model somewhere
  for (const [k, v] of tagObjectNodeTags()) assert.ok(OSM_FILTER.nodeTags.some(([a, b]) => a === k && b === v), `${k}=${v} is fetched`);
  assert.ok(tagModel('highway=bus_stop#shelter', 'italy').shapeFile.includes('italy_city_busstop'));
  assert.equal(tagModel('tourism=information', 'italy'), null, 'a board whose text is another country\'s is not placed');
  // a stop mapped on the road's centre line: moved out beside the lanes, its front to the road
  const rule = tagObjectFor({ highway: 'bus_stop', shelter: 'yes' });
  const onRoad = standTagObject(rule, 10, 1, { cx: 10, cy: 0, dist: 1, halfWidth: 3.5 }, {}, 0);
  assert.ok(Math.abs(onRoad.x - 10) < 1e-9 && Math.abs(onRoad.y - (3.5 + rule.beside)) < 1e-9, `stands at ${onRoad.x}, ${onRoad.y}`);
  assert.ok(Math.abs(onRoad.facing - -Math.PI / 2) < 1e-9, 'faces the road');
  // one mapped well clear of the road stays where it is; a direction tag wins
  const clear = standTagObject(rule, 10, 12, { cx: 10, cy: 0, dist: 12, halfWidth: 3.5 }, { direction: '90' }, 0);
  assert.ok(clear.y === 12 && Math.abs(clear.facing) < 1e-9);
  // no road near: placed, turned the same way every time
  assert.equal(standTagObject(rule, 0, 0, null, {}, 5).facing, standTagObject(rule, 0, 0, null, {}, 5).facing);
});
