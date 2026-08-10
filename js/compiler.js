// Compiles an ArduStudio project into the compact representation shared by
// the in-browser play-test emulator and the generated Arduboy sketch.
// Scripts become bytecode for a tiny cooperative VM; both runtimes execute
// the exact same bytes, so what you play in the browser is what ships.

import {
  SCENE_W, SCENE_H, MAX_VARIABLES,
  sceneCols, sceneRows,
  pixelsToBytes, sceneById, spriteById,
} from './model.js';

export const OP = {
  END: 0,
  TEXT: 1,          // strIdx
  SWITCH_SCENE: 2,  // sceneIdx, x, y
  SET_VAR: 3,       // varIdx, value
  ADD_VAR: 4,       // varIdx, delta (int8 stored as byte)
  IF_VAR: 5,        // varIdx, cmp, value, elseAddrLo, elseAddrHi
  JUMP: 6,          // addrLo, addrHi
  TONE: 7,          // freqLo, freqHi, frames
  WAIT: 8,          // frames
  ACTOR_HIDE: 9,    // actorIdx (0xFF = self)
  ACTOR_SHOW: 10,   // actorIdx (0xFF = self)
  SET_TILE: 11,     // x, y, tileIndex
  PLAYER_POS: 12,   // x, y
  ACTOR_MOVE: 13,   // actorIdx (0xFF = self), x, y, flags (bit0 = instant)
  PLAY_SONG: 14,    // songIdx, flags (bit0 = loop)
  STOP_SONG: 15,
  SAVE_GAME: 16,
  LOAD_GAME: 17,
  SAVE_CHECK: 18,   // varIdx (set to 1 if a save exists, else 0)
  DELETE_SAVE: 19,
  SET_LED: 20,      // mode (0 = analog PWM, 1 = digital on/off), r, g, b
  MENU: 21,         // varIdx, count, flags, then count string indices
};

// MENU flag bits.
export const MENU_LAST_IS_ZERO = 1;
export const MENU_CANCEL_B = 2;
export const MENU_LAYOUT_DIALOGUE = 4;

export const MAX_MENU_OPTIONS = 8;
// Widest label that renders without clipping: the menu column and each dialogue
// column are ~60px wide, and the font is 6px per character including spacing.
export const MENU_LABEL_MAX_CHARS = 9;

export const CMP = { '==': 0, '!=': 1, '<': 2, '>': 3, '<=': 4, '>=': 5 };

export const NO_SCRIPT = 0xffff;

// Dialogue box metrics (must match both runtimes).
export const TEXT_CHARS_PER_LINE = 20;
export const TEXT_LINES_PER_PAGE = 3;

// Wrap dialogue text into pages of up to 3 lines of 20 chars.
// '\n' forces a line break, '\f' forces a page break. Output uses the same
// two control characters, so runtimes only ever handle '\n' and '\f'.
export function wrapText(text) {
  const pagesIn = String(text).split('\f');
  const pagesOut = [];
  for (const page of pagesIn) {
    const lines = [];
    for (const para of page.split('\n')) {
      const words = para.split(/ +/).filter((w) => w.length);
      if (!words.length) { lines.push(''); continue; }
      let line = '';
      for (let word of words) {
        while (word.length > TEXT_CHARS_PER_LINE) {
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, TEXT_CHARS_PER_LINE));
          word = word.slice(TEXT_CHARS_PER_LINE);
        }
        if (!line.length) line = word;
        else if (line.length + 1 + word.length <= TEXT_CHARS_PER_LINE) line += ' ' + word;
        else { lines.push(line); line = word; }
      }
      if (line.length) lines.push(line);
    }
    for (let i = 0; i < lines.length; i += TEXT_LINES_PER_PAGE) {
      pagesOut.push(lines.slice(i, i + TEXT_LINES_PER_PAGE).join('\n'));
    }
  }
  if (!pagesOut.length) pagesOut.push('');
  return pagesOut.join('\f');
}

const MOVEMENT_CODES = { static: 0, wander: 1, patrolH: 2, patrolV: 3 };

export function compileProject(project) {
  const warnings = [];
  const strings = [];
  const stringIndex = new Map();
  // Store a string exactly as given, sharing the dialogue string table so
  // labels and dialogue dedupe against each other.
  const internRaw = (text) => {
    const s = String(text);
    if (stringIndex.has(s)) return stringIndex.get(s);
    const idx = strings.length;
    if (idx > 255) throw new Error('Too many unique dialogue strings (max 256)');
    strings.push(s);
    stringIndex.set(s, idx);
    return idx;
  };
  // Dialogue goes through word wrapping first; menu labels must not.
  const internString = (raw) => internRaw(wrapText(raw));

  const varIndex = new Map();
  project.variables.slice(0, MAX_VARIABLES).forEach((v, i) => varIndex.set(v.id, i));

  const sceneIndex = new Map();
  project.scenes.forEach((s, i) => sceneIndex.set(s.id, i));
  if (project.scenes.length > 255) throw new Error('Too many scenes (max 255)');

  const songIndex = new Map();
  (project.songs || []).forEach((s, i) => songIndex.set(s.id, i));

  const cols = (scene) => (scene ? sceneCols(scene) : SCENE_W);
  const rows = (scene) => (scene ? sceneRows(scene) : SCENE_H);

  const code = [];
  const emit = (...bytes) => { for (const b of bytes) code.push(b & 0xff); };
  const emitU16 = (v) => { code.push(v & 0xff, (v >> 8) & 0xff); };

  // Compile one event list; `scene` provides actor-index context.
  function compileEvents(events, scene, ctx) {
    for (const ev of events || []) {
      switch (ev.type) {
        case 'TEXT':
          emit(OP.TEXT, internString(ev.text || ''));
          break;
        case 'SWITCH_SCENE': {
          const idx = sceneIndex.get(ev.sceneId);
          if (idx === undefined) { warnings.push(`${ctx}: Change Scene points at a missing scene — skipped`); break; }
          const target = project.scenes[idx];
          emit(OP.SWITCH_SCENE, idx, clampTile(ev.x, sceneCols(target)), clampTile(ev.y, sceneRows(target)));
          break;
        }
        case 'SET_VAR': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Set Variable has no variable selected — skipped`); break; }
          emit(OP.SET_VAR, idx, byte(ev.value));
          break;
        }
        case 'ADD_VAR': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Add To Variable has no variable selected — skipped`); break; }
          emit(OP.ADD_VAR, idx, int8byte(ev.delta));
          break;
        }
        case 'IF_VAR': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: If Variable has no variable selected — skipped`); break; }
          emit(OP.IF_VAR, idx, CMP[ev.cmp] ?? 0, byte(ev.value));
          const elsePatch = code.length; emitU16(0);
          compileEvents(ev.then, scene, ctx);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx);
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'TONE': {
          const f = Math.max(16, Math.min(65535, Math.round(ev.freq) || 440));
          emit(OP.TONE, f & 0xff, (f >> 8) & 0xff, byte(ev.frames || 15));
          break;
        }
        case 'WAIT':
          emit(OP.WAIT, byte(ev.frames || 1));
          break;
        case 'ACTOR_HIDE':
        case 'ACTOR_SHOW': {
          const op = ev.type === 'ACTOR_HIDE' ? OP.ACTOR_HIDE : OP.ACTOR_SHOW;
          if (ev.target === 'self') { emit(op, 0xff); break; }
          const ai = scene ? scene.actors.findIndex((a) => a.id === ev.target) : -1;
          if (ai < 0) { warnings.push(`${ctx}: ${ev.type === 'ACTOR_HIDE' ? 'Hide' : 'Show'} Actor target not in this scene — skipped`); break; }
          emit(op, ai);
          break;
        }
        case 'SET_TILE':
          emit(OP.SET_TILE, clampTile(ev.x, cols(scene)), clampTile(ev.y, rows(scene)),
            Math.max(0, Math.min(project.tiles.length - 1, ev.tileIndex | 0)));
          break;
        case 'PLAYER_POS':
          emit(OP.PLAYER_POS, clampTile(ev.x, cols(scene)), clampTile(ev.y, rows(scene)));
          break;
        case 'ACTOR_MOVE': {
          let idx = 0xff;
          if (ev.target !== 'self') {
            idx = scene ? scene.actors.findIndex((a) => a.id === ev.target) : -1;
            if (idx < 0) { warnings.push(`${ctx}: Move Actor target not in this scene — skipped`); break; }
          }
          emit(OP.ACTOR_MOVE, idx, clampTile(ev.x, cols(scene)), clampTile(ev.y, rows(scene)),
            ev.instant ? 1 : 0);
          break;
        }
        case 'PLAY_SONG': {
          const idx = songIndex.get(ev.songId);
          if (idx === undefined) { warnings.push(`${ctx}: Play Song has no song selected — skipped`); break; }
          emit(OP.PLAY_SONG, idx, ev.loop ? 1 : 0);
          break;
        }
        case 'STOP_SONG':
          emit(OP.STOP_SONG);
          break;
        case 'SAVE_GAME':
          emit(OP.SAVE_GAME);
          break;
        case 'LOAD_GAME':
          emit(OP.LOAD_GAME);
          break;
        case 'SAVE_CHECK': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Save Exists has no variable selected — skipped`); break; }
          emit(OP.SAVE_CHECK, idx);
          break;
        }
        case 'DELETE_SAVE':
          emit(OP.DELETE_SAVE);
          break;
        case 'SET_LED':
          if (ev.mode === 'digital') {
            emit(OP.SET_LED, 1, ev.dr ? 1 : 0, ev.dg ? 1 : 0, ev.db ? 1 : 0);
          } else {
            emit(OP.SET_LED, 0, byte(ev.r), byte(ev.g), byte(ev.b));
          }
          break;
        case 'MENU': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Display Menu has no variable selected — skipped`); break; }
          const opts = (ev.options || []).slice(0, MAX_MENU_OPTIONS);
          if (opts.length < 2) { warnings.push(`${ctx}: Display Menu needs at least 2 options — skipped`); break; }
          let flags = 0;
          if (ev.lastIsZero) flags |= MENU_LAST_IS_ZERO;
          if (ev.cancelB) flags |= MENU_CANCEL_B;
          if (ev.layout === 'dialogue') flags |= MENU_LAYOUT_DIALOGUE;
          emit(OP.MENU, idx, opts.length, flags);
          for (const label of opts) {
            if (String(label).length > MENU_LABEL_MAX_CHARS) {
              warnings.push(`${ctx}: menu option "${label}" is wider than ${MENU_LABEL_MAX_CHARS} characters and will be clipped on screen`);
            }
            emit(internRaw(label));
          }
          break;
        }
        case 'CHOICE': {
          // A two-option menu in the dialogue layout, where the last option
          // yields 0 — exactly "first = true (1), second = false (0)".
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Display Multiple Choice has no variable selected — skipped`); break; }
          for (const label of [ev.trueLabel, ev.falseLabel]) {
            if (String(label).length > MENU_LABEL_MAX_CHARS) {
              warnings.push(`${ctx}: choice option "${label}" is wider than ${MENU_LABEL_MAX_CHARS} characters and will be clipped on screen`);
            }
          }
          emit(OP.MENU, idx, 2, MENU_LAST_IS_ZERO | MENU_LAYOUT_DIALOGUE);
          emit(internRaw(ev.trueLabel));
          emit(internRaw(ev.falseLabel));
          break;
        }
        case 'END_SCRIPT':
          emit(OP.END);
          break;
        default:
          warnings.push(`${ctx}: unknown event ${ev.type} — skipped`);
      }
    }
  }

  const scriptOffsets = [];
  function addScript(events, scene, ctx) {
    if (!events || !events.length) return NO_SCRIPT;
    const idx = scriptOffsets.length;
    if (idx >= 255) throw new Error('Too many scripts (max 255)');
    scriptOffsets.push(code.length);
    compileEvents(events, scene, ctx);
    emit(OP.END);
    return idx;
  }

  const scenes = project.scenes.map((scene, si) => {
    const cw = sceneCols(scene), ch = sceneRows(scene);
    const onEnterIdx = addScript(scene.onEnter, scene, `Scene "${scene.name}" on-enter`);
    const actors = scene.actors.map((a) => {
      const sprite = spriteById(project, a.spriteId);
      let spriteIdx = project.sprites.indexOf(sprite);
      if (spriteIdx < 0) { warnings.push(`Actor "${a.name}" in "${scene.name}" has no sprite — using sprite 0`); spriteIdx = 0; }
      return {
        spriteIdx,
        x: clampTile(a.x, cw),
        y: clampTile(a.y, ch),
        movement: MOVEMENT_CODES[a.movement] ?? 0,
        solid: a.solid ? 1 : 0,
        animate: a.animate ? 1 : 0,
        scriptIdx: addScript(a.script, scene, `Actor "${a.name}" in "${scene.name}"`),
      };
    });
    const triggers = scene.triggers.map((t) => ({
      x: clampTile(t.x, cw),
      y: clampTile(t.y, ch),
      w: Math.max(1, Math.min(cw, t.w | 0)),
      h: Math.max(1, Math.min(ch, t.h | 0)),
      scriptIdx: addScript(t.script, scene, `Trigger "${t.name}" in "${scene.name}"`),
    }));
    return { name: scene.name, index: si, cols: cw, rows: ch, tiles: scene.tiles.slice(), actors, triggers, onEnterIdx };
  });

  if (code.length > 0xfffe) throw new Error('Compiled scripts exceed 64KB');

  const tiles = project.tiles.map((t) => ({
    name: t.name,
    solid: !!t.solid,
    bytes: pixelsToBytes(t.pixels, 8, 8),
  }));

  const sprites = project.sprites.map((s) => ({
    name: s.name,
    width: s.width,
    height: s.height,
    frames: s.frames.map((f) => pixelsToBytes(f, s.width, s.height)),
  }));

  const songs = (project.songs || []).map((s) => ({
    name: s.name,
    notes: s.notes.map((n) => ({ f: n.f, d: n.d })),
  }));

  const startScene = sceneIndex.get(project.settings.startSceneId) ?? 0;
  const startSceneObj = project.scenes[startScene];
  const playerSpriteIdx = Math.max(0, project.sprites.indexOf(spriteById(project, project.settings.playerSpriteId)));

  return {
    name: project.name,
    author: project.author,
    strings,
    code: Uint8Array.from(code),
    scriptOffsets,
    scenes,
    tiles,
    sprites,
    songs,
    varNames: project.variables.map((v) => v.name),
    varCount: Math.min(project.variables.length, MAX_VARIABLES),
    startScene,
    startX: clampTile(project.settings.startX, cols(startSceneObj)),
    startY: clampTile(project.settings.startY, rows(startSceneObj)),
    playerSpriteIdx,
    warnings,
  };
}

function clampTile(v, max) { return Math.max(0, Math.min(max - 1, v | 0)); }
function byte(v) { return Math.max(0, Math.min(255, v | 0)); }
function int8byte(v) { const c = Math.max(-128, Math.min(127, v | 0)); return c & 0xff; }
function patchU16(code, at, value) { code[at] = value & 0xff; code[at + 1] = (value >> 8) & 0xff; }
