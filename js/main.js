// ArduStudio entry point: app state, autosave, tab routing.

import { makeDemoProject, normalizeProject } from './model.js';
import { debounce } from './ui.js';
import { initSceneEditor } from './sceneEditor.js';
import { initTileEditor, initSpriteEditor } from './pixelEditor.js';
import { initImageTool } from './imageTool.js';
import { initAudioTab } from './audioTab.js';
import { initVariablesTab } from './variablesTab.js';
import { initPlayTab } from './playTab.js';
import { initExportTab } from './exportTab.js';
import { initHelpTab } from './helpTab.js';
import { initDesktop } from './desktop.js';
import { currentFileName, saveProject, openProject, isDesktop } from './fileio.js';

const STORAGE_KEY = 'ardustudio.project.v1';
const HISTORY_LIMIT = 100;

// Undo/redo: a bounded stack of project snapshots with a cursor.
// Every save() pushes a snapshot; drag operations are debounced through
// saveSoon(), so one paint stroke is one undo step.
const history = { states: [], idx: -1 };

const app = {
  project: null,
  selectedSceneId: null,
  assetVersion: 0, // bumped on asset edits to invalidate thumbnail caches
  tabs: {},
  activeTab: 'scenes',

  save() {
    app.assetVersion++;
    pushHistory();
    persist();
    setStatus('saved');
    updateUndoButtons();
  },
  saveSoon: null, // debounced save for drag-paint operations

  undo() {
    if (history.idx <= 0) return;
    history.idx--;
    restoreSnapshot(history.states[history.idx]);
  },

  redo() {
    if (history.idx >= history.states.length - 1) return;
    history.idx++;
    restoreSnapshot(history.states[history.idx]);
  },

  setProject(p) {
    app.project = p;
    app.selectedSceneId = p.scenes[0] && p.scenes[0].id;
    app.save();
    app.renderTopbar();
    refreshActive(true);
  },

  renderTopbar() {
    const file = currentFileName();
    document.getElementById('projectName').textContent =
      (app.project.name || 'Untitled') + (file ? ` — ${file}` : '');
  },
};

function pushHistory() {
  const snapshot = JSON.stringify(app.project);
  if (history.states[history.idx] === snapshot) return; // no actual change
  history.states.length = history.idx + 1; // drop any redo tail
  history.states.push(snapshot);
  if (history.states.length > HISTORY_LIMIT) history.states.shift();
  history.idx = history.states.length - 1;
}

function restoreSnapshot(snapshot) {
  app.project = normalizeProject(JSON.parse(snapshot));
  if (!app.project.scenes.some((s) => s.id === app.selectedSceneId)) {
    app.selectedSceneId = app.project.scenes[0] && app.project.scenes[0].id;
  }
  app.assetVersion++;
  persist();
  app.renderTopbar();
  refreshActive(true);
  updateUndoButtons();
  setStatus('saved');
}

function updateUndoButtons() {
  document.getElementById('undoBtn').disabled = history.idx <= 0;
  document.getElementById('redoBtn').disabled = history.idx >= history.states.length - 1;
}

function setStatus(state) {
  const s = document.getElementById('saveStatus');
  s.textContent = state === 'saved' ? '● saved' : '';
  if (state === 'saved') {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => { s.textContent = ''; }, 1200);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.project));
  } catch { /* storage full or unavailable — file save still works */ }
}

app.saveSoon = debounce(app.save, 400);

// ------------------------------------------------------------------ boot

function loadInitialProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeProject(JSON.parse(raw));
  } catch { /* fall through to demo */ }
  return makeDemoProject();
}

app.project = loadInitialProject();
app.selectedSceneId = app.project.scenes[0] && app.project.scenes[0].id;

app.tabs.scenes = initSceneEditor(app);
app.tabs.tiles = initTileEditor(app);
app.tabs.sprites = initSpriteEditor(app);
app.tabs.audio = initAudioTab(app);
app.tabs.variables = initVariablesTab(app);
app.tabs.image = initImageTool(app);
app.tabs.play = initPlayTab(app);
app.tabs.export = initExportTab(app);
app.tabs.help = initHelpTab(app);

app.renderTopbar();

// Seed undo history with the loaded state.
pushHistory();
updateUndoButtons();

document.getElementById('undoBtn').addEventListener('click', () => app.undo());
document.getElementById('redoBtn').addEventListener('click', () => app.redo());

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // let fields keep native undo
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
  else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); app.redo(); }
  else if (!isDesktop() && key === 's') { e.preventDefault(); saveProject(app, e.shiftKey); }
  else if (!isDesktop() && key === 'o') { e.preventDefault(); openProject(app); }
});

function refreshActive(force) {
  const tab = app.tabs[app.activeTab];
  if (tab && tab.refresh) tab.refresh(force);
}

document.querySelectorAll('#tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const prev = app.tabs[app.activeTab];
    if (prev && prev.suspend) prev.suspend();
    app.activeTab = btn.dataset.tab;
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${app.activeTab}`));
    refreshActive();
  });
});

refreshActive();

// Expose for debugging & tests.
window.__ardustudio = app;

// Native menus and file dialogs when running in the desktop shell; no-op in a browser.
initDesktop(app);
