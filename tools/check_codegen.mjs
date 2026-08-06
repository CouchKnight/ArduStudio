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

import { makeDemoProject, makeProject } from '../js/model.js';
import { generateIno } from '../js/codegen.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'ardustudio-'));

let failed = false;

for (const [label, project] of [['demo', makeDemoProject()], ['blank', makeProject()]]) {
  const { ino, warnings } = generateIno(project);
  if (warnings.length) console.log(`[${label}] compiler warnings:\n  ${warnings.join('\n  ')}`);
  const cpp = join(work, `${label}.cpp`);
  writeFileSync(cpp, ino);
  try {
    execFileSync('g++', [
      '-x', 'c++', '-std=c++11', '-fsyntax-only',
      '-Wall', '-Wextra', '-Wno-unused-parameter',
      '-I', join(root, 'tools', 'stubs'),
      cpp,
    ], { stdio: 'pipe' });
    console.log(`[${label}] OK — generated sketch compiles cleanly (${ino.length} chars)`);
  } catch (err) {
    failed = true;
    console.error(`[${label}] FAILED g++ syntax check:`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    console.error(`Sketch left at ${cpp}`);
  }
}

process.exit(failed ? 1 : 0);
