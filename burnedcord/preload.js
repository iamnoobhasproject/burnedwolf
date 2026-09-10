const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('burnedCord', {
  apiRequest: (path, options = {}) => ipcRenderer.invoke('burnedcord-api-request', path, options),
  getScreenSources: () => ipcRenderer.invoke('burnedcord-screen-sources'),
  prepareScreenCapture: (sourceId, includeAudio = true) => ipcRenderer.invoke('burnedcord-prepare-screen-capture', { sourceId, includeAudio }),
  getMediaCapabilities: () => ipcRenderer.invoke('burnedcord-media-capabilities'),
  setGlobalPtt: (code, enabled = true) => ipcRenderer.invoke('burnedcord-set-global-ptt', { code, enabled }),
  onGlobalPtt: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload || {});
    ipcRenderer.on('burnedcord-ptt-state', listener);
    return () => ipcRenderer.removeListener('burnedcord-ptt-state', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('burnedcord-open-external', url),
  copyText: (text) => ipcRenderer.invoke('burnedcord-copy-text', text),
  getVersion: () => ipcRenderer.invoke('burnedcord-version'),
  windowAction: (action) => ipcRenderer.send('burnedcord-window-action', action),
});
