// Scene editor: paint tiles, place actors, drag trigger areas, set the
// player start, and edit the selected entity (including its script) in the
// right-hand inspector.

import { el, clear, drawPixelsToCanvas } from './ui.js';
import {
  SCENE_W, SCENE_H, MAX_SCREENS, makeScene, makeActor, makeTrigger,
  sceneById, spriteById, sceneCols, sceneRows, resizeScene,
  MAX_ACTORS_PER_SCENE, MAX_TRIGGERS_PER_SCENE,
} from './model.js';
import { renderScriptEditor } from './scriptEditor.js';

// Canvas pixels per game pixel. Larger (scrolling) scenes zoom out so the
// whole map stays visible in the editor.
function zoomFor(scene) {
  const span = Math.max(scene.screensX || 1, scene.screensY || 1);
  return span >= 3 ? 2 : span === 2 ? 3 : 4;
}

export function initSceneEditor(app) {
  const canvas = document.getElementById('sceneCanvas');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('sceneStatus');

  const st = {
    tool: 'paint',
    paintTile: 1,
    selected: null,      // { kind: 'actor'|'trigger', id } or null (scene itself)
    drag: null,          // painting / trigger-drag / move state
    hoverX: -1, hoverY: -1,
  };
  app.sceneEditorState = st;

  const scene = () => sceneById(app.project, app.selectedSceneId) || app.project.scenes[0];

  // ------------------------------------------------------------ tool row
  document.querySelectorAll('#sceneTools .tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sceneTools .tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      st.tool = btn.dataset.tool;
      if (st.tool !== 'select') st.selected = null;
      refresh();
    });
  });

  document.getElementById('addScene').addEventListener('click', () => {
    const sc = makeScene(`Scene ${app.project.scenes.length + 1}`);
    // start with a wall border so the player can't walk off
    const wallIdx = app.project.tiles.findIndex((t) => t.solid);
    if (wallIdx > 0) {
      const cw = sceneCols(sc), ch = sceneRows(sc);
      for (let x = 0; x < cw; x++) { sc.tiles[x] = wallIdx; sc.tiles[(ch - 1) * cw + x] = wallIdx; }
      for (let y = 0; y < ch; y++) { sc.tiles[y * cw] = wallIdx; sc.tiles[y * cw + cw - 1] = wallIdx; }
    }
    app.project.scenes.push(sc);
    app.selectedSceneId = sc.id;
    app.save();
    refresh();
  });

  // ------------------------------------------------------------ mouse
  const cellFromEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    const sc = scene();
    const cell = 8 * zoomFor(sc);
    const x = Math.floor((e.clientX - r.left) * (canvas.width / r.width) / cell);
    const y = Math.floor((e.clientY - r.top) * (canvas.height / r.height) / cell);
    return { x: Math.max(0, Math.min(sceneCols(sc) - 1, x)), y: Math.max(0, Math.min(sceneRows(sc) - 1, y)) };
  };

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = cellFromEvent(e);
    const sc = scene();
    if (!sc) return;
    if (st.tool === 'paint' || st.tool === 'erase') {
      st.drag = { kind: 'paint' };
      paintCell(sc, x, y);
    } else if (st.tool === 'actor') {
      if (sc.actors.length >= MAX_ACTORS_PER_SCENE) { flash(`Max ${MAX_ACTORS_PER_SCENE} actors per scene`); return; }
      const sprite = app.project.sprites[1] || app.project.sprites[0];
      const actor = makeActor(`Actor ${sc.actors.length + 1}`, sprite ? sprite.id : '', x, y);
      sc.actors.push(actor);
      st.selected = { kind: 'actor', id: actor.id };
      setTool('select');
      app.save();
      refresh();
    } else if (st.tool === 'trigger') {
      if (sc.triggers.length >= MAX_TRIGGERS_PER_SCENE) { flash(`Max ${MAX_TRIGGERS_PER_SCENE} triggers per scene`); return; }
      st.drag = { kind: 'trigger', x0: x, y0: y, x1: x, y1: y };
      draw();
    } else if (st.tool === 'start') {
      app.project.settings.startSceneId = sc.id;
      app.project.settings.startX = x;
      app.project.settings.startY = y;
      app.save();
      refresh();
      flash(`Player start set to (${x}, ${y}) in "${sc.name}"`);
    } else if (st.tool === 'select') {
      const actor = sc.actors.find((a) => a.x === x && a.y === y);
      const trig = sc.triggers.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
      if (actor) {
        st.selected = { kind: 'actor', id: actor.id };
        st.drag = { kind: 'move-actor', id: actor.id };
      } else if (trig) {
        st.selected = { kind: 'trigger', id: trig.id };
        st.drag = { kind: 'move-trigger', id: trig.id, offX: x - trig.x, offY: y - trig.y };
      } else {
        st.selected = null;
      }
      refresh();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = cellFromEvent(e);
    st.hoverX = x; st.hoverY = y;
    status.textContent = `(${x}, ${y})`;
    const sc = scene();
    if (!sc || !st.drag) { draw(); return; }
    if (st.drag.kind === 'paint') paintCell(sc, x, y);
    else if (st.drag.kind === 'trigger') { st.drag.x1 = x; st.drag.y1 = y; draw(); }
    else if (st.drag.kind === 'move-actor') {
      const a = sc.actors.find((a2) => a2.id === st.drag.id);
      if (a && (a.x !== x || a.y !== y)) { a.x = x; a.y = y; app.saveSoon(); draw(); }
    } else if (st.drag.kind === 'move-trigger') {
      const t = sc.triggers.find((t2) => t2.id === st.drag.id);
      if (t) {
        t.x = Math.max(0, Math.min(sceneCols(sc) - t.w, x - st.drag.offX));
        t.y = Math.max(0, Math.min(sceneRows(sc) - t.h, y - st.drag.offY));
        app.saveSoon();
        draw();
      }
    }
  });

  window.addEventListener('mouseup', () => {
    const sc = scene();
    if (st.drag && st.drag.kind === 'trigger' && sc) {
      const x = Math.min(st.drag.x0, st.drag.x1);
      const y = Math.min(st.drag.y0, st.drag.y1);
      const w = Math.abs(st.drag.x1 - st.drag.x0) + 1;
      const h = Math.abs(st.drag.y1 - st.drag.y0) + 1;
      const t = makeTrigger(`Trigger ${sc.triggers.length + 1}`, x, y, w, h);
      sc.triggers.push(t);
      st.selected = { kind: 'trigger', id: t.id };
      setTool('select');
      app.save();
      refresh();
    } else if (st.drag && (st.drag.kind === 'move-actor' || st.drag.kind === 'move-trigger')) {
      app.save();
      renderInspector(); // refresh X/Y fields after a move
    }
    st.drag = null;
  });

  canvas.addEventListener('mouseleave', () => { st.hoverX = -1; st.hoverY = -1; status.textContent = ''; draw(); });

  function setTool(tool) {
    st.tool = tool;
    document.querySelectorAll('#sceneTools .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  function paintCell(sc, x, y) {
    const idx = st.tool === 'erase' ? 0 : st.paintTile;
    const at = y * sceneCols(sc) + x;
    if (sc.tiles[at] !== idx) {
      sc.tiles[at] = idx;
      app.saveSoon();
      draw();
    }
  }

  let flashTimer = null;
  function flash(msg) {
    status.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  }

  // ------------------------------------------------------------ drawing
  const tileCache = new Map(); // tileIndex -> offscreen canvas

  function tileThumb(i, scale) {
    const key = `${i}@${scale}@${app.assetVersion}`;
    if (!tileCache.has(key)) {
      const t = app.project.tiles[i];
      const c = document.createElement('canvas');
      if (t) drawPixelsToCanvas(c, t.pixels, 8, 8, scale);
      tileCache.set(key, c);
    }
    return tileCache.get(key);
  }

  function spriteThumb(sprite, scale) {
    const key = `spr:${sprite.id}@${scale}@${app.assetVersion}`;
    if (!tileCache.has(key)) {
      const c = document.createElement('canvas');
      drawPixelsToCanvas(c, sprite.frames[0], sprite.width, sprite.height, scale, { on: '#d8ecff', off: 'rgba(0,0,0,0)' });
      tileCache.set(key, c);
    }
    return tileCache.get(key);
  }

  function draw() {
    const sc = scene();
    if (!sc) return;
    const ZOOM = zoomFor(sc);
    const CELL = 8 * ZOOM;
    const cw = sceneCols(sc), ch = sceneRows(sc);
    // Resize the canvas to the scene so scrolling scenes are fully visible.
    if (canvas.width !== cw * CELL || canvas.height !== ch * CELL) {
      canvas.width = cw * CELL;
      canvas.height = ch * CELL;
    }
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        ctx.drawImage(tileThumb(sc.tiles[y * cw + x], ZOOM), x * CELL, y * CELL);
      }
    }

    // grid
    ctx.strokeStyle = 'rgba(120,150,190,0.15)';
    ctx.lineWidth = 1;
    for (let x = 1; x < cw; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, canvas.height); ctx.stroke(); }
    for (let y = 1; y < ch; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(canvas.width, y * CELL + 0.5); ctx.stroke(); }

    // screen boundaries — each cell is one Arduboy screen of a scrolling scene
    if (sc.screensX > 1 || sc.screensY > 1) {
      ctx.strokeStyle = 'rgba(100,230,180,0.55)';
      ctx.lineWidth = 2;
      for (let i = 1; i < sc.screensX; i++) {
        const px = i * SCENE_W * CELL;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
      }
      for (let j = 1; j < sc.screensY; j++) {
        const py = j * SCENE_H * CELL;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    // triggers
    for (const t of sc.triggers) {
      const isSel = st.selected && st.selected.kind === 'trigger' && st.selected.id === t.id;
      ctx.fillStyle = isSel ? 'rgba(255,207,110,0.35)' : 'rgba(255,207,110,0.18)';
      ctx.fillRect(t.x * CELL, t.y * CELL, t.w * CELL, t.h * CELL);
      ctx.strokeStyle = isSel ? '#ffcf6e' : 'rgba(255,207,110,0.6)';
      ctx.strokeRect(t.x * CELL + 1, t.y * CELL + 1, t.w * CELL - 2, t.h * CELL - 2);
    }

    // trigger being dragged
    if (st.drag && st.drag.kind === 'trigger') {
      const x = Math.min(st.drag.x0, st.drag.x1), y = Math.min(st.drag.y0, st.drag.y1);
      const w = Math.abs(st.drag.x1 - st.drag.x0) + 1, h = Math.abs(st.drag.y1 - st.drag.y0) + 1;
      ctx.fillStyle = 'rgba(255,207,110,0.3)';
      ctx.fillRect(x * CELL, y * CELL, w * CELL, h * CELL);
    }

    // actors
    for (const a of sc.actors) {
      const spr = spriteById(app.project, a.spriteId);
      if (spr) ctx.drawImage(spriteThumb(spr, ZOOM), a.x * CELL, a.y * CELL);
      const isSel = st.selected && st.selected.kind === 'actor' && st.selected.id === a.id;
      if (isSel) {
        ctx.strokeStyle = '#4dc3ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x * CELL + 1, a.y * CELL + 1, CELL - 2, CELL - 2);
        ctx.lineWidth = 1;
      }
    }

    // player start
    const s = app.project.settings;
    if (s.startSceneId === sc.id) {
      ctx.strokeStyle = '#64e6b4';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.startX * CELL + 2, s.startY * CELL + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = '#64e6b4';
      ctx.font = `${ZOOM * 3}px system-ui`;
      ctx.fillText('⚑', s.startX * CELL + CELL / 4, s.startY * CELL + CELL * 0.8);
      ctx.lineWidth = 1;
    }

    // hover cell
    if (st.hoverX >= 0 && (st.tool === 'paint' || st.tool === 'erase')) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(st.hoverX * CELL + 0.5, st.hoverY * CELL + 0.5, CELL - 1, CELL - 1);
    }
  }

  // ------------------------------------------------------------ sidebars
  function renderSceneList() {
    const ul = clear(document.getElementById('sceneList'));
    for (const sc of app.project.scenes) {
      const li = el('li', {
        class: sc.id === app.selectedSceneId ? 'active' : '',
        onclick: () => { app.selectedSceneId = sc.id; st.selected = null; refresh(); },
      },
        el('span', {}, sc.name),
        el('button', {
          class: 'mini', title: 'Delete scene',
          onclick: (e) => {
            e.stopPropagation();
            if (app.project.scenes.length <= 1) { flash('A project needs at least one scene'); return; }
            if (!confirm(`Delete scene "${sc.name}"?`)) return;
            app.project.scenes = app.project.scenes.filter((s) => s.id !== sc.id);
            if (app.selectedSceneId === sc.id) app.selectedSceneId = app.project.scenes[0].id;
            if (app.project.settings.startSceneId === sc.id) app.project.settings.startSceneId = app.project.scenes[0].id;
            app.save();
            refresh();
          },
        }, '✕'),
      );
      ul.append(li);
    }
  }

  function renderPalette() {
    const pal = clear(document.getElementById('scenePalette'));
    app.project.tiles.forEach((t, i) => {
      const cell = el('div', {
        class: 'asset-cell' + (i === st.paintTile ? ' active' : ''),
        title: `${t.name}${t.solid ? ' (solid)' : ''}`,
        onclick: () => { st.paintTile = i; setTool('paint'); renderPalette(); },
      });
      cell.append(tileThumb(i, 4).cloneNode ? cloneCanvas(tileThumb(i, 4)) : null);
      pal.append(cell);
    });
  }

  function cloneCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function renderInspector() {
    const box = clear(document.getElementById('inspector'));
    const sc = scene();
    if (!sc) return;

    if (st.selected && st.selected.kind === 'actor') {
      const a = sc.actors.find((x) => x.id === st.selected.id);
      if (!a) { st.selected = null; renderInspector(); return; }
      box.append(el('div', { class: 'panel-title' }, 'Actor'));
      box.append(field('Name', el('input', {
        type: 'text', value: a.name,
        onchange: (e) => { a.name = e.target.value; app.save(); refresh(); },
      })));
      const sprSel = el('select', { onchange: () => { a.spriteId = sprSel.value; app.save(); refresh(); } });
      for (const s of app.project.sprites) {
        sprSel.append(el('option', { value: s.id, selected: a.spriteId === s.id }, s.name));
      }
      box.append(field('Sprite', sprSel));
      const movSel = el('select', { onchange: () => { a.movement = movSel.value; app.save(); } });
      for (const [v, l] of [['static', 'Static'], ['wander', 'Wander randomly'], ['patrolH', 'Patrol ↔'], ['patrolV', 'Patrol ↕']]) {
        movSel.append(el('option', { value: v, selected: a.movement === v }, l));
      }
      box.append(field('Movement', movSel));
      box.append(field('', el('label', {}, el('input', {
        type: 'checkbox', checked: a.solid,
        onchange: (e) => { a.solid = e.target.checked; app.save(); },
      }), ' Solid (blocks player, can be talked to)')));
      box.append(field('', el('label', {}, el('input', {
        type: 'checkbox', checked: a.animate,
        onchange: (e) => { a.animate = e.target.checked; app.save(); },
      }), ' Animate frames')));
      box.append(el('div', { class: 'panel-title' }, 'On interact (A button)'));
      box.append(renderScriptEditor(app, sc, a.script, app.save));
      box.append(el('button', {
        class: 'btn danger', style: 'margin-top:8px',
        onclick: () => {
          sc.actors = sc.actors.filter((x) => x.id !== a.id);
          st.selected = null;
          app.save();
          refresh();
        },
      }, 'Delete actor'));
      return;
    }

    if (st.selected && st.selected.kind === 'trigger') {
      const t = sc.triggers.find((x) => x.id === st.selected.id);
      if (!t) { st.selected = null; renderInspector(); return; }
      box.append(el('div', { class: 'panel-title' }, 'Trigger'));
      box.append(field('Name', el('input', {
        type: 'text', value: t.name,
        onchange: (e) => { t.name = e.target.value; app.save(); },
      })));
      const dims = el('div', { class: 'form-row' });
      const cw = sceneCols(sc), ch = sceneRows(sc);
      for (const [key, max] of [['x', cw - 1], ['y', ch - 1], ['w', cw], ['h', ch]]) {
        dims.append(el('label', {}, key.toUpperCase(), el('input', {
          type: 'number', min: key === 'w' || key === 'h' ? 1 : 0, max, value: t[key],
          onchange: (e) => { t[key] = parseInt(e.target.value, 10) || 0; app.save(); draw(); },
        })));
      }
      box.append(dims);
      box.append(el('div', { class: 'panel-title' }, 'On enter'));
      box.append(renderScriptEditor(app, sc, t.script, app.save));
      box.append(el('button', {
        class: 'btn danger', style: 'margin-top:8px',
        onclick: () => {
          sc.triggers = sc.triggers.filter((x) => x.id !== t.id);
          st.selected = null;
          app.save();
          refresh();
        },
      }, 'Delete trigger'));
      return;
    }

    // Scene itself
    box.append(el('div', { class: 'panel-title' }, 'Scene'));
    box.append(field('Name', el('input', {
      type: 'text', value: sc.name,
      onchange: (e) => { sc.name = e.target.value; app.save(); refresh(); },
    })));
    // Scene size in screens. A 1x1 scene is a single Arduboy screen (Bitsy
    // style); anything larger scrolls to follow the player.
    const sizeRow = el('div', { class: 'form-row' });
    const mkScreens = (key, label) => {
      const sel = el('select', {
        onchange: () => {
          const sx = key === 'screensX' ? parseInt(sel.value, 10) : sc.screensX;
          const sy = key === 'screensY' ? parseInt(sel.value, 10) : sc.screensY;
          const shrinking = sx < sc.screensX || sy < sc.screensY;
          if (shrinking && !confirm('Shrinking the scene discards tiles outside the new area. Continue?')) {
            renderInspector();
            return;
          }
          resizeScene(sc, sx, sy);
          if (app.project.settings.startSceneId === sc.id) {
            app.project.settings.startX = Math.min(app.project.settings.startX, sceneCols(sc) - 1);
            app.project.settings.startY = Math.min(app.project.settings.startY, sceneRows(sc) - 1);
          }
          app.save();
          refresh();
        },
      });
      for (let i = 1; i <= MAX_SCREENS; i++) {
        sel.append(el('option', { value: i, selected: sc[key] === i }, String(i)));
      }
      return el('label', {}, label, sel);
    };
    sizeRow.append(mkScreens('screensX', 'Screens →'));
    sizeRow.append(mkScreens('screensY', '↓'));
    box.append(sizeRow);
    box.append(el('p', { class: 'hint' },
      sc.screensX > 1 || sc.screensY > 1
        ? `${sceneCols(sc)}×${sceneRows(sc)} tiles — scrolls to follow the player (green lines mark screen edges).`
        : `${sceneCols(sc)}×${sceneRows(sc)} tiles — exactly one Arduboy screen, no scrolling.`));
    box.append(el('p', { class: 'hint' },
      `${sc.actors.length}/${MAX_ACTORS_PER_SCENE} actors · ${sc.triggers.length}/${MAX_TRIGGERS_PER_SCENE} triggers`));
    box.append(el('p', { class: 'hint' }, 'Select an actor or trigger with the ➤ tool to edit it here.'));
    box.append(el('div', { class: 'panel-title' }, 'On scene enter'));
    box.append(renderScriptEditor(app, sc, sc.onEnter, app.save));
  }

  function field(label, control) {
    return el('div', { class: 'form-row' }, label ? el('label', {}, label, control) : control);
  }

  function refresh() {
    if (!sceneById(app.project, app.selectedSceneId)) {
      app.selectedSceneId = app.project.scenes[0] && app.project.scenes[0].id;
    }
    tileCache.clear();
    renderSceneList();
    renderPalette();
    renderInspector();
    draw();
  }

  return { refresh, draw };
}
