// Export tab: project metadata, variable manager, sketch generation and
// project file save/load.

import { el, clear, download } from './ui.js';
import { makeProject, makeDemoProject, normalizeProject } from './model.js';
import { generateIno } from './codegen.js';

export function initExportTab(app) {
  const nameInput = document.getElementById('expName');
  const authorInput = document.getElementById('expAuthor');
  const statsSpan = document.getElementById('expStats');
  const warnBox = document.getElementById('expWarnings');

  nameInput.addEventListener('change', () => { app.project.name = nameInput.value; app.save(); app.renderTopbar(); });
  authorInput.addEventListener('change', () => { app.project.author = authorInput.value; app.save(); });

  function sketchFilename() {
    const base = (app.project.name || 'ArduStudioGame').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'ArduStudioGame';
    return base + '.ino';
  }

  function tryGenerate() {
    try {
      const { ino, compiled, warnings } = generateIno(app.project);
      const dataBytes = compiled.code.length +
        compiled.strings.reduce((n, s) => n + s.length + 1, 0) +
        compiled.tiles.length * 8 +
        compiled.sprites.reduce((n, s) => n + 2 + s.frames.length * s.frames[0].length, 0) +
        compiled.scenes.reduce((n, sc) => n + sc.tiles.length + 16, 0) +
        compiled.songs.reduce((n, sg) => n + sg.notes.length * 4 + 2, 0);
      statsSpan.textContent = `~${(dataBytes / 1024).toFixed(1)} KB game data · ${compiled.scenes.length} scenes · ${compiled.strings.length} strings · ${compiled.songs.length} songs`;
      warnBox.textContent = warnings.join('\n');
      return ino;
    } catch (err) {
      warnBox.textContent = 'Export failed: ' + err.message;
      statsSpan.textContent = '';
      return null;
    }
  }

  document.getElementById('expIno').addEventListener('click', () => {
    const ino = tryGenerate();
    if (ino) download(sketchFilename(), ino, 'text/x-arduino');
  });

  document.getElementById('expCopyIno').addEventListener('click', async () => {
    const ino = tryGenerate();
    if (!ino) return;
    try { await navigator.clipboard.writeText(ino); } catch { /* clipboard blocked */ }
  });

  document.getElementById('expSave').addEventListener('click', () => {
    const base = (app.project.name || 'project').replace(/[^A-Za-z0-9_-]+/g, '_');
    download(base + '.ardustudio.json', JSON.stringify(app.project, null, 2), 'application/json');
  });

  const loadFile = document.getElementById('expLoadFile');
  document.getElementById('expLoad').addEventListener('click', () => loadFile.click());
  loadFile.addEventListener('change', () => {
    const f = loadFile.files && loadFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = normalizeProject(JSON.parse(reader.result));
        app.setProject(p);
      } catch (err) {
        alert('Could not load project: ' + err.message);
      }
      loadFile.value = '';
    };
    reader.readAsText(f);
  });

  document.getElementById('expNew').addEventListener('click', () => {
    if (!confirm('Start a new blank project? The current project stays in your browser only if you saved it to a file.')) return;
    app.setProject(makeProject());
  });
  document.getElementById('expDemo').addEventListener('click', () => {
    if (!confirm('Load the Key Quest demo? This replaces the current project (save it to a file first if you want to keep it).')) return;
    app.setProject(makeDemoProject());
  });

  function renderPlayerSprite() {
    const sel = clear(document.getElementById('expPlayerSprite'));
    for (const s of app.project.sprites) {
      sel.append(el('option', { value: s.id, selected: app.project.settings.playerSpriteId === s.id }, s.name));
    }
    sel.onchange = () => { app.project.settings.playerSpriteId = sel.value; app.save(); };
  }

  function refresh() {
    nameInput.value = app.project.name || '';
    authorInput.value = app.project.author || '';
    renderPlayerSprite();
    tryGenerate();
  }

  return { refresh };
}
