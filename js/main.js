// ArduStudio entry point: app state, autosave, tab routing.

import { makeDemoProject, normalizeProject } from './model.js';
import { debounce } from './ui.js';
import { initSceneEditor } from './sceneEditor.js';
import { initTileEditor, initSpriteEditor } from './pixelEditor.js';
import { initImageTool } from './imageTool.js';
import { initPlayTab } from './playTab.js';
import { initExportTab } from './exportTab.js';
import { initHelpTab } from './helpTab.js';

const STORAGE_KEY = 'ardustudio.project.v1';

const app = {
  project: null,
  selectedSceneId: null,
  assetVersion: 0, // bumped on asset edits to invalidate thumbnail caches
  tabs: {},
  activeTab: 'scenes',

  save() {
    app.assetVersion++;
    persist();
    setStatus('saved');
  },
  saveSoon: null, // debounced save for drag-paint operations

  setProject(p) {
    app.project = p;
    app.selectedSceneId = p.scenes[0] && p.scenes[0].id;
    app.save();
    app.renderTopbar();
    refreshActive(true);
  },

  renderTopbar() {
    document.getElementById('projectName').textContent = app.project.name || 'Untitled';
  },
};

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
app.tabs.image = initImageTool(app);
app.tabs.play = initPlayTab(app);
app.tabs.export = initExportTab(app);
app.tabs.help = initHelpTab(app);

app.renderTopbar();

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
