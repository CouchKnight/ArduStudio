// In-browser play-test runtime. Mirrors the generated Arduboy engine
// byte-for-byte: it executes the same compiled bytecode, uses the real
// Arduboy2 font, and follows the same update order, so browser behaviour
// matches the device.

import { SCENE_W, SCENE_H, TILE } from './model.js';
import { OP, NO_SCRIPT } from './compiler.js';
import { FONT5X7 } from './font5x7.js';

export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, A: 16, B: 32 };

const W = 128, H = 64;
const PLAYER_SPEED = 2;   // px per frame (8px tile / 2 = 4 frames per step)
const ACTOR_SPEED = 1;
const ACTOR_MOVE_INTERVAL = 48; // frames between AI steps
const ANIM_INTERVAL = 20;       // frames between animation frames
const TEXT_CHARS_PER_FRAME = 2;
const MAX_TILE_OVERRIDES = 16;  // matches the C++ engine's RAM override table

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
    this.script = { active: false, pc: 0, self: 0xff, wait: 0, waitActor: -1 };
    this.text = null; // { str, pageStart, shown }
    this.armedTrigger = -1;
    this.frame = 0;
    this.song = { idx: -1, pos: 0, framesLeft: 0, loop: false };
    this.camX = 0; this.camY = 0;
    this.player = { px: this.g.startX * TILE, py: this.g.startY * TILE, tx: 0, ty: 0, moving: false, fx: 0, fy: 1, frame: 0, anim: 0 };
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
      px: a.x * TILE, py: a.y * TILE,
      tx: a.x, ty: a.y,
      moving: false, hidden: false,
      scriptMove: false,
      dir: 1, timer: this.rand(ACTOR_MOVE_INTERVAL),
      frame: 0, anim: this.rand(ANIM_INTERVAL),
    }));
    this.player.px = px * TILE; this.player.py = py * TILE;
    this.player.tx = px; this.player.ty = py;
    this.player.moving = false;
    this.armedTrigger = -1;
    this.text = null;
    this.script.waitActor = -1;
    if (runEnter && sc.onEnterIdx !== NO_SCRIPT) {
      this.startScript(sc.onEnterIdx, 0xff);
    } else {
      this.script.active = false;
    }
  }

  startScript(scriptIdx, selfActor) {
    this.script.active = true;
    this.script.pc = this.g.scriptOffsets[scriptIdx];
    this.script.self = selfActor;
    this.script.wait = 0;
    this.script.waitActor = -1;
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

    if (this.script.active) {
      this.runScript();
    } else {
      this.updatePlayer();
      this.checkTriggers();
    }
    this.updateActors(!this.script.active);
    this.updateCamera();

    this.prevButtons = this.buttons;
    this.draw();
  }

  updateCamera() {
    const maxX = this.cols * TILE - W;
    const maxY = this.rows * TILE - H;
    this.camX = Math.max(0, Math.min(maxX, this.player.px - (W / 2 - TILE / 2)));
    this.camY = Math.max(0, Math.min(maxY, this.player.py - (H / 2 - TILE / 2)));
  }

  updatePlayer() {
    const p = this.player;
    if (p.moving) {
      const gx = p.tx * TILE, gy = p.ty * TILE;
      p.px += Math.sign(gx - p.px) * Math.min(PLAYER_SPEED, Math.abs(gx - p.px));
      p.py += Math.sign(gy - p.py) * Math.min(PLAYER_SPEED, Math.abs(gy - p.py));
      p.anim++;
      if (p.anim % 8 === 0) p.frame ^= 1;
      if (p.px === gx && p.py === gy) p.moving = false;
      return;
    }
    let dx = 0, dy = 0;
    if (this.pressed(BTN.LEFT)) dx = -1;
    else if (this.pressed(BTN.RIGHT)) dx = 1;
    else if (this.pressed(BTN.UP)) dy = -1;
    else if (this.pressed(BTN.DOWN)) dy = 1;

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

    if (this.justPressed(BTN.A)) {
      const fx = Math.round(p.px / TILE) + p.fx;
      const fy = Math.round(p.py / TILE) + p.fy;
      const ai = this.actorAt(fx, fy, -1);
      if (ai >= 0) {
        const def = this.actors[ai].def;
        if (def.scriptIdx !== NO_SCRIPT) this.startScript(def.scriptIdx, ai);
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
    if (hit < 0) { this.armedTrigger = -1; return; }
    if (hit !== this.armedTrigger) {
      this.armedTrigger = hit;
      const t = sc.triggers[hit];
      if (t.scriptIdx !== NO_SCRIPT) this.startScript(t.scriptIdx, 0xff);
    }
  }

  updateActors(allowMove) {
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.hidden) continue;
      if (a.def.animate && this.g.sprites[a.def.spriteIdx].frames.length > 1) {
        a.anim++;
        if (a.anim >= ANIM_INTERVAL) { a.anim = 0; a.frame = (a.frame + 1) % this.g.sprites[a.def.spriteIdx].frames.length; }
      }
      // A scripted Move Actor walks even while the script runs, straight to
      // its target (x first, then y), ignoring collisions.
      if (a.scriptMove) {
        const gx = a.tx * TILE, gy = a.ty * TILE;
        if (a.px !== gx) a.px += Math.sign(gx - a.px) * Math.min(ACTOR_SPEED, Math.abs(gx - a.px));
        else if (a.py !== gy) a.py += Math.sign(gy - a.py) * Math.min(ACTOR_SPEED, Math.abs(gy - a.py));
        if (a.px === gx && a.py === gy) { a.scriptMove = false; a.moving = false; }
        continue;
      }
      if (!allowMove || a.def.movement === 0) continue;
      if (a.moving) {
        const gx = a.tx * TILE, gy = a.ty * TILE;
        a.px += Math.sign(gx - a.px) * Math.min(ACTOR_SPEED, Math.abs(gx - a.px));
        a.py += Math.sign(gy - a.py) * Math.min(ACTOR_SPEED, Math.abs(gy - a.py));
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

  runScript() {
    const s = this.script;
    if (s.wait > 0) { s.wait--; return; }
    if (s.waitActor >= 0) {
      const a = this.actors[s.waitActor];
      if (a && a.scriptMove) return; // still walking
      s.waitActor = -1;
    }
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
          if (!this.script.active) return;
          break; // continue into the new scene's onEnter script
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
          const pass = cmp === 0 ? v === val : cmp === 1 ? v !== val :
            cmp === 2 ? v < val : cmp === 3 ? v > val :
            cmp === 4 ? v <= val : v >= val;
          if (!pass) s.pc = elseAddr;
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
          let idx = code[s.pc++];
          if (idx === 0xff) idx = s.self;
          if (idx < this.actors.length) this.actors[idx].hidden = (op === OP.ACTOR_HIDE);
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
            if (!this.script.active) return;
            break; // continue into the loaded scene's onEnter script
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
        default:
          s.active = false; // corrupt bytecode — bail out
      }
    }
  }

  updateText() {
    const t = this.text;
    const pageEnd = this.pageEnd(t);
    if (t.shown < pageEnd - t.pageStart) {
      t.shown = Math.min(pageEnd - t.pageStart, t.shown + TEXT_CHARS_PER_FRAME);
      if (this.justPressed(BTN.A) || this.justPressed(BTN.B)) t.shown = pageEnd - t.pageStart; // skip typewriter
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

  drawText(x, y, str) {
    let cx = x, cy = y;
    for (const ch of str) {
      if (ch === '\n') { cx = x; cy += 8; continue; }
      this.drawChar(cx, cy, ch);
      cx += 6;
    }
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
    for (const a of this.actors) {
      if (a.hidden) continue;
      const spr = this.g.sprites[a.def.spriteIdx];
      const f = spr.frames[Math.min(a.frame, spr.frames.length - 1)];
      this.drawBytesMasked(Math.round(a.px) - this.camX, Math.round(a.py) - this.camY, f, spr.width, spr.height);
    }
    const pspr = this.g.sprites[this.g.playerSpriteIdx];
    if (pspr) {
      const f = pspr.frames[Math.min(this.player.frame, pspr.frames.length - 1)];
      this.drawBytesMasked(Math.round(this.player.px) - this.camX, Math.round(this.player.py) - this.camY, f, pspr.width, pspr.height);
    }
    if (this.text) this.drawTextbox();
  }

  drawTextbox() {
    const t = this.text;
    this.fillRect(0, 38, W, 26, 0);
    this.drawRectOutline(0, 38, W, 26, 1);
    const pageEnd = this.pageEnd(t);
    const visible = t.str.slice(t.pageStart, t.pageStart + t.shown);
    this.drawText(4, 40, visible);
    if (t.shown >= pageEnd - t.pageStart && (this.frame >> 4) & 1) {
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
