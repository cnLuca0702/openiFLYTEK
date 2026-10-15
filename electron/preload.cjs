const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  toggleQuickBar: () => ipcRenderer.send('toggle-quick-bar'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onRecordingStateChanged: (callback) => {
    ipcRenderer.on('recording-state-changed', (_event, value) => callback(value));
  }
});
