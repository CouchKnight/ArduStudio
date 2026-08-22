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
// whatever tools/build_avr.sh last left in build-avr, which makes each variant
// a couple of seconds instead of a full rebuild.
//
// The core is linked as an archive (build-avr/core.a) and the libraries as
// loose objects, which is how the Arduino IDE does it. That distinction is the
// whole ballgame for size: an archive member is pulled in only when it resolves
// an undefined symbol, so the core's HardwareSerial, Serial1, IPAddress and the
// rest — none of which an Arduboy sketch can reach — stay out. Linking the core
// loose, as this used to, made every measurement 1,516 bytes of flash and 185
// of RAM heavier than the figure the IDE reports for the same sketch.

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
// build has not been run — or was left by an older layout that had no core.a.
export function requireObjects(out) {
  if (existsSync(join(out, 'core.a')) && existsSync(join(out, 'obj', 'lib'))) return;
  console.error('No build-avr/core.a — run tools/build_avr.sh once so the core');
  console.error('archive and library objects exist, then run this again.');
  process.exit(1);
}

// Returns flashOf(label, ino) -> bytes of flash the sketch occupies.
export function makeFlashMeasurer(out, work) {
  // Libraries loose, then the core archive last: an archive only satisfies
  // symbols left undefined by everything before it on the command line.
  const libObjects = readdirSync(join(out, 'obj', 'lib'))
    .filter((f) => f.endsWith('.o'))
    .map((f) => join(out, 'obj', 'lib', f));
  const fixedObjects = [...libObjects, join(out, 'core.a')];

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
