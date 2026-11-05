// Short send codes for session configs (services/sessionConfig.js): "Send"
// stores a "mapng:1:…" code for 24 hours under a code like K7F-29Q; "Open
// code" (or mapng.com/#K7F-29Q) reads it back. Stored in the R2 bucket under
// share/ (no public access; a lifecycle rule also deletes them after a day).
// No keys are ever in a config; nothing ties a code to the sender.

const PREFIX = 'share/';
const TTL_MS = 24 * 3600 * 1000;
const MAX_CODE_CHARS = 16 * 1024;
const LIMIT_PER_HOUR = 30;                    // per address, this isolate's memory only
const ID_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const recent = new Map();

const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
/** "k7f-29q" / "K7F29Q" → "K7F29Q", or null. */
export const normalizeShareId = (text) => {
  const id = String(text || '').toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${ID_CHARS}]{6}$`).test(id) ? id : null;
};
export const formatShareId = (id) => `${id.slice(0, 3)}-${id.slice(3)}`;

async function limited(request) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mapng-share:${address}`));
  const key = [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hour = Math.floor(Date.now() / 3600000);
  const seen = recent.get(key);
  if (seen && seen.hour === hour && seen.count >= LIMIT_PER_HOUR) return true;
  recent.set(key, { hour, count: seen?.hour === hour ? seen.count + 1 : 1 });
  if (recent.size > 5000) for (const [k, v] of recent) if (v.hour !== hour) recent.delete(k);
  return false;
}

/** POST /api/share { code } → { id, expiresAt }; GET /api/share/<id> → { code, expiresAt }. */
export async function handleShareCodes(request, env, url, json) {
  if (!env.OSM_TILES) return json({ error: 'Sending configs is not set up here' }, 503);
  const noStore = { 'Cache-Control': 'no-store' };
  const sub = url.pathname.slice('/api/share'.length);

  if (sub === '' || sub === '/') {
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_CODE_CHARS + 512) return json({ error: 'Config too large' }, 413);
    if (await limited(request)) return json({ error: 'Too many configs sent; try again later' }, 429);
    let body;
    try { body = JSON.parse(await request.text()); } catch { return json({ error: 'Bad request' }, 400); }
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!/^mapng:1:[A-Za-z0-9_-]+$/.test(code) || code.length > MAX_CODE_CHARS) return json({ error: 'Not a MapNG config' }, 400);
    let id = newId();
    for (let i = 0; i < 3 && await env.OSM_TILES.head(`${PREFIX}${id}`); i++) id = newId();
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    await env.OSM_TILES.put(`${PREFIX}${id}`, code, { httpMetadata: { contentType: 'text/plain' }, customMetadata: { expiresAt } });
    return json({ id: formatShareId(id), expiresAt }, 200, noStore);
  }

  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const id = normalizeShareId(decodeURIComponent(sub.slice(1)));
  if (!id) return json({ error: 'Not a send code' }, 404, noStore);
  const object = await env.OSM_TILES.get(`${PREFIX}${id}`);
  const expiresAt = object?.customMetadata?.expiresAt;
  if (!object || !expiresAt || Date.parse(expiresAt) < Date.now()) return json({ error: 'This code has expired or does not exist' }, 404, noStore);
  return json({ code: await object.text(), expiresAt }, 200, noStore);
}
