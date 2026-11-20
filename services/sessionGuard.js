// "MapNG closed unexpectedly": noticing it, and getting the settings back.
//
// A tab that runs out of memory or a browser that crashes takes the session
// with it, and nothing can run at that moment. So a note is left when a
// Generate or an Export starts and taken away when it ends, or when the page
// is closed or reloaded in the ordinary way (pagehide fires then, and not when
// the tab dies). A note still there at the next start means the last job never
// ended: the app then offers the settings as they were (the session code,
// services/sessionConfig.js) and, if the person wants, a report.
//
// All of it stays in this browser (localStorage): no address, nothing sent.
// The note also keeps the job's last log lines (keys hidden, as in every report), refreshed while the job runs:
// a report about a tab that died held only the new page's first line, never where the job stopped (21 of the
// website reports of 2026-11-13 to 11-20).
import { consoleTail } from './webReports.js';

const KEY = 'mapng_job_running';
const LOG_LINES = 60;
const LOG_CHARS = 24 * 1024;
const LOG_EVERY_MS = 5000;
let logTimer = null;
const MAX_CODE_CHARS = 1.5 * 1024 * 1024;   // (a code with painted areas is long; past this only the note is kept)

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** A job starts: { kind: 'generate' | 'export', code: the session code or '', build }. */
export function markJobStart(kind, { code = '', build = '' } = {}) {
  const s = store(); if (!s) return;
  const note = { kind: String(kind), at: Date.now(), build: String(build || ''), code: typeof code === 'string' && code.length <= MAX_CODE_CHARS ? code : '' };
  try { s.setItem(KEY, JSON.stringify(note)); }
  catch { try { s.setItem(KEY, JSON.stringify({ ...note, code: '' })); } catch { /* storage full: no note */ } }
  if (logTimer) clearInterval(logTimer);
  logTimer = setInterval(() => noteJobLog(consoleTail()), LOG_EVERY_MS);
  logTimer.unref?.();   // (Node, tests: never what keeps a process alive)
}

/** The running job's note gets the last lines of `text` (the page's log). */
export function noteJobLog(text) {
  const s = store(); if (!s) return;
  try {
    const raw = s.getItem(KEY); if (!raw) return;
    const note = JSON.parse(raw);
    note.log = String(text || '').split('\n').slice(-LOG_LINES).join('\n').slice(-LOG_CHARS);
    s.setItem(KEY, JSON.stringify(note));
  } catch { /* storage full or the note gone: left as it is */ }
}

/** The job ended (done, failed with a message, or cancelled): no note. */
export function markJobEnd() {
  if (logTimer) { clearInterval(logTimer); logTimer = null; }
  try { store()?.removeItem(KEY); } catch { /* none */ }
}

/** The note of a job that never ended, or null: { kind, at, build, code, log }. */
export function unfinishedJob() {
  try {
    const raw = store()?.getItem(KEY); if (!raw) return null;
    const note = JSON.parse(raw);
    return note && typeof note.kind === 'string' && Number.isFinite(note.at) ? note : null;
  } catch { return null; }
}

/** Closing or reloading the page in the ordinary way is no crash: the note goes with the page. */
export function watchOrdinaryClose(target = globalThis.window) {
  target?.addEventListener?.('pagehide', markJobEnd);
}
