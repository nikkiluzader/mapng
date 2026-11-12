// Problem reports from the website: the same dialog and the same promise as
// the desktop app's (components/modals/ReportDialog.vue, desktop/crashReports.js).
// Nothing is sent unless the person chooses Send, after seeing what is in it.
//
// What a web report holds (public/data.html says the same): the build, the
// browser and system in a few words ("Chrome 142 on Windows"), the memory and
// cores the browser reports, the error, the last lines the page logged, the
// settings code, and what the person wrote. With "include the location"
// unticked: no place and no settings code. Never: an address, a name, the GPXZ
// key (settings codes never carry it), cookies, or anything typed elsewhere.
// It is posted to /api/crash (worker/crashReports.js), which keeps it in
// private storage only the developer reads.

const TAIL_LINES = 400;
const LINE_CHARS = 400;
const tail = [];
let installed = false;

/** Keep the page's last console lines in memory (the report's log); nothing leaves the page here. */
export function installConsoleTail(target = globalThis.console) {
  if (installed || !target) return;
  installed = true;
  for (const level of ['log', 'warn', 'error']) {
    const original = target[level]?.bind(target);
    if (!original) continue;
    target[level] = (...args) => {
      try {
        const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.name}: ${a.message}` : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
        tail.push(`${level === 'log' ? '' : `${level.toUpperCase()} `}${String(text).slice(0, LINE_CHARS)}`);
        if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES);
      } catch { /* a line that cannot be kept */ }
      original(...args);
    };
  }
}
export const consoleTail = () => tail.join('\n');

/** The browser and system in a few words, from the user agent: "Chrome 142 on Windows". */
export function browserSummary(ua = globalThis.navigator?.userAgent || '') {
  const s = String(ua);
  const pick = (re) => { const m = re.exec(s); return m ? m[1] : ''; };
  const browser = /Edg\//.test(s) ? `Edge ${pick(/Edg\/(\d+)/)}` : /OPR\//.test(s) ? `Opera ${pick(/OPR\/(\d+)/)}` : /Firefox\//.test(s) ? `Firefox ${pick(/Firefox\/(\d+)/)}`
    : /Chrome\//.test(s) ? `Chrome ${pick(/Chrome\/(\d+)/)}` : /Safari\//.test(s) ? `Safari ${pick(/Version\/(\d+)/)}` : 'Browser';
  const system = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'unknown system';
  return `${browser.trim()} on ${system}`;
}

const prepared = new Map();   // token -> the report as it would be sent

/** Build a report and show what is in it: { token, preview } (the dialog's "What's included"). */
export async function prepareReport(kind, ctx = {}) {
  const nav = globalThis.navigator || {};
  const log = consoleTail();
  const report = {
    kind: String(kind || 'manual'),
    appVersion: 'web',
    build: String(ctx.build || ''),
    platform: 'web',
    os: browserSummary(),
    error: String(ctx.error || '').slice(0, 4000),
    description: String(ctx.description || '').slice(0, 4000),
    options: ctx.options && typeof ctx.options === 'object' ? JSON.parse(JSON.stringify(ctx.options, (k, v) => (typeof v === 'function' || k === 'gpxzApiKey' ? undefined : v))) : null,
    area: ctx.area && typeof ctx.area === 'object' ? ctx.area : null,
    config: typeof ctx.config === 'string' ? ctx.config : '',
    memory: { totalGB: Number(nav.deviceMemory) || null, cpus: Number(nav.hardwareConcurrency) || null },
    log,
  };
  const token = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  prepared.set(token, report);
  return {
    token,
    preview: {
      appVersion: report.build ? `web (${report.build})` : 'web', os: report.os, memory: report.memory, error: report.error,
      logChars: log.length, logTail: log.split('\n').slice(-12).join('\n'), hasOptions: !!report.options, area: report.area, hasConfig: !!report.config,
    },
  };
}

/** Send a prepared report (the person chose Send): { id } or throws. */
export async function sendReport(token, { includeArea = true, description = '' } = {}, fetchImpl = globalThis.fetch) {
  const report = prepared.get(token);
  if (!report) throw new Error('This report is no longer available. Try again.');
  const body = { ...report, description: String(description || report.description || '').slice(0, 4000) };
  // (without the location: no place, no settings code (it holds the place), no options)
  if (!includeArea) { body.area = null; body.config = ''; body.options = null; }
  const r = await fetchImpl('/api/crash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) throw new Error(d.error || `The report could not be sent (HTTP ${r.status}).`);
  prepared.delete(token);
  return { id: d.id };
}

export async function dismissReport() { /* nothing kept on the website */ }

export const webReporter = { prepareReport, sendReport, dismissReport };
