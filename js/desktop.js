// Desktop (Electron) integration.
//
// Everything here is a no-op when `window.ardustudioNative` is absent, so the
// plain browser build and the served version behave exactly as before. The
// native API is provided by desktop/preload.cjs.

import { makeProject, makeDemoProject, normalizeProject } from './model.js';
import { generateIno } from './codegen.js';

export function isDesktop() {
  return typeof window !== 'undefined' && !!window.ardustudioNative;
}

const native = () => window.ardustudioNative;

function projectFilename(project, ext) {
  const base = (project.name || 'project').replace(/[^A-Za-z0-9_-]+/g, '_') || 'project';
  return base + ext;
}

// Save the current project, prompting for a location on Save As (or when the
// project has never been saved). Returns true if a file was written.
export async function saveProjectNative(app, saveAs = false) {
  const text = JSON.stringify(app.project, null, 2);
  const res = await native().saveProject(text, projectFilename(app.project, '.ardustudio.json'), saveAs);
  return !!res;
}

export async function openProjectNative(app) {
  const res = await native().openProject();
  if (!res) return false;
  try {
    app.setProject(normalizeProject(JSON.parse(res.text)));
    return true;
  } catch (err) {
    await native().message('Could not open that project', err.message);
    return false;
  }
}

export async function exportSketchNative(app) {
  try {
    const { ino, warnings } = generateIno(app.project);
    const res = await native().exportSketch(ino, projectFilename(app.project, '.ino'));
    if (res && warnings.length) {
      await native().message('Sketch exported with warnings', warnings.join('\n'));
    }
    return !!res;
  } catch (err) {
    await native().message('Export failed', err.message);
    return false;
  }
}

// Wire the native File/Edit menu to the app.
export function initDesktop(app) {
  if (!isDesktop()) return;

  native().onMenu(async (command) => {
    switch (command) {
      case 'new':
        if (!confirm('Start a new blank project? Unsaved changes will be lost.')) return;
        app.setProject(makeProject());
        await native().forgetPath();
        break;
      case 'demo':
        if (!confirm('Load the Key Quest demo? Unsaved changes will be lost.')) return;
        app.setProject(makeDemoProject());
        await native().forgetPath();
        break;
      case 'open':
        await openProjectNative(app);
        break;
      case 'save':
        await saveProjectNative(app, false);
        break;
      case 'saveAs':
        await saveProjectNative(app, true);
        break;
      case 'exportIno':
        await exportSketchNative(app);
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
