#!/usr/bin/env node
// Measures what the engine costs in flash, so the Export tab can predict a
// build instead of leaving you to discover the 28 KB ceiling in the Arduino IDE.
//
// Each optional subsystem is stripped from the generated sketch when a game does
// not script it, so "the engine" has no single size. This compiles a bare game,
// then one variant per subsystem, and takes the difference.
//
// Object files for the core and the Arduboy libraries are reused from whatever
// tools/build_avr.sh last left in build-avr/obj, which turns each variant into a
// couple of seconds rather than a full rebuild. Run build_avr.sh at least once
// first.
//
// Usage:  node tools/measure_flash.mjs          # rewrites js/flashCosts.js
//         node tools/measure_flash.mjs --check  # compares, writes nothing

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireObjects, makeFlashMeasurer } from './avr_build.mjs';

import { makeProject, makeEvent, makeSong, makeScene, makeActor, makeTile, noteFreq } from '../js/model.js';
import { generateIno } from '../js/codegen.js';
import { packedTilemapSize } from '../js/compiler.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'build-avr');
const work = mkdtempSync(join(tmpdir(), 'ardustudio-flash-'));

requireObjects(OUT);
const measure = makeFlashMeasurer(OUT, work);
const flashOf = (label, project) => measure(label, generateIno(project).ino);

// A project with nothing optional in it: one scene, one plain event.
function bare() {
  const p = makeProject();
  p.scenes[0].scripts.init = [Object.assign(makeEvent('SET_VAR'), {
    varId: p.variables[0].id, value: 1,
  })];
  return p;
}

// One project per subsystem, each adding only the events that switch it on.
const VARIANTS = {
  OVERLAY: (p) => [makeEvent('SHOW_OVERLAY'), makeEvent('HIDE_OVERLAY')],
  EXPR: (p) => [Object.assign(makeEvent('EXPR_SET'), {
    varId: p.variables[0].id, expression: '1 + 2',
  })],
  SWITCH: (p) => [Object.assign(makeEvent('SWITCH'), {
    varId: p.variables[0].id,
    cases: [{ value: 0, events: [] }], else: [],
  })],
  SAVES: () => [makeEvent('SAVE_GAME'), makeEvent('LOAD_GAME')],
  // Linking ArduboyTools at all. A single Play Tone is enough to need it.
  AUDIO: () => [makeEvent('TONE')],
  MENUS: (p) => [Object.assign(makeEvent('MENU'), {
    varId: p.variables[0].id, options: ['One', 'Two'],
  })],
  BUTTON_SCRIPTS: () => [Object.assign(makeEvent('ATTACH_SCRIPT'), {
    button: 'b', script: [makeEvent('SEED_RNG')],
  })],
  FADE: () => [makeEvent('FADE_OUT'), makeEvent('FADE_IN')],
  LED: () => [makeEvent('SET_LED')],
  EFFECTS: () => [Object.assign(makeEvent('ACTOR_EFFECT'), { target: 'player' })],
  TEXT: () => [Object.assign(makeEvent('TEXT'), { text: 'hello' })],
};

let failed = false;

console.log('== measuring the engine ==');
const baseline = flashOf('baseline', bare());
console.log(`baseline (no optional subsystems): ${baseline} bytes`);

const costs = {};
for (const [name, build] of Object.entries(VARIANTS)) {
  const p = bare();
  p.scenes[0].scripts.init.push(...build(p));
  let n;
  try {
    n = flashOf(name.toLowerCase(), p);
  } catch (err) {
    console.error(`  ${name}: FAILED to build — ${err.message.split('\n')[0]}`);
    continue;
  }
  costs[name] = n - baseline;
  console.log(`  ${name.padEnd(16)} +${String(n - baseline).padStart(5)} bytes`);
}

// Songs need actual song data to switch on, so their cost is measured with a
// song present and the data subtracted back out.
{
  const p = bare();
  const song = makeSong('Test');
  song.notes = [{ f: noteFreq('C4'), d: 100 }, { f: noteFreq('E4'), d: 100 }];
  p.songs.push(song);
  p.scenes[0].scripts.init.push(Object.assign(makeEvent('PLAY_SONG'), { songId: song.id }));
  const dataBytes = song.notes.length * 2 + 2 + 2; // notes + terminator + table slot
  // Playing a song also links ArduboyTones, which AUDIO already accounts for.
  const audioOnly = bare();
  audioOnly.scenes[0].scripts.init.push(makeEvent('TONE'));
  costs.SONGS = flashOf('songs', p) - flashOf('audio_only', audioOnly) - dataBytes;
  console.log(`  ${'SONGS'.padEnd(16)} +${String(costs.SONGS).padStart(5)} bytes (song data excluded)`);
}

// Three subsystems are switched on by how a project is built rather than by an
// event, so they need their own variants or they would measure as free.
{
  const p = bare();
  p.scenes[0].actors = [];
  const { makeActor } = await import('../js/model.js');
  const a = makeActor('Blocker', p.sprites[0].id, 4, 4);
  a.collisionGroup = '1';
  a.collideWith = 1;
  p.scenes[0].actors.push(a);
  costs.COLLISIONS = flashOf('collisions', p) - baseline;
  console.log(`  ${'COLLISIONS'.padEnd(16)} +${String(costs.COLLISIONS).padStart(5)} bytes`);
}
{
  const p = bare();
  const { makeActor } = await import('../js/model.js');
  const a = makeActor('Ticker', p.sprites[0].id, 4, 4);
  a.scripts.update = [Object.assign(makeEvent('ADD_VAR'), { varId: p.variables[0].id, delta: 1 })];
  p.scenes[0].actors.push(a);
  costs.UPDATE_SCRIPTS = flashOf('update_scripts', p) - baseline;
  console.log(`  ${'UPDATE_SCRIPTS'.padEnd(16)} +${String(costs.UPDATE_SCRIPTS).padStart(5)} bytes`);
}
{
  const p = bare();
  p.scenes[0].scripts.init.push(Object.assign(makeEvent('TEXT'), {
    text: `HP $${p.variables[0].name}`,
  }));
  // Subtract the plain-text cost, so this is the marker expansion alone.
  const plain = bare();
  plain.scenes[0].scripts.init.push(Object.assign(makeEvent('TEXT'), { text: 'HP 0' }));
  costs.TEXT_VARS = flashOf('text_vars', p) - flashOf('text_plain', plain);
  console.log(`  ${'TEXT_VARS'.padEnd(16)} +${String(costs.TEXT_VARS).padStart(5)} bytes`);
}

// Two subsystems imply another, so measuring them from the bare baseline would
// count the shared code twice once both appear in the same game. Measure each
// on top of the one it drags in, and the table stays additive.
{
  // Push/Pop Scene also switches FADE on.
  const fadeOnly = bare();
  fadeOnly.scenes[0].scripts.init.push(makeEvent('FADE_OUT'));
  const withStack = bare();
  withStack.scenes[0].scripts.init.push(makeEvent('POP_SCENE'));
  costs.SCENE_STACK = flashOf('scene_stack', withStack) - flashOf('fade_only', fadeOnly);
  console.log(`  ${'SCENE_STACK'.padEnd(16)} +${String(costs.SCENE_STACK).padStart(5)} bytes (on top of FADE)`);
}
{
  // Launch Projectile also switches COLLISIONS on.
  const { makeActor } = await import('../js/model.js');
  const collOnly = bare();
  const blocker = makeActor('Blocker', collOnly.sprites[0].id, 4, 4);
  blocker.collisionGroup = '1';
  blocker.collideWith = 1;
  collOnly.scenes[0].actors.push(blocker);

  const p = bare();
  p.scenes[0].scripts.init.push(Object.assign(makeEvent('LAUNCH_PROJECTILE'), {
    source: 'player', spriteId: p.sprites[0].id, direction: 'right',
  }));
  costs.PROJECTILES = flashOf('projectiles', p) - flashOf('coll_only', collOnly);
  console.log(`  ${'PROJECTILES'.padEnd(16)} +${String(costs.PROJECTILES).padStart(5)} bytes (on top of COLLISIONS)`);
}

// Each opcode's `case` arm is stripped from runScript when a game never emits
// it. runScript is one function, so --gc-sections cannot reach inside it and
// the arms have to come out of the source — which makes them worth measuring.
//
// Only opcodes that no subsystem owns are listed. An opcode like MENU is
// perfectly correlated with its subsystem (MENUS is on exactly when OP_MENU
// is), and that subsystem's variant already includes the arm, so measuring
// both would count it twice. SET_VAR, END and JUMP are in the baseline.
// Several of these opcodes are only emitted for a real actor, so give the
// scene one to point at.
function withActor(p) {
  const a = makeActor('Extra', p.sprites[0].id, 6, 3);
  p.scenes[0].actors.push(a);
  return a;
}

const OPCODE_VARIANTS = {
  TEXT: () => [Object.assign(makeEvent('TEXT'), { text: 'hi' })],
  SWITCH_SCENE: (p) => {
    const dest = makeScene('Elsewhere');
    p.scenes.push(dest);
    return [Object.assign(makeEvent('SWITCH_SCENE'), { sceneId: dest.id })];
  },
  ADD_VAR: (p) => [Object.assign(makeEvent('ADD_VAR'), { varId: p.variables[0].id, delta: 1 })],
  IF_VAR: (p) => [Object.assign(makeEvent('IF_VAR'), { varId: p.variables[0].id })],
  WAIT: () => [makeEvent('WAIT')],
  ACTOR_VIS: () => [Object.assign(makeEvent('ACTOR_HIDE'), { target: 'player' })],
  SET_TILE: () => [makeEvent('SET_TILE')],
  PLAYER_POS: () => [makeEvent('PLAYER_POS')],
  ACTOR_MOVE: (p) => [Object.assign(makeEvent('ACTOR_MOVE'), { target: withActor(p).id })],
  SET_ACTOR_SPRITE: (p) => [Object.assign(makeEvent('SET_ACTOR_SPRITE'),
    { target: 'player', spriteId: p.sprites[0].id })],
  WAIT_INPUT: () => [Object.assign(makeEvent('WAIT_INPUT'), { buttons: { a: true } })],
  IF_INPUT: () => [Object.assign(makeEvent('IF_INPUT'), { buttons: { a: true } })],
  SET_ACTOR_DIR: () => [Object.assign(makeEvent('SET_ACTOR_DIR'), { target: 'player' })],
  SET_ACTOR_SPEED: (p) => [Object.assign(makeEvent('SET_ACTOR_SPEED'), { target: withActor(p).id })],
  IF_ACTOR_AT: () => [Object.assign(makeEvent('IF_ACTOR_AT'), { target: 'player' })],
  IF_ACTOR_DISTANCE: () => [Object.assign(makeEvent('IF_ACTOR_DISTANCE'), { target: 'player' })],
  STORE_ACTOR_DIR: (p) => [Object.assign(makeEvent('STORE_ACTOR_DIR'),
    { target: 'player', varId: p.variables[0].id })],
  STORE_ACTOR_POS: (p) => [Object.assign(makeEvent('STORE_ACTOR_POS'),
    { target: 'player', varX: p.variables[0].id, varY: p.variables[1].id })],
  SEED_RNG: () => [makeEvent('SEED_RNG')],
  SET_ANIM_FRAME: () => [Object.assign(makeEvent('SET_ANIM_FRAME'), { target: 'player' })],
  SET_ANIM_SPEED: () => [Object.assign(makeEvent('SET_ANIM_SPEED'), { target: 'player' })],
  SET_ANIM_STATE: (p) => {
    // The state has to belong to the sprite the target wears, and a scene
    // script cannot resolve the player's sprite, so name an actor.
    const a = withActor(p);
    const spr = p.sprites.find((s) => s.id === a.spriteId);
    return [Object.assign(makeEvent('SET_ANIM_STATE'),
      { target: a.id, stateId: spr.states[0].id })];
  },
  START_SCRIPT: () => [makeEvent('START_SCRIPT')],
};

console.log('\n== measuring opcode arms ==');
const opcodes = {};
for (const [name, build] of Object.entries(OPCODE_VARIANTS)) {
  const p = bare();
  p.scenes[0].scripts.init.push(...build(p));
  // A variant whose events the compiler skipped (a missing target, an
  // unnamed animation state) would measure as free and quietly make the
  // estimate too low, so insist the arm is really switched on.
  const { compiled } = generateIno(p);
  if (!compiled.features[`OP_${name}`]) {
    failed = true;
    console.error(`  OP_${name}: variant does not emit the opcode`
      + `${compiled.warnings.length ? ` — ${compiled.warnings[0]}` : ''}`);
    continue;
  }
  let n;
  try {
    n = flashOf(`op_${name.toLowerCase()}`, p);
  } catch (err) {
    failed = true;
    console.error(`  ${name}: FAILED to build — ${err.message.split('\n')[0]}`);
    continue;
  }
  // The event itself adds bytecode and sometimes a string; that is data the
  // estimate counts separately, so take it back out.
  const dataBytes = generateIno(p).compiled.code.length - generateIno(bare()).compiled.code.length;
  opcodes[`OP_${name}`] = Math.max(0, n - baseline - dataBytes);
  console.log(`  ${`OP_${name}`.padEnd(20)} +${String(opcodes[`OP_${name}`]).padStart(5)} bytes`);
}

console.log('\n== measuring encodings and boot ==');
// What the Arduboy startup logo costs a game that leaves it in.
let bootLogo = 0;
{
  const p = bare();
  p.settings.minimalBoot = false;
  bootLogo = flashOf('boot_logo', p) - baseline;
  console.log(`  ${'BOOT_LOGO'.padEnd(20)} +${String(bootLogo).padStart(5)} bytes`);
}
// What the packed-tilemap reader costs. The bare project's scene is two tiles,
// so it packs to one bit each; the comparison is the same scene painted with
// more than 16 different tiles, which is the point where packing stops paying
// and the sketch keeps the plain one-byte-per-tile lookup.
let packedTiles = 0;
{
  const packed = bare();
  const plain = bare();
  while (plain.tiles.length <= 16) {
    plain.tiles.push(makeTile(`T${plain.tiles.length}`, ['00000000']));
  }
  const sc = plain.scenes[0];
  for (let i = 0; i < sc.tiles.length; i++) sc.tiles[i] = i % plain.tiles.length;

  const pc = generateIno(packed).compiled;
  const lc = generateIno(plain).compiled;
  if (pc.features.PACKED_TILES === lc.features.PACKED_TILES) {
    failed = true;
    console.error('  PACKED_TILES: both variants pack the same way — cannot measure');
  } else {
    // The two differ in tile art and map encoding as well as in code, and the
    // estimate counts both of those separately. Subtract them back out.
    const dataDelta = (lc.tiles.length - pc.tiles.length) * 8
      + Math.ceil(lc.tiles.length / 8) - Math.ceil(pc.tiles.length / 8)
      + packedTilemapSize(lc.scenes[0].tiles) - packedTilemapSize(pc.scenes[0].tiles);
    packedTiles = flashOf('packed_tiles', packed) - (flashOf('plain_tiles', plain) - dataDelta);
    console.log(`  ${'PACKED_TILES'.padEnd(20)} +${String(packedTiles).padStart(5)} bytes`);
  }
}

// Adding the pieces up under-predicts a real game by a few percent, and always
// in the same direction. Each variant is measured on its own, so the model
// never sees what only appears once the pieces are combined: LTO inlines less
// aggressively in a bigger sketch, and the switch dispatch and branch targets
// grow as the code does.
//
// Rather than leave the Export tab quietly optimistic — the one direction it
// must not be — calibrate the shortfall here against real builds and publish it
// as a margin. Regenerating the table regenerates the margin with it.
console.log('\n== calibrating against real builds ==');
let margin = 0;
{
  const { makeDemoProject } = await import('../js/model.js');
  const { makeAllFeaturesProject } = await import('./all_features_project.mjs');

  // The additive model, using the numbers just measured rather than the table
  // on disk, which is what compileProject() would still be holding.
  const modelTotal = (compiled) => {
    const f = compiled.features;
    let n = baseline + compiled.flash.dataBytes;
    for (const [name, bytes] of Object.entries(costs)) if (f[name]) n += bytes;
    for (const [name, bytes] of Object.entries(opcodes)) if (f[name]) n += bytes;
    if (!f.MINIMAL_BOOT) n += bootLogo;
    if (f.PACKED_TILES) n += packedTiles;
    return n;
  };

  for (const [label, project] of [['demo', makeDemoProject()],
    ['all-features', makeAllFeaturesProject()]]) {
    const { compiled } = generateIno(project);
    const model = modelTotal(compiled);
    const real = flashOf(`cal_${label}`, project);
    const short = (real - model) / model;
    margin = Math.max(margin, short);
    console.log(`  ${label.padEnd(16)} model ${model}, real ${real}`
      + ` — model is ${(short * 100).toFixed(1)}% low`);
  }
  // Round up to the next whole percent and add one more, so an unmeasured
  // project shape has somewhere to go before the estimate goes optimistic.
  margin = Math.max(0, Math.ceil(margin * 100) + 1) / 100;
  console.log(`  margin: ${(margin * 100).toFixed(0)}%`);
}

// LTO inlines differently between variants, so a cheap subsystem occasionally
// measures a handful of bytes below the baseline. The estimate has to err high
// (tools/check_flash_estimate.mjs fails if it lands under a real build), so a
// negative reading becomes zero rather than a discount.
for (const table of [costs, opcodes]) {
  for (const [k, v] of Object.entries(table)) if (v < 0) table[k] = 0;
}
if (packedTiles < 0) packedTiles = 0;

const body = `// GENERATED by tools/measure_flash.mjs — do not edit by hand.
//
// What the engine costs in flash on an ATmega32u4, measured by compiling a bare
// game and then one variant per optional subsystem. Regenerate whenever the
// engine changes; tools/test_runtime.mjs checks these against a real build so
// they cannot drift silently.
//
// Measured ${new Date().toISOString().slice(0, 10)}.

// Usable flash on an Arduboy once the bootloader has its share.
export const FLASH_BUDGET = 28672;

// A game with no optional subsystems and no optional opcodes: the Arduboy2
// library, the engine's always-on core, and a script that sets one variable.
export const FLASH_BASELINE = ${baseline};

// Extra bytes each subsystem adds when a game scripts it.
export const FLASH_SUBSYSTEM = {
${Object.entries(costs).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v},`).join('\n')}
};

// Extra bytes each opcode's arm of runScript's switch adds. Opcodes a
// subsystem above already accounts for are deliberately absent.
export const FLASH_OPCODE = {
${Object.entries(opcodes).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v},`).join('\n')}
};

// Leaving the Arduboy startup logo in (Export tab: "Skip the Arduboy boot
// logo"). The baseline above boots straight into the game.
export const FLASH_BOOT_LOGO = ${bootLogo};

// Reading bit-packed scene tile maps, for a game with a scene small enough to
// pack. Pays for itself many times over on the map data it saves.
export const FLASH_PACKED_TILES = ${packedTiles};

// Adding the parts up lands a few percent below a real build, because each was
// measured alone and none of them sees the others. Measured against real builds
// of the demo and the all-features project, rounded up. The Export tab applies
// it so the estimate errs high — the direction that never tells someone a game
// fits when it does not.
export const FLASH_SAFETY_MARGIN = ${margin};
`;

if (process.argv.includes('--check')) {
  console.log('\n--check: nothing written. Table would be:\n');
  console.log(body);
} else {
  const dest = join(root, 'js', 'flashCosts.js');
  writeFileSync(dest, body);
  console.log(`\nWrote ${dest}`);
}

if (failed) {
  console.error('\nSome variants could not be measured — the table above is incomplete.');
  process.exit(1);
}
