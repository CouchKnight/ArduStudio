// Project file I/O with three tiers, best first:
//
//   1. Electron  — window.ardustudioNative, real OS dialogs via the main process.
//   2. File System Access API — window.showSaveFilePicker / showOpenFilePicker.
//      Chrome and Edge expose these even on file:// pages (a file:// document is
//      a secure context), so the portable single-file build gets real native
//      Save/Open dialogs with no packaging at all. Keeping the returned handle
//      makes "Save" overwrite in place, exactly like a desktop app.
//   3. Fallback  — download() + a hidden <input type="file">, for Firefox and
//      anything older.
//
// Everything below degrades silently, so the same code serves all three.

import { download } from './ui.js';
import { normalizeProject } from './model.js';
import { generateIno } from './codegen.js';

// The file the project was last opened from or saved to (tier 2 only).
let currentHandle = null;
let currentName = null;

export function currentFileName() { return currentName; }

export function isDesktop() {
  return typeof window !== 'undefined' && !!window.ardustudioNative;
}

export function hasFilePicker() {
  return typeof window !== 'undefined'
    && typeof window.showSaveFilePicker === 'function'
    && typeof window.showOpenFilePicker === 'function';
}

// Which mechanism is in use — surfaced in the UI so it is obvious where files go.
export function ioMode() {
  if (isDesktop()) return 'desktop';
  if (hasFilePicker()) return 'picker';
  return 'download';
}

export function forgetFile() {
  currentHandle = null;
  currentName = null;
}

function baseName(project, ext) {
  const base = (project.name || 'project').replace(/[^A-Za-z0-9_-]+/g, '_') || 'project';
  return base + ext;
}

const PROJECT_TYPES = [{
  description: 'ArduStudio project',
  accept: { 'application/json': ['.json', '.ardustudio'] },
}];

// A picker call the user dismissed is not an error worth reporting.
function isAbort(err) {
  return err && (err.name === 'AbortError' || err.name === 'NotAllowedError');
}

async function ensureWritable(handle) {
  if (!handle.queryPermission) return true;
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

// ---------------------------------------------------------------- save / open

// Returns true when a file was actually written.
export async function saveProject(app, saveAs = false) {
  const text = JSON.stringify(app.project, null, 2);
  const suggested = baseName(app.project, '.ardustudio.json');

  if (isDesktop()) {
    return !!(await window.ardustudioNative.saveProject(text, suggested, saveAs));
  }

  if (hasFilePicker()) {
    try {
      let handle = (!saveAs && currentHandle) ? currentHandle : null;
      if (!handle) {
        handle = await window.showSaveFilePicker({ suggestedName: suggested, types: PROJECT_TYPES });
      }
      if (!(await ensureWritable(handle))) return false;
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      currentHandle = handle;
      currentName = handle.name;
      app.renderTopbar();
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
      alert('Could not save: ' + err.message);
      return false;
    }
  }

  download(suggested, text, 'application/json');
  return true;
}

// Returns true when a project was loaded.
export async function openProject(app) {
  if (isDesktop()) {
    const res = await window.ardustudioNative.openProject();
    if (!res) return false;
    try {
      app.setProject(normalizeProject(JSON.parse(res.text)));
      return true;
    } catch (err) {
      await window.ardustudioNative.message('Could not open that project', err.message);
      return false;
    }
  }

  if (hasFilePicker()) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PROJECT_TYPES, multiple: false });
      const text = await (await handle.getFile()).text();
      app.setProject(normalizeProject(JSON.parse(text)));
      currentHandle = handle;
      currentName = handle.name;
      app.renderTopbar();
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
      alert('Could not open that project: ' + err.message);
      return false;
    }
  }

  return false; // caller falls back to the hidden file input
}

export async function exportSketch(app) {
  let ino, warnings;
  try {
    ({ ino, warnings } = generateIno(app.project));
  } catch (err) {
    alert('Export failed: ' + err.message);
    return false;
  }
  const suggested = baseName(app.project, '.ino');

  if (isDesktop()) {
    const res = await window.ardustudioNative.exportSketch(ino, suggested);
    if (res && warnings.length) {
      await window.ardustudioNative.message('Sketch exported with warnings', warnings.join('\n'));
    }
    return !!res;
  }

  if (hasFilePicker()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'Arduino sketch', accept: { 'text/plain': ['.ino'] } }],
      });
      if (!(await ensureWritable(handle))) return false;
      const w = await handle.createWritable();
      await w.write(ino);
      await w.close();
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
      alert('Could not export: ' + err.message);
      return false;
    }
  }

  download(suggested, ino, 'text/x-arduino');
  return true;
}
