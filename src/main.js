const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { gradeFolder } = require('./grader');
const store = new Store({
  name: 'user-settings',
  cwd: app.getPath('userData')
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-csv', async () => {
  const result = await dialog.showOpenDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-output', async () => {
  const result = await dialog.showSaveDialog({ defaultPath: 'pre_talk_grading_results.xlsx', filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('load-settings', () => store.get('settings', {
  aiProvider: 'openai',
  baseUrl: 'https://api.ai.it.ufl.edu/v1',
  model: 'granite-3.3-8b-instruct',
  apiKey: '',
  gradingCalibration: 'supportive',
  concurrencyLimit: 3
}));

ipcMain.handle('save-settings', (_, settings) => { store.set('settings', settings); return true; });

ipcMain.handle('grade-folder', async (event, args) => {
  const result = await gradeFolder({
    ...args,
    onProgress: progress => event.sender.send('progress', progress)
  });
  return result;
});
