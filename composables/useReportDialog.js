import { ref } from 'vue';
import { encodeSessionCode } from '../services/sessionConfig.js';
import { consoleTail } from '../services/webReports.js';

// The desktop app's report dialog (components/modals/ReportDialog.vue),
// opened from anywhere: after a crash (on start), a failed export, generate
// or update, or Help -> Report a Problem. ctx: { error, logPath, options,
// area, description } (desktop/crashReports.js prepareReport).
const request = ref(null);   // { kind, ctx } while open

// the current settings as a session code (services/sessionConfig.js), set by
// the control panel; reports include it so the problem can be rebuilt exactly
// (the control panel registers a function returning its current session config)
let sessionConfigSource = null;
export function setSessionConfigSource(fn) { sessionConfigSource = typeof fn === 'function' ? fn : null; }
export function currentSessionConfigValue() {
  try { return sessionConfigSource ? sessionConfigSource() : null; } catch { return null; }
}
export async function currentSessionCode() {
  const config = currentSessionConfigValue();
  try { return config ? await encodeSessionCode(config) : ''; } catch { return ''; }
}

export function openReportDialog(kind, ctx = {}) {
  const copy = JSON.parse(JSON.stringify(ctx || {}));
  // (no job log to send: the window's own last lines, keys hidden, go in its place on the desktop)
  if (!copy.logPath) copy.pageLog = consoleTail();
  request.value = { kind, ctx: copy };
}
export function closeReportDialog() { request.value = null; }
export const useReportDialog = () => ({ request, openReportDialog, closeReportDialog });

/** The job log named in a desktop error ("… [log: <file>]" / "… log: <file>"), or null. */
export function logPathFrom(message) {
  const m = /\[log: ([^\]]+)\]|log: (\S+)$/.exec(String(message || ''));
  return m ? (m[1] || m[2]).trim() : null;
}
