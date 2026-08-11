// Visual event-script editor (the GB Studio-style block list).
// Renders an editable list of event cards; IF blocks nest recursively.

import { el, clear } from './ui.js';
import {
  makeEvent, EVENT_DEFS, sceneCols, sceneRows, MAX_MENU_OPTIONS, BUTTONS,
  DIRECTIONS, PROJECTILE_DIRS, ACTOR_SPEEDS, ACTOR_EFFECTS, COLLIDE_TARGETS,
} from './model.js';

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
      card.append(renderScriptEditor(app, scene, ev.script, app.save));
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
      card.append(renderScriptEditor(app, scene, ev.then, app.save));
      card.append(el('div', { class: 'event-branch-label' }, 'False'));
      card.append(renderScriptEditor(app, scene, ev.else, app.save));
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
    case 'END_SCRIPT':
      fields.append(el('span', { class: 'hint' }, 'Stops this script immediately.'));
      break;
  }

  return card;
}
