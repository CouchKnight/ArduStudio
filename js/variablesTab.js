// Variables tab: one place to manage every game variable, with live usage
// tracking so it is obvious what each variable does and what deleting one
// would break.

import { el, clear } from './ui.js';
import {
  uid, MAX_VARIABLES, sceneScripts, renameVariableReferences, TEXT_FIELDS_WITH_VARS,
} from './model.js';

// Walk every script in the project and collect where each variable is used.
function collectUsages(project) {
  const usages = new Map(); // varId -> [{ where, how }]
  const add = (varId, where, how) => {
    if (!varId) return;
    if (!usages.has(varId)) usages.set(varId, []);
    usages.get(varId).push({ where, how });
  };
  const HOW = {
    SET_VAR: 'set', ADD_VAR: 'add', IF_VAR: 'if', SAVE_CHECK: 'save-check',
    STORE_ACTOR_DIR: 'store direction',
    EXPR_SET: 'set from expression', MATH_FN: 'math',
  };
  const BRANCHING = ['IF_VAR', 'IF_INPUT', 'IF_ACTOR_AT', 'IF_ACTOR_DISTANCE'];
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

    table.append(el('tr', {},
      el('th', {}, '#'), el('th', {}, 'Name'), el('th', {}, 'Used by'), el('th', {}, ''),
    ));

    app.project.variables.forEach((v, i) => {
      const list = usages.get(v.id) || [];
      const summary = list.length
        ? summarize(list)
        : el('span', { class: 'hint' }, 'unused');
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
    });

    if (!app.project.variables.length) {
      table.append(el('tr', {}, el('td', { colspan: 4, class: 'hint' }, 'No variables yet.')));
    }
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

  document.getElementById('addVariable').addEventListener('click', () => {
    if (app.project.variables.length >= MAX_VARIABLES) { alert(`Max ${MAX_VARIABLES} variables`); return; }
    app.project.variables.push({ id: uid('var'), name: `var_${app.project.variables.length}` });
    app.save();
    refresh();
  });

  return { refresh };
}
