// /api/admin/*: the developer's own dashboard (public/admin.html).
//
// Who gets in is decided by Cloudflare Access, in front of mapng.com/admin*
// and mapng.com/api/admin*: it signs every request it lets through with a
// token in the Cf-Access-Jwt-Assertion header. This code checks that token
// itself on every request (signature against the team's public keys, the
// application it was issued for, its expiry, and that the signed-in address
// is the developer's), so the data stays closed even if the Access rule is
// removed or misdrawn: without a valid token there is nothing here.
//
// Set up: ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.json's vars (neither
// is a secret), and the developer's address in the CRASH_MAIL_TO secret (the
// same one the alert emails go to). With any of them missing the dashboard
// answers "not set up".
//
// It reads what the reports already store (crash-reports/ in the private R2
// bucket; what a report holds: public/data.html) and writes one small file of
// its own per report, admin.json: handled or not, and a note.
import { listReports, reportFile, readCounts, REPORT_DIR_RE, MAIL_PER_DAY, MAIL_PER_HOUR, REPORTS_PER_DAY } from './crashReports.js';

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map();          // team domain -> { at, keys }
const CLOCK_SKEW_S = 60;
const MAX_NOTE_CHARS = 2000;

const b64urlBytes = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function teamKeys(teamDomain, fetchFn) {
  const hit = jwksCache.get(teamDomain);
  if (hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const r = await fetchFn(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access keys: ${r.status}`);
  const keys = (await r.json()).keys || [];
  jwksCache.set(teamDomain, { at: Date.now(), keys });
  return keys;
}

/**
 * Check a Cloudflare Access token. Returns its payload, or null for any
 * token that is not a currently valid RS256 token from `teamDomain` for the
 * application `aud`. `keys` are the team's JWKs.
 */
export async function verifyAccessToken(token, { teamDomain, aud, keys, now = Date.now() }) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return null;
    const jwk = (keys || []).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud || !auds.includes(aud)) return null;
    if (payload.iss !== `https://${teamDomain}`) return null;
    const t = now / 1000;
    if (!(Number(payload.exp) > t - CLOCK_SKEW_S)) return null;
    if (Number.isFinite(Number(payload.nbf)) && Number(payload.nbf) > t + CLOCK_SKEW_S) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The signed-in developer's address, or null: { email } | null, and why not in `reason`. */
export async function adminIdentity(request, env, fetchFn = fetch) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN; const aud = env.ACCESS_AUD; const owner = String(env.CRASH_MAIL_TO || '').trim().toLowerCase();
  if (!teamDomain || !aud || !owner) return { email: null, reason: 'not-set-up' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { email: null, reason: 'no-token' };
  let keys;
  try { keys = await teamKeys(teamDomain, fetchFn); } catch { return { email: null, reason: 'keys' }; }
  let payload = await verifyAccessToken(token, { teamDomain, aud, keys });
  if (!payload) {
    // (the team rotates its keys: once more with fresh ones)
    jwksCache.delete(teamDomain);
    try { keys = await teamKeys(teamDomain, fetchFn); } catch { return { email: null, reason: 'keys' }; }
    payload = await verifyAccessToken(token, { teamDomain, aud, keys });
  }
  if (!payload) return { email: null, reason: 'bad-token' };
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || email !== owner) return { email: null, reason: 'not-owner' };
  return { email, reason: '' };
}

// ── Cloudflare's own numbers for the domain ────────────────────────────────
// Traffic and security events from Cloudflare's GraphQL Analytics API, asked
// with a token that can only read analytics for this zone (the CF_ANALYTICS_TOKEN
// secret; CF_ZONE_ID in vars). Each section is its own query, so one the
// plan or the schema does not answer leaves the others standing, and says why.
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const zoneQuery = (vars, body) => `query(${vars}){viewer{zones(filter:{zoneTag:$z}){rows:${body}}}}`;
export const CF_SECTIONS = {
  // per day, 14 days
  traffic: { span: 'days', query: zoneQuery('$z:string,$d0:Date,$d1:Date', 'httpRequests1dGroups(limit:20,filter:{date_geq:$d0,date_leq:$d1},orderBy:[date_ASC]){dimensions{date} sum{requests cachedRequests bytes cachedBytes threats pageViews} uniq{uniques}}') },
  // last 24 hours
  securityByAction: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'firewallEventsAdaptiveGroups(limit:25,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{action source}}') },
  securityByPath: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'firewallEventsAdaptiveGroups(limit:15,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{clientRequestPath action}}') },
  securityByCountry: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'firewallEventsAdaptiveGroups(limit:12,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{clientCountryName}}') },
  securityByAgent: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'firewallEventsAdaptiveGroups(limit:12,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{userAgent action}}') },
  statusCodes: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:20,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{edgeResponseStatus}}') },
  // which desktop app versions are calling in: the app names itself "MapNG-Desktop/<version>" on its
  // requests, which Cloudflare already counts with the rest of the traffic (requests, not people)
  appVersions: { span: 'week', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:30,filter:{datetime_geq:$t0,datetime_leq:$t1,userAgent_like:"MapNG-Desktop%"},orderBy:[count_DESC]){count dimensions{userAgent}}') },
  // what the less happy answers were for: not found, too many requests, and the site's own errors
  notFoundPaths: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:15,filter:{datetime_geq:$t0,datetime_leq:$t1,edgeResponseStatus:404},orderBy:[count_DESC]){count dimensions{clientRequestPath}}') },
  limitedPaths: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:15,filter:{datetime_geq:$t0,datetime_leq:$t1,edgeResponseStatus:429},orderBy:[count_DESC]){count dimensions{clientRequestPath}}') },
  serverErrorPaths: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:15,filter:{datetime_geq:$t0,datetime_leq:$t1,edgeResponseStatus_in:[500,502,503]},orderBy:[count_DESC]){count dimensions{clientRequestPath edgeResponseStatus}}') },
  topPaths: { span: 'hours', query: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:15,filter:{datetime_geq:$t0,datetime_leq:$t1},orderBy:[count_DESC]){count dimensions{clientRequestPath}}') },
};

/**
 * The site's own security rules as they stand: { rows: [{ name, action, enabled }] } | { error }.
 * Names and switches only: a rule's expression can hold a private value (the
 * header that lets the developer's own scripts past the bot check) and never
 * leaves Cloudflare here.
 */
async function securityRules(token, zone, fetchFn) {
  try {
    const r = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${zone}/rulesets/phases/http_request_firewall_custom/entrypoint`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!d.success) return { error: String(d.errors?.[0]?.message || 'not readable').slice(0, 200) };
    return { rows: (d.result?.rules || []).map((x) => ({ name: String(x.description || x.id || '').slice(0, 120), action: String(x.action || ''), enabled: x.enabled !== false })) };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 200) };
  }
}

/** { at, sections: { name: { rows } | { error } }, rules }, or { error } when it is not set up. */
export async function cloudflareStats(env, fetchFn = fetch, now = Date.now()) {
  const token = env.CF_ANALYTICS_TOKEN; const zone = env.CF_ZONE_ID;
  if (!token || !zone) return { error: 'not-set-up' };
  const iso = (t) => new Date(t).toISOString().slice(0, 19) + 'Z';
  const vars = {
    days: { z: zone, d0: iso(now - 13 * 86400000).slice(0, 10), d1: iso(now).slice(0, 10) },
    hours: { z: zone, t0: iso(now - 24 * 3600000), t1: iso(now) },
    week: { z: zone, t0: iso(now - 7 * 86400000), t1: iso(now) },
  };
  const names = Object.keys(CF_SECTIONS);
  const results = await Promise.all(names.map(async (name) => {
    const { span, query } = CF_SECTIONS[name];
    try {
      const r = await fetchFn(CF_GRAPHQL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: vars[span] }) });
      const d = await r.json();
      if (d.errors?.length) return { error: String(d.errors[0]?.message || 'query failed').slice(0, 300) };
      return { rows: d.data?.viewer?.zones?.[0]?.rows || [] };
    } catch (e) {
      return { error: String(e?.message || e).slice(0, 300) };
    }
  }));
  return { at: iso(now), sections: Object.fromEntries(names.map((n, i) => [n, results[i]])), rules: await securityRules(token, zone, fetchFn) };
}

const stateKey = (dir) => `${dir}admin.json`;
async function readState(env, dir) {
  try {
    const o = await env.OSM_TILES.get(stateKey(dir));
    const s = o ? await o.json() : null;
    if (s && typeof s === 'object') return { handled: !!s.handled, note: String(s.note || '').slice(0, MAX_NOTE_CHARS), at: String(s.at || '') };
  } catch { /* unreadable: as if none */ }
  return { handled: false, note: '', at: '' };
}

/** A sanitised { handled, note } from a request body, or null when it is not one. */
export function cleanState(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.handled !== 'boolean' && typeof body.note !== 'string') return null;
  return { handled: !!body.handled, note: String(body.note ?? '').slice(0, MAX_NOTE_CHARS) };
}

/** GET me | overview | cloudflare | reports | reports/file?key=, POST reports/state { key, handled, note }. */
export async function handleAdmin(request, env, ctx, url, json) {
  // (never readable from another site, never cached; a change only from the dashboard's own page:
  // another site's page could otherwise post with the developer's sign-in cookie)
  const noStore = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': url.origin, Vary: 'Origin' };
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403, noStore);
  const who = await adminIdentity(request, env);
  if (!who.email) {
    if (who.reason === 'not-set-up') return json({ error: 'The dashboard is not set up here' }, 503, noStore);
    return json({ error: 'Not signed in' }, 401, noStore);
  }
  if (!env.OSM_TILES) return json({ error: 'Storage is not set up here' }, 503, noStore);
  const sub = url.pathname.slice('/api/admin'.length);

  if (sub === '/me' && request.method === 'GET') return json({ email: who.email }, 200, noStore);

  if (sub === '/overview' && request.method === 'GET') {
    const now = new Date();
    const days = [];
    for (let i = 0; i < 14; i++) {
      const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      days.push(readCounts(env, day).then((c) => ({ day, reports: c.reports, mails: c.mails, hours: c.hours })));
    }
    const counts = await Promise.all(days);
    const hour = now.toISOString().slice(11, 13);
    return json({
      now: now.toISOString(),
      caps: { mailPerHour: MAIL_PER_HOUR, mailPerDay: MAIL_PER_DAY, reportsPerDay: REPORTS_PER_DAY },
      today: { ...counts[0], mailsThisHour: Number(counts[0].hours?.[hour]) || 0 },
      days: counts.map(({ day, reports, mails }) => ({ day, reports, mails })),
      mailOn: !!(env.CRASH_MAIL && env.CRASH_MAIL_FROM),
    }, 200, noStore);
  }

  if (sub === '/cloudflare' && request.method === 'GET') {
    const stats = await cloudflareStats(env);
    return json(stats, stats.error === 'not-set-up' ? 503 : 200, noStore);
  }

  if (sub === '/reports' && request.method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const list = await listReports(env, limit);
    const states = await Promise.all(list.reports.map((r) => readState(env, r.key)));
    return json({ total: list.total, reports: list.reports.map((r, i) => ({ ...r, admin: states[i] })) }, 200, noStore);
  }

  if (sub === '/reports/file' && request.method === 'GET') {
    return (await reportFile(env, url.searchParams.get('key') || '')) || json({ error: 'Not found' }, 404, noStore);
  }

  if (sub === '/reports/state' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400, noStore); }
    const dir = String(body?.key || '');
    const state = cleanState(body);
    if (!REPORT_DIR_RE.test(dir) || !state) return json({ error: 'Bad request' }, 400, noStore);
    // (only for a report that exists)
    if (!(await env.OSM_TILES.head(`${dir}report.json`))) return json({ error: 'Not found' }, 404, noStore);
    const saved = { ...state, at: new Date().toISOString() };
    await env.OSM_TILES.put(stateKey(dir), JSON.stringify(saved), { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true, admin: saved }, 200, noStore);
  }

  return json({ error: 'Not found' }, 404, noStore);
}
