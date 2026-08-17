// Export tab: project metadata, variable manager, sketch generation and
// project file save/load.

import { el, clear, download } from './ui.js';
import { makeProject, makeDemoProject, normalizeProject } from './model.js';
import { generateIno } from './codegen.js';
import { compileProject } from './compiler.js';
import { Emulator } from './emulator.js';
import { saveProject, openProject, exportSketch, ioMode } from './fileio.js';
import {
  ARDUBOY_GENRES, buildArduboyPackage, packageBaseName, packageProblem,
  renderBanner, validateHex,
} from './arduboyPackage.js';

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

  // --------------------------------------------------------- the flash budget
  //
  // A game that overruns the Arduboy's 28 KB only finds out at the Arduino IDE,
  // which is far too late and says nothing about what to cut. The compiler
  // returns a measured estimate and a breakdown; this shows both, with the
  // detail folded away until it is wanted.
  const budgetBox = document.querySelector('.budget');
  const budgetLabel = document.getElementById('expBudgetLabel');
  const budgetNum = document.getElementById('expBudgetNum');
  const budgetFill = document.getElementById('expBudgetFill');
  const budgetNote = document.getElementById('expBudgetNote');
  const budgetBody = document.getElementById('expBudgetBody');
  const budgetDetails = document.getElementById('expBudgetDetails');
  const pruneToggle = document.getElementById('expPrune');
  const minimalBootToggle = document.getElementById('expMinimalBoot');

  // Whether the detail is open is a preference, so it survives a reload.
  const DETAILS_KEY = 'ardustudio.budgetOpen';
  try { budgetDetails.open = localStorage.getItem(DETAILS_KEY) === '1'; } catch { /* private mode */ }
  budgetDetails.addEventListener('toggle', () => {
    try { localStorage.setItem(DETAILS_KEY, budgetDetails.open ? '1' : '0'); } catch { /* ignore */ }
  });

  pruneToggle.addEventListener('change', () => {
    app.project.settings.pruneUnused = pruneToggle.checked;
    app.save();
    tryGenerate();
  });

  minimalBootToggle.addEventListener('change', () => {
    app.project.settings.minimalBoot = minimalBootToggle.checked;
    app.save();
    tryGenerate();
  });

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  function renderBudget(flash, pruned, pruning) {
    const pct = Math.min(100, Math.round((flash.total / flash.budget) * 100));
    const over = flash.total > flash.budget;
    budgetBox.classList.toggle('over', over);
    budgetLabel.textContent = over ? '⚠ Over the flash budget' : 'Flash';
    budgetNum.textContent = `${flash.total.toLocaleString()} of ${flash.budget.toLocaleString()} bytes (${pct}%)`;
    budgetFill.style.width = `${pct}%`;
    budgetNote.textContent = over
      ? `${flash.over.toLocaleString()} bytes too big — the Arduino IDE will refuse to upload this. Open the breakdown below to see what is costing the most.`
      : `${(flash.budget - flash.total).toLocaleString()} bytes to spare. This is an estimate; the Arduino IDE has the last word.`;

    clear(budgetBody);
    const table = el('table');
    const row = (name, bytes, cls) => table.append(el('tr', { class: cls || '' },
      el('td', {}, name), el('td', { class: 'num' }, bytes == null ? '' : `${bytes.toLocaleString()} B`)));

    row('Engine (always present)', flash.baseline);
    if (flash.subsystems.length) {
      row('Optional subsystems', flash.subsystemBytes, 'group');
      for (const s of flash.subsystems) {
        // A zero-cost subsystem is one whose code the engine always carries;
        // saying so is more honest than listing it as free.
        const label = s.bytes > 0
          ? `  ${s.name} — from ${s.from.slice(0, 2).join(', ')}`
          : `  ${s.name} — always included`;
        row(label, s.bytes);
      }
    }
    if (flash.opcodeBytes > 0) {
      row(`Event handlers (${flash.opcodeCount} kinds used)`, flash.opcodeBytes, 'group');
    }
    for (const x of flash.extras) row(x.name, x.bytes, 'group');
    row('Your game', flash.dataBytes, 'group');
    for (const [name, bytes] of Object.entries(flash.data)) {
      if (bytes > 0) row(`  ${name}`, bytes);
    }
    row('Safety margin', flash.margin, 'group');
    budgetBody.append(table);
    budgetBody.append(el('p', { class: 'hint' },
      'The engine only carries the parts your game scripts, so these numbers move '
      + 'as you build. The margin covers what the pieces cost together rather than '
      + 'apart, which keeps the estimate on the high side of a real build.'));

    const dropped = pruned.tiles.length + pruned.sprites.length + pruned.songs.length;
    if (!pruning) {
      budgetBody.append(el('p', { class: 'hint' },
        'Pruning is off, so every tile, sprite and song ships whether the game reaches it or not.'));
    } else if (dropped) {
      const parts = [];
      if (pruned.tiles.length) parts.push(`${pruned.tiles.length} tile${pruned.tiles.length === 1 ? '' : 's'}`);
      if (pruned.sprites.length) parts.push(`${pruned.sprites.length} sprite${pruned.sprites.length === 1 ? '' : 's'}`);
      if (pruned.songs.length) parts.push(`${pruned.songs.length} song${pruned.songs.length === 1 ? '' : 's'}`);
      budgetBody.append(el('p', { class: 'hint' },
        `Left out of the build because nothing references them: ${parts.join(', ')} — `
        + `${[...pruned.tiles, ...pruned.sprites, ...pruned.songs].join(', ')}. `
        + 'They are still in your project; tick "Always include" on one to keep it.'));
    }
  }

  function tryGenerate() {
    try {
      const { ino, compiled, warnings } = generateIno(app.project);
      statsSpan.textContent = `${compiled.scenes.length} scenes · ${compiled.strings.length} strings · ${compiled.songs.length} songs · ${kb(compiled.flash.dataBytes)} of game data`;
      renderBudget(compiled.flash, compiled.pruned, compiled.pruning);
      warnBox.textContent = warnings.join('\n');
      return ino;
    } catch (err) {
      warnBox.textContent = 'Export failed: ' + err.message;
      statsSpan.textContent = '';
      return null;
    }
  }

  // fileio picks the best available mechanism: Electron dialogs, the browser's
  // native file picker (Chrome/Edge, including file://), or a plain download.
  document.getElementById('expIno').addEventListener('click', async () => {
    tryGenerate();          // refresh stats / warnings
    await exportSketch(app);
  });

  document.getElementById('expCopyIno').addEventListener('click', async () => {
    const ino = tryGenerate();
    if (!ino) return;
    try { await navigator.clipboard.writeText(ino); } catch { /* clipboard blocked */ }
  });

  // --------------------------------------------------------- .arduboy package
  //
  // The browser cannot run avr-gcc, so the binary has to come from the user's
  // Arduino IDE build. Everything else — metadata, banner, the zip — happens
  // here.
  let hexText = null;      // the compiled binary the user picked
  let hexName = '';
  let customBanner = null; // a PNG the user supplied instead of the generated one

  const pkgStatus = document.getElementById('expPkgStatus');
  const hexStatus = document.getElementById('expHexStatus');
  const bannerCanvas = document.getElementById('expBanner');

  const genreSel = document.getElementById('expGenre');
  for (const g of ARDUBOY_GENRES) genreSel.append(el('option', { value: g }, g));

  const versionInput = document.getElementById('expVersion');
  const descInput = document.getElementById('expDescription');
  versionInput.addEventListener('change', () => {
    app.project.settings.version = versionInput.value.trim();
    app.save();
  });
  genreSel.addEventListener('change', () => { app.project.settings.genre = genreSel.value; app.save(); });
  descInput.addEventListener('change', () => { app.project.settings.description = descInput.value; app.save(); });

  // Paint whatever the banner currently is into the preview canvas.
  function showBanner(pngBytes) {
    const ctx = bannerCanvas.getContext('2d');
    const img = new Image();
    const url = URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));
    img.onload = () => {
      ctx.clearRect(0, 0, 128, 64);
      ctx.drawImage(img, 0, 0, 128, 64);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // The generated banner is the game's own opening screen, so it has to be
  // re-rendered whenever the project changes rather than cached.
  function currentBanner() {
    if (customBanner) return customBanner;
    try {
      return renderBanner(compileProject(app.project), Emulator);
    } catch {
      return null; // a project that will not compile has bigger problems
    }
  }

  function refreshBanner() {
    const png = currentBanner();
    if (png) showBanner(png);
  }

  const hexFile = document.getElementById('expHexFile');
  document.getElementById('expPickHex').addEventListener('click', () => hexFile.click());
  hexFile.addEventListener('change', () => {
    const f = hexFile.files && hexFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const check = validateHex(text);
      if (!check.ok) {
        hexText = null;
        hexStatus.textContent = `⚠ ${f.name}: ${check.error}`;
        hexStatus.classList.add('warn-text');
      } else {
        hexText = text;
        hexName = f.name;
        hexStatus.textContent = `${f.name} — ${(check.bytes / 1024).toFixed(1)} KB of flash`;
        hexStatus.classList.remove('warn-text');
      }
      hexFile.value = '';
    };
    reader.readAsText(f);
  });

  const bannerFile = document.getElementById('expBannerFile');
  document.getElementById('expPickBanner').addEventListener('click', () => bannerFile.click());
  bannerFile.addEventListener('change', () => {
    const f = bannerFile.files && bannerFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      customBanner = new Uint8Array(reader.result);
      showBanner(customBanner);
      bannerFile.value = '';
    };
    reader.readAsArrayBuffer(f);
  });
  document.getElementById('expResetBanner').addEventListener('click', () => {
    customBanner = null;
    refreshBanner();
  });

  document.getElementById('expArduboy').addEventListener('click', () => {
    pkgStatus.classList.remove('warn-text');
    const problem = packageProblem(app.project);
    if (problem) {
      pkgStatus.textContent = `⚠ ${problem}`;
      pkgStatus.classList.add('warn-text');
      return;
    }
    if (!hexText) {
      pkgStatus.textContent = '⚠ Choose the compiled .hex first — see the note above.';
      pkgStatus.classList.add('warn-text');
      return;
    }
    try {
      const compiled = compileProject(app.project);
      const bytes = buildArduboyPackage({
        project: app.project,
        compiled,
        hex: hexText,
        banner: currentBanner(),
      });
      download(`${packageBaseName(app.project)}.arduboy`, bytes, 'application/octet-stream');
      pkgStatus.textContent = `Exported ${(bytes.length / 1024).toFixed(1)} KB from ${hexName}.`;
    } catch (err) {
      pkgStatus.textContent = `⚠ ${err.message}`;
      pkgStatus.classList.add('warn-text');
    }
  });

  document.getElementById('expSave').addEventListener('click', () => saveProject(app, false));
  document.getElementById('expSaveAs').addEventListener('click', () => saveProject(app, true));

  const loadFile = document.getElementById('expLoadFile');
  document.getElementById('expLoad').addEventListener('click', async () => {
    // openProject returns false when no picker is available; fall back to the input.
    if (!(await openProject(app))) loadFile.click();
  });
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

  function renderIoHint() {
    const box = document.getElementById('expIoHint');
    if (!box) return;
    const mode = ioMode();
    box.textContent = mode === 'desktop'
      ? 'Desktop app: Save and Open use native dialogs (also on the File menu).'
      : mode === 'picker'
        ? 'Your browser supports native file dialogs — Save writes straight back to the same file.'
        : 'This browser has no file-picker API, so Save downloads a file and Open uses a file chooser.';
  }

  function refresh() {
    renderIoHint();
    nameInput.value = app.project.name || '';
    authorInput.value = app.project.author || '';
    pruneToggle.checked = app.project.settings.pruneUnused !== false;
    minimalBootToggle.checked = app.project.settings.minimalBoot !== false;
    versionInput.value = app.project.settings.version || '';
    genreSel.value = app.project.settings.genre || 'Misc';
    descInput.value = app.project.settings.description || '';
    renderPlayerSprite();
    tryGenerate();
    refreshBanner();
  }

  return { refresh };
}
