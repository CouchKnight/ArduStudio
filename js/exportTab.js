// Export tab: project metadata, variable manager, sketch generation and
// project file save/load.

import { el, clear, download } from './ui.js';
import { uid, MAX_VARIABLES, makeProject, makeDemoProject, normalizeProject } from './model.js';
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
        compiled.scenes.length * (128 + 16);
      statsSpan.textContent = `~${(dataBytes / 1024).toFixed(1)} KB game data · ${compiled.scenes.length} scenes · ${compiled.strings.length} strings · fits ATmega32u4 easily`;
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

  function renderVarEditor() {
    const box = clear(document.getElementById('varEditor'));
    const table = el('div', {});
    app.project.variables.forEach((v, i) => {
      table.append(el('div', { class: 'form-row' },
        el('span', { class: 'hint', style: 'width:24px' }, `#${i}`),
        el('input', {
          type: 'text', value: v.name,
          onchange: (e) => { v.name = e.target.value.replace(/[^A-Za-z0-9_]+/g, '_') || `var_${i}`; app.save(); renderVarEditor(); },
        }),
        el('button', {
          class: 'mini', title: 'Delete variable',
          onclick: () => {
            if (!confirm(`Delete variable "${v.name}"? Events using it will be skipped at export.`)) return;
            app.project.variables.splice(i, 1);
            app.save();
            renderVarEditor();
          },
        }, '✕'),
      ));
    });
    if (app.project.variables.length < MAX_VARIABLES) {
      table.append(el('button', {
        class: 'btn',
        onclick: () => {
          app.project.variables.push({ id: uid('var'), name: `var_${app.project.variables.length}` });
          app.save();
          renderVarEditor();
        },
      }, '＋ Add variable'));
    }
    box.append(table);
  }

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
    renderVarEditor();
    renderPlayerSprite();
    tryGenerate();
  }

  return { refresh };
}
