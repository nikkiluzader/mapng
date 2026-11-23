// Limits that hold however many addresses a sender has, and whichever copy of
// the worker answers.
//
//  - overRate: per sender, a minute at a time, kept by Cloudflare's own rate
//    limiter (the ratelimits bindings in wrangler.json), not in this worker's
//    memory, which is lost whenever the worker restarts. An IPv6 sender is
//    its /64: one home connection, however many addresses it cycles through.
//  - overBudget: a day's total for everyone together, counted in the Durable
//    Object so two requests at once cannot both take the last place. This is
//    what stops a sender with thousands of addresses: writing to storage,
//    sending mail and adding to the public counts all have a ceiling a day.
//
//  - overSenderBudget: a day's total for one sender, kept in the Durable
//    Object's memory only (never written to its storage: nothing about who
//    sent what is kept). The object is one for the whole site, so the count
//    holds across every copy of the worker; it starts again when the object
//    has been idle long enough to be put away, which a sender who keeps
//    sending never lets happen.
//
// Where a binding is missing (tests, a local run), nothing is limited here:
// each route keeps its own in-memory limit as well.

/** Who is asking, for a limit: the address, or the /64 of an IPv6 one. */
export function senderKey(request) {
  const address = String(request.headers.get('CF-Connecting-IP') || 'unknown').trim().toLowerCase();
  if (!address.includes(':')) return address;
  // (the first four groups; "::" stands for the groups left out)
  const [head, tail = ''] = address.split('::');
  const groups = head.split(':').filter(Boolean);
  if (address.includes('::')) {
    const rest = tail.split(':').filter(Boolean);
    while (groups.length + rest.length < 8) groups.push('0');
    groups.push(...rest);
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** True when this sender has asked `scope` too often this minute (limiter: the binding's name). */
export async function overRate(env, limiter, request, scope) {
  const binding = env?.[limiter];
  if (!binding?.limit) return false;
  try {
    const { success } = await binding.limit({ key: `${scope}:${senderKey(request)}` });
    return !success;
  } catch { return false; }
}

/** True when everyone together has asked `scope` too often this minute (one key for all senders). */
export async function overRateAll(env, limiter, scope) {
  const binding = env?.[limiter];
  if (!binding?.limit) return false;
  try {
    const { success } = await binding.limit({ key: `${scope}:all` });
    return !success;
  } catch { return false; }
}

/** True when today's total for `name` is used up; otherwise `n` is taken from it. */
export async function overBudget(env, name, max, n = 1) {
  if (!env?.HOTSPOTS) return false;
  try {
    const stub = env.HOTSPOTS.get(env.HOTSPOTS.idFromName('global'));
    const { ok } = await (await stub.fetch('https://hotspots/budget', { method: 'POST', body: JSON.stringify({ name, max, n }) })).json();
    return ok === false;
  } catch { return false; }
}

/** A hash of the sender (the address, or an IPv6 /64) for a limit's key: never the address itself. */
export async function senderHash(request, scope) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mapng-${scope}:${senderKey(request)}`));
  return [...new Uint8Array(bytes).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when this sender's total for `name` today is used up; otherwise `n` is taken from it. */
export async function overSenderBudget(env, name, request, max, n = 1) {
  if (!env?.HOTSPOTS) return false;
  try {
    const stub = env.HOTSPOTS.get(env.HOTSPOTS.idFromName('global'));
    const { ok } = await (await stub.fetch('https://hotspots/sender-budget', { method: 'POST', body: JSON.stringify({ name, sender: await senderHash(request, name), max, n }) })).json();
    return ok === false;
  } catch { return false; }
}

/**
 * A request's body as text, read in pieces and given up on past `maxBytes` whatever the sender says its
 * length is (a body sent in pieces names no length): the text, or null when it is too long or unreadable.
 */
export async function readCapped(request, maxBytes) {
  try {
    if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return null;
    const reader = request.body?.getReader();
    if (!reader) return '';
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { try { await reader.cancel(); } catch { /* closed */ } return null; }
      parts.push(value);
    }
    const all = new Uint8Array(size); let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    return new TextDecoder().decode(all);
  } catch { return null; }
}

// One sender's totals a day (overSenderBudget). Far above what one person does.
export const DAILY_PER_SENDER = {
  reports: 20,               // problem reports from one address (a person sends one to three)
  mapterhornTiles: 40000,    // elevation tiles one address has stored for good (ten 16 km maps)
};

// A day's totals, everyone together. Each is far above real use (noted beside it), so nobody
// who uses MapNG meets one; a script that got past the per-sender limits stops here.
export const DAILY = {
  reports: 400,              // problem reports stored (about 10 a day arrive)
  usage: 5000,               // settings reports counted (about 50 a day)
  shareCodes: 2000,          // send codes made
  mapterhornTiles: 400000,   // elevation tiles fetched and stored for good (a 16 km map is about 4,000)
};
