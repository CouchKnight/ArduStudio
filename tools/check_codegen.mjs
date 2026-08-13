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

const projects = [
  ['demo', makeDemoProject()],
  ['blank', makeProject()],
  ['all-features', makeAllFeaturesProject()],
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

process.exit(failed ? 1 : 0);
