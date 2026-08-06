// 1-bit pixel editors for the Tiles and Sprites tabs.

import { el, clear, drawPixelsToCanvas } from './ui.js';
import {
  makeTile, makeSprite, blankPixels, getPixel, setPixel,
  MAX_TILES, MAX_SPRITES, MAX_FRAMES,
} from './model.js';

const EDIT_SCALE = 28;

// Generic pixel grid canvas with draw/erase drag.
function pixelGrid(pixelsRef, w, h, onEdit) {
  const canvas = el('canvas', { class: 'pixel-grid-wrap' });
  canvas.width = w * EDIT_SCALE;
  canvas.height = h * EDIT_SCALE;
  const ctx = canvas.getContext('2d');
  let drag = null; // 0 = erasing, 1 = drawing

  function draw() {
    const pixels = pixelsRef();
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d8ecff';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (getPixel(pixels, x, y)) {
          ctx.fillRect(x * EDIT_SCALE, y * EDIT_SCALE, EDIT_SCALE, EDIT_SCALE);
        }
      }
    }
    ctx.strokeStyle = 'rgba(120,150,190,0.25)';
    for (let x = 1; x < w; x++) { ctx.beginPath(); ctx.moveTo(x * EDIT_SCALE + 0.5, 0); ctx.lineTo(x * EDIT_SCALE + 0.5, canvas.height); ctx.stroke(); }
    for (let y = 1; y < h; y++) { ctx.beginPath(); ctx.moveTo(0, y * EDIT_SCALE + 0.5); ctx.lineTo(canvas.width, y * EDIT_SCALE + 0.5); ctx.stroke(); }
    if (w > 8 || h > 8) { // 8px guides for large sprites
      ctx.strokeStyle = 'rgba(77,195,255,0.4)';
      for (let x = 8; x < w; x += 8) { ctx.beginPath(); ctx.moveTo(x * EDIT_SCALE + 0.5, 0); ctx.lineTo(x * EDIT_SCALE + 0.5, canvas.height); ctx.stroke(); }
      for (let y = 8; y < h; y += 8) { ctx.beginPath(); ctx.moveTo(0, y * EDIT_SCALE + 0.5); ctx.lineTo(canvas.width, y * EDIT_SCALE + 0.5); ctx.stroke(); }
    }
  }

  const cellOf = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left) * (canvas.width / r.width) / EDIT_SCALE),
      y: Math.floor((e.clientY - r.top) * (canvas.height / r.height) / EDIT_SCALE),
    };
  };

  const apply = (e) => {
    const { x, y } = cellOf(e);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const pixels = pixelsRef();
    if (getPixel(pixels, x, y) !== drag) {
      setPixel(pixels, x, y, drag);
      onEdit();
      draw();
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = cellOf(e);
    drag = getPixel(pixelsRef(), x, y) ? 0 : 1;
    apply(e);
  });
  canvas.addEventListener('mousemove', (e) => { if (drag !== null) apply(e); });
  window.addEventListener('mouseup', () => { drag = null; });

  draw();
  return { canvas, draw };
}

function assetCell(active, thumbCanvas, caption, onclick) {
  return el('div', { class: 'asset-cell' + (active ? ' active' : ''), onclick },
    thumbCanvas, el('div', { class: 'cap' }, caption));
}

function transformButtons(getPixels, w, h, after) {
  const t = (fn) => () => { fn(); after(); };
  const remap = (mapper) => {
    const src = getPixels().slice();
    const out = blankPixels(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [sx, sy] = mapper(x, y);
      setPixel(out, x, y, getPixel(src, sx, sy));
    }
    const dst = getPixels();
    for (let i = 0; i < h; i++) dst[i] = out[i];
  };
  return el('div', { class: 'tool-row' },
    el('button', { class: 'tool', title: 'Flip horizontally', onclick: t(() => remap((x, y) => [w - 1 - x, y])) }, '⇄'),
    el('button', { class: 'tool', title: 'Flip vertically', onclick: t(() => remap((x, y) => [x, h - 1 - y])) }, '⇅'),
    el('button', { class: 'tool', title: 'Shift left', onclick: t(() => remap((x, y) => [(x + 1) % w, y])) }, '←'),
    el('button', { class: 'tool', title: 'Shift right', onclick: t(() => remap((x, y) => [(x - 1 + w) % w, y])) }, '→'),
    el('button', { class: 'tool', title: 'Shift up', onclick: t(() => remap((x, y) => [x, (y + 1) % h])) }, '↑'),
    el('button', { class: 'tool', title: 'Shift down', onclick: t(() => remap((x, y) => [x, (y - 1 + h) % h])) }, '↓'),
    el('button', { class: 'tool', title: 'Invert', onclick: t(() => {
      const p = getPixels();
      for (let i = 0; i < h; i++) p[i] = p[i].split('').map((c) => (c === '#' ? '.' : '#')).join('');
    }) }, '◐'),
    el('button', { class: 'tool', title: 'Clear', onclick: t(() => { const p = getPixels(); for (let i = 0; i < h; i++) p[i] = '.'.repeat(w); }) }, '⌫'),
  );
}

// --------------------------------------------------------------- tiles tab

export function initTileEditor(app) {
  let selected = 0;

  function refresh() {
    renderList();
    renderEditor();
  }

  document.getElementById('addTile').addEventListener('click', () => {
    if (app.project.tiles.length >= MAX_TILES) { alert(`Max ${MAX_TILES} tiles`); return; }
    app.project.tiles.push(makeTile(`Tile ${app.project.tiles.length}`, blankPixels(8, 8)));
    selected = app.project.tiles.length - 1;
    app.save();
    refresh();
  });

  function renderList() {
    const list = clear(document.getElementById('tileList'));
    app.project.tiles.forEach((t, i) => {
      const thumb = drawPixelsToCanvas(document.createElement('canvas'), t.pixels, 8, 8, 5);
      list.append(assetCell(i === selected, thumb, `${i} ${t.name}${t.solid ? ' ■' : ''}`, () => {
        selected = i;
        refresh();
      }));
    });
  }

  function renderEditor() {
    const box = clear(document.getElementById('tileEditor'));
    const tile = app.project.tiles[selected];
    if (!tile) return;

    const preview = document.createElement('canvas');
    const redrawPreview = () => drawPixelsToCanvas(preview, tile.pixels, 8, 8, 6);
    const grid = pixelGrid(() => tile.pixels, 8, 8, () => { app.saveSoon(); redrawPreview(); renderList(); });
    redrawPreview();

    const side = el('div', { class: 'pixel-side' },
      el('label', {}, 'Name ', el('input', {
        type: 'text', value: tile.name,
        onchange: (e) => { tile.name = e.target.value; app.save(); renderList(); },
      })),
      el('label', {}, el('input', {
        type: 'checkbox', checked: tile.solid,
        onchange: (e) => { tile.solid = e.target.checked; app.save(); renderList(); },
      }), ' Solid (blocks walking)'),
      transformButtons(() => tile.pixels, 8, 8, () => { app.save(); grid.draw(); redrawPreview(); renderList(); }),
      el('div', {}, el('div', { class: 'hint' }, 'Preview (1×… well, 6×)'), el('div', { class: 'preview-box' }, preview)),
      el('button', {
        class: 'btn', onclick: () => {
          if (app.project.tiles.length >= MAX_TILES) return;
          const copy = makeTile(tile.name + ' copy', tile.pixels.slice(), tile.solid);
          app.project.tiles.splice(selected + 1, 0, copy);
          selected += 1;
          app.save();
          refresh();
        },
      }, 'Duplicate'),
      el('button', {
        class: 'btn danger', onclick: () => {
          if (app.project.tiles.length <= 1) { alert('Need at least one tile'); return; }
          if (!confirm(`Delete tile "${tile.name}"? Scene cells using it become tile 0; later tiles shift down.`)) return;
          app.project.tiles.splice(selected, 1);
          for (const sc of app.project.scenes) {
            sc.tiles = sc.tiles.map((v) => (v === selected ? 0 : v > selected ? v - 1 : v));
            // fix SET_TILE events pointing at shifted indices
            const fixEvents = (evs) => {
              for (const ev of evs) {
                if (ev.type === 'SET_TILE') {
                  if (ev.tileIndex === selected) ev.tileIndex = 0;
                  else if (ev.tileIndex > selected) ev.tileIndex -= 1;
                }
                if (ev.type === 'IF_VAR') { fixEvents(ev.then); fixEvents(ev.else); }
              }
            };
            fixEvents(sc.onEnter);
            sc.actors.forEach((a) => fixEvents(a.script));
            sc.triggers.forEach((t) => fixEvents(t.script));
          }
          selected = Math.max(0, selected - 1);
          app.save();
          refresh();
        },
      }, 'Delete tile'),
    );

    box.append(el('div', { class: 'pixel-editor' }, grid.canvas, side));
  }

  return { refresh };
}

// -------------------------------------------------------------- sprites tab

export function initSpriteEditor(app) {
  let selected = 0;
  let frame = 0;

  function refresh() {
    frame = 0;
    renderList();
    renderEditor();
  }

  document.getElementById('addSprite').addEventListener('click', () => {
    if (app.project.sprites.length >= MAX_SPRITES) { alert(`Max ${MAX_SPRITES} sprites`); return; }
    app.project.sprites.push(makeSprite(`Sprite ${app.project.sprites.length}`, [blankPixels(8, 8)]));
    selected = app.project.sprites.length - 1;
    app.save();
    refresh();
  });

  function renderList() {
    const list = clear(document.getElementById('spriteList'));
    app.project.sprites.forEach((s, i) => {
      const thumb = drawPixelsToCanvas(document.createElement('canvas'), s.frames[0], s.width, s.height, Math.max(2, Math.floor(40 / s.width)));
      list.append(assetCell(i === selected, thumb, s.name, () => {
        selected = i;
        refresh();
      }));
    });
  }

  function renderEditor() {
    const box = clear(document.getElementById('spriteEditor'));
    const spr = app.project.sprites[selected];
    if (!spr) return;
    if (frame >= spr.frames.length) frame = 0;

    const preview = document.createElement('canvas');
    let previewFrame = 0;
    const redrawPreview = () => drawPixelsToCanvas(preview, spr.frames[previewFrame % spr.frames.length], spr.width, spr.height, 6);
    if (app._sprAnim) clearInterval(app._sprAnim);
    app._sprAnim = setInterval(() => {
      if (!document.getElementById('spriteEditor').contains(preview)) { clearInterval(app._sprAnim); return; }
      previewFrame++;
      redrawPreview();
    }, 333);

    const grid = pixelGrid(() => spr.frames[frame], spr.width, spr.height, () => { app.saveSoon(); renderList(); });

    const frameTabs = el('div', { class: 'frame-tabs' });
    spr.frames.forEach((_, i) => {
      frameTabs.append(el('button', {
        class: 'mini' + (i === frame ? ' active' : ''),
        onclick: () => { frame = i; renderEditor(); },
      }, `Frame ${i + 1}`));
    });
    if (spr.frames.length < MAX_FRAMES) {
      frameTabs.append(el('button', {
        class: 'mini', title: 'Add frame (copies current)',
        onclick: () => { spr.frames.push(spr.frames[frame].slice()); frame = spr.frames.length - 1; app.save(); renderEditor(); },
      }, '＋'));
    }
    if (spr.frames.length > 1) {
      frameTabs.append(el('button', {
        class: 'mini', title: 'Delete current frame',
        onclick: () => { spr.frames.splice(frame, 1); frame = Math.max(0, frame - 1); app.save(); renderEditor(); },
      }, '－'));
    }

    const sizeSel = el('select', {
      onchange: () => {
        const [w, h] = sizeSel.value.split('x').map(Number);
        resizeSprite(spr, w, h);
        app.save();
        renderEditor();
        renderList();
      },
    });
    for (const s of ['8x8', '16x8', '8x16', '16x16']) {
      sizeSel.append(el('option', { value: s, selected: `${spr.width}x${spr.height}` === s }, s));
    }

    const side = el('div', { class: 'pixel-side' },
      el('label', {}, 'Name ', el('input', {
        type: 'text', value: spr.name,
        onchange: (e) => { spr.name = e.target.value; app.save(); renderList(); },
      })),
      el('label', {}, 'Size ', sizeSel),
      frameTabs,
      transformButtons(() => spr.frames[frame], spr.width, spr.height, () => { app.save(); grid.draw(); renderList(); }),
      el('div', {}, el('div', { class: 'hint' }, 'Animation preview'), el('div', { class: 'preview-box' }, preview)),
      el('button', {
        class: 'btn danger', onclick: () => {
          if (app.project.sprites.length <= 1) { alert('Need at least one sprite'); return; }
          if (!confirm(`Delete sprite "${spr.name}"? Actors using it fall back to the first sprite.`)) return;
          const deletedId = spr.id;
          app.project.sprites.splice(selected, 1);
          const fallback = app.project.sprites[0].id;
          for (const sc of app.project.scenes) {
            for (const a of sc.actors) if (a.spriteId === deletedId) a.spriteId = fallback;
          }
          if (app.project.settings.playerSpriteId === deletedId) app.project.settings.playerSpriteId = fallback;
          selected = Math.max(0, selected - 1);
          app.save();
          refresh();
        },
      }, 'Delete sprite'),
    );

    box.append(el('div', { class: 'pixel-editor' }, grid.canvas, side));
    redrawPreview();
  }

  function resizeSprite(spr, w, h) {
    spr.frames = spr.frames.map((f) => {
      const out = blankPixels(w, h);
      for (let y = 0; y < Math.min(h, spr.height); y++) {
        for (let x = 0; x < Math.min(w, spr.width); x++) {
          setPixel(out, x, y, getPixel(f, x, y));
        }
      }
      return out;
    });
    spr.width = w;
    spr.height = h;
  }

  return { refresh };
}
