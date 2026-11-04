// /api/hotspots: where people export MapNG levels (opt in; see
// services/exportHotspots.js). One Durable Object holds the counts in its
// SQLite storage: per 0.05° cell the exports from the web app and from the
// desktop app, and the day the cell was last seen. Nothing about who sent
// them is stored; the short per-address limit below lives in memory only.
import { HOTSPOT_PLATFORMS, isHotspotCell } from './services/exportHotspots.js';

const LIMIT_PER_HOUR = 30;   // reports one address may make in an hour

// (asked over fetch, not RPC: no 'cloudflare:workers' import, so worker.js
// still loads in Node for tests/osmWorkerCache.test.mjs)
export class ExportHotspots {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cells (
      y INTEGER NOT NULL, x INTEGER NOT NULL,
      web INTEGER NOT NULL DEFAULT 0, desktop INTEGER NOT NULL DEFAULT 0,
      last_day TEXT NOT NULL,
      PRIMARY KEY (y, x))`);
    this.recent = new Map();   // address hash -> { hour, count }
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
    // (platform is one of the two column names, checked above)
    this.sql.exec(
      `INSERT INTO cells (y, x, ${platform}, last_day) VALUES (?, ?, 1, ?)
       ON CONFLICT (y, x) DO UPDATE SET ${platform} = ${platform} + 1, last_day = excluded.last_day`,
      y, x, day,
    );
    return 'ok';
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
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
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
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
