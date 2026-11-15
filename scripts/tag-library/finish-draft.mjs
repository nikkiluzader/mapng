#!/usr/bin/env node
// One-off: the researched draft (refs/output/tag-library/osm-tag-library.draft.json, git-ignored) made into
// data/osm-tag-library.json: variants named in a "what" made machine-readable (`also`), the models the code
// uses that the draft missed put on their tags, and the things MapNG places without a tag listed apart.
//   node scripts/tag-library/finish-draft.mjs
import fs from 'node:fs';
const draft = JSON.parse(fs.readFileSync('refs/output/tag-library/osm-tag-library.draft.json', 'utf8'));
const models = JSON.parse(fs.readFileSync('refs/output/tag-library/game-models.json', 'utf8'));
const used = JSON.parse(fs.readFileSync('refs/output/tag-library/models-used-by-mapng.json', 'utf8'));
const byLower = new Map(models.map((m) => [m.path.toLowerCase(), m.path]));
const real = (p) => byLower.get((p.startsWith('/') ? p : `/${p}`).toLowerCase().replace(/\.cdae$/, '.dae')) || null;
const tags = draft.tags;

// "(also motorway_link, x)" in a what: the same thing under another value of the same key
for (const [tag, e] of Object.entries(tags)) {
  const m = /\(also ([^)]+)\)/.exec(e.what || '');
  if (!m) continue;
  const key = tag.split('=')[0];
  const also = m[1].split(/,\s*|\s+and\s+/).map((v) => v.trim()).filter((v) => /^[a-z0-9_:-]+$/i.test(v)).map((v) => `${key}=${v}`);
  if (also.length) { e.also = also; e.what = e.what.replace(/\s*\(also [^)]+\)/, '').trim(); }
}
const addAlso = (tag, list) => { if (tags[tag]) tags[tag].also = [...new Set([...(tags[tag].also || []), ...list])]; else throw new Error(`no entry ${tag}`); };
addAlso('highway=primary', ['highway=primary_link']); addAlso('highway=secondary', ['highway=secondary_link']);
addAlso('highway=tertiary', ['highway=tertiary_link']); addAlso('highway=trunk', ['highway=trunk_link']); addAlso('highway=motorway', ['highway=motorway_link']);
addAlso('highway=unclassified', ['highway=road']);
addAlso('barrier=gate', ['barrier=hampshire_gate', 'barrier=bump_gate', 'barrier=wicket_gate', 'barrier=kissing_gate', 'barrier=turnstile', 'barrier=full-height_turnstile']);

// models the code uses that the draft did not list, put where they belong
const asset = (p, extra = {}) => { const shape = real(p); if (!shape) throw new Error(`not in the game: ${p}`); return { shape, usedToday: true, ...extra }; };
const give = (tag, paths, extra) => { const e = tags[tag]; if (!e) throw new Error(`no entry ${tag}`); for (const p of paths) { const a = asset(p, extra); if (!e.assets.some((x) => x.shape === a.shape)) e.assets.push(a); } };
const find = (re) => Object.keys(used).filter((p) => re.test(p));
tags['maxspeed=*'] = {
  what: 'The speed limit of a road', on: ['way'], group: 'roads', item: 'signs', status: 'built', fetched: true,
  fetchedNote: 'A property of the road way, which is fetched',
  builds: 'A speed limit sign where the limit changes along a road',
  assets: [], code: 'services/roadSigns.js, services/beamngPropLibrary.js',
};
give('maxspeed=*', find(/speed_limit|sign_speed\d/i), { region: 'north-america' });
give('barrier=fence', find(/eca_bld_wood_fence_a/i), { region: 'north-america' });
give('amenity=charging_station', find(/eca_charging_station/i), { region: 'north-america' });
give('amenity=fuel', find(/eca_gastation_pumps/i), { region: 'north-america' });
give('highway=street_lamp', find(/electrical_pole_lamp/i));
give('leisure=marina', find(/italy_boat_/i), { region: 'europe' });
give('barrier=handrail', find(/si_harbour_railing/i), { region: 'tropical' });

// what MapNG places that no tag asks for: worked out from the roads and the place
draft.untagged = {
  curveWarningSigns: { what: 'Bend, chevron and winding-road warning signs before sharp curves, worked out from the road\'s shape', group: 'roads', item: 'signs', code: 'services/curveWarningSigns.js, services/beamngPropLibrary.js', assets: find(/chevron_|curve_|winding_road/i).map((p) => asset(p, { region: 'north-america' })) },
  flag: { what: 'The flag at the level\'s start point', code: 'services/flagPlacement.js, services/beamngPropLibrary.js', assets: find(/eca_flag_usa/i).map((p) => asset(p)) },
  fencePosts: { what: 'Posts between fence panels', code: 'services/beamngPropLibrary.js', assets: find(/pole_fence2/i).map((p) => asset(p)) },
};
// trees, bushes, rocks and ground cover: picked from libraries of their own, far too many to list per tag
const count = (re) => Object.entries(used).filter(([, files]) => files.some((f) => re.test(f))).length;
draft.assetLibraries = {
  trees: { file: 'services/beamngTreeLibrary.js', models: count(/TreeLibrary/), what: 'Tree and bush models by species, leaf type, size and region: used by natural=tree, tree rows, woods, forests, orchards, scrub and hedges' },
  biome: { file: 'services/beamngBiomeCatalog.js', models: count(/BiomeCatalog/), what: 'Rocks, ground cover and filler vegetation by the region\'s look' },
};
// every model checked against the game, spelled as the game spells it
let n = 0;
for (const e of [...Object.values(tags), ...Object.values(draft.untagged)]) for (const a of e.assets) { const r = real(a.shape); if (!r) throw new Error(`not in the game: ${a.shape}`); a.shape = r; n++; }
const out = {
  version: 1,
  about: 'Every OpenStreetMap tag MapNG cares about, what it builds for it, and the game\'s own models that stand for it. status: built | partial | planned | ignored. A reference for now: tests/osmTagLibrary.test.mjs keeps it in step with the code (What to build, what is fetched, the models the code names). Researched 2026-11-15; models were matched by name and most have not been looked at in the game yet.',
  countsFrom: draft.countsFrom, regions: draft.regions,
  tags: Object.fromEntries(Object.entries(tags).sort((a, b) => a[0].localeCompare(b[0]))),
  untagged: draft.untagged, assetLibraries: draft.assetLibraries,
};
fs.writeFileSync('data/osm-tag-library.json', JSON.stringify(out, null, 1) + '\n');
console.log(`data/osm-tag-library.json: ${Object.keys(out.tags).length} tags, ${n} model references, ${Object.values(out.tags).filter((t) => t.also).length} with variants`);
