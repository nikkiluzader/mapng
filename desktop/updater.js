// Updates from GitHub Releases, only with the user's say-so: the app asks
// once whether to look for updates at all, and asks again before it
// downloads one (Download / Later / Skip this version) and before it
// restarts to install it. Nothing is fetched while the answer is no.
import fs from 'node:fs';
import { updaterText, fill } from './menuText.js';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
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
  // (the Windows portable zip: no installer put it there, so there is no
  // uninstaller beside the exe, and an update's installer would install a
  // second copy elsewhere. It says a new version is out and where to get it.)
  const portable = app.isPackaged && process.platform === 'win32' && !fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  const supported = app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  // Test builds (Help > Get Test Builds, off unless chosen): versions like 0.3.1-dev.4, published on GitHub as
  // pre-releases. Everyone else is offered only what GitHub calls the latest release, which a pre-release never is.
  const testBuilds = () => settings.read().testBuilds === true;
  const onTestBuild = () => /-/.test(app.getVersion());
  let quiet = false;        // a first look that says nothing when it finds nothing (a second one follows)
  let found = false;        // an update was offered by the check that is running

  let manual = false;       // the user asked: tell them the outcome either way
  let state = 'idle';       // idle | checking | downloading | ready

  const window = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  // (worded in the window's language: desktop/menuText.js)
  const u = () => updaterText(settings.read().language || app.getLocale());
  const ask = (opts) => dialog.showMessageBox(window(), { type: 'info', title: 'MapNG', noLink: true, ...opts });
  const setProgress = (p) => { for (const w of BrowserWindow.getAllWindows()) w.setProgressBar(p); };

  async function consent() {
    const s = settings.read();
    if (s.updates === 'on') return true;
    if (s.updates === 'off') return false;
    const { response } = await ask({
      message: u().askTitle,
      detail: u().askDetail,
      buttons: [u().askYes, u().askNo],
      defaultId: 0,
      cancelId: 1,
    });
    settings.write({ updates: response === 0 ? 'on' : 'off' });
    return response === 0;
  }

  async function check({ byUser = false } = {}) {
    if (!supported) {
      if (byUser) await ask({ message: u().unsupported, detail: process.platform === 'linux' ? u().onlyAppImage : u().devBuild });
      return;
    }
    if (state !== 'idle') {
      if (byUser) await ask({ message: state === 'ready' ? u().readyRestart : u().alreadyChecking });
      return;
    }
    if (byUser) settings.write({ updates: 'on' });
    else if (!(await consent())) return;
    manual = byUser;
    state = 'checking';
    found = false;
    try {
      const tests = testBuilds();
      // On a test build, the finished release first: the library only looks among test builds from one
      // (0.3.1-dev.5 would never be offered 0.3.1), so the latest release is asked for by itself.
      if (tests && onTestBuild()) {
        autoUpdater.allowPrerelease = false; quiet = true;
        try { await autoUpdater.checkForUpdates(); } catch { /* the look among test builds reports */ }
        quiet = false;
        if (found) return;
        state = 'checking';
      }
      autoUpdater.allowPrerelease = tests;
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        // A test build that is still being built: its tag is on GitHub (the updater sees it) before its files
        // are. Nothing to offer yet, not a failed check.
        if (!(tests && /CHANNEL_FILE_NOT_FOUND|Cannot find .*\.yml/i.test(String(error?.code || '') + String(error?.message || '')))) throw error;
        state = 'idle';
        if (manual) await ask({ message: fill(u().latest, { have: app.getVersion() }) });
      }
    } catch (error) {
      quiet = false;
      state = 'idle';
      if (manual) await ask({ type: 'warning', message: u().checkFailed, detail: String(error?.message || error) });
    }
  }

  autoUpdater.on('update-not-available', async () => {
    if (quiet) return;
    state = 'idle';
    if (manual) await ask({ message: fill(u().latest, { have: app.getVersion() }) });
  });

  autoUpdater.on('update-available', async (info) => {
    found = true;
    const s = settings.read();
    if (!manual && s.skipVersion === info.version) { state = 'idle'; return; }
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200)
      : '';
    const { response } = await ask({
      message: fill(u().available, { new: info.version, have: app.getVersion() }),
      detail: portable
        ? `${notes || u().seeNotes}\n\n${u().portable}`
        : notes || u().seeNotes,
      buttons: [portable ? u().openPage : u().download, u().later, u().skip],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 2) settings.write({ skipVersion: info.version });
    if (response !== 0) { state = 'idle'; return; }
    if (portable) { state = 'idle'; shell.openExternal(/-/.test(String(info.version)) ? `https://github.com/nikkiluzader/mapng/releases/tag/v${info.version}` : 'https://github.com/nikkiluzader/mapng/releases/latest'); return; }
    state = 'downloading';
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      state = 'idle';
      setProgress(-1);
      await ask({ type: 'warning', message: u().downloadFailed, detail: String(error?.message || error) });
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
      message: fill(u().ready, { new: info.version }),
      detail: running
        ? u().readyBusy
        : u().readyIdle,
      buttons: running ? [u().ok] : [u().restartNow, u().onClose],
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
    testBuilds,
    // (turned on: looked for at once, and that is the user asking for updates)
    setTestBuilds: (on) => { settings.write({ testBuilds: !!on }); if (on) check({ byUser: true }); },
  };
}
