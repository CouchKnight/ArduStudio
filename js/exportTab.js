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
    versionInput.value = app.project.settings.version || '';
    genreSel.value = app.project.settings.genre || 'Misc';
    descInput.value = app.project.settings.description || '';
    renderPlayerSprite();
    tryGenerate();
    refreshBanner();
  }

  return { refresh };
}
