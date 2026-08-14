// Compiles an ArduStudio project into the compact representation shared by
// the in-browser play-test emulator and the generated Arduboy sketch.
// Scripts become bytecode for a tiny cooperative VM; both runtimes execute
// the exact same bytes, so what you play in the browser is what ships.

import {
  SCENE_W, SCENE_H, MAX_VARIABLES,
  sceneCols, sceneRows, buttonIndex, forEachEvent, MATH_OPS,
  pixelsToBytes, sceneById, spriteById,
  ACTOR_SCRIPT_SLOTS, TRIGGER_SCRIPT_SLOTS, SCENE_SCRIPT_SLOTS, NON_BLOCKING_SLOTS,
  directionCode, effectCode, collisionGroupCode,
  PROJECTILE_DIRS, PROJECTILE_DIR_SOURCE, ACTOR_SPEEDS,
} from './model.js';
import { compileExpression, EX, MAX_EXPR_BYTES } from './expression.js';

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
  SET_ACTOR_SPRITE: 22, // actorIdx (0xFF = self), spriteIdx
  ATTACH_SCRIPT: 23,    // buttonIdx, flags (bit0 = override default), scriptIdx
  REMOVE_BUTTON_SCRIPT: 24, // buttonIdx
  WAIT_INPUT: 25,   // buttonMask — blocks until any of these is pressed
  IF_INPUT: 26,     // buttonMask, elseAddrLo, elseAddrHi (buttons currently held)
  SET_ACTOR_DIR: 27,    // actorIdx (0xFF = self), dir (0=down 1=up 2=left 3=right)
  SET_ACTOR_SPEED: 28,  // actorIdx (0xFF = self), speed (0 = half, else px/frame)
  ACTOR_EFFECT: 29,     // actorIdx (0xFF = self), effect (1=flicker 2=shake), frames
  LAUNCH_PROJECTILE: 30, // srcIdx (0xFF = self, 0xFE = player), spriteIdx, dir, speed, life, collideMask
  PUSH_SCENE: 31,   // sceneIdx, x, y, fadeSpeed
  POP_SCENE: 32,    // fadeSpeed
  POP_ALL_SCENES: 33, // fadeSpeed
  FADE_IN: 34,      // fadeSpeed
  FADE_OUT: 35,     // fadeSpeed
  IF_ACTOR_AT: 36,  // actorIdx, x, y, elseAddrLo, elseAddrHi
  // actorIdx, cmp, distSqLo, distSqHi, fromIdx, elseAddrLo, elseAddrHi.
  // Distance is compared squared so neither runtime needs a square root.
  IF_ACTOR_DISTANCE: 37,
  STORE_ACTOR_DIR: 38, // actorIdx, varIdx
  STORE_ACTOR_POS: 39, // actorIdx, varXIdx, varYIdx
  EXPR_IF: 40,      // exprLen, expr bytes…, elseAddrLo, elseAddrHi
  EXPR_LOOP: 41,    // exprLen, expr bytes…, endAddrLo, endAddrHi
  SEED_RNG: 42,
  SWITCH: 43,       // varIdx, count, [value, addrLo, addrHi] × count, elseAddrLo, elseAddrHi
  SET_ANIM_FRAME: 44, // actorIdx, frame
  SET_ANIM_SPEED: 45, // actorIdx, speed (0 = frozen, else frames per step)
  SET_ANIM_STATE: 46, // actorIdx, stateIdx, loop
  SHOW_OVERLAY: 47, // fill (0 = black, 1 = white), x, y
  HIDE_OVERLAY: 48,
  OVERLAY_MOVE: 49, // x, y, speed
  OVERLAY_CUTOFF: 50, // y scanline
  DRAW_TEXT: 51,    // strIdx, x, y, location (0 = background, 1 = overlay)
  START_SCRIPT: 52, // scriptIdxLo, scriptIdxHi, selfIdx (0xFF = none)
  EXPR_SET: 53,     // varIdx, exprLen, expr bytes… — stores the result
};

// Animation speed: frames between animation steps. 0 freezes the actor.
export const ANIM_SPEEDS = [
  { value: 0, label: 'None (frozen)' },
  { value: 5, label: 'Speed 1 (fastest)' },
  { value: 10, label: 'Speed 2' },
  { value: 20, label: 'Speed 3 (default)' },
  { value: 40, label: 'Speed 4' },
  { value: 80, label: 'Speed 5 (slowest)' },
];

// Overlay move speed in pixels per frame.
export const OVERLAY_SPEEDS = [
  { value: 0, label: 'Instant' },
  { value: 1, label: 'Speed 1 (slowest)' },
  { value: 2, label: 'Speed 2' },
  { value: 4, label: 'Speed 3' },
  { value: 8, label: 'Speed 4 (fastest)' },
];

export const MAX_SWITCH_CASES = 8;
export const MAX_DRAWN_TEXT = 4;   // live Draw Text entries, like the tile override table
export const MAX_SPRITE_STATES = 4;

export const DRAW_TEXT_BACKGROUND = 0;
export const DRAW_TEXT_OVERLAY = 1;

// An actor reference in the bytecode: a scene actor index, or one of these.
export const ACTOR_REF_SELF = 0xff;
export const ACTOR_REF_PLAYER = 0xfe;
// The largest distance an If Actor Distance comparison can carry. Squaring it
// must still fit the uint16 the bytecode stores.
export const MAX_ACTOR_DISTANCE = 255;

// Events that stop a script mid-flight. They are meaningless in a slot that
// runs to completion every frame (On Update), so the compiler drops them there
// with a warning rather than letting the runtime deadlock.
export const BLOCKING_EVENTS = new Set([
  'WAIT', 'TEXT', 'MENU', 'CHOICE', 'WAIT_INPUT', 'PUSH_SCENE', 'POP_SCENE',
  'POP_ALL_SCENES', 'FADE_IN', 'FADE_OUT', 'OVERLAY_MOVE',
  // A loop runs until its condition goes false, which it cannot do inside a
  // slot that has to finish in one frame.
  'EXPR_LOOP', 'LOOP',
]);

// Events that end a script outright, so a Loop containing one can still be
// escaped. Change Scene counts because it abandons the running script.
const LOOP_ESCAPES = new Set(['END_SCRIPT', 'SWITCH_SCENE']);

// True when this event list can never hand the VM back: no event that pauses,
// and no event that ends the script. The blocking VM keeps its program counter
// between frames, so such a loop owns it forever and everything else queues up
// behind it — the classic "the player is stuck" freeze, provable up front.
function neverYields(events) {
  let escapes = false;
  forEachEvent(events, (ev) => {
    if (BLOCKING_EVENTS.has(ev.type) || LOOP_ESCAPES.has(ev.type)) escapes = true;
  });
  return !escapes;
}

// The launcher of a projectile, when it is not an actor in the scene.
export const PROJECTILE_SRC_SELF = 0xff;
export const PROJECTILE_SRC_PLAYER = 0xfe;

export const ATTACH_OVERRIDE = 1;
export const NUM_BUTTONS = 6;

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

// A "$name" in text prints that variable's value. Values are only known while
// the game runs, so the compiler leaves a two-byte marker in the string and the
// runtimes expand it: 0x01 followed by the variable index plus one, which keeps
// the second byte clear of NUL and out of the printable range.
export const TEXT_VAR_MARKER = '\u0001';
// A byte value is 0-255, so it renders as at most three characters. Wrapping
// reserves that width, which means a line can only ever come out shorter than
// planned — never wider than the dialogue box.
export const TEXT_VAR_MAX_WIDTH = 3;

export function textVarMarker(varIndex) {
  return TEXT_VAR_MARKER + String.fromCharCode(varIndex + 1);
}

// Columns a stored string occupies once drawn, counting each marker as its
// widest possible value.
export function displayWidth(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === TEXT_VAR_MARKER) { n += TEXT_VAR_MAX_WIDTH; i++; }
    else n++;
  }
  return n;
}

// Split a stored string after `cols` display columns without ever cutting a
// marker in half. Returns [head, tail].
function splitAtWidth(str, cols) {
  let n = 0, i = 0;
  while (i < str.length) {
    const w = str[i] === TEXT_VAR_MARKER ? TEXT_VAR_MAX_WIDTH : 1;
    if (n + w > cols) break;
    n += w;
    i += str[i] === TEXT_VAR_MARKER ? 2 : 1;
  }
  return [str.slice(0, i), str.slice(i)];
}

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
      let lineWidth = 0;
      for (let word of words) {
        while (displayWidth(word) > TEXT_CHARS_PER_LINE) {
          if (lineWidth) { lines.push(line); line = ''; lineWidth = 0; }
          const [head, tail] = splitAtWidth(word, TEXT_CHARS_PER_LINE);
          // A marker is only 3 columns wide, so head can never come back empty.
          lines.push(head);
          word = tail;
        }
        const wordWidth = displayWidth(word);
        if (!lineWidth) { line = word; lineWidth = wordWidth; }
        else if (lineWidth + 1 + wordWidth <= TEXT_CHARS_PER_LINE) { line += ' ' + word; lineWidth += 1 + wordWidth; }
        else { lines.push(line); line = word; lineWidth = wordWidth; }
      }
      if (lineWidth) lines.push(line);
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
  const internPlain = (s) => {
    if (stringIndex.has(s)) return stringIndex.get(s);
    const idx = strings.length;
    if (idx > 255) throw new Error('Too many unique dialogue strings (max 256)');
    strings.push(s);
    stringIndex.set(s, idx);
    return idx;
  };

  // Replace every "$name" with the marker the runtimes expand into that
  // variable's value.
  //   $name    a reference, ending at the first character that is not a letter,
  //            digit or underscore
  //   ${name}  the same, with the end spelled out — which is what you need when
  //            a value butts straight up against more text
  //   $$       a literal dollar sign
  // An unknown name is left exactly as typed and warned about: a typo should
  // leave the sentence readable rather than blanking part of it.
  let usesTextVars = false;
  function substituteVars(text, ctx) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '$') { out += text[i]; continue; }
      if (text[i + 1] === '$') { out += '$'; i++; continue; }

      let name = null;
      let consumed = 0;
      if (text[i + 1] === '{') {
        const close = text.indexOf('}', i + 2);
        if (close > 0) {
          name = text.slice(i + 2, close);
          consumed = close - i;
          if (!/^[A-Za-z0-9_]+$/.test(name)) name = null;
        }
      } else {
        const m = /^[A-Za-z0-9_]+/.exec(text.slice(i + 1));
        if (m) { name = m[0]; consumed = m[0].length; }
      }
      if (name === null) { out += '$'; continue; }

      const idx = exprVarIndex.get(name);
      if (idx === undefined) {
        warnings.push(`${ctx}: text mentions $${name}, which is not a variable — printed as written`);
        out += text.slice(i, i + consumed + 1);
      } else {
        usesTextVars = true;
        out += textVarMarker(idx);
      }
      i += consumed;
    }
    return out;
  }

  const internRaw = (text, ctx) => internPlain(substituteVars(String(text), ctx));
  // Dialogue goes through word wrapping first; menu labels must not.
  const internString = (raw, ctx) => internPlain(wrapText(substituteVars(String(raw), ctx)));

  const varIndex = new Map();
  const exprVarIndex = new Map(); // by name, for $name in expressions
  project.variables.slice(0, MAX_VARIABLES).forEach((v, i) => {
    varIndex.set(v.id, i);
    exprVarIndex.set(String(v.name), i);
  });

  // The actor whose script is being compiled, so a "self" reference can look up
  // which sprite — and therefore which animation states — it will have.
  let ownerActor = null;

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

  // Resolve an actor reference — "self", "player", or a scene actor id — to the
  // byte the bytecode carries. Returns -1 when it names nothing, having warned.
  function actorRef(value, scene, ctx, label) {
    if (!value || value === 'self') return ACTOR_REF_SELF;
    if (value === 'player') return ACTOR_REF_PLAYER;
    const ai = scene ? scene.actors.findIndex((a) => a.id === value) : -1;
    if (ai < 0) { warnings.push(`${ctx}: ${label} target not in this scene — skipped`); return -1; }
    return ai;
  }

  const actorTarget = (ev, scene, ctx, label) => actorRef(ev.target, scene, ctx, label);

  // Fade speed: 0 is fastest. Stored as frames spent on each dither step.
  const fadeSpeed = (v) => Math.max(0, Math.min(7, v === undefined ? 2 : v | 0));

  // Compile an expression, turning a parse error into a warning that names the
  // script and the problem. Returns null when it could not be compiled, so the
  // event is skipped rather than breaking the whole export.
  function compileExpr(src, ctx, label) {
    try {
      return compileExpression(src, exprVarIndex);
    } catch (err) {
      warnings.push(`${ctx}: ${label} — ${err.message} — skipped`);
      return null;
    }
  }

  // Which state of the actor's sprite an event names. States belong to the
  // sprite, so this needs the actor to know which sprite list to look in.
  function spriteStateIndex(ev, scene, actorIdx, ctx) {
    // 0xFF means "self", whose sprite is only known at runtime — the editor
    // resolves it against the actor that owns the script, so fall back to
    // matching by name across the project when the index is not a real actor.
    const actor = (actorIdx < 0xfe && scene) ? scene.actors[actorIdx] : ownerActor;
    const sprite = actor ? spriteById(project, actor.spriteId) : null;
    const states = (sprite && sprite.states) || [];
    const idx = states.findIndex((s) => s.id === ev.stateId);
    if (idx < 0) {
      warnings.push(`${ctx}: Set Actor Animation State names a state that sprite does not have — skipped`);
      return -1;
    }
    return idx;
  }

  // Compile one event list; `scene` provides actor-index context.
  // `nonBlocking` marks a slot that runs to completion every frame.
  function compileEvents(events, scene, ctx, nonBlocking) {
    for (const ev of events || []) {
      if (nonBlocking && BLOCKING_EVENTS.has(ev.type)) {
        warnings.push(`${ctx}: ${ev.type} cannot pause an On Update script, which must finish in one frame — skipped`);
        continue;
      }
      switch (ev.type) {
        case 'TEXT':
          emit(OP.TEXT, internString(ev.text || '', ctx));
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
          compileEvents(ev.then, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
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
          const idx = actorTarget(ev, scene, ctx, `${ev.type === 'ACTOR_HIDE' ? 'Hide' : 'Show'} Actor`);
          if (idx < 0) break;
          emit(op, idx);
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
            if (displayWidth(substituteVars(String(label), ctx)) > MENU_LABEL_MAX_CHARS) {
              warnings.push(`${ctx}: menu option "${label}" is wider than ${MENU_LABEL_MAX_CHARS} characters and will be clipped on screen`);
            }
            emit(internRaw(label, ctx));
          }
          break;
        }
        case 'SET_ACTOR_SPRITE': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Sprite');
          if (idx < 0) break;
          const spriteIdx = project.sprites.findIndex((s) => s.id === ev.spriteId);
          if (spriteIdx < 0) { warnings.push(`${ctx}: Set Actor Sprite has no sprite selected — skipped`); break; }
          emit(OP.SET_ACTOR_SPRITE, idx, spriteIdx);
          break;
        }
        case 'ATTACH_SCRIPT': {
          if (!ev.script || !ev.script.length) {
            warnings.push(`${ctx}: Attach Script To Button has an empty script — skipped`);
            break;
          }
          const btn = buttonIndex(ev.button);
          const scriptIdx = addScript(ev.script, scene, `${ctx} → ${ev.button.toUpperCase()} button script`);
          emit(OP.ATTACH_SCRIPT, btn, ev.override ? ATTACH_OVERRIDE : 0, scriptIdx);
          break;
        }
        case 'REMOVE_BUTTON_SCRIPT':
          emit(OP.REMOVE_BUTTON_SCRIPT, buttonIndex(ev.button));
          break;
        case 'WAIT_INPUT': {
          const mask = byte(ev.mask) & 0x3f;
          if (!mask) { warnings.push(`${ctx}: Pause Script Until Input Pressed has no buttons selected — skipped`); break; }
          emit(OP.WAIT_INPUT, mask);
          break;
        }
        case 'IF_INPUT': {
          const mask = byte(ev.mask) & 0x3f;
          if (!mask) { warnings.push(`${ctx}: If Joypad Input Held has no buttons selected — skipped`); break; }
          emit(OP.IF_INPUT, mask);
          const elsePatch = code.length; emitU16(0);
          compileEvents(ev.then, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'CHOICE': {
          // A two-option menu in the dialogue layout, where the last option
          // yields 0 — exactly "first = true (1), second = false (0)".
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Display Multiple Choice has no variable selected — skipped`); break; }
          for (const label of [ev.trueLabel, ev.falseLabel]) {
            if (displayWidth(substituteVars(String(label), ctx)) > MENU_LABEL_MAX_CHARS) {
              warnings.push(`${ctx}: choice option "${label}" is wider than ${MENU_LABEL_MAX_CHARS} characters and will be clipped on screen`);
            }
          }
          emit(OP.MENU, idx, 2, MENU_LAST_IS_ZERO | MENU_LAYOUT_DIALOGUE);
          emit(internRaw(ev.trueLabel, ctx));
          emit(internRaw(ev.falseLabel, ctx));
          break;
        }
        case 'SET_ACTOR_DIR': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Direction');
          if (idx < 0) break;
          emit(OP.SET_ACTOR_DIR, idx, directionCode(ev.direction));
          break;
        }
        case 'SET_ACTOR_SPEED': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Movement Speed');
          if (idx < 0) break;
          // The player walks tile-by-tile rather than at a pixel speed, so there
          // is nothing for this to set. Say so instead of emitting an opcode the
          // runtimes would quietly ignore.
          if (idx === ACTOR_REF_PLAYER) {
            warnings.push(`${ctx}: Set Actor Movement Speed cannot target the player — skipped`);
            break;
          }
          const speed = ACTOR_SPEEDS.some((s) => s.value === ev.speed) ? ev.speed : 1;
          emit(OP.SET_ACTOR_SPEED, idx, speed);
          break;
        }
        case 'ACTOR_EFFECT': {
          const idx = actorTarget(ev, scene, ctx, 'Actor Effects');
          if (idx < 0) break;
          emit(OP.ACTOR_EFFECT, idx, effectCode(ev.effect), byte(ev.frames || 30));
          break;
        }
        case 'LAUNCH_PROJECTILE': {
          const spriteIdx = project.sprites.findIndex((s) => s.id === ev.spriteId);
          if (spriteIdx < 0) { warnings.push(`${ctx}: Launch Projectile has no sprite selected — skipped`); break; }
          let src = PROJECTILE_SRC_SELF;
          if (ev.source === 'player') src = PROJECTILE_SRC_PLAYER;
          else if (ev.source && ev.source !== 'self') {
            src = scene ? scene.actors.findIndex((a) => a.id === ev.source) : -1;
            if (src < 0) { warnings.push(`${ctx}: Launch Projectile source actor is not in this scene — skipped`); break; }
          }
          let dir = PROJECTILE_DIR_SOURCE;
          if (ev.direction && ev.direction !== 'source') {
            const d = PROJECTILE_DIRS.find((x) => x.key === ev.direction);
            if (!d) { warnings.push(`${ctx}: Launch Projectile has an unknown direction — skipped`); break; }
            dir = d.code;
          }
          const speed = Math.max(1, Math.min(8, ev.speed | 0 || 2));
          const life = Math.max(1, Math.min(255, ev.life | 0 || 60));
          emit(OP.LAUNCH_PROJECTILE, src, spriteIdx, dir, speed, life, byte(ev.collideWith) & 0x0f);
          break;
        }
        case 'PUSH_SCENE': {
          const idx = sceneIndex.get(ev.sceneId);
          if (idx === undefined) { warnings.push(`${ctx}: Push Scene points at a missing scene — skipped`); break; }
          const target = project.scenes[idx];
          emit(OP.PUSH_SCENE, idx, clampTile(ev.x, sceneCols(target)), clampTile(ev.y, sceneRows(target)),
            fadeSpeed(ev.fade));
          break;
        }
        case 'POP_SCENE':
          emit(OP.POP_SCENE, fadeSpeed(ev.fade));
          break;
        case 'POP_ALL_SCENES':
          emit(OP.POP_ALL_SCENES, fadeSpeed(ev.fade));
          break;
        case 'FADE_IN':
          emit(OP.FADE_IN, fadeSpeed(ev.fade));
          break;
        case 'FADE_OUT':
          emit(OP.FADE_OUT, fadeSpeed(ev.fade));
          break;
        case 'IF_ACTOR_AT': {
          const idx = actorTarget(ev, scene, ctx, 'If Actor At Position');
          if (idx < 0) break;
          emit(OP.IF_ACTOR_AT, idx, clampTile(ev.x, cols(scene)), clampTile(ev.y, rows(scene)));
          const elsePatch = code.length; emitU16(0);
          compileEvents(ev.then, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'IF_ACTOR_DISTANCE': {
          const idx = actorTarget(ev, scene, ctx, 'If Actor Distance From Actor');
          if (idx < 0) break;
          const from = actorRef(ev.from, scene, ctx, 'If Actor Distance From Actor "from"');
          if (from < 0) break;
          // Squared, so the runtimes compare without a square root. Ordering is
          // preserved because a distance is never negative.
          const d = Math.max(0, Math.min(MAX_ACTOR_DISTANCE, ev.distance | 0));
          const dSq = d * d;
          emit(OP.IF_ACTOR_DISTANCE, idx, CMP[ev.cmp] ?? 0, dSq & 0xff, (dSq >> 8) & 0xff, from);
          const elsePatch = code.length; emitU16(0);
          compileEvents(ev.then, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'STORE_ACTOR_DIR': {
          const idx = actorTarget(ev, scene, ctx, 'Store Actor Direction');
          if (idx < 0) break;
          const v = varIndex.get(ev.varId);
          if (v === undefined) { warnings.push(`${ctx}: Store Actor Direction has no variable selected — skipped`); break; }
          emit(OP.STORE_ACTOR_DIR, idx, v);
          break;
        }
        case 'STORE_ACTOR_POS': {
          const idx = actorTarget(ev, scene, ctx, 'Store Actor Position');
          if (idx < 0) break;
          const vx = varIndex.get(ev.varX);
          const vy = varIndex.get(ev.varY);
          if (vx === undefined || vy === undefined) {
            warnings.push(`${ctx}: Store Actor Position needs both an X and a Y variable — skipped`);
            break;
          }
          if (vx === vy) {
            warnings.push(`${ctx}: Store Actor Position writes X and Y into the same variable — Y will overwrite X`);
          }
          emit(OP.STORE_ACTOR_POS, idx, vx, vy);
          break;
        }
        case 'EXPR_SET': {
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Evaluate Math Expression has no variable selected — skipped`); break; }
          const expr = compileExpr(ev.expression, ctx, 'Evaluate Math Expression');
          if (!expr) break;
          emit(OP.EXPR_SET, idx, expr.length, ...expr);
          break;
        }
        case 'MATH_FN': {
          // Sugar over EXPR_SET: build the expression bytes by hand so there is
          // only ever one implementation of the arithmetic — including the
          // divide/modulus-by-zero rule — shared with the evaluator.
          const idx = varIndex.get(ev.varId);
          if (idx === undefined) { warnings.push(`${ctx}: Math Functions has no variable selected — skipped`); break; }
          const opDef = MATH_OPS.find((o) => o.key === ev.op);
          if (!opDef) { warnings.push(`${ctx}: Math Functions has an unknown operation — skipped`); break; }

          const operand = [];
          if (ev.srcKind === 'variable') {
            const src = varIndex.get(ev.srcVarId);
            if (src === undefined) { warnings.push(`${ctx}: Math Functions has no source variable selected — skipped`); break; }
            operand.push(EX.PUSH_VAR, src);
          } else {
            const n = byte(ev.value);
            operand.push(EX.PUSH_CONST, n & 0xff, (n >> 8) & 0xff);
            // rnd(n) yields 0…n-1, so a bound of 0 could never produce anything.
            if (ev.srcKind === 'random') {
              if (n < 1) { warnings.push(`${ctx}: Math Functions random needs a bound of at least 1 — skipped`); break; }
              operand.push(EX.RND);
            }
          }

          const BINOP = { add: EX.ADD, sub: EX.SUB, mul: EX.MUL, div: EX.DIV, mod: EX.MOD };
          const expr = ev.op === 'set'
            ? operand
            : [EX.PUSH_VAR, idx, ...operand, BINOP[ev.op]];
          if (expr.length > MAX_EXPR_BYTES) { warnings.push(`${ctx}: Math Functions is too complex — skipped`); break; }
          emit(OP.EXPR_SET, idx, expr.length, ...expr);
          break;
        }
        case 'EXPR_IF': {
          const expr = compileExpr(ev.expression, ctx, 'If Math Expression');
          if (!expr) break;
          emit(OP.EXPR_IF, expr.length, ...expr);
          const elsePatch = code.length; emitU16(0);
          compileEvents(ev.then, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          const endPatch = code.length; emitU16(0);
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'EXPR_LOOP': {
          const expr = compileExpr(ev.expression, ctx, 'Loop While Math Expression');
          if (!expr) break;
          const top = code.length;
          emit(OP.EXPR_LOOP, expr.length, ...expr);
          const endPatch = code.length; emitU16(0);
          compileEvents(ev.events, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          emitU16(top); // back to re-test the condition
          patchU16(code, endPatch, code.length);
          break;
        }
        case 'LOOP': {
          if (!ev.events || !ev.events.length) {
            warnings.push(`${ctx}: Loop is empty — skipped`);
            break;
          }
          if (neverYields(ev.events)) {
            warnings.push(`${ctx}: Loop never finishes — nothing in it pauses or stops the script, so the game will freeze here. Add a Wait, or a Stop Script / Change Scene to break out.`);
          }
          const top = code.length;
          compileEvents(ev.events, scene, ctx, nonBlocking);
          emit(OP.JUMP);
          emitU16(top);
          break;
        }
        case 'SEED_RNG':
          emit(OP.SEED_RNG);
          break;
        case 'SWITCH': {
          const v = varIndex.get(ev.varId);
          if (v === undefined) { warnings.push(`${ctx}: Switch has no variable selected — skipped`); break; }
          const cases = (ev.cases || []).slice(0, MAX_SWITCH_CASES);
          if (!cases.length) { warnings.push(`${ctx}: Switch has no options — skipped`); break; }
          const seen = new Set();
          for (const c of cases) {
            const value = byte(c.value);
            if (seen.has(value)) {
              warnings.push(`${ctx}: Switch tests ${value} more than once — only the first of those options can ever run`);
            }
            seen.add(value);
          }
          // A jump table: constant-time, and smaller than a chain of compares.
          emit(OP.SWITCH, v, cases.length);
          const casePatches = [];
          for (const c of cases) {
            emit(byte(c.value));
            casePatches.push(code.length);
            emitU16(0);
          }
          const elsePatch = code.length; emitU16(0);
          const endPatches = [];
          cases.forEach((c, i) => {
            patchU16(code, casePatches[i], code.length);
            compileEvents(c.events, scene, ctx, nonBlocking);
            emit(OP.JUMP);
            endPatches.push(code.length);
            emitU16(0);
          });
          patchU16(code, elsePatch, code.length);
          compileEvents(ev.else, scene, ctx, nonBlocking);
          for (const p of endPatches) patchU16(code, p, code.length);
          break;
        }
        case 'SET_ANIM_FRAME': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Animation Frame');
          if (idx < 0) break;
          emit(OP.SET_ANIM_FRAME, idx, byte(ev.frame));
          break;
        }
        case 'SET_ANIM_SPEED': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Animation Speed');
          if (idx < 0) break;
          const speed = ANIM_SPEEDS.some((s) => s.value === ev.speed) ? ev.speed : 20;
          emit(OP.SET_ANIM_SPEED, idx, speed);
          break;
        }
        case 'SET_ANIM_STATE': {
          const idx = actorTarget(ev, scene, ctx, 'Set Actor Animation State');
          if (idx < 0) break;
          // The state belongs to whichever sprite the actor is showing, so it
          // is resolved by position within that sprite's state list.
          const stateIdx = spriteStateIndex(ev, scene, idx, ctx);
          if (stateIdx < 0) break;
          emit(OP.SET_ANIM_STATE, idx, stateIdx, ev.loop ? 1 : 0);
          break;
        }
        case 'SHOW_OVERLAY':
          emit(OP.SHOW_OVERLAY, ev.fill === 'white' ? 1 : 0,
            clampByte(ev.x, 0, SCENE_W), clampByte(ev.y, 0, SCENE_H));
          break;
        case 'HIDE_OVERLAY':
          emit(OP.HIDE_OVERLAY);
          break;
        case 'OVERLAY_MOVE': {
          const speed = OVERLAY_SPEEDS.some((s) => s.value === ev.speed) ? ev.speed : 1;
          emit(OP.OVERLAY_MOVE, clampByte(ev.x, 0, SCENE_W), clampByte(ev.y, 0, SCENE_H), speed);
          break;
        }
        case 'OVERLAY_CUTOFF':
          emit(OP.OVERLAY_CUTOFF, clampByte(ev.y, 0, 64));
          break;
        case 'DRAW_TEXT': {
          const text = String(ev.text || '');
          if (!text) { warnings.push(`${ctx}: Draw Text has no text — skipped`); break; }
          // Drawn text is positioned by hand, so it must not be word-wrapped
          // the way dialogue is; it shares the string table all the same.
          emit(OP.DRAW_TEXT, internRaw(text, ctx),
            clampByte(ev.x, 0, 255), clampByte(ev.y, 0, 255),
            ev.location === 'overlay' ? DRAW_TEXT_OVERLAY : DRAW_TEXT_BACKGROUND);
          break;
        }
        // Editor-only: a comment carries no behaviour and emits nothing.
        case 'COMMENT':
          break;
        // Purely organisational — its children compile straight into the parent.
        case 'START_SCRIPT': {
          // Hands the target to the blocking VM and carries straight on, which
          // is what makes it legal in On Update — the one way a per-frame script
          // can begin something that pauses.
          const ref = scene ? scriptRefs.get(scriptRefKey(scene.id, ev.target, ev.slot)) : null;
          if (!ref) {
            warnings.push(`${ctx}: Start Script names a script that is not in this scene — skipped`);
            break;
          }
          if (ref.idx === NO_SCRIPT) {
            warnings.push(`${ctx}: Start Script points at an empty script — skipped`);
            break;
          }
          emit(OP.START_SCRIPT);
          emitU16(ref.idx);
          emit(ref.self);
          break;
        }
        case 'EVENT_GROUP':
          compileEvents(ev.events, scene, ctx, nonBlocking);
          break;
        case 'END_SCRIPT':
          emit(OP.END);
          break;
        default:
          warnings.push(`${ctx}: unknown event ${ev.type} — skipped`);
      }
    }
  }

  // Scripts are compiled through a queue rather than inline. compileEvents()
  // appends to a single `code` array, so compiling a nested script (an Attach
  // Script To Button body) from inside it would splice that script's bytes into
  // the middle of its parent. Reserving the index up front lets ATTACH_SCRIPT
  // emit a reference immediately, while the offset is filled in on drain.
  const scriptOffsets = [];
  const pendingScripts = [];
  function addScript(events, scene, ctx, nonBlocking, owner = ownerActor) {
    if (!events || !events.length) return NO_SCRIPT;
    const idx = scriptOffsets.length;
    if (idx >= 255) throw new Error('Too many scripts (max 255)');
    scriptOffsets.push(0); // patched in drainScripts()
    pendingScripts.push({ idx, events, scene, ctx, nonBlocking, owner });
    return idx;
  }
  function drainScripts() {
    while (pendingScripts.length) {
      const job = pendingScripts.shift();
      scriptOffsets[job.idx] = code.length;
      ownerActor = job.owner || null;
      compileEvents(job.events, job.scene, job.ctx, job.nonBlocking);
      emit(OP.END);
    }
    ownerActor = null;
  }

  // Every slot Start Script can name, keyed by scene + entity + slot. Filled in
  // as the scene walk reserves indices, which all happens before drainScripts()
  // compiles a single body — so a Start Script can point at any slot in its
  // scene, including one belonging to an entity defined after it.
  const scriptRefs = new Map(); // "sceneId|entityId|slot" -> { idx, self }
  const scriptRefKey = (sceneId, entityId, slot) => `${sceneId}|${entityId}|${slot}`;

  // Register every lifecycle slot of one entity, returning { slotKey: index }.
  // `refId`/`selfIdx` record how a Start Script would reach these slots: an
  // actor's script runs with that actor as Self, everything else with none.
  function addSlots(entity, slots, scene, what, owner = null, refId = null, selfIdx = ACTOR_REF_SELF) {
    const out = {};
    for (const { key, label } of slots) {
      out[key] = addScript(entity.scripts[key], scene, `${what} ${label}`,
        NON_BLOCKING_SLOTS.includes(key), owner);
      if (refId !== null) {
        scriptRefs.set(scriptRefKey(scene.id, refId, key), { idx: out[key], self: selfIdx });
      }
    }
    return out;
  }

  const scenes = project.scenes.map((scene, si) => {
    const cw = sceneCols(scene), ch = sceneRows(scene);
    const where = `in "${scene.name}"`;
    const sceneSlots = addSlots(scene, SCENE_SCRIPT_SLOTS, scene, `Scene "${scene.name}"`, null, 'scene');
    const actors = scene.actors.map((a, ai) => {
      const sprite = spriteById(project, a.spriteId);
      let spriteIdx = project.sprites.indexOf(sprite);
      if (spriteIdx < 0) { warnings.push(`Actor "${a.name}" ${where} has no sprite — using sprite 0`); spriteIdx = 0; }
      const slots = addSlots(a, ACTOR_SCRIPT_SLOTS, scene, `Actor "${a.name}" ${where}`, a, a.id, ai);
      const group = collisionGroupCode(a.collisionGroup);
      if (!group && a.collideWith) {
        warnings.push(`Actor "${a.name}" ${where} collides with something but is in no collision group — it can still be hit, but nothing can be hit by it`);
      }
      return {
        spriteIdx,
        x: clampTile(a.x, cw),
        y: clampTile(a.y, ch),
        movement: MOVEMENT_CODES[a.movement] ?? 0,
        solid: a.solid ? 1 : 0,
        animate: a.animate ? 1 : 0,
        facing: directionCode(a.facing),
        speed: ACTOR_SPEEDS.some((s) => s.value === a.speed) ? a.speed : 1,
        animSpeed: Number.isFinite(a.animSpeed) ? Math.max(0, Math.min(255, a.animSpeed | 0)) : 20,
        group,
        collideWith: byte(a.collideWith) & 0x0f,
        scripts: slots,
      };
    });
    const triggers = scene.triggers.map((t) => ({
      x: clampTile(t.x, cw),
      y: clampTile(t.y, ch),
      w: Math.max(1, Math.min(cw, t.w | 0)),
      h: Math.max(1, Math.min(ch, t.h | 0)),
      scripts: addSlots(t, TRIGGER_SCRIPT_SLOTS, scene, `Trigger "${t.name}" ${where}`, null, t.id),
    }));
    return {
      name: scene.name, index: si, cols: cw, rows: ch,
      tiles: scene.tiles.slice(), actors, triggers, scripts: sceneSlots,
    };
  });

  drainScripts();

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
    states: (s.states || []).slice(0, MAX_SPRITE_STATES).map((st) => ({
      name: st.name,
      from: Math.max(0, Math.min(s.frames.length - 1, st.from | 0)),
      to: Math.max(0, Math.min(s.frames.length - 1, st.to | 0)),
    })),
  }));

  const songs = (project.songs || []).map((s) => ({
    name: s.name,
    notes: s.notes.map((n) => ({ f: n.f, d: n.d })),
  }));

  // Which optional engine subsystems this game actually uses. The generated
  // sketch guards each one, so a game pays flash and RAM only for what it
  // scripts — the ATmega32u4's ~28 KB does not stretch to everything at once.
  const usedOps = new Set(code);
  const uses = (...ops) => ops.some((op) => usedOps.has(op));
  const features = {
    OVERLAY: uses(OP.SHOW_OVERLAY, OP.HIDE_OVERLAY, OP.OVERLAY_MOVE, OP.OVERLAY_CUTOFF, OP.DRAW_TEXT),
    EXPR: uses(OP.EXPR_IF, OP.EXPR_LOOP, OP.EXPR_SET),
    SWITCH: uses(OP.SWITCH),
    SAVES: uses(OP.SAVE_GAME, OP.LOAD_GAME, OP.SAVE_CHECK, OP.DELETE_SAVE),
    SONGS: uses(OP.PLAY_SONG, OP.STOP_SONG) && songs.length > 0,
    MENUS: uses(OP.MENU),
    BUTTON_SCRIPTS: uses(OP.ATTACH_SCRIPT, OP.REMOVE_BUTTON_SCRIPT),
    SCENE_STACK: uses(OP.PUSH_SCENE, OP.POP_SCENE, OP.POP_ALL_SCENES),
    FADE: uses(OP.FADE_IN, OP.FADE_OUT, OP.PUSH_SCENE, OP.POP_SCENE, OP.POP_ALL_SCENES),
    LED: uses(OP.SET_LED),
    TEXT_VARS: usesTextVars,
    EFFECTS: uses(OP.ACTOR_EFFECT),
    // Projectiles imply collisions; collisions also come from any On Hit script.
    PROJECTILES: uses(OP.LAUNCH_PROJECTILE),
    COLLISIONS: uses(OP.LAUNCH_PROJECTILE)
      || scenes.some((sc) => sc.actors.some((a) => a.group !== 0)),
    UPDATE_SCRIPTS: scenes.some((sc) => sc.actors.some((a) => a.scripts.update !== NO_SCRIPT)),
  };

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
    features,
    warnings,
  };
}

function clampTile(v, max) { return Math.max(0, Math.min(max - 1, v | 0)); }
function clampByte(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }
function byte(v) { return Math.max(0, Math.min(255, v | 0)); }
function int8byte(v) { const c = Math.max(-128, Math.min(127, v | 0)); return c & 0xff; }
function patchU16(code, at, value) { code[at] = value & 0xff; code[at + 1] = (value >> 8) & 0xff; }
