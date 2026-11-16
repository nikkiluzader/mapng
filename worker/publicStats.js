// /api/stats: the numbers behind the public stats page (public/stats.html).
// Counts only, and only from fixed lists: nothing a person typed, no place
// more exact than a country, no address, nothing per person. What each part
// is and where it comes from: public/data.html#stats.
//
//  - visits: Cloudflare's own totals for mapng.com (the same analytics the
//    site already uses), per day and per country; a country is listed only
//    from COUNTRY_FLOOR page loads up.
//  - reports: how many problem reports arrived, by kind, system and cause.
//    The cause is one of a fixed list worked out from the error (causeOf);
//    no text from a report is ever in here. Kept as running totals in one
//    R2 object, added to when a report arrives.
//  - downloads: the desktop app's download counts, as GitHub publishes them.
//
// Export areas and settings are not in here: the page reads them from
// /api/hotspots and /api/usage, which were public already.
import { USAGE_FIELDS } from '../services/usageStats.js';

export const STATS_WINDOW_DAYS = 30;
export const COUNTRY_FLOOR = 25;          // a country with fewer page loads than this is not listed
const STATS_CACHE_S = 3600;
const REPORT_TALLY_KEY = 'crash-reports/_stats.json';
const GITHUB_KEEP_KEY = 'stats/github.json';
const GITHUB_REPO = 'nikkiluzader/mapng';

export const REPORT_KINDS = ['crash', 'generate', 'export', 'rebuild', 'manual', 'level', 'other'];
export const REPORT_SYSTEMS = ['windows', 'linux', 'web', 'other'];
export const REPORT_CAUSES = ['memory', 'closed', 'download', 'disk', 'graphics', 'crash', 'byHand', 'other'];

/** Which of REPORT_CAUSES a report belongs to (from its kind and error; the text itself goes nowhere). */
export function causeOf(report) {
  const kind = String(report?.kind || '');
  const error = String(report?.error || '');
  if (/out of memory|allocation failed|invalid string length|\boom\b|heap limit/i.test(error)) return 'memory';
  if (/still running when the page closed/i.test(error)) return 'closed';
  if (/ENOSPC|no space left/i.test(error)) return 'disk';
  if (/failed to download|failed to fetch|fetch failed|network|timed out|timeout|HTTP \d{3}/i.test(error)) return 'download';
  if (/skia|webgl|gpu|graphics/i.test(error)) return 'graphics';
  if (kind === 'crash') return 'crash';
  if ((kind === 'manual' || kind === 'level') && !error) return 'byHand';
  return 'other';
}

const systemOf = (platform) => ({ win32: 'windows', linux: 'linux', web: 'web' }[String(platform || '')] || 'other');
const versionOf = (v) => (v === 'web' ? 'web' : /^\d{1,3}\.\d{1,3}\.\d{1,3}(-dev\.\d{1,3})?$/.test(String(v || '')) ? String(v) : 'other');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VERSIONS = 60;

export const emptyTally = () => ({ total: 0, byKind: {}, bySystem: {}, byCause: {}, byVersion: {}, byDay: {} });

/** The tally with one report added (a new object). Test reports are not counted. */
export function addToTally(tally, report) {
  const t = { ...emptyTally(), ...(tally && typeof tally === 'object' ? tally : {}) };
  if (!report || report.platform === 'test' || report.appVersion === 'test') return t;
  const bump = (name, key) => { t[name] = { ...t[name], [key]: (Number(t[name]?.[key]) || 0) + 1 }; };
  const kind = REPORT_KINDS.includes(report.kind) ? report.kind : 'other';
  const day = String(report.receivedAt || '').slice(0, 10);
  t.total = (Number(t.total) || 0) + 1;
  bump('byKind', kind);
  bump('bySystem', systemOf(report.platform));
  bump('byCause', causeOf(report));
  // (a version is the sender's word for it: a made-up one is counted as "other" once there are many)
  const version = versionOf(report.appVersion);
  bump('byVersion', version in t.byVersion || Object.keys(t.byVersion).length < MAX_VERSIONS ? version : 'other');
  if (DAY_RE.test(day)) bump('byDay', day);
  return t;
}

/** Only the listed keys with whole numbers: what of a stored tally may be shown. */
export function cleanTally(tally) {
  const t = tally && typeof tally === 'object' ? tally : {};
  const pick = (obj, ok) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
    .filter(([k, v]) => ok(k) && Number.isInteger(v) && v > 0));
  return {
    total: Number.isInteger(t.total) ? t.total : 0,
    byKind: pick(t.byKind, (k) => REPORT_KINDS.includes(k)),
    bySystem: pick(t.bySystem, (k) => REPORT_SYSTEMS.includes(k)),
    byCause: pick(t.byCause, (k) => REPORT_CAUSES.includes(k)),
    byVersion: pick(t.byVersion, (k) => versionOf(k) === k),
    byDay: pick(t.byDay, (k) => DAY_RE.test(k)),
  };
}

async function readTally(env) {
  try {
    const o = await env.OSM_TILES?.get(REPORT_TALLY_KEY);
    return o ? await o.json() : null;
  } catch { return null; }
}

/** Add an arrived report to the public totals (R2: read, add, write; two at once may lose one count). */
export async function countReport(env, summary) {
  if (!env.OSM_TILES) return;
  const next = addToTally(await readTally(env), summary);
  await env.OSM_TILES.put(REPORT_TALLY_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
}

const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const zoneQuery = (vars, body) => `query(${vars}){viewer{zones(filter:{zoneTag:$z}){rows:${body}}}}`;
const VISIT_QUERIES = {
  days: zoneQuery('$z:string,$d0:Date,$d1:Date', 'httpRequests1dGroups(limit:60,filter:{date_geq:$d0,date_leq:$d1},orderBy:[date_ASC]){dimensions{date} sum{requests pageViews bytes cachedBytes threats browserMap{uaBrowserFamily pageViews}} uniq{uniques}}'),
  // loads of the site's front page, by the visitor's country (Cloudflare's estimate from a sample)
  countries: zoneQuery('$z:string,$t0:Time,$t1:Time', 'httpRequestsAdaptiveGroups(limit:250,filter:{datetime_geq:$t0,datetime_leq:$t1,requestSource:"eyeball",clientRequestPath:"/",edgeResponseStatus:200},orderBy:[count_DESC]){count dimensions{clientCountryName}}'),
};
// browser families worth a name of their own; the rest (bots, tools, unknown) are added up as "other"
const BROWSERS = { Chrome: 'Chrome', ChromeMobile: 'Chrome', ChromeMobileWebview: 'Chrome', Edge: 'Edge', Firefox: 'Firefox', FirefoxMobile: 'Firefox', Opera: 'Opera', Safari: 'Safari', MobileSafari: 'Safari', MobileSafariWebview: 'Safari', SamsungInternet: 'Samsung Internet', YandexBrowser: 'Yandex Browser' };

/** Cloudflare's rows made into what the page shows (pure; tests/publicStats.test.mjs). */
export function shapeVisits({ days = [], countries = [] }) {
  const browsers = {};
  const outDays = days.map((r) => {
    for (const b of r.sum?.browserMap || []) {
      const name = BROWSERS[b.uaBrowserFamily] || 'other';
      browsers[name] = (browsers[name] || 0) + (Number(b.pageViews) || 0);
    }
    return { date: String(r.dimensions?.date || ''), pageViews: Number(r.sum?.pageViews) || 0, visitors: Number(r.uniq?.uniques) || 0, requests: Number(r.sum?.requests) || 0, bytes: Number(r.sum?.bytes) || 0, cachedBytes: Number(r.sum?.cachedBytes) || 0, blocked: Number(r.sum?.threats) || 0 };
  }).filter((d) => DAY_RE.test(d.date));
  return {
    days: outDays,
    countries: countries
      .map((r) => [String(r.dimensions?.clientCountryName || ''), Number(r.count) || 0])
      .filter(([code, n]) => /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' && n >= COUNTRY_FLOOR),
    browsers: Object.entries(browsers).sort((a, b) => b[1] - a[1]),
  };
}

async function visits(env, fetchFn, now) {
  const token = env.CF_ANALYTICS_TOKEN; const zone = env.CF_ZONE_ID;
  if (!token || !zone) return null;
  const iso = (t) => new Date(t).toISOString().slice(0, 19) + 'Z';
  const DAY = 86400000;
  const ask = async (query, variables) => {
    try {
      const r = await fetchFn(CF_GRAPHQL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      const d = await r.json();
      return d.errors?.length ? [] : d.data?.viewer?.zones?.[0]?.rows || [];
    } catch { return []; }
  };
  // (a little inside the 30 days Cloudflare keeps: exactly 30 days back is refused by the time it is asked)
  const t0 = iso(now - STATS_WINDOW_DAYS * DAY + 10 * 60000);
  const [days, countries] = await Promise.all([
    ask(VISIT_QUERIES.days, { z: zone, d0: iso(now - (STATS_WINDOW_DAYS - 1) * DAY).slice(0, 10), d1: iso(now).slice(0, 10) }),
    ask(VISIT_QUERIES.countries, { z: zone, t0, t1: iso(now) }),
  ]);
  if (!days.length) return null;
  return shapeVisits({ days, countries });
}

/** GitHub's public figures made into what the page shows (pure). */
export function shapeDownloads(repo, releases) {
  const kindOf = (name) => (/\.AppImage$/i.test(name) ? 'linux' : /portable\.zip$/i.test(name) ? 'windowsPortable' : /Setup.*\.exe$/i.test(name) ? 'windowsInstaller' : null);
  const out = [];
  for (const r of Array.isArray(releases) ? releases : []) {
    if (r.draft) continue;
    const assets = { windowsInstaller: 0, windowsPortable: 0, linux: 0 };
    for (const a of r.assets || []) { const k = kindOf(String(a.name || '')); if (k) assets[k] += Number(a.download_count) || 0; }
    out.push({ tag: String(r.tag_name || '').slice(0, 40), day: String(r.published_at || '').slice(0, 10), test: !!r.prerelease, ...assets });
  }
  const total = out.reduce((n, r) => n + r.windowsInstaller + r.windowsPortable + r.linux, 0);
  return { stars: Number(repo?.stargazers_count) || 0, forks: Number(repo?.forks_count) || 0, releases: out, total };
}

// (download counts move slowly: GitHub is asked at most every GITHUB_FRESH_MS, the kept answer served between.
// Asked on every refresh of the stats, about one request in two was refused: unsigned requests are limited by
// address and a worker shares its addresses with others)
export const GITHUB_FRESH_MS = 6 * 3600 * 1000;
async function downloads(env, fetchFn, now = Date.now()) {
  let kept = null;
  try { const o = await env.OSM_TILES?.get(GITHUB_KEEP_KEY); kept = o ? await o.json() : null; } catch { kept = null; }
  if (kept?.at && now - Date.parse(kept.at) < GITHUB_FRESH_MS) return kept;
  const get = async (path) => {
    const r = await fetchFn(`https://api.github.com/repos/${GITHUB_REPO}${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mapng-stats' } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return r.json();
  };
  try {
    const [repo, releases] = await Promise.all([get(''), get('/releases?per_page=100')]);
    const shaped = shapeDownloads(repo, releases);
    // (GitHub limits unsigned requests by address, and a worker shares its addresses: the last good answer is kept)
    await env.OSM_TILES?.put(GITHUB_KEEP_KEY, JSON.stringify({ ...shaped, at: new Date(now).toISOString() }), { httpMetadata: { contentType: 'application/json' } });
    return shaped;
  } catch {
    return kept;
  }
}

/** Everything /api/stats answers with. */
export async function publicStats(env, fetchFn = fetch, now = Date.now()) {
  const [v, tally, d] = await Promise.all([visits(env, fetchFn, now), readTally(env), downloads(env, fetchFn, now)]);
  return {
    about: 'The numbers on https://mapng.com/stats.html: counts only, from fixed lists. No names, no addresses, no text anyone typed, no place more exact than a country. Export areas are at /api/hotspots and settings at /api/usage. Explained at https://mapng.com/data.html#stats',
    at: new Date(now).toISOString(),
    windowDays: STATS_WINDOW_DAYS,
    countryFloor: COUNTRY_FLOOR,
    visits: v,
    reports: cleanTally(tally),
    downloads: d,
    settingValues: USAGE_FIELDS,
  };
}

/** GET /api/stats (kept at the edge for an hour). */
export async function handlePublicStats(request, env, ctx, json) {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const cache = caches.default;
  const key = new Request(new URL('/api/stats', request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = json(await publicStats(env), 200, { 'Cache-Control': `public, max-age=${STATS_CACHE_S}` });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}
