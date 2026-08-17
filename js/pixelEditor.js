// 1-bit pixel editors for the Tiles and Sprites tabs.

import { el, clear, drawPixelsToCanvas } from './ui.js';
import {
  makeTile, makeSprite, makeSpriteState, blankPixels, getPixel, setPixel,
  MAX_TILES, MAX_SPRITES, MAX_FRAMES, MAX_SPRITE_STATES, sceneScripts, forEachEvent,
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
      // A tile painted nowhere is left out of the build to save flash; this
      // keeps one in anyway, for art you mean to use later.
      el('label', { title: 'Include in the exported game even if no scene paints it' },
        el('input', {
          type: 'checkbox', checked: !!tile.keep,
          onchange: (e) => { tile.keep = e.target.checked; app.save(); },
        }), ' Always include in build'),
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
            for (const { events } of sceneScripts(sc)) {
              forEachEvent(events, (ev) => {
                if (ev.type !== 'SET_TILE') return;
                if (ev.tileIndex === selected) ev.tileIndex = 0;
                else if (ev.tileIndex > selected) ev.tileIndex -= 1;
              });
            }
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
  let stateIdx = 0; // which animation state the preview is playing

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

  // Named frame ranges an actor can play, e.g. Idle = 0-1, Walk = 2-3. Every
  // sprite has a Default state, so Set Actor Animation State always has
  // something to offer.
  function statesPanel(spr) {
    const last = spr.frames.length - 1;
    const rows = el('div', {});
    spr.states.forEach((st, i) => {
      const range = (key) => el('input', {
        type: 'number', min: 0, max: last, value: st[key],
        style: 'width:52px',
        onchange: (e) => {
          st[key] = Math.max(0, Math.min(last, parseInt(e.target.value, 10) || 0));
          if (st.to < st.from) st.to = st.from;
          app.save();
          renderEditor();
        },
      });
      rows.append(el('div', {
        class: 'form-row' + (i === stateIdx ? ' state-active' : ''),
        onclick: () => { stateIdx = i; renderEditor(); },
      },
        el('input', {
          type: 'text', value: st.name, style: 'width:88px',
          onchange: (e) => { st.name = e.target.value || 'State'; app.save(); renderEditor(); },
        }),
        el('label', {}, 'from', range('from')),
        el('label', {}, 'to', range('to')),
        el('button', {
          class: 'mini', title: spr.states.length > 1 ? 'Delete state' : 'A sprite needs at least one state',
          disabled: spr.states.length <= 1,
          onclick: (e) => {
            e.stopPropagation();
            spr.states.splice(i, 1);
            stateIdx = Math.max(0, stateIdx - 1);
            app.save();
            renderEditor();
          },
        }, '✕'),
      ));
    });
    if (spr.states.length < MAX_SPRITE_STATES) {
      rows.append(el('button', {
        class: 'mini',
        onclick: () => {
          spr.states.push(makeSpriteState(`State ${spr.states.length + 1}`, 0, last));
          stateIdx = spr.states.length - 1;
          app.save();
          renderEditor();
        },
      }, '＋ Add state'));
    }
    return el('div', {},
      el('div', { class: 'hint' }, 'Animation states'),
      rows,
      el('p', { class: 'hint' }, 'A named range of frames that Set Actor Animation State can select.'));
  }

  function renderEditor() {
    const box = clear(document.getElementById('spriteEditor'));
    const spr = app.project.sprites[selected];
    if (!spr) return;
    if (frame >= spr.frames.length) frame = 0;

    // The preview plays whichever state is selected, so a range can be checked
    // without leaving the tab.
    if (stateIdx >= spr.states.length) stateIdx = 0;
    const state = spr.states[stateIdx];
    const preview = document.createElement('canvas');
    let previewStep = 0;
    const redrawPreview = () => {
      const span = state.to - state.from + 1;
      const f = state.from + (previewStep % span);
      drawPixelsToCanvas(preview, spr.frames[Math.min(f, spr.frames.length - 1)], spr.width, spr.height, 6);
    };
    if (app._sprAnim) clearInterval(app._sprAnim);
    app._sprAnim = setInterval(() => {
      if (!document.getElementById('spriteEditor').contains(preview)) { clearInterval(app._sprAnim); return; }
      previewStep++;
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
        onclick: () => {
          spr.frames.splice(frame, 1);
          frame = Math.max(0, frame - 1);
          const last = spr.frames.length - 1;
          for (const st of spr.states) {
            st.from = Math.min(st.from, last);
            st.to = Math.min(st.to, last);
          }
          app.save();
          renderEditor();
        },
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
      // Sprites no actor or script names are left out of the build; this keeps
      // one in anyway.
      el('label', { title: 'Include in the exported game even if nothing references it' },
        el('input', {
          type: 'checkbox', checked: !!spr.keep,
          onchange: (e) => { spr.keep = e.target.checked; app.save(); },
        }), ' Always include in build'),
      frameTabs,
      transformButtons(() => spr.frames[frame], spr.width, spr.height, () => { app.save(); grid.draw(); renderList(); }),
      statesPanel(spr),
      el('div', {}, el('div', { class: 'hint' }, `Preview — ${state.name}`), el('div', { class: 'preview-box' }, preview)),
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
