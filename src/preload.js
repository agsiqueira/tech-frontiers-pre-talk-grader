const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('graderApi', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectCsv: () => ipcRenderer.invoke('select-csv'),
  selectOutput: () => ipcRenderer.invoke('select-output'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  gradeFolder: args => ipcRenderer.invoke('grade-folder', args),
  onProgress: callback => ipcRenderer.on('progress', (_, data) => callback(data))
});
