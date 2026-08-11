// Visual event-script editor (the GB Studio-style block list).
// Renders an editable list of event cards; IF blocks nest recursively.

import { el, clear } from './ui.js';
import {
  makeEvent, EVENT_DEFS, sceneCols, sceneRows, MAX_MENU_OPTIONS, BUTTONS,
  DIRECTIONS, PROJECTILE_DIRS, ACTOR_SPEEDS, ACTOR_EFFECTS, COLLIDE_TARGETS,
} from './model.js';
import {
  MAX_ACTOR_DISTANCE, ANIM_SPEEDS, OVERLAY_SPEEDS, MAX_SWITCH_CASES,
} from './compiler.js';
import { compileExpression } from './expression.js';

// Direction codes by name, for the Store Actor Direction hint.
const DIR_CODES = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.code]));

const CMP_OPTIONS = ['==', '!=', '<', '>', '<=', '>='];

// Fade speeds, slowest last. The value is frames spent on each dither step.
const FADE_SPEEDS = [
  { value: 0, label: 'Instant' },
  { value: 1, label: 'Fast' },
  { value: 2, label: 'Normal' },
  { value: 4, label: 'Slow' },
  { value: 7, label: 'Very slow' },
];

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

// A single-choice grid of the Arduboy's six buttons (no Start/Select).
function buttonPicker(selected, onPick) {
  const row = el('div', { class: 'button-picker' });
  for (const b of BUTTONS) {
    row.append(el('button', {
      class: 'btn-key' + (selected === b.key ? ' active' : ''),
      type: 'button',
      title: b.key.toUpperCase(),
      onclick: () => onPick(b.key),
    }, b.label));
  }
  return row;
}

// A multi-select "Any of" grid returning a button bitmask.
function buttonChecks(mask, onChange) {
  const row = el('div', { class: 'button-picker' });
  for (const b of BUTTONS) {
    const on = (mask & b.bit) !== 0;
    row.append(el('button', {
      class: 'btn-key' + (on ? ' active' : ''),
      type: 'button',
      title: b.key.toUpperCase(),
      onclick: () => onChange(on ? (mask & ~b.bit) : (mask | b.bit)),
    }, b.label));
  }
  return row;
}

// A multi-select grid of collision groups returning a bitmask.
function collideChecks(mask, onChange) {
  const row = el('div', { class: 'button-picker' });
  for (const t of COLLIDE_TARGETS) {
    const on = (mask & t.bit) !== 0;
    row.append(el('button', {
      class: 'btn-key wide' + (on ? ' active' : ''),
      type: 'button',
      onclick: () => onChange(on ? (mask & ~t.bit) : (mask | t.bit)),
    }, t.label));
  }
  return row;
}

// Header text for an event card. A comment shows its own text and a group its
// name, so both stay readable once collapsed.
function labelFor(ev) {
  const def = EVENT_DEFS.find((d) => d.type === ev.type);
  const fallback = def ? def.label : ev.type;
  if (ev.type === 'COMMENT') return String(ev.text || '').trim() || fallback;
  if (ev.type === 'EVENT_GROUP') return String(ev.label || '').trim() || fallback;
  return fallback;
}

// Collapsed cards are remembered per event id, so re-rendering the list (which
// happens on nearly every edit) does not spring them all open again.
const collapsed = new Set();

// Why an expression will not compile, or null when it is fine. The editor uses
// the very same compiler the exporter does, so the two can never disagree.
function expressionProblem(src, project) {
  const names = new Map();
  project.variables.forEach((v, i) => names.set(String(v.name), i));
  try {
    compileExpression(src, names);
    return null;
  } catch (err) {
    return err.message;
  }
}

// app: { project, save() }, scene: scene the script lives in (for actor targets)
export function renderScriptEditor(app, scene, events, onChange, owner = null) {
  const root = el('div', { class: 'script-list' });

  const rerender = () => {
    onChange();
    const fresh = renderScriptEditor(app, scene, events, onChange, owner);
    root.replaceWith(fresh);
  };

  events.forEach((ev, i) => {
    root.append(renderEventCard(app, scene, events, i, rerender, owner));
  });

  root.append(el('div', { class: 'add-event-row' }, addEventSelect((ev) => {
    events.push(ev);
    rerender();
  })));

  return root;
}

function renderEventCard(app, scene, list, index, rerender, ownerActor = null) {
  const ev = list[index];
  const card = el('div', { class: `event-card ev-${ev.type}` });

  const isCollapsed = collapsed.has(ev.id);
  if (isCollapsed) card.classList.add('collapsed');

  const head = el('div', { class: 'event-head' },
    el('button', {
      class: 'mini', title: isCollapsed ? 'Expand' : 'Collapse',
      onclick: () => {
        if (isCollapsed) collapsed.delete(ev.id); else collapsed.add(ev.id);
        rerender();
      },
    }, isCollapsed ? '▸' : '▾'),
    el('span', { class: 'ev-label' }, labelFor(ev)),
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
  if (isCollapsed) return card;

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

  // "Self, or one of the actors in this scene" — the target of every actor
  // event. `extra` prepends further choices (Launch Projectile adds Player).
  const actorSelect = (key = 'target', extra = []) => {
    const sel = el('select', { onchange: () => { ev[key] = sel.value; changed(); } });
    sel.append(el('option', { value: 'self', selected: ev[key] === 'self' }, 'Self (this actor)'));
    for (const [value, label] of extra) {
      sel.append(el('option', { value, selected: ev[key] === value }, label));
    }
    if (scene) {
      for (const a of scene.actors) {
        sel.append(el('option', { value: a.id, selected: ev[key] === a.id }, a.name));
      }
    }
    return sel;
  };

  // A <select> over [{value, label}] writing an integer field.
  const optionSelect = (key, options) => {
    const sel = el('select', {
      onchange: () => { ev[key] = parseInt(sel.value, 10); changed(); },
    });
    for (const o of options) {
      sel.append(el('option', { value: o.value, selected: ev[key] === o.value }, o.label));
    }
    return sel;
  };

  // A <select> over [{key, label}] writing a string field.
  const keySelect = (field, options) => {
    const sel = el('select', { onchange: () => { ev[field] = sel.value; changed(); } });
    for (const o of options) {
      sel.append(el('option', { value: o.key, selected: ev[field] === o.key }, o.label));
    }
    return sel;
  };

  const fadeField = () => el('label', {}, 'Fade speed', optionSelect('fade', FADE_SPEEDS));

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
      card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
      card.append(el('div', { class: 'event-branch-label' }, 'Else'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
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
      fields.append(el('label', {}, 'Actor', actorSelect()));
      break;
    }
    case 'ACTOR_MOVE': {
      fields.append(el('label', {}, 'Actor', actorSelect()));
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
    case 'SET_ACTOR_SPRITE': {
      fields.append(el('label', {}, 'Actor', actorSelect()));
      const sprSel = el('select', { onchange: () => { ev.spriteId = sprSel.value; changed(); } });
      sprSel.append(el('option', { value: '' }, '(pick sprite)'));
      for (const s of project.sprites) {
        sprSel.append(el('option', { value: s.id, selected: ev.spriteId === s.id }, s.name));
      }
      fields.append(el('label', {}, 'Sprite', sprSel));
      break;
    }
    case 'ATTACH_SCRIPT': {
      fields.append(el('label', { style: 'flex-basis:100%' }, 'Button',
        buttonPicker(ev.button, (key) => { ev.button = key; changed(); rerender(); })));
      fields.append(el('label', { style: 'flex-basis:100%' }, el('input', {
        type: 'checkbox', checked: ev.override,
        onchange: (e) => { ev.override = e.target.checked; changed(); },
      }), ' Override default button action'));
      card.append(el('div', { class: 'event-branch-label' }, 'On press'));
      card.append(renderScriptEditor(app, scene, ev.script, app.save, ownerActor));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Runs whenever the button is pressed, and stays attached across scenes until removed. '
        + 'Without override the button also keeps its normal action.'));
      break;
    }
    case 'REMOVE_BUTTON_SCRIPT':
      fields.append(el('label', { style: 'flex-basis:100%' }, 'Remove script attached to input',
        buttonPicker(ev.button, (key) => { ev.button = key; changed(); rerender(); })));
      break;
    case 'WAIT_INPUT':
      fields.append(el('label', { style: 'flex-basis:100%' }, 'Any of',
        buttonChecks(ev.mask, (mask) => { ev.mask = mask; changed(); rerender(); })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'The script pauses here until one of these buttons is pressed.'));
      break;
    case 'IF_INPUT': {
      fields.append(el('label', { style: 'flex-basis:100%' }, 'Any of',
        buttonChecks(ev.mask, (mask) => { ev.mask = mask; changed(); rerender(); })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Checks buttons held right now and continues immediately — it never waits. '
        + 'To react every time a button is pressed, use Attach Script To Button.'));
      card.append(el('div', { class: 'event-branch-label' }, 'True'));
      card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
      card.append(el('div', { class: 'event-branch-label' }, 'False'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
      break;
    }
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
    case 'SET_ACTOR_DIR':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Direction', keySelect('direction', DIRECTIONS)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Also decides which way Launch Projectile fires when it follows the actor.'));
      break;
    case 'SET_ACTOR_SPEED':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Speed', optionSelect('speed', ACTOR_SPEEDS)));
      break;
    case 'ACTOR_EFFECT':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Effect', keySelect('effect', ACTOR_EFFECTS)));
      fields.append(el('label', {}, 'Frames', numInput('frames', 1, 255)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Flicker blinks the actor, shake jitters it sideways. 60 frames = 1s.'));
      break;
    case 'LAUNCH_PROJECTILE': {
      fields.append(el('label', {}, 'Launch from', actorSelect('source', [['player', 'Player']])));
      const sprSel = el('select', { onchange: () => { ev.spriteId = sprSel.value; changed(); } });
      sprSel.append(el('option', { value: '' }, '(pick sprite)'));
      for (const s of project.sprites) {
        sprSel.append(el('option', { value: s.id, selected: ev.spriteId === s.id }, s.name));
      }
      fields.append(el('label', {}, 'Sprite', sprSel));
      fields.append(el('label', {}, 'Direction', keySelect('direction',
        [{ key: 'source', label: 'Follow the launcher' }, ...PROJECTILE_DIRS])));
      fields.append(el('label', {}, 'Speed', numInput('speed', 1, 8)));
      fields.append(el('label', {}, 'Lifetime', numInput('life', 1, 255)));
      fields.append(el('label', { style: 'flex-basis:100%' }, 'Collides with',
        collideChecks(ev.collideWith, (mask) => { ev.collideWith = mask; changed(); rerender(); })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Speed is pixels per frame, lifetime is frames before it vanishes (60 = 1s). '
        + 'It also dies on a solid tile. Six can be in flight at once.'));
      break;
    }
    case 'PUSH_SCENE': {
      const sel = el('select', { onchange: () => { ev.sceneId = sel.value; changed(); rerender(); } });
      sel.append(el('option', { value: '' }, '(pick scene)'));
      for (const s of project.scenes) {
        sel.append(el('option', { value: s.id, selected: ev.sceneId === s.id }, s.name));
      }
      const target = project.scenes.find((s) => s.id === ev.sceneId);
      fields.append(el('label', {}, 'Scene', sel));
      fields.append(el('label', {}, 'X', numInput('x', 0, target ? sceneCols(target) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, target ? sceneRows(target) - 1 : 31)));
      fields.append(fadeField());
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Remembers this scene and where the player is standing, so Pop Scene can come back. '
        + 'Up to 8 deep.'));
      break;
    }
    case 'POP_SCENE':
      fields.append(fadeField());
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Returns to the scene the last Push Scene came from. Does nothing if none was pushed.'));
      break;
    case 'POP_ALL_SCENES':
      fields.append(fadeField());
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Unwinds the whole stack back to the scene the first Push Scene came from.'));
      break;
    case 'FADE_IN':
    case 'FADE_OUT':
      fields.append(fadeField());
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        `Dithers the screen ${ev.type === 'FADE_OUT' ? 'to black' : 'back in'}; the script waits for it to finish. `
        + 'Dialogue and menus stay readable through a fade.'));
      break;
    case 'IF_ACTOR_AT': {
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'X', numInput('x', 0, scene ? sceneCols(scene) - 1 : 63)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, scene ? sceneRows(scene) - 1 : 31)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Tile coordinates, checked once — it never waits.'));
      card.append(el('div', { class: 'event-branch-label' }, 'True'));
      card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
      card.append(el('div', { class: 'event-branch-label' }, 'False'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
      break;
    }
    case 'IF_ACTOR_DISTANCE': {
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      const cmpSel = el('select', { onchange: () => { ev.cmp = cmpSel.value; changed(); } });
      for (const c of CMP_OPTIONS) cmpSel.append(el('option', { value: c, selected: ev.cmp === c }, c));
      fields.append(el('label', {}, 'Comparison', cmpSel));
      fields.append(el('label', {}, 'Distance', numInput('distance', 0, MAX_ACTOR_DISTANCE)));
      fields.append(el('label', {}, 'From', actorSelect('from', [['player', 'Player']])));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Straight-line distance in tiles. Checked once — it never waits.'));
      card.append(el('div', { class: 'event-branch-label' }, 'True'));
      card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
      card.append(el('div', { class: 'event-branch-label' }, 'False'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
      break;
    }
    case 'STORE_ACTOR_DIR':
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        `Down: ${DIR_CODES.down} · Right: ${DIR_CODES.right} · Up: ${DIR_CODES.up} · Left: ${DIR_CODES.left}`));
      break;
    case 'STORE_ACTOR_POS':
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'X', varSelect('varX')));
      fields.append(el('label', {}, 'Y', varSelect('varY')));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Tile coordinates. Use two different variables — the Y write would otherwise overwrite the X.'));
      break;
    case 'COMMENT': {
      const ta = el('textarea', { rows: 2, spellcheck: false, value: ev.text, placeholder: 'Text…' });
      // Live, so the header keeps up as you type — that is what makes a
      // collapsed comment readable.
      ta.addEventListener('input', () => {
        ev.text = ta.value;
        head.querySelector('.ev-label').textContent = labelFor(ev);
        changed();
      });
      fields.append(el('label', { style: 'flex:1 1 100%' }, ta));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Notes for you only — a comment does nothing in the game and costs no space on the device.'));
      break;
    }
    case 'EVENT_GROUP': {
      const name = el('input', { type: 'text', value: ev.label, placeholder: 'Group name (optional)' });
      name.addEventListener('input', () => {
        ev.label = name.value;
        head.querySelector('.ev-label').textContent = labelFor(ev);
        changed();
      });
      fields.append(el('label', { style: 'flex:1 1 100%' }, name));
      card.append(renderScriptEditor(app, scene, ev.events, app.save, ownerActor));
      break;
    }
    case 'EXPR_IF':
    case 'EXPR_LOOP': {
      const isLoop = ev.type === 'EXPR_LOOP';
      const input = el('input', {
        type: 'text', value: ev.expression, spellcheck: false,
        placeholder: 'e.g. 6 * $health',
      });
      const status = el('span', { class: 'hint', style: 'flex-basis:100%' });
      // Check as you type: a bad expression is a warning here, not a surprise
      // at export time.
      const check = () => {
        ev.expression = input.value;
        const problem = expressionProblem(input.value, project);
        input.classList.toggle('bad', !!problem);
        status.textContent = problem
          ? `⚠ ${problem}`
          : (isLoop
            ? 'Repeats the events below while this stays true (non-zero).'
            : 'True when this is non-zero.');
        status.classList.toggle('warn-text', !!problem);
        changed();
      };
      input.addEventListener('input', check);
      fields.append(el('label', { style: 'flex:1 1 100%' }, 'Condition', input));
      fields.append(status);
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        '$name reads a variable · + - * / % · == != < > <= >= · && || ! · min, max, abs, rnd'));
      check();
      if (isLoop) {
        card.append(renderScriptEditor(app, scene, ev.events, app.save, ownerActor));
        fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
          'A loop whose condition never goes false stalls this script — the screen keeps '
          + 'running, but nothing else in the script does.'));
      } else {
        card.append(el('div', { class: 'event-branch-label' }, 'True'));
        card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
        card.append(el('div', { class: 'event-branch-label' }, 'False'));
        card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
      }
      break;
    }
    case 'SEED_RNG':
      fields.append(el('span', { class: 'hint' },
        'Run this in response to a button press so random numbers differ between playthroughs.'));
      break;
    case 'SWITCH': {
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      const countSel = el('select', {
        onchange: () => {
          const n = parseInt(countSel.value, 10);
          while (ev.cases.length < n) ev.cases.push({ value: ev.cases.length, events: [] });
          ev.cases.length = n;
          changed();
          rerender();
        },
      });
      for (let n = 1; n <= MAX_SWITCH_CASES; n++) {
        countSel.append(el('option', { value: n, selected: ev.cases.length === n }, String(n)));
      }
      fields.append(el('label', {}, 'Number of options', countSel));
      ev.cases.forEach((c, i) => {
        card.append(el('div', { class: 'event-branch-label' }, 'If equal to ', el('input', {
          type: 'number', min: 0, max: 255, value: c.value,
          onchange: (e) => { c.value = parseInt(e.target.value, 10) || 0; changed(); },
        })));
        card.append(renderScriptEditor(app, scene, c.events, app.save, ownerActor));
      });
      card.append(el('div', { class: 'event-branch-label' }, 'Else'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save, ownerActor));
      break;
    }
    case 'SET_ANIM_FRAME':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Animation frame', numInput('frame', 0, 3)));
      break;
    case 'SET_ANIM_SPEED':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Animation speed', optionSelect('speed', ANIM_SPEEDS)));
      break;
    case 'SET_ANIM_STATE': {
      fields.append(el('label', {}, 'Actor', actorSelect()));
      // States belong to the sprite, so list the ones on whichever sprite the
      // chosen actor is showing.
      const target = (ev.target && ev.target !== 'self' && scene)
        ? scene.actors.find((a) => a.id === ev.target)
        : ownerActor;
      const sprite = target ? project.sprites.find((sp) => sp.id === target.spriteId) : null;
      const states = (sprite && sprite.states) || [];
      const stateSel = el('select', { onchange: () => { ev.stateId = stateSel.value; changed(); } });
      if (!states.length) stateSel.append(el('option', { value: '' }, '(no sprite selected)'));
      for (const st of states) {
        stateSel.append(el('option', { value: st.id, selected: ev.stateId === st.id },
          `${st.name} (${st.from}–${st.to})`));
      }
      fields.append(el('label', {}, 'Animation state', stateSel));
      fields.append(el('label', {}, el('input', {
        type: 'checkbox', checked: ev.loop,
        onchange: (e) => { ev.loop = e.target.checked; changed(); },
      }), ' Loop animation'));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        states.length
          ? 'Edit a sprite\'s states in the Sprites tab. Without Loop it stops on the last frame.'
          : 'Give the actor a sprite first — animation states belong to the sprite.'));
      break;
    }
    case 'DRAW_TEXT': {
      const ta = el('textarea', { rows: 2, spellcheck: false, value: ev.text, placeholder: 'Text…' });
      ta.addEventListener('input', () => { ev.text = ta.value; changed(); });
      fields.append(el('label', { style: 'flex:1 1 100%' }, ta));
      fields.append(el('label', {}, 'X', numInput('x', 0, 127)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 63)));
      fields.append(el('label', {}, 'Location', keySelect('location', [
        { key: 'background', label: 'Background' },
        { key: 'overlay', label: 'Overlay' },
      ])));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Pixel coordinates. Background text scrolls with the scene; overlay text stays put on '
        + 'the screen. Up to 4 pieces of text at once — redrawing at the same spot replaces it.'));
      break;
    }
    case 'SHOW_OVERLAY':
      fields.append(el('label', {}, 'Fill colour', keySelect('fill', [
        { key: 'black', label: 'Black' },
        { key: 'white', label: 'White' },
      ])));
      fields.append(el('label', {}, 'X', numInput('x', 0, 16)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 8)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Tile coordinates of the panel\'s top-left corner. It covers everything below and '
        + 'right of there, so 0,8 hides it off the bottom of the screen.'));
      break;
    case 'HIDE_OVERLAY':
      fields.append(el('span', { class: 'hint' }, 'Removes the overlay panel from the screen.'));
      break;
    case 'OVERLAY_MOVE':
      fields.append(el('label', {}, 'X', numInput('x', 0, 16)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 8)));
      fields.append(el('label', {}, 'Speed', optionSelect('speed', OVERLAY_SPEEDS)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Slides the panel to a new corner; the script waits until it arrives.'));
      break;
    case 'OVERLAY_CUTOFF':
      fields.append(el('label', {}, 'Y cutoff', numInput('y', 0, 64)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'The overlay and dialogue are only drawn above this scanline — set it to put an '
        + 'overlay band across the top of the screen. 64 means no cutoff.'));
      break;
    case 'END_SCRIPT':
      fields.append(el('span', { class: 'hint' }, 'Stops this script immediately.'));
      break;
  }

  return card;
}
