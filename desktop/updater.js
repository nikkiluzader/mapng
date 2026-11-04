// Updates from GitHub Releases, only with the user's say-so: the app asks
// once whether to look for updates at all, and asks again before it
// downloads one (Download / Later / Skip this version) and before it
// restarts to install it. Nothing is fetched while the answer is no.
import { app, BrowserWindow, dialog } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * settings: { read(), write(patch) } — the app's settings.json.
 * busy(): true while an export runs (no restart then).
 */
export function startUpdater({ settings, busy, ready = () => true }) {
  // (only a packaged build updates; the Linux build only as an AppImage)
  const supported = app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  let manual = false;       // the user asked: tell them the outcome either way
  let state = 'idle';       // idle | checking | downloading | ready

  const window = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const ask = (opts) => dialog.showMessageBox(window(), { type: 'info', title: 'MapNG', noLink: true, ...opts });
  const setProgress = (p) => { for (const w of BrowserWindow.getAllWindows()) w.setProgressBar(p); };

  async function consent() {
    const s = settings.read();
    if (s.updates === 'on') return true;
    if (s.updates === 'off') return false;
    const { response } = await ask({
      message: 'Check for MapNG updates?',
      detail: 'MapNG can look for new versions on GitHub now and then. It always asks before downloading or installing one. You can change this later in the Help menu.',
      buttons: ['Check for updates', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    });
    settings.write({ updates: response === 0 ? 'on' : 'off' });
    return response === 0;
  }

  async function check({ byUser = false } = {}) {
    if (!supported) {
      if (byUser) await ask({ message: 'Updates are not available in this build.', detail: process.platform === 'linux' ? 'Only the AppImage updates itself.' : 'Development builds do not update.' });
      return;
    }
    if (state !== 'idle') {
      if (byUser) await ask({ message: state === 'ready' ? 'An update is ready: restart MapNG to install it.' : 'Already checking for updates.' });
      return;
    }
    if (byUser) settings.write({ updates: 'on' });
    else if (!(await consent())) return;
    manual = byUser;
    state = 'checking';
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      state = 'idle';
      if (manual) await ask({ type: 'warning', message: 'Could not check for updates.', detail: String(error?.message || error) });
    }
  }

  autoUpdater.on('update-not-available', async () => {
    state = 'idle';
    if (manual) await ask({ message: `MapNG ${app.getVersion()} is the latest version.` });
  });

  autoUpdater.on('update-available', async (info) => {
    const s = settings.read();
    if (!manual && s.skipVersion === info.version) { state = 'idle'; return; }
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200)
      : '';
    const { response } = await ask({
      message: `MapNG ${info.version} is available (you have ${app.getVersion()}).`,
      detail: notes || 'See the release notes on GitHub.',
      buttons: ['Download', 'Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 2) settings.write({ skipVersion: info.version });
    if (response !== 0) { state = 'idle'; return; }
    state = 'downloading';
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      state = 'idle';
      setProgress(-1);
      await ask({ type: 'warning', message: 'The update could not be downloaded.', detail: String(error?.message || error) });
    }
  });

  autoUpdater.on('download-progress', (p) => setProgress(Math.max(0, Math.min(1, p.percent / 100))));

  autoUpdater.on('update-downloaded', async (info) => {
    state = 'ready';
    setProgress(-1);
    // (installed on quit from here on: the user chose to download it)
    autoUpdater.autoInstallOnAppQuit = true;
    const running = busy();
    const { response } = await ask({
      message: `MapNG ${info.version} is ready to install.`,
      detail: running
        ? 'An export is running: MapNG will install the update when you close it.'
        : 'Restart now to install it, or it installs when you close MapNG.',
      buttons: running ? ['OK'] : ['Restart now', 'When I close MapNG'],
      defaultId: 0,
      cancelId: running ? 0 : 1,
    });
    if (!running && response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('error', () => { /* reported where a check or download was awaited */ });

  if (supported) {
    setTimeout(() => { if (ready()) check(); }, FIRST_CHECK_MS).unref?.();
    setInterval(() => { if (settings.read().updates === 'on') check(); }, CHECK_EVERY_MS).unref?.();
  }

  return {
    checkNow: () => check({ byUser: true }),
    checkSoon: () => { if (supported) setTimeout(() => check(), 3000).unref?.(); },
    setEnabled: (on) => settings.write({ updates: on ? 'on' : 'off' }),
    enabled: () => settings.read().updates === 'on',
  };
}
