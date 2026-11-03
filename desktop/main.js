// MapNG desktop: the web app in a window, its level export in a full Node
// process (no 4 GB tab heap), the level written straight into BeamNG's mods.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findModsFolder } from './modsFolder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = process.env.MAPNG_API_ORIGIN || 'https://mapng.com';
// (MAPNG_USER_DATA: settings and jobs somewhere else, for tests)
if (process.env.MAPNG_USER_DATA) app.setPath('userData', process.env.MAPNG_USER_DATA);

// Packaged: the built page, the export runner and a Node runtime sit in
// resources/ outside the asar (a separate Node cannot read inside one).
// Development: the repo's dist/, desktop/runner/ and the node on PATH.
const RES = app.isPackaged ? process.resourcesPath : null;
const DIST = RES ? path.join(RES, 'dist') : path.resolve(HERE, '..', 'dist');
const RUNNER = RES ? path.join(RES, 'runner', 'exportJob.mjs') : path.join(HERE, 'runner', 'exportJob.mjs');
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
  win.setMenuBarVisibility(false);
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
  // (three quarters of the machine's memory for the export's JS heap)
  const heapMB = Math.max(4096, Math.floor(os.totalmem() / 2 ** 20 * 0.75));
  const child = fork(RUNNER, [dir], {
    execPath: NODE,
    // (a bigger young generation: the export's short-lived geometry is swept
    // there cheaply instead of promoted, where each sweep walks gigabytes;
    // a dense 4 km export spent 29% of its time collecting garbage, 19% so)
    execArgv: [`--max-old-space-size=${heapMB}`, '--max-semi-space-size=64'],
    // (UV_THREADPOOL_SIZE: native zlib compresses on that many threads, 4 by default)
    env: { ...process.env, MAPNG_ASSETS: DIST, MAPNG_API_ORIGIN: API_ORIGIN, ELECTRON_RUN_AS_NODE: undefined, UV_THREADPOOL_SIZE: String(Math.min(64, os.cpus().length)) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  running.set(jobId, child);
  const logFile = fs.createWriteStream(path.join(dir, 'export.log'));
  child.stdout.pipe(logFile, { end: false });
  child.stderr.pipe(logFile, { end: false });
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
    logFile.end();
  }
});

ipcMain.handle('job:cancel', (_event, jobId) => { running.get(jobId)?.kill(); });

// a finished job's files are no longer needed (a failed one's are kept for its log)
ipcMain.handle('job:cleanup', (_event, jobId) => {
  fs.rmSync(jobDirOf(jobId), { recursive: true, force: true });
});

app.whenReady().then(() => {
  servePage();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const child of running.values()) child.kill();
  if (process.platform !== 'darwin') app.quit();
});
