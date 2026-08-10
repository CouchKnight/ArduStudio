// Electron main process for the ArduStudio desktop app.
//
// The window loads dist/ArduStudio.html — the bundled single-file build, not
// index.html. That is deliberate: Chromium blocks ES module scripts over
// file://, and the bundle is a single classic <script>, so it just works. It
// also guarantees the desktop app and the portable HTML run identical code.
//
// All filesystem and dialog access lives here; the renderer only sees the
// narrow API exposed by desktop/preload.cjs.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_NAME = 'ArduStudio';
const PROJECT_FILTERS = [
  { name: 'ArduStudio project', extensions: ['json', 'ardustudio'] },
  { name: 'All files', extensions: ['*'] },
];

let win = null;
// Path of the project currently open, so File → Save can skip the dialog.
let currentPath = null;

function setTitle() {
  if (!win) return;
  win.setTitle(currentPath ? `${path.basename(currentPath)} — ${APP_NAME}` : APP_NAME);
}

// Ask the renderer to run a menu command. The renderer owns the project state.
function send(channel, payload) {
  if (win) win.webContents.send(channel, payload);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        { label: 'Export Arduboy Sketch (.ino)…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'exportIno') },
        { label: 'Load Demo Project', click: () => send('menu', 'demo') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Arduboy Quick Start', click: () => shell.openExternal('https://www.arduboy.com/quick-start') },
        { label: 'Arduboy2 Library', click: () => shell.openExternal('https://github.com/MLXXXp/Arduboy2') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0d1117',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'ArduStudio.html'));
  setTitle();
  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------- IPC handlers

// Open a project: returns { path, text } or null if cancelled.
ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open ArduStudio project',
    filters: PROJECT_FILTERS,
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  const text = await fs.readFile(file, 'utf8');
  currentPath = file;
  setTitle();
  return { path: file, text };
});

// Save a project. With saveAs (or no current path) it prompts first.
ipcMain.handle('project:save', async (_e, { text, suggestedName, saveAs }) => {
  let file = currentPath;
  if (saveAs || !file) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save ArduStudio project',
      defaultPath: suggestedName || 'project.ardustudio.json',
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    file = res.filePath;
  }
  await fs.writeFile(file, text, 'utf8');
  currentPath = file;
  setTitle();
  return { path: file };
});

// Export the generated Arduino sketch.
ipcMain.handle('sketch:export', async (_e, { text, suggestedName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export Arduboy sketch',
    defaultPath: suggestedName || 'game.ino',
    filters: [{ name: 'Arduino sketch', extensions: ['ino'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, text, 'utf8');
  return { path: res.filePath };
});

// Starting a new project drops the association with the old file.
ipcMain.handle('project:forgetPath', async () => {
  currentPath = null;
  setTitle();
  return true;
});

ipcMain.handle('dialog:message', async (_e, { message, detail }) => {
  await dialog.showMessageBox(win, { type: 'info', message, detail, buttons: ['OK'] });
  return true;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
