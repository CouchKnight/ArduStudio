// Copy/paste for events, event groups and actors.
//
// Payloads go to the system clipboard as JSON, so a copy survives a reload and
// can cross scenes, browser tabs and projects. The clipboard API needs a secure
// context and permission, and is unavailable to the packaged `file://` build in
// some browsers, so every write also lands in a module-level fallback that the
// read path uses when the real clipboard is unavailable or holds nothing of
// ours. That keeps copy/paste working everywhere, just without crossing tabs.

const FORMAT = 'ardustudio-clip';
const VERSION = 1;

let fallback = null; // the last thing copied in this tab

function wrap(kind, data) {
  return { format: FORMAT, version: VERSION, kind, data };
}

function parse(text) {
  if (!text) return null;
  let obj;
  try { obj = JSON.parse(text); } catch { return null; }
  if (!obj || obj.format !== FORMAT) return null;
  return obj;
}

// Copy `data` under a `kind` tag ('events' | 'actor'). Resolves once the
// fallback is set, so a paste right after a copy always works even if the
// clipboard write is still in flight or gets denied.
export async function writeClip(kind, data) {
  const payload = wrap(kind, data);
  fallback = payload;
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  } catch {
    // Denied, insecure context, or no API — the fallback already has it.
  }
  return true;
}

// Read a clip of the given kind, or null. Prefers the system clipboard so a
// copy from another tab wins, and falls back to this tab's own last copy.
export async function readClip(kind) {
  try {
    const obj = parse(await navigator.clipboard.readText());
    if (obj && obj.kind === kind) return obj.data;
  } catch {
    // Fall through to the in-tab copy.
  }
  if (fallback && fallback.kind === kind) return fallback.data;
  return null;
}

// Whether this tab has copied something of `kind`. Used to decide if a paste
// button should even be shown — reading the real clipboard needs a user
// gesture and may prompt, so it cannot be polled while rendering.
export function hasClip(kind) {
  return !!(fallback && fallback.kind === kind);
}
