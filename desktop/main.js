// MapNG desktop: the web app in a window, its level export in a full Node
// process (no 4 GB tab heap), the level written straight into BeamNG's mods.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findModsFolder } from './modsFolder.js';
import { listMapngLevels, readZipFile } from './levelLibrary.js';
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
    // a level's preview image, out of its zip in the mods folder
    const preview = url.pathname.match(/^\/__levelpreview\/([^/]+)\/([\w.-]{1,128})$/);
    if (preview) {
      const zipName = path.basename(decodeURIComponent(preview[1]));
      const folder = modsFolder();
      const bytes = folder ? (() => { try { return readZipFile(path.join(folder, zipName), `levels/${preview[2]}/preview.png`); } catch { return null; } })() : null;
      return bytes ? new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } }) : new Response(null, { status: 404 });
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
const linkedFiles = new Map();   // jobId → names linked from a generated terrain

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

// ---- taskbar progress and a notification when work ends ---------------------

function taskbarProgress(fraction) {
  for (const w of BrowserWindow.getAllWindows()) w.setProgressBar(fraction == null ? -1 : Math.max(0, Math.min(1, fraction)));
}
/** A notification, only while the app is in the background. */
function notifyDone(title, body) {
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused());
  if (focused || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  n.show();
}

// (leftovers from before: finished jobs remove themselves; a failed one is
// kept a few days for its log, a half-saved project not at all)
function clearLeftovers() {
  const KEEP_MS = 3 * 24 * 3600 * 1000;
  try {
    for (const d of fs.readdirSync(JOBS(), { withFileTypes: true })) {
      const p = path.join(JOBS(), d.name);
      if (d.isDirectory() && Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* none yet */ }
  try {
    for (const d of fs.readdirSync(PROJECTS())) if (d.endsWith('.saving')) fs.rmSync(path.join(PROJECTS(), d), { recursive: true, force: true });
  } catch { /* none yet */ }
  pruneSessions(null);
}

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
  // (what the background work is, for the monitor's label)
  const keys = [...exportUsage.keys()];
  const kind = keys.some((k) => k.startsWith('rebuild')) ? 'rebuild' : keys.some((k) => k.startsWith('gen:')) && keys.length === 1 ? 'generate' : 'export';
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
      kind,
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
  modsFolderExists: !!modsFolder() && fs.existsSync(modsFolder()),
  welcomed: !!readSettings().welcomed,
  updates: readSettings().updates || null,
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
      let result = null; let failure = null;
      child.on('message', (msg) => {
        if (msg?.type === 'progress') {
          event.sender.send('job:progress', jobId, msg);
          if (Number.isFinite(msg.pct)) taskbarProgress(msg.pct / 100);
        } else if (msg?.type === 'memory') exportUsage.set(jobId, msg);
        else if (msg?.type === 'done') result = msg;
        else if (msg?.type === 'error') failure = msg;
      });
      // (the page shows the reason and opens the log: "<reason> [log: <file>]")
      const log = path.join(dir, 'export.log');
      child.on('error', (error) => reject(new Error(`Could not start the export (${NODE}): ${error.message} [log: ${log}]`)));
      child.on('exit', (code, signal) => {
        if (result) {
          try { result.project = saveProject(dir, job, result); } catch (error) { console.error('project not saved:', error); }
          notifyDone('MapNG: level ready', `${result.filename} is in BeamNG's mods folder.`);
          resolve(result);
        } else if (signal) {
          reject(new Error(`export stopped (${signal}) [log: ${log}]`));
        } else {
          // (out of memory: V8 dies without a message)
          const tail = (() => { try { return fs.readFileSync(log, 'utf8').slice(-4000); } catch { return ''; } })();
          const oom = /heap out of memory|Allocation failed/i.test(tail);
          const reason = failure?.message || (oom ? 'The export ran out of memory.' : `The export stopped unexpectedly (code ${code}).`);
          reject(new Error(`${reason} [log: ${log}]`));
        }
      });
    });
  } finally {
    exportUsage.delete(jobId);
    running.delete(jobId);
    linkedFiles.delete(jobId);
    taskbarProgress(null);
  }
});

ipcMain.handle('job:cancel', (_event, jobId) => { running.get(jobId)?.kill(); });

// a generated terrain's file into an export job (a hard link: no copy)
ipcMain.handle('job:linkTerrainFile', (_event, jobId, name, sessionId, file) => {
  if (typeof name !== 'string' || name !== path.basename(name) || name === 'job.json') throw new Error('bad file name');
  const from = path.join(sessionDirOf(sessionId), path.basename(String(file)));
  const to = path.join(jobDirOf(jobId), name);
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
  if (!linkedFiles.has(jobId)) linkedFiles.set(jobId, new Set());
  linkedFiles.get(jobId).add(name);
});

// ---- projects: what each level was made from, for a rebuild -----------------

const PROJECTS = () => path.join(app.getPath('userData'), 'projects');
const projectDirOf = (levelName) => {
  if (!/^[\w.-]{1,128}$/.test(levelName) || levelName.startsWith('.')) throw new Error('bad level name');
  return path.join(PROJECTS(), levelName);
};
const linkOrCopy = (from, to) => { try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };

/**
 * After an export: the level's project (projects/<level folder name>), with
 * the generate job and its recorded sources (a rebuild replays them), the
 * export settings, and files the page changed after generating (a painted
 * texture) as overrides. Written beside and swapped in; replaces the
 * level's previous project.
 */
function saveProject(jobDir, job, result) {
  const levelName = path.basename(result.filename, '.zip');
  const dir = projectDirOf(levelName);
  const tmp = `${dir}.saving`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'overrides'), { recursive: true });
  const terrainId = typeof job.terrainData?.desktopTerrainId === 'string' ? job.terrainData.desktopTerrainId : null;
  let sources = 0;
  if (terrainId) {
    const session = sessionDirOf(terrainId);
    const generate = JSON.parse(fs.readFileSync(path.join(session, 'job.json'), 'utf8'));
    // (mirror health and probe times are of the moment, not of the map)
    for (const k of Object.keys(generate.localStorage || {})) if (/health|probe_at/i.test(k)) delete generate.localStorage[k];
    delete generate.sources;
    fs.writeFileSync(path.join(tmp, 'generate.json'), JSON.stringify(generate, null, 1));
    const src = path.join(session, 'sources');
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(tmp, 'sources'));
      for (const f of fs.readdirSync(src)) { linkOrCopy(path.join(src, f), path.join(tmp, 'sources', f)); sources++; }
    }
  }
  // images the page made or changed itself (not the generated terrain's files)
  const linked = linkedFiles.get(path.basename(jobDir)) || new Set();
  const overrides = {};
  for (const [k, v] of Object.entries(job.terrainData || {})) {
    if (!v || typeof v !== 'object' || typeof v.$file !== 'string' || linked.has(v.$file)) continue;
    if (!/(Url|Blob|Canvas)$/.test(k)) continue;
    linkOrCopy(path.join(jobDir, v.$file), path.join(tmp, 'overrides', v.$file));
    overrides[k] = v;
  }
  // (files the export options point at, e.g. a tree mix: kept beside them)
  const keepRefs = (v) => {
    if (Array.isArray(v)) v.forEach(keepRefs);
    else if (v && typeof v === 'object') {
      if (typeof v.$file === 'string') linkOrCopy(path.join(jobDir, path.basename(v.$file)), path.join(tmp, 'overrides', path.basename(v.$file)));
      else Object.values(v).forEach(keepRefs);
    }
  };
  keepRefs(job.options);
  fs.writeFileSync(path.join(tmp, 'project.json'), JSON.stringify({
    format: 1,
    levelName,
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    zip: result.path,
    rebuildable: !!terrainId && sources > 0,
    sources,
    center: job.center,
    options: job.options,
    overrides,
  }, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return dir;
}

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
  const old = dirs.filter((d) => d !== keep).sort().reverse().slice(keep ? KEEP_SESSIONS - 1 : KEEP_SESSIONS);
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

// ---- the levels sidebar: MapNG levels in the mods folder, and rebuilds ------

const readProject = (levelName) => {
  try { return JSON.parse(fs.readFileSync(path.join(projectDirOf(levelName), 'project.json'), 'utf8')); } catch { return null; }
};

ipcMain.handle('levels:list', () => {
  const folder = modsFolder();
  const levels = folder ? listMapngLevels(folder) : [];
  return {
    folder,
    appVersion: app.getVersion(),
    levels: levels.map(({ previewEntry, stamp, ...lv }) => {
      const project = readProject(lv.levelName);
      return {
        ...lv,
        appVersion: stamp?.appVersion || project?.appVersion || null,
        exportedAt: stamp?.exportedAt || project?.exportedAt || null,
        build: stamp?.build || null,
        metersPerPixel: stamp?.metersPerPixel || (lv.sizeMeters && lv.resolution ? lv.sizeMeters / lv.resolution : null),
        preview: previewEntry ? `app://mapng/__levelpreview/${encodeURIComponent(lv.zipName)}/${lv.levelName}` : null,
        rebuildable: !!project?.rebuildable,
        rebuilding: rebuilds.has(lv.levelName),
      };
    }),
  };
});

ipcMain.handle('levels:showInFolder', (_event, zipName) => {
  const folder = modsFolder();
  const file = folder && path.join(folder, path.basename(String(zipName)));
  if (file && fs.existsSync(file)) shell.showItemInFolder(file);
});

/** A runner to its end: resolves its 'done' message; progress and memory reported on the way. */
function runToEnd(child, { usageKey, onProgress }) {
  return new Promise((resolve, reject) => {
    let done = null; let failure = null;
    child.on('message', (msg) => {
      if (msg?.type === 'progress') onProgress?.(msg.update ?? msg);
      else if (msg?.type === 'memory') exportUsage.set(usageKey, msg);
      else if (msg?.type === 'done') done = msg;
      else if (msg?.type === 'error') failure = msg;
    });
    child.on('error', (error) => reject(new Error(`could not start (${NODE}): ${error.message}`)));
    child.on('exit', (code, signal) => {
      exportUsage.delete(usageKey);
      if (done) resolve(done);
      else if (failure?.aborted || signal) reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      else reject(new Error(failure?.message || `ended with code ${code}`));
    });
  });
}

const rebuilds = new Map();   // levelName → { children: Set }

/**
 * A level made again with this version of MapNG: from its project's
 * recorded sources when it has one (the same elevation, imagery and OSM,
 * today's code), else from its area fetched again. The new zip replaces the
 * old one only when it is complete.
 */
async function rebuildLevel(sender, zipName, levelName) {
  const folder = modsFolder();
  if (!folder) throw new Error('No mods folder set.');
  const zip = path.join(folder, path.basename(zipName));
  const level = listMapngLevels(folder).find((l) => l.zipName === path.basename(zipName) && l.levelName === levelName);
  if (!level) throw new Error('That level is no longer in the mods folder.');
  const project = readProject(levelName);
  const projectDir = projectDirOf(levelName);
  const replay = !!project?.rebuildable;
  if (!replay && !level.center) throw new Error('This level does not say where it is, so it cannot be fetched again.');
  const state = { children: new Set() };
  rebuilds.set(levelName, state);
  const progress = (phase, update) => { if (!sender.isDestroyed()) sender.send('levels:progress', levelName, { phase, update }); };
  try {
    // 1. the terrain: replayed, or fetched again (and recorded this time)
    let generate;
    if (replay) {
      generate = JSON.parse(fs.readFileSync(path.join(projectDir, 'generate.json'), 'utf8'));
      generate.sources = { mode: 'replay', dir: path.join(projectDir, 'sources'), fallback: true };
    } else {
      const mpp = level.sizeMeters && level.resolution ? level.sizeMeters / level.resolution : 1;
      generate = {
        center: level.center, resolution: level.resolution || 2048, includeOSM: true,
        useUSGS: false, useGPXZ: false, useKRON86: false, gpxzApiKey: '',
        generationOptions: { processingMetersPerPixel: mpp }, localStorage: {},
      };
    }
    const terrainId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session = sessionDirOf(terrainId);
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, 'job.json'), JSON.stringify(generate));
    const gen = spawnRunner(GENERATOR, session);
    state.children.add(gen);
    progress('terrain', replay ? 'Rebuilding the terrain from its saved data…' : 'Fetching the area again…');
    await runToEnd(gen, { usageKey: `rebuild-gen:${levelName}`, onProgress: (u) => progress('terrain', u) });
    state.children.delete(gen);
    pruneSessions(terrainId);

    // 2. the export, with the level's own settings
    const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const jobDir = jobDirOf(jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const terrain = JSON.parse(fs.readFileSync(path.join(session, 'terrain.json'), 'utf8'));
    const linked = new Set();
    for (const v of Object.values(terrain)) {
      if (v && typeof v === 'object' && typeof v.$file === 'string') {
        linkOrCopy(path.join(session, path.basename(v.$file)), path.join(jobDir, path.basename(v.$file)));
        linked.add(v.$file);
      }
    }
    linkedFiles.set(jobId, linked);
    // (a texture painted after generating, and files the options point at)
    if (project && fs.existsSync(path.join(projectDir, 'overrides'))) {
      for (const f of fs.readdirSync(path.join(projectDir, 'overrides'))) linkOrCopy(path.join(projectDir, 'overrides', f), path.join(jobDir, f));
      Object.assign(terrain, project.overrides || {});
    }
    terrain.desktopTerrainId = terrainId;
    const options = {
      ...(project?.options || level.stamp?.options || {}),
      levelName: project?.options?.levelName || level.stamp?.options?.levelName || level.title || levelName,
      appVersion: app.getVersion(),
      platform: 'desktop',
    };
    const outDir = path.join(jobDir, 'out');
    const job = { center: generate.center, terrainData: terrain, options, outputDir: outDir };
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(job));
    const exp = spawnRunner(RUNNER, jobDir);
    state.children.add(exp);
    running.set(jobId, exp);
    progress('export', 'Building the level…');
    const exportProgress = (p) => { if (Number.isFinite(p?.pct)) taskbarProgress(p.pct / 100); progress('export', p); };
    let result;
    try {
      result = await runToEnd(exp, { usageKey: `rebuild-exp:${levelName}`, onProgress: exportProgress });
    } finally {
      running.delete(jobId);
      state.children.delete(exp);
    }

    // 3. swapped in: the old zip stays until the new one is complete
    progress('export', 'Replacing the level in the mods folder…');
    try {
      fs.renameSync(result.path, zip);
    } catch (error) {
      if (error.code === 'EXDEV') { fs.copyFileSync(result.path, zip); fs.rmSync(result.path, { force: true }); }
      else if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw new Error('BeamNG is using this level. Go back to BeamNG\'s main menu (or close it) and rebuild again.');
      else throw error;
    }
    const final = { ...result, path: zip, filename: path.basename(zip) };
    if (replay) {
      // (the same sources: the project gets the new version and date)
      fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ ...project, appVersion: app.getVersion(), exportedAt: new Date().toISOString(), zip }, null, 1));
    } else {
      try { saveProject(jobDir, job, { ...final, filename: `${levelName}.zip` }); } catch (error) { console.error('project not saved:', error); }
    }
    fs.rmSync(jobDir, { recursive: true, force: true });
    linkedFiles.delete(jobId);
    notifyDone('MapNG: level rebuilt', `${level.title} is rebuilt with MapNG ${app.getVersion()}.`);
    return { ok: true, path: zip, replayed: replay, seconds: result.seconds };
  } finally {
    rebuilds.delete(levelName);
    taskbarProgress(null);
  }
}

ipcMain.handle('levels:rebuild', async (event, zipName, levelName) => {
  if (rebuilds.has(levelName)) throw new Error('That level is already being rebuilt.');
  try {
    return await rebuildLevel(event.sender, String(zipName), String(levelName));
  } catch (error) {
    if (error.cancelled) return { cancelled: true };
    throw error;
  }
});

ipcMain.handle('levels:cancel', (_event, levelName) => {
  for (const child of rebuilds.get(levelName)?.children || []) child.kill();
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
  // (Windows: notifications name the app by this)
  if (process.platform === 'win32') app.setAppUserModelId('com.mapng.desktop');
  clearLeftovers();
  servePage();
  const updater = startUpdater({
    settings: { read: readSettings, write: writeSettings },
    busy: () => running.size > 0 || rebuilds.size > 0,
    // (the first-run welcome asks about updates itself: no check before it)
    ready: () => !!readSettings().welcomed,
  });
  ipcMain.handle('desktop:welcomeDone', (_event, { updates } = {}) => {
    writeSettings({ welcomed: true, updates: updates ? 'on' : 'off' });
    buildMenu(updater);
    if (updates) updater.checkSoon();
  });
  buildMenu(updater);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const child of [...running.values(), ...generating.values(), ...[...rebuilds.values()].flatMap((r) => [...r.children])]) child.kill();
  if (process.platform !== 'darwin') app.quit();
});
