// Variables tab: one place to manage every game variable, with live usage
// tracking so it is obvious what each variable does and what deleting one
// would break.

import { el, clear } from './ui.js';
import {
  uid, MAX_VARIABLES, VAR_FLAGS, sceneScripts, renameVariableReferences, TEXT_FIELDS_WITH_VARS,
} from './model.js';

// Whether the flag-naming controls are shown at all. Off by default: a project
// that never uses flags should see the variable list exactly as it always was.
const SHOW_FLAGS_KEY = 'ardustudio.showFlagNames';
const showFlags = {
  get() { try { return localStorage.getItem(SHOW_FLAGS_KEY) === '1'; } catch { return false; } },
  set(on) { try { localStorage.setItem(SHOW_FLAGS_KEY, on ? '1' : '0'); } catch { /* private mode */ } },
};

// Which variables have their flag names expanded. Kept outside refresh() so a
// rename or an edit does not fold them all up again.
const openFlags = new Set();

// Walk every script in the project and collect where each variable is used.
// Exported so tools/test_runtime.mjs can check it keeps up with new events —
// a variable that looks unused here is one the delete button will not warn
// about, which is how a script quietly loses its variable.
export function collectUsages(project) {
  const usages = new Map(); // varId -> [{ where, how }]
  const add = (varId, where, how) => {
    if (!varId) return;
    if (!usages.has(varId)) usages.set(varId, []);
    usages.get(varId).push({ where, how });
  };
  const HOW = {
    SET_VAR: 'set', ADD_VAR: 'add', SUB_VAR: 'subtract', IF_VAR: 'if', SAVE_CHECK: 'save-check',
    STORE_ACTOR_DIR: 'store direction',
    EXPR_SET: 'set from expression', MATH_FN: 'math',
    VAR_FLAGS_ADD: 'set flags', VAR_FLAGS_CLEAR: 'clear flags',
    VAR_FLAGS_SET: 'set flags', IF_VAR_FLAGS: 'if flags',
  };
  const BRANCHING = ['IF_VAR', 'IF_INPUT', 'IF_ACTOR_AT', 'IF_ACTOR_DISTANCE', 'IF_VAR_FLAGS'];
  // "$name" in on-screen text or in a math expression is a use too — and the
  // one most easily broken by a rename, so it belongs in this list.
  const byName = new Map(project.variables.map((v) => [String(v.name), v.id]));
  const addNamed = (str, where, how) => {
    for (const m of String(str).matchAll(/(^|[^$])\$\{?([A-Za-z0-9_]+)\}?/g)) {
      if (byName.has(m[2])) add(byName.get(m[2]), where, how);
    }
  };
  const walk = (events, where) => {
    for (const ev of events || []) {
      if (HOW[ev.type]) add(ev.varId, where, HOW[ev.type]);
      for (const key of TEXT_FIELDS_WITH_VARS) {
        if (typeof ev[key] === 'string') {
          addNamed(ev[key], where, key === 'expression' ? 'expression' : 'shown in text');
        }
      }
      if (Array.isArray(ev.options)) for (const o of ev.options) addNamed(o, where, 'shown in text');
      // Menus write their result into a variable too.
      if (ev.type === 'MENU' || ev.type === 'CHOICE') add(ev.varId, where, 'menu');
      // Store Actor Position writes two variables rather than one.
      if (ev.type === 'STORE_ACTOR_POS') {
        add(ev.varX, where, 'store x');
        add(ev.varY, where, 'store y');
      }
      // Math Functions reads a second variable when its value comes from one.
      if (ev.type === 'MATH_FN' && ev.srcKind === 'variable') add(ev.srcVarId, where, 'math operand');
      // Recurse into every kind of nested script list.
      if (BRANCHING.includes(ev.type)) { walk(ev.then, where); walk(ev.else, where); }
      if (ev.type === 'ATTACH_SCRIPT') walk(ev.script, `${where} → ${String(ev.button).toUpperCase()} button`);
      if (ev.type === 'TIMER_ATTACH') walk(ev.script, `${where} → timer ${(ev.timer | 0) + 1}`);
      if (ev.type === 'EVENT_GROUP') {
        walk(ev.events, ev.label ? `${where} → ${ev.label}` : where);
      }
    }
  };
  for (const sc of project.scenes) {
    for (const { events, label } of sceneScripts(sc)) walk(events, label);
  }
  return usages;
}

export function initVariablesTab(app) {
  function refresh() {
    const table = clear(document.getElementById('varTable'));
    const usages = collectUsages(app.project);

    const flagsOn = showFlags.get();
    const cols = flagsOn ? 5 : 4;

    table.append(el('tr', {},
      el('th', {}, '#'), el('th', {}, 'Name'), el('th', {}, 'Used by'),
      ...(flagsOn ? [el('th', {}, '')] : []), el('th', {}, ''),
    ));

    app.project.variables.forEach((v, i) => {
      const list = usages.get(v.id) || [];
      const summary = list.length
        ? summarize(list)
        : el('span', { class: 'hint' }, 'unused');
      const flagRow = flagsOn ? el('td', {}, el('button', {
        class: 'mini', title: 'Name this variable\'s eight flags',
        onclick: () => {
          if (openFlags.has(v.id)) openFlags.delete(v.id); else openFlags.add(v.id);
          refresh();
        },
      }, '⚑')) : null;

      table.append(el('tr', {},
        el('td', { class: 'hint' }, `${i}`),
        el('td', {}, el('input', {
          type: 'text', value: v.name,
          onchange: (e) => {
            const next = e.target.value.replace(/[^A-Za-z0-9_]+/g, '_') || `var_${i}`;
            // Text and expressions name variables rather than pointing at them,
            // so carry every "$old" across to the new name.
            renameVariableReferences(app.project, v.name, next);
            v.name = next;
            app.save();
            refresh();
          },
        })),
        el('td', {}, summary),
        ...(flagRow ? [flagRow] : []),
        el('td', {}, el('button', {
          class: 'mini', title: 'Delete variable',
          onclick: () => {
            const n = list.length;
            const warning = n
              ? `Delete variable "${v.name}"? It is used in ${n} event${n === 1 ? '' : 's'} — those events will be skipped at export.`
              : `Delete variable "${v.name}"?`;
            if (!confirm(warning)) return;
            app.project.variables.splice(i, 1);
            app.save();
            refresh();
          },
        }, '✕')),
      ));

      if (flagsOn && openFlags.has(v.id)) table.append(flagNameRow(v, cols));
    });

    if (!app.project.variables.length) {
      table.append(el('tr', {}, el('td', { colspan: cols, class: 'hint' }, 'No variables yet.')));
    }
  }

  // Eight name boxes for one variable. Names are editor-only — they never reach
  // the sketch — so this costs the game nothing, and an empty box just falls
  // back to "Flag N" wherever the flag is shown.
  function flagNameRow(v, cols) {
    const grid = el('div', { class: 'flag-names' });
    for (let i = 0; i < VAR_FLAGS; i++) {
      grid.append(el('label', {}, `Flag ${i + 1}`, el('input', {
        type: 'text', value: (v.flags || [])[i] || '', placeholder: '—',
        onchange: (e) => {
          const flags = (v.flags || []).slice();
          while (flags.length < VAR_FLAGS) flags.push('');
          flags[i] = e.target.value.replace(/[^A-Za-z0-9_ -]+/g, '').trim();
          while (flags.length && !flags[flags.length - 1]) flags.pop();
          // Drop the array entirely once every name is blank, so a project
          // that stops using flags saves exactly as it did before.
          if (flags.length) v.flags = flags; else delete v.flags;
          app.save();
          refresh();
        },
      })));
    }
    return el('tr', {}, el('td', { colspan: cols },
      el('div', { class: 'hint' },
        `Flags on $${v.name}, for the Variable Flags events. Bit values 1, 2, 4, 8, 16, 32, 64, 128.`),
      grid));
  }

  function summarize(list) {
    const box = el('div', {});
    const byWhere = new Map();
    for (const u of list) {
      if (!byWhere.has(u.where)) byWhere.set(u.where, new Set());
      byWhere.get(u.where).add(u.how);
    }
    for (const [where, hows] of byWhere) {
      box.append(el('div', { class: 'usage-row' },
        el('span', {}, where),
        el('span', { class: 'hint' }, ` — ${[...hows].join(', ')}`),
      ));
    }
    return box;
  }

  const showFlagsBox = document.getElementById('varShowFlags');
  const flagsHelp = document.getElementById('varFlagsHelp');
  showFlagsBox.checked = showFlags.get();
  flagsHelp.hidden = !showFlagsBox.checked;
  showFlagsBox.addEventListener('change', () => {
    showFlags.set(showFlagsBox.checked);
    flagsHelp.hidden = !showFlagsBox.checked;
    if (!showFlagsBox.checked) openFlags.clear();
    refresh();
  });

  document.getElementById('addVariable').addEventListener('click', () => {
    if (app.project.variables.length >= MAX_VARIABLES) { alert(`Max ${MAX_VARIABLES} variables`); return; }
    app.project.variables.push({ id: uid('var'), name: `var_${app.project.variables.length}` });
    app.save();
    refresh();
  });

  return { refresh };
}
