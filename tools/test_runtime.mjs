#!/usr/bin/env node
// Behavioral test of the compiler + emulator against the Key Quest demo:
// boots the game, plays through the key fetch and door unlock purely by
// simulated button presses, and asserts on game state along the way.
//
// Usage: node tools/test_runtime.mjs

import { makeDemoProject, makeEvent as makeEventOfType } from '../js/model.js';
import { compileProject } from '../js/compiler.js';
import { Emulator, BTN, memoryStorage } from '../js/emulator.js';

// Tap a button for one frame, then release it — justPressed only fires on the
// frame a button goes down.
function press(e, button) {
  e.setButtons(button); e.step();
  e.setButtons(0); e.step();
}

// Face actor `idx` from below, press A to start its script, and (optionally)
// run the script to completion.
function runActorScript(e, idx, runToEnd = true) {
  const a = e.actors[idx];
  e.player.px = a.tx * 8; e.player.py = (a.ty + 1) * 8;
  e.player.tx = a.tx; e.player.ty = a.ty + 1;
  e.player.fx = 0; e.player.fy = -1;
  e.script.active = false; e.text = null;
  press(e, BTN.A);
  if (!runToEnd) return;
  for (let i = 0; i < 400 && e.script.active && !e.menu; i++) { e.setButtons(0); e.step(); }
}

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
// Dismiss all pages of the current dialogue, accepting the default option of
// any menu the script opens along the way, then let the rest of the script
// (waits, scripted actor moves) run out so control returns to the player.
function dismissDialogue(maxPages = 12) {
  for (let i = 0; i < maxPages && (emu.text || emu.menu); i++) {
    if (emu.menu) {
      tap(BTN.A);      // take the highlighted option
      steps(2, 0);
      continue;
    }
    steps(200, 0);     // let the typewriter finish
    tap(BTN.A);        // next page / close
    steps(2, 0);
  }
  for (let i = 0; i < 600 && emu.script.active && !emu.text && !emu.menu; i++) steps(1, 0);
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
assert(tones.length >= 1 && tones[0][0] === 659, `key jingle song started (${JSON.stringify(tones)})`);
// The pickup script flashes the LED and waits 20 frames, which outlasts the
// 3-note jingle (~18 frames), so by now every note has played and it has ended.
assert(tones.map(([f]) => f).join() === '659,784,1047', `all 3 jingle notes played (${tones.map(([f]) => f).join()})`);
assert(emu.song.idx === -1, 'jingle finished cleanly');
assert(emu.led.r === 0 && emu.led.g === 0 && emu.led.b === 0, 'pickup LED flash turned back off');

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
assert(emu.tileAt(8, 0) === 1, 'door tile swapped to floor (SET_TILE)');
// The fanfare (~820ms) finishes during the dialogue wait, so assert on the
// notes that were emitted rather than on the song still being active.
assert(tones.length >= 4 && tones[0][0] === 523, `victory fanfare played (${JSON.stringify(tones.slice(0, 3))})`);
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
assert(emu2.tileAt(8, 0) === 3, 'door tile stays a door');

console.log('— scrolling scenes & camera —');
{
  const lake = compiled.scenes[1];
  assert(lake.cols === 32 && lake.rows === 8, `lake scene is 2 screens wide (${lake.cols}x${lake.rows})`);
  const e = new Emulator(compiled, { onTone: () => {} });
  e.loadScene(1, 1, 5, false);
  e.updateCamera();
  assert(e.camX === 0, `camera clamps to left edge near x=1 (camX=${e.camX})`);
  // Standing at the far east edge should scroll the camera to its maximum.
  e.player.px = 30 * 8; e.player.py = 5 * 8;
  e.updateCamera();
  assert(e.camX === 32 * 8 - 128, `camera clamps to right edge (camX=${e.camX}, max=${32 * 8 - 128})`);
  // A single-screen scene must never scroll.
  e.loadScene(0, 2, 3, false);
  e.player.px = 15 * 8;
  e.updateCamera();
  assert(e.camX === 0 && e.camY === 0, `single-screen scene does not scroll (${e.camX},${e.camY})`);
}

console.log('— EEPROM save games —');
{
  const store = memoryStorage();
  const e = new Emulator(compiled, { onTone: () => {}, storage: store });
  assert(!e.saveExists(), 'no save present initially');
  e.vars[0] = 1; e.vars[1] = 1;
  e.loadScene(1, 3, 4, false);
  e.saveGame();
  assert(e.saveExists(), 'save written');

  // A fresh run should restore scene, position and variables.
  const e2 = new Emulator(compiled, { onTone: () => {}, storage: store });
  assert(e2.vars[0] === 0, 'fresh emulator starts with cleared variables');
  assert(e2.loadGame(), 'loadGame reports success');
  assert(e2.sceneIdx === 1, `restored scene (got ${e2.sceneIdx})`);
  assert(Math.round(e2.player.px / 8) === 3 && Math.round(e2.player.py / 8) === 4,
    `restored player position (got ${Math.round(e2.player.px / 8)},${Math.round(e2.player.py / 8)})`);
  assert(e2.vars[0] === 1 && e2.vars[1] === 1, 'restored variables');

  store.clear();
  assert(!e2.saveExists(), 'delete save clears it');
  const e3 = new Emulator(compiled, { onTone: () => {}, storage: store });
  assert(!e3.loadGame(), 'loadGame on empty storage reports failure');
}

console.log('— songs —');
{
  assert(compiled.songs.length === 2, `two songs compiled (${compiled.songs.length})`);
  const played = [];
  const e = new Emulator(compiled, { onTone: (f, d) => played.push([f, d]) });
  e.playSong(0, false);
  assert(played.length === 1 && played[0][0] === 659, `first note fires immediately (${JSON.stringify(played)})`);
  // Run long enough for the whole 3-note jingle (80+80+140ms = 300ms = 18 frames).
  for (let i = 0; i < 40; i++) e.stepSong();
  assert(played.length === 3, `all 3 notes played (${played.length})`);
  assert(e.song.idx === -1, 'song stops at the end when not looping');

  const looped = [];
  const e2 = new Emulator(compiled, { onTone: (f, d) => looped.push([f, d]) });
  e2.playSong(0, true);
  for (let i = 0; i < 60; i++) e2.stepSong();
  assert(looped.length > 3, `looping song repeats (${looped.length} notes)`);
  assert(e2.song.idx === 0, 'looping song stays active');
  e2.stopSong();
  assert(e2.song.idx === -1, 'stopSong silences it');
}

console.log('— move actor event —');
{
  // The villager walks from (3,5) to (4,5) after handing over the hint,
  // once has_key is set. Blocking move: the script waits for arrival.
  const e = new Emulator(compiled, { onTone: () => {} });
  e.vars[0] = 1; // has_key
  const villager = e.actors[0];
  const startX = villager.tx;
  e.player.px = villager.tx * 8; e.player.py = (villager.ty + 1) * 8;
  e.player.tx = villager.tx; e.player.ty = villager.ty + 1;
  e.player.fx = 0; e.player.fy = -1;
  e.script.active = false; e.text = null;
  e.setButtons(BTN.A); e.step(); e.setButtons(0); e.step();
  assert(e.script.active, 'villager script started');
  for (let i = 0; i < 400 && e.text; i++) { // clear the dialogue
    e.setButtons(0); e.step();
    if (i % 60 === 59) { e.setButtons(BTN.A); e.step(); }
  }
  let guard = 0;
  while (e.script.active && guard++ < 600) { e.setButtons(0); e.step(); }
  assert(villager.tx === 4, `villager moved to x=4 (from ${startX}, now ${villager.tx})`);
  assert(Math.round(villager.px / 8) === 4, `villager finished walking (px=${villager.px})`);
  assert(!villager.scriptMove, 'scripted move completed');
  assert(!e.script.active, 'script resumed and finished after the move');
}

console.log('— tile override table —');
{
  const e = new Emulator(compiled, { onTone: () => {} });
  const before = e.tileAt(0, 0);
  e.setTile(0, 0, 1);
  assert(e.tileAt(0, 0) === 1, 'setTile applies an override');
  assert(e.baseTiles[0] === before, 'base (PROGMEM) map is not mutated');
  e.setTile(0, 0, 5);
  assert(e.tileAt(0, 0) === 5 && e.overrides.length === 1, 'repeat setTile reuses the same override slot');
  // Reloading the scene clears overrides, as on hardware.
  e.loadScene(0, 2, 3, false);
  assert(e.overrides.length === 0 && e.tileAt(0, 0) === before, 'scene reload restores base tiles');
}

console.log('— RGB LED —');
{
  const e = new Emulator(compiled, { onTone: () => {} });
  assert(e.led.r === 0 && e.led.g === 0 && e.led.b === 0, 'LED starts off');

  // Analog: the slime's pickup script flashes green then clears it.
  const proj = makeDemoProject();
  const led = proj.scenes[0].actors[0]; // villager, reused as a scratch script host
  led.script = [
    Object.assign(makeEventOfType('SET_LED'), { mode: 'analog', r: 255, g: 0, b: 128 }),
  ];
  const c2 = compileProject(proj);
  const e2 = new Emulator(c2, { onTone: () => {} });
  runActorScript(e2, 0);
  assert(e2.led.mode === 'analog' && e2.led.r === 255 && e2.led.g === 0 && e2.led.b === 128,
    `analog LED set to 255,0,128 (got ${e2.led.r},${e2.led.g},${e2.led.b})`);

  // Digital: channels are on/off only.
  const proj3 = makeDemoProject();
  proj3.scenes[0].actors[0].script = [
    Object.assign(makeEventOfType('SET_LED'), { mode: 'digital', dr: true, dg: false, db: true }),
  ];
  const e3 = new Emulator(compileProject(proj3), { onTone: () => {} });
  runActorScript(e3, 0);
  assert(e3.led.mode === 'digital' && e3.led.r === 255 && e3.led.g === 0 && e3.led.b === 255,
    `digital LED lights red+blue only (got ${e3.led.r},${e3.led.g},${e3.led.b})`);
}

console.log('— Display Menu —');
{
  // Four options in the right-hand column, B cancels.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].actors[0].script = [Object.assign(makeEventOfType('MENU'), {
    varId: v.id, layout: 'menu', options: ['Sword', 'Shield', 'Potion', 'Leave'],
    lastIsZero: false, cancelB: true,
  })];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `menu compiles without warnings (${c.warnings.join('; ') || 'none'})`);

  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  assert(e.menu && e.menu.count === 4, 'menu opened with 4 options');
  assert(e.script.active, 'script is blocked while the menu is open');
  assert(e.menu.labels[0] === 'Sword', `labels are not word-wrapped (got "${e.menu.labels[0]}")`);

  // Down twice then A selects the third option -> value 3.
  press(e, BTN.DOWN); press(e, BTN.DOWN);
  assert(e.menu.sel === 2, `cursor moved to option 3 (sel=${e.menu.sel})`);
  press(e, BTN.A);
  assert(!e.menu, 'menu closed after A');
  assert(e.vars[0] === 3, `variable set to 3 (got ${e.vars[0]})`);

  // Up from the first option wraps to the last.
  const e2 = new Emulator(c, { onTone: () => {} });
  runActorScript(e2, 0, false);
  press(e2, BTN.UP);
  assert(e2.menu.sel === 3, `up wraps to the last option (sel=${e2.menu.sel})`);

  // B cancels to 0 when enabled.
  const e3 = new Emulator(c, { onTone: () => {} });
  runActorScript(e3, 0, false);
  e3.vars[0] = 9;
  press(e3, BTN.B);
  assert(!e3.menu && e3.vars[0] === 0, `B cancels to 0 (got ${e3.vars[0]})`);
}

console.log('— menu: last option sets 0, B disabled —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].actors[0].script = [Object.assign(makeEventOfType('MENU'), {
    varId: v.id, layout: 'dialogue', options: ['Buy', 'Sell', 'Exit'],
    lastIsZero: true, cancelB: false,
  })];
  const c = compileProject(proj);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  e.vars[0] = 7;
  press(e, BTN.B);
  assert(e.menu && e.vars[0] === 7, 'B does nothing when cancel is disabled');
  press(e, BTN.DOWN); press(e, BTN.DOWN); // move to "Exit"
  press(e, BTN.A);
  assert(e.vars[0] === 0, `last option yields 0 (got ${e.vars[0]})`);

  // Dialogue layout: right/left hop a column (3 options -> 2 rows per column).
  const e2 = new Emulator(c, { onTone: () => {} });
  runActorScript(e2, 0, false);
  press(e2, BTN.RIGHT);
  assert(e2.menu.sel === 2, `right jumps to the second column (sel=${e2.menu.sel})`);
  press(e2, BTN.LEFT);
  assert(e2.menu.sel === 0, `left returns to the first column (sel=${e2.menu.sel})`);
}

console.log('— Display Multiple Choice —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].actors[0].script = [Object.assign(makeEventOfType('CHOICE'), {
    varId: v.id, trueLabel: 'Yes', falseLabel: 'No',
  })];
  const c = compileProject(proj);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  assert(e.menu && e.menu.count === 2, 'choice opens a 2-option menu');
  press(e, BTN.A);
  assert(e.vars[0] === 1, `first option is true / 1 (got ${e.vars[0]})`);

  const e2 = new Emulator(c, { onTone: () => {} });
  runActorScript(e2, 0, false);
  press(e2, BTN.DOWN);
  press(e2, BTN.A);
  assert(e2.vars[0] === 0, `second option is false / 0 (got ${e2.vars[0]})`);
}

console.log('— bytecode sanity —');
assert(compiled.code.length > 40 && compiled.code.length < 4096, `bytecode size sensible (${compiled.code.length} bytes)`);
assert(compiled.strings.every((s) => s.split('\f').every((p) => p.split('\n').length <= 3 && p.split('\n').every((l) => l.length <= 20))), 'all strings wrapped to 20 chars x 3 lines per page');

console.log(failures ? `\n${failures} FAILURES` : '\nAll runtime tests passed.');
process.exit(failures ? 1 : 0);
