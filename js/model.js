// ArduStudio project data model.
//
// A project is plain JSON so it can be saved/loaded/versioned freely.
// Pixel art is stored as strings of '.' (black) and '#' (white) rows —
// human-readable in saved files and cheap to edit programmatically.
//
// Coordinate system: scenes are 16x8 tiles of 8x8 pixels = 128x64,
// exactly one Arduboy screen (Bitsy-style single-screen rooms).

export const SCENE_W = 16; // tiles per screen, horizontally
export const SCENE_H = 8;  // tiles per screen, vertically
export const TILE = 8;     // pixels
export const MAX_SCREENS = 4;   // max screens per axis for a scrolling scene
export const MAX_ACTORS_PER_SCENE = 8;
export const MAX_TRIGGERS_PER_SCENE = 8;
export const MAX_VARIABLES = 32;
export const MAX_TILES = 64;
export const MAX_SPRITES = 32;
export const MAX_FRAMES = 4;
export const MAX_SONGS = 32;
export const MAX_SONG_NOTES = 192;
export const MAX_MENU_OPTIONS = 8;
// True/false flags packed into one byte variable. Variables are bytes, so eight.
export const VAR_FLAGS = 8;

// The Arduboy's six buttons. Bit values match BTN in emulator.js; the generated
// sketch maps them to Arduboy2's own constants, whose bit layout differs by
// board variant. There is no Start or Select button on an Arduboy.
export const BUTTONS = [
  { key: 'left', label: '◀', bit: 1 },
  { key: 'up', label: '▲', bit: 4 },
  { key: 'down', label: '▼', bit: 8 },
  { key: 'right', label: '▶', bit: 2 },
  { key: 'a', label: 'A', bit: 16 },
  { key: 'b', label: 'B', bit: 32 },
];
// Bytecode order (index used by ATTACH_SCRIPT / REMOVE_BUTTON_SCRIPT).
export const BUTTON_ORDER = ['left', 'right', 'up', 'down', 'a', 'b'];
export function buttonIndex(key) { return Math.max(0, BUTTON_ORDER.indexOf(key)); }

// ---------------------------------------------------------------------------
// Actor behaviour
// ---------------------------------------------------------------------------

// Which way an actor faces. The code is what goes into the bytecode — and what
// Store Actor Direction In Variable writes, so it follows the numbering game
// logic is expected to branch on: Down 0, Right 1, Up 2, Left 3.
export const DIRECTIONS = [
  { key: 'down', label: '▼ Down', code: 0, dx: 0, dy: 1 },
  { key: 'right', label: '▶ Right', code: 1, dx: 1, dy: 0 },
  { key: 'up', label: '▲ Up', code: 2, dx: 0, dy: -1 },
  { key: 'left', label: '◀ Left', code: 3, dx: -1, dy: 0 },
];
export function directionCode(key) {
  const d = DIRECTIONS.find((x) => x.key === key);
  return d ? d.code : 0;
}

// Projectiles fly in eight directions. Arbitrary angles would mean sin/cos on
// an ATmega32u4 — expensive in both flash and cycles for no visible gain at
// 128x64 — so the compiler resolves a direction to a dx/dy pair up front.
// The first four share the DIRECTIONS numbering, so an actor's facing maps
// straight through to a projectile direction.
export const PROJECTILE_DIRS = [
  { key: 'down', label: '▼ Down', code: 0, dx: 0, dy: 1 },
  { key: 'right', label: '▶ Right', code: 1, dx: 1, dy: 0 },
  { key: 'up', label: '▲ Up', code: 2, dx: 0, dy: -1 },
  { key: 'left', label: '◀ Left', code: 3, dx: -1, dy: 0 },
  { key: 'upLeft', label: '◤ Up-left', code: 4, dx: -1, dy: -1 },
  { key: 'upRight', label: '◥ Up-right', code: 5, dx: 1, dy: -1 },
  { key: 'downLeft', label: '◣ Down-left', code: 6, dx: -1, dy: 1 },
  { key: 'downRight', label: '◢ Down-right', code: 7, dx: 1, dy: 1 },
];
// 0xFF asks the runtime to use the launching actor's own facing instead.
export const PROJECTILE_DIR_SOURCE = 0xff;

// Movement speed in pixels per frame. 0 is the special "half speed" code:
// one pixel every other frame, for actors that should drift.
export const ACTOR_SPEEDS = [
  { value: 0, label: '½ px/frame' },
  { value: 1, label: '1 px/frame' },
  { value: 2, label: '2 px/frame' },
  { value: 3, label: '3 px/frame' },
  { value: 4, label: '4 px/frame' },
];

// Math Functions. Each operation is the expression operator it compiles to, so
// the event is pure sugar over the same evaluator "Evaluate Math Expression"
// uses — there is only ever one implementation of the arithmetic.
export const MATH_OPS = [
  { key: 'set', label: 'Set To', symbol: '=' },
  { key: 'add', label: 'Add', symbol: '+' },
  { key: 'sub', label: 'Subtract', symbol: '-' },
  { key: 'mul', label: 'Multiply', symbol: '*' },
  { key: 'div', label: 'Divide', symbol: '/' },
  { key: 'mod', label: 'Modulus', symbol: '%' },
];

// Where a Math Functions operand comes from.
export const MATH_SOURCES = [
  { key: 'number', label: 'Number' },
  { key: 'variable', label: 'Variable' },
  { key: 'random', label: 'Random' },
];

export const ACTOR_EFFECTS = [
  { key: 'flicker', label: 'Flicker', code: 1 },
  { key: 'shake', label: 'Shake', code: 2 },
];
export function effectCode(key) {
  const e = ACTOR_EFFECTS.find((x) => x.key === key);
  return e ? e.code : 1;
}

// ---------------------------------------------------------------------------
// Collision groups
// ---------------------------------------------------------------------------

// An actor belongs to at most one group. Anything that can collide carries a
// mask of the groups it reacts to; the player is always group "player".
export const COLLISION_GROUPS = [
  { key: 'none', label: 'None', code: 0 },
  { key: '1', label: 'Group 1', code: 1 },
  { key: '2', label: 'Group 2', code: 2 },
  { key: '3', label: 'Group 3', code: 3 },
];
export function collisionGroupCode(key) {
  const g = COLLISION_GROUPS.find((x) => x.key === key);
  return g ? g.code : 0;
}

// Bits in a collideWith mask.
export const COLLIDE_TARGETS = [
  { key: 'player', label: 'Player', bit: 1 },
  { key: '1', label: 'Group 1', bit: 2 },
  { key: '2', label: 'Group 2', bit: 4 },
  { key: '3', label: 'Group 3', bit: 8 },
];
export const COLLIDE_PLAYER = 1;
// Bit for a group code (1..3); group 0 ("none") collides with nothing.
export function groupBit(code) { return code ? (1 << code) : 0; }

// ---------------------------------------------------------------------------
// Runtime limits shared by both engines
// ---------------------------------------------------------------------------

export const MAX_PROJECTILES = 6;   // pool size, ~12 bytes of RAM each
export const SCENE_STACK_DEPTH = 8; // Push Scene nesting, 3 bytes per entry
export const FADE_LEVELS = 16;      // 4x4 Bayer dither steps, 0 = fully visible

// ---------------------------------------------------------------------------
// Script lifecycle slots
// ---------------------------------------------------------------------------
//
// Every entity carries several named scripts rather than one. The key is what
// is stored in the project file and compiled; the label and hint drive the tab
// strip in the inspector.

export const SCENE_SCRIPT_SLOTS = [
  { key: 'init', label: 'On Init', hint: 'Runs every time the scene loads, after each actor\'s own On Init.' },
  { key: 'playerHit', label: 'On Player Hit', hint: 'Runs when the player touches an actor that has a collision group but no On Hit script of its own.' },
];

export const ACTOR_SCRIPT_SLOTS = [
  { key: 'interact', label: 'On Interact', hint: 'Runs when the player faces this actor and presses A.' },
  { key: 'init', label: 'On Init', hint: 'Runs once when the scene loads, before the scene\'s own On Init.' },
  { key: 'hit', label: 'On Hit', hint: 'Runs when something this actor collides with touches it.' },
  { key: 'update', label: 'On Update', hint: 'Runs every frame and must finish in that frame — no waits, dialogue or menus.' },
];

export const TRIGGER_SCRIPT_SLOTS = [
  { key: 'enter', label: 'On Enter', hint: 'Runs when the player steps into the area.' },
  { key: 'leave', label: 'On Leave', hint: 'Runs when the player steps back out of it.' },
];

// Slots that run outside the blocking script VM, so blocking events are
// meaningless in them. The compiler warns and skips those events.
export const NON_BLOCKING_SLOTS = ['update'];

// Event fields that hold a nested event list (branches, button bodies).
export const NESTED_EVENT_LISTS = ['then', 'else', 'script', 'events'];

// Visit every event in a list, descending into nested lists.
export function forEachEvent(events, fn) {
  for (const ev of events || []) {
    fn(ev);
    for (const key of NESTED_EVENT_LISTS) {
      if (Array.isArray(ev[key])) forEachEvent(ev[key], fn);
    }
    // Switch keeps a script per case rather than one nested list.
    if (Array.isArray(ev.cases)) {
      for (const c of ev.cases) forEachEvent(c.events, fn);
    }
  }
}

// Event fields that name an actor: 'self', 'player', or a scene actor's id.
export const ACTOR_REF_FIELDS = ['target', 'source', 'from'];

// Deep-copy a list of events (or a whole actor) and give every id in it a fresh
// one, so the copy is independent of the original. Used by copy/paste, where
// two entities sharing an id would collide in collapse state and undo.
export function cloneWithNewIds(node) {
  const copy = JSON.parse(JSON.stringify(node));
  const reid = (obj, prefix) => { if (obj && obj.id) obj.id = uid(prefix); };
  if (Array.isArray(copy)) {
    forEachEvent(copy, (ev) => reid(ev, 'ev'));
  } else {
    reid(copy, copy.scripts ? 'actor' : 'ev');
    if (copy.scripts) {
      for (const list of Object.values(copy.scripts)) forEachEvent(list, (ev) => reid(ev, 'ev'));
    } else {
      forEachEvent([copy], (ev) => reid(ev, 'ev'));
    }
  }
  return copy;
}

// Point every actor reference in these events at something that exists in
// `scene`, rewriting the ones that do not to 'self'. Pasting into a different
// scene is the case that needs it: an id from the source scene means nothing
// here, and left alone it would compile to a skipped event with only a warning
// at export time. Returns how many were rewritten so the caller can say so.
export function retargetActorRefs(events, scene) {
  const known = new Set((scene ? scene.actors : []).map((a) => a.id));
  let reset = 0;
  forEachEvent(events, (ev) => {
    for (const key of ACTOR_REF_FIELDS) {
      const v = ev[key];
      if (typeof v !== 'string' || v === 'self' || v === 'player' || v === '') continue;
      if (known.has(v)) continue;
      ev[key] = 'self';
      reset++;
    }
  });
  return reset;
}

// Fields whose contents can name a variable as "$name": the text drawn on
// screen, and the two math-expression events.
export const TEXT_FIELDS_WITH_VARS = ['text', 'expression', 'trueLabel', 'falseLabel'];

// Rewrite every "$old" reference to "$new" across a project's text and
// expressions. These name variables rather than pointing at them, so without
// this a rename would quietly break every sentence and condition that mentions
// the variable. Leaves "$$old" alone (an escaped dollar) and "$oldish" alone
// (a different name that merely starts the same way).
export function renameVariableReferences(project, oldName, newName) {
  if (!oldName || oldName === newName) return 0;
  const bare = new RegExp(`(^|[^$])\\$${oldName}\\b`, 'g');
  const braced = new RegExp(`(^|[^$])\\$\\{${oldName}\\}`, 'g');
  const swap = (str) => String(str)
    .replace(bare, `$1$$${newName}`)
    .replace(braced, `$1$\{${newName}}`);
  let changed = 0;
  const visit = (ev) => {
    for (const key of TEXT_FIELDS_WITH_VARS) {
      if (typeof ev[key] !== 'string') continue;
      const next = swap(ev[key]);
      if (next !== ev[key]) { ev[key] = next; changed++; }
    }
    if (Array.isArray(ev.options)) {
      ev.options = ev.options.map((o) => {
        const next = swap(o);
        if (next !== o) changed++;
        return next;
      });
    }
  };
  for (const sc of project.scenes) {
    for (const { events } of sceneScripts(sc)) forEachEvent(events, visit);
  }
  return changed;
}

// Every top-level script list in a scene, with a label describing where it
// came from. One place to add a slot, so nothing silently misses a script.
export function sceneScripts(scene) {
  const out = [];
  for (const { key, label } of SCENE_SCRIPT_SLOTS) {
    out.push({ events: scene.scripts[key], slot: key, label: `Scene "${scene.name}" ${label}` });
  }
  for (const a of scene.actors) {
    for (const { key, label } of ACTOR_SCRIPT_SLOTS) {
      out.push({ events: a.scripts[key], slot: key, label: `Actor "${a.name}" ${label}`, actor: a });
    }
  }
  for (const t of scene.triggers) {
    for (const { key, label } of TRIGGER_SCRIPT_SLOTS) {
      out.push({ events: t.scripts[key], slot: key, label: `Trigger "${t.name}" ${label}`, trigger: t });
    }
  }
  return out;
}

// Tile dimensions of a scene (scenes can span multiple screens and scroll).
export function sceneCols(scene) { return SCENE_W * (scene.screensX || 1); }
export function sceneRows(scene) { return SCENE_H * (scene.screensY || 1); }

let idCounter = 0;
export function uid(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

export function blankPixels(w, h) {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

export function getPixel(pixels, x, y) {
  const row = pixels[y];
  return row && row[x] === '#' ? 1 : 0;
}

export function setPixel(pixels, x, y, on) {
  if (y < 0 || y >= pixels.length || x < 0 || x >= pixels[y].length) return;
  const row = pixels[y].split('');
  row[x] = on ? '#' : '.';
  pixels[y] = row.join('');
}

// Convert row-string pixels to Arduboy vertical-byte format.
// Each byte covers 8 vertical pixels (bit0 = top), columns left→right,
// then the next 8-pixel "page" row. This is the format Arduboy2's
// drawBitmap()/Sprites expect and what the community converters emit.
export function pixelsToBytes(pixels, w, h) {
  const pages = Math.ceil(h / 8);
  const out = new Uint8Array(pages * w);
  let i = 0;
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < w; x++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y < h && getPixel(pixels, x, y)) b |= 1 << bit;
      }
      out[i++] = b;
    }
  }
  return out;
}

export function bytesToPixels(bytes, w, h) {
  const pixels = blankPixels(w, h);
  const pages = Math.ceil(h / 8);
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < w; x++) {
      const b = bytes[page * w + x] || 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y < h) setPixel(pixels, x, y, (b >> bit) & 1);
      }
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Entity factories
// ---------------------------------------------------------------------------

export function makeTile(name, rows, solid = false) {
  return { id: uid('tile'), name, solid, pixels: rows || blankPixels(8, 8) };
}

export function makeSprite(name, frames, w = 8, h = 8) {
  const f = frames && frames.length ? frames : [blankPixels(w, h)];
  return {
    id: uid('spr'),
    name,
    width: w,
    height: h,
    frames: f,
    // Named ranges of frames an actor can play. Every sprite has a Default
    // state spanning all of them, so the picker is never empty.
    states: [makeSpriteState('Default', 0, f.length - 1)],
  };
}

export function makeSpriteState(name, from, to) {
  return { id: uid('state'), name, from, to };
}

export const MAX_SPRITE_STATES = 4;

export function makeActor(name, spriteId, x, y) {
  return {
    id: uid('actor'),
    name,
    spriteId,
    x, y,                 // tile coords
    movement: 'static',   // static | wander | patrolH | patrolV
    solid: true,          // blocks the player / can be interacted with
    animate: true,        // cycle frames
    facing: 'down',       // which way it points (drives Launch Projectile)
    speed: 1,             // pixels per frame; 0 = half speed
    animSpeed: 20,        // frames between animation steps; 0 = frozen
    collisionGroup: 'none',
    collideWith: 0,       // bitmask of COLLIDE_TARGETS
    scripts: makeActorScripts(),
  };
}

export function makeActorScripts() {
  return { init: [], interact: [], hit: [], update: [] };
}

export function makeTrigger(name, x, y, w = 1, h = 1) {
  return { id: uid('trig'), name, x, y, w, h, scripts: { enter: [], leave: [] } };
}

export function makeScene(name, screensX = 1, screensY = 1) {
  return {
    id: uid('scene'),
    name,
    screensX,
    screensY,
    tiles: new Array(SCENE_W * screensX * SCENE_H * screensY).fill(0), // indices into project.tiles
    actors: [],
    triggers: [],
    scripts: { init: [], playerHit: [] },
  };
}

// Change a scene's screen span, preserving the overlapping tile region.
export function resizeScene(scene, screensX, screensY) {
  const oldCols = sceneCols(scene), oldRows = sceneRows(scene);
  const cols = SCENE_W * screensX, rows = SCENE_H * screensY;
  const out = new Array(cols * rows).fill(0);
  for (let y = 0; y < Math.min(rows, oldRows); y++) {
    for (let x = 0; x < Math.min(cols, oldCols); x++) {
      out[y * cols + x] = scene.tiles[y * oldCols + x];
    }
  }
  scene.screensX = screensX;
  scene.screensY = screensY;
  scene.tiles = out;
  scene.actors.forEach((a) => { a.x = Math.min(a.x, cols - 1); a.y = Math.min(a.y, rows - 1); });
  scene.triggers.forEach((t) => {
    t.x = Math.min(t.x, cols - 1); t.y = Math.min(t.y, rows - 1);
    t.w = Math.min(t.w, cols - t.x); t.h = Math.min(t.h, rows - t.y);
  });
}

// ---------------------------------------------------------------------------
// Songs (ArduboyTones sequences: frequency/duration pairs)
// ---------------------------------------------------------------------------

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Frequency of a note like 'C4', 'A#3'. Equal temperament, A4 = 440 Hz.
export function noteFreq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  const idx = NOTE_NAMES.indexOf(m[1]);
  const octave = parseInt(m[2], 10);
  const semisFromA4 = (octave - 4) * 12 + (idx - 9);
  return Math.round(440 * Math.pow(2, semisFromA4 / 12));
}

// A song note: freq in Hz (0 = rest) and duration in ms.
export function makeSong(name) {
  return { id: uid('song'), name, notes: [] };
}

// Quick-start material for the Audio tab (in the spirit of the Arduboy Cloud
// sound tools): a few classic game jingles and retro sound effects.
export const SONG_PRESETS = [
  {
    name: 'Pickup jingle',
    notes: [
      { f: noteFreq('E5'), d: 80 }, { f: noteFreq('G5'), d: 80 },
      { f: noteFreq('C6'), d: 140 },
    ],
  },
  {
    name: 'Victory fanfare',
    notes: [
      { f: noteFreq('C5'), d: 120 }, { f: noteFreq('E5'), d: 120 },
      { f: noteFreq('G5'), d: 120 }, { f: 0, d: 40 },
      { f: noteFreq('G5'), d: 100 }, { f: noteFreq('C6'), d: 320 },
    ],
  },
  {
    name: 'Hurt / hit',
    notes: [
      { f: noteFreq('B3'), d: 60 }, { f: noteFreq('G3'), d: 60 },
      { f: noteFreq('E3'), d: 90 },
    ],
  },
  {
    name: 'Jump',
    notes: [
      { f: noteFreq('C4'), d: 30 }, { f: noteFreq('E4'), d: 30 },
      { f: noteFreq('G4'), d: 30 }, { f: noteFreq('C5'), d: 50 },
    ],
  },
  {
    name: 'Game over',
    notes: [
      { f: noteFreq('C4'), d: 200 }, { f: noteFreq('B3'), d: 200 },
      { f: noteFreq('A#3'), d: 200 }, { f: noteFreq('A3'), d: 420 },
    ],
  },
  {
    name: 'Overworld loop (8 bars)',
    notes: [
      { f: noteFreq('C4'), d: 150 }, { f: noteFreq('E4'), d: 150 },
      { f: noteFreq('G4'), d: 150 }, { f: noteFreq('E4'), d: 150 },
      { f: noteFreq('F4'), d: 150 }, { f: noteFreq('A4'), d: 150 },
      { f: noteFreq('C5'), d: 150 }, { f: noteFreq('A4'), d: 150 },
      { f: noteFreq('G4'), d: 150 }, { f: noteFreq('B4'), d: 150 },
      { f: noteFreq('D5'), d: 150 }, { f: noteFreq('B4'), d: 150 },
      { f: noteFreq('C5'), d: 300 }, { f: 0, d: 150 },
      { f: noteFreq('G4'), d: 300 }, { f: 0, d: 150 },
    ],
  },
];

export function makeEvent(type) {
  switch (type) {
    case 'TEXT':        return { id: uid('ev'), type, text: 'Hello Arduboy!' };
    case 'SWITCH_SCENE':return { id: uid('ev'), type, sceneId: '', x: 2, y: 4 };
    case 'SET_VAR':     return { id: uid('ev'), type, varId: '', value: 1 };
    case 'ADD_VAR':     return { id: uid('ev'), type, varId: '', delta: 1 };
    // Store the result of a math expression, e.g. "$health - $defence".
    case 'EXPR_SET':    return { id: uid('ev'), type, varId: '', expression: '' };
    // The same store behind a picker: variable, operation, and a value that is
    // a number, another variable, or a random number.
    case 'MATH_FN':     return {
      id: uid('ev'), type, varId: '', op: 'add',
      srcKind: 'number', value: 1, srcVarId: '',
    };
    case 'IF_VAR':      return { id: uid('ev'), type, varId: '', cmp: '==', value: 1, then: [], else: [] };
    // `mask` is a bitmask over the variable's eight flags, bit 0 = Flag 1.
    case 'VAR_FLAGS_ADD':
    case 'VAR_FLAGS_CLEAR':
    case 'VAR_FLAGS_SET':   return { id: uid('ev'), type, varId: '', mask: 0 };
    case 'IF_VAR_FLAGS':    return { id: uid('ev'), type, varId: '', mask: 0, mode: 'all', then: [], else: [] };
    case 'TONE':        return { id: uid('ev'), type, freq: 440, frames: 15 };
    case 'WAIT':        return { id: uid('ev'), type, frames: 30 };
    case 'ACTOR_HIDE':  return { id: uid('ev'), type, target: 'self' };
    case 'ACTOR_SHOW':  return { id: uid('ev'), type, target: 'self' };
    case 'ACTOR_MOVE':  return { id: uid('ev'), type, target: 'self', x: 2, y: 4, instant: false };
    case 'SET_TILE':    return { id: uid('ev'), type, x: 0, y: 0, tileIndex: 0 };
    case 'PLAYER_POS':  return { id: uid('ev'), type, x: 2, y: 4 };
    case 'PLAY_SONG':   return { id: uid('ev'), type, songId: '', loop: false };
    case 'STOP_SONG':   return { id: uid('ev'), type };
    case 'SAVE_GAME':   return { id: uid('ev'), type };
    case 'LOAD_GAME':   return { id: uid('ev'), type };
    case 'SAVE_CHECK':  return { id: uid('ev'), type, varId: '' };
    case 'DELETE_SAVE': return { id: uid('ev'), type };
    // RGB LED. Analog mode is the one most games want: one call sets all three
    // channels to a PWM brightness. Digital mode frees the PWM hardware and
    // switches channels fully on/off instead.
    case 'SET_LED':     return { id: uid('ev'), type, mode: 'analog', r: 255, g: 0, b: 0, dr: false, dg: false, db: false };
    case 'MENU':        return {
      id: uid('ev'), type, varId: '', layout: 'menu',
      options: ['Option 1', 'Option 2'],
      lastIsZero: false, cancelB: false,
    };
    case 'CHOICE':      return { id: uid('ev'), type, varId: '', trueLabel: 'Yes', falseLabel: 'No' };
    case 'SET_ACTOR_SPRITE': return { id: uid('ev'), type, target: 'self', spriteId: '' };
    // Input events. `mask` is a bitfield of BUTTONS bits.
    case 'ATTACH_SCRIPT': return { id: uid('ev'), type, button: 'a', override: false, script: [] };
    case 'REMOVE_BUTTON_SCRIPT': return { id: uid('ev'), type, button: 'a' };
    case 'WAIT_INPUT':  return { id: uid('ev'), type, mask: 16 }; // A by default
    case 'IF_INPUT':    return { id: uid('ev'), type, mask: 16, then: [], else: [] };
    case 'SET_ACTOR_DIR':   return { id: uid('ev'), type, target: 'self', direction: 'down' };
    case 'SET_ACTOR_SPEED': return { id: uid('ev'), type, target: 'self', speed: 1 };
    case 'ACTOR_EFFECT':    return { id: uid('ev'), type, target: 'self', effect: 'flicker', frames: 30 };
    case 'LAUNCH_PROJECTILE': return {
      id: uid('ev'), type,
      source: 'self',          // self | player | an actor id
      spriteId: '',
      direction: 'source',     // 'source' = the launcher's own facing
      speed: 2, life: 60, collideWith: 0,
    };
    // Scene stack: Push remembers where the player is standing so Pop can put
    // them back — menus, shops and cutscene rooms without a return trigger.
    case 'PUSH_SCENE':  return { id: uid('ev'), type, sceneId: '', x: 2, y: 4, fade: 2 };
    case 'POP_SCENE':   return { id: uid('ev'), type, fade: 2 };
    case 'POP_ALL_SCENES': return { id: uid('ev'), type, fade: 2 };
    case 'FADE_IN':     return { id: uid('ev'), type, fade: 2 };
    case 'FADE_OUT':    return { id: uid('ev'), type, fade: 2 };
    case 'IF_ACTOR_AT': return { id: uid('ev'), type, target: 'self', x: 0, y: 0, then: [], else: [] };
    case 'IF_ACTOR_DISTANCE': return {
      id: uid('ev'), type, target: 'player', cmp: '<=', distance: 3, from: 'self',
      then: [], else: [],
    };
    case 'STORE_ACTOR_DIR': return { id: uid('ev'), type, target: 'self', varId: '' };
    case 'STORE_ACTOR_POS': return { id: uid('ev'), type, target: 'self', varX: '', varY: '' };
    case 'EXPR_IF':     return { id: uid('ev'), type, expression: '', then: [], else: [] };
    case 'EXPR_LOOP':   return { id: uid('ev'), type, expression: '', events: [] };
    // Runs its body forever. Something inside has to end it — a Wait keeps the
    // game responsive, and Stop Script or Change Scene break out entirely.
    case 'LOOP':        return { id: uid('ev'), type, events: [] };
    // Hands another script in this scene to the blocking VM and carries on.
    // `target` is an actor id, a trigger id, or 'scene'.
    case 'START_SCRIPT': return { id: uid('ev'), type, target: 'scene', slot: 'init' };
    case 'SEED_RNG':    return { id: uid('ev'), type };
    case 'SWITCH':      return {
      id: uid('ev'), type, varId: '',
      cases: [{ value: 0, events: [] }, { value: 1, events: [] }],
      else: [],
    };
    case 'SET_ANIM_FRAME': return { id: uid('ev'), type, target: 'self', frame: 0 };
    case 'SET_ANIM_SPEED': return { id: uid('ev'), type, target: 'self', speed: 20 };
    case 'SET_ANIM_STATE': return { id: uid('ev'), type, target: 'self', stateId: '', loop: true };
    case 'SHOW_OVERLAY': return { id: uid('ev'), type, fill: 'black', x: 0, y: 0 };
    case 'HIDE_OVERLAY': return { id: uid('ev'), type };
    case 'OVERLAY_MOVE': return { id: uid('ev'), type, x: 0, y: 0, speed: 1 };
    case 'OVERLAY_CUTOFF': return { id: uid('ev'), type, y: 0 };
    case 'DRAW_TEXT':   return { id: uid('ev'), type, text: '', x: 1, y: 1, location: 'background' };
    case 'COMMENT':     return { id: uid('ev'), type, text: '' };
    case 'EVENT_GROUP': return { id: uid('ev'), type, label: '', events: [] };
    case 'END_SCRIPT':  return { id: uid('ev'), type };
    default: throw new Error(`Unknown event type ${type}`);
  }
}

export const EVENT_DEFS = [
  { type: 'TEXT',         label: 'Show Dialogue',     group: 'Dialogue' },
  { type: 'MENU',         label: 'Display Menu',      group: 'Dialogue' },
  { type: 'CHOICE',       label: 'Display Multiple Choice', group: 'Dialogue' },
  { type: 'SWITCH_SCENE', label: 'Change Scene',      group: 'Scene' },
  { type: 'PLAYER_POS',   label: 'Teleport Player',   group: 'Scene' },
  { type: 'SET_TILE',     label: 'Set Tile',          group: 'Scene' },
  { type: 'PUSH_SCENE',   label: 'Push Scene',        group: 'Scene' },
  { type: 'POP_SCENE',    label: 'Pop Scene',         group: 'Scene' },
  { type: 'POP_ALL_SCENES', label: 'Pop All Scenes',  group: 'Scene' },
  { type: 'FADE_IN',      label: 'Fade In',           group: 'Scene' },
  { type: 'FADE_OUT',     label: 'Fade Out',          group: 'Scene' },
  { type: 'DRAW_TEXT',    label: 'Draw Text',         group: 'Overlay' },
  { type: 'SHOW_OVERLAY', label: 'Show Overlay',      group: 'Overlay' },
  { type: 'HIDE_OVERLAY', label: 'Hide Overlay',      group: 'Overlay' },
  { type: 'OVERLAY_MOVE', label: 'Overlay Move To',   group: 'Overlay' },
  { type: 'OVERLAY_CUTOFF', label: 'Set Overlay Scanline Cutoff', group: 'Overlay' },
  { type: 'SEED_RNG',     label: 'Seed Random Number Generator', group: 'Random' },
  { type: 'SET_VAR',      label: 'Set Variable',      group: 'Variables' },
  { type: 'ADD_VAR',      label: 'Add To Variable',   group: 'Variables' },
  { type: 'MATH_FN',      label: 'Math Functions',    group: 'Variables' },
  { type: 'EXPR_SET',     label: 'Evaluate Math Expression', group: 'Variables' },
  { type: 'IF_VAR',       label: 'If Variable…',      group: 'Variables' },
  { type: 'VAR_FLAGS_ADD',   label: 'Variable Flags Add',   group: 'Variables' },
  { type: 'VAR_FLAGS_CLEAR', label: 'Variable Flags Clear', group: 'Variables' },
  { type: 'VAR_FLAGS_SET',   label: 'Variable Flags Set',   group: 'Variables' },
  { type: 'IF_VAR_FLAGS',    label: 'If Variable Flags…',   group: 'Variables' },
  { type: 'STORE_ACTOR_DIR', label: 'Store Actor Direction In Variable', group: 'Variables' },
  { type: 'STORE_ACTOR_POS', label: 'Store Actor Position In Variables', group: 'Variables' },
  { type: 'ACTOR_HIDE',   label: 'Hide Actor',        group: 'Actors' },
  { type: 'ACTOR_SHOW',   label: 'Show Actor',        group: 'Actors' },
  { type: 'ACTOR_MOVE',   label: 'Move Actor',        group: 'Actors' },
  { type: 'SET_ACTOR_SPRITE', label: 'Set Actor Sprite', group: 'Actors' },
  { type: 'SET_ACTOR_DIR',   label: 'Set Actor Direction', group: 'Actors' },
  { type: 'SET_ACTOR_SPEED', label: 'Set Actor Movement Speed', group: 'Actors' },
  { type: 'ACTOR_EFFECT',    label: 'Actor Effects',     group: 'Actors' },
  { type: 'SET_ANIM_FRAME',  label: 'Set Actor Animation Frame', group: 'Actors' },
  { type: 'SET_ANIM_SPEED',  label: 'Set Actor Animation Speed', group: 'Actors' },
  { type: 'SET_ANIM_STATE',  label: 'Set Actor Animation State', group: 'Actors' },
  { type: 'LAUNCH_PROJECTILE', label: 'Launch Projectile', group: 'Actors' },
  { type: 'ATTACH_SCRIPT', label: 'Attach Script To Button', group: 'Input' },
  { type: 'REMOVE_BUTTON_SCRIPT', label: 'Remove Button Script', group: 'Input' },
  { type: 'WAIT_INPUT',   label: 'Pause Script Until Input Pressed', group: 'Input' },
  { type: 'IF_INPUT',     label: 'If Joypad Input Held', group: 'Input' },
  { type: 'SET_LED',      label: 'Set RGB LED',       group: 'Hardware' },
  { type: 'TONE',         label: 'Play Tone',         group: 'Sound' },
  { type: 'PLAY_SONG',    label: 'Play Song',         group: 'Sound' },
  { type: 'STOP_SONG',    label: 'Stop Song',         group: 'Sound' },
  { type: 'SAVE_GAME',    label: 'Save Game',         group: 'Save games' },
  { type: 'LOAD_GAME',    label: 'Load Game',         group: 'Save games' },
  { type: 'SAVE_CHECK',   label: 'Save Exists → Var', group: 'Save games' },
  { type: 'DELETE_SAVE',  label: 'Delete Save',       group: 'Save games' },
  { type: 'WAIT',         label: 'Wait',              group: 'Timing' },
  { type: 'END_SCRIPT',   label: 'Stop Script',       group: 'Timing' },
  { type: 'IF_ACTOR_AT',  label: 'If Actor At Position', group: 'Control Flow' },
  { type: 'EXPR_IF',      label: 'If Math Expression', group: 'Control Flow' },
  { type: 'EXPR_LOOP',    label: 'Loop While Math Expression', group: 'Control Flow' },
  { type: 'LOOP',         label: 'Loop',              group: 'Control Flow' },
  { type: 'START_SCRIPT', label: 'Start Script',      group: 'Control Flow' },
  { type: 'SWITCH',       label: 'Switch',            group: 'Control Flow' },
  { type: 'IF_ACTOR_DISTANCE', label: 'If Actor Distance From Actor', group: 'Control Flow' },
  { type: 'COMMENT',      label: 'Comment',           group: 'Miscellaneous' },
  { type: 'EVENT_GROUP',  label: 'Event Group',       group: 'Miscellaneous' },
];

// ---------------------------------------------------------------------------
// Default art (drawn for readability here; edit freely in the app)
// ---------------------------------------------------------------------------

const ART = {
  empty: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ],
  floor: [
    '........',
    '........',
    '..#.....',
    '........',
    '......#.',
    '........',
    '........',
    '........',
  ],
  wall: [
    '########',
    '#.....#.',
    '#.....#.',
    '########',
    '...#....',
    '#..#...#',
    '#..#...#',
    '########',
  ],
  door: [
    '.######.',
    '#......#',
    '#.####.#',
    '#.#..#.#',
    '#.#..#.#',
    '#.#.##.#',
    '#.#..#.#',
    '########',
  ],
  tree: [
    '..####..',
    '.######.',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '...##...',
    '..####..',
  ],
  water: [
    '........',
    '.##..##.',
    '#..##..#',
    '........',
    '...##...',
    '.##..##.',
    '........',
    '........',
  ],
  chest: [
    '........',
    '.######.',
    '#......#',
    '########',
    '#..##..#',
    '#...#..#',
    '#......#',
    '.######.',
  ],
  key: [
    '........',
    '..###...',
    '.#...#..',
    '.#...#..',
    '..###...',
    '...#....',
    '...##...',
    '...#.#..',
  ],
};

const PLAYER_F0 = [
  '..####..',
  '.#....#.',
  '.#.##.#.',
  '.#....#.',
  '..####..',
  '.######.',
  '..#..#..',
  '.#....#.',
];
const PLAYER_F1 = [
  '..####..',
  '.#....#.',
  '.#.##.#.',
  '.#....#.',
  '..####..',
  '.######.',
  '..#..#..',
  '..#..#..',
];
const NPC_F0 = [
  '..####..',
  '.######.',
  '.#.##.#.',
  '.######.',
  '..####..',
  '.#####..',
  '..#.#...',
  '..#.#...',
];
const NPC_F1 = [
  '..####..',
  '.######.',
  '.#.##.#.',
  '.######.',
  '..####..',
  '..#####.',
  '...#.#..',
  '...#.#..',
];
const SLIME_F0 = [
  '........',
  '........',
  '..####..',
  '.######.',
  '.#.##.#.',
  '########',
  '########',
  '.######.',
];
const SLIME_F1 = [
  '........',
  '..####..',
  '.######.',
  '.#.##.#.',
  '.######.',
  '.######.',
  '########',
  '.######.',
];

// ---------------------------------------------------------------------------
// Project factories
// ---------------------------------------------------------------------------

export function makeProject(name = 'Untitled Game') {
  const tiles = [
    makeTile('Empty', ART.empty, false),
    makeTile('Floor', ART.floor, false),
    makeTile('Wall', ART.wall, true),
    makeTile('Door', ART.door, true),
    makeTile('Tree', ART.tree, true),
    makeTile('Water', ART.water, true),
    makeTile('Chest', ART.chest, true),
    makeTile('Key', ART.key, false),
  ];
  const sprites = [
    makeSprite('Player', [PLAYER_F0, PLAYER_F1]),
    makeSprite('Villager', [NPC_F0, NPC_F1]),
    makeSprite('Slime', [SLIME_F0, SLIME_F1]),
  ];
  const scene = makeScene('Scene 1');
  // border of walls
  for (let x = 0; x < SCENE_W; x++) {
    scene.tiles[x] = 2;
    scene.tiles[(SCENE_H - 1) * SCENE_W + x] = 2;
  }
  for (let y = 0; y < SCENE_H; y++) {
    scene.tiles[y * SCENE_W] = 2;
    scene.tiles[y * SCENE_W + SCENE_W - 1] = 2;
  }
  return {
    format: 'ardustudio-project',
    formatVersion: 1,
    name,
    author: '',
    settings: {
      startSceneId: scene.id,
      startX: 2,
      startY: 4,
      playerSpriteId: sprites[0].id,
      textSpeed: 2, // chars per frame in dialogue
      // .arduboy package metadata. The format requires a non-empty version, and
      // its genre is a fixed enum rather than free text.
      version: '1.0',
      genre: 'Misc',
      description: '',
      // Leave out art and music nothing references, to save flash. Off means
      // every asset ships whether the game reaches it or not.
      pruneUnused: true,
      // Boot straight into the game instead of running Arduboy2's startup
      // sequence. Saves ~1 KB — the logo animation, the bitmap it draws with
      // and the flashlight recovery mode — and keeps the hold-B sound toggle.
      minimalBoot: true,
    },
    variables: [
      { id: uid('var'), name: 'has_key' },
      { id: uid('var'), name: 'score' },
    ],
    tiles,
    sprites,
    songs: [],
    scenes: [scene],
  };
}

// A small but complete two-scene demo: talk to the villager, fetch the key
// from the slime's lake, unlock the door, win. Shows off dialogue, variables,
// branching, tile swapping, triggers, tones and scene switching.
export function makeDemoProject() {
  const p = makeProject('Key Quest');
  p.author = 'ArduStudio demo';
  const [vHasKey, vIntroSeen] = [p.variables[0], p.variables[1]];
  vIntroSeen.name = 'intro_seen';
  const vAskedWay = { id: uid('var'), name: 'asked_way' };
  p.variables.push(vAskedWay);

  const T = { empty: 0, floor: 1, wall: 2, door: 3, tree: 4, water: 5, chest: 6, key: 7 };
  const outdoors = p.scenes[0];
  outdoors.name = 'Village';
  const map = (rows) => {
    const idx = [];
    const codes = { '.': T.floor, ' ': T.empty, W: T.wall, D: T.door, T: T.tree, '~': T.water, C: T.chest, K: T.key };
    for (const row of rows) for (const ch of row) idx.push(codes[ch] ?? T.floor);
    return idx;
  };
  outdoors.tiles = map([
    'WWWWWWWWDWWWWWWW',
    'W..T.......~~..W',
    'W..............W',
    'W....T...T.....W',
    'W..............W',
    'W.....T....T...W',
    'W..T...........W',
    'WWWWWWWWWWWWWWWW',
  ]);

  // The lake spans two screens horizontally to show off scrolling scenes.
  const lake = makeScene('Lake', 2, 1);
  const lakeRow = (s) => (s + '.'.repeat(32)).slice(0, 31) + 'W'; // pad/trim to 32, walled east edge
  lake.tiles = map([
    'W'.repeat(32),
    lakeRow('W....~~~~~~........~~~~~~~~'),
    lakeRow('W...~~~~~~~~.....~~~~~~~~~~'),
    lakeRow('W'),
    lakeRow('W.....T........T.........T'),
    lakeRow('W..........T.............T'),
    lakeRow('W..T.................T'),
    'W'.repeat(32),
  ]);
  p.scenes.push(lake);

  // Songs for the demo (see the Audio tab).
  const sngKey = makeSong('Key jingle');
  sngKey.notes = SONG_PRESETS[0].notes.map((n) => ({ ...n }));
  const sngWin = makeSong('Victory fanfare');
  sngWin.notes = SONG_PRESETS[1].notes.map((n) => ({ ...n }));
  p.songs.push(sngKey, sngWin);

  const villager = makeActor('Villager', p.sprites[1].id, 4, 3);
  villager.x = 3; villager.y = 5;
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const t1 = makeEvent('TEXT'); t1.text = 'You found it! Use the key on the north door.';
    const step = makeEvent('ACTOR_MOVE'); step.target = 'self'; step.x = 4; step.y = 5;
    const e1 = makeEvent('TEXT'); e1.text = 'The door key fell in the lake up north. A slime swallowed it!';
    // Then ask before giving directions — shows off Display Multiple Choice.
    const ask = makeEvent('TEXT'); ask.text = 'Need directions to the lake?';
    const choice = makeEvent('CHOICE');
    choice.varId = vAskedWay.id; choice.trueLabel = 'Yes'; choice.falseLabel = 'No';
    const answer = makeEvent('IF_VAR');
    answer.varId = vAskedWay.id; answer.cmp = '=='; answer.value = 1;
    const yes = makeEvent('TEXT'); yes.text = 'Head east, then north through the gap in the wall.';
    const no = makeEvent('TEXT'); no.text = 'Suit yourself!';
    answer.then = [yes]; answer.else = [no];
    iff.then = [t1, step]; iff.else = [e1, ask, choice, answer];
    villager.scripts.interact = [iff];
  }
  outdoors.actors.push(villager);

  // The slime patrols on the far screen of the lake, so reaching it means
  // walking through the scrolling section.
  const slime = makeActor('Slime', p.sprites[2].id, 20, 4);
  slime.movement = 'patrolH';
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 0;
    const t1 = makeEvent('TEXT'); t1.text = 'The slime burps up a rusty key!';
    const sv = makeEvent('SET_VAR'); sv.varId = vHasKey.id; sv.value = 1;
    const jingle = makeEvent('PLAY_SONG'); jingle.songId = sngKey.id;
    // Flash the RGB LED green as pickup feedback, then turn it off.
    const ledOn = makeEvent('SET_LED'); ledOn.r = 0; ledOn.g = 255; ledOn.b = 0;
    const wait = makeEvent('WAIT'); wait.frames = 20;
    const ledOff = makeEvent('SET_LED'); ledOff.r = 0; ledOff.g = 0; ledOff.b = 0;
    const hide = makeEvent('ACTOR_HIDE'); hide.target = 'self';
    iff.then = [t1, sv, jingle, ledOn, wait, ledOff, hide];
    iff.else = [];
    slime.scripts.interact = [iff];
  }
  lake.actors.push(slime);
  // Keep the slime gone once looted.
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const hide = makeEvent('ACTOR_HIDE'); hide.target = slime.id;
    iff.then = [hide];
    lake.scripts.init = [iff];
  }

  // Stepping in front of the door checks the key (the door tile itself is
  // solid, so the trigger lives on the walkable tile just below it).
  const doorTrig = makeTrigger('Door', 8, 1, 1, 1);
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const t1 = makeEvent('TEXT'); t1.text = 'The key fits! You escaped the village.\fTHE END\n(made with ArduStudio)';
    const fanfare = makeEvent('PLAY_SONG'); fanfare.songId = sngWin.id;
    const open = makeEvent('SET_TILE'); open.x = 8; open.y = 0; open.tileIndex = T.floor;
    const e1 = makeEvent('TEXT'); e1.text = 'The door is locked tight.';
    iff.then = [fanfare, open, t1];
    iff.else = [e1];
    doorTrig.scripts.enter = [iff];
  }
  outdoors.triggers.push(doorTrig);

  // North exit of village leads to lake (via the door tile row edge)…
  const toLake = makeTrigger('To Lake', 8, 1, 1, 1);
  // …actually place lake entry on the right side to keep the door special.
  toLake.x = 14; toLake.y = 1; toLake.name = 'Path to lake';
  {
    const sw = makeEvent('SWITCH_SCENE');
    sw.sceneId = lake.id; sw.x = 1; sw.y = 5;
    toLake.scripts.enter = [sw];
  }
  outdoors.triggers.push(toLake);
  outdoors.tiles[1 * SCENE_W + 15] = T.floor; // opening in the wall
  outdoors.tiles[1 * SCENE_W + 14] = T.floor;

  const backToVillage = makeTrigger('Back to village', 0, 5, 1, 1);
  {
    const sw = makeEvent('SWITCH_SCENE');
    sw.sceneId = outdoors.id; sw.x = 13; sw.y = 1;
    backToVillage.scripts.enter = [sw];
  }
  lake.triggers.push(backToVillage);
  lake.tiles[5 * sceneCols(lake) + 0] = T.floor; // opening in the wall

  // Show the intro only on the first visit.
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vIntroSeen.id; iff.cmp = '=='; iff.value = 0;
    const intro = makeEvent('TEXT');
    intro.text = 'KEY QUEST\nFind the key. Open the door.\fArrows: move  A: talk/use';
    const seen = makeEvent('SET_VAR'); seen.varId = vIntroSeen.id; seen.value = 1;
    iff.then = [intro, seen];
    outdoors.scripts.init = [iff];
  }

  p.settings.startSceneId = outdoors.id;
  p.settings.startX = 2;
  p.settings.startY = 3;
  return p;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function sceneById(project, id) {
  return project.scenes.find((s) => s.id === id) || null;
}
export function spriteById(project, id) {
  return project.sprites.find((s) => s.id === id) || null;
}
export function variableById(project, id) {
  return project.variables.find((v) => v.id === id) || null;
}

// Move an entity from the days of a single script per entity to named
// lifecycle slots, then make sure every slot exists. `legacy` maps an old
// field name to the slot that now holds it.
function normalizeScripts(entity, slots, legacy) {
  entity.scripts = entity.scripts || {};
  for (const [oldKey, slot] of Object.entries(legacy)) {
    if (Array.isArray(entity[oldKey])) {
      if (!entity.scripts[slot] || !entity.scripts[slot].length) entity.scripts[slot] = entity[oldKey];
      delete entity[oldKey];
    }
  }
  for (const { key } of slots) entity.scripts[key] = entity.scripts[key] || [];
}

// Sanitize a loaded project (older saves, hand-edited files).
export function normalizeProject(p) {
  if (!p || p.format !== 'ardustudio-project') throw new Error('Not an ArduStudio project file');
  p.variables = p.variables || [];
  for (const v of p.variables) {
    // Flag names are editor-only — they are never written into the sketch, so
    // they cost nothing on the device. Absent, or an empty entry, falls back
    // to "Flag 1".."Flag 8" in the editor. Dropping an all-empty array keeps
    // saved files exactly as they were for anyone not using flags.
    v.flags = Array.isArray(v.flags)
      ? v.flags.slice(0, VAR_FLAGS).map((n) => String(n == null ? '' : n).trim())
      : [];
    while (v.flags.length && !v.flags[v.flags.length - 1]) v.flags.pop();
    if (!v.flags.length) delete v.flags;
  }
  p.tiles = (p.tiles || []).slice(0, MAX_TILES);
  p.sprites = (p.sprites || []).slice(0, MAX_SPRITES);
  for (const spr of p.sprites) {
    // Projects saved before animation states existed have none.
    spr.states = (spr.states || []).slice(0, MAX_SPRITE_STATES);
    if (!spr.states.length) spr.states = [makeSpriteState('Default', 0, spr.frames.length - 1)];
    const last = spr.frames.length - 1;
    for (const st of spr.states) {
      st.id = st.id || uid('state');
      st.from = Math.max(0, Math.min(last, st.from | 0));
      st.to = Math.max(st.from, Math.min(last, st.to | 0));
    }
  }
  p.songs = (p.songs || []).slice(0, MAX_SONGS);
  for (const s of p.songs) {
    s.notes = (s.notes || []).slice(0, MAX_SONG_NOTES).map((n) => ({
      f: Math.max(0, Math.min(32767, n.f | 0)),
      d: Math.max(1, Math.min(65535, n.d | 0)),
    }));
  }
  p.scenes = p.scenes || [];
  for (const sc of p.scenes) {
    // Projects saved before scrolling scenes existed have no screen span.
    sc.screensX = Math.max(1, Math.min(MAX_SCREENS, sc.screensX | 0 || 1));
    sc.screensY = Math.max(1, Math.min(MAX_SCREENS, sc.screensY | 0 || 1));
    const size = sceneCols(sc) * sceneRows(sc);
    sc.tiles = (sc.tiles || []).slice(0, size);
    while (sc.tiles.length < size) sc.tiles.push(0);
    sc.tiles = sc.tiles.map((t) => (t >= 0 && t < p.tiles.length ? t : 0));
    sc.actors = (sc.actors || []).slice(0, MAX_ACTORS_PER_SCENE);
    sc.triggers = (sc.triggers || []).slice(0, MAX_TRIGGERS_PER_SCENE);
    normalizeScripts(sc, SCENE_SCRIPT_SLOTS, { onEnter: 'init' });
    for (const a of sc.actors) {
      normalizeScripts(a, ACTOR_SCRIPT_SLOTS, { script: 'interact' });
      a.facing = DIRECTIONS.some((d) => d.key === a.facing) ? a.facing : 'down';
      a.speed = ACTOR_SPEEDS.some((s) => s.value === a.speed) ? a.speed : 1;
      a.animSpeed = Number.isFinite(a.animSpeed) ? Math.max(0, Math.min(255, a.animSpeed | 0)) : 20;
      a.collisionGroup = COLLISION_GROUPS.some((g) => g.key === a.collisionGroup) ? a.collisionGroup : 'none';
      a.collideWith = Math.max(0, Math.min(15, a.collideWith | 0));
    }
    for (const t of sc.triggers) normalizeScripts(t, TRIGGER_SCRIPT_SLOTS, { script: 'enter' });
  }
  if (!sceneById(p, p.settings.startSceneId) && p.scenes[0]) {
    p.settings.startSceneId = p.scenes[0].id;
  }
  if (!spriteById(p, p.settings.playerSpriteId) && p.sprites[0]) {
    p.settings.playerSpriteId = p.sprites[0].id;
  }
  // Projects saved before .arduboy export existed carry none of its metadata.
  if (typeof p.settings.version !== 'string' || !p.settings.version.trim()) p.settings.version = '1.0';
  if (typeof p.settings.genre !== 'string') p.settings.genre = 'Misc';
  if (typeof p.settings.description !== 'string') p.settings.description = '';
  // Older projects predate pruning; default it on, but honour an explicit off.
  if (typeof p.settings.pruneUnused !== 'boolean') p.settings.pruneUnused = true;
  if (typeof p.settings.minimalBoot !== 'boolean') p.settings.minimalBoot = true;
  return p;
}
