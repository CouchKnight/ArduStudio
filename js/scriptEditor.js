// Visual event-script editor (the GB Studio-style block list).
// Renders an editable list of event cards; IF blocks nest recursively.

import { el, clear } from './ui.js';
import {
  makeEvent, EVENT_DEFS, sceneCols, sceneRows, MAX_MENU_OPTIONS, BUTTONS,
  DIRECTIONS, PROJECTILE_DIRS, ACTOR_SPEEDS, ACTOR_EFFECTS, COLLIDE_TARGETS,
  MATH_OPS, MATH_SOURCES, VAR_FLAGS,
  SCENE_SCRIPT_SLOTS, ACTOR_SCRIPT_SLOTS, TRIGGER_SCRIPT_SLOTS,
  cloneWithNewIds, retargetActorRefs,
} from './model.js';
import { writeClip, readClip } from './clipboard.js';
import {
  MAX_ACTOR_DISTANCE, ANIM_SPEEDS, OVERLAY_SPEEDS, MAX_SWITCH_CASES,
  MAX_TIMERS, MAX_TIMER_FRAMES,
} from './compiler.js';

// The timer slots, as a dropdown. Numbered rather than named: unlike a
// variable's flags, a timer is a slot you occupy for a moment, not a thing
// you refer to all over a game.
const TIMER_SLOTS = Array.from({ length: MAX_TIMERS },
  (_, i) => ({ value: i, label: `Timer ${i + 1}` }));
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

// The eight flags of one byte variable, as a two-column grid of toggles
// returning a bitmask. Labels come from whatever the variable's flags have been
// named in the Variables tab, falling back to "Flag 1".."Flag 8" — so a script
// reads "has_sword" rather than "Flag 3" once they are named.
function flagChecks(project, varId, mask, onChange) {
  const variable = project.variables.find((v) => v.id === varId);
  const names = (variable && variable.flags) || [];
  const grid = el('div', { class: 'flag-picker' });
  for (let i = 0; i < VAR_FLAGS; i++) {
    const bit = 1 << i;
    const on = (mask & bit) !== 0;
    const named = String(names[i] || '').trim();
    grid.append(el('button', {
      class: 'btn-flag' + (on ? ' active' : ''),
      type: 'button',
      title: named ? `Flag ${i + 1}: ${named}` : `Flag ${i + 1}`,
      onclick: () => onChange(on ? (mask & ~bit) : (mask | bit)),
    }, named || `Flag ${i + 1}`));
  }
  return grid;
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

// Typing "$" in a field that becomes on-screen text offers the project's
// variables, so you can search for one instead of remembering its exact name.
// Whatever you pick prints its value where the reference sits.
function attachVariableAutocomplete(field, app, onPick) {
  let menu = null;
  let matches = [];
  let sel = 0;

  const close = () => { if (menu) { menu.remove(); menu = null; } };

  // The "$partial" being typed, if the caret sits at the end of one.
  const token = () => {
    const upto = field.value.slice(0, field.selectionStart);
    const m = /\$([A-Za-z0-9_]*)$/.exec(upto);
    // "$$" is an escaped dollar sign, not the start of a reference.
    if (!m || /\$\$$/.test(upto)) return null;
    return { start: field.selectionStart - m[0].length, partial: m[1] };
  };

  const insert = (name) => {
    const t = token();
    if (!t) return;
    const before = field.value.slice(0, t.start);
    const after = field.value.slice(field.selectionStart);
    // A reference that butts straight up against a letter or digit needs the
    // braced form, or the name would swallow whatever follows it.
    const ref = /^[A-Za-z0-9_]/.test(after) ? `\${${name}}` : `$${name}`;
    field.value = before + ref + after;
    const caret = before.length + ref.length;
    field.setSelectionRange(caret, caret);
    close();
    onPick(field.value);
    field.focus();
  };

  const render = () => {
    const t = token();
    if (!t) { close(); return; }
    const needle = t.partial.toLowerCase();
    matches = app.project.variables.filter((v) => v.name.toLowerCase().includes(needle));
    if (!matches.length) { close(); return; }
    if (sel >= matches.length) sel = 0;
    if (!menu) {
      menu = el('div', { class: 'var-complete' });
      field.parentNode.append(menu);
    }
    clear(menu);
    matches.forEach((v, i) => {
      menu.append(el('div', {
        class: 'var-complete-row' + (i === sel ? ' active' : ''),
        // mousedown, not click: the field must not lose focus first, or the
        // caret position the insert depends on is gone.
        onmousedown: (e) => { e.preventDefault(); insert(v.name); },
      }, `$${v.name}`));
    });
  };

  field.addEventListener('input', () => { sel = 0; render(); });
  field.addEventListener('blur', () => setTimeout(close, 120));
  field.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % matches.length; e.preventDefault(); render(); }
    else if (e.key === 'ArrowUp') { sel = (sel + matches.length - 1) % matches.length; e.preventDefault(); render(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[sel].name); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

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

  root.append(el('div', { class: 'add-event-row' },
    addEventSelect((ev) => {
      events.push(ev);
      rerender();
    }),
    // Also at list level, so an empty slot can be pasted into — there is no
    // event card to hang a paste button off when the list is empty.
    el('button', {
      class: 'mini', title: 'Paste event(s) here',
      onclick: () => pasteEventsInto(app, scene, events, events.length, rerender),
    }, '⎘'),
  ));

  return root;
}

// Paste copied events into `list` at `at`. Ids are regenerated so the copies
// are independent, and any actor reference that means nothing in this scene is
// pointed back at Self rather than left to fail quietly at export.
async function pasteEventsInto(app, scene, list, at, rerender) {
  const data = await readClip('events');
  if (!data || !Array.isArray(data) || !data.length) {
    alert('Nothing to paste. Copy an event with ⧉ first.');
    return;
  }
  const copy = cloneWithNewIds(data);
  const reset = retargetActorRefs(copy, scene);
  list.splice(at, 0, ...copy);
  rerender();
  if (reset) {
    alert(`Pasted. ${reset} actor reference${reset === 1 ? '' : 's'} pointed at an actor `
      + 'that is not in this scene, so they were reset to Self.');
  }
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
      // An Event Group or an If carries its children, since those are just
      // nested lists on the event.
      class: 'mini', title: 'Copy event',
      onclick: async () => {
        await writeClip('events', [ev]);
        rerender();
      },
    }, '⧉'),
    el('button', {
      class: 'mini', title: 'Paste event(s) below',
      onclick: () => pasteEventsInto(app, scene, list, index + 1, rerender),
    }, '⎘'),
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
      attachVariableAutocomplete(ta, app, (value) => { ev.text = value; changed(); });
      fields.append(el('label', { style: 'flex:1 1 100%; position:relative' }, ta));
      fields.append(el('span', { class: 'hint' },
        'Line break: new line · New page: \\f · ~20 chars/line, 3 lines/page · $name shows a variable'));
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
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Stops at 0 and 255 rather than wrapping round.'));
      break;
    case 'SUB_VAR':
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      fields.append(el('label', {}, '−', el('input', {
        type: 'number', min: 1, max: 255, value: ev.amount,
        onchange: (e) => {
          ev.amount = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
          changed();
        },
      })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Stops at 0 rather than wrapping round, so taking 30 off a 10 leaves 0 — '
        + 'not 236.'));
      break;
    case 'TIMER_ATTACH': {
      fields.append(el('label', {}, 'Timer', optionSelect('timer', TIMER_SLOTS)));
      const secs = el('span', { class: 'hint' });
      const showSecs = () => {
        secs.textContent = `= ${(Math.max(1, ev.frames | 0) / 60).toFixed(2).replace(/\.?0+$/, '')} s`;
      };
      fields.append(el('label', {}, 'Every', el('input', {
        type: 'number', min: 1, max: MAX_TIMER_FRAMES, value: ev.frames,
        onchange: (e) => {
          ev.frames = Math.max(1, Math.min(MAX_TIMER_FRAMES, parseInt(e.target.value, 10) || 1));
          changed();
          showSecs();
        },
      }), ' frames'));
      fields.append(secs);
      showSecs();
      card.append(el('div', { class: 'event-branch-label' }, 'On each tick'));
      card.append(renderScriptEditor(app, scene, ev.script, app.save, ownerActor));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Repeats until the timer is removed. Inside the script, Self means whichever '
        + 'actor attached it. A tick that lands while dialogue is up waits its turn '
        + 'rather than being lost.'));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Timers are cleared by a scene change — the script is written against this '
        + 'scene\'s actors, so it cannot follow you out of it. Re-attach in the next '
        + 'scene\'s On Init if you need it to carry on.'));
      break;
    }
    case 'TIMER_RESTART':
      fields.append(el('label', {}, 'Timer', optionSelect('timer', TIMER_SLOTS)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Puts the countdown back to a full period without changing the script.'));
      break;
    case 'TIMER_REMOVE':
      fields.append(el('label', {}, 'Timer', optionSelect('timer', TIMER_SLOTS)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Detaches the script so the timer stops firing.'));
      break;
    case 'EXPR_SET': {
      fields.append(el('label', {}, 'Variable', varSelect('varId')));
      const input = el('input', {
        type: 'text', value: ev.expression, spellcheck: false,
        placeholder: 'e.g. $health - $defence',
      });
      const status = el('span', { class: 'hint', style: 'flex-basis:100%' });
      // Same as-you-type checking the If / Loop expression fields get, so a
      // typo is a warning here rather than a surprise at export.
      const check = () => {
        ev.expression = input.value;
        const problem = expressionProblem(input.value, project);
        input.classList.toggle('bad', !!problem);
        status.textContent = problem
          ? `⚠ ${problem}`
          : 'The variable is set to whatever this works out to.';
        status.classList.toggle('warn-text', !!problem);
        changed();
      };
      input.addEventListener('input', check);
      attachVariableAutocomplete(input, app, () => check());
      fields.append(el('label', { style: 'flex:1 1 100%; position:relative' }, 'Expression', input));
      fields.append(status);
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        '$name reads a variable · + - * / % · == != < > <= >= · && || ! · min, max, abs, rnd'));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Working out happens in whole numbers with room to spare, but the result is stored in a '
        + 'byte — so anything below 0 lands on 0 and anything above 255 lands on 255.'));
      check();
      break;
    }
    case 'MATH_FN': {
      // Sugar over the same evaluator Evaluate Math Expression uses, so the
      // hint below shows exactly the expression this compiles to.
      const preview = el('span', { class: 'hint', style: 'flex-basis:100%' });
      const nameOf = (id) => {
        const v = project.variables.find((x) => x.id === id);
        return v ? `$${v.name}` : '(pick variable)';
      };
      const updatePreview = () => {
        const opDef = MATH_OPS.find((o) => o.key === ev.op) || MATH_OPS[0];
        const rhs = ev.srcKind === 'variable' ? nameOf(ev.srcVarId)
          : ev.srcKind === 'random' ? `rnd(${ev.value | 0})`
            : String(ev.value | 0);
        const target = nameOf(ev.varId);
        preview.textContent = opDef.key === 'set'
          ? `Same as: ${target} = ${rhs}`
          : `Same as: ${target} = ${target} ${opDef.symbol} ${rhs}`;
      };

      fields.append(el('label', {}, 'Variable', varSelect('varId')));

      const opSel = el('select', {
        onchange: () => { ev.op = opSel.value; changed(); updatePreview(); },
      });
      for (const o of MATH_OPS) {
        opSel.append(el('option', { value: o.key, selected: ev.op === o.key }, o.label));
      }
      fields.append(el('label', {}, 'Operation', opSel));

      const srcSel = el('select', {
        onchange: () => { ev.srcKind = srcSel.value; changed(); rerenderFields(); },
      });
      for (const o of MATH_SOURCES) {
        srcSel.append(el('option', { value: o.key, selected: ev.srcKind === o.key }, o.label));
      }
      fields.append(el('label', {}, 'Value', srcSel));

      // The value control depends on the source, so it lives in its own slot
      // that gets rebuilt when the source changes.
      const valueSlot = el('span', { class: 'form-slot' });
      const rerenderFields = () => {
        clear(valueSlot);
        if (ev.srcKind === 'variable') {
          valueSlot.append(varSelect('srcVarId'));
        } else {
          valueSlot.append(el('input', {
            type: 'number', min: 0, max: 255, value: ev.value,
            onchange: (e) => {
              ev.value = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
              changed(); updatePreview();
            },
          }));
          if (ev.srcKind === 'random') {
            valueSlot.append(el('span', { class: 'hint' }, 'random from 0 up to this, not including it'));
          }
        }
        updatePreview();
      };
      fields.append(el('label', {}, ev.srcKind === 'variable' ? 'From' : 'Amount', valueSlot));
      fields.append(preview);
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'The result stops at 0 and 255 rather than wrapping, and dividing by zero gives 0.'));
      rerenderFields();
      break;
    }
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
    case 'VAR_FLAGS_ADD':
    case 'VAR_FLAGS_CLEAR':
    case 'VAR_FLAGS_SET': {
      // The flag labels depend on which variable is picked, so changing it has
      // to rebuild the grid — hence rerender() rather than plain changed().
      const sel = varSelect('varId');
      sel.addEventListener('change', () => rerender());
      fields.append(el('label', {}, 'Variable', sel));
      fields.append(el('label', { style: 'flex-basis:100%' },
        flagChecks(project, ev.varId, ev.mask, (mask) => { ev.mask = mask; changed(); rerender(); })));
      const verb = ev.type === 'VAR_FLAGS_CLEAR' ? 'false' : 'true';
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        ev.type === 'VAR_FLAGS_SET'
          ? 'Replaces the variable with exactly these flags — anything not ticked is turned off. '
            + 'With none ticked it clears them all.'
          : `Sets the ticked flags to ${verb}. Flags you leave alone keep the value they had.`));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Eight true/false values share one variable. Name them in the Variables tab — '
        + 'names live in the project only and cost nothing on the Arduboy.'));
      break;
    }
    case 'IF_VAR_FLAGS': {
      const sel = varSelect('varId');
      sel.addEventListener('change', () => rerender());
      fields.append(el('label', {}, 'If', sel));
      fields.append(el('label', {}, 'Match', keySelect('mode', [
        { key: 'all', label: 'All of these are set' },
        { key: 'any', label: 'Any of these is set' },
      ])));
      fields.append(el('label', { style: 'flex-basis:100%' },
        flagChecks(project, ev.varId, ev.mask, (mask) => { ev.mask = mask; changed(); rerender(); })));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Checked once — it never waits.'));
      card.append(el('div', { class: 'event-branch-label' }, 'True'));
      card.append(renderScriptEditor(app, scene, ev.then, app.save, ownerActor));
      card.append(el('div', { class: 'event-branch-label' }, 'False'));
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
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
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
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
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
        const input = el('input', {
          type: 'text', value: label,
          onchange: (e) => { ev.options[i] = e.target.value; changed(); },
        });
        attachVariableAutocomplete(input, app, (value) => { ev.options[i] = value; changed(); });
        fields.append(el('label', { style: 'flex-basis:100%; position:relative' },
          `Set to '${isLastZero ? 0 : i + 1}' if`, input));
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
      for (const [key, caption] of [['trueLabel', "Set to 'True' if"], ['falseLabel', "Set to 'False' if"]]) {
        const input = el('input', {
          type: 'text', value: ev[key],
          onchange: (e) => { ev[key] = e.target.value; changed(); },
        });
        attachVariableAutocomplete(input, app, (value) => { ev[key] = value; changed(); });
        fields.append(el('label', { style: 'flex-basis:100%; position:relative' }, caption, input));
      }
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        "True sets the variable to 1, False to 0 — test it with an If Variable block."));
      break;
    }
    case 'SET_ACTOR_DIR':
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'Direction', keySelect('direction', DIRECTIONS)));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Also decides which way Launch Projectile fires when it follows the actor.'));
      break;
    case 'SET_ACTOR_SPEED':
      fields.append(el('label', {}, 'Actor', actorSelect()));
      fields.append(el('label', {}, 'Speed', optionSelect('speed', ACTOR_SPEEDS)));
      break;
    case 'ACTOR_EFFECT':
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
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
      attachVariableAutocomplete(input, app, () => check());
      fields.append(el('label', { style: 'flex:1 1 100%; position:relative' }, 'Condition', input));
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
    case 'LOOP': {
      card.append(renderScriptEditor(app, scene, ev.events, app.save, ownerActor));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Repeats forever. Something inside has to end it — a Wait keeps the game responsive, '
        + 'and Stop Script or Change Scene break out. Without one of those the script freezes here, '
        + 'and the exporter will tell you so.'));
      break;
    }
    case 'START_SCRIPT': {
      // Every script slot in this scene, as "Entity → Slot". Scripts are
      // compiled per scene and their actor references are scene-relative, so
      // there is deliberately nothing here from other scenes.
      const sel = el('select', {
        onchange: () => {
          const [target, slot] = sel.value.split('|');
          ev.target = target; ev.slot = slot;
          changed();
        },
      });
      const current = `${ev.target}|${ev.slot}`;
      let found = false;
      const addOpt = (target, slot, label, filled) => {
        const value = `${target}|${slot}`;
        if (value === current) found = true;
        sel.append(el('option', { value, selected: value === current },
          filled ? label : `${label} (empty)`));
      };
      if (scene) {
        for (const { key, label } of SCENE_SCRIPT_SLOTS) {
          addOpt('scene', key, `Scene → ${label}`, (scene.scripts[key] || []).length);
        }
        for (const a of scene.actors) {
          for (const { key, label } of ACTOR_SCRIPT_SLOTS) {
            addOpt(a.id, key, `${a.name} → ${label}`, (a.scripts[key] || []).length);
          }
        }
        for (const t of scene.triggers) {
          for (const { key, label } of TRIGGER_SCRIPT_SLOTS) {
            addOpt(t.id, key, `${t.name} → ${label}`, (t.scripts[key] || []).length);
          }
        }
      }
      if (!found) {
        sel.prepend(el('option', { value: current, selected: true }, '(missing script)'));
      }
      fields.append(el('label', { style: 'flex:1 1 100%' }, 'Script', sel));
      fields.append(el('span', { class: 'hint', style: 'flex-basis:100%' },
        'Starts that script and carries straight on without waiting for it. This is the one way '
        + 'an On Update script can begin something that pauses — dialogue, a wait, a fade. '
        + 'Inside the started script, Self means the actor it belongs to.'));
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
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'Animation frame', numInput('frame', 0, 3)));
      break;
    case 'SET_ANIM_SPEED':
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
      fields.append(el('label', {}, 'Animation speed', optionSelect('speed', ANIM_SPEEDS)));
      break;
    case 'SET_ANIM_STATE': {
      fields.append(el('label', {}, 'Actor', actorSelect('target', [['player', 'Player']])));
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
      attachVariableAutocomplete(ta, app, (value) => { ev.text = value; changed(); });
      fields.append(el('label', { style: 'flex:1 1 100%; position:relative' }, ta));
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
