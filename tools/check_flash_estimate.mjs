#!/usr/bin/env node
// Checks the Export tab's flash estimate against a real AVR build.
//
// The estimate is a measured table (js/flashCosts.js) plus exact data sizes, so
// it can only stay honest while the table matches the engine. This compiles the
// demo and the all-features project for real and compares. Run it after changing
// the engine; if it drifts, re-run tools/measure_flash.mjs.
//
// Kept out of test_runtime.mjs deliberately: it needs the AVR toolchain, which
// the unit tests do not.
//
// Usage: node tools/check_flash_estimate.mjs

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeDemoProject } from '../js/model.js';
import { makeAllFeaturesProject } from './all_features_project.mjs';
import { compileProject } from '../js/compiler.js';
import { generateIno } from '../js/codegen.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'build-avr');
const work = mkdtempSync(join(tmpdir(), 'ardustudio-est-'));

// How far the estimate may be out before it stops being useful. It should also
// err high: warning too late is the failure this whole feature exists to stop.
const TOLERANCE = 0.05;

if (!existsSync(join(OUT, 'obj'))) {
  console.error('No build-avr/obj — run tools/build_avr.sh once first.');
  process.exit(1);
}

const CFLAGS = [
  '-c', '-g', '-Os', '-w', '-ffunction-sections', '-fdata-sections',
  '-mmcu=atmega32u4', '-DF_CPU=16000000L', '-DARDUINO=10819',
  '-DARDUINO_AVR_LEONARDO', '-DARDUINO_ARCH_AVR', '-DUSB_VID=0x2341', '-DUSB_PID=0x8036',
  `-I${join(OUT, 'core')}`, `-I${join(OUT, 'ab2')}`, `-I${join(OUT, 'tones')}`,
];
const fixedObjects = readdirSync(join(OUT, 'obj'))
  .filter((f) => f.endsWith('.o') && f !== 'sketch.cpp.o')
  .map((f) => join(OUT, 'obj', f));

function realFlash(label, project) {
  const cpp = join(work, `${label}.cpp`);
  writeFileSync(cpp, generateIno(project).ino);
  execFileSync('avr-g++', [...CFLAGS, '-std=gnu++11', '-fpermissive', '-fno-exceptions',
    '-fno-threadsafe-statics', cpp, '-o', join(work, `${label}.o`)], { stdio: 'pipe' });
  execFileSync('avr-gcc', ['-w', '-Os', '-g', '-Wl,--gc-sections', '-mmcu=atmega32u4',
    '-o', join(work, `${label}.elf`), join(work, `${label}.o`), ...fixedObjects, '-lm'], { stdio: 'pipe' });
  const size = execFileSync('avr-size', [join(work, `${label}.elf`)], { encoding: 'utf8' });
  return parseInt(size.trim().split('\n')[1].trim().split(/\s+/)[0], 10);
}

let failed = false;
for (const [label, project] of [['demo', makeDemoProject()], ['all-features', makeAllFeaturesProject()]]) {
  const estimate = compileProject(project).flash.total;
  const real = realFlash(label, project);
  const diff = estimate - real;
  const pct = diff / real;
  const ok = Math.abs(pct) <= TOLERANCE;
  const high = diff >= 0;
  console.log(`[${label}] estimate ${estimate} vs real ${real} — ${diff >= 0 ? '+' : ''}${diff} (${(pct * 100).toFixed(1)}%)`);
  if (!ok) {
    failed = true;
    console.error(`  FAILED: outside ±${TOLERANCE * 100}%. Re-run tools/measure_flash.mjs.`);
  } else if (!high) {
    failed = true;
    console.error('  FAILED: the estimate is UNDER the real size. It must err high, or a');
    console.error('  game that will not fit gets told it does.');
  }
}

process.exit(failed ? 1 : 0);
