// What the page sees of the desktop app: window.mapngDesktop
// (services/platform/desktop.js is its only user).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mapngDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  // the first-run welcome is answered (updates: check automatically or not)
  welcomeDone: (answers) => ipcRenderer.invoke('desktop:welcomeDone', answers),
  chooseModsFolder: () => ipcRenderer.invoke('desktop:chooseModsFolder'),
  showItem: (file) => ipcRenderer.invoke('desktop:showItem', file),
  // a batch job's file was saved into Downloads/MapNG Batch: { name, path, state }
  onBatchFileSaved: (callback) => {
    const listener = (_event, saved) => callback(saved);
    ipcRenderer.on('desktop:batchFileSaved', listener);
    return () => ipcRenderer.removeListener('desktop:batchFileSaved', listener);
  },
  beginJob: () => ipcRenderer.invoke('job:begin'),
  writeJobFile: (jobId, name, bytes, append) => ipcRenderer.invoke('job:write', jobId, name, bytes, append),
  runJob: (jobId, job, onProgress) => {
    const listener = (_event, id, progress) => { if (id === jobId) onProgress?.(progress); };
    ipcRenderer.on('job:progress', listener);
    return ipcRenderer.invoke('job:run', jobId, job).finally(() => ipcRenderer.removeListener('job:progress', listener));
  },
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  // system usage each second: { cpu (0–1), cores, memTotal, memFree, app,
  // export: { rss, heapLimit, cores } | null } (bytes)
  onUsage: (callback) => {
    const listener = (_event, usage) => callback(usage);
    ipcRenderer.on('desktop:usage', listener);
    return () => ipcRenderer.removeListener('desktop:usage', listener);
  },
  cleanupJob: (jobId) => ipcRenderer.invoke('job:cleanup', jobId),
  linkTerrainFile: (jobId, name, terrainId, file) => ipcRenderer.invoke('job:linkTerrainFile', jobId, name, terrainId, file),
  // Generate Data in a Node process: resolves { id, seconds, width, height }
  // or { id, cancelled }; onStarted(id) first (for cancelTerrain), then
  // onProgress(update) with what the page's loading screen shows
  generateTerrain: (params, { onStarted, onProgress } = {}) => {
    let id = null;
    const started = (_event, startedId) => { if (id === null) { id = startedId; onStarted?.(startedId); } };
    const progress = (_event, progressId, update) => { if (progressId === id) onProgress?.(update); };
    ipcRenderer.on('terrain:started', started);
    ipcRenderer.on('terrain:progress', progress);
    return ipcRenderer.invoke('terrain:generate', params).finally(() => {
      ipcRenderer.removeListener('terrain:started', started);
      ipcRenderer.removeListener('terrain:progress', progress);
    });
  },
  cancelTerrain: (id) => ipcRenderer.invoke('terrain:cancel', id),
  // the levels sidebar: { folder, appVersion, levels: [...] }
  listLevels: () => ipcRenderer.invoke('levels:list'),
  showLevelInFolder: (zipName) => ipcRenderer.invoke('levels:showInFolder', zipName),
  showLevelData: (levelName) => ipcRenderer.invoke('levels:showData', levelName),
  // the level's zip and saved project to the Recycle Bin / Trash: resolves { ok }
  deleteLevel: (zipName, levelName) => ipcRenderer.invoke('levels:delete', zipName, levelName),
  // a level's saved settings for "Modify" ({ center, resolution, generationOptions, options, ... } or null)
  levelProject: (levelName) => ipcRenderer.invoke('levels:project', levelName),
  // resolves { ok, path, replayed, seconds, fromSaved, downloaded } or { cancelled }; onProgress({ phase, update })
  rebuildLevel: (zipName, levelName, onProgress) => {
    const listener = (_event, name, progress) => { if (name === levelName) onProgress?.(progress); };
    ipcRenderer.on('levels:progress', listener);
    return ipcRenderer.invoke('levels:rebuild', zipName, levelName).finally(() => ipcRenderer.removeListener('levels:progress', listener));
  },
  cancelRebuild: (levelName) => ipcRenderer.invoke('levels:cancel', levelName),
  // crash and problem reports (desktop/crashReports.js): pending crash on start,
  // prepare (returns what would be sent), send (only on the user's Send), dismiss
  pendingCrash: () => ipcRenderer.invoke('report:pending'),
  prepareReport: (kind, ctx) => ipcRenderer.invoke('report:prepare', kind, ctx),
  sendReport: (token, choices) => ipcRenderer.invoke('report:send', token, choices),
  dismissReport: (kind) => ipcRenderer.invoke('report:dismiss', kind),
  onOpenReport: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('report:open', listener);
    return () => ipcRenderer.removeListener('report:open', listener);
  },
});
