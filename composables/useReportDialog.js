import { ref } from 'vue';

// The desktop app's report dialog (components/modals/ReportDialog.vue),
// opened from anywhere: after a crash (on start), a failed export, generate
// or update, or Help -> Report a Problem. ctx: { error, logPath, options,
// area, description } (desktop/crashReports.js prepareReport).
const request = ref(null);   // { kind, ctx } while open

// the current settings as a session code (services/sessionConfig.js), set by
// the control panel; reports include it so the problem can be rebuilt exactly
let sessionCodeSource = null;
export function setSessionCodeSource(fn) { sessionCodeSource = typeof fn === 'function' ? fn : null; }
export async function currentSessionCode() {
  try { return sessionCodeSource ? await sessionCodeSource() : ''; } catch { return ''; }
}

export function openReportDialog(kind, ctx = {}) { request.value = { kind, ctx: JSON.parse(JSON.stringify(ctx || {})) }; }
export function closeReportDialog() { request.value = null; }
export const useReportDialog = () => ({ request, openReportDialog, closeReportDialog });

/** The job log named in a desktop error ("… [log: <file>]" / "… log: <file>"), or null. */
export function logPathFrom(message) {
  const m = /\[log: ([^\]]+)\]|log: (\S+)$/.exec(String(message || ''));
  return m ? (m[1] || m[2]).trim() : null;
}
