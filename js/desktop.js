// Electron desktop integration: wires the native File/Edit menu to the app.
//
// No-ops when window.ardustudioNative is absent, so the browser and portable
// builds are unaffected. The actual file I/O lives in js/fileio.js, which also
// serves the browser via the File System Access API.

import { makeProject, makeDemoProject } from './model.js';
import { isDesktop, saveProject, openProject, exportSketch, forgetFile } from './fileio.js';

export function initDesktop(app) {
  if (!isDesktop()) return;

  window.ardustudioNative.onMenu(async (command) => {
    switch (command) {
      case 'new':
        if (!confirm('Start a new blank project? Unsaved changes will be lost.')) return;
        app.setProject(makeProject());
        forgetFile();
        await window.ardustudioNative.forgetPath();
        break;
      case 'demo':
        if (!confirm('Load the Key Quest demo? Unsaved changes will be lost.')) return;
        app.setProject(makeDemoProject());
        forgetFile();
        await window.ardustudioNative.forgetPath();
        break;
      case 'open':
        await openProject(app);
        break;
      case 'save':
        await saveProject(app, false);
        break;
      case 'saveAs':
        await saveProject(app, true);
        break;
      case 'exportIno':
        await exportSketch(app);
        break;
      case 'undo':
        app.undo();
        break;
      case 'redo':
        app.redo();
        break;
      default:
        break;
    }
  });

  document.body.classList.add('is-desktop');
}
