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
import { makeAllFeaturesProject } from './all_features_project.mjs';
import { generateIno } from '../js/codegen.js';


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'ardustudio-'));

let failed = false;

const projects = [
  ['demo', makeDemoProject()],
  ['blank', makeProject()],
  ['all-features', makeAllFeaturesProject()],
];

for (const [label, project] of projects) {
  const { ino, warnings } = generateIno(project);
  if (warnings.length) console.log(`[${label}] compiler warnings:\n  ${warnings.join('\n  ')}`);
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

process.exit(failed ? 1 : 0);
