// One place for "compile a generated sketch for the ATmega32u4 and report its
// flash size", shared by tools/measure_flash.mjs and tools/check_flash_estimate.mjs.
//
// It lives here because the two of them once carried their own copies of these
// flags and quietly disagreed: one built with -flto and the other without, so
// the checker measured a demo 718 bytes heavier than the tool that produced the
// numbers it was checking. Both are meant to reproduce what the Arduino IDE
// does, and they can only stay that way from a single definition.
//
// Object files for the Arduino core and the Arduboy libraries are reused from
// whatever tools/build_avr.sh last left in build-avr/obj, which makes each
// variant a couple of seconds instead of a full rebuild.

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The Arduino IDE compiles and links with -flto. Without it the same sketch
// links several hundred bytes heavier, which is enough to make a flash estimate
// wrong in the one direction that matters.
export const AVR_CFLAGS = (out) => [
  '-c', '-g', '-Os', '-w', '-flto', '-ffunction-sections', '-fdata-sections',
  '-mmcu=atmega32u4', '-DF_CPU=16000000L', '-DARDUINO=10819',
  '-DARDUINO_AVR_LEONARDO', '-DARDUINO_ARCH_AVR', '-DUSB_VID=0x2341', '-DUSB_PID=0x8036',
  `-I${join(out, 'core')}`, `-I${join(out, 'ab2')}`, `-I${join(out, 'tones')}`,
];

export const AVR_LDFLAGS = [
  '-w', '-Os', '-g', '-flto', '-fuse-linker-plugin',
  '-Wl,--gc-sections', '-mmcu=atmega32u4',
];

// Exits with a usable message rather than a stack trace when the prerequisite
// build has not been run.
export function requireObjects(out) {
  if (existsSync(join(out, 'obj'))) return;
  console.error('No build-avr/obj — run tools/build_avr.sh once so the core and');
  console.error('library objects exist, then run this again.');
  process.exit(1);
}

// Returns flashOf(label, ino) -> bytes of flash the sketch occupies.
export function makeFlashMeasurer(out, work) {
  const fixedObjects = readdirSync(join(out, 'obj'))
    .filter((f) => f.endsWith('.o') && f !== 'sketch.cpp.o')
    .map((f) => join(out, 'obj', f));

  return function flashOf(label, ino) {
    const cpp = join(work, `${label}.cpp`);
    const obj = join(work, `${label}.o`);
    const elf = join(work, `${label}.elf`);
    writeFileSync(cpp, ino);
    execFileSync('avr-g++', [...AVR_CFLAGS(out), '-std=gnu++11', '-fpermissive',
      '-fno-exceptions', '-fno-threadsafe-statics', cpp, '-o', obj], { stdio: 'pipe' });
    execFileSync('avr-gcc', [...AVR_LDFLAGS, '-o', elf, obj, ...fixedObjects, '-lm'],
      { stdio: 'pipe' });
    const size = execFileSync('avr-size', [elf], { encoding: 'utf8' });
    return parseInt(size.trim().split('\n')[1].trim().split(/\s+/)[0], 10);
  };
}
