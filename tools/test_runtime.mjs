#!/usr/bin/env node
// Behavioral test of the compiler + emulator against the Key Quest demo:
// boots the game, plays through the key fetch and door unlock purely by
// simulated button presses, and asserts on game state along the way.
//
// Usage: node tools/test_runtime.mjs

import {
  makeDemoProject, makeEvent as makeEventOfType, normalizeProject,
  makeActor as makeActorOfType,
} from '../js/model.js';
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
  led.scripts.interact = [
    Object.assign(makeEventOfType('SET_LED'), { mode: 'analog', r: 255, g: 0, b: 128 }),
  ];
  const c2 = compileProject(proj);
  const e2 = new Emulator(c2, { onTone: () => {} });
  runActorScript(e2, 0);
  assert(e2.led.mode === 'analog' && e2.led.r === 255 && e2.led.g === 0 && e2.led.b === 128,
    `analog LED set to 255,0,128 (got ${e2.led.r},${e2.led.g},${e2.led.b})`);

  // Digital: channels are on/off only.
  const proj3 = makeDemoProject();
  proj3.scenes[0].actors[0].scripts.interact = [
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
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('MENU'), {
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
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('MENU'), {
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
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('CHOICE'), {
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

console.log('— Set Actor Sprite —');
{
  const proj = makeDemoProject();
  const ev = makeEventOfType('SET_ACTOR_SPRITE');
  ev.target = 'self'; ev.spriteId = proj.sprites[2].id; // Slime
  proj.scenes[0].actors[0].scripts.interact = [ev];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `compiles cleanly (${c.warnings.join('; ') || 'none'})`);

  const e = new Emulator(c, { onTone: () => {} });
  const before = e.actors[0].spriteIdx;
  runActorScript(e, 0);
  assert(e.actors[0].spriteIdx === 2, `sprite swapped to index 2 (was ${before}, now ${e.actors[0].spriteIdx})`);

  // The compiled project is shared between Emulator instances, so the swap must
  // not have written through to it.
  assert(c.scenes[0].actors[0].spriteIdx === before, 'compiled scene data left untouched');
  const e2 = new Emulator(c, { onTone: () => {} });
  assert(e2.actors[0].spriteIdx === before, 'a fresh emulator still shows the original sprite');

  // Switching to a sprite with fewer frames must clamp the current frame.
  const proj2 = makeDemoProject();
  proj2.sprites.push({ id: 'spr_single', name: 'Single', width: 8, height: 8, frames: [proj2.sprites[0].frames[0]] });
  const ev2 = makeEventOfType('SET_ACTOR_SPRITE');
  ev2.target = 'self'; ev2.spriteId = 'spr_single';
  proj2.scenes[0].actors[0].scripts.interact = [ev2];
  const e3 = new Emulator(compileProject(proj2), { onTone: () => {} });
  e3.actors[0].frame = 1;
  runActorScript(e3, 0);
  assert(e3.actors[0].frame === 0, `frame clamped for a shorter sprite (got ${e3.actors[0].frame})`);
}

console.log('— Attach / Remove Button Script —');
{
  // B opens a dialogue; B is not a movement button, so no override needed.
  const proj = makeDemoProject();
  const attach = makeEventOfType('ATTACH_SCRIPT');
  attach.button = 'b'; attach.override = false;
  const say = makeEventOfType('TEXT'); say.text = 'Menu!';
  attach.script = [say];
  proj.scenes[0].scripts.init = [attach];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `attach compiles cleanly (${c.warnings.join('; ') || 'none'})`);

  const e = new Emulator(c, { onTone: () => {} });
  e.setButtons(0); e.step();
  for (let i = 0; i < 20 && e.script.active; i++) { e.setButtons(0); e.step(); }
  assert(e.buttonScript[5] !== 0xffff, 'B has a script attached after the scene loads');

  press(e, BTN.B);
  assert(e.script.active && e.text && e.text.str.includes('Menu'), 'pressing B ran the attached script');
  for (let i = 0; i < 300 && (e.text || e.script.active); i++) {
    e.setButtons(0); e.step();
    if (i % 60 === 59) { e.setButtons(BTN.A); e.step(); }
  }

  // Removing it restores the default (B does nothing on its own).
  const proj2 = makeDemoProject();
  const attach2 = makeEventOfType('ATTACH_SCRIPT');
  attach2.button = 'b';
  attach2.script = [Object.assign(makeEventOfType('TEXT'), { text: 'Menu!' })];
  const remove = makeEventOfType('REMOVE_BUTTON_SCRIPT'); remove.button = 'b';
  proj2.scenes[0].scripts.init = [attach2, remove];
  const e2 = new Emulator(compileProject(proj2), { onTone: () => {} });
  e2.setButtons(0); e2.step();
  for (let i = 0; i < 30 && e2.script.active; i++) { e2.setButtons(0); e2.step(); }
  assert(e2.buttonScript[5] === 0xffff, 'Remove Button Script detached it again');
  press(e2, BTN.B);
  assert(!e2.script.active, 'B no longer runs anything once removed');
}

console.log('— button script override —');
{
  // Attach to RIGHT with override: the player must not walk right any more.
  const mk = (override) => {
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [];
    const attach = makeEventOfType('ATTACH_SCRIPT');
    attach.button = 'right'; attach.override = override;
    attach.script = [Object.assign(makeEventOfType('SET_VAR'), { varId: proj.variables[0].id, value: 42 })];
    proj.scenes[0].triggers = [];
    proj.scenes[0].scripts.init = [attach];
    const e = new Emulator(compileProject(proj), { onTone: () => {} });
    e.setButtons(0); e.step();
    for (let i = 0; i < 20 && e.script.active; i++) { e.setButtons(0); e.step(); }
    return e;
  };

  const eOver = mk(true);
  const startX = Math.round(eOver.player.px / 8);
  eOver.setButtons(BTN.RIGHT);
  for (let i = 0; i < 12; i++) eOver.step();
  eOver.setButtons(0); eOver.step();
  assert(Math.round(eOver.player.px / 8) === startX, `override stops the player walking right (x=${Math.round(eOver.player.px / 8)}, was ${startX})`);
  assert(eOver.vars[0] === 42, `override still ran the script (var=${eOver.vars[0]})`);

  const eNo = mk(false);
  const startX2 = Math.round(eNo.player.px / 8);
  eNo.setButtons(BTN.RIGHT);
  for (let i = 0; i < 12; i++) eNo.step();
  eNo.setButtons(0); eNo.step();
  // 12 frames at 2px/frame covers more than one 8px tile, so just assert movement.
  assert(Math.round(eNo.player.px / 8) > startX2, `without override the player still walks (x=${Math.round(eNo.player.px / 8)}, was ${startX2})`);
  assert(eNo.vars[0] === 42, `without override the script also ran (var=${eNo.vars[0]})`);
}

console.log('— Pause Script Until Input Pressed —');
{
  const proj = makeDemoProject();
  const wait = makeEventOfType('WAIT_INPUT');
  wait.mask = BTN.A | BTN.B;
  const after = makeEventOfType('SET_VAR');
  after.varId = proj.variables[0].id; after.value = 7;
  proj.scenes[0].actors[0].scripts.interact = [wait, after];
  const c = compileProject(proj);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  for (let i = 0; i < 60; i++) { e.setButtons(0); e.step(); }
  assert(e.script.active && e.vars[0] !== 7, 'script stays blocked while nothing is pressed');
  press(e, BTN.RIGHT);
  assert(e.vars[0] !== 7, 'a button outside the mask does not release it');
  press(e, BTN.B);
  for (let i = 0; i < 5 && e.script.active; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 7, `pressing B released the script (var=${e.vars[0]})`);
}

console.log('— If Joypad Input Held —');
{
  const proj = makeDemoProject();
  const iff = makeEventOfType('IF_INPUT');
  iff.mask = BTN.B;
  iff.then = [Object.assign(makeEventOfType('SET_VAR'), { varId: proj.variables[0].id, value: 1 })];
  iff.else = [Object.assign(makeEventOfType('SET_VAR'), { varId: proj.variables[0].id, value: 2 })];
  proj.scenes[0].actors[0].scripts.interact = [iff];
  const c = compileProject(proj);

  // Not held -> false branch.
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 2, `false branch when B is not held (var=${e.vars[0]})`);

  // Held -> true branch. Hold B while the script starts and runs.
  const e2 = new Emulator(c, { onTone: () => {} });
  const a = e2.actors[0];
  e2.player.px = a.tx * 8; e2.player.py = (a.ty + 1) * 8;
  e2.player.tx = a.tx; e2.player.ty = a.ty + 1;
  e2.player.fx = 0; e2.player.fy = -1;
  e2.script.active = false; e2.text = null;
  e2.setButtons(BTN.A | BTN.B); e2.step();     // A starts the script, B held
  e2.setButtons(BTN.B);
  for (let i = 0; i < 10 && e2.script.active; i++) e2.step();
  assert(e2.vars[0] === 1, `true branch while B is held (var=${e2.vars[0]})`);
}

console.log('— nested button scripts compile correctly —');
{
  const proj = makeDemoProject();
  const attach = makeEventOfType('ATTACH_SCRIPT');
  attach.button = 'b';
  attach.script = [Object.assign(makeEventOfType('TEXT'), { text: 'from the button' })];
  const after = makeEventOfType('SET_VAR');
  after.varId = proj.variables[0].id; after.value = 5;
  // The attach sits in the middle of a script; its body must not be spliced in.
  proj.scenes[0].actors[0].scripts.interact = [attach, after];
  const c = compileProject(proj);
  const ascending = c.scriptOffsets.every((o, i, arr) => i === 0 || o >= arr[i - 1]);
  assert(ascending, `script offsets stay ordered (${c.scriptOffsets.join(',')})`);

  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 5, `the parent script ran past the attach (var=${e.vars[0]})`);
  assert(!e.text, 'the attached body did not run inline');
  press(e, BTN.B);
  assert(e.text && e.text.str.includes('button'), 'the attached body runs on its own when B is pressed');
}

console.log('— script lifecycle slots —');
{
  // Every actor's On Init runs before the scene's own On Init.
  const proj = makeDemoProject();
  const v0 = proj.variables[0].id, v1 = proj.variables[1].id;
  proj.scenes[0].actors[0].scripts.init = [
    Object.assign(makeEventOfType('SET_VAR'), { varId: v0, value: 1 }),
  ];
  proj.scenes[0].scripts.init = [
    // Only sets v1 if the actor already ran: 1 -> 7, otherwise untouched.
    Object.assign(makeEventOfType('IF_VAR'), {
      varId: v0, cmp: '==', value: 1,
      then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v1, value: 7 })],
      else: [],
    }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  for (let i = 0; i < 10; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 1, 'actor On Init ran on scene load');
  assert(e.vars[1] === 7, 'scene On Init ran after the actor On Init');
}

{
  // Two blocking inits queue rather than clobbering each other.
  const proj = makeDemoProject();
  const sc = proj.scenes[0];
  sc.actors[0].scripts.init = [Object.assign(makeEventOfType('TEXT'), { text: 'first' })];
  sc.scripts.init = [Object.assign(makeEventOfType('TEXT'), { text: 'second' })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  e.setButtons(0); e.step();
  assert(e.text && e.text.str.includes('first'), 'the first queued init opened its dialogue');
  // Let the typewriter finish, then close the page with A.
  for (let i = 0; i < 200; i++) { e.setButtons(0); e.step(); }
  press(e, BTN.A);
  for (let i = 0; i < 3; i++) { e.setButtons(0); e.step(); }
  assert(e.text && e.text.str.includes('second'), 'the next init ran once the first finished');
}

{
  // On Update runs every frame without blocking the player.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].scripts.init = []; // drop the demo intro so nothing else is running
  proj.scenes[0].actors[0].scripts.update = [
    Object.assign(makeEventOfType('ADD_VAR'), { varId: v, delta: 1 }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `an update script of plain events compiles clean (${c.warnings.join('; ')})`);
  const e = new Emulator(c, { onTone: () => {} });
  const before = e.vars[0];
  for (let i = 0; i < 5; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === ((before + 5) & 0xff), `On Update ran once per frame (${before} -> ${e.vars[0]})`);
  assert(!e.script.active, 'On Update never occupies the blocking VM');
}

{
  // Blocking events are refused in an On Update slot rather than deadlocking.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.update = [
    Object.assign(makeEventOfType('WAIT'), { frames: 30 }),
    Object.assign(makeEventOfType('TEXT'), { text: 'nope' }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 2, `both blocking events warned (${c.warnings.length})`);
  assert(c.warnings.every((w) => w.includes('On Update')), 'the warning names the On Update slot');
  const e = new Emulator(c, { onTone: () => {} });
  for (let i = 0; i < 20; i++) { e.setButtons(0); e.step(); }
  assert(!e.text, 'the stripped dialogue never opened');
}

{
  // Trigger On Leave fires on stepping back out.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  const sc = proj.scenes[0];
  const trig = sc.triggers[0];
  trig.scripts.enter = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 })];
  trig.scripts.leave = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 2 })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  // Stand on the trigger, then walk off it.
  e.player.px = trig.x * 8; e.player.py = trig.y * 8;
  e.player.tx = trig.x; e.player.ty = trig.y;
  e.script.active = false; e.text = null; e.armedTrigger = -1;
  for (let i = 0; i < 3; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 1, `On Enter ran when the player stepped in (${e.vars[0]})`);
  e.script.active = false;
  e.player.px = 0; e.player.py = 0; e.player.tx = 0; e.player.ty = 0;
  for (let i = 0; i < 3; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 2, `On Leave ran when the player stepped out (${e.vars[0]})`);
}

console.log('— collision groups and On Hit —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  const a = proj.scenes[0].actors[0];
  a.collisionGroup = '1';
  a.collideWith = 1; // Player
  a.scripts.hit = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 9 })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  // Walk the player right on top of the actor.
  const act = e.actors[0];
  e.player.px = act.px; e.player.py = act.py;
  e.player.tx = act.tx; e.player.ty = act.ty;
  e.script.active = false; e.text = null; e.armedHit = -1;
  for (let i = 0; i < 3; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 9, `overlapping the player ran the actor's On Hit (${e.vars[0]})`);

  // It must not re-fire while the two stay overlapped.
  e.vars[0] = 0;
  for (let i = 0; i < 5; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 0, 'On Hit does not re-fire while still touching');
}

{
  // No On Hit of its own: the scene's On Player Hit picks it up.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].actors[0].collisionGroup = '2';
  proj.scenes[0].actors[0].collideWith = 1;
  proj.scenes[0].scripts.playerHit = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 4 })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  const act = e.actors[0];
  e.player.px = act.px; e.player.py = act.py;
  e.script.active = false; e.text = null; e.armedHit = -1;
  for (let i = 0; i < 3; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 4, `the scene On Player Hit caught the collision (${e.vars[0]})`);
}

{
  // An actor with no group is not collidable at all.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].actors[0].collisionGroup = 'none';
  proj.scenes[0].actors[0].scripts.hit = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 3 })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  const act = e.actors[0];
  e.player.px = act.px; e.player.py = act.py;
  e.script.active = false; e.text = null;
  for (let i = 0; i < 5; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] !== 3, 'an ungrouped actor never runs On Hit');
}

console.log('— Launch Projectile —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  const sc = proj.scenes[0];
  // The demo's two actors live in different scenes, so add a target here.
  const target = makeActorOfType('Target', proj.sprites[2].id, sc.actors[0].x + 3, sc.actors[0].y);
  target.collisionGroup = '1';
  target.scripts.hit = [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 6 })];
  sc.actors.push(target);
  sc.actors[0].scripts.interact = [Object.assign(makeEventOfType('LAUNCH_PROJECTILE'), {
    source: 'self', spriteId: proj.sprites[0].id, direction: 'right',
    speed: 2, life: 200, collideWith: 2, // group 1
  })];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `Launch Projectile compiles clean (${c.warnings.join('; ')})`);

  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  const live = e.projectiles.filter((p) => p.active);
  assert(live.length === 1, `one projectile is in flight (${live.length})`);
  assert(live[0].dx === 2 && live[0].dy === 0, `it flies right at 2px/frame (${live[0].dx},${live[0].dy})`);
  const x0 = live[0].px;
  e.setButtons(0); e.step();
  assert(live[0].px === x0 + 2, 'it travels each frame');
}

{
  // Lifetime expiry frees the slot again.
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('LAUNCH_PROJECTILE'), {
    source: 'self', spriteId: proj.sprites[0].id, direction: 'up',
    speed: 1, life: 3, collideWith: 0,
  })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.projectiles.some((p) => p.active), 'projectile spawned');
  for (let i = 0; i < 5; i++) { e.setButtons(0); e.step(); }
  assert(!e.projectiles.some((p) => p.active), 'projectile despawned when its lifetime ran out');
}

{
  // The pool is finite and must not overflow.
  const proj = makeDemoProject();
  const shot = () => Object.assign(makeEventOfType('LAUNCH_PROJECTILE'), {
    source: 'self', spriteId: proj.sprites[0].id, direction: 'down',
    speed: 1, life: 250, collideWith: 0,
  });
  proj.scenes[0].actors[0].scripts.interact = Array.from({ length: 10 }, shot);
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.projectiles.filter((p) => p.active).length === 6,
    `the pool caps at 6 in flight (${e.projectiles.filter((p) => p.active).length})`);
}

console.log('— actor direction, speed and effects —');
{
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_ACTOR_DIR'), { target: 'self', direction: 'left' }),
    Object.assign(makeEventOfType('SET_ACTOR_SPEED'), { target: 'self', speed: 3 }),
    Object.assign(makeEventOfType('ACTOR_EFFECT'), { target: 'self', effect: 'shake', frames: 4 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.actors[0].facing === 3, `facing set to left, which encodes as 3 (${e.actors[0].facing})`);
  assert(e.actors[0].speed === 3, `speed set to 3 (${e.actors[0].speed})`);
  assert(e.actors[0].effect === 2, `shake effect active (${e.actors[0].effect})`);
  // The effect counts itself down and clears.
  for (let i = 0; i < 6; i++) { e.setButtons(0); e.step(); }
  assert(e.actors[0].effect === 0, 'the effect cleared when its frames ran out');
}

{
  // Half speed moves one pixel every other frame.
  const proj = makeDemoProject();
  const a = proj.scenes[0].actors[0];
  a.speed = 0;
  a.scripts.interact = [Object.assign(makeEventOfType('ACTOR_MOVE'), {
    target: 'self', x: a.x + 4, y: a.y, instant: false,
  })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0, false);
  const start = e.actors[0].px;
  e.setButtons(0); e.step();
  e.setButtons(0); e.step();
  assert(e.actors[0].px - start === 1, `half speed covers 1px in 2 frames (${e.actors[0].px - start})`);
}

console.log('— scene stack and fades —');
{
  const proj = makeDemoProject();
  const sc = proj.scenes[0];
  const other = proj.scenes[1];
  sc.actors[0].scripts.interact = [Object.assign(makeEventOfType('PUSH_SCENE'), {
    sceneId: other.id, x: 1, y: 1, fade: 0,
  })];
  // Anything in the pushed scene can pop straight back.
  other.scripts.init = [Object.assign(makeEventOfType('POP_SCENE'), { fade: 0 })];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `push/pop compiles clean (${c.warnings.join('; ')})`);

  const e = new Emulator(c, { onTone: () => {} });
  // runActorScript stands the player below the actor — that is the tile the
  // push must remember, so read it after positioning rather than before.
  const act = e.actors[0];
  const fromX = act.tx, fromY = act.ty + 1;
  runActorScript(e, 0, false);
  // Push, then the pushed scene's init pops right back.
  for (let i = 0; i < 20; i++) { e.setButtons(0); e.step(); }
  assert(e.sceneIdx === 0, `popped back to the original scene (${e.sceneIdx})`);
  assert(Math.round(e.player.px / 8) === fromX && Math.round(e.player.py / 8) === fromY,
    `the player is back where they pushed from (${e.player.px / 8},${e.player.py / 8})`);
  assert(e.sceneStack.length === 0, 'the stack is empty again');
}

{
  // Pop with nothing pushed is a no-op, not a crash.
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('POP_SCENE'), { fade: 0 }),
    Object.assign(makeEventOfType('SET_VAR'), { varId: proj.variables[0].id, value: 8 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.sceneIdx === 0, 'Pop Scene with an empty stack stays put');
  assert(e.vars[0] === 8, 'and the script carries on past it');
}

{
  // Fade Out blocks the script until the dither reaches full black.
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('FADE_OUT'), { fade: 1 }),
    Object.assign(makeEventOfType('SET_VAR'), { varId: proj.variables[0].id, value: 5 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0, false);
  e.setButtons(0); e.step();
  assert(e.vars[0] !== 5, 'the script is still waiting on the fade');
  for (let i = 0; i < 80; i++) { e.setButtons(0); e.step(); }
  assert(e.fade.level === 16, `the screen faded all the way out (${e.fade.level})`);
  assert(e.vars[0] === 5, 'the script resumed once the fade finished');
}

console.log('— If Actor At Position —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  const a = proj.scenes[0].actors[0];
  proj.scenes[0].scripts.init = [];
  a.scripts.interact = [Object.assign(makeEventOfType('IF_ACTOR_AT'), {
    target: 'self', x: a.x, y: a.y,
    then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 })],
    else: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 2 })],
  })];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `If Actor At Position compiles clean (${c.warnings.join('; ')})`);

  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 1, `took the true branch where the actor stands (${e.vars[0]})`);

  // Move the actor off that tile and the same check goes the other way.
  const e2 = new Emulator(c, { onTone: () => {} });
  e2.actors[0].px += 8 * 2;
  runActorScript(e2, 0);
  assert(e2.vars[0] === 2, `took the false branch once it moved (${e2.vars[0]})`);
}

{
  // The player is a valid target too.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('IF_ACTOR_AT'), {
    target: 'player', x: 5, y: 5,
    then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 3 })],
    else: [],
  })];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  // runActorScript parks the player below the actor, so put it on 5,5 after.
  const act = e.actors[0];
  e.player.px = act.tx * 8; e.player.py = (act.ty + 1) * 8;
  e.player.tx = act.tx; e.player.ty = act.ty + 1;
  e.player.fx = 0; e.player.fy = -1;
  e.script.active = false; e.text = null;
  e.player.px = 5 * 8; e.player.py = 5 * 8;
  // Face the actor from 5,5 only if it happens to be adjacent; drive the
  // script directly instead so the position under test is exactly 5,5.
  e.startScript(compileProject(proj).scenes[0].actors[0].scripts.interact, 0);
  for (let i = 0; i < 10 && e.script.active; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 3, `the player position was matched (${e.vars[0]})`);
}

console.log('— If Actor Distance From Actor —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  const a = proj.scenes[0].actors[0];
  proj.scenes[0].scripts.init = [];
  a.scripts.interact = [Object.assign(makeEventOfType('IF_ACTOR_DISTANCE'), {
    target: 'player', cmp: '<=', distance: 2, from: 'self',
    then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 })],
    else: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 2 })],
  })];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `If Actor Distance compiles clean (${c.warnings.join('; ')})`);

  // runActorScript stands the player one tile below the actor: distance 1.
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 1, `one tile away is within 2 (${e.vars[0]})`);

  // Push the player far away and re-run the same script.
  e.vars[0] = 0;
  e.player.px = e.actors[0].px + 8 * 9;
  e.script.active = false; e.text = null;
  e.startScript(c.scenes[0].actors[0].scripts.interact, 0);
  for (let i = 0; i < 10 && e.script.active; i++) { e.setButtons(0); e.step(); }
  assert(e.vars[0] === 2, `nine tiles away is outside 2 (${e.vars[0]})`);
}

{
  // Distance is straight-line, not along the axes: a (3,4) offset is 5, so it
  // passes "<= 5" but fails "<= 4" — Manhattan would have said 7 for both.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].scripts.init = [];
  const mk = (limit) => Object.assign(makeEventOfType('IF_ACTOR_DISTANCE'), {
    target: 'player', cmp: '<=', distance: limit, from: 'self',
    then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 })],
    else: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 2 })],
  });
  for (const [limit, want] of [[5, 1], [4, 2]]) {
    const p2 = JSON.parse(JSON.stringify(proj));
    p2.scenes[0].actors[0].scripts.interact = [mk(limit)];
    const c = compileProject(p2);
    const e = new Emulator(c, { onTone: () => {} });
    const act = e.actors[0];
    e.player.px = act.px + 3 * 8;
    e.player.py = act.py + 4 * 8;
    e.script.active = false; e.text = null;
    e.startScript(c.scenes[0].actors[0].scripts.interact, 0);
    for (let i = 0; i < 10 && e.script.active; i++) { e.setButtons(0); e.step(); }
    assert(e.vars[0] === want, `a 3,4 offset is distance 5, so "<= ${limit}" is ${want === 1}`);
  }
}

console.log('— storing actor state in variables —');
{
  const proj = makeDemoProject();
  const vd = proj.variables[0].id, vx = proj.variables[1].id, vy = proj.variables[2].id;
  const a = proj.scenes[0].actors[0];
  a.facing = 'left';
  proj.scenes[0].scripts.init = [];
  a.scripts.interact = [
    Object.assign(makeEventOfType('STORE_ACTOR_DIR'), { target: 'self', varId: vd }),
    Object.assign(makeEventOfType('STORE_ACTOR_POS'), { target: 'self', varX: vx, varY: vy }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `store events compile clean (${c.warnings.join('; ')})`);

  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 3, `Left stored as 3 (${e.vars[0]})`);
  assert(e.vars[1] === a.x && e.vars[2] === a.y,
    `position stored as ${a.x},${a.y} (got ${e.vars[1]},${e.vars[2]})`);
}

{
  // The documented encoding: Down 0, Right 1, Up 2, Left 3.
  const proj = makeDemoProject();
  const vd = proj.variables[0].id;
  proj.scenes[0].scripts.init = [];
  for (const [key, code] of [['down', 0], ['right', 1], ['up', 2], ['left', 3]]) {
    const p2 = JSON.parse(JSON.stringify(proj));
    p2.scenes[0].actors[0].facing = key;
    p2.scenes[0].actors[0].scripts.interact = [
      Object.assign(makeEventOfType('STORE_ACTOR_DIR'), { target: 'self', varId: vd }),
    ];
    const e = new Emulator(compileProject(p2), { onTone: () => {} });
    runActorScript(e, 0);
    assert(e.vars[0] === code, `${key} stores as ${code} (got ${e.vars[0]})`);
  }
}

{
  // Writing both halves of a position into one variable is a mistake worth
  // naming, but it still compiles.
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('STORE_ACTOR_POS'), { target: 'self', varX: v, varY: v }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.some((w) => w.includes('same variable')), 'same-variable position store warns');
}

console.log('— comments and event groups —');
{
  const proj = makeDemoProject();
  const v = proj.variables[0].id;
  proj.scenes[0].scripts.init = [];
  const plain = JSON.parse(JSON.stringify(proj));
  plain.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 }),
  ];
  const decorated = JSON.parse(JSON.stringify(proj));
  decorated.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('COMMENT'), { text: 'set the flag' }),
    Object.assign(makeEventOfType('EVENT_GROUP'), {
      label: 'setup',
      events: [Object.assign(makeEventOfType('SET_VAR'), { varId: v, value: 1 })],
    }),
  ];
  const cPlain = compileProject(plain);
  const cDecorated = compileProject(decorated);
  assert(cDecorated.warnings.length === 0, `comments and groups compile clean (${cDecorated.warnings.join('; ')})`);
  assert(cDecorated.code.length === cPlain.code.length,
    `neither costs a byte on the device (${cDecorated.code.length} vs ${cPlain.code.length})`);

  const e = new Emulator(cDecorated, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 1, 'the grouped event still ran');
}

{
  // A group nested in a branch keeps working, and a group inside an On Update
  // slot still gets the non-blocking treatment.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.update = [
    Object.assign(makeEventOfType('EVENT_GROUP'), {
      label: 'per frame',
      events: [Object.assign(makeEventOfType('WAIT'), { frames: 10 })],
    }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 1 && c.warnings[0].includes('On Update'),
    `a blocking event inside a group in On Update is still refused (${c.warnings.join('; ')})`);
}

console.log('— project migration —');
{
  // A project saved before lifecycle slots existed must still load.
  const proj = makeDemoProject();
  const legacy = JSON.parse(JSON.stringify(proj));
  for (const sc of legacy.scenes) {
    sc.onEnter = sc.scripts.init; delete sc.scripts;
    for (const a of sc.actors) { a.script = a.scripts.interact; delete a.scripts; }
    for (const t of sc.triggers) { t.script = t.scripts.enter; delete t.scripts; }
  }
  const fixed = normalizeProject(legacy);
  assert(Array.isArray(fixed.scenes[0].scripts.init), 'scene onEnter migrated to scripts.init');
  assert(fixed.scenes[0].actors[0].scripts.interact.length > 0, 'actor script migrated to scripts.interact');
  assert(fixed.scenes[0].triggers[0].scripts.enter.length > 0, 'trigger script migrated to scripts.enter');
  assert(fixed.scenes[0].onEnter === undefined, 'the legacy scene field is gone');
  assert(fixed.scenes[0].actors[0].script === undefined, 'the legacy actor field is gone');
  // And it still compiles and plays.
  const e = new Emulator(compileProject(fixed), { onTone: () => {} });
  for (let i = 0; i < 30; i++) { e.setButtons(0); e.step(); }
  assert(e.sceneIdx === 0, 'a migrated project boots and runs');
}

console.log('— bytecode sanity —');
assert(compiled.code.length > 40 && compiled.code.length < 4096, `bytecode size sensible (${compiled.code.length} bytes)`);
assert(compiled.strings.every((s) => s.split('\f').every((p) => p.split('\n').length <= 3 && p.split('\n').every((l) => l.length <= 20))), 'all strings wrapped to 20 chars x 3 lines per page');

console.log(failures ? `\n${failures} FAILURES` : '\nAll runtime tests passed.');
process.exit(failures ? 1 : 0);
