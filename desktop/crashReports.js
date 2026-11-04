// Crash and problem reports, sent only when the user chooses Send (the
// page's ReportDialog.vue shows what's included first). Native crashes of
// the app are caught by Electron's crash reporter and kept on this computer
// (nothing is uploaded by it); after a crash, the next start offers to send
// one. Reports go to mapng.com/api/crash (crashReports.js at the repo root):
// private storage for the developer. What a report holds: public/data.html.
import { app, crashReporter, net } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanOptions, scrubText } from './reportScrub.js';

const MAX_LOG_CHARS = 1500 * 1024;          // the end of a job's log
const MAX_DUMP_BYTES = 8 * 1024 * 1024;

/** Before the app is ready: crash dumps kept locally, never uploaded by Electron. */
export function startCrashReporter() {
  crashReporter.start({ uploadToServer: false, compress: false, productName: 'MapNG' });
}

const dumpsDir = () => { try { return app.getPath('crashDumps'); } catch { return null; } };

function listDumps(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listDumps(p, out);
    else if (e.name.endsWith('.dmp')) { try { out.push({ path: p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }); } catch { /* gone */ } }
  }
  return out;
}

/** Crash dumps newer than the last one the user answered for (settings.crashSeenAt). */
export function pendingCrash(settings) {
  const seen = Number(settings.crashSeenAt) || 0;
  const dumps = listDumps(dumpsDir()).filter((d) => d.mtime > seen).sort((a, b) => b.mtime - a.mtime);
  return dumps.length ? { count: dumps.length, latest: dumps[0] } : null;
}

const readTail = (file, chars) => {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > chars ? `[… the first ${text.length - chars} characters left out …]\n${text.slice(-chars)}` : text;
  } catch { return ''; }
};

const prepared = new Map();   // token -> report

/**
 * A report put together for the page to show before sending:
 * kind 'crash' | 'export' | 'generate' | 'rebuild' | 'manual'; ctx { error,
 * logPath, options, area { lat, lng, resolution, metersPerPixel }, description }.
 * Returns { token, preview } (the preview lists exactly what would be sent).
 */
export function prepareReport(kind, ctx = {}, { build = '', settings = {} } = {}) {
  const report = {
    kind,
    appVersion: app.getVersion(),
    build,
    platform: process.platform,
    os: `${os.type()} ${os.release()} (${process.arch})`,
    error: scrubText(ctx.error).slice(0, 4000),
    description: String(ctx.description || '').slice(0, 4000),
    options: cleanOptions(ctx.options),
    area: ctx.area && typeof ctx.area === 'object' ? ctx.area : null,
    memory: { totalGB: +(os.totalmem() / 2 ** 30).toFixed(1), freeGB: +(os.freemem() / 2 ** 30).toFixed(1), cpus: os.cpus().length },
    log: ctx.logPath ? scrubText(readTail(ctx.logPath, MAX_LOG_CHARS)) : '',
    minidump: '',
  };
  let dump = null;
  if (kind === 'crash') {
    dump = pendingCrash(settings)?.latest || null;
    if (dump && dump.size <= MAX_DUMP_BYTES) {
      try { report.minidump = fs.readFileSync(dump.path).toString('base64'); } catch { dump = null; }
    }
  }
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  prepared.set(token, report);
  if (prepared.size > 10) prepared.delete(prepared.keys().next().value);
  return {
    token,
    preview: {
      kind,
      appVersion: report.appVersion,
      os: report.os,
      memory: report.memory,
      error: report.error,
      logChars: report.log.length,
      logTail: report.log.slice(-1200),
      hasOptions: !!report.options,
      area: report.area,
      dumpBytes: report.minidump ? dump.size : 0,
    },
  };
}

/** Send a prepared report (the user chose Send): { id } or throws. */
export async function sendReport(token, { includeArea = true, description = '' } = {}, apiOrigin) {
  const report = prepared.get(token);
  if (!report) throw new Error('This report is no longer available. Try again.');
  const body = { ...report, description: String(description || report.description || '').slice(0, 4000) };
  if (!includeArea) { body.area = null; body.options = cleanOptions(body.options, { keepLocation: false }); }
  const r = await net.fetch(`${apiOrigin}/api/crash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) throw new Error(d.error || `The report could not be sent (HTTP ${r.status}).`);
  prepared.delete(token);
  return { id: d.id };
}
