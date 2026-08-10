// Preload bridge. Exposes the smallest possible native API to the renderer —
// no fs, no ipcRenderer, no Node globals leak into the page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ardustudioNative', {
  isDesktop: true,

  // → { path, text } or null when cancelled
  openProject: () => ipcRenderer.invoke('project:open'),

  // → { path } or null when cancelled
  saveProject: (text, suggestedName, saveAs) =>
    ipcRenderer.invoke('project:save', { text, suggestedName, saveAs: !!saveAs }),

  // → { path } or null when cancelled
  exportSketch: (text, suggestedName) =>
    ipcRenderer.invoke('sketch:export', { text, suggestedName }),

  forgetPath: () => ipcRenderer.invoke('project:forgetPath'),

  message: (message, detail) => ipcRenderer.invoke('dialog:message', { message, detail }),

  // Menu commands from the main process: 'new' | 'open' | 'save' | 'saveAs' |
  // 'exportIno' | 'demo' | 'undo' | 'redo'
  onMenu: (handler) => {
    ipcRenderer.on('menu', (_event, command) => handler(command));
  },
});
