// Play tab: runs the compiled project in the Emulator at 60fps with
// keyboard input, WebAudio square-wave tones and a live variable watch.

import { el, clear } from './ui.js';
import { compileProject } from './compiler.js';
import { Emulator, BTN, SAVE_SIZE } from './emulator.js';

// Stand-in for the Arduboy's EEPROM: save games persist across play sessions
// and page reloads, exactly like they would on hardware.
const EEPROM_KEY = 'ardustudio.eeprom.v1';

function eepromStorage() {
  return {
    read() {
      try {
        const raw = localStorage.getItem(EEPROM_KEY);
        if (!raw) return null;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) && arr.length >= SAVE_SIZE ? Uint8Array.from(arr) : null;
      } catch { return null; }
    },
    write(bytes) {
      try { localStorage.setItem(EEPROM_KEY, JSON.stringify(Array.from(bytes))); } catch { /* storage full */ }
    },
    clear() {
      try { localStorage.removeItem(EEPROM_KEY); } catch { /* ignore */ }
    },
  };
}

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

  // The emulator reports tones as (frequency Hz, duration ms).
  function tone(freq, ms) {
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
      osc.start();
      osc.stop(audio.currentTime + ms / 1000);
    } catch { /* audio unavailable — play silently */ }
  }

  function rebuild() {
    try {
      compiled = compileProject(app.project);
      emu = new Emulator(compiled, { onTone: tone, storage: eepromStorage() });
      warnBox.textContent = compiled.warnings.join('\n');
      // Debug hook: inspect the running game from the console (or tests).
      window.__ardustudio_emu = emu;
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

  const ledDot = document.getElementById('ledDot');
  const ledLabel = document.getElementById('ledLabel');
  let lastLed = '';

  function updateLed() {
    if (!emu) return;
    const { mode, r, g, b } = emu.led;
    const key = `${mode}:${r},${g},${b}`;
    if (key === lastLed) return;
    lastLed = key;
    ledDot.style.background = `rgb(${r}, ${g}, ${b})`;
    // Glow so a lit LED reads at a glance against the dark shell.
    ledDot.style.boxShadow = (r || g || b) ? `0 0 10px rgb(${r}, ${g}, ${b})` : 'none';
    ledLabel.textContent = (r || g || b)
      ? `LED ${mode === 'digital' ? 'digital' : `${r},${g},${b}`}`
      : 'LED off';
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
      updateLed();
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
  document.getElementById('playWipe').addEventListener('click', () => {
    eepromStorage().clear();
    if (emu) emu.storage = eepromStorage();
    warnBox.textContent = 'Emulated EEPROM save erased.';
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
