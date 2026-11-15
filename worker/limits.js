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

/** True when today's total for `name` is used up; otherwise `n` is taken from it. */
export async function overBudget(env, name, max, n = 1) {
  if (!env?.HOTSPOTS) return false;
  try {
    const stub = env.HOTSPOTS.get(env.HOTSPOTS.idFromName('global'));
    const { ok } = await (await stub.fetch('https://hotspots/budget', { method: 'POST', body: JSON.stringify({ name, max, n }) })).json();
    return ok === false;
  } catch { return false; }
}

// A day's totals, everyone together. Each is far above real use (noted beside it), so nobody
// who uses MapNG meets one; a script that got past the per-sender limits stops here.
export const DAILY = {
  reports: 400,              // problem reports stored (about 10 a day arrive)
  usage: 5000,               // settings reports counted (about 50 a day)
  shareCodes: 2000,          // send codes made
  mapterhornTiles: 400000,   // elevation tiles fetched and stored for good (a 16 km map is about 4,000)
};
