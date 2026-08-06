// ArduStudio project data model.
//
// A project is plain JSON so it can be saved/loaded/versioned freely.
// Pixel art is stored as strings of '.' (black) and '#' (white) rows —
// human-readable in saved files and cheap to edit programmatically.
//
// Coordinate system: scenes are 16x8 tiles of 8x8 pixels = 128x64,
// exactly one Arduboy screen (Bitsy-style single-screen rooms).

export const SCENE_W = 16; // tiles
export const SCENE_H = 8;  // tiles
export const TILE = 8;     // pixels
export const MAX_ACTORS_PER_SCENE = 8;
export const MAX_TRIGGERS_PER_SCENE = 8;
export const MAX_VARIABLES = 32;
export const MAX_TILES = 64;
export const MAX_SPRITES = 32;
export const MAX_FRAMES = 4;

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
  return {
    id: uid('spr'),
    name,
    width: w,
    height: h,
    frames: frames && frames.length ? frames : [blankPixels(w, h)],
  };
}

export function makeActor(name, spriteId, x, y) {
  return {
    id: uid('actor'),
    name,
    spriteId,
    x, y,                 // tile coords
    movement: 'static',   // static | wander | patrolH | patrolV
    solid: true,          // blocks the player / can be interacted with
    animate: true,        // cycle frames
    script: [],           // run when player interacts (A button)
  };
}

export function makeTrigger(name, x, y, w = 1, h = 1) {
  return { id: uid('trig'), name, x, y, w, h, script: [] };
}

export function makeScene(name) {
  return {
    id: uid('scene'),
    name,
    tiles: new Array(SCENE_W * SCENE_H).fill(0), // indices into project.tiles
    actors: [],
    triggers: [],
    onEnter: [], // script run when the scene is entered
  };
}

export function makeEvent(type) {
  switch (type) {
    case 'TEXT':        return { id: uid('ev'), type, text: 'Hello Arduboy!' };
    case 'SWITCH_SCENE':return { id: uid('ev'), type, sceneId: '', x: 2, y: 4 };
    case 'SET_VAR':     return { id: uid('ev'), type, varId: '', value: 1 };
    case 'ADD_VAR':     return { id: uid('ev'), type, varId: '', delta: 1 };
    case 'IF_VAR':      return { id: uid('ev'), type, varId: '', cmp: '==', value: 1, then: [], else: [] };
    case 'TONE':        return { id: uid('ev'), type, freq: 440, frames: 15 };
    case 'WAIT':        return { id: uid('ev'), type, frames: 30 };
    case 'ACTOR_HIDE':  return { id: uid('ev'), type, target: 'self' };
    case 'ACTOR_SHOW':  return { id: uid('ev'), type, target: 'self' };
    case 'SET_TILE':    return { id: uid('ev'), type, x: 0, y: 0, tileIndex: 0 };
    case 'PLAYER_POS':  return { id: uid('ev'), type, x: 2, y: 4 };
    case 'END_SCRIPT':  return { id: uid('ev'), type };
    default: throw new Error(`Unknown event type ${type}`);
  }
}

export const EVENT_DEFS = [
  { type: 'TEXT',         label: 'Show Dialogue',     group: 'Dialogue' },
  { type: 'SWITCH_SCENE', label: 'Change Scene',      group: 'Scene' },
  { type: 'PLAYER_POS',   label: 'Teleport Player',   group: 'Scene' },
  { type: 'SET_TILE',     label: 'Set Tile',          group: 'Scene' },
  { type: 'SET_VAR',      label: 'Set Variable',      group: 'Variables' },
  { type: 'ADD_VAR',      label: 'Add To Variable',   group: 'Variables' },
  { type: 'IF_VAR',       label: 'If Variable…',      group: 'Variables' },
  { type: 'ACTOR_HIDE',   label: 'Hide Actor',        group: 'Actors' },
  { type: 'ACTOR_SHOW',   label: 'Show Actor',        group: 'Actors' },
  { type: 'TONE',         label: 'Play Tone',         group: 'Sound' },
  { type: 'WAIT',         label: 'Wait',              group: 'Timing' },
  { type: 'END_SCRIPT',   label: 'Stop Script',       group: 'Timing' },
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
    },
    variables: [
      { id: uid('var'), name: 'has_key' },
      { id: uid('var'), name: 'score' },
    ],
    tiles,
    sprites,
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

  const lake = makeScene('Lake');
  lake.tiles = map([
    'WWWWWWWWDWWWWWWW',
    'W....~~~~~~....W',
    'W...~~~~~~~~...W',
    'W..............W',
    'W.....T........W',
    'W..........T...W',
    'W..T...........W',
    'WWWWWWWWWWWWWWWW',
  ]);
  p.scenes.push(lake);

  const villager = makeActor('Villager', p.sprites[1].id, 4, 3);
  villager.x = 3; villager.y = 5;
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const t1 = makeEvent('TEXT'); t1.text = 'You found it! Use the key on the north door.';
    const e1 = makeEvent('TEXT'); e1.text = 'The door key fell in the lake up north. A slime swallowed it!';
    iff.then = [t1]; iff.else = [e1];
    villager.script = [iff];
  }
  outdoors.actors.push(villager);

  const slime = makeActor('Slime', p.sprites[2].id, 8, 4);
  slime.movement = 'patrolH';
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 0;
    const t1 = makeEvent('TEXT'); t1.text = 'The slime burps up a rusty key!';
    const sv = makeEvent('SET_VAR'); sv.varId = vHasKey.id; sv.value = 1;
    const tone = makeEvent('TONE'); tone.freq = 880; tone.frames = 10;
    const hide = makeEvent('ACTOR_HIDE'); hide.target = 'self';
    iff.then = [t1, sv, tone, hide];
    iff.else = [];
    slime.script = [iff];
  }
  lake.actors.push(slime);
  // Keep the slime gone once looted.
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const hide = makeEvent('ACTOR_HIDE'); hide.target = slime.id;
    iff.then = [hide];
    lake.onEnter = [iff];
  }

  // Stepping in front of the door checks the key (the door tile itself is
  // solid, so the trigger lives on the walkable tile just below it).
  const doorTrig = makeTrigger('Door', 8, 1, 1, 1);
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vHasKey.id; iff.cmp = '=='; iff.value = 1;
    const t1 = makeEvent('TEXT'); t1.text = 'The key fits! You escaped the village.\fTHE END\n(made with ArduStudio)';
    const tone = makeEvent('TONE'); tone.freq = 1320; tone.frames = 20;
    const open = makeEvent('SET_TILE'); open.x = 8; open.y = 0; open.tileIndex = T.floor;
    const e1 = makeEvent('TEXT'); e1.text = 'The door is locked tight.';
    iff.then = [tone, open, t1];
    iff.else = [e1];
    doorTrig.script = [iff];
  }
  outdoors.triggers.push(doorTrig);

  // North exit of village leads to lake (via the door tile row edge)…
  const toLake = makeTrigger('To Lake', 8, 1, 1, 1);
  // …actually place lake entry on the right side to keep the door special.
  toLake.x = 14; toLake.y = 1; toLake.name = 'Path to lake';
  {
    const sw = makeEvent('SWITCH_SCENE');
    sw.sceneId = lake.id; sw.x = 1; sw.y = 5;
    toLake.script = [sw];
  }
  outdoors.triggers.push(toLake);
  outdoors.tiles[1 * SCENE_W + 15] = T.floor; // opening in the wall
  outdoors.tiles[1 * SCENE_W + 14] = T.floor;

  const backToVillage = makeTrigger('Back to village', 0, 5, 1, 1);
  {
    const sw = makeEvent('SWITCH_SCENE');
    sw.sceneId = outdoors.id; sw.x = 13; sw.y = 1;
    backToVillage.script = [sw];
  }
  lake.triggers.push(backToVillage);
  lake.tiles[5 * SCENE_W + 0] = T.floor; // opening in the wall

  // Show the intro only on the first visit.
  {
    const iff = makeEvent('IF_VAR');
    iff.varId = vIntroSeen.id; iff.cmp = '=='; iff.value = 0;
    const intro = makeEvent('TEXT');
    intro.text = 'KEY QUEST\nFind the key. Open the door.\fArrows: move  A: talk/use';
    const seen = makeEvent('SET_VAR'); seen.varId = vIntroSeen.id; seen.value = 1;
    iff.then = [intro, seen];
    outdoors.onEnter = [iff];
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

// Sanitize a loaded project (older saves, hand-edited files).
export function normalizeProject(p) {
  if (!p || p.format !== 'ardustudio-project') throw new Error('Not an ArduStudio project file');
  p.variables = p.variables || [];
  p.tiles = (p.tiles || []).slice(0, MAX_TILES);
  p.sprites = (p.sprites || []).slice(0, MAX_SPRITES);
  p.scenes = p.scenes || [];
  for (const sc of p.scenes) {
    sc.tiles = (sc.tiles || []).slice(0, SCENE_W * SCENE_H);
    while (sc.tiles.length < SCENE_W * SCENE_H) sc.tiles.push(0);
    sc.tiles = sc.tiles.map((t) => (t >= 0 && t < p.tiles.length ? t : 0));
    sc.actors = (sc.actors || []).slice(0, MAX_ACTORS_PER_SCENE);
    sc.triggers = (sc.triggers || []).slice(0, MAX_TRIGGERS_PER_SCENE);
    sc.onEnter = sc.onEnter || [];
  }
  if (!sceneById(p, p.settings.startSceneId) && p.scenes[0]) {
    p.settings.startSceneId = p.scenes[0].id;
  }
  if (!spriteById(p, p.settings.playerSpriteId) && p.sprites[0]) {
    p.settings.playerSpriteId = p.sprites[0].id;
  }
  return p;
}
