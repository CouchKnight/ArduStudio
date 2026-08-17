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

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeProject, makeEvent, makeSong, noteFreq } from '../js/model.js';
import { generateIno } from '../js/codegen.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'build-avr');
const work = mkdtempSync(join(tmpdir(), 'ardustudio-flash-'));

if (!existsSync(join(OUT, 'obj'))) {
  console.error('No build-avr/obj — run tools/build_avr.sh once so the core and');
  console.error('library objects exist, then run this again.');
  process.exit(1);
}

const CFLAGS = [
  '-c', '-g', '-Os', '-w', '-ffunction-sections', '-fdata-sections',
  '-mmcu=atmega32u4', '-DF_CPU=16000000L', '-DARDUINO=10819',
  '-DARDUINO_AVR_LEONARDO', '-DARDUINO_ARCH_AVR', '-DUSB_VID=0x2341', '-DUSB_PID=0x8036',
  `-I${join(OUT, 'core')}`, `-I${join(OUT, 'ab2')}`, `-I${join(OUT, 'tones')}`,
];

// Everything except the sketch itself, which we swap per variant.
const fixedObjects = readdirSync(join(OUT, 'obj'))
  .filter((f) => f.endsWith('.o') && f !== 'sketch.cpp.o')
  .map((f) => join(OUT, 'obj', f));

function flashOf(label, project) {
  const { ino } = generateIno(project);
  const cpp = join(work, `${label}.cpp`);
  const obj = join(work, `${label}.o`);
  const elf = join(work, `${label}.elf`);
  writeFileSync(cpp, ino);
  execFileSync('avr-g++', [...CFLAGS, '-std=gnu++11', '-fpermissive', '-fno-exceptions',
    '-fno-threadsafe-statics', cpp, '-o', obj], { stdio: 'pipe' });
  execFileSync('avr-gcc', ['-w', '-Os', '-g', '-Wl,--gc-sections', '-mmcu=atmega32u4',
    '-o', elf, obj, ...fixedObjects, '-lm'], { stdio: 'pipe' });
  const size = execFileSync('avr-size', [elf], { encoding: 'utf8' });
  return parseInt(size.trim().split('\n')[1].trim().split(/\s+/)[0], 10);
}

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
  costs.SONGS = flashOf('songs', p) - baseline - dataBytes;
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

// A game with no optional subsystems at all, including the Arduboy2 and
// ArduboyTones libraries it always links.
export const FLASH_BASELINE = ${baseline};

// Extra bytes each subsystem adds when a game scripts it.
export const FLASH_SUBSYSTEM = {
${Object.entries(costs).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v},`).join('\n')}
};
`;

if (process.argv.includes('--check')) {
  console.log('\n--check: nothing written. Table would be:\n');
  console.log(body);
} else {
  const dest = join(root, 'js', 'flashCosts.js');
  writeFileSync(dest, body);
  console.log(`\nWrote ${dest}`);
}
