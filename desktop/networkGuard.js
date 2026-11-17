// The desktop app connects only to the addresses on MapNG's published list (networkHosts.js, the same list as on
// mapng.com/data.html) and to the Overpass server the user set as their own. Anything else is refused: in the
// window (main.js gives every request of the session to allowedUrl) and in the export runner (its fetch asks the
// same function, runner/browserShims.mjs). What was refused shows in Help > Network Activity, marked.
// The one way round it is the user's own: "allowUnlistedAddresses": true in the app's settings.json.
import { networkHost } from './networkHosts.js';

let ownHost = '';

/** The user's own Overpass server (an https address, or nothing): its host name is allowed. Returns that host. */
export function setOwnServer(address) {
  ownHost = '';
  try { const u = new URL(String(address || '').trim()); if (u.protocol === 'https:') ownHost = u.hostname.toLowerCase(); } catch { /* none */ }
  return ownHost;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** { ok, host }: may the app ask this address? Only http(s) and ws(s) addresses to other machines are judged. */
export function allowedUrl(url) {
  let u; try { u = new URL(String(url)); } catch { return { ok: true, host: '' }; }
  if (!/^(https?|wss?):$/.test(u.protocol)) return { ok: true, host: '' };   // (app:, data:, blob:, devtools:, file:)
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (LOCAL.has(host)) return { ok: true, host };
  if (networkHost(host) || (ownHost && host === ownHost)) return { ok: true, host };
  return { ok: false, host };
}
