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

export class Emulator {
  constructor(compiled, opts = {}) {
    this.g = compiled;
    this.onTone = opts.onTone || (() => {});
    this.fb = new Uint8Array(W * H);
    this.buttons = 0;
    this.prevButtons = 0;
    this.frame = 0;
    this.rngState = 0xdead4a11;
    this.reset();
  }

  reset() {
    this.vars = new Uint8Array(32);
    this.script = { active: false, pc: 0, self: 0xff, wait: 0 };
    this.text = null; // { str, pageStart, shown, done }
    this.armedTrigger = -1;
    this.frame = 0;
    this.player = { px: this.g.startX * TILE, py: this.g.startY * TILE, tx: 0, ty: 0, moving: false, fx: 0, fy: 1, frame: 0, anim: 0 };
    this.loadScene(this.g.startScene, this.g.startX, this.g.startY, true);
  }

  rand(n) {
    // xorshift32 — quality doesn't matter, only liveliness
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
    this.ramTiles = Uint8Array.from(sc.tiles);
    this.actors = sc.actors.map((a) => ({
      def: a,
      px: a.x * TILE, py: a.y * TILE,
      tx: a.x, ty: a.y,
      moving: false, hidden: false,
      dir: 1, timer: this.rand(ACTOR_MOVE_INTERVAL),
      frame: 0, anim: this.rand(ANIM_INTERVAL),
    }));
    this.player.px = px * TILE; this.player.py = py * TILE;
    this.player.tx = px; this.player.ty = py;
    this.player.moving = false;
    this.armedTrigger = -1;
    this.text = null;
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
    this.text = null;
  }

  setButtons(mask) { this.buttons = mask; }

  justPressed(b) { return (this.buttons & b) && !(this.prevButtons & b); }
  pressed(b) { return (this.buttons & b) !== 0; }

  tileAt(x, y) { return this.ramTiles[y * SCENE_W + x]; }
  tileSolid(x, y) {
    if (x < 0 || x >= SCENE_W || y < 0 || y >= SCENE_H) return true;
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

  // ------------------------------------------------------------------ update

  step() {
    this.frame++;

    if (this.script.active) {
      this.runScript();
    } else {
      this.updatePlayer();
      this.checkTriggers();
    }
    this.updateActors(!this.script.active);

    this.prevButtons = this.buttons;
    this.draw();
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
      if (nx >= 0 && nx < SCENE_W && ny >= 0 && ny < SCENE_H &&
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
      const blocked = nx < 0 || nx >= SCENE_W || ny < 0 || ny >= SCENE_H ||
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
          this.text = { str, pageStart: 0, shown: 0, pageDone: false };
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
          this.onTone(f, frames);
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
          this.ramTiles[y * SCENE_W + x] = t;
          break;
        }
        case OP.PLAYER_POS: {
          const x = code[s.pc++], y = code[s.pc++];
          this.player.px = x * TILE; this.player.py = y * TILE;
          this.player.moving = false;
          this.armedTrigger = -1;
          break;
        }
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
    for (let ty = 0; ty < SCENE_H; ty++) {
      for (let tx = 0; tx < SCENE_W; tx++) {
        const t = this.g.tiles[this.ramTiles[ty * SCENE_W + tx]];
        if (t) this.drawBytesOverwrite(tx * TILE, ty * TILE, t.bytes, 8, 8);
      }
    }
    for (const a of this.actors) {
      if (a.hidden) continue;
      const spr = this.g.sprites[a.def.spriteIdx];
      const f = spr.frames[Math.min(a.frame, spr.frames.length - 1)];
      this.drawBytesMasked(Math.round(a.px), Math.round(a.py), f, spr.width, spr.height);
    }
    const pspr = this.g.sprites[this.g.playerSpriteIdx];
    if (pspr) {
      const f = pspr.frames[Math.min(this.player.frame, pspr.frames.length - 1)];
      this.drawBytesMasked(Math.round(this.player.px), Math.round(this.player.py), f, pspr.width, pspr.height);
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
