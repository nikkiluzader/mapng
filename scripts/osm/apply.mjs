#!/usr/bin/env node
// Upload the APPROVED proposals of a batch as one changeset (dry run unless --upload).
//
//   node scripts/osm/apply.mjs refs/osm-fixes/<batch>.json             dry run: what would change
//   node scripts/osm/apply.mjs refs/osm-fixes/<batch>.json --upload    upload to the live server
//   node scripts/osm/apply.mjs --dev --selftest --upload               round trip on the test server
//
// Each element is read again right before it is changed: if any key the proposal touches no longer
// holds the value the proposal saw, nothing is uploaded for the batch (re-propose it). Only the
// approved tag edits are made; nodes, members and every other tag stay as the server has them. The
// changeset says where the fixes came from (a MapNG level review, AI-assisted, each edit checked by a
// person against the listed sources and photos). Every changeset is logged in refs/output/osm-edits.md.
import fs from 'node:fs';
import path from 'node:path';
import { serverOf, SERVERS, getElement, elementXml, openChangeset, closeChangeset, api, applyChange, stillAsSeen } from './common.mjs';

const argv = process.argv.slice(2);
const server = serverOf(argv);
const upload = argv.includes('--upload');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const LOG = path.join(REPO, 'refs/output/osm-edits.md');

if (argv.includes('--selftest')) {
  if (server !== SERVERS.dev) { console.error('--selftest only runs on the test server (--dev)'); process.exit(2); }
  if (!upload) { console.log('selftest: would create a node, change its tag, delete it on the test server (add --upload)'); process.exit(0); }
  const me = await api(server, 'GET', '/user/details.json');
  const cs = await openChangeset(server, { comment: 'MapNG maintenance scripts: self-test (create, modify, delete one node)', created_by: 'MapNG maintenance scripts' });
  const id = Number(await api(server, 'PUT', '/node/create', { body: `<osm><node changeset="${cs}" lat="40.4406" lon="-79.9959"><tag k="note" v="mapng selftest"/></node></osm>`, json: false }));
  let e = await getElement(server, 'node', id);
  e.tags = applyChange(e.tags, { set: { note: 'mapng selftest (modified)' } });
  await api(server, 'PUT', `/node/${id}`, { body: elementXml(e, cs), json: false });
  e = await getElement(server, 'node', id);
  await api(server, 'DELETE', `/node/${id}`, { body: elementXml(e, cs), json: false });
  await closeChangeset(server, cs);
  console.log(`selftest OK as ${me.user?.display_name}: changeset ${cs} on the test server (node ${id} created, tag changed to "${e.tags.note}", deleted)`);
  process.exit(0);
}

const file = argv.find((a) => a.endsWith('.json'));
if (!file) { console.error('usage: apply.mjs <batch>.json [--upload] [--dev]'); process.exit(2); }
const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
const todo = batch.proposals.filter((p) => p.status === 'approved' && !p.changeset);
if (!todo.length) { console.log('nothing approved and not yet uploaded (review.mjs --approve <ids>)'); process.exit(0); }

// read everything again first: all or nothing
const plan = [];
for (const p of todo) {
  const e = await getElement(server, p.type, p.id);
  const check = stillAsSeen(e.tags, p);
  if (!check.ok) { console.error(`${p.type} ${p.id} (${p.name}): changed on OSM since the proposal (${check.drift.join(', ')}); nothing uploaded. Re-propose it.`); process.exit(1); }
  const after = applyChange(e.tags, p.change);
  const changed = Object.keys({ ...e.tags, ...after }).filter((k) => e.tags?.[k] !== after[k]);
  if (!changed.length) { console.log(`${p.type} ${p.id} (${p.name}): already as proposed, skipped`); continue; }
  plan.push({ p, e, after, changed });
  console.log(`${p.type} ${p.id} v${e.version} ${p.name}: ${changed.map((k) => `${k}: ${e.tags?.[k] ?? '(none)'} -> ${after[k] ?? '(removed)'}`).join('; ')}`);
}
if (!plan.length) process.exit(0);
const sources = [...new Set(plan.flatMap(({ p }) => p.sources || []))];
// (the batch's comment names only what this upload changes: {names} is filled from the plan, a skipped
// proposal left out; a comment without it is used only when every proposal is in the upload)
const names = [...new Set(plan.map(({ p }) => String(p.name || `${p.type} ${p.id}`).replace(/\s*\(.*\)\s*$/, '')))].join(', ');
const auto = `Fix ${[...new Set(plan.flatMap(({ changed }) => changed))].join(', ')} on ${names}`;
const comment = batch.changesetComment?.includes('{names}') ? batch.changesetComment.replace('{names}', names)
  : batch.changesetComment && plan.length === batch.proposals.length ? batch.changesetComment : auto;
const tags = {
  comment: `${comment}. Found in a MapNG level review (AI-assisted); each edit checked by a person against the listed sources and photos.`,
  created_by: 'MapNG maintenance scripts',
  ...(sources.length ? { source: sources.join(';') } : {}),
  ...(batch.hashtags ? { hashtags: batch.hashtags } : {}),
};
console.log(`\nchangeset tags: ${JSON.stringify(tags, null, 1)}`);
if (!upload) { console.log(`\ndry run on the ${server === SERVERS.dev ? 'test' : 'live'} server: add --upload to make these ${plan.length} edit(s)`); process.exit(0); }
if (server === SERVERS.dev) { console.error('the batch\'s elements live on the live server; --dev is for --selftest'); process.exit(2); }

const cs = await openChangeset(server, tags);
try {
  for (const { p, e, after } of plan) {
    const v = Number(await api(server, 'PUT', `/${p.type}/${p.id}`, { body: elementXml({ ...e, tags: after }, cs), json: false }));
    p.changeset = cs; p.uploadedVersion = v; p.status = 'uploaded'; p.uploadedAt = new Date().toISOString();
    console.log(`${p.type} ${p.id}: now v${v}`);
  }
} finally {
  await closeChangeset(server, cs);
  fs.writeFileSync(file, `${JSON.stringify(batch, null, 1)}\n`);
}
const line = `- ${new Date().toISOString().slice(0, 10)} [changeset ${cs}](https://www.openstreetmap.org/changeset/${cs}): ${comment} (${path.relative(REPO, file)})\n`;
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '# OSM edits made with scripts/osm\n\nEvery changeset uploaded by scripts/osm/apply.mjs, newest last.\n\n');
fs.appendFileSync(LOG, line);
console.log(`\nuploaded: https://www.openstreetmap.org/changeset/${cs}`);
