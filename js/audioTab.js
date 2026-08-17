// Audio tab: compose ArduboyTones sequences (songs + sound effects),
// preview them in the browser, and import/export them as JSON or as
// ready-to-paste ArduboyTones C code.

import { el, clear, download } from './ui.js';
import {
  makeSong, NOTE_NAMES, noteFreq, SONG_PRESETS,
  MAX_SONGS, MAX_SONG_NOTES,
} from './model.js';

export function initAudioTab(app) {
  let selected = 0;
  let audio = null;
  let previewNodes = [];

  function ensureAudio() {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function stopPreview() {
    for (const n of previewNodes) { try { n.stop(); } catch { /* already stopped */ } }
    previewNodes = [];
  }

  function playNotes(notes, from = 0) {
    stopPreview();
    const ctx = ensureAudio();
    let t = ctx.currentTime + 0.03;
    for (let i = from; i < notes.length; i++) {
      const n = notes[i];
      if (n.f > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = n.f;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + n.d / 1000);
        previewNodes.push(osc);
      }
      t += n.d / 1000;
    }
  }

  function song() { return app.project.songs[selected]; }

  // ------------------------------------------------------------------ list

  function renderList() {
    const ul = clear(document.getElementById('songList'));
    app.project.songs.forEach((s, i) => {
      ul.append(el('li', {
        class: i === selected ? 'active' : '',
        onclick: () => { selected = i; refresh(); },
      },
        el('span', {}, `${s.name} (${s.notes.length})`),
        // A song no Play Song event names is left out of the build; this keeps
        // it in anyway.
        el('label', { class: 'hint', title: 'Include in the exported game even if no event plays it' },
          el('input', {
            type: 'checkbox', checked: !!s.keep,
            onchange: (e) => { s.keep = e.target.checked; app.save(); },
          }), ' keep'),
        el('button', {
          class: 'mini', title: 'Delete song',
          onclick: (e) => {
            e.stopPropagation();
            if (!confirm(`Delete song "${s.name}"? Play Song events using it will be skipped at export.`)) return;
            app.project.songs.splice(i, 1);
            selected = Math.max(0, selected - 1);
            app.save();
            refresh();
          },
        }, '✕'),
      ));
    });
    if (!app.project.songs.length) {
      ul.append(el('li', {}, el('span', { class: 'hint' }, 'No songs yet — add one or pick a preset.')));
    }
  }

  function renderPresets() {
    const box = clear(document.getElementById('songPresets'));
    for (const preset of SONG_PRESETS) {
      box.append(el('div', { class: 'form-row' },
        el('button', {
          class: 'btn', style: 'flex:1',
          onclick: () => {
            if (app.project.songs.length >= MAX_SONGS) { alert(`Max ${MAX_SONGS} songs`); return; }
            const s = makeSong(preset.name);
            s.notes = preset.notes.map((n) => ({ ...n }));
            app.project.songs.push(s);
            selected = app.project.songs.length - 1;
            app.save();
            refresh();
            playNotes(s.notes);
          },
        }, preset.name),
        el('button', { class: 'mini', title: 'Preview', onclick: () => playNotes(preset.notes) }, '▶'),
      ));
    }
  }

  // ---------------------------------------------------------------- editor

  function renderEditor() {
    const box = clear(document.getElementById('songEditor'));
    const s = song();
    if (!s) {
      box.append(el('div', { class: 'panel' },
        el('p', { class: 'hint' }, 'Add a song (＋) or start from a preset, then use Play Song events in your scripts.')));
      return;
    }

    const head = el('div', { class: 'panel' },
      el('div', { class: 'form-row' },
        el('label', {}, 'Name ', el('input', {
          type: 'text', value: s.name,
          onchange: (e) => { s.name = e.target.value; app.save(); renderList(); },
        })),
        el('button', { class: 'btn primary', onclick: () => playNotes(s.notes) }, '▶ Play'),
        el('button', { class: 'btn', onclick: stopPreview }, '⏹ Stop'),
        el('span', { class: 'hint' }, `${s.notes.length}/${MAX_SONG_NOTES} notes · ${(s.notes.reduce((n, x) => n + x.d, 0) / 1000).toFixed(1)}s`),
      ),
    );
    box.append(head);

    // note rows
    const table = el('div', { class: 'panel' });
    table.append(el('div', { class: 'panel-title' }, 'Notes'));
    s.notes.forEach((n, i) => {
      const noteSel = el('select', {
        onchange: () => {
          n.f = noteSel.value === 'rest' ? 0 : noteSel.value === 'hz' ? n.f || 440 : noteFreq(noteSel.value);
          app.save();
          renderEditor();
        },
      });
      noteSel.append(el('option', { value: 'rest', selected: n.f === 0 }, 'rest'));
      let matched = n.f === 0;
      for (let oct = 2; oct <= 7; oct++) {
        for (const name of NOTE_NAMES) {
          const nm = name + oct;
          const isSel = n.f === noteFreq(nm);
          if (isSel) matched = true;
          noteSel.append(el('option', { value: nm, selected: isSel }, nm));
        }
      }
      noteSel.append(el('option', { value: 'hz', selected: !matched }, `raw: ${n.f} Hz`));

      table.append(el('div', { class: 'form-row' },
        el('span', { class: 'hint', style: 'width:26px;text-align:right' }, `${i + 1}.`),
        noteSel,
        el('label', {}, 'Hz', el('input', {
          type: 'number', min: 0, max: 32767, value: n.f, style: 'width:80px',
          onchange: (e) => { n.f = Math.max(0, Math.min(32767, parseInt(e.target.value, 10) || 0)); app.save(); renderEditor(); },
        })),
        el('label', {}, 'ms', el('input', {
          type: 'number', min: 1, max: 65535, value: n.d, style: 'width:80px',
          onchange: (e) => { n.d = Math.max(1, Math.min(65535, parseInt(e.target.value, 10) || 100)); app.save(); renderEditor(); },
        })),
        el('button', { class: 'mini', title: 'Play from here', onclick: () => playNotes(s.notes, i) }, '▶'),
        el('button', {
          class: 'mini', title: 'Move up',
          onclick: () => { if (i > 0) { [s.notes[i - 1], s.notes[i]] = [s.notes[i], s.notes[i - 1]]; app.save(); renderEditor(); } },
        }, '↑'),
        el('button', {
          class: 'mini', title: 'Move down',
          onclick: () => { if (i < s.notes.length - 1) { [s.notes[i + 1], s.notes[i]] = [s.notes[i], s.notes[i + 1]]; app.save(); renderEditor(); } },
        }, '↓'),
        el('button', {
          class: 'mini', title: 'Duplicate note',
          onclick: () => { s.notes.splice(i + 1, 0, { ...n }); app.save(); renderEditor(); },
        }, '⧉'),
        el('button', {
          class: 'mini', title: 'Delete note',
          onclick: () => { s.notes.splice(i, 1); app.save(); renderEditor(); },
        }, '✕'),
      ));
    });
    if (s.notes.length < MAX_SONG_NOTES) {
      table.append(el('div', { class: 'form-row' },
        el('button', {
          class: 'btn',
          onclick: () => { s.notes.push({ f: noteFreq('C5'), d: 150 }); app.save(); renderEditor(); },
        }, '＋ Add note'),
        el('button', {
          class: 'btn',
          onclick: () => { s.notes.push({ f: 0, d: 150 }); app.save(); renderEditor(); },
        }, '＋ Add rest'),
      ));
    }
    box.append(table);

    // import / export
    const io = el('div', { class: 'panel' });
    io.append(el('div', { class: 'panel-title' }, 'Import / export'));
    const cOut = el('textarea', { class: 'code', rows: 6, spellcheck: false });
    cOut.value = songToC(s);
    io.append(el('div', { class: 'form-row' },
      el('button', {
        class: 'btn',
        onclick: () => download(`${safeName(s.name)}.song.json`, JSON.stringify({ format: 'ardustudio-song', name: s.name, notes: s.notes }, null, 2), 'application/json'),
      }, '⬇ Export song (.json)'),
      el('button', {
        class: 'btn',
        onclick: () => importInput.click(),
      }, '⬆ Import song…'),
      el('button', {
        class: 'btn',
        onclick: async () => { try { await navigator.clipboard.writeText(cOut.value); } catch { cOut.select(); document.execCommand('copy'); } },
      }, 'Copy ArduboyTones C code'),
    ));
    const importInput = el('input', { type: 'file', accept: '.json', hidden: true });
    importInput.addEventListener('change', () => {
      const f = importInput.files && importInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (data.format !== 'ardustudio-song' || !Array.isArray(data.notes)) throw new Error('Not an ArduStudio song file');
          if (app.project.songs.length >= MAX_SONGS) throw new Error(`Max ${MAX_SONGS} songs`);
          const ns = makeSong(data.name || 'Imported song');
          ns.notes = data.notes.slice(0, MAX_SONG_NOTES).map((n) => ({
            f: Math.max(0, Math.min(32767, n.f | 0)),
            d: Math.max(1, Math.min(65535, n.d | 0)),
          }));
          app.project.songs.push(ns);
          selected = app.project.songs.length - 1;
          app.save();
          refresh();
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
        importInput.value = '';
      };
      reader.readAsText(f);
    });
    io.append(importInput);
    io.append(cOut);
    box.append(io);
  }

  function safeName(name) {
    return (name || 'song').replace(/[^A-Za-z0-9_-]+/g, '_');
  }

  function songToC(s) {
    const ident = safeName(s.name).replace(/-/g, '_') || 'song';
    const words = [];
    for (const n of s.notes) words.push(`${n.f},${n.d}`);
    return `// ${s.name} — ArduboyTones score (freq Hz, duration ms pairs)\n` +
      `// Usage: #include <ArduboyTones.h>  then  sound.tones(${ident});\n` +
      `const uint16_t ${ident}[] PROGMEM = {\n  ${words.join(', ')}${words.length ? ',' : ''} TONES_END\n};\n`;
  }

  document.getElementById('addSong').addEventListener('click', () => {
    if (app.project.songs.length >= MAX_SONGS) { alert(`Max ${MAX_SONGS} songs`); return; }
    app.project.songs.push(makeSong(`Song ${app.project.songs.length + 1}`));
    selected = app.project.songs.length - 1;
    app.save();
    refresh();
  });

  function refresh() {
    if (selected >= app.project.songs.length) selected = Math.max(0, app.project.songs.length - 1);
    renderList();
    renderPresets();
    renderEditor();
  }

  return { refresh, suspend: stopPreview };
}
