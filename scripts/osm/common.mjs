// Shared pieces of the OSM maintenance scripts (scripts/osm/README.md): the keys in
// ~/.config/mapng/mapng.env (never printed), the live or test server, element reads and writes,
// changesets. Maintainer tooling only: nothing here ships in the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENV_FILE = path.join(os.homedir(), '.config/mapng/mapng.env');
export const UA = 'MapNG-maintenance/1.0 (scripts/osm; tag fixes found in MapNG level reviews)';

export const SERVERS = {
  live: { web: 'https://www.openstreetmap.org', api: 'https://api.openstreetmap.org/api/0.6', id: 'OSM_CLIENT_ID', secret: 'OSM_CLIENT_SECRET', token: 'OSM_ACCESS_TOKEN' },
  dev: { web: 'https://master.apis.dev.openstreetmap.org', api: 'https://master.apis.dev.openstreetmap.org/api/0.6', id: 'OSM_DEV_CLIENT_ID', secret: 'OSM_DEV_CLIENT_SECRET', token: 'OSM_DEV_ACCESS_TOKEN' },
};
export const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
export const SCOPES = 'read_prefs write_api';

export const serverOf = (argv) => SERVERS[argv.includes('--dev') ? 'dev' : 'live'];

export function readEnv(name) {
  const t = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const m = t.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*"?([^"\\n]*?)"?\\s*$`, 'm'));
  return m ? m[1] : null;
}
/** Set (or add) NAME=value in the env file, keeping it private (0600). */
export function writeEnv(name, value) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  let t = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm');
  t = re.test(t) ? t.replace(re, line) : `${t.replace(/\n?$/, '\n')}${line}\n`;
  fs.writeFileSync(ENV_FILE, t, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}

export function token(server) {
  const t = readEnv(server.token);
  if (!t) throw new Error(`no ${server.token} in ${ENV_FILE}: run node scripts/osm/login.mjs${server === SERVERS.dev ? ' --dev' : ''} first`);
  return t;
}

export async function api(server, method, p, { body, auth = true, json = true } = {}) {
  const headers = { 'User-Agent': UA };
  if (auth) headers.Authorization = `Bearer ${token(server)}`;
  if (body != null) headers['Content-Type'] = 'text/xml; charset=utf-8';
  const r = await fetch(`${server.api}${p}`, { method, headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return json && text && /^[[{]/.test(text.trim()) ? JSON.parse(text) : text;
}

/** The element as the server has it now: { type, id, version, tags, nodes?, members?, lat?, lon? }. */
export async function getElement(server, type, id) {
  const d = await api(server, 'GET', `/${type}/${id}.json`, { auth: false });
  const e = d.elements?.[0];
  if (!e) throw new Error(`${type} ${id}: not found`);
  return e;
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tagsXml = (tags) => Object.entries(tags).map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`).join('');

/** The element's XML for an update in changeset cs (all its nodes / members kept as they are). */
export function elementXml(e, cs) {
  const head = `id="${e.id}" version="${e.version}" changeset="${cs}"`;
  if (e.type === 'node') return `<osm><node ${head} lat="${e.lat}" lon="${e.lon}">${tagsXml(e.tags || {})}</node></osm>`;
  if (e.type === 'way') return `<osm><way ${head}>${e.nodes.map((n) => `<nd ref="${n}"/>`).join('')}${tagsXml(e.tags || {})}</way></osm>`;
  if (e.type === 'relation') return `<osm><relation ${head}>${e.members.map((m) => `<member type="${m.type}" ref="${m.ref}" role="${esc(m.role || '')}"/>`).join('')}${tagsXml(e.tags || {})}</relation></osm>`;
  throw new Error(`unknown element type ${e.type}`);
}

export async function openChangeset(server, tags) {
  return Number(await api(server, 'PUT', '/changeset/create', { body: `<osm><changeset>${tagsXml(tags)}</changeset></osm>`, json: false }));
}
export async function closeChangeset(server, id) {
  await api(server, 'PUT', `/changeset/${id}/close`, { json: false });
}

/** The tag edits a proposal makes: { set: {k: v}, remove: [k] } applied to tags. */
export function applyChange(tags, change) {
  const out = { ...(tags || {}) };
  for (const [k, v] of Object.entries(change.set || {})) out[k] = String(v);
  for (const k of change.remove || []) delete out[k];
  return out;
}
/** The keys a change touches, and whether the element still holds the values the proposal saw. */
export function stillAsSeen(tags, proposal) {
  const keys = [...Object.keys(proposal.change.set || {}), ...(proposal.change.remove || [])];
  const drift = keys.filter((k) => (tags?.[k] ?? null) !== (proposal.before?.[k] ?? null));
  return { ok: drift.length === 0, drift };
}
