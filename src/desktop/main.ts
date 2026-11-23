import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({ width: 1100, height: 780, minWidth: 800, minHeight: 600, title: 'Mechanic Tracker', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(({ url }) => ({ action: url.startsWith('https://') || url.startsWith('http://localhost') ? 'allow' : 'deny' }));
  void win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
