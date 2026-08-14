// In-browser play-test runtime. Mirrors the generated Arduboy engine
// byte-for-byte: it executes the same compiled bytecode, uses the real
// Arduboy2 font, and follows the same update order, so browser behaviour
// matches the device.

import {
  SCENE_W, SCENE_H, TILE,
  MAX_PROJECTILES, SCENE_STACK_DEPTH, FADE_LEVELS, PROJECTILE_DIRS,
  PROJECTILE_DIR_SOURCE, DIRECTIONS, COLLIDE_PLAYER, groupBit,
} from './model.js';
import {
  OP, NO_SCRIPT,
  MENU_LAST_IS_ZERO, MENU_CANCEL_B, MENU_LAYOUT_DIALOGUE,
  ATTACH_OVERRIDE, NUM_BUTTONS,
  PROJECTILE_SRC_SELF, PROJECTILE_SRC_PLAYER,
  ACTOR_REF_SELF, ACTOR_REF_PLAYER,
  MAX_DRAWN_TEXT, DRAW_TEXT_OVERLAY, DRAW_TEXT_BACKGROUND, TEXT_VAR_MARKER,
} from './compiler.js';
import { evalExpression } from './expression.js';
import { FONT5X7 } from './font5x7.js';

export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, A: 16, B: 32 };

const W = 128, H = 64;
const PLAYER_SPEED = 2;   // px per frame (8px tile / 2 = 4 frames per step)
const ACTOR_MOVE_INTERVAL = 48; // frames between AI steps
const ANIM_INTERVAL = 20;       // default frames between animation steps
// Frames between steps of the player's built-in two-frame walk cycle, and the
// rate a scripted animation state inherits when the player has none of its own.
const PLAYER_ANIM_INTERVAL = 8;
const TEXT_CHARS_PER_FRAME = 2;
const MAX_TILE_OVERRIDES = 16;  // matches the C++ engine's RAM override table
const SCRIPT_QUEUE_DEPTH = 8;   // pending init/hit scripts waiting for the VM

// 4x4 ordered dither, the cheapest way to fade a 1-bit screen. A pixel survives
// while its threshold is at or above the current fade level, so level 0 draws
// everything and level FADE_LEVELS draws nothing.
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

// dx/dy for a projectile direction code, indexed by PROJECTILE_DIRS[].code.
const PROJ_DX = [];
const PROJ_DY = [];
for (const d of PROJECTILE_DIRS) { PROJ_DX[d.code] = d.dx; PROJ_DY[d.code] = d.dy; }

// Actor facing code -> the projectile direction code pointing the same way.
const FACING_TO_PROJ_DIR = [];
for (const d of DIRECTIONS) {
  const match = PROJECTILE_DIRS.find((p) => p.dx === d.dx && p.dy === d.dy);
  FACING_TO_PROJ_DIR[d.code] = match ? match.code : 0;
}

// Turn a stored string into what the player actually reads, replacing each
// "$name" marker the compiler left behind with that variable's value right now.
// The C++ engine walks the same bytes without building a string, since RAM is
// far scarcer there.
function expandText(src, vars) {
  if (!src.includes(TEXT_VAR_MARKER)) return src; // the overwhelmingly common case
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === TEXT_VAR_MARKER) {
      out += String(vars[src.charCodeAt(i + 1) - 1]);
      i++;
    } else {
      out += src[i];
    }
  }
  return out;
}

// Comparison operators, in the order the CMP table in the compiler assigns.
function compare(cmp, a, b) {
  switch (cmp) {
    case 0: return a === b;
    case 1: return a !== b;
    case 2: return a < b;
    case 3: return a > b;
    case 4: return a <= b;
    default: return a >= b;
  }
}

// Save-game layout (matches the C++ engine's EEPROM block):
// [0]=0xA5 [1]=0x5D magic, [2]=scene, [3]=tileX, [4]=tileY, [5..36]=vars
export const SAVE_SIZE = 37;
const SAVE_MAGIC0 = 0xa5, SAVE_MAGIC1 = 0x5d;

// Default save storage: in-memory only (tests). The Play tab passes a
// localStorage-backed twin of the Arduboy's EEPROM.
export function memoryStorage() {
  let data = null;
  return {
    read: () => data,
    write: (bytes) => { data = Uint8Array.from(bytes); },
    clear: () => { data = null; },
  };
}

export class Emulator {
  constructor(compiled, opts = {}) {
    this.g = compiled;
    // onTone(freqHz, durationMs) — covers both the Tone event and song notes.
    this.onTone = opts.onTone || (() => {});
    this.storage = opts.storage || memoryStorage();
    this.fb = new Uint8Array(W * H);
    this.buttons = 0;
    this.prevButtons = 0;
    this.frame = 0;
    this.rngState = 0xdead4a11;
    this.reset();
  }

  reset() {
    this.vars = new Uint8Array(32);
    this.script = { active: false, pc: 0, self: 0xff, wait: 0, waitActor: -1, waitInput: 0, waitFade: false, waitOverlay: false };
    // On Update scripts run to completion inside one frame, so they need no
    // persistent program counter — one scratch context is reused for all.
    this.scratch = { active: false, pc: 0, self: 0xff, wait: 0, waitActor: -1, waitInput: 0, waitFade: false, waitOverlay: false };
    this.text = null; // { str, pageStart, shown }
    this.menu = null; // { varIdx, count, labels, sel, flags }
    // RGB LED, mirroring Arduboy2's setRGBled / digitalWriteRGB.
    this.led = { mode: 'analog', r: 0, g: 0, b: 0 };
    this.armedTrigger = -1;
    this.armedHit = -1;
    this.frame = 0;
    this.song = { idx: -1, pos: 0, framesLeft: 0, loop: false };
    this.projectiles = Array.from({ length: MAX_PROJECTILES }, () => ({
      active: false, spriteIdx: 0, px: 0, py: 0, dx: 0, dy: 0, life: 0, mask: 0,
    }));
    // Scenes remembered by Push Scene, so Pop Scene can put the player back.
    this.sceneStack = [];
    // level 0 = fully visible; target drives the dither animation.
    this.fade = { level: 0, target: 0, speed: 0, tick: 0 };
    // The Game Boy's hardware window, as a software panel: a filled rectangle
    // from (px,py) to the bottom-right of the screen.
    this.overlay = { on: false, fill: 0, px: 0, py: 0, tx: 0, ty: 0, speed: 0 };
    this.overlayCutoff = H; // overlay and dialogue draw only above this line
    this.drawnText = [];    // { strIdx, x, y, location }, bounded like tile overrides
    this.scriptQueue = [];
    // Scripts attached to buttons persist across scene changes until removed.
    // Bytecode button order: 0=LEFT 1=RIGHT 2=UP 3=DOWN 4=A 5=B.
    this.buttonScript = new Array(NUM_BUTTONS).fill(NO_SCRIPT);
    this.buttonOverride = 0;
    this.camX = 0; this.camY = 0;
    // The player carries the same mutable fields an actor does, under the same
    // names, so the actor events can drive either through one resolver. There is
    // deliberately no `facing` here: direction already lives in fx/fy, and a
    // second copy would drift the moment the player walks.
    this.player = {
      px: this.g.startX * TILE, py: this.g.startY * TILE, tx: 0, ty: 0, moving: false,
      fx: 0, fy: 1, frame: 0, anim: 0,
      spriteIdx: this.g.playerSpriteIdx,
      hidden: false,
      effect: 0, effectFrames: 0,
      animate: true, animSpeed: 0,
      animFrom: 0, animTo: this.spriteLastFrame(this.g.playerSpriteIdx), animLoop: true,
    };
    this.loadScene(this.g.startScene, this.g.startX, this.g.startY, true);
  }

  rand(n) {
    let x = this.rngState;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.rngState = x;
    return x % n;
  }

  loadScene(idx, px, py, runEnter) {
    const sc = this.g.scenes[idx];
    this.sceneIdx = idx;
    this.cols = sc.cols;
    this.rows = sc.rows;
    this.baseTiles = sc.tiles;    // "PROGMEM" map — never mutated
    this.overrides = [];          // SET_TILE lands here, like the C++ RAM table
    this.actors = sc.actors.map((a) => ({
      def: a,
      // Per-instance copies: `def` is the shared compiled scene object, so
      // events like Set Actor Sprite must never write through it.
      spriteIdx: a.spriteIdx,
      facing: a.facing,
      speed: a.speed,
      effect: 0, effectFrames: 0,
      px: a.x * TILE, py: a.y * TILE,
      tx: a.x, ty: a.y,
      moving: false, hidden: false,
      scriptMove: false,
      dir: 1, timer: this.rand(ACTOR_MOVE_INTERVAL),
      frame: 0, anim: this.rand(ANIM_INTERVAL),
      animSpeed: a.animSpeed,
      // Frame range currently playing, and whether it repeats.
      animFrom: 0, animTo: this.spriteLastFrame(a.spriteIdx), animLoop: true,
      subTick: 0, // half-speed carry
    }));
    this.player.px = px * TILE; this.player.py = py * TILE;
    this.player.tx = px; this.player.ty = py;
    this.player.moving = false;
    this.armedTrigger = -1;
    this.armedHit = -1;
    this.text = null;
    this.script.waitActor = -1;
    for (const p of this.projectiles) p.active = false;
    this.drawnText = [];
    this.overlay.on = false;

    // Actors initialise before the scene does, and each init can block on
    // dialogue, so they queue up rather than all running at once.
    this.scriptQueue = [];
    if (runEnter) {
      for (let i = 0; i < sc.actors.length; i++) {
        if (sc.actors[i].scripts.init !== NO_SCRIPT) this.scriptQueue.push({ idx: sc.actors[i].scripts.init, self: i });
      }
      if (sc.scripts.init !== NO_SCRIPT) this.scriptQueue.push({ idx: sc.scripts.init, self: 0xff });
    }
    if (!this.startNextQueued()) this.script.active = false;
  }

  // Start the next queued script; false when the queue is empty.
  startNextQueued() {
    if (!this.scriptQueue.length) return false;
    const job = this.scriptQueue.shift();
    this.startScript(job.idx, job.self);
    return true;
  }

  // Hold a script until the VM is free. Collisions can happen while dialogue
  // is up, and dropping them would lose hits; the queue is bounded so a scene
  // full of overlapping actors cannot grow it without limit.
  queueScript(scriptIdx, selfActor) {
    if (scriptIdx === NO_SCRIPT) return;
    if (!this.script.active && !this.scriptQueue.length) { this.startScript(scriptIdx, selfActor); return; }
    if (this.scriptQueue.length < SCRIPT_QUEUE_DEPTH) this.scriptQueue.push({ idx: scriptIdx, self: selfActor });
  }

  startScript(scriptIdx, selfActor) {
    this.script.active = true;
    this.script.pc = this.g.scriptOffsets[scriptIdx];
    this.script.self = selfActor;
    this.script.wait = 0;
    this.script.waitActor = -1;
    this.script.waitInput = 0;
    this.script.waitFade = false;
    this.script.waitOverlay = false;
    this.text = null;
  }

  setButtons(mask) { this.buttons = mask; }

  justPressed(b) { return (this.buttons & b) && !(this.prevButtons & b); }
  pressed(b) { return (this.buttons & b) !== 0; }

  tileAt(x, y) {
    for (let i = 0; i < this.overrides.length; i++) {
      const o = this.overrides[i];
      if (o.x === x && o.y === y) return o.t;
    }
    return this.baseTiles[y * this.cols + x];
  }

  setTile(x, y, t) {
    for (let i = 0; i < this.overrides.length; i++) {
      const o = this.overrides[i];
      if (o.x === x && o.y === y) { o.t = t; return; }
    }
    if (this.overrides.length < MAX_TILE_OVERRIDES) this.overrides.push({ x, y, t });
    // Table full: the change is dropped, same as on the device.
  }

  tileSolid(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return true;
    const t = this.g.tiles[this.tileAt(x, y)];
    return t ? t.solid : false;
  }

  actorAt(x, y, skip) {
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.hidden || i === skip) continue;
      const cx = Math.round(a.px / TILE), cy = Math.round(a.py / TILE);
      if ((cx === x && cy === y) || (a.tx === x && a.ty === y)) return i;
    }
    return -1;
  }

  // ----------------------------------------------------------------- saving

  saveGame() {
    const b = new Uint8Array(SAVE_SIZE);
    b[0] = SAVE_MAGIC0; b[1] = SAVE_MAGIC1;
    b[2] = this.sceneIdx;
    b[3] = Math.round(this.player.px / TILE);
    b[4] = Math.round(this.player.py / TILE);
    b.set(this.vars, 5);
    this.storage.write(b);
  }

  saveExists() {
    const b = this.storage.read();
    return !!(b && b.length >= SAVE_SIZE && b[0] === SAVE_MAGIC0 && b[1] === SAVE_MAGIC1);
  }

  // Returns true if a valid save was applied (scene load already done).
  loadGame() {
    if (!this.saveExists()) return false;
    const b = this.storage.read();
    this.vars.set(b.slice(5, 5 + 32));
    const scene = Math.min(b[2], this.g.scenes.length - 1);
    const sc = this.g.scenes[scene];
    this.loadScene(scene, Math.min(b[3], sc.cols - 1), Math.min(b[4], sc.rows - 1), true);
    return true;
  }

  // ------------------------------------------------------------------ music

  playSong(idx, loop) {
    if (idx >= this.g.songs.length) return;
    this.song = { idx, pos: -1, framesLeft: 0, loop };
    this.advanceSong();
  }

  stopSong() {
    this.song = { idx: -1, pos: 0, framesLeft: 0, loop: false };
  }

  advanceSong() {
    const s = this.song;
    const notes = this.g.songs[s.idx].notes;
    s.pos++;
    if (s.pos >= notes.length) {
      if (s.loop && notes.length) s.pos = 0;
      else { this.stopSong(); return; }
    }
    const n = notes[s.pos];
    s.framesLeft = Math.max(1, Math.round(n.d * 60 / 1000));
    if (n.f > 0) this.onTone(n.f, n.d);
  }

  stepSong() {
    if (this.song.idx < 0) return;
    this.song.framesLeft--;
    if (this.song.framesLeft <= 0) this.advanceSong();
  }

  // ------------------------------------------------------------------ update

  step() {
    this.frame++;
    this.stepSong();
    this.stepFade();

    // A finished init script hands over to the next one queued by loadScene.
    if (!this.script.active) this.startNextQueued();

    if (this.script.active) {
      this.runScript(this.script);
    } else {
      // Default actions run first (with overridden buttons masked out), then
      // any script attached to a button that was just pressed takes over.
      this.updatePlayer();
      this.checkTriggers();
      if (!this.script.active) this.checkCollisions();
      if (!this.script.active) this.checkButtonScripts();
    }
    this.updateActors(!this.script.active);
    this.updateOverlay();
    this.updateProjectiles();
    this.runUpdateScripts();
    this.updateCamera();

    this.prevButtons = this.buttons;
    this.draw();
  }

  // On Update scripts run every frame regardless of what the blocking VM is
  // doing, and must finish within the frame — the compiler strips anything
  // that could pause them.
  runUpdateScripts() {
    const sceneBefore = this.sceneIdx;
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.hidden || a.def.scripts.update === NO_SCRIPT) continue;
      const s = this.scratch;
      s.active = true;
      s.pc = this.g.scriptOffsets[a.def.scripts.update];
      s.self = i;
      s.wait = 0; s.waitActor = -1; s.waitInput = 0; s.waitFade = false; s.waitOverlay = false;
      this.runScript(s);
      // A scene change rebuilds this.actors, so the indices we are walking
      // no longer mean anything.
      if (this.sceneIdx !== sceneBefore) return;
    }
  }

  stepFade() {
    const f = this.fade;
    if (f.level === f.target) return;
    if (f.tick > 0) { f.tick--; return; }
    f.tick = f.speed;
    f.level += f.level < f.target ? 1 : -1;
  }

  fading() { return this.fade.level !== this.fade.target; }

  startFade(target, speed) {
    this.fade.target = Math.max(0, Math.min(FADE_LEVELS, target));
    this.fade.speed = speed;
    this.fade.tick = speed;
  }

  updateCamera() {
    const maxX = this.cols * TILE - W;
    const maxY = this.rows * TILE - H;
    this.camX = Math.max(0, Math.min(maxX, this.player.px - (W / 2 - TILE / 2)));
    this.camY = Math.max(0, Math.min(maxY, this.player.py - (H / 2 - TILE / 2)));
  }

  // Bit for a bytecode button index (0=LEFT 1=RIGHT 2=UP 3=DOWN 4=A 5=B).
  buttonBit(idx) {
    return [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN, BTN.A, BTN.B][idx];
  }

  // Buttons whose default game action has been replaced by a script.
  overriddenMask() {
    let mask = 0;
    for (let i = 0; i < NUM_BUTTONS; i++) {
      if (this.buttonScript[i] !== NO_SCRIPT && (this.buttonOverride & (1 << i))) {
        mask |= this.buttonBit(i);
      }
    }
    return mask;
  }

  checkButtonScripts() {
    for (let i = 0; i < NUM_BUTTONS; i++) {
      if (this.buttonScript[i] === NO_SCRIPT) continue;
      if (this.justPressed(this.buttonBit(i))) {
        this.startScript(this.buttonScript[i], 0xff);
        return;
      }
    }
  }

  // Advance the player's frame. Untouched by a script the player keeps its
  // original two-frame walk cycle, which only runs while actually walking; once
  // Set Actor Animation Speed/State has given it a real animation, that plays on
  // its own terms — including while standing still, which is what a scripted
  // sword swing needs.
  advancePlayerAnim() {
    const p = this.player;
    // Same countdown the actors get in updateActors().
    if (p.effectFrames > 0 && --p.effectFrames === 0) p.effect = 0;
    if (p.animSpeed > 0) {
      if (!p.animate || p.animTo <= p.animFrom) return;
      p.anim++;
      if (p.anim >= p.animSpeed) {
        p.anim = 0;
        if (p.frame < p.animTo) p.frame++;
        else if (p.animLoop) p.frame = p.animFrom;
      }
      return;
    }
    if (!p.moving) return;
    p.anim++;
    if (p.anim % 8 === 0) p.frame ^= 1;
  }

  updatePlayer() {
    const p = this.player;
    this.advancePlayerAnim();
    if (p.moving) {
      const gx = p.tx * TILE, gy = p.ty * TILE;
      p.px += Math.sign(gx - p.px) * Math.min(PLAYER_SPEED, Math.abs(gx - p.px));
      p.py += Math.sign(gy - p.py) * Math.min(PLAYER_SPEED, Math.abs(gy - p.py));
      if (p.px === gx && p.py === gy) p.moving = false;
      return;
    }
    // A button whose script overrides the default action no longer moves the
    // player or interacts.
    const blocked = this.overriddenMask();
    const held = (b) => this.pressed(b) && !(blocked & b);
    let dx = 0, dy = 0;
    if (held(BTN.LEFT)) dx = -1;
    else if (held(BTN.RIGHT)) dx = 1;
    else if (held(BTN.UP)) dy = -1;
    else if (held(BTN.DOWN)) dy = 1;

    if (dx || dy) {
      p.fx = dx; p.fy = dy;
      const nx = Math.round(p.px / TILE) + dx;
      const ny = Math.round(p.py / TILE) + dy;
      if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows &&
          !this.tileSolid(nx, ny)) {
        const ai = this.actorAt(nx, ny, -1);
        if (ai < 0 || !this.actors[ai].def.solid) {
          p.tx = nx; p.ty = ny; p.moving = true;
        }
      }
    }

    if (this.justPressed(BTN.A) && !(blocked & BTN.A)) {
      const fx = Math.round(p.px / TILE) + p.fx;
      const fy = Math.round(p.py / TILE) + p.fy;
      const ai = this.actorAt(fx, fy, -1);
      if (ai >= 0) {
        const def = this.actors[ai].def;
        if (def.scripts.interact !== NO_SCRIPT) this.startScript(def.scripts.interact, ai);
      }
    }
  }

  checkTriggers() {
    const p = this.player;
    if (p.moving) return;
    const cx = Math.round(p.px / TILE), cy = Math.round(p.py / TILE);
    const sc = this.g.scenes[this.sceneIdx];
    let hit = -1;
    for (let i = 0; i < sc.triggers.length; i++) {
      const t = sc.triggers[i];
      if (cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h) { hit = i; break; }
    }
    if (hit !== this.armedTrigger && this.armedTrigger >= 0) {
      // Stepping out of an area — or straight from one into another.
      const left = sc.triggers[this.armedTrigger];
      if (left && left.scripts.leave !== NO_SCRIPT) this.queueScript(left.scripts.leave, 0xff);
    }
    if (hit < 0) { this.armedTrigger = -1; return; }
    if (hit !== this.armedTrigger) {
      this.armedTrigger = hit;
      const t = sc.triggers[hit];
      if (t.scripts.enter !== NO_SCRIPT) this.queueScript(t.scripts.enter, 0xff);
    }
  }

  // ------------------------------------------------- actor reference lookups

  // Tile position of an actor reference, or null when it names nothing.
  // 0xFF resolves to the running script's own actor, 0xFE to the player.
  refTile(ref, self) {
    if (ref === ACTOR_REF_PLAYER) {
      return { x: Math.round(this.player.px / TILE), y: Math.round(this.player.py / TILE) };
    }
    const idx = ref === ACTOR_REF_SELF ? self : ref;
    const a = this.actors[idx];
    if (!a) return null;
    return { x: Math.round(a.px / TILE), y: Math.round(a.py / TILE) };
  }

  // The object an actor reference names, or null when it names nothing. The
  // player carries the same mutable field names as an actor, so events that only
  // read or write those fields work through this without caring which they got.
  refActor(ref, self) {
    if (ref === ACTOR_REF_PLAYER) return this.player;
    const idx = ref === ACTOR_REF_SELF ? self : ref;
    return this.actors[idx] || null;
  }

  // Facing code of an actor reference. The player has no stored facing, only
  // the direction it last walked, so derive it from that.
  refFacing(ref, self) {
    if (ref === ACTOR_REF_PLAYER) {
      const d = DIRECTIONS.find((v) => v.dx === this.player.fx && v.dy === this.player.fy);
      return d ? d.code : 0;
    }
    const idx = ref === ACTOR_REF_SELF ? self : ref;
    const a = this.actors[idx];
    return a ? a.facing : 0;
  }

  // ------------------------------------------------------------- collisions

  spriteSize(idx) {
    const s = this.g.sprites[idx];
    return s ? { w: s.width, h: s.height } : { w: TILE, h: TILE };
  }

  static overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
  }

  actorOverlapsPlayer(a) {
    const as = this.spriteSize(a.spriteIdx);
    const ps = this.spriteSize(this.player.spriteIdx);
    return Emulator.overlaps(a.px, a.py, as.w, as.h,
      this.player.px, this.player.py, ps.w, ps.h);
  }

  // The player touching an actor runs that actor's On Hit script; an actor in
  // a collision group that has nothing to say falls back to the scene's On
  // Player Hit. Like triggers, a hit re-arms only once the two separate.
  checkCollisions() {
    const sc = this.g.scenes[this.sceneIdx];
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.hidden || !a.def.group) continue;
      if (!this.actorOverlapsPlayer(a)) continue;
      if (this.armedHit === i) return; // still touching the same actor
      this.armedHit = i;
      const wantsPlayer = (a.def.collideWith & COLLIDE_PLAYER) !== 0;
      if (wantsPlayer && a.def.scripts.hit !== NO_SCRIPT) this.queueScript(a.def.scripts.hit, i);
      else this.queueScript(sc.scripts.playerHit, i);
      return;
    }
    this.armedHit = -1;
  }

  // ------------------------------------------------------------ projectiles

  launchProjectile(srcIdx, spriteIdx, dirCode, speed, life, mask) {
    let x, y, facing;
    if (srcIdx === PROJECTILE_SRC_PLAYER) {
      x = this.player.px; y = this.player.py;
      // The player has no facing code, only the dx/dy it last walked.
      const d = DIRECTIONS.find((v) => v.dx === this.player.fx && v.dy === this.player.fy);
      facing = d ? d.code : 0;
    } else {
      const a = this.actors[srcIdx];
      if (!a) return;
      x = a.px; y = a.py; facing = a.facing;
    }
    const dir = dirCode === PROJECTILE_DIR_SOURCE ? FACING_TO_PROJ_DIR[facing] : dirCode;
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return; // pool exhausted — the shot is simply dropped
    p.active = true;
    p.spriteIdx = spriteIdx;
    // Start centred on the launcher so a big sprite doesn't shoot from a corner.
    const src = this.spriteSize(srcIdx === PROJECTILE_SRC_PLAYER ? this.player.spriteIdx : this.actors[srcIdx].spriteIdx);
    const own = this.spriteSize(spriteIdx);
    p.px = x + (src.w - own.w) / 2;
    p.py = y + (src.h - own.h) / 2;
    p.dx = PROJ_DX[dir] * speed;
    p.dy = PROJ_DY[dir] * speed;
    p.life = life;
    p.mask = mask;
  }

  updateProjectiles() {
    const sc = this.g.scenes[this.sceneIdx];
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.px += p.dx;
      p.py += p.dy;
      if (--p.life === 0) { p.active = false; continue; }
      const size = this.spriteSize(p.spriteIdx);
      const cx = Math.floor((p.px + size.w / 2) / TILE);
      const cy = Math.floor((p.py + size.h / 2) / TILE);
      if (this.tileSolid(cx, cy)) { p.active = false; continue; }
      for (let i = 0; i < this.actors.length; i++) {
        const a = this.actors[i];
        if (a.hidden || !a.def.group) continue;
        if (!(p.mask & groupBit(a.def.group))) continue;
        const as = this.spriteSize(a.spriteIdx);
        if (!Emulator.overlaps(p.px, p.py, size.w, size.h, a.px, a.py, as.w, as.h)) continue;
        p.active = false;
        if (a.def.scripts.hit !== NO_SCRIPT) this.queueScript(a.def.scripts.hit, i);
        else this.queueScript(sc.scripts.playerHit, i);
        break;
      }
    }
  }

  // Pixels this actor moves this frame. Speed 0 is the half-speed code: one
  // pixel every other frame. Called once per actor per frame so the carry
  // toggles at the right rate.
  actorStep(a) {
    if (a.speed !== 0) return a.speed;
    a.subTick ^= 1;
    return a.subTick;
  }

  updateActors(allowMove) {
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.effectFrames > 0 && --a.effectFrames === 0) a.effect = 0;
      if (a.hidden) continue;
      const step = this.actorStep(a);
      if (a.def.animate && a.animSpeed > 0 && a.animTo > a.animFrom) {
        a.anim++;
        if (a.anim >= a.animSpeed) {
          a.anim = 0;
          if (a.frame < a.animTo) a.frame++;
          else if (a.animLoop) a.frame = a.animFrom;
          // A non-looping state simply stops on its last frame.
        }
      }
      // A scripted Move Actor walks even while the script runs, straight to
      // its target (x first, then y), ignoring collisions.
      if (a.scriptMove) {
        const gx = a.tx * TILE, gy = a.ty * TILE;
        if (a.px !== gx) a.px += Math.sign(gx - a.px) * Math.min(step, Math.abs(gx - a.px));
        else if (a.py !== gy) a.py += Math.sign(gy - a.py) * Math.min(step, Math.abs(gy - a.py));
        if (a.px === gx && a.py === gy) { a.scriptMove = false; a.moving = false; }
        continue;
      }
      if (!allowMove || a.def.movement === 0) continue;
      if (a.moving) {
        const gx = a.tx * TILE, gy = a.ty * TILE;
        a.px += Math.sign(gx - a.px) * Math.min(step, Math.abs(gx - a.px));
        a.py += Math.sign(gy - a.py) * Math.min(step, Math.abs(gy - a.py));
        if (a.px === gx && a.py === gy) a.moving = false;
        continue;
      }
      a.timer++;
      if (a.timer < ACTOR_MOVE_INTERVAL) continue;
      a.timer = 0;
      let dx = 0, dy = 0;
      if (a.def.movement === 1) { // wander
        const d = this.rand(4);
        dx = d === 0 ? -1 : d === 1 ? 1 : 0;
        dy = d === 2 ? -1 : d === 3 ? 1 : 0;
      } else if (a.def.movement === 2) { dx = a.dir; }
      else if (a.def.movement === 3) { dy = a.dir; }
      const nx = a.tx + dx, ny = a.ty + dy;
      const pcx = Math.round(this.player.px / TILE), pcy = Math.round(this.player.py / TILE);
      const blocked = nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows ||
        this.tileSolid(nx, ny) || this.actorAt(nx, ny, i) >= 0 ||
        (nx === pcx && ny === pcy) || (nx === this.player.tx && ny === this.player.ty);
      if (blocked) {
        if (a.def.movement >= 2) a.dir = -a.dir;
        continue;
      }
      a.tx = nx; a.ty = ny; a.moving = true;
    }
  }

  // -------------------------------------------------------------- script VM

  // `s` is a script context: this.script for the blocking VM, or this.scratch
  // for an On Update script that must finish inside the frame.
  runScript(s) {
    if (s.wait > 0) { s.wait--; return; }
    if (s.waitFade) {
      if (this.fading()) return;
      s.waitFade = false;
    }
    if (s.waitOverlay) {
      if (this.overlayMoving()) return;
      s.waitOverlay = false;
    }
    if (s.waitActor >= 0) {
      const a = this.actors[s.waitActor];
      if (a && a.scriptMove) return; // still walking
      s.waitActor = -1;
    }
    if (s.waitInput) {
      // Blocked until one of the requested buttons is pressed.
      let hit = 0;
      for (let i = 0; i < NUM_BUTTONS; i++) {
        const bit = this.buttonBit(i);
        if ((s.waitInput & bit) && this.justPressed(bit)) { hit = bit; break; }
      }
      if (!hit) return;
      s.waitInput = 0;
    }
    if (this.menu) { this.updateMenu(); return; }
    if (this.text) { this.updateText(); return; }
    const code = this.g.code;
    let guard = 0;
    while (s.active && guard++ < 4096) {
      const op = code[s.pc++];
      switch (op) {
        case OP.END:
          s.active = false;
          break;
        case OP.TEXT: {
          const str = this.g.strings[code[s.pc++]];
          this.text = { str, pageStart: 0, shown: 0 };
          return;
        }
        case OP.SWITCH_SCENE: {
          const scene = code[s.pc++], x = code[s.pc++], y = code[s.pc++];
          this.loadScene(scene, x, y, true);
          if (s !== this.script) { s.active = false; return; } // update script: its actor is gone
          if (!this.script.active) return;
          break; // continue into the new scene's init scripts
        }
        case OP.SET_VAR: { const v = code[s.pc++]; this.vars[v] = code[s.pc++]; break; }
        case OP.ADD_VAR: {
          const v = code[s.pc++];
          const d = (code[s.pc++] << 24) >> 24; // sign-extend
          this.vars[v] = (this.vars[v] + d) & 0xff;
          break;
        }
        case OP.IF_VAR: {
          const v = this.vars[code[s.pc++]];
          const cmp = code[s.pc++], val = code[s.pc++];
          const elseAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          if (!compare(cmp, v, val)) s.pc = elseAddr;
          break;
        }
        case OP.JUMP: { s.pc = code[s.pc] | (code[s.pc + 1] << 8); break; }
        case OP.TONE: {
          const f = code[s.pc++] | (code[s.pc++] << 8);
          const frames = code[s.pc++];
          this.stopSong(); // a direct tone interrupts the current song
          this.onTone(f, Math.round(frames * 1000 / 60));
          break;
        }
        case OP.WAIT: { s.wait = code[s.pc++]; return; }
        case OP.ACTOR_HIDE: case OP.ACTOR_SHOW: {
          // For the player this is draw-only — it keeps moving and keeps firing
          // triggers, or a cutscene that hid it would strand the game.
          const a = this.refActor(code[s.pc++], s.self);
          if (a) a.hidden = (op === OP.ACTOR_HIDE);
          break;
        }
        case OP.SET_TILE: {
          const x = code[s.pc++], y = code[s.pc++], t = code[s.pc++];
          this.setTile(x, y, t);
          break;
        }
        case OP.PLAYER_POS: {
          const x = code[s.pc++], y = code[s.pc++];
          this.player.px = x * TILE; this.player.py = y * TILE;
          this.player.tx = x; this.player.ty = y;
          this.player.moving = false;
          this.armedTrigger = -1;
          break;
        }
        case OP.ACTOR_MOVE: {
          let idx = code[s.pc++];
          const x = code[s.pc++], y = code[s.pc++], flags = code[s.pc++];
          if (idx === 0xff) idx = s.self;
          if (idx < this.actors.length) {
            const a = this.actors[idx];
            a.tx = x; a.ty = y;
            if (flags & 1) { // instant
              a.px = x * TILE; a.py = y * TILE;
              a.moving = false; a.scriptMove = false;
            } else {
              a.scriptMove = true;
              s.waitActor = idx;
              return; // block until the actor arrives
            }
          }
          break;
        }
        case OP.PLAY_SONG: {
          const idx = code[s.pc++], flags = code[s.pc++];
          this.playSong(idx, !!(flags & 1));
          break;
        }
        case OP.STOP_SONG:
          this.stopSong();
          break;
        case OP.SAVE_GAME:
          this.saveGame();
          break;
        case OP.LOAD_GAME:
          if (this.loadGame()) {
            if (s !== this.script) { s.active = false; return; }
            if (!this.script.active) return;
            break; // continue into the loaded scene's init scripts
          }
          break; // no save — carry on with the current script
        case OP.SAVE_CHECK: {
          const v = code[s.pc++];
          this.vars[v] = this.saveExists() ? 1 : 0;
          break;
        }
        case OP.DELETE_SAVE:
          this.storage.clear();
          break;
        case OP.SET_LED: {
          const mode = code[s.pc++];
          const r = code[s.pc++], g = code[s.pc++], b = code[s.pc++];
          // Digital mode stores 0/1 per channel; show it at full brightness.
          this.led = mode === 1
            ? { mode: 'digital', r: r ? 255 : 0, g: g ? 255 : 0, b: b ? 255 : 0 }
            : { mode: 'analog', r, g, b };
          break;
        }
        case OP.SET_ACTOR_SPRITE: {
          const a = this.refActor(code[s.pc++], s.self);
          const spriteIdx = code[s.pc++];
          if (a) {
            a.spriteIdx = spriteIdx;
            // The new sprite may have fewer frames than the old one, so reseed
            // the playing range and pull the current frame back inside it.
            const last = this.spriteLastFrame(spriteIdx);
            a.animFrom = 0;
            a.animTo = last;
            if (a.frame > last) a.frame = 0;
          }
          break;
        }
        case OP.ATTACH_SCRIPT: {
          const btn = code[s.pc++];
          const flags = code[s.pc++];
          const scriptIdx = code[s.pc++];
          if (btn < NUM_BUTTONS) {
            this.buttonScript[btn] = scriptIdx;
            if (flags & ATTACH_OVERRIDE) this.buttonOverride |= 1 << btn;
            else this.buttonOverride &= ~(1 << btn);
          }
          break;
        }
        case OP.REMOVE_BUTTON_SCRIPT: {
          const btn = code[s.pc++];
          if (btn < NUM_BUTTONS) {
            this.buttonScript[btn] = NO_SCRIPT;
            this.buttonOverride &= ~(1 << btn);
          }
          break;
        }
        case OP.WAIT_INPUT:
          s.waitInput = code[s.pc++];
          return; // block until one of them is pressed
        case OP.IF_INPUT: {
          const mask = code[s.pc++];
          const elseAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          // Held right now — this checks once and never waits.
          if (!this.pressed(mask)) s.pc = elseAddr;
          break;
        }
        case OP.SET_ACTOR_DIR: {
          const ref = code[s.pc++];
          const dir = code[s.pc++];
          // The player stores its direction as the dx/dy it last walked rather
          // than a facing code, so write that instead — refFacing() reads it
          // back, and Launch Projectile aims by it.
          if (ref === ACTOR_REF_PLAYER) {
            const d = DIRECTIONS.find((v) => v.code === dir);
            if (d) { this.player.fx = d.dx; this.player.fy = d.dy; }
            break;
          }
          const a = this.refActor(ref, s.self);
          if (a) a.facing = dir;
          break;
        }
        case OP.SET_ACTOR_SPEED: {
          let idx = code[s.pc++];
          const speed = code[s.pc++];
          if (idx === 0xff) idx = s.self;
          if (idx < this.actors.length) {
            this.actors[idx].speed = speed;
            this.actors[idx].subTick = 0;
          }
          break;
        }
        case OP.ACTOR_EFFECT: {
          const a = this.refActor(code[s.pc++], s.self);
          const effect = code[s.pc++], frames = code[s.pc++];
          if (a) { a.effect = effect; a.effectFrames = frames; }
          break;
        }
        case OP.LAUNCH_PROJECTILE: {
          let src = code[s.pc++];
          const spriteIdx = code[s.pc++], dir = code[s.pc++];
          const speed = code[s.pc++], life = code[s.pc++], mask = code[s.pc++];
          if (src === PROJECTILE_SRC_SELF) src = s.self;
          if (src === PROJECTILE_SRC_PLAYER || src < this.actors.length) {
            this.launchProjectile(src, spriteIdx, dir, speed, life, mask);
          }
          break;
        }
        case OP.PUSH_SCENE: {
          const scene = code[s.pc++], x = code[s.pc++], y = code[s.pc++];
          const speed = code[s.pc++];
          if (this.sceneStack.length < SCENE_STACK_DEPTH) {
            this.sceneStack.push({
              scene: this.sceneIdx,
              x: Math.round(this.player.px / TILE),
              y: Math.round(this.player.py / TILE),
            });
          }
          this.loadScene(scene, x, y, true);
          this.fade.level = FADE_LEVELS;
          this.startFade(0, speed);
          if (s !== this.script) { s.active = false; return; }
          if (!this.script.active) return;
          break;
        }
        case OP.POP_SCENE: case OP.POP_ALL_SCENES: {
          const speed = code[s.pc++];
          if (!this.sceneStack.length) break; // nothing pushed — carry on
          const back = op === OP.POP_ALL_SCENES ? this.sceneStack[0] : this.sceneStack[this.sceneStack.length - 1];
          this.sceneStack.length = op === OP.POP_ALL_SCENES ? 0 : this.sceneStack.length - 1;
          this.loadScene(back.scene, back.x, back.y, true);
          this.fade.level = FADE_LEVELS;
          this.startFade(0, speed);
          if (s !== this.script) { s.active = false; return; }
          if (!this.script.active) return;
          break;
        }
        case OP.FADE_IN: case OP.FADE_OUT: {
          const speed = code[s.pc++];
          this.startFade(op === OP.FADE_OUT ? FADE_LEVELS : 0, speed);
          s.waitFade = true;
          return; // block until the fade finishes
        }
        case OP.IF_ACTOR_AT: {
          const ref = code[s.pc++];
          const x = code[s.pc++], y = code[s.pc++];
          const elseAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          const at = this.refTile(ref, s.self);
          if (!at || at.x !== x || at.y !== y) s.pc = elseAddr;
          break;
        }
        case OP.IF_ACTOR_DISTANCE: {
          const ref = code[s.pc++];
          const cmp = code[s.pc++];
          const distSq = code[s.pc++] | (code[s.pc++] << 8);
          const fromRef = code[s.pc++];
          const elseAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          const a = this.refTile(ref, s.self);
          const b = this.refTile(fromRef, s.self);
          let pass = false;
          if (a && b) {
            const dx = a.x - b.x, dy = a.y - b.y;
            pass = compare(cmp, dx * dx + dy * dy, distSq);
          }
          if (!pass) s.pc = elseAddr;
          break;
        }
        case OP.STORE_ACTOR_DIR: {
          const ref = code[s.pc++], v = code[s.pc++];
          this.vars[v] = this.refFacing(ref, s.self);
          break;
        }
        case OP.STORE_ACTOR_POS: {
          const ref = code[s.pc++], vx = code[s.pc++], vy = code[s.pc++];
          const at = this.refTile(ref, s.self);
          if (at) { this.vars[vx] = at.x; this.vars[vy] = at.y; }
          break;
        }
        case OP.EXPR_IF: {
          const len = code[s.pc++];
          const value = evalExpression(code, s.pc, len, this.vars, (n) => this.rand(n));
          s.pc += len;
          const elseAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          if (!value) s.pc = elseAddr;
          break;
        }
        case OP.EXPR_LOOP: {
          const len = code[s.pc++];
          const value = evalExpression(code, s.pc, len, this.vars, (n) => this.rand(n));
          s.pc += len;
          const endAddr = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          if (!value) s.pc = endAddr;
          break;
        }
        case OP.SEED_RNG:
          // On device this is Arduboy2::initRandomSeed(); here, anything the
          // player could not have predicted will do.
          this.rngState = (this.rngState ^ (this.frame * 2654435761) ^ Date.now()) >>> 0 || 1;
          break;
        case OP.SWITCH: {
          const v = this.vars[code[s.pc++]];
          const count = code[s.pc++];
          let target = -1;
          for (let i = 0; i < count; i++) {
            const at = s.pc + i * 3;
            if (code[at] === v && target < 0) target = code[at + 1] | (code[at + 2] << 8);
          }
          const elseAddr = code[s.pc + count * 3] | (code[s.pc + count * 3 + 1] << 8);
          s.pc = target >= 0 ? target : elseAddr;
          break;
        }
        case OP.SET_ANIM_FRAME: {
          const a = this.refActor(code[s.pc++], s.self);
          const frame = code[s.pc++];
          if (a) a.frame = Math.min(frame, this.spriteLastFrame(a.spriteIdx));
          break;
        }
        case OP.SET_ANIM_SPEED: {
          const a = this.refActor(code[s.pc++], s.self);
          const speed = code[s.pc++];
          if (a) { a.animSpeed = speed; a.anim = 0; }
          break;
        }
        case OP.SET_ANIM_STATE: {
          const a = this.refActor(code[s.pc++], s.self);
          const stateIdx = code[s.pc++], loop = code[s.pc++];
          if (a) {
            const states = this.g.sprites[a.spriteIdx].states;
            const st = states && states[stateIdx];
            if (st) {
              a.animFrom = st.from;
              a.animTo = st.to;
              a.animLoop = !!loop;
              a.frame = st.from;
              a.anim = 0;
              // An actor's rate comes from its definition; the player has none,
              // so give it the walk cycle's rate the first time a state is set —
              // otherwise the state would sit on its first frame forever.
              if (a === this.player && a.animSpeed === 0) a.animSpeed = PLAYER_ANIM_INTERVAL;
            }
          }
          break;
        }
        case OP.SHOW_OVERLAY: {
          const fill = code[s.pc++], x = code[s.pc++], y = code[s.pc++];
          this.overlay.on = true;
          this.overlay.fill = fill;
          this.overlay.px = this.overlay.tx = x * TILE;
          this.overlay.py = this.overlay.ty = y * TILE;
          this.overlay.speed = 0;
          break;
        }
        case OP.HIDE_OVERLAY:
          this.overlay.on = false;
          break;
        case OP.OVERLAY_MOVE: {
          const x = code[s.pc++], y = code[s.pc++], speed = code[s.pc++];
          this.overlay.tx = x * TILE;
          this.overlay.ty = y * TILE;
          this.overlay.speed = speed;
          if (!this.overlay.on || speed === 0) {
            this.overlay.px = this.overlay.tx;
            this.overlay.py = this.overlay.ty;
            break;
          }
          s.waitOverlay = true;
          return; // block until it arrives
        }
        case OP.OVERLAY_CUTOFF:
          this.overlayCutoff = code[s.pc++];
          break;
        case OP.DRAW_TEXT: {
          const strIdx = code[s.pc++], x = code[s.pc++], y = code[s.pc++];
          const location = code[s.pc++];
          // Same slot reused when text is redrawn at the same spot, so a script
          // that updates a counter every frame cannot exhaust the table.
          const at = this.drawnText.find((t) => t.x === x && t.y === y && t.location === location);
          if (at) at.strIdx = strIdx;
          else if (this.drawnText.length < MAX_DRAWN_TEXT) this.drawnText.push({ strIdx, x, y, location });
          break;
        }
        case OP.START_SCRIPT: {
          const idx = code[s.pc] | (code[s.pc + 1] << 8); s.pc += 2;
          const self = code[s.pc++];
          // Hand it to the blocking VM and keep going. The caller never waits,
          // which is what lets an On Update script begin something that pauses.
          this.queueScript(idx, self);
          break;
        }
        case OP.MENU: {
          const varIdx = code[s.pc++];
          const count = code[s.pc++];
          const flags = code[s.pc++];
          const labels = [];
          for (let i = 0; i < count; i++) labels.push(this.g.strings[code[s.pc++]]);
          this.menu = { varIdx, count, labels, sel: 0, flags };
          return; // block until the player chooses
        }
        default:
          s.active = false; // corrupt bytecode — bail out
      }
    }
  }

  // The current page as the player will read it, values already filled in.
  pageText(t) {
    return expandText(t.str.slice(t.pageStart, this.pageEnd(t)), this.vars);
  }

  updateText() {
    const t = this.text;
    const pageEnd = this.pageEnd(t);
    const pageLen = this.pageText(t).length;
    if (t.shown < pageLen) {
      t.shown = Math.min(pageLen, t.shown + TEXT_CHARS_PER_FRAME);
      if (this.justPressed(BTN.A) || this.justPressed(BTN.B)) t.shown = pageLen; // skip typewriter
      return;
    }
    if (this.justPressed(BTN.A)) {
      if (pageEnd >= t.str.length) {
        this.text = null; // dialogue finished, resume script next frame
      } else {
        t.pageStart = pageEnd + 1; // skip '\f'
        t.shown = 0;
      }
    }
  }

  pageEnd(t) {
    const i = t.str.indexOf('\f', t.pageStart);
    return i < 0 ? t.str.length : i;
  }

  // ------------------------------------------------------------------- menu

  // Rows per column: the dialogue layout is two columns of 4, the menu layout
  // is a single column.
  menuRows(m) {
    return (m.flags & MENU_LAYOUT_DIALOGUE) ? Math.min(4, Math.ceil(m.count / 2)) : m.count;
  }

  // Value a given option yields: 1-based, unless it is the last option and the
  // script asked for the last option to mean 0.
  menuValue(m, i) {
    return ((m.flags & MENU_LAST_IS_ZERO) && i === m.count - 1) ? 0 : i + 1;
  }

  closeMenu(value) {
    this.vars[this.menu.varIdx] = value;
    this.menu = null;
  }

  updateMenu() {
    const m = this.menu;
    const rows = this.menuRows(m);
    if (this.justPressed(BTN.UP)) m.sel = (m.sel + m.count - 1) % m.count;
    else if (this.justPressed(BTN.DOWN)) m.sel = (m.sel + 1) % m.count;
    else if (m.flags & MENU_LAYOUT_DIALOGUE) {
      // Left/right hop between the two columns.
      if (this.justPressed(BTN.LEFT)) m.sel = (m.sel + m.count - rows) % m.count;
      else if (this.justPressed(BTN.RIGHT)) m.sel = (m.sel + rows) % m.count;
    }
    if (this.justPressed(BTN.A)) {
      this.closeMenu(this.menuValue(m, m.sel));
      return;
    }
    if ((m.flags & MENU_CANCEL_B) && this.justPressed(BTN.B)) {
      this.closeMenu(0);
    }
  }

  drawMenu() {
    const m = this.menu;
    const rows = this.menuRows(m);
    if (m.flags & MENU_LAYOUT_DIALOGUE) {
      // Full-width box at the bottom, two columns of up to 4 rows.
      this.fillRect(0, 30, W, 34, 0);
      this.drawRectOutline(0, 30, W, 34, 1);
      for (let i = 0; i < m.count; i++) {
        const col = Math.floor(i / rows), row = i % rows;
        const x = 4 + col * 62, y = 32 + row * 8;
        if (i === m.sel) this.drawText(x, y, '>');
        this.drawText(x + 6, y, m.labels[i]);
      }
    } else {
      // Single column down the right-hand side.
      const h = Math.min(H, m.count * 8 + 2);
      this.fillRect(64, 0, 64, h, 0);
      this.drawRectOutline(64, 0, 64, h, 1);
      for (let i = 0; i < m.count; i++) {
        const y = 1 + i * 8;
        if (i === m.sel) this.drawText(67, y, '>');
        this.drawText(73, y, m.labels[i]);
      }
    }
  }

  // ------------------------------------------------------------------- draw

  px(x, y, on) {
    if (x >= 0 && x < W && y >= 0 && y < H) this.fb[y * W + x] = on;
  }

  drawBytesOverwrite(x0, y0, bytes, w, h) {
    const pages = Math.ceil(h / 8);
    for (let page = 0; page < pages; page++) {
      for (let x = 0; x < w; x++) {
        const b = bytes[page * w + x];
        for (let bit = 0; bit < 8 && page * 8 + bit < h; bit++) {
          this.px(x0 + x, y0 + page * 8 + bit, (b >> bit) & 1);
        }
      }
    }
  }

  drawBytesMasked(x0, y0, bytes, w, h) {
    const pages = Math.ceil(h / 8);
    for (let page = 0; page < pages; page++) {
      for (let x = 0; x < w; x++) {
        const b = bytes[page * w + x];
        for (let bit = 0; bit < 8 && page * 8 + bit < h; bit++) {
          if ((b >> bit) & 1) this.px(x0 + x, y0 + page * 8 + bit, 1);
        }
      }
    }
  }

  fillRect(x, y, w, h, on) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, on);
  }

  drawRectOutline(x, y, w, h, on) {
    for (let i = 0; i < w; i++) { this.px(x + i, y, on); this.px(x + i, y + h - 1, on); }
    for (let j = 0; j < h; j++) { this.px(x, y + j, on); this.px(x + w - 1, y + j, on); }
  }

  drawChar(x, y, ch) {
    const c = ch.charCodeAt(0) & 0xff;
    for (let col = 0; col < 5; col++) {
      const bits = FONT5X7[c * 5 + col];
      for (let row = 0; row < 7; row++) {
        if ((bits >> row) & 1) this.px(x + col, y + row, 1);
      }
    }
  }

  // Draw characters exactly as given, with no marker expansion.
  drawChars(x, y, str) {
    let cx = x, cy = y;
    for (const ch of str) {
      if (ch === '\n') { cx = x; cy += 8; continue; }
      this.drawChar(cx, cy, ch);
      cx += 6;
    }
  }

  drawText(x, y, str) {
    this.drawChars(x, y, expandText(str, this.vars));
  }

  draw() {
    this.fb.fill(0);
    const tx0 = Math.floor(this.camX / TILE);
    const ty0 = Math.floor(this.camY / TILE);
    const tx1 = Math.min(this.cols - 1, Math.floor((this.camX + W - 1) / TILE));
    const ty1 = Math.min(this.rows - 1, Math.floor((this.camY + H - 1) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.g.tiles[this.tileAt(tx, ty)];
        if (t) this.drawBytesOverwrite(tx * TILE - this.camX, ty * TILE - this.camY, t.bytes, 8, 8);
      }
    }
    this.drawTexts(DRAW_TEXT_BACKGROUND);
    for (const a of this.actors) {
      if (a.hidden) continue;
      // Flicker blanks the actor on alternate pairs of frames; shake jitters it
      // one pixel sideways. Both are pure draw-time effects.
      if (a.effect === 1 && ((this.frame >> 1) & 1)) continue;
      const shake = a.effect === 2 ? ((this.frame & 1) ? 1 : -1) : 0;
      const spr = this.g.sprites[a.spriteIdx];
      const f = spr.frames[Math.min(a.frame, spr.frames.length - 1)];
      this.drawBytesMasked(Math.round(a.px) + shake - this.camX, Math.round(a.py) - this.camY, f, spr.width, spr.height);
    }
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const spr = this.g.sprites[p.spriteIdx];
      if (!spr) continue;
      this.drawBytesMasked(Math.round(p.px) - this.camX, Math.round(p.py) - this.camY, spr.frames[0], spr.width, spr.height);
    }
    // The player takes the same hidden/flicker/shake treatment as an actor, and
    // draws from its own sprite so Set Actor Sprite can swap it at runtime.
    const p = this.player;
    const pspr = this.g.sprites[p.spriteIdx];
    if (pspr && !p.hidden && !(p.effect === 1 && ((this.frame >> 1) & 1))) {
      const shake = p.effect === 2 ? ((this.frame & 1) ? 1 : -1) : 0;
      const f = pspr.frames[Math.min(p.frame, pspr.frames.length - 1)];
      this.drawBytesMasked(Math.round(p.px) + shake - this.camX, Math.round(p.py) - this.camY, f, pspr.width, pspr.height);
    }
    this.applyFade();
    this.drawOverlay();
    this.drawTexts(DRAW_TEXT_OVERLAY);
    if (this.text) this.drawTextbox();
    if (this.menu) this.drawMenu();
  }

  spriteLastFrame(idx) {
    const spr = this.g.sprites[idx];
    return spr ? spr.frames.length - 1 : 0;
  }

  // The overlay panel covers everything below and right of its corner, and is
  // clipped by the scanline cutoff so it can be used as a top-of-screen band.
  drawOverlay() {
    if (!this.overlay.on) return;
    const x = Math.round(this.overlay.px);
    const y = Math.round(this.overlay.py);
    const bottom = Math.min(H, this.overlayCutoff);
    if (y >= bottom) return;
    this.fillRect(x, y, W - x, bottom - y, this.overlay.fill);
  }

  // Background text scrolls with the camera; overlay text is fixed to the
  // screen and drawn on top of the panel.
  drawTexts(location) {
    for (const t of this.drawnText) {
      if (t.location !== location) continue;
      const str = this.g.strings[t.strIdx];
      if (str === undefined) continue;
      if (location === DRAW_TEXT_OVERLAY) {
        if (t.y >= this.overlayCutoff) continue;
        this.drawText(t.x, t.y, str);
      } else {
        this.drawText(t.x - this.camX, t.y - this.camY, str);
      }
    }
  }

  // Overlay Move To animates towards its target; the script waits for arrival.
  updateOverlay() {
    const o = this.overlay;
    if (!o.on) return;
    if (o.speed === 0) { o.px = o.tx; o.py = o.ty; return; }
    o.px += Math.sign(o.tx - o.px) * Math.min(o.speed, Math.abs(o.tx - o.px));
    o.py += Math.sign(o.ty - o.py) * Math.min(o.speed, Math.abs(o.ty - o.py));
  }

  overlayMoving() {
    const o = this.overlay;
    return o.on && (o.px !== o.tx || o.py !== o.ty);
  }

  // Ordered dither over the whole scene. Dialogue and menus are drawn after
  // this so a fade never swallows the text the player is reading.
  applyFade() {
    const level = this.fade.level;
    if (level <= 0) return;
    if (level >= FADE_LEVELS) { this.fb.fill(0); return; }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (BAYER4[(y & 3) * 4 + (x & 3)] < level) this.fb[y * W + x] = 0;
      }
    }
  }

  drawTextbox() {
    const t = this.text;
    if (this.overlayCutoff <= 38) return; // cut off above the dialogue box
    this.fillRect(0, 38, W, 26, 0);
    this.drawRectOutline(0, 38, W, 26, 1);
    const pageEnd = this.pageEnd(t);
    const page = this.pageText(t);
    // Already expanded, so draw it directly — drawText would expand twice.
    this.drawChars(4, 40, page.slice(0, t.shown));
    if (t.shown >= page.length && (this.frame >> 4) & 1) {
      // blinking "more" arrow
      this.px(122, 59, 1); this.px(123, 59, 1); this.px(124, 59, 1);
      this.px(123, 60, 1);
    }
  }

  // Render framebuffer into a canvas 2D context at integer scale.
  blit(ctx, scale, colors = { on: '#d8ecff', off: '#0d1117' }) {
    const canvas = ctx.canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.off;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.on;
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (this.fb[y * W + x]) {
          let run = x;
          while (run < W && this.fb[y * W + run]) run++;
          ctx.fillRect(x * scale, y * scale, (run - x) * scale, scale);
          x = run;
        } else x++;
      }
    }
  }
}
