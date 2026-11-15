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
// Models looked at in the game (2026-11-15, placed side by side and measured): what each really is, and its
// size in metres [across, deep, high]. A name alone misleads: "s_postbox" is a household mailbox on a post.
const SEEN = {
  '/levels/west_coast_usa/art/shapes/objects/pylon.dae': { is: 'A lattice transmission tower for high-voltage lines', size: [7.8, 8.6, 35.8] },
  '/levels/automation_test_track/art/shapes/objects/pylon.dae': { is: 'The same lattice transmission tower', size: [7.8, 8.6, 35.8] },
  '/levels/hirochi_raceway/art/shapes/objects/toilet.dae': { is: 'A portable toilet cabin', size: [1.2, 1.2, 2.5] },
  '/levels/johnson_valley/art/shapes/building/s_postbox.dae': { is: 'A household mailbox on a post (American, at a driveway): not a street post box', size: [0.7, 0.6, 1.2] },
  '/levels/italy/art/shapes/buildings/italy_clutter_mailbox.dae': { is: 'A small red post box, wall or post mounted (Italian)', size: [0.5, 0.3, 0.7] },
  '/levels/west_coast_usa/art/shapes/objects/postbox_blue.dae': { is: 'A blue street collection box (American)', size: [0.6, 0.6, 1.6] },
  '/levels/hirochi_raceway/art/shapes/objects/gazebo_black.dae': { is: 'A pop-up event canopy, roof on four legs: not a park gazebo', size: [6.0, 6.0, 2.5] },
  '/levels/west_coast_usa/art/shapes/buildings/s_cement_silo.dae': { is: 'A tall narrow silo', size: [4.4, 4.4, 17.0] },
  '/levels/small_island/art/shapes/buildings/si_wind_vane.dae': { is: 'A thin mast with a fitting on top (not made out from a distance)', size: [0.8, 0.6, 6.4] },
  '/levels/west_coast_usa/art/shapes/buildings/celltower.dae': { is: 'A cell tower', size: [5.5, 4.9, 28.9] },
  '/levels/west_coast_usa/art/shapes/objects/industrial_watertower.dae': { is: 'A water tower on legs', size: [7.0, 7.0, 26.2] },
  '/levels/west_coast_usa/art/shapes/buildings/busstop_wca.dae': { is: 'A small bus shelter', size: [1.4, 4.1, 3.1] },
  '/levels/italy/art/shapes/buildings/italy_city_busstop.dae': { is: 'A bus shelter with an advertising panel', size: [6.1, 2.6, 3.8] },
  '/levels/driver_training/art/shapes/objects/turbine_tower.dae': { is: 'A wind turbine tower (the blades are separate models)', size: [3.7, 7.6, 130.0] },
  '/levels/west_coast_usa/art/shapes/objects/pumpjack_a.dae': { is: 'An oil pumpjack', size: [4.1, 15.6, 10.5] },
  '/levels/Utah/art/shapes/buildings/ut_picnic_table_a.dae': { is: 'A picnic table with benches', size: [2.0, 1.4, 0.9] },
  '/levels/west_coast_usa/art/shapes/objects/dumpster.dae': { is: 'A large roll-off skip, lorry sized: not a small wheeled bin', size: [2.6, 5.3, 2.3] },
  '/levels/west_coast_usa/art/shapes/objects/s_camera_speed1.dae': { is: 'A speed camera head only: needs a pole', size: [0.6, 0.4, 0.5] },
  '/levels/hirochi_raceway/art/shapes/objects/billboard_10x5.dae': { is: 'A billboard on legs', size: [11.7, 0.4, 10.3] },
};
// Meshes of one whole level, 150 m and more across: a level's whole rumble strips, dam, power lines, pipeline or
// toll plaza in that level's own place. Nothing that can be put down somewhere else, whatever the name says.
const WHOLE_LEVEL = ['racetrack_rumblestrip', 's_dam', 's_powerlines_01', 'construction_tollbooth', 'pipeline_segment1'];
let dropped = 0;
for (const e of Object.values(tags)) { const n = e.assets.length; e.assets = e.assets.filter((x) => !WHOLE_LEVEL.some((w) => new RegExp(`/${w}\\.dae$`, 'i').test(x.shape))); dropped += n - e.assets.length; }
console.log(`whole-level meshes taken off their tags: ${dropped}`);
// (the household mailbox is no street post box: taken off that tag)
if (tags['amenity=post_box']) tags['amenity=post_box'].assets = tags['amenity=post_box'].assets.filter((x) => !/s_postbox\.dae$/i.test(x.shape));
let seen = 0;
for (const e of [...Object.values(tags), ...Object.values(draft.untagged)]) for (const x of e.assets) {
  const s = SEEN[real(x.shape) || x.shape]; if (s) { x.is = s.is; x.size = s.size; x.seen = '2026-11-15'; seen++; }
}
console.log(`looked at in the game: ${Object.keys(SEEN).length} models, on ${seen} references`);
// every model checked against the game, spelled as the game spells it
let n = 0;
for (const e of [...Object.values(tags), ...Object.values(draft.untagged)]) for (const a of e.assets) { const r = real(a.shape); if (!r) throw new Error(`not in the game: ${a.shape}`); a.shape = r; n++; }
const out = {
  version: 1,
  about: 'Every OpenStreetMap tag MapNG cares about, what it builds for it, and the game\'s own models that stand for it. status: built | partial | planned | ignored. A reference for now: tests/osmTagLibrary.test.mjs keeps it in step with the code (What to build, what is fetched, the models the code names). Researched 2026-11-15; models were matched by name, and only those with `seen` have been looked at in the game (`is`: what it really is, `size`: metres across, deep, high). A model from another level needs that level\'s materials shipped with the export: public/beamng_shape_materials.json, made by scripts/build-shape-material-library.py.',
  countsFrom: draft.countsFrom, regions: draft.regions,
  tags: Object.fromEntries(Object.entries(tags).sort((a, b) => a[0].localeCompare(b[0]))),
  untagged: draft.untagged, assetLibraries: draft.assetLibraries,
};
fs.writeFileSync('data/osm-tag-library.json', JSON.stringify(out, null, 1) + '\n');
console.log(`data/osm-tag-library.json: ${Object.keys(out.tags).length} tags, ${n} model references, ${Object.values(out.tags).filter((t) => t.also).length} with variants`);
