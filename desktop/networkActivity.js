// What the app has connected to since it started: Help > Network Activity. Every address is counted here, the
// window's own requests (Electron's session) and the export runner's (it reports each address it asks, see
// runner/browserShims.mjs), and shown beside what MapNG's published list says it is for (networkHosts.js, the same
// list as on mapng.com/data.html). An address that is not on the list is shown first and marked: the Overpass
// server a user set as their own is the one expected case. Nothing here is sent anywhere or kept after the app closes.
import { networkHost } from './networkHosts.js';

const seen = new Map();   // host -> { count, failed, blocked, first, last }

/** Count one request to a host name (or a full address). */
export function noteHost(hostOrUrl, failed = false, blocked = false) {
  let host = String(hostOrUrl || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(host)) { try { const u = new URL(host); if (!/^https?:$/.test(u.protocol)) return; host = u.hostname; } catch { return; } }
  host = host.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host === '127.0.0.1') return;
  const now = Date.now();
  const row = seen.get(host) || { count: 0, failed: 0, blocked: 0, first: now, last: now };
  // (a refused request is counted on its own: it never left the computer)
  if (blocked) row.blocked++; else { row.count++; if (failed) row.failed++; }
  row.last = now;
  seen.set(host, row);
}

/** Count every request of an Electron session. */
export function watchSession(session) {
  session.webRequest.onCompleted((details) => noteHost(details.url));
  // (a request the guard refused ends as an error too: it is already counted as refused)
  session.webRequest.onErrorOccurred((details) => { if (details.error !== 'net::ERR_BLOCKED_BY_CLIENT') noteHost(details.url, true); });
}

/** The rows as they are shown: [{ host, count, failed, listed, kind, what }], unlisted first, then the busiest. */
export function activityRows() {
  return [...seen].map(([host, r]) => { const e = networkHost(host); return { host, count: r.count, failed: r.failed, blocked: r.blocked, listed: !!e, kind: e?.kind || null, what: e?.what || null }; })
    .sort((a, b) => ((b.blocked > 0) - (a.blocked > 0)) || (a.listed - b.listed) || (b.count - a.count) || a.host.localeCompare(b.host));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The window's page (no script: a picture of the list at the moment it was opened). t: networkText(lang). */
export function activityHtml(t, version) {
  const rows = activityRows();
  const body = rows.length
    ? rows.map((r) => `<tr class="${r.listed ? '' : 'unlisted'}"><td><code>${esc(r.host)}</code></td><td class="n">${r.count}${r.failed ? ` <span class="f">(${r.failed} ${esc(t.failed)})</span>` : ''}${r.blocked ? ` <span class="f">(${r.blocked} ${esc(t.refused)})</span>` : ''}</td><td>${r.listed ? esc(t.kinds[r.kind] || r.kind) : `<b>${esc(r.blocked && !r.count ? t.blocked : t.notListed)}</b>`}</td></tr>`).join('')
    : `<tr><td colspan="3">${esc(t.none)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>
    body{font:14px system-ui,sans-serif;margin:20px;color:#1b1b1b;background:#fff}h1{font-size:18px;margin:0 0 8px}p{margin:6px 0;line-height:1.45;color:#444}
    table{border-collapse:collapse;width:100%;margin-top:12px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #ddd;vertical-align:top}
    th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666}.n{white-space:nowrap}.f{color:#a15c00}
    tr.unlisted td{background:#fff4e0}code{font:13px ui-monospace,Consolas,monospace}
    @media (prefers-color-scheme: dark){body{background:#1c1c1e;color:#eee}p{color:#bbb}th{color:#999}th,td{border-color:#3a3a3c}tr.unlisted td{background:#4a3410}}
  </style></head><body><h1>${esc(t.title)}</h1><p>${esc(t.intro)}</p><p>${esc(t.listNote)} <code>mapng.com/data.html</code></p>
  <table><thead><tr><th>${esc(t.address)}</th><th>${esc(t.requests)}</th><th>${esc(t.purpose)}</th></tr></thead><tbody>${body}</tbody></table>
  <p>${esc(t.footer)} MapNG ${esc(version)}</p></body></html>`;
}

/** For tests. */
export function resetActivity() { seen.clear(); }
