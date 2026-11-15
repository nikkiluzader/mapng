// /api/hotspots: where people export MapNG levels (opt in; see
// services/exportHotspots.js). One Durable Object holds the counts in its
// SQLite storage: per 0.05° cell the exports from the web app and from the
// desktop app, and the day the cell was last seen. Nothing about who sent
// them is stored; the short per-address limit below lives in memory only.
import { HOTSPOT_PLATFORMS, isHotspotCell } from '../services/exportHotspots.js';
import { USAGE_FIELDS, validUsage } from '../services/usageStats.js';
import { DAILY, overBudget, overRate } from './limits.js';

const LIMIT_PER_HOUR = 30;   // reports one address may make in an hour
// New squares in a day, from everyone together. Far above real use (a few hundred squares in
// the first fortnight); it stops a script, sending from many addresses, from drawing on the
// public map or growing the table until it can no longer be read.
export const NEW_CELLS_PER_DAY = 1500;
const MAX_REPORT_BYTES = 4096;   // a report is a few dozen bytes, a settings report a few hundred

// (asked over fetch, not RPC: no 'cloudflare:workers' import, so index.js
// still loads in Node for tests/osmWorkerCache.test.mjs)
export class ExportHotspots {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cells (
      y INTEGER NOT NULL, x INTEGER NOT NULL,
      web INTEGER NOT NULL DEFAULT 0, desktop INTEGER NOT NULL DEFAULT 0,
      last_day TEXT NOT NULL,
      PRIMARY KEY (y, x))`);
    // which settings people export with (opt in, separate: services/usageStats.js):
    // one running total per setting and value, nothing per export
    this.sql.exec(`CREATE TABLE IF NOT EXISTS usage (
      name TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (name, value))`);
    // a day's totals for the limits in worker/limits.js (kept two days)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS budgets (
      day TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, name))`);
    this.recent = new Map();   // address hash -> { hour, count }
    this.recentUsage = new Map();
  }

  /** Add one export's settings to the totals. */
  async reportUsage(settings, sender) {
    const valid = validUsage(settings);
    if (!valid.platform || Object.keys(valid).length < 3) return 'invalid';
    const hour = Math.floor(Date.now() / 3600000);
    const seen = this.recentUsage.get(sender);
    if (seen && seen.hour === hour && seen.count >= LIMIT_PER_HOUR) return 'limited';
    this.recentUsage.set(sender, { hour, count: seen?.hour === hour ? seen.count + 1 : 1 });
    if (this.recentUsage.size > 10000) {
      for (const [key, value] of this.recentUsage) if (value.hour !== hour) this.recentUsage.delete(key);
    }
    for (const [name, value] of Object.entries(valid)) {
      this.sql.exec(
        'INSERT INTO usage (name, value, count) VALUES (?, ?, 1) ON CONFLICT (name, value) DO UPDATE SET count = count + 1',
        name, value,
      );
    }
    return 'ok';
  }

  /** Everything stored for settings: every row [name, value, count] (served as is at GET /api/usage). */
  async usage() {
    const rows = this.sql.exec('SELECT name, value, count FROM usage ORDER BY name, count DESC').toArray();
    const exports = rows.filter((r) => r.name === 'platform').reduce((n, r) => n + r.count, 0);
    return {
      about: 'Every row MapNG stores for settings usage: [setting, value, number of shared exports that used it]. No locations, no level names, nothing per export. Explained at https://mapng.com/data.html#usage',
      columns: ['setting', 'value', 'count'],
      rows: rows.map((r) => [r.name, r.value, r.count]),
      exports,
      settings: Object.keys(USAGE_FIELDS),
      at: new Date().toISOString(),
    };
  }

  /** Count one export in cell { y, x }; false when the sender is over its limit. */
  async report(y, x, platform, sender) {
    if (!isHotspotCell(y, x) || !HOTSPOT_PLATFORMS.includes(platform)) return 'invalid';
    const hour = Math.floor(Date.now() / 3600000);
    const seen = this.recent.get(sender);
    if (seen && seen.hour === hour && seen.count >= LIMIT_PER_HOUR) return 'limited';
    this.recent.set(sender, { hour, count: seen?.hour === hour ? seen.count + 1 : 1 });
    if (this.recent.size > 10000) {
      for (const [key, value] of this.recent) if (value.hour !== hour) this.recent.delete(key);
    }
    const day = new Date().toISOString().slice(0, 10);
    const known = this.sql.exec('SELECT 1 FROM cells WHERE y = ? AND x = ?', y, x).toArray().length > 0;
    if (!known) {
      const today = this.sql.exec('SELECT COUNT(*) AS n FROM cells WHERE last_day = ? AND web + desktop = 1', day).toArray()[0]?.n || 0;
      if (today >= NEW_CELLS_PER_DAY) return 'limited';
    }
    // (platform is one of the two column names, checked above)
    this.sql.exec(
      `INSERT INTO cells (y, x, ${platform}, last_day) VALUES (?, ?, 1, ?)
       ON CONFLICT (y, x) DO UPDATE SET ${platform} = ${platform} + 1, last_day = excluded.last_day`,
      y, x, day,
    );
    return 'ok';
  }

  /** Take `n` from today's total for `name` unless it is used up: true when taken. */
  takeBudget(name, max, n = 1) {
    if (typeof name !== 'string' || !/^[A-Za-z]{1,40}$/.test(name) || !(max > 0) || !(n > 0)) return false;
    const day = new Date().toISOString().slice(0, 10);
    const used = this.sql.exec('SELECT count FROM budgets WHERE day = ? AND name = ?', day, name).toArray()[0]?.count || 0;
    if (used >= max) return false;
    this.sql.exec('INSERT INTO budgets (day, name, count) VALUES (?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET count = count + ?', day, name, n, n);
    if (!used) this.sql.exec('DELETE FROM budgets WHERE day < ?', new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
    return true;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/budget') {
      const { name, max, n } = await request.json();
      return Response.json({ ok: this.takeBudget(name, Number(max), Number(n) || 1) });
    }
    if (pathname === '/usage-report') {
      const { settings, sender } = await request.json();
      return Response.json({ result: await this.reportUsage(settings, sender) });
    }
    if (pathname === '/usage') return Response.json(await this.usage());
    if (pathname === '/report') {
      const { y, x, platform, sender } = await request.json();
      return Response.json({ result: await this.report(y, x, platform, sender) });
    }
    return Response.json(await this.cells());
  }

  /**
   * Everything stored: every row as [y, x, web, desktop, last_day], and the
   * totals. (Served as is at GET /api/hotspots, so anyone can see all of it:
   * public/data.html.)
   */
  async cells() {
    const rows = this.sql.exec('SELECT y, x, web, desktop, last_day FROM cells ORDER BY y, x').toArray();
    let web = 0; let desktop = 0;
    const cells = rows.map((r) => { web += r.web; desktop += r.desktop; return [r.y, r.x, r.web, r.desktop, r.last_day]; });
    return {
      about: 'Every row MapNG stores for export hotspots: [grid row y, grid column x, web exports, desktop exports, last day]. Cell size 0.05 degrees; cell centre lat = -90 + (y + 0.5) * 0.05, lon = -180 + (x + 0.5) * 0.05. Explained at https://mapng.com/data.html',
      columns: ['y', 'x', 'web', 'desktop', 'last_day'],
      cells, totals: { web, desktop }, at: new Date().toISOString(),
    };
  }
}

const HOTSPOTS_CACHE_S = 600;

/** A small JSON body, or null: read in pieces and given up on past MAX_REPORT_BYTES, whatever the sender says its length is. */
async function smallJson(request) {
  try {
    if (Number(request.headers.get('Content-Length') || 0) > MAX_REPORT_BYTES) return null;
    const reader = request.body?.getReader();
    if (!reader) return null;
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPORT_BYTES) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const all = new Uint8Array(size); let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(all));
    return body && typeof body === 'object' ? body : null;
  } catch { return null; }
}

async function senderHash(request) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mapng-hotspots:${address}`));
  return [...new Uint8Array(bytes).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** GET: the cells (edge-cached for a few minutes); POST { y, x, platform }: count one export. */
export async function handleHotspots(request, env, ctx, json) {
  if (!env.HOTSPOTS) return json({ error: 'Hotspots are not set up here' }, 503);
  const stub = env.HOTSPOTS.get(env.HOTSPOTS.idFromName('global'));
  const cache = caches.default;
  const key = new Request(new URL('/api/hotspots', request.url).toString(), { method: 'GET' });
  if (request.method === 'POST') {
    if (await overRate(env, 'RL_WRITE', request, 'hotspots')) return json({ error: 'Too many reports' }, 429);
    const body = await smallJson(request);
    if (!body) return json({ error: 'Bad request' }, 400);
    const { result } = await (await stub.fetch('https://hotspots/report', {
      method: 'POST',
      body: JSON.stringify({ y: body?.y, x: body?.x, platform: body?.platform, sender: await senderHash(request) }),
    })).json();
    if (result === 'invalid') return json({ error: 'Bad request' }, 400);
    if (result === 'limited') return json({ error: 'Too many reports' }, 429);
    // (so the sender sees their own export on the map: this data centre's copy goes)
    ctx.waitUntil(cache.delete(key));
    return json({ ok: true }, 200);
  }
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const hit = await cache.match(key);
  if (hit) return hit;
  const data = await (await stub.fetch('https://hotspots/cells')).json();
  const response = json(data, 200, { 'Cache-Control': `public, max-age=${HOTSPOTS_CACHE_S}` });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

const USAGE_CACHE_S = 600;

/** GET: the settings totals (edge-cached); POST { settings }: add one export's settings. */
export async function handleUsage(request, env, ctx, json) {
  if (!env.HOTSPOTS) return json({ error: 'Usage stats are not set up here' }, 503);
  const stub = env.HOTSPOTS.get(env.HOTSPOTS.idFromName('global'));
  const cache = caches.default;
  const key = new Request(new URL('/api/usage', request.url).toString(), { method: 'GET' });
  if (request.method === 'POST') {
    if (await overRate(env, 'RL_WRITE', request, 'usage')) return json({ error: 'Too many reports' }, 429);
    const body = await smallJson(request);
    if (!body) return json({ error: 'Bad request' }, 400);
    if (await overBudget(env, 'usage', DAILY.usage)) return json({ error: 'Too many reports' }, 429);
    const { result } = await (await stub.fetch('https://hotspots/usage-report', {
      method: 'POST',
      body: JSON.stringify({ settings: body?.settings, sender: await senderHash(request) }),
    })).json();
    if (result === 'invalid') return json({ error: 'Bad request' }, 400);
    if (result === 'limited') return json({ error: 'Too many reports' }, 429);
    ctx.waitUntil(cache.delete(key));
    return json({ ok: true }, 200);
  }
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const hit = await cache.match(key);
  if (hit) return hit;
  const data = await (await stub.fetch('https://hotspots/usage')).json();
  const response = json(data, 200, { 'Cache-Control': `public, max-age=${USAGE_CACHE_S}` });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}
