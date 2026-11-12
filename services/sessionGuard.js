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
const KEY = 'mapng_job_running';
const MAX_CODE_CHARS = 1.5 * 1024 * 1024;   // (a code with painted areas is long; past this only the note is kept)

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** A job starts: { kind: 'generate' | 'export', code: the session code or '', build }. */
export function markJobStart(kind, { code = '', build = '' } = {}) {
  const s = store(); if (!s) return;
  const note = { kind: String(kind), at: Date.now(), build: String(build || ''), code: typeof code === 'string' && code.length <= MAX_CODE_CHARS ? code : '' };
  try { s.setItem(KEY, JSON.stringify(note)); }
  catch { try { s.setItem(KEY, JSON.stringify({ ...note, code: '' })); } catch { /* storage full: no note */ } }
}

/** The job ended (done, failed with a message, or cancelled): no note. */
export function markJobEnd() { try { store()?.removeItem(KEY); } catch { /* none */ } }

/** The note of a job that never ended, or null: { kind, at, build, code }. */
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
