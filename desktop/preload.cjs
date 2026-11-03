// What the page sees of the desktop app: window.mapngDesktop
// (services/platform/desktop.js is its only user).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mapngDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  chooseModsFolder: () => ipcRenderer.invoke('desktop:chooseModsFolder'),
  showItem: (file) => ipcRenderer.invoke('desktop:showItem', file),
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
});
