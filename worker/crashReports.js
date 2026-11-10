// Crash and problem reports from the desktop app, sent only when the user
// says so (desktop/crashReports.js; what is in a report: public/data.html).
// Stored privately in the R2 bucket under crash-reports/ (the bucket has no
// public access and the tile route serves only osm/*.pmtiles); an email to
// the developer when the CRASH_MAIL send_email binding is configured; read
// back only with the CRASH_ADMIN_TOKEN secret (public/crash-reports.html).

const PREFIX = 'crash-reports/';
const MAX_BODY_BYTES = 12 * 1024 * 1024;      // a report with its log and crash dump
const MAX_LOG_CHARS = 2 * 1024 * 1024;
const LIMIT_PER_HOUR = 10;                    // per address, in this isolate's memory only
const recent = new Map();                     // address hash -> { hour, count }
const ID_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

const reportId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `MR-${[...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('')}`;
};

async function senderHash(request) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mapng-crash:${address}`));
  return [...new Uint8Array(bytes).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const clip = (v, n) => String(v ?? '').slice(0, n);

/** The report's fields kept as data (log and crash dump are stored as their own files). */
export function reportSummary(body, id, receivedAt) {
  return {
    id,
    receivedAt,
    kind: clip(body.kind, 40),                 // crash | export | generate | rebuild | manual
    appVersion: clip(body.appVersion, 40),
    build: clip(body.build, 80),
    platform: clip(body.platform, 40),
    os: clip(body.os, 120),
    error: clip(body.error, 4000),
    description: clip(body.description, 4000),
    options: body.options && typeof body.options === 'object' ? body.options : null,
    area: body.area && typeof body.area === 'object' ? body.area : null,
    config: typeof body.config === 'string' && body.config.startsWith('mapng:') ? clip(body.config, 8000) : '',
    memory: body.memory && typeof body.memory === 'object' ? body.memory : null,
    hasLog: typeof body.log === 'string' && body.log.length > 0,
    hasDump: typeof body.minidump === 'string' && body.minidump.length > 0,
  };
}

async function notify(env, summary, viewerUrl) {
  if (!env.CRASH_MAIL || !env.CRASH_MAIL_TO || !env.CRASH_MAIL_FROM) return;
  const lines = [
    `MapNG ${summary.kind} report ${summary.id}`,
    `App: ${summary.appVersion} (${summary.build}) on ${summary.os || summary.platform}`,
    summary.error ? `Error: ${summary.error.slice(0, 600)}` : '',
    summary.description ? `User wrote: ${summary.description.slice(0, 600)}` : '',
    `Log: ${summary.hasLog ? 'yes' : 'no'}  Crash dump: ${summary.hasDump ? 'yes' : 'no'}`,
    `View: ${viewerUrl}`,
  ].filter(Boolean);
  try {
    await env.CRASH_MAIL.send({
      to: env.CRASH_MAIL_TO,
      from: { email: env.CRASH_MAIL_FROM, name: 'MapNG reports' },
      subject: `MapNG ${summary.kind} report ${summary.id} (${summary.appVersion})`,
      text: lines.join('\n'),
    });
  } catch (error) {
    console.error('crash report email failed', error?.code, error?.message);
  }
}

const authorized = (request, env) => {
  const token = env.CRASH_ADMIN_TOKEN;
  if (!token) return false;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
};

/** POST /api/crash (a report), GET /api/crash/list and /api/crash/file (the developer, with the token). */
export async function handleCrashReports(request, env, ctx, url, json) {
  if (!env.OSM_TILES) return json({ error: 'Reports are not set up here' }, 503);
  const sub = url.pathname.slice('/api/crash'.length);

  if (sub === '' || sub === '/') {
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BODY_BYTES) return json({ error: 'Report too large' }, 413);
    const hour = Math.floor(Date.now() / 3600000);
    const sender = await senderHash(request);
    const seen = recent.get(sender);
    if (seen && seen.hour === hour && seen.count >= LIMIT_PER_HOUR) return json({ error: 'Too many reports' }, 429);
    recent.set(sender, { hour, count: seen?.hour === hour ? seen.count + 1 : 1 });
    if (recent.size > 5000) for (const [k, v] of recent) if (v.hour !== hour) recent.delete(k);
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'Report too large' }, 413);
      body = JSON.parse(text);
    } catch { return json({ error: 'Bad request' }, 400); }
    if (!body || typeof body !== 'object' || !body.kind) return json({ error: 'Bad request' }, 400);

    const id = reportId();
    const receivedAt = new Date().toISOString();
    // (day / time-id: listing newest first is a key sort)
    const dir = `${PREFIX}${receivedAt.slice(0, 10)}/${receivedAt.slice(11, 19).replace(/:/g, '')}-${id}/`;
    const summary = reportSummary(body, id, receivedAt);
    const writes = [env.OSM_TILES.put(`${dir}report.json`, JSON.stringify(summary, null, 1), { httpMetadata: { contentType: 'application/json' } })];
    if (summary.hasLog) writes.push(env.OSM_TILES.put(`${dir}log.txt`, body.log.slice(-MAX_LOG_CHARS), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } }));
    if (summary.hasDump) {
      try {
        const bin = Uint8Array.from(atob(body.minidump), (c) => c.charCodeAt(0));
        writes.push(env.OSM_TILES.put(`${dir}crash.dmp`, bin, { httpMetadata: { contentType: 'application/octet-stream' } }));
      } catch { summary.hasDump = false; }
    }
    await Promise.all(writes);
    ctx.waitUntil(notify(env, summary, new URL(`/crash-reports.html#${id}`, url.origin).toString()));
    return json({ ok: true, id }, 200);
  }

  if (!authorized(request, env)) return json({ error: env.CRASH_ADMIN_TOKEN ? 'Unauthorized' : 'Report viewing is not set up' }, env.CRASH_ADMIN_TOKEN ? 401 : 503);

  if (sub === '/list' && request.method === 'GET') {
    // newest days first; up to `limit` reports with their summaries
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const keys = [];
    let cursor;
    do {
      const page = await env.OSM_TILES.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const o of page.objects) if (o.key.endsWith('/report.json')) keys.push(o.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && keys.length < 5000);
    keys.sort().reverse();
    const reports = await Promise.all(keys.slice(0, limit).map(async (k) => {
      const o = await env.OSM_TILES.get(k);
      return o ? { key: k.slice(0, -'report.json'.length), ...(await o.json()) } : null;
    }));
    return json({ total: keys.length, reports: reports.filter(Boolean) }, 200, { 'Cache-Control': 'no-store' });
  }

  if (sub === '/file' && request.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!new RegExp(`^${PREFIX}\\d{4}-\\d{2}-\\d{2}/\\d{6}-MR-[A-Z0-9]{6}/(report\\.json|log\\.txt|crash\\.dmp)$`).test(key)) return json({ error: 'Not found' }, 404);
    const o = await env.OSM_TILES.get(key);
    if (!o) return json({ error: 'Not found' }, 404);
    return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'no-store' } });
  }

  return json({ error: 'Not found' }, 404);
}
