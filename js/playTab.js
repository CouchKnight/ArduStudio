// Play tab: runs the compiled project in the Emulator at 60fps with
// keyboard input, WebAudio square-wave tones and a live variable watch.

import { el, clear } from './ui.js';
import { compileProject } from './compiler.js';
import { Emulator, BTN } from './emulator.js';

const KEYMAP = {
  ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT, ArrowUp: BTN.UP, ArrowDown: BTN.DOWN,
  KeyZ: BTN.A, Space: BTN.A, Enter: BTN.A,
  KeyX: BTN.B, ShiftLeft: BTN.B, ShiftRight: BTN.B,
};

export function initPlayTab(app) {
  const canvas = document.getElementById('playCanvas');
  const ctx = canvas.getContext('2d');
  const warnBox = document.getElementById('playWarnings');
  const varTable = document.getElementById('varWatch');
  const soundChk = document.getElementById('playSound');

  let emu = null;
  let compiled = null;
  let buttons = 0;
  let raf = 0;
  let paused = false;
  let last = 0;
  let acc = 0;
  let audio = null;

  function tone(freq, frames) {
    if (!soundChk.checked) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(audio.destination);
      const dur = frames / 60;
      osc.start();
      osc.stop(audio.currentTime + dur);
    } catch { /* audio unavailable — play silently */ }
  }

  function rebuild() {
    try {
      compiled = compileProject(app.project);
      emu = new Emulator(compiled, { onTone: tone });
      warnBox.textContent = compiled.warnings.join('\n');
    } catch (err) {
      compiled = null;
      emu = null;
      warnBox.textContent = 'Cannot start: ' + err.message;
    }
    renderVars();
  }

  function renderVars() {
    clear(varTable);
    if (!emu || !compiled) return;
    compiled.varNames.forEach((name, i) => {
      varTable.append(el('tr', {}, el('td', {}, name), el('td', { dataset: { varIdx: i } }, String(emu.vars[i]))));
    });
  }

  function updateVars() {
    if (!emu) return;
    varTable.querySelectorAll('td[data-var-idx]').forEach((td) => {
      td.textContent = String(emu.vars[parseInt(td.dataset.varIdx, 10)]);
    });
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!emu || paused) return;
    if (!last) last = ts;
    acc += Math.min(100, ts - last);
    last = ts;
    const STEP = 1000 / 60;
    let stepped = false;
    while (acc >= STEP) {
      emu.setButtons(buttons);
      emu.step();
      acc -= STEP;
      stepped = true;
    }
    if (stepped) {
      emu.blit(ctx, 4);
      updateVars();
    }
  }

  canvas.addEventListener('keydown', (e) => {
    const b = KEYMAP[e.code];
    if (b) { buttons |= b; e.preventDefault(); }
  });
  canvas.addEventListener('keyup', (e) => {
    const b = KEYMAP[e.code];
    if (b) { buttons &= ~b; e.preventDefault(); }
  });
  canvas.addEventListener('blur', () => { buttons = 0; });
  canvas.addEventListener('click', () => canvas.focus());

  document.getElementById('playStart').addEventListener('click', () => {
    rebuild();
    paused = false;
    document.getElementById('playPause').textContent = '⏸ Pause';
    canvas.focus();
  });
  document.getElementById('playPause').addEventListener('click', (e) => {
    paused = !paused;
    e.target.textContent = paused ? '▶ Resume' : '⏸ Pause';
    canvas.focus();
  });

  function refresh() {
    // called when the Play tab becomes active — rebuild from latest project
    rebuild();
    paused = false;
    document.getElementById('playPause').textContent = '⏸ Pause';
    if (!raf) raf = requestAnimationFrame(frame);
    setTimeout(() => canvas.focus(), 50);
  }

  function suspend() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; acc = 0; }
    buttons = 0;
  }

  return { refresh, suspend };
}
