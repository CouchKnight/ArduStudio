#!/usr/bin/env node
// Generates the .ino sketch for the demo project and syntax-checks it with
// the host g++ against stub Arduboy2 headers. Catches code-generator
// regressions without needing an AVR toolchain.
//
// Usage: node tools/check_codegen.mjs

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { makeDemoProject, makeProject, makeEvent, makeSong, noteFreq } from '../js/model.js';
import { makeAllFeaturesProject } from './all_features_project.mjs';
import { generateIno } from '../js/codegen.js';
import { FONT5X7 } from '../js/font5x7.js';
import { packTilemap } from '../js/compiler.js';


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'ardustudio-'));

let failed = false;

// The Arduino IDE preprocesses a .ino by generating prototypes for the sketch's
// functions and inserting them immediately before the FIRST function definition.
// Any type named in a function signature must therefore be declared above that
// point, or the inserted prototype refers to a type that does not exist yet and
// the build dies with "variable or field 'x' declared void" / "'T' was not
// declared in this scope".
//
// We compile the sketch as a .cpp here, which never goes through that step, so
// g++ alone cannot see this class of break — it once shipped to a user. Encode
// the rule instead: only a type used in a parameter list can trigger it.
function checkInoPrototypeSafety(ino) {
  const lines = ino.split('\n');
  const types = new Map(); // name -> line number it is defined on
  let firstFunctionLine = -1;
  let firstFunctionName = '';

  const typeDef = /^(?:struct|enum|union)\s+([A-Za-z_]\w*)\s*[{:]|^typedef\s+.*\b([A-Za-z_]\w*)\s*;/;
  // A definition at column 0: `type name(args) {`. Excludes control keywords.
  const funcDef = /^([A-Za-z_][\w:<>*&\s]*?[\s*&])([A-Za-z_]\w*)\s*\(([^;]*)\)\s*(?:const\s*)?\{/;

  lines.forEach((line, i) => {
    const t = typeDef.exec(line);
    if (t) { types.set(t[1] || t[2], i + 1); return; }
    const f = funcDef.exec(line);
    if (!f) return;
    if (/^\s*(if|for|while|switch|else|do|return)\b/.test(line)) return;
    if (firstFunctionLine < 0) { firstFunctionLine = i + 1; firstFunctionName = f[2]; }
  });

  if (firstFunctionLine < 0) return [];

  const problems = [];
  lines.forEach((line, i) => {
    const f = funcDef.exec(line);
    if (!f) return;
    if (/^\s*(if|for|while|switch|else|do|return)\b/.test(line)) return;
    for (const [name, definedAt] of types) {
      // Only parameter lists matter — a body referring to a later type is fine.
      if (!new RegExp(`\\b${name}\\b`).test(f[3])) continue;
      if (definedAt > firstFunctionLine) {
        problems.push(
          `${f[2]}() at line ${i + 1} takes '${name}', but '${name}' is defined at line ${definedAt} — ` +
          `after the first function definition (${firstFunctionName}() at line ${firstFunctionLine}). ` +
          `The Arduino IDE will insert its generated prototype above it and fail to compile. ` +
          `Move the '${name}' definition above line ${firstFunctionLine}.`);
      }
    }
  });
  return problems;
}

// Every subsystem and every opcode arm can be stripped independently, so the
// three projects below only ever exercise a few of the many shapes a generated
// sketch can take. These add one feature at a time to an otherwise bare game,
// which is what catches a call left outside its guard — a Play Tone in a game
// with no songs once reached for stopSong() inside the SONGS region and would
// not compile for a user, while demo/all-features both built fine.
function oneFeature(events) {
  const p = makeProject();
  p.scenes[0].scripts.init = events(p);
  return p;
}
const ev = (type, fields) => Object.assign(makeEvent(type), fields || {});

const singles = {
  'only-tone': () => [ev('TONE')],
  'only-song': (p) => {
    const song = makeSong('Test');
    song.notes = [{ f: noteFreq('C4'), d: 100 }];
    p.songs.push(song);
    return [ev('PLAY_SONG', { songId: song.id })];
  },
  'only-menu': (p) => [ev('MENU', { varId: p.variables[0].id, options: ['A', 'B'] })],
  'only-save': () => [ev('SAVE_GAME'), ev('LOAD_GAME')],
  'only-led': () => [ev('SET_LED')],
  'only-button-script': () => [ev('ATTACH_SCRIPT', { button: 'b', script: [ev('SEED_RNG')] })],
  'only-text': () => [ev('TEXT', { text: 'hi' })],
  'only-fade': () => [ev('FADE_OUT'), ev('FADE_IN')],
  'only-overlay': () => [ev('SHOW_OVERLAY'), ev('HIDE_OVERLAY')],
  'only-expr': (p) => [ev('EXPR_SET', { varId: p.variables[0].id, expression: '1 + 2' })],
};

const projects = [
  ['demo', makeDemoProject()],
  ['blank', makeProject()],
  ['all-features', makeAllFeaturesProject()],
  ...Object.entries(singles).map(([label, events]) => [label, oneFeature(events)]),
];

for (const [label, project] of projects) {
  const { ino, warnings } = generateIno(project);
  if (warnings.length) console.log(`[${label}] compiler warnings:\n  ${warnings.join('\n  ')}`);

  const protoProblems = checkInoPrototypeSafety(ino);
  if (protoProblems.length) {
    failed = true;
    console.error(`[${label}] FAILED .ino prototype-order check:`);
    for (const p of protoProblems) console.error(`  ${p}`);
  }

  const cpp = join(work, `${label}.cpp`);
  writeFileSync(cpp, ino);
  try {
    // Link, don't just syntax-check. Engine subsystems are stripped from the
    // sketch when a game does not use them, and a helper left inside the wrong
    // //#IF region still parses fine — its callers only see the declaration.
    // Only the linker notices it is gone, so the stub bodies exist to make a
    // real link possible here rather than at the AVR build.
    execFileSync('g++', [
      '-x', 'c++', '-std=c++11',
      '-Wall', '-Wextra', '-Wno-unused-parameter',
      '-I', join(root, 'tools', 'stubs'),
      cpp, join(root, 'tools', 'stubs', 'stubs.cpp'),
      '-o', join(work, `${label}.bin`),
    ], { stdio: 'pipe' });
    console.log(`[${label}] OK — generated sketch compiles and links (${ino.length} chars)`);
  } catch (err) {
    failed = true;
    console.error(`[${label}] FAILED g++ compile/link:`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    console.error(`Sketch left at ${cpp}`);
  }
}

// The sketch renders text with its own drawChar and a 95-character font slice
// instead of linking Arduboy2's text layer (worth ~1.1 KB of flash). That is
// only safe if it puts exactly the same pixels on the screen, so compile the
// generated function next to a transcription of Arduboy2::drawChar and compare
// frame buffers for every character at every alignment.
{
  const { ino } = generateIno(makeDemoProject());
  const font = /const uint8_t PROGMEM font5x7\[\] = \{[\s\S]*?\};/.exec(ino);
  const start = ino.indexOf('#define CHAR_W');
  const drawChar = start < 0 ? null : ino.slice(start, ino.indexOf('\n}\n', start) + 3);

  if (!font || !drawChar) {
    failed = true;
    console.error('[font] FAILED — could not find font5x7/drawChar in the generated sketch');
  } else {
    const harness = `
#include <cstdint>
#include <cstring>
#include <cstdio>
#define PROGMEM
#define pgm_read_byte(a) (*(const uint8_t*)(a))
#define WIDTH 128
#define HEIGHT 64
static struct { uint8_t sBuffer[WIDTH * HEIGHT / 8]; } arduboy;
${font[0]}
${drawChar}

// Arduboy2::drawChar(x, y, c, WHITE, BLACK, 1) with the library's own geometry
// (characterWidth 5, characterHeight 8, one spacing column and row) and its
// per-pixel drawPixel path, which clips rather than wraps.
static const uint8_t fullFont[] = { ${Array.from(FONT5X7).join(', ')} };
static uint8_t ref[WIDTH * HEIGHT / 8];
static void refPixel(int16_t x, int16_t y, uint8_t on) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  uint8_t& b = ref[(y / 8) * WIDTH + x];
  if (on) b |= (1 << (y & 7)); else b &= ~(1 << (y & 7));
}
static void refDrawChar(int16_t x, int16_t y, uint8_t c) {
  const uint8_t* bitmap = &fullFont[(uint16_t)c * 5];
  for (uint8_t i = 0; i < 6; i++) {
    uint8_t column = (i < 5) ? bitmap[i] : 0;
    for (uint8_t j = 0; j < 8; j++) { refPixel(x + i, y + j, column & 1); column >>= 1; }
    refPixel(x + i, y + 8, 0); // the line-spacing row is background
  }
}

int main() {
  long checked = 0;
  for (int c = 32; c <= 126; c++) {
    for (int y = -12; y <= 68; y++) {
      for (int x = -8; x <= 130; x++) {
        // Start from a non-blank buffer so background clearing is checked too.
        memset(arduboy.sBuffer, 0xA5, sizeof(arduboy.sBuffer));
        memset(ref, 0xA5, sizeof(ref));
        drawChar(x, y, (uint8_t)c);
        refDrawChar(x, y, (uint8_t)c);
        if (memcmp(arduboy.sBuffer, ref, sizeof(ref)) != 0) {
          printf("MISMATCH c=%d ('%c') x=%d y=%d\\n", c, c, x, y);
          return 1;
        }
        checked++;
      }
    }
  }
  printf("%ld placements identical\\n", checked);
  return 0;
}
`;
    const src = join(work, 'fontparity.cpp');
    writeFileSync(src, harness);
    try {
      execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', src, '-o', join(work, 'fontparity')],
        { stdio: 'pipe' });
      const out = execFileSync(join(work, 'fontparity'), { stdio: 'pipe' }).toString().trim();
      console.log(`[font] OK — drawChar matches Arduboy2 exactly (${out})`);
    } catch (err) {
      failed = true;
      console.error('[font] FAILED drawChar parity against Arduboy2:');
      console.error((err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message));
      console.error(`Harness left at ${src}`);
    }
  }
}

// Wandering actors and the RND expression function now draw from the same
// xorshift32 in both runtimes, so a play test predicts what the device does.
// JS's >> is a signed shift on the int32 view of the value while >>> is not;
// the C++ side has to reproduce that exactly or the sequences diverge.
{
  const { ino } = generateIno(makeDemoProject());
  const start = ino.indexOf('uint32_t rngState = ');
  const rnd = start < 0 ? null : ino.slice(start, ino.indexOf('\n}\n', start) + 3);
  if (!rnd) {
    failed = true;
    console.error('[rng] FAILED — could not find rnd() in the generated sketch');
  } else {
    // The emulator's generator, transcribed from js/emulator.js rand().
    let rngState = 0xdead4a11;
    const jsRand = (n) => {
      let x = rngState;
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      rngState = x;
      return x % n;
    };
    const mods = [4, 48, 20, 7, 1000, 3];
    const expected = [];
    for (let i = 0; i < 2000; i++) expected.push(jsRand(mods[i % mods.length]));

    const src = join(work, 'rngparity.cpp');
    writeFileSync(src, `
#include <cstdint>
#include <cstdio>
${rnd}
static const uint16_t mods[] = { ${mods.join(', ')} };
static const uint16_t expected[] = { ${expected.join(', ')} };
int main() {
  for (int i = 0; i < ${expected.length}; i++) {
    uint16_t got = rnd(mods[i % ${mods.length}]);
    if (got != expected[i]) { printf("DIVERGED at %d: got %u want %u\\n", i, got, expected[i]); return 1; }
  }
  printf("%d draws identical\\n", ${expected.length});
  return 0;
}
`);
    try {
      execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', src, '-o', join(work, 'rngparity')],
        { stdio: 'pipe' });
      const out = execFileSync(join(work, 'rngparity'), { stdio: 'pipe' }).toString().trim();
      console.log(`[rng] OK — device and play-test PRNG agree (${out})`);
    } catch (err) {
      failed = true;
      console.error('[rng] FAILED PRNG parity with js/emulator.js:');
      console.error((err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message));
      console.error(`Harness left at ${src}`);
    }
  }
}

// Scene tile maps ship bit-packed behind a palette. Nothing catches a bad
// unpack except the game drawing the wrong tiles, so run the sketch's own
// unpackTile() over every packed map in the project and insist it reproduces
// the compiled tile indices exactly, tile for tile.
for (const [label, project] of [['demo', makeDemoProject()], ['all-features', makeAllFeaturesProject()]]) {
  const { ino, compiled } = generateIno(project);
  const packedScenes = compiled.scenes
    .map((sc, i) => ({ i, sc, packed: packTilemap(sc.tiles) }))
    .filter((e) => e.packed.shift !== 0);

  if (!packedScenes.length) {
    console.log(`[tiles:${label}] no scene packs — nothing to check`);
    continue;
  }
  const start = ino.indexOf('uint8_t unpackTile(');
  const unpack = start < 0 ? null : ino.slice(start, ino.indexOf('\n}\n', start) + 3);
  if (!unpack) {
    failed = true;
    console.error(`[tiles:${label}] FAILED — sketch packs scenes but has no unpackTile()`);
    continue;
  }

  const arr = (name, bytes) => `static const uint8_t ${name}[] = { ${Array.from(bytes).join(', ')} };`;
  const cases = packedScenes.map(({ i, sc, packed }) => `
  ${arr(`t${i}`, packed.bytes)}
  ${arr(`p${i}`, packed.palette)}
  ${arr(`want${i}`, sc.tiles)}
  for (uint16_t k = 0; k < ${sc.tiles.length}; k++) {
    uint8_t got = unpackTile(t${i}, p${i}, ${packed.shift}, k);
    if (got != want${i}[k]) {
      printf("scene ${i} tile %u: got %u want %u\\n", k, got, want${i}[k]);
      return 1;
    }
    checked++;
  }`).join('\n');

  const src = join(work, `tiles-${label}.cpp`);
  writeFileSync(src, `
#include <cstdint>
#include <cstdio>
#define PROGMEM
#define pgm_read_byte(a) (*(const uint8_t*)(a))
${unpack}
int main() {
  long checked = 0;
${cases}
  printf("%ld tiles across ${packedScenes.length} packed scenes\\n", checked);
  return 0;
}
`);
  try {
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', src, '-o', join(work, `tiles-${label}`)],
      { stdio: 'pipe' });
    const out = execFileSync(join(work, `tiles-${label}`), { stdio: 'pipe' }).toString().trim();
    console.log(`[tiles:${label}] OK — packed maps unpack to the original (${out})`);
  } catch (err) {
    failed = true;
    console.error(`[tiles:${label}] FAILED packed tilemap round-trip:`);
    console.error((err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message));
    console.error(`Harness left at ${src}`);
  }
}

process.exit(failed ? 1 : 0);
