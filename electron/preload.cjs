const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  installLocalAsr: () => ipcRenderer.invoke('asr-install-start'),
  localAsrInstallStatus: () => ipcRenderer.invoke('asr-install-status'),
  openAsrInstallLog: () => ipcRenderer.invoke('asr-install-log'),
  platform: process.platform,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onRecordingStateChanged: (callback) => {
    ipcRenderer.on('recording-state-changed', (_event, value) => callback(value));
  }
});
