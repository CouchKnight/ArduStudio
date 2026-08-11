// Resizable sidebars.
//
// The panels are flex children of each .tabpane, so a resizer is simply another
// flex child sitting on the sidebar's inner edge — no absolute positioning, which
// would scroll away with the sidebar's own overflow-y.
//
// Widths are stored per side rather than per tab: the left rail always shows a
// list of things and the right rail always shows an inspector, so one width for
// each is what you actually want as you move between tabs.

// Default widths live in css/style.css so the narrow-screen media query can
// still override them; this module only deals with explicit user widths.
const MIN = 180;
const MAX = 600;
const KEY = (side) => `ardustudio.sidebar.${side}`;

function sideOf(sidebar) {
  return sidebar.classList.contains('right') ? 'right' : 'left';
}

// null when the user has never dragged this side, so the stylesheet's own
// default — and its narrow-screen media query — keep working untouched.
function storedWidth(side) {
  let raw = null;
  try { raw = localStorage.getItem(KEY(side)); } catch { /* storage unavailable */ }
  const px = parseInt(raw, 10);
  return Number.isFinite(px) ? clamp(px) : null;
}

function clearWidth(side) {
  document.querySelectorAll('.sidebar').forEach((sb) => {
    if (sideOf(sb) !== side) return;
    sb.style.removeProperty('width');
    sb.style.removeProperty('min-width');
  });
}

function clamp(px) {
  return Math.max(MIN, Math.min(MAX, Math.round(px)));
}

// Every sidebar on a side moves together, so switching tabs never jumps.
function applyWidth(side, px) {
  document.querySelectorAll('.sidebar').forEach((sb) => {
    if (sideOf(sb) !== side) return;
    sb.style.width = `${px}px`;
    sb.style.minWidth = `${px}px`;
  });
}

export function initSidebars() {
  for (const side of ['left', 'right']) {
    const w = storedWidth(side);
    if (w !== null) applyWidth(side, w);
  }

  document.querySelectorAll('.sidebar').forEach((sidebar) => {
    const side = sideOf(sidebar);
    const handle = document.createElement('div');
    handle.className = `sidebar-resizer ${side}`;
    handle.title = 'Drag to resize — double-click to reset';
    // The inner edge: after a left sidebar, before a right one.
    if (side === 'right') sidebar.parentNode.insertBefore(handle, sidebar);
    else sidebar.parentNode.insertBefore(handle, sidebar.nextSibling);

    let startX = 0;
    let startW = 0;

    handle.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      // Stop the drag from selecting text across the editor.
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!handle.classList.contains('dragging')) return;
      // A right sidebar grows as the pointer moves left, so the delta flips.
      const delta = side === 'right' ? startX - e.clientX : e.clientX - startX;
      applyWidth(side, clamp(startW + delta));
    });

    const stop = (e) => {
      if (!handle.classList.contains('dragging')) return;
      handle.classList.remove('dragging');
      handle.releasePointerCapture(e.pointerId);
      try {
        localStorage.setItem(KEY(side), String(Math.round(sidebar.getBoundingClientRect().width)));
      } catch { /* storage unavailable — the width still applies this session */ }
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);

    handle.addEventListener('dblclick', () => {
      clearWidth(side);
      try { localStorage.removeItem(KEY(side)); } catch { /* ignore */ }
    });
  });
}
