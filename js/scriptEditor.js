// Visual event-script editor (the GB Studio-style block list).
// Renders an editable list of event cards; IF blocks nest recursively.

import { el, clear } from './ui.js';
import { makeEvent, EVENT_DEFS, sceneCols, sceneRows, MAX_MENU_OPTIONS } from './model.js';

const CMP_OPTIONS = ['==', '!=', '<', '>', '<=', '>='];

// Build the "+ Add Event" dropdown.
function addEventSelect(onAdd) {
  const sel = el('select', { class: 'add-event' });
  sel.append(el('option', { value: '' }, '＋ Add event…'));
  let lastGroup = null;
  for (const def of EVENT_DEFS) {
    if (def.group !== lastGroup) {
      lastGroup = def.group;
      const og = el('optgroup', { label: def.group });
      sel.append(og);
    }
    sel.lastChild.append(el('option', { value: def.type }, def.label));
  }
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    onAdd(makeEvent(sel.value));
    sel.value = '';
  });
  return sel;
}

function labelFor(type) {
  const def = EVENT_DEFS.find((d) => d.type === type);
  return def ? def.label : type;
}

// app: { project, save() }, scene: scene the script lives in (for actor targets)
export function renderScriptEditor(app, scene, events, onChange) {
  const root = el('div', { class: 'script-list' });

  const rerender = () => {
    onChange();
    const fresh = renderScriptEditor(app, scene, events, onChange);
    root.replaceWith(fresh);
  };

  events.forEach((ev, i) => {
    root.append(renderEventCard(app, scene, events, i, rerender));
  });

  root.append(el('div', { class: 'add-event-row' }, addEventSelect((ev) => {
    events.push(ev);
    rerender();
  })));

  return root;
}

function renderEventCard(app, scene, list, index, rerender) {
  const ev = list[index];
  const card = el('div', { class: `event-card ev-${ev.type}` });

  const head = el('div', { class: 'event-head' },
    el('span', { class: 'ev-label' }, labelFor(ev.type)),
    el('button', {
      class: 'mini', title: 'Move up',
      onclick: () => { if (index > 0) { [list[index - 1], list[index]] = [list[index], list[index - 1]]; rerender(); } },
    }, '↑'),
    el('button', {
      class: 'mini', title: 'Move down',
      onclick: () => { if (index < list.length - 1) { [list[index + 1], list[index]] = [list[index], list[index + 1]]; rerender(); } },
    }, '↓'),
    el('button', {
      class: 'mini', title: 'Delete event',
      onclick: () => { list.splice(index, 1); rerender(); },
    }, '✕'),
  );
  card.append(head);

  const fields = el('div', { class: 'event-fields' });
  card.append(fields);
  const changed = () => app.save();

  const project = app.project;

  const varSelect = (key) => {
    const sel = el('select', {
      onchange: () => { ev[key] = sel.value; changed(); },
    });
    sel.append(el('option', { value: '' }, '(pick variable)'));
    for (const v of project.variables) {
      sel.append(el('option', { value: v.id, selected: ev[key] === v.id }, v.name));
    }
    return sel;
  };

  const numInput = (key, min, max) => el('input', {
    type: 'number', min, max, value: ev[key],
    onchange: (e) => { ev[key] = parseInt(e.target.value, 10) || 0; changed(); },
  });

  switch (ev.type) {
    case 'TEXT': {
      const ta = el('textarea', { rows: 2, spellcheck: false, value: ev.text });
      ta.addEventListener('input', () => { ev.text = ta.value; changed(); });
      fields.append(el('label', { style: 'flex:1 1 100%' }, ta));
      fields.append(el('span', { class: 'hint' }, 'Line break: new line · New page: \\f · ~20 chars/line, 3 lines/page'));
      break;
    }
    case 'SWITCH_SCENE': {
      const sel = el('select', { onchange: () => { ev.sceneId = sel.value; changed(); } });
      sel.append(el('option', { value: '' }, '(pick scene)'));
      for (const s of project.scenes) {
        sel.append(el('option', { value: s.id, selected: ev.sceneId === s.id }, s.name));
      }
      const target = project.scenes.find((s) => s.id === ev.sceneId);
      fields.append(el('label', {}, 'Scene', sel));
      fields.append(el('label', {}, 'X', numInput('x', 0, target ? sceneCols(target) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, target ? sceneRows(target) - 1 : 31)));
      break;
    }
    case 'SET_VAR':
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('label', {}, '=', numInput('value', 0, 255)));
      break;
    case 'ADD_VAR':
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('label', {}, '+', numInput('delta', -128, 127)));
      break;
    case 'IF_VAR': {
      fields.append(el('label', {}, 'If', varSelect('varId')));
      const cmpSel = el('select', { onchange: () => { ev.cmp = cmpSel.value; changed(); } });
      for (const c of CMP_OPTIONS) cmpSel.append(el('option', { value: c, selected: ev.cmp === c }, c));
      fields.append(cmpSel);
      fields.append(numInput('value', 0, 255));
      card.append(el('div', { class: 'event-branch-label' }, 'Then'));
      card.append(renderScriptEditor(app, scene, ev.then, app.save));
      card.append(el('div', { class: 'event-branch-label' }, 'Else'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save));
      break;
    }
    case 'TONE':
      fields.append(el('label', {}, 'Hz', numInput('freq', 16, 20000)));
      fields.append(el('label', {}, 'Frames', numInput('frames', 1, 255)));
      fields.append(el('span', { class: 'hint' }, '60 frames = 1s'));
      break;
    case 'WAIT':
      fields.append(el('label', {}, 'Frames', numInput('frames', 1, 255)));
      fields.append(el('span', { class: 'hint' }, '60 frames = 1s'));
      break;
    case 'ACTOR_HIDE':
    case 'ACTOR_SHOW': {
      const sel = el('select', { onchange: () => { ev.target = sel.value; changed(); } });
      sel.append(el('option', { value: 'self', selected: ev.target === 'self' }, 'Self (this actor)'));
      if (scene) {
        for (const a of scene.actors) {
          sel.append(el('option', { value: a.id, selected: ev.target === a.id }, a.name));
        }
      }
      fields.append(el('label', {}, 'Actor', sel));
      break;
    }
    case 'ACTOR_MOVE': {
      const sel = el('select', { onchange: () => { ev.target = sel.value; changed(); } });
      sel.append(el('option', { value: 'self', selected: ev.target === 'self' }, 'Self (this actor)'));
      if (scene) {
        for (const a of scene.actors) {
          sel.append(el('option', { value: a.id, selected: ev.target === a.id }, a.name));
        }
      }
      fields.append(el('label', {}, 'Actor', sel));
      fields.append(el('label', {}, 'To X', numInput('x', 0, scene ? sceneCols(scene) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, scene ? sceneRows(scene) - 1 : 31)));
      fields.append(el('label', {}, el('input', {
        type: 'checkbox', checked: ev.instant,
        onchange: (e) => { ev.instant = e.target.checked; changed(); },
      }), ' Teleport (instant)'));
      fields.append(el('span', { class: 'hint' }, 'Walking moves ignore walls; the script waits for arrival.'));
      break;
    }
    case 'SET_TILE': {
      fields.append(el('label', {}, 'X', numInput('x', 0, scene ? sceneCols(scene) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, scene ? sceneRows(scene) - 1 : 31)));
      const sel = el('select', { onchange: () => { ev.tileIndex = parseInt(sel.value, 10); changed(); } });
      project.tiles.forEach((t, i) => {
        sel.append(el('option', { value: i, selected: ev.tileIndex === i }, `${i}: ${t.name}`));
      });
      fields.append(el('label', {}, 'Tile', sel));
      break;
    }
    case 'PLAYER_POS':
      fields.append(el('label', {}, 'X', numInput('x', 0, scene ? sceneCols(scene) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, scene ? sceneRows(scene) - 1 : 31)));
      break;
    case 'PLAY_SONG': {
      const sel = el('select', { onchange: () => { ev.songId = sel.value; changed(); } });
      sel.append(el('option', { value: '' }, '(pick song)'));
      for (const s of project.songs || []) {
        sel.append(el('option', { value: s.id, selected: ev.songId === s.id }, s.name));
      }
      fields.append(el('label', {}, 'Song', sel));
      fields.append(el('label', {}, el('input', {
        type: 'checkbox', checked: ev.loop,
        onchange: (e) => { ev.loop = e.target.checked; changed(); },
      }), ' Loop'));
      fields.append(el('span', { class: 'hint' }, 'Compose songs in the Audio tab.'));
      break;
    }
    case 'STOP_SONG':
      fields.append(el('span', { class: 'hint' }, 'Silences the current song.'));
      break;
    case 'SAVE_GAME':
      fields.append(el('span', { class: 'hint' }, 'Writes variables, scene and player position to EEPROM.'));
      break;
    case 'LOAD_GAME':
      fields.append(el('span', { class: 'hint' }, 'Restores the save if one exists, otherwise continues.'));
      break;
    case 'SAVE_CHECK':
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('span', { class: 'hint' }, 'Sets the variable to 1 if a save exists, else 0.'));
      break;
    case 'DELETE_SAVE':
      fields.append(el('span', { class: 'hint' }, 'Erases the saved game.'));
      break;
    case 'SET_LED': {
      const modeSel = el('select', {
        onchange: () => { ev.mode = modeSel.value; changed(); rerender(); },
      });
      for (const [v, l] of [['analog', 'Analog (PWM brightness)'], ['digital', 'Digital (on / off)']]) {
        modeSel.append(el('option', { value: v, selected: ev.mode === v }, l));
      }
      fields.append(el('label', {}, 'Mode', modeSel));

      if (ev.mode === 'digital') {
        for (const [key, label] of [['dr', 'Red'], ['dg', 'Green'], ['db', 'Blue']]) {
          fields.append(el('label', {}, el('input', {
            type: 'checkbox', checked: ev[key],
            onchange: (e) => { ev[key] = e.target.checked; changed(); rerender(); },
          }), ' ', label));
        }
        fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
          'Releases the PWM hardware (freeRGBled) and switches channels fully on or off. '
          + 'A later analog event takes the LED back.'));
      } else {
        for (const [key, label] of [['r', 'R'], ['g', 'G'], ['b', 'B']]) {
          fields.append(el('label', {}, label, el('input', {
            type: 'number', min: 0, max: 255, value: ev[key],
            onchange: (e) => {
              ev[key] = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
              changed();
              rerender();
            },
          })));
        }
        fields.append(el('span', {
          class: 'led-swatch',
          title: `rgb(${ev.r}, ${ev.g}, ${ev.b})`,
          style: `background: rgb(${ev.r}, ${ev.g}, ${ev.b})`,
        }));
        fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
          'One call sets all three channels, 0–255 each. Set 0,0,0 to turn the LED off.'));
      }
      break;
    }
    case 'MENU': {
      fields.append(el('label', {}, 'Variable', varSelect('varId')));

      const layoutSel = el('select', {
        onchange: () => { ev.layout = layoutSel.value; changed(); rerender(); },
      });
      for (const [v, l] of [['menu', 'Menu (right column)'], ['dialogue', 'Dialogue (full width, 2 columns)']]) {
        layoutSel.append(el('option', { value: v, selected: ev.layout === v }, l));
      }
      fields.append(el('label', {}, 'Layout', layoutSel));

      const countSel = el('select', {
        onchange: () => {
          const n = parseInt(countSel.value, 10);
          while (ev.options.length < n) ev.options.push(`Option ${ev.options.length + 1}`);
          ev.options.length = n;
          changed();
          rerender();
        },
      });
      for (let n = 2; n <= MAX_MENU_OPTIONS; n++) {
        countSel.append(el('option', { value: n, selected: ev.options.length === n }, String(n)));
      }
      fields.append(el('label', {}, 'Number of options', countSel));

      ev.options.forEach((label, i) => {
        const isLastZero = ev.lastIsZero && i === ev.options.length - 1;
        fields.append(el('label', { style: 'flex-basis:100%' },
          `Set to '${isLastZero ? 0 : i + 1}' if`,
          el('input', {
            type: 'text', value: label,
            onchange: (e) => { ev.options[i] = e.target.value; changed(); rerender(); },
          }),
        ));
      });

      fields.append(el('label', { style: 'flex-basis:100%' }, el('input', {
        type: 'checkbox', checked: ev.lastIsZero,
        onchange: (e) => { ev.lastIsZero = e.target.checked; changed(); rerender(); },
      }), " Last option sets to '0'"));
      fields.append(el('label', { style: 'flex-basis:100%' }, el('input', {
        type: 'checkbox', checked: ev.cancelB,
        onchange: (e) => { ev.cancelB = e.target.checked; changed(); },
      }), " Set to '0' if 'B' is pressed"));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Arrows move the cursor, A selects. Labels longer than 9 characters get clipped on screen.'));
      break;
    }
    case 'CHOICE': {
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('label', { style: 'flex-basis:100%' }, "Set to 'True' if", el('input', {
        type: 'text', value: ev.trueLabel,
        onchange: (e) => { ev.trueLabel = e.target.value; changed(); },
      })));
      fields.append(el('label', { style: 'flex-basis:100%' }, "Set to 'False' if", el('input', {
        type: 'text', value: ev.falseLabel,
        onchange: (e) => { ev.falseLabel = e.target.value; changed(); },
      })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        "True sets the variable to 1, False to 0 — test it with an If Variable block."));
      break;
    }
    case 'END_SCRIPT':
      fields.append(el('span', { class: 'hint' }, 'Stops this script immediately.'));
      break;
  }

  return card;
}
