// Visual event-script editor (the GB Studio-style block list).
// Renders an editable list of event cards; IF blocks nest recursively.

import { el, clear } from './ui.js';
import { makeEvent, EVENT_DEFS } from './model.js';

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
      fields.append(el('label', {}, 'Scene', sel));
      fields.append(el('label', {}, 'X', numInput('x', 0, 15)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 7)));
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
    case 'SET_TILE': {
      fields.append(el('label', {}, 'X', numInput('x', 0, 15)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 7)));
      const sel = el('select', { onchange: () => { ev.tileIndex = parseInt(sel.value, 10); changed(); } });
      project.tiles.forEach((t, i) => {
        sel.append(el('option', { value: i, selected: ev.tileIndex === i }, `${i}: ${t.name}`));
      });
      fields.append(el('label', {}, 'Tile', sel));
      break;
    }
    case 'PLAYER_POS':
      fields.append(el('label', {}, 'X', numInput('x', 0, 15)));
      fields.append(el('label', {}, 'Y', numInput('y', 0, 7)));
      break;
    case 'END_SCRIPT':
      fields.append(el('span', { class: 'hint' }, 'Stops this script immediately.'));
      break;
  }

  return card;
}
