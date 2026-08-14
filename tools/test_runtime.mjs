#!/usr/bin/env node
// Behavioral test of the compiler + emulator against the Key Quest demo:
// boots the game, plays through the key fetch and door unlock purely by
// simulated button presses, and asserts on game state along the way.
//
// Usage: node tools/test_runtime.mjs

import {
  makeDemoProject, makeEvent as makeEventOfType, normalizeProject,
  makeActor as makeActorOfType, makeSpriteState as makeSpriteStateOfType,
  renameVariableReferences, cloneWithNewIds, retargetActorRefs, forEachEvent,
} from '../js/model.js';
import { compileProject, TEXT_VAR_MARKER, displayWidth } from '../js/compiler.js';
import { generateIno } from '../js/codegen.js';
import { compileExpression, evalExpression } from '../js/expression.js';
import { makeAllFeaturesProject } from './all_features_project.mjs';
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

console.log('— actor events targeting the player —');
{
  // Run events from the scene's On Init so nothing has to be interacted with.
  // `build` receives the project, since makeDemoProject() mints fresh ids.
  const runOnInit = (build, frames = 12) => {
    const proj = makeDemoProject();
    const evs = build(proj);
    proj.scenes[0].scripts.init = Array.isArray(evs) ? evs : [evs];
    const c = compileProject(proj);
    const e = new Emulator(c, { onTone: () => {} });
    for (let i = 0; i < frames; i++) { e.setButtons(0); e.step(); }
    return { c, e };
  };
  const ev = (type, fields) => Object.assign(makeEventOfType(type), fields);

  {
    const { c, e } = runOnInit((p) => ev('SET_ACTOR_SPRITE', { target: 'player', spriteId: p.sprites[2].id }));
    assert(c.warnings.length === 0, `Set Actor Sprite on the player compiles cleanly (${c.warnings.join('; ') || 'none'})`);
    assert(e.player.spriteIdx === 2, `player sprite swapped (got ${e.player.spriteIdx})`);
    assert(e.player.animTo === e.spriteLastFrame(2), 'and its frame range was reseeded for the new sprite');
  }

  {
    const { e } = runOnInit(() => ev('ACTOR_EFFECT', { target: 'player', effect: 'flicker', frames: 30 }));
    assert(e.player.effect === 1 && e.player.effectFrames > 0, 'Actor Effects flickers the player');
    const { x, y } = { x: e.player.px, y: e.player.py };
    e.setButtons(0); e.step();
    assert(e.player.px === x && e.player.py === y, 'and it is draw-only — the player has not moved');
  }

  {
    // Facing must round-trip through fx/fy, which is what aims a projectile.
    const { e } = runOnInit(() => ev('SET_ACTOR_DIR', { target: 'player', direction: 'left' }));
    assert(e.player.fx === -1 && e.player.fy === 0, `Set Actor Direction turned the player left (fx=${e.player.fx}, fy=${e.player.fy})`);
    assert(e.refFacing(0xfe, 0) === 3, `and refFacing() reads it back as Left (got ${e.refFacing(0xfe, 0)})`);
  }

  {
    const { e } = runOnInit(() => ev('ACTOR_HIDE', { target: 'player' }));
    assert(e.player.hidden === true, 'Hide Actor hides the player');
    // Hiding must stay purely visual, or a cutscene would strand the game.
    const before = e.player.px;
    e.setButtons(BTN.RIGHT);
    for (let i = 0; i < 8; i++) e.step();
    assert(e.player.px !== before, 'but the player can still walk while hidden');
  }

  {
    // 10 is a real ANIM_SPEEDS value; an arbitrary number falls back to 20.
    const { e } = runOnInit(() => ev('SET_ANIM_SPEED', { target: 'player', speed: 10 }));
    assert(e.player.animSpeed === 10, `Set Actor Animation Speed drives the player (got ${e.player.animSpeed})`);
    // Freeze the animation first, or the frame we set would advance away from it.
    const frozen = runOnInit(() => [
      ev('SET_ANIM_SPEED', { target: 'player', speed: 0 }),
      ev('SET_ANIM_FRAME', { target: 'player', frame: 1 }),
    ]).e;
    assert(frozen.player.frame === 1, `Set Actor Animation Frame drives the player (got ${frozen.player.frame})`);
  }

  {
    // Out of scope: the player has no pixel speed, so this must say so loudly
    // rather than compiling to an opcode the runtimes ignore.
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [ev('SET_ACTOR_SPEED', { target: 'player', speed: 2 })];
    const c = compileProject(proj);
    assert(c.warnings.some((w) => /cannot target the player/.test(w)),
      `Set Actor Movement Speed on the player warns (${c.warnings.join('; ') || 'no warnings'})`);
  }
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

console.log('— math expressions —');
{
  const vi = new Map([['health', 0], ['gold', 1]]);
  const vars = new Uint8Array(32);
  vars[0] = 6; vars[1] = 10;
  const run = (src) => {
    const b = compileExpression(src, vi);
    return evalExpression(b, 0, b.length, vars, () => 3);
  };
  assert(run('6 * $health') === 36, 'multiplication and a variable read');
  assert(run('1 + 2 * 3') === 7, 'multiplication binds tighter than addition');
  assert(run('(1 + 2) * 3') === 9, 'parentheses override precedence');
  assert(run('-$health + 10') === 4, 'unary minus');
  assert(run('$health > 5 && $gold < 20') === 1, 'comparison and logical and');
  assert(run('!$health') === 0, 'logical not');
  assert(run('10 / 0') === 0, 'dividing by zero yields 0 rather than trapping');
  assert(run('10 % 0') === 0, 'modulo by zero yields 0');
  assert(run('min($health, $gold)') === 6 && run('max($health, $gold)') === 10, 'min and max');
  assert(run('abs(0 - 5)') === 5, 'abs');
  assert(run('rnd(10)') === 3, 'rnd draws from the generator');
  // Intermediates are int16, so a big product wraps rather than staying exact.
  assert(run('200 * 200') === -25536, `int16 arithmetic wraps like the device (${run('200 * 200')})`);

  for (const [bad, why] of [
    ['6 * ', 'ends too early'],
    ['$nope', 'unknown variable'],
    ['foo(1)', 'unknown function'],
    ['1 +* 2', 'stray operator'],
    ['((1)', 'unclosed bracket'],
    ['', 'empty'],
  ]) {
    let threw = false;
    try { compileExpression(bad, vi); } catch { threw = true; }
    assert(threw, `rejects ${why}: ${JSON.stringify(bad)}`);
  }
}

{
  // A bad expression is a warning naming the script, never a thrown export.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('EXPR_IF'), { expression: '$nosuchvar + 1', then: [], else: [] }),
  ];
  let c = null;
  try { c = compileProject(proj); } catch { /* left null: that is the failure */ }
  assert(c !== null, 'a bad expression does not break the export');
  assert(c.warnings.some((w) => w.includes('nosuchvar')), 'the warning names the unknown variable');
}

{
  // If / Loop over the real bytecode, not just the parser.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_VAR'), { varId: v.id, value: 3 }),
    Object.assign(makeEventOfType('EXPR_LOOP'), {
      expression: `$${v.name} > 0`,
      events: [Object.assign(makeEventOfType('ADD_VAR'), { varId: v.id, delta: -1 })],
    }),
    Object.assign(makeEventOfType('EXPR_IF'), {
      expression: `$${v.name} == 0`,
      then: [Object.assign(makeEventOfType('SET_VAR'), { varId: v.id, value: 99 })],
      else: [Object.assign(makeEventOfType('SET_VAR'), { varId: v.id, value: 1 })],
    }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `expression events compile clean (${c.warnings.join('; ')})`);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.vars[0] === 99, `the loop counted down and the If took the true branch (${e.vars[0]})`);
}

{
  // A runaway loop stalls its own script but must not wedge the frame loop.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('EXPR_LOOP'), { expression: '1', events: [] }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0, false);
  const before = e.frame;
  for (let i = 0; i < 10; i++) { e.setButtons(0); e.step(); }
  assert(e.frame === before + 10, 'frames keep advancing through a runaway loop');
  assert(e.script.active, 'the runaway script is still stuck, as documented');
}

{
  // A loop cannot live in an On Update slot, which must finish in one frame.
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.update = [
    Object.assign(makeEventOfType('EXPR_LOOP'), { expression: '1', events: [] }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.some((w) => w.includes('On Update')), 'a loop in On Update is refused');
}

console.log('— Seed Random Number Generator —');
{
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [makeEventOfType('SEED_RNG')];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  const before = e.rngState;
  runActorScript(e, 0);
  assert(e.rngState !== before, 'seeding changes the generator state');
}

console.log('— Switch —');
{
  // Each run needs its own project, so build the Switch from that project's
  // own variable rather than closing over another one's id.
  const mk = (id) => Object.assign(makeEventOfType('SWITCH'), {
    varId: id,
    cases: [
      { value: 0, events: [Object.assign(makeEventOfType('SET_VAR'), { varId: id, value: 10 })] },
      { value: 5, events: [Object.assign(makeEventOfType('SET_VAR'), { varId: id, value: 20 })] },
    ],
    else: [Object.assign(makeEventOfType('SET_VAR'), { varId: id, value: 30 })],
  });
  for (const [start, want, what] of [[0, 10, 'first case'], [5, 20, 'second case'], [7, 30, 'else']]) {
    const p2 = makeDemoProject();
    p2.scenes[0].scripts.init = [];
    p2.scenes[0].actors[0].scripts.interact = [mk(p2.variables[0].id)];
    const c = compileProject(p2);
    assert(c.warnings.length === 0, `Switch compiles clean (${c.warnings.join('; ')})`);
    const e = new Emulator(c, { onTone: () => {} });
    e.vars[0] = start;
    runActorScript(e, 0);
    assert(e.vars[0] === want, `value ${start} takes the ${what} (${e.vars[0]})`);
  }
}

{
  // Two cases testing the same value is a mistake worth naming.
  const proj = makeDemoProject();
  proj.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('SWITCH'), {
    varId: proj.variables[0].id,
    cases: [{ value: 1, events: [] }, { value: 1, events: [] }],
    else: [],
  })];
  assert(compileProject(proj).warnings.some((w) => w.includes('more than once')),
    'a duplicated Switch value warns');
}

console.log('— animation states, frame and speed —');
{
  const proj = makeDemoProject();
  const spr = proj.sprites[1];
  assert(spr.states.length === 1 && spr.states[0].name === 'Default',
    'every sprite starts with a Default state covering all frames');
  // Two frames in the demo villager: make a one-frame "idle" state.
  spr.states.push(makeSpriteStateOfType('Idle', 0, 0));
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_ANIM_STATE'), { target: 'self', stateId: spr.states[1].id, loop: false }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `Set Actor Animation State compiles clean (${c.warnings.join('; ')})`);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  const a = e.actors[0];
  assert(a.animFrom === 0 && a.animTo === 0, `the state set the frame range (${a.animFrom}-${a.animTo})`);
  assert(a.animLoop === false, 'the loop flag came through');
  // A single-frame state never advances.
  for (let i = 0; i < 60; i++) { e.setButtons(0); e.step(); }
  assert(a.frame === 0, `a one-frame state stays on its frame (${a.frame})`);
}

{
  // A non-looping multi-frame state stops on its last frame.
  const proj = makeDemoProject();
  const spr = proj.sprites[1];
  spr.states.push(makeSpriteStateOfType('Once', 0, 1));
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_ANIM_SPEED'), { target: 'self', speed: 5 }),
    Object.assign(makeEventOfType('SET_ANIM_STATE'), { target: 'self', stateId: spr.states[1].id, loop: false }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  for (let i = 0; i < 60; i++) { e.setButtons(0); e.step(); }
  assert(e.actors[0].frame === 1, `a non-looping state stops on its last frame (${e.actors[0].frame})`);
}

{
  // Speed None freezes the actor; Set Actor Animation Frame jumps directly.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_ANIM_SPEED'), { target: 'self', speed: 0 }),
    Object.assign(makeEventOfType('SET_ANIM_FRAME'), { target: 'self', frame: 1 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.actors[0].frame === 1, 'Set Actor Animation Frame jumped to frame 1');
  for (let i = 0; i < 120; i++) { e.setButtons(0); e.step(); }
  assert(e.actors[0].frame === 1, 'speed None froze the animation there');
}

{
  // A frame past the end of the sprite is clamped, not left dangling.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SET_ANIM_FRAME'), { target: 'self', frame: 99 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  const frames = e.g.sprites[e.actors[0].spriteIdx].frames.length;
  assert(e.actors[0].frame === frames - 1, `an out-of-range frame clamps (${e.actors[0].frame})`);
}

console.log('— overlay and Draw Text —');
{
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SHOW_OVERLAY'), { fill: 'black', x: 0, y: 4 }),
    Object.assign(makeEventOfType('DRAW_TEXT'), { text: 'HI', x: 4, y: 36, location: 'overlay' }),
    Object.assign(makeEventOfType('DRAW_TEXT'), { text: 'MAP', x: 8, y: 8, location: 'background' }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `overlay events compile clean (${c.warnings.join('; ')})`);
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.overlay.on && e.overlay.py === 32, `the overlay showed at y=32 (${e.overlay.py})`);
  assert(e.drawnText.length === 2, `both pieces of text are live (${e.drawnText.length})`);

  // The panel really does black out the screen below its corner.
  e.setButtons(0); e.step();
  const belowLit = e.fb.slice(40 * 128, 41 * 128).some((v) => v);
  const aboveLit = e.fb.slice(8 * 128, 9 * 128).some((v) => v);
  assert(aboveLit, 'the scene still draws above the overlay');
  assert(belowLit, 'the overlay text draws on top of the panel');
}

{
  // Redrawing at the same spot replaces rather than filling the table.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  const at = (text) => Object.assign(makeEventOfType('DRAW_TEXT'), { text, x: 0, y: 0, location: 'background' });
  proj.scenes[0].actors[0].scripts.interact = [at('one'), at('two'), at('three')];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  assert(e.drawnText.length === 1, `the same slot was reused (${e.drawnText.length})`);
  assert(e.g.strings[e.drawnText[0].strIdx] === 'three', 'and holds the latest text');
}

{
  // Overlay Move To blocks the script until the panel arrives.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SHOW_OVERLAY'), { fill: 'black', x: 0, y: 8 }),
    Object.assign(makeEventOfType('OVERLAY_MOVE'), { x: 0, y: 0, speed: 2 }),
    Object.assign(makeEventOfType('SET_VAR'), { varId: v.id, value: 7 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0, false);
  e.setButtons(0); e.step();
  assert(e.vars[0] !== 7, 'the script waits while the overlay slides');
  for (let i = 0; i < 60; i++) { e.setButtons(0); e.step(); }
  assert(e.overlay.py === 0, `the overlay arrived (${e.overlay.py})`);
  assert(e.vars[0] === 7, 'and the script resumed');
}

{
  // The scanline cutoff clips the overlay, and hiding removes it entirely.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('SHOW_OVERLAY'), { fill: 'white', x: 0, y: 0 }),
    Object.assign(makeEventOfType('OVERLAY_CUTOFF'), { y: 16 }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  runActorScript(e, 0);
  e.setButtons(0); e.step();
  assert(e.fb.slice(8 * 128, 9 * 128).every((v) => v === 1), 'a white overlay fills above the cutoff');
  assert(e.fb.slice(20 * 128, 21 * 128).some((v) => v === 0), 'and stops at the cutoff line');
}

console.log('— features are only compiled when used —');
{
  const bare = compileProject(makeDemoProject());
  assert(bare.features.OVERLAY === false, 'the demo needs no overlay code');
  assert(bare.features.EXPR === false, 'the demo needs no expression evaluator');
  assert(bare.features.PROJECTILES === false, 'the demo needs no projectile pool');

  const { ino: bareIno } = generateIno(makeDemoProject());
  assert(!bareIno.includes('evalExpression'), 'the expression evaluator is absent from the sketch');
  assert(!bareIno.includes('drawOverlay'), 'the overlay renderer is absent from the sketch');
  assert(!bareIno.includes('//#IF'), 'no feature markers leak into the generated sketch');

  const full = makeAllFeaturesProject();
  const compiledFull = compileProject(full);
  for (const key of ['OVERLAY', 'EXPR', 'SWITCH', 'PROJECTILES', 'COLLISIONS', 'SAVES', 'MENUS',
    'BUTTON_SCRIPTS', 'SCENE_STACK', 'FADE', 'LED', 'EFFECTS', 'UPDATE_SCRIPTS']) {
    assert(compiledFull.features[key] === true, `the all-features project uses ${key}`);
  }
  const { ino: fullIno } = generateIno(full);
  assert(fullIno.includes('evalExpression') && fullIno.includes('drawOverlay'),
    'and its sketch contains those subsystems');
  assert(fullIno.length > bareIno.length, `using everything costs more sketch (${bareIno.length} -> ${fullIno.length})`);
}

console.log('— variable values inside text —');
{
  // "$name" becomes a marker at compile time and the value at display time.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), { text: `Keys: $${v.name}!` }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, `text with a variable compiles clean (${c.warnings.join('; ')})`);
  assert(c.strings.some((str) => str.includes(TEXT_VAR_MARKER)), 'the string table holds a marker');

  const e = new Emulator(c, { onTone: () => {} });
  e.vars[0] = 137;
  runActorScript(e, 0, false);
  for (let i = 0; i < 200; i++) { e.setButtons(0); e.step(); }
  assert(e.pageText(e.text) === 'Keys: 137!', `the value is printed (${e.pageText(e.text)})`);

  // Read as it is drawn, so it tracks the variable with no recompile.
  e.vars[0] = 8;
  assert(e.pageText(e.text) === 'Keys: 8!', `a changed value re-renders (${e.pageText(e.text)})`);
}

{
  // A bare name runs to the first non-word character, so it swallows a letter
  // that follows; the braced form is how you say where it ends.
  const v = makeDemoProject().variables[0];
  const build = (text) => {
    const p2 = makeDemoProject();
    p2.scenes[0].scripts.init = [];
    p2.scenes[0].actors[0].scripts.interact = [Object.assign(makeEventOfType('TEXT'), { text })];
    return compileProject(p2);
  };
  const bare = build(`X$${v.name}Y`);
  assert(bare.features.TEXT_VARS === false, 'a bare name before a letter does not resolve');
  assert(bare.warnings.some((w) => w.includes(`$${v.name}Y`)), 'and the warning says which name it looked for');

  const braced = build(`X\${${v.name}}Y`);
  assert(braced.warnings.length === 0, 'the braced form resolves where the bare one cannot');
  const e = new Emulator(braced, { onTone: () => {} });
  e.vars[0] = 42;
  runActorScript(e, 0, false);
  for (let i = 0; i < 200; i++) { e.setButtons(0); e.step(); }
  assert(e.pageText(e.text) === 'X42Y', `and prints the value (${e.pageText(e.text)})`);
}

{
  // "$$" writes a literal dollar sign.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), { text: 'Costs $$5' }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.length === 0, 'an escaped dollar needs no warning');
  assert(c.features.TEXT_VARS === false, 'and is not a variable reference');
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  for (let i = 0; i < 200; i++) { e.setButtons(0); e.step(); }
  assert(e.pageText(e.text) === 'Costs $5', `the escape prints one dollar (${e.pageText(e.text)})`);
}

{
  // A typo warns and stays readable rather than blanking the sentence.
  const proj = makeDemoProject();
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), { text: 'Have $nosuchvar now' }),
  ];
  const c = compileProject(proj);
  assert(c.warnings.some((w) => w.includes('nosuchvar')), 'an unknown name warns');
  const e = new Emulator(c, { onTone: () => {} });
  runActorScript(e, 0, false);
  for (let i = 0; i < 200; i++) { e.setButtons(0); e.step(); }
  assert(e.pageText(e.text).includes('$nosuchvar'), 'and prints as written');
}

{
  // Wrapping reserves three columns per value — the widest a byte prints — so
  // a line can never overflow the box once the real value goes in.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), {
      text: `aaaa bbbb cccc $${v.name} dddd eeee ffff $${v.name} gggg`,
    }),
  ];
  const c = compileProject(proj);
  const stored = c.strings.find((str) => str.includes(TEXT_VAR_MARKER));
  for (const line of stored.split(/[\n\f]/)) {
    assert(displayWidth(line) <= 20, `the stored line reserves room for the value (${displayWidth(line)} columns)`);
  }
  const e = new Emulator(c, { onTone: () => {} });
  e.vars[0] = 255; // the widest a byte can print
  runActorScript(e, 0, false);
  for (let i = 0; i < 400; i++) { e.setButtons(0); e.step(); }
  for (const line of e.pageText(e.text).split('\n')) {
    assert(line.length <= 20, `the drawn line still fits with a 3-digit value (${line.length})`);
  }
}

{
  // The typewriter reveals the digits one at a time and never leaks a marker.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), { text: `X\${${v.name}}Y` }),
  ];
  const e = new Emulator(compileProject(proj), { onTone: () => {} });
  e.vars[0] = 123;
  runActorScript(e, 0, false);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    e.setButtons(0); e.step();
    if (e.text) seen.add(e.pageText(e.text).slice(0, e.text.shown));
  }
  assert(seen.has('X1'), `the typewriter stops part-way through a value (${[...seen].join('|')})`);
  assert(seen.has('X123Y'), 'and reaches the whole line');
  assert(![...seen].some((t) => t.includes(TEXT_VAR_MARKER)), 'a raw marker is never displayed');
}

{
  // It works everywhere text is drawn, not just dialogue.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].scripts.init = [];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('DRAW_TEXT'), { text: `S$${v.name}`, x: 0, y: 0, location: 'overlay' }),
    Object.assign(makeEventOfType('MENU'), {
      varId: v.id, layout: 'menu', options: [`Buy $${v.name}`, 'Leave'],
      lastIsZero: false, cancelB: false,
    }),
  ];
  const c = compileProject(proj);
  assert(!c.warnings.some((w) => w.includes('wider than')),
    `a menu label is measured with the value at its widest (${c.warnings.join('; ') || 'no warnings'})`);
  const e = new Emulator(c, { onTone: () => {} });
  e.vars[0] = 42;
  runActorScript(e, 0, false);
  for (let i = 0; i < 20 && !e.menu; i++) { e.setButtons(0); e.step(); }
  assert(e.drawnText.length === 1, 'Draw Text stored its string');
  assert(e.menu && e.menu.labels[0].includes(TEXT_VAR_MARKER), 'the label keeps its marker until it is drawn');
  e.setButtons(0); e.step();
  assert(e.fb.some((px) => px), 'and the frame renders with values expanded');
}

{
  // Renaming carries references along, sparing escapes and longer names.
  const proj = makeDemoProject();
  const v = proj.variables[0];
  proj.scenes[0].actors[0].scripts.interact = [
    Object.assign(makeEventOfType('TEXT'), {
      text: `bare $${v.name}, braced \${${v.name}}, escaped $$${v.name}, longer $${v.name}ish`,
    }),
    Object.assign(makeEventOfType('EXPR_IF'), { expression: `$${v.name} > 0`, then: [], else: [] }),
  ];
  const changed = renameVariableReferences(proj, v.name, 'treasure');
  const [text, expr] = proj.scenes[0].actors[0].scripts.interact;
  assert(changed === 2, `both fields were rewritten (${changed})`);
  assert(text.text.includes('bare $treasure,'), 'the bare reference followed the rename');
  assert(text.text.includes('braced ${treasure}'), 'so did the braced one');
  assert(text.text.includes(`escaped $$${v.name}`), 'an escaped dollar was left alone');
  assert(text.text.includes(`longer $${v.name}ish`), 'a longer name that starts the same was left alone');
  assert(expr.expression === '$treasure > 0', 'the expression reference followed too');
}

{
  // The expansion code is only generated for games that use it.
  const plain = compileProject(makeDemoProject());
  assert(plain.features.TEXT_VARS === false, 'the demo shows no variables in text');
  const { ino: plainIno } = generateIno(makeDemoProject());
  assert(!plainIno.includes('pgm_read_byte(str + (++i))'),
    'so its sketch carries no marker-expansion code');

  const full = makeAllFeaturesProject();
  assert(compileProject(full).features.TEXT_VARS === true, 'the all-features project does use it');
  const { ino: fullIno } = generateIno(full);
  assert(fullIno.includes('pgm_read_byte(str + (++i))'), 'and its sketch carries the expansion');
  // Octal, because a \x escape would swallow the digits of whatever follows.
  assert(fullIno.includes('\\001\\001'), 'markers are emitted as octal escapes in the generated C');
  assert(!fullIno.includes(TEXT_VAR_MARKER), 'no raw marker byte leaks into the generated source');
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

// The help text is one long template literal, so a `${...}` written to
// document syntax rather than to interpolate is evaluated as JavaScript. That
// throws inside initHelpTab(), which main.js calls while building the tabs —
// before it wires up the nav — leaving every tab visible but inert. Cheap to
// write, very expensive to notice by eye, so assert on it.
console.log('— help tab —');
{
  let html = '';
  const realDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({ set innerHTML(v) { html = v; } }) };
  let threw = null;
  try {
    const { initHelpTab } = await import('../js/helpTab.js');
    initHelpTab();
  } catch (e) {
    threw = e;
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
  assert(!threw, `initHelpTab() runs without throwing${threw ? ` (got ${threw.message})` : ''}`);
  assert(html.includes('$name'), 'help documents the bare $name form');
  assert(html.includes('${name}'), 'help documents the braced ${name} form literally');
  assert(html.includes('${gold}coins'), 'help shows the ${gold}coins disambiguation example');
}

console.log('— Start Script —');
{
  const ev = (type, fields) => Object.assign(makeEventOfType(type), fields);

  {
    // The whole point: a per-frame script beginning something that pauses.
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [];
    const target = proj.scenes[0].actors[0];
    target.scripts.interact = [ev('TEXT', { text: 'from update' })];
    target.scripts.update = [ev('START_SCRIPT', { target: target.id, slot: 'interact' })];
    const c = compileProject(proj);
    assert(c.warnings.length === 0, `Start Script in On Update compiles clean (${c.warnings.join('; ') || 'none'})`);
    const e = new Emulator(c, { onTone: () => {} });
    for (let i = 0; i < 4; i++) { e.setButtons(0); e.step(); }
    assert(!!e.text, 'On Update started a dialogue that On Update itself could never run');
  }

  {
    // Self inside the started script must mean the script's own actor, not
    // whoever started it — otherwise Hide Actor would hide the wrong one.
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [];
    const a0 = proj.scenes[0].actors[0];
    const a1 = makeActorOfType('Target', proj.sprites[2].id, 6, 3);
    a1.scripts.interact = [ev('ACTOR_HIDE', { target: 'self' })];
    proj.scenes[0].actors.push(a1);
    a0.scripts.update = [ev('START_SCRIPT', { target: a1.id, slot: 'interact' })];
    const e = new Emulator(compileProject(proj), { onTone: () => {} });
    for (let i = 0; i < 6; i++) { e.setButtons(0); e.step(); }
    assert(e.actors[1].hidden && !e.actors[0].hidden,
      `the started script's Self is its own actor (a0.hidden=${e.actors[0].hidden}, a1.hidden=${e.actors[1].hidden})`);
  }

  {
    // A start that names an empty slot or an entity in another scene is a
    // warning and no opcode, never a silently wrong jump.
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [
      ev('START_SCRIPT', { target: proj.scenes[0].actors[0].id, slot: 'hit' }), // empty slot
      ev('START_SCRIPT', { target: proj.scenes[1].actors[0].id, slot: 'interact' }), // other scene
    ];
    const c = compileProject(proj);
    assert(c.warnings.filter((w) => w.includes('Start Script')).length === 2,
      `both bad Start Scripts warned (${c.warnings.filter((w) => w.includes('Start Script')).join('; ')})`);
  }

  {
    // Overflowing the queue drops the extra rather than corrupting the VM.
    // Fired from a blocking script, so the VM is busy and every start after the
    // first has to queue — On Update could not do this, because runScript()
    // pauses every context while a dialogue is open.
    const proj = makeDemoProject();
    const a0 = proj.scenes[0].actors[0];
    a0.scripts.interact = [ev('TEXT', { text: 'busy' })];
    proj.scenes[0].scripts.init = Array.from({ length: 12 },
      () => ev('START_SCRIPT', { target: a0.id, slot: 'interact' }));
    const e = new Emulator(compileProject(proj), { onTone: () => {} });
    for (let i = 0; i < 4; i++) { e.setButtons(0); e.step(); }
    // 12 starts, 8 accepted and 4 dropped; then the init script ends and the VM
    // pulls one off to run, leaving 7 waiting.
    assert(e.scriptQueue.length === 7, `queue capped and dropped the rest (${e.scriptQueue.length} waiting, expected 7)`);
    assert(!!e.text, 'and the VM is still running the first one, not wedged');
  }
}

console.log('— Loop —');
{
  const ev = (type, fields) => Object.assign(makeEventOfType(type), fields);

  {
    // A loop with a Wait yields, so the counter climbs one step at a time
    // instead of burning the whole instruction budget in one frame.
    const proj = makeDemoProject();
    const v = proj.variables[0].id;
    proj.scenes[0].scripts.init = [
      ev('LOOP', { events: [ev('ADD_VAR', { varId: v, delta: 1 }), ev('WAIT', { frames: 2 })] }),
    ];
    const c = compileProject(proj);
    assert(c.warnings.length === 0, `a Loop containing a Wait compiles clean (${c.warnings.join('; ') || 'none'})`);
    const e = new Emulator(c, { onTone: () => {} });
    for (let i = 0; i < 12; i++) { e.setButtons(0); e.step(); }
    const n = e.vars[0];
    assert(n > 1 && n < 12, `the loop repeated but yielded between iterations (${n} times in 12 frames)`);
    assert(e.script.active, 'and it is still looping — nothing broke out');
  }

  {
    // Provably stuck: nothing in the body pauses or ends the script.
    const proj = makeDemoProject();
    const v = proj.variables[0].id;
    proj.scenes[0].scripts.init = [
      ev('LOOP', { events: [ev('ADD_VAR', { varId: v, delta: 1 })] }),
    ];
    const c = compileProject(proj);
    assert(c.warnings.some((w) => /Loop never finishes/.test(w)),
      `a Loop with no way out warns (${c.warnings.join('; ') || 'no warnings'})`);
  }

  {
    // Stop Script counts as a way out, so this must NOT warn.
    const proj = makeDemoProject();
    const v = proj.variables[0].id;
    proj.scenes[0].scripts.init = [
      ev('LOOP', {
        events: [
          Object.assign(makeEventOfType('IF_VAR'), {
            varId: v, cmp: '>', value: 3, then: [makeEventOfType('END_SCRIPT')], else: [],
          }),
          ev('ADD_VAR', { varId: v, delta: 1 }),
        ],
      }),
    ];
    const c = compileProject(proj);
    assert(!c.warnings.some((w) => /Loop never finishes/.test(w)),
      'a Loop broken by Stop Script does not warn');
    const e = new Emulator(c, { onTone: () => {} });
    for (let i = 0; i < 5; i++) { e.setButtons(0); e.step(); }
    assert(e.vars[0] === 4, `and it actually exits (counter stopped at ${e.vars[0]})`);
  }

  {
    // Loop is blocking, so On Update refuses it like the other pausing events.
    const proj = makeDemoProject();
    proj.scenes[0].scripts.init = [];
    proj.scenes[0].actors[0].scripts.update = [ev('LOOP', { events: [makeEventOfType('SEED_RNG')] })];
    const c = compileProject(proj);
    assert(c.warnings.some((w) => w.includes('On Update')), 'Loop is refused in an On Update slot');
  }
}

console.log('— copy/paste helpers —');
{
  const ev = (type, fields) => Object.assign(makeEventOfType(type), fields);

  {
    // Every id must be fresh, including deep inside branches and switch cases.
    const src = [
      Object.assign(makeEventOfType('IF_VAR'), {
        then: [makeEventOfType('SEED_RNG')],
        else: [Object.assign(makeEventOfType('EVENT_GROUP'), { events: [makeEventOfType('WAIT')] })],
      }),
      Object.assign(makeEventOfType('SWITCH'), {
        cases: [{ value: 0, events: [makeEventOfType('STOP_SONG')] }], else: [],
      }),
    ];
    const copy = cloneWithNewIds(src);
    const ids = (list) => { const out = []; forEachEvent(list, (e) => out.push(e.id)); return out; };
    const srcIds = new Set(ids(src));
    const copyIds = ids(copy);
    assert(copyIds.length === srcIds.size, `clone kept every event (${copyIds.length})`);
    assert(copyIds.every((id) => !srcIds.has(id)), 'no id is shared with the original, at any depth');
  }

  {
    // Pasting into another scene must not leave references to actors that are
    // not there — they would compile to skipped events with only a warning.
    const proj = makeDemoProject();
    const foreign = proj.scenes[1].actors[0].id;
    const list = [
      ev('ACTOR_HIDE', { target: foreign }),
      ev('ACTOR_SHOW', { target: 'player' }),
      ev('ACTOR_MOVE', { target: 'self' }),
    ];
    const reset = retargetActorRefs(list, proj.scenes[0]);
    assert(reset === 1, `only the unreachable reference was rewritten (${reset})`);
    assert(list[0].target === 'self', 'the foreign actor became Self');
    assert(list[1].target === 'player' && list[2].target === 'self', 'player and self were left alone');
  }
}

console.log('— bytecode sanity —');
assert(compiled.code.length > 40 && compiled.code.length < 4096, `bytecode size sensible (${compiled.code.length} bytes)`);
assert(compiled.strings.every((s) => s.split('\f').every((p) => p.split('\n').length <= 3 && p.split('\n').every((l) => l.length <= 20))), 'all strings wrapped to 20 chars x 3 lines per page');

console.log(failures ? `\n${failures} FAILURES` : '\nAll runtime tests passed.');
process.exit(failures ? 1 : 0);
