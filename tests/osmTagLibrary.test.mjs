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
  const all = sources.map(([, t]) => t).join('\n').toLowerCase();
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
