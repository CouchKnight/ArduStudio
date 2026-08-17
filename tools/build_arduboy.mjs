#!/usr/bin/env node
// Builds a complete .arduboy package: compiles the project with the real AVR
// toolchain, then wraps the resulting .hex with info.json and a banner.
//
// This is the one path that needs no manual step — build_avr.sh already fetches
// avr-gcc, the Arduino core and the Arduboy libraries, so a single command goes
// from project to installable package. The in-app exporter cannot do this
// because a browser has no compiler; it packages a .hex you built yourself.
//
// Usage:
//   node tools/build_arduboy.mjs                 # the Key Quest demo
//   PROJECT=all-features node tools/build_arduboy.mjs
//   node tools/build_arduboy.mjs my-game.json    # a saved project file
//   SKIP_BUILD=1 node tools/build_arduboy.mjs    # reuse build-avr/game.hex

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { makeDemoProject, normalizeProject } from '../js/model.js';
import { compileProject } from '../js/compiler.js';
import { Emulator } from '../js/emulator.js';
import { buildArduboyPackage, packageBaseName, packageProblem, renderBanner } from '../js/arduboyPackage.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hexPath = join(root, 'build-avr', 'game.hex');

async function loadProject() {
  const file = process.argv[2];
  if (file) return normalizeProject(JSON.parse(readFileSync(file, 'utf8')));
  if (process.env.PROJECT === 'all-features') {
    const { makeAllFeaturesProject } = await import('./all_features_project.mjs');
    return makeAllFeaturesProject();
  }
  return makeDemoProject();
}

const project = await loadProject();

// The format requires a non-empty title, author and version. A project made in
// the app may legitimately have no author yet, so fill in something rather than
// failing a CLI build over metadata.
project.settings = project.settings || {};
if (!String(project.author || '').trim()) project.author = 'ArduStudio';
if (!String(project.settings.version || '').trim()) project.settings.version = '1.0';

const problem = packageProblem(project);
if (problem) {
  console.error(`Cannot package: ${problem}`);
  process.exit(1);
}

if (!process.env.SKIP_BUILD) {
  console.log('== compiling with the AVR toolchain ==');
  execFileSync('bash', [join(root, 'tools', 'build_avr.sh')], {
    stdio: 'inherit',
    env: { ...process.env, PROJECT: process.env.PROJECT || 'demo' },
  });
}

if (!existsSync(hexPath)) {
  console.error(`No ${hexPath}. Run without SKIP_BUILD so the sketch gets compiled first.`);
  process.exit(1);
}

const compiled = compileProject(project);
const hex = readFileSync(hexPath, 'utf8');
const banner = renderBanner(compiled, Emulator);
const bytes = buildArduboyPackage({ project, compiled, hex, banner });

const out = join(root, `${packageBaseName(project)}.arduboy`);
writeFileSync(out, bytes);
console.log(`\nOK: ${out} (${(bytes.length / 1024).toFixed(1)} KB)`);
console.log('   info.json + the compiled .hex + a banner taken from the game itself.');
