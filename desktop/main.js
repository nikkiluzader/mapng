// MapNG desktop: the web app in a window, its level export in a full Node
// process (no 4 GB tab heap), the level written straight into BeamNG's mods.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findModsFolder } from './modsFolder.js';
import { startUpdater } from './updater.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = process.env.MAPNG_API_ORIGIN || 'https://mapng.com';
// (MAPNG_USER_DATA: settings and jobs somewhere else, for tests)
if (process.env.MAPNG_USER_DATA) app.setPath('userData', process.env.MAPNG_USER_DATA);

// Packaged: the built page, the export runner and a Node runtime sit in
// resources/ outside the asar (a separate Node cannot read inside one).
// Development: the repo's dist/, desktop/runner/ and the node on PATH.
const RES = app.isPackaged ? process.resourcesPath : null;
const DIST = RES ? path.join(RES, 'dist') : path.resolve(HERE, '..', 'dist');
const RUNNER_DIR = RES ? path.join(RES, 'runner') : path.join(HERE, 'runner');
const RUNNER = path.join(RUNNER_DIR, 'exportJob.mjs');
const GENERATOR = path.join(RUNNER_DIR, 'generateJob.mjs');
const NODE = process.env.MAPNG_NODE
  || (RES ? path.join(RES, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node') : 'node');

// ---- settings ---------------------------------------------------------------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 1));
  return next;
}
const modsFolder = () => readSettings().modsFolder || findModsFolder();

async function chooseModsFolder(win) {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose where MapNG saves levels (BeamNG.drive\'s mods folder)',
    defaultPath: modsFolder() || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  writeSettings({ modsFolder: r.filePaths[0] });
  return r.filePaths[0];
}

// ---- the page ---------------------------------------------------------------

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

function servePage() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    // a generated terrain's files (the page reads them back by URL)
    const session = url.pathname.match(/^\/__terrain\/([\w-]{1,64})\/([\w.-]{1,128})$/);
    if (session) {
      const file = path.join(SESSIONS(), session[1], session[2]);
      if (!fs.existsSync(file)) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    }
    if (url.pathname.startsWith('/api/')) {
      // (as on mapng.com: its worker answers /api/*)
      return net.fetch(`${API_ORIGIN}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        duplex: 'half',
      });
    }
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'MapNG',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // links out open in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://mapng/');
  return win;
}

// ---- level exports ----------------------------------------------------------

const JOBS = () => path.join(app.getPath('userData'), 'jobs');
const jobDirOf = (jobId) => {
  if (!/^[\w-]{1,64}$/.test(jobId)) throw new Error('bad job id');
  return path.join(JOBS(), jobId);
};
const running = new Map();

/** A runner script in the bundled Node, its output logged to export.log in dir. */
function spawnRunner(script, dir) {
  // (three quarters of the machine's memory for the JS heap)
  const heapMB = Math.max(4096, Math.floor(os.totalmem() / 2 ** 20 * 0.75));
  const child = fork(script, [dir], {
    execPath: NODE,
    // (a bigger young generation: the export's short-lived geometry is swept
    // there cheaply instead of promoted, where each sweep walks gigabytes;
    // a dense 4 km export spent 29% of its time collecting garbage, 19% so)
    execArgv: [`--max-old-space-size=${heapMB}`, '--max-semi-space-size=64'],
    // (UV_THREADPOOL_SIZE: native zlib compresses on that many threads, 4 by default)
    env: {
      ...process.env, MAPNG_ASSETS: DIST, MAPNG_API_ORIGIN: API_ORIGIN, MAPNG_VERSION: app.getVersion(),
      ELECTRON_RUN_AS_NODE: undefined, UV_THREADPOOL_SIZE: String(Math.min(64, os.cpus().length)),
    },
    // (JSON messages: Electron's V8 and the bundled Node's write different
    // structured-clone versions, so bytes go as base64)
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // its mapng.com /api/* requests, made here (desktop/runner/common.mjs appApiFetch)
  child.on('message', async (msg) => {
    if (msg?.type !== 'api-fetch' || typeof msg.url !== 'string' || !msg.url.startsWith('/api/')) return;
    try {
      const r = await net.fetch(`${API_ORIGIN}${msg.url}`, {
        method: msg.method, headers: msg.headers,
        body: ['GET', 'HEAD'].includes(msg.method) || msg.body == null ? undefined : (msg.bodyBase64 ? Buffer.from(msg.body, 'base64') : msg.body),
      });
      const body = Buffer.from(await r.arrayBuffer()).toString('base64');
      if (child.connected) child.send({ type: 'api-fetch-result', id: msg.id, status: r.status, statusText: r.statusText, headers: Object.fromEntries([...r.headers.entries()].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k))), body });
    } catch (error) {
      if (child.connected) child.send({ type: 'api-fetch-result', id: msg.id, error: String(error?.message || error) });
    }
  });
  const logFile = fs.createWriteStream(path.join(dir, 'export.log'));
  child.stdout.pipe(logFile, { end: false });
  child.stderr.pipe(logFile, { end: false });
  child.on('exit', () => logFile.end());
  return child;
}
const exportUsage = new Map();   // jobId → the runner's last { rss, heapLimit, cores }

// ---- system usage (the page's memory monitor) -------------------------------

function cpuTimes() {
  return os.cpus().reduce((sum, { times: t }) => {
    sum.idle += t.idle;
    sum.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return sum;
  }, { idle: 0, total: 0 });
}
let cpuBefore = cpuTimes();

function systemUsage() {
  const now = cpuTimes();
  const span = now.total - cpuBefore.total;
  const cpu = span > 0 ? 1 - (now.idle - cpuBefore.idle) / span : 0;
  cpuBefore = now;
  const exports = [...exportUsage.values()];
  // (every MapNG process: the window's and the exports')
  const appBytes = app.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize || 0) * 1024, 0)
    + exports.reduce((sum, e) => sum + e.rss, 0);
  return {
    cpu,
    cores: os.cpus().length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    app: appBytes,
    export: exports.length ? {
      rss: exports.reduce((sum, e) => sum + e.rss, 0),
      heapLimit: Math.max(...exports.map((e) => e.heapLimit)),
      cores: exports.reduce((sum, e) => sum + e.cores, 0),
    } : null,
  };
}

setInterval(() => {
  const usage = systemUsage();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('desktop:usage', usage);
}, 1000).unref();

ipcMain.handle('desktop:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  modsFolder: modsFolder(),
  memoryGB: Math.round(os.totalmem() / 2 ** 30),
}));

ipcMain.handle('desktop:chooseModsFolder', (event) => chooseModsFolder(BrowserWindow.fromWebContents(event.sender)));

ipcMain.handle('desktop:showItem', (_event, file) => {
  if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file);
});

ipcMain.handle('job:begin', () => {
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(jobDirOf(jobId), { recursive: true });
  return jobId;
});

// (a file in pieces: one IPC message stays well under Chromium's size limit)
ipcMain.handle('job:write', (_event, jobId, name, bytes, append) => {
  if (typeof name !== 'string' || name !== path.basename(name) || name === 'job.json') throw new Error('bad file name');
  const file = path.join(jobDirOf(jobId), name);
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (append) fs.appendFileSync(file, data); else fs.writeFileSync(file, data);
});

ipcMain.handle('job:run', async (event, jobId, job) => {
  const dir = jobDirOf(jobId);
  let outputDir = modsFolder();
  if (!outputDir || !fs.existsSync(outputDir)) outputDir = await chooseModsFolder(BrowserWindow.fromWebContents(event.sender));
  if (!outputDir) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { cancelled: true };
  }
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ ...job, outputDir }));
  const child = spawnRunner(RUNNER, dir);
  running.set(jobId, child);
  try {
    return await new Promise((resolve, reject) => {
      let result = null;
      child.on('message', (msg) => {
        if (msg?.type === 'progress') event.sender.send('job:progress', jobId, msg);
        else if (msg?.type === 'memory') exportUsage.set(jobId, msg);
        else if (msg?.type === 'done') result = msg;
        else if (msg?.type === 'error') reject(new Error(msg.message));
      });
      child.on('error', (error) => reject(new Error(`could not start the export (${NODE}): ${error.message}`)));
      child.on('exit', (code, signal) => {
        if (result) resolve(result);
        else reject(new Error(signal ? `export stopped (${signal})` : `export ended with code ${code}; log: ${path.join(dir, 'export.log')}`));
      });
    });
  } finally {
    exportUsage.delete(jobId);
    running.delete(jobId);
  }
});

ipcMain.handle('job:cancel', (_event, jobId) => { running.get(jobId)?.kill(); });

// a generated terrain's file into an export job (a hard link: no copy)
ipcMain.handle('job:linkTerrainFile', (_event, jobId, name, sessionId, file) => {
  if (typeof name !== 'string' || name !== path.basename(name) || name === 'job.json') throw new Error('bad file name');
  const from = path.join(sessionDirOf(sessionId), path.basename(String(file)));
  const to = path.join(jobDirOf(jobId), name);
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
});

// ---- terrain generation (the page's Generate Data, in Node) -----------------

const SESSIONS = () => path.join(app.getPath('userData'), 'terrain');
const sessionDirOf = (id) => {
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error('bad terrain id');
  return path.join(SESSIONS(), id);
};
// (the newest few kept: the one on screen, and the one before it)
const KEEP_SESSIONS = 3;
function pruneSessions(keep) {
  let dirs = [];
  try { dirs = fs.readdirSync(SESSIONS(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
  const old = dirs.filter((d) => d !== keep).sort().reverse().slice(KEEP_SESSIONS - 1);
  for (const d of old) fs.rmSync(path.join(SESSIONS(), d), { recursive: true, force: true });
}

const generating = new Map();

ipcMain.handle('terrain:generate', async (event, params) => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = sessionDirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(params));
  const child = spawnRunner(GENERATOR, dir);
  generating.set(id, child);
  event.sender.send('terrain:started', id);
  try {
    const result = await new Promise((resolve, reject) => {
      let done = null; let failure = null;
      child.on('message', (msg) => {
        if (msg?.type === 'progress') event.sender.send('terrain:progress', id, msg.update);
        else if (msg?.type === 'memory') exportUsage.set(`gen:${id}`, msg);
        else if (msg?.type === 'done') done = msg;
        else if (msg?.type === 'error') failure = msg;
      });
      child.on('error', (error) => reject(new Error(`could not start terrain generation (${NODE}): ${error.message}`)));
      child.on('exit', (code, signal) => {
        if (done) resolve({ id, ...done });
        else if (failure?.aborted || signal) resolve({ id, cancelled: true });
        else reject(new Error(failure?.message || `terrain generation ended with code ${code}; log: ${path.join(dir, 'export.log')}`));
      });
    });
    if (result.cancelled) fs.rmSync(dir, { recursive: true, force: true });
    else pruneSessions(id);
    return result;
  } finally {
    exportUsage.delete(`gen:${id}`);
    generating.delete(id);
  }
});

// (asked politely first: the runner aborts its fetches; killed if it lingers)
ipcMain.handle('terrain:cancel', (_event, id) => {
  const child = generating.get(id);
  if (!child) return;
  try { child.send({ type: 'cancel' }); } catch { /* gone */ }
  setTimeout(() => { if (generating.get(id) === child) child.kill(); }, 3000).unref();
});

// a finished job's files are no longer needed (a failed one's are kept for its log)
ipcMain.handle('job:cleanup', (_event, jobId) => {
  fs.rmSync(jobDirOf(jobId), { recursive: true, force: true });
});

// ---- the menu ---------------------------------------------------------------

const REPO = 'https://github.com/nikkiluzader/mapng';

function buildMenu(updater) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Mods Folder', click: () => { const f = modsFolder(); if (f && fs.existsSync(f)) shell.openPath(f); } },
        { label: 'Change Mods Folder…', click: () => chooseModsFolder(BrowserWindow.getFocusedWindow()) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => updater.checkNow() },
        { label: 'Check for Updates Automatically', type: 'checkbox', checked: updater.enabled(), click: (item) => updater.setEnabled(item.checked) },
        { type: 'separator' },
        { label: 'Export Logs Folder', click: () => { fs.mkdirSync(JOBS(), { recursive: true }); shell.openPath(JOBS()); } },
        { label: 'Report a Problem', click: () => shell.openExternal(`${REPO}/issues`) },
        { label: 'Release Notes', click: () => shell.openExternal(`${REPO}/releases`) },
        { type: 'separator' },
        {
          label: 'About MapNG',
          click: () => dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
            type: 'info', title: 'MapNG', noLink: true,
            message: `MapNG ${app.getVersion()}`,
            detail: `Real-world maps for BeamNG.drive.\n\nElectron ${process.versions.electron} · ${process.platform} ${process.arch}\nMods folder: ${modsFolder() || 'not set'}`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// one window: a second launch brings the first one forward
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  servePage();
  const updater = startUpdater({ settings: { read: readSettings, write: writeSettings }, busy: () => running.size > 0 });
  buildMenu(updater);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const child of [...running.values(), ...generating.values()]) child.kill();
  if (process.platform !== 'darwin') app.quit();
});
