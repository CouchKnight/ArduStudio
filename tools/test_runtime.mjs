#!/usr/bin/env node
// Behavioral test of the compiler + emulator against the Key Quest demo:
// boots the game, plays through the key fetch and door unlock purely by
// simulated button presses, and asserts on game state along the way.
//
// Usage: node tools/test_runtime.mjs

import { makeDemoProject } from '../js/model.js';
import { compileProject } from '../js/compiler.js';
import { Emulator, BTN } from '../js/emulator.js';

let tones = [];
const project = makeDemoProject();
const compiled = compileProject(project);
const emu = new Emulator(compiled, { onTone: (f, d) => tones.push([f, d]) });

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ok  ${msg}`);
  else { failures++; console.error(`FAIL  ${msg}`); }
}

function steps(n, buttons = 0) {
  for (let i = 0; i < n; i++) {
    emu.setButtons(buttons);
    emu.step();
  }
}
function tap(button) {
  steps(1, button);
  steps(1, 0);
}
// Dismiss all pages of the current dialogue.
function dismissDialogue(maxPages = 10) {
  for (let i = 0; i < maxPages && emu.text; i++) {
    steps(200, 0);     // let the typewriter finish
    tap(BTN.A);        // next page / close
    steps(2, 0);
  }
}
function playerTile() {
  return [Math.round(emu.player.px / 8), Math.round(emu.player.py / 8)];
}
// Walk one tile in a direction (holds the button until the step completes).
function walk(button, times = 1) {
  for (let i = 0; i < times; i++) {
    steps(1, button);
    for (let g = 0; g < 20 && emu.player.moving; g++) steps(1, button);
    steps(1, 0);
    if (emu.script.active) return; // a trigger fired
  }
}

console.log('— boot —');
assert(compiled.warnings.length === 0, `no compiler warnings (got: ${compiled.warnings.join('; ') || 'none'})`);
steps(1);
assert(emu.script.active && emu.text, 'intro dialogue starts on boot');
assert(emu.text.str.includes('KEY QUEST'), 'intro text is the KEY QUEST banner');
dismissDialogue();
assert(!emu.script.active, 'intro dialogue dismissed');
assert(emu.vars[1] === 1, 'intro_seen variable set to 1');

console.log('— talk to villager —');
// Player starts at (2,3); villager is at (3,5).
walk(BTN.DOWN, 2);
assert(playerTile()[1] === 5, `walked down to y=5 (at ${playerTile()})`);
emu.setButtons(BTN.RIGHT); emu.step(); emu.setButtons(0); // face right (blocked by villager)
steps(2, 0);
assert(!emu.player.moving, 'villager (solid) blocks walking into their tile');
tap(BTN.A);
assert(emu.script.active && emu.text, 'talking to villager starts dialogue');
assert(emu.text.str.includes('slime'), 'villager mentions the slime');
dismissDialogue();

console.log('— to the lake —');
// Row 2 of the village is fully clear: up 3 to y=2, east to x=13, up to y=1.
walk(BTN.UP, 3);
walk(BTN.RIGHT, 11);
assert(playerTile()[0] === 13, `walked east to x=13 (at ${playerTile()})`);
walk(BTN.UP, 1);
assert(playerTile()[1] === 1, `walked up to y=1 (at ${playerTile()})`);
walk(BTN.RIGHT, 1); // steps onto the path-to-lake trigger
steps(2, 0);
assert(emu.sceneIdx === 1, 'path trigger switched to the Lake scene');
assert(String(playerTile()) === '1,5', `spawned at lake entry (at ${playerTile()})`);

console.log('— get the key from the slime —');
// The slime patrols row 4 starting at x=8. Corner it by teleporting next to
// it via debug access (pathing to a moving actor isn't what we're testing).
const slime = emu.actors[0];
slime.hidden = false;
// Put the player directly below the slime's current tile and face up.
const sx = slime.tx, sy = slime.ty;
emu.player.px = sx * 8; emu.player.py = (sy + 1) * 8;
emu.player.tx = sx; emu.player.ty = sy + 1;
emu.player.fx = 0; emu.player.fy = -1;
tones = [];
tap(BTN.A);
assert(emu.script.active && emu.text, 'interacting with slime starts dialogue');
assert(emu.text.str.includes('key'), 'slime gives up the key');
dismissDialogue();
assert(emu.vars[0] === 1, 'has_key variable set');
assert(slime.hidden, 'slime hidden after giving the key');
assert(tones.length === 1 && tones[0][0] === 880, `key pickup tone played (${JSON.stringify(tones)})`);

console.log('— scene persistence —');
// Walk back to the village via the west exit trigger at (0,5).
emu.player.px = 1 * 8; emu.player.py = 5 * 8;
emu.player.tx = 1; emu.player.ty = 5;
emu.armedTrigger = -1;
walk(BTN.LEFT, 1);
steps(2, 0);
assert(emu.sceneIdx === 0, 'west trigger returns to the Village');
assert(!emu.text, 'intro does NOT replay on re-entry (intro_seen guard)');

console.log('— unlock the door —');
// Door trigger is at (8,1); door tile at (8,0) is solid until opened.
emu.player.px = 8 * 8; emu.player.py = 2 * 8;
emu.player.tx = 8; emu.player.ty = 2;
emu.armedTrigger = -1;
tones = [];
walk(BTN.UP, 1);
steps(2, 0);
assert(emu.script.active, 'door trigger fired');
dismissDialogue();
assert(emu.ramTiles[0 * 16 + 8] === 1, 'door tile swapped to floor (SET_TILE)');
assert(tones.some(([f]) => f === 1320), 'victory tone played');
assert(!emu.tileSolid(8, 0), 'doorway is now walkable');

console.log('— locked-door branch (fresh run) —');
const emu2 = new Emulator(compiled, { onTone: () => {} });
emu2.setButtons(0); emu2.step();
// dismiss intro
while (emu2.text) { for (let i = 0; i < 200; i++) { emu2.setButtons(0); emu2.step(); } emu2.setButtons(BTN.A); emu2.step(); emu2.setButtons(0); emu2.step(); }
emu2.player.px = 8 * 8; emu2.player.py = 2 * 8;
emu2.player.tx = 8; emu2.player.ty = 2;
emu2.armedTrigger = -1;
emu2.setButtons(BTN.UP);
for (let i = 0; i < 12; i++) emu2.step();
emu2.setButtons(0); emu2.step();
assert(emu2.text && emu2.text.str.includes('locked'), 'without the key the door reports locked');
assert(emu2.ramTiles[8] === 3, 'door tile stays a door');

console.log('— bytecode sanity —');
assert(compiled.code.length > 40 && compiled.code.length < 4096, `bytecode size sensible (${compiled.code.length} bytes)`);
assert(compiled.strings.every((s) => s.split('\f').every((p) => p.split('\n').length <= 3 && p.split('\n').every((l) => l.length <= 20))), 'all strings wrapped to 20 chars x 3 lines per page');

console.log(failures ? `\n${failures} FAILURES` : '\nAll runtime tests passed.');
process.exit(failures ? 1 : 0);
