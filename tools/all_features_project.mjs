#!/usr/bin/env node
// A project that exercises every optional engine subsystem at once, shared by
// tools/check_codegen.mjs and tools/build_avr.sh so the "worst case" figure
// they report is the same project.

import { makeDemoProject, makeEvent, makeActor } from '../js/model.js';

// Engine subsystems are stripped from the sketch when a game does not use
// them, so both paths need checking: a project that uses none of them, and one
// that uses every single one.
export function makeAllFeaturesProject() {
  const p = makeDemoProject();
  const sc = p.scenes[0];
  const v = p.variables[0];
  const spriteId = p.sprites[0].id;
  const target = makeActor('Target', p.sprites[1].id, 6, 3);
  target.collisionGroup = '1';
  target.collideWith = 1;
  target.scripts.hit = [Object.assign(makeEvent('SET_VAR'), { varId: v.id, value: 1 })];
  target.scripts.update = [Object.assign(makeEvent('ADD_VAR'), { varId: v.id, delta: 1 })];
  sc.actors.push(target);

  const ev = (type, props) => Object.assign(makeEvent(type), props);
  sc.actors[0].scripts.interact = [
    ev('EXPR_IF', { expression: `$${v.name} > 0`, then: [ev('SEED_RNG', {})], else: [] }),
    ev('EXPR_LOOP', { expression: `$${v.name} > 250`, events: [ev('ADD_VAR', { varId: v.id, delta: 1 })] }),
    // A Wait keeps this one honest — a Loop with no way out is a compiler warning.
    ev('LOOP', { events: [ev('ADD_VAR', { varId: v.id, delta: 1 }), ev('WAIT', { frames: 1 }), ev('END_SCRIPT', {})] }),
    ev('START_SCRIPT', { target: target.id, slot: 'hit' }),
    ev('SWITCH', {
      varId: v.id,
      cases: [{ value: 0, events: [ev('SET_VAR', { varId: v.id, value: 2 })] }],
      else: [ev('SET_VAR', { varId: v.id, value: 3 })],
    }),
    ev('SET_ANIM_FRAME', { target: 'self', frame: 1 }),
    ev('SET_ANIM_SPEED', { target: 'self', speed: 10 }),
    ev('SET_ANIM_STATE', { target: 'self', stateId: p.sprites[1].states[0].id, loop: true }),
    ev('LAUNCH_PROJECTILE', { source: 'self', spriteId, direction: 'right', speed: 2, life: 60, collideWith: 2 }),
    ev('ACTOR_EFFECT', { target: 'self', effect: 'flicker', frames: 10 }),
    ev('SHOW_OVERLAY', { fill: 'black', x: 0, y: 4 }),
    // A "$name" prints the variable's value, so the generated sketch is checked
    // with the expansion markers actually present.
    ev('DRAW_TEXT', { text: `SCORE $${v.name}`, x: 4, y: 36, location: 'overlay' }),
    ev('DRAW_TEXT', { text: 'MAP', x: 8, y: 8, location: 'background' }),
    ev('OVERLAY_MOVE', { x: 0, y: 2, speed: 2 }),
    ev('OVERLAY_CUTOFF', { y: 32 }),
    ev('HIDE_OVERLAY', {}),
    ev('FADE_OUT', { fade: 1 }),
    ev('FADE_IN', { fade: 1 }),
    ev('PUSH_SCENE', { sceneId: p.scenes[1].id, x: 1, y: 1, fade: 1 }),
    ev('POP_SCENE', { fade: 1 }),
    ev('POP_ALL_SCENES', { fade: 1 }),
    ev('MENU', { varId: v.id, layout: 'menu', options: ['One', 'Two'], lastIsZero: false, cancelB: true }),
    ev('SET_LED', { mode: 'analog', r: 255, g: 0, b: 0 }),
    ev('PLAY_SONG', { songId: p.songs[0].id, loop: true }),
    ev('STOP_SONG', {}),
    ev('SAVE_GAME', {}),
    ev('LOAD_GAME', {}),
    ev('SAVE_CHECK', { varId: v.id }),
    ev('DELETE_SAVE', {}),
    ev('ATTACH_SCRIPT', { button: 'b', override: false, script: [ev('SET_VAR', { varId: v.id, value: 4 })] }),
    ev('REMOVE_BUTTON_SCRIPT', { button: 'b' }),
    ev('WAIT_INPUT', { mask: 16 }),
    ev('IF_INPUT', { mask: 16, then: [], else: [] }),
    ev('IF_ACTOR_AT', { target: 'self', x: 1, y: 1, then: [], else: [] }),
    ev('IF_ACTOR_DISTANCE', { target: 'player', cmp: '<=', distance: 3, from: 'self', then: [], else: [] }),
    ev('STORE_ACTOR_DIR', { target: 'self', varId: v.id }),
    ev('STORE_ACTOR_POS', { target: 'self', varX: p.variables[1].id, varY: p.variables[2].id }),
  ];
  return p;
}
