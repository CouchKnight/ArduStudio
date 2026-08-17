// Builds a .arduboy package: a ZIP holding info.json, the compiled .hex and a
// banner image.
//
// The info.json shape follows schema version 2 from the Team-ARG file-format
// repository. Worth remembering while editing: `schemaVersion`, `title`,
// `author`, `version` and a non-empty `binaries` array are all REQUIRED, the
// three strings must not be blank, `device` accepts only "Arduboy" or "DevKit",
// and `genre` is a fixed enum rather than free text.
//
// No DOM and no dependencies, so the editor, the CLI and the tests all build
// packages through exactly this code.

import { makeZip } from './zip.js';
import { framebufferToPng } from './png.js';
import { forEachEvent, sceneScripts, BUTTON_ORDER } from './model.js';

export const ARDUBOY_SCHEMA_VERSION = 2;

// The schema's genre enum. Anything outside this list fails validation, so the
// editor offers exactly these and nothing else.
export const ARDUBOY_GENRES = [
  'Puzzle', 'Shooter', 'Application', 'Demo', 'Action',
  'Arcade', 'Platformer', 'RPG', 'Racing', 'Sports', 'Misc',
];

// The schema's device enum. There is deliberately no FX value — the FX-C runs
// ordinary Arduboy binaries, so that is what a sketch from here declares.
export const ARDUBOY_DEVICES = ['Arduboy', 'DevKit'];

// Where the generated sketch keeps its save block. SAVE_ADDR is Arduboy2's
// EEPROM_STORAGE_SPACE_START (16) and the block is SAVE_SIZE (37) bytes, so a
// game with saves owns bytes 16..52 inclusive. Both sit inside the 16..1023
// range the schema allows.
export const EEPROM_START = 16;
export const EEPROM_SIZE = 37;

// Roughly the usable flash on an ATmega32u4 once the bootloader is accounted
// for. A .hex larger than this will not fit, so say so before packaging it.
const MAX_FLASH_BYTES = 28 * 1024;

/** A filesystem-safe base name for the package's files. */
export function packageBaseName(project) {
  return (project.name || 'ArduStudioGame')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'ArduStudioGame';
}

/**
 * Check that `text` is a plausible Intel HEX file for an Arduboy.
 * Returns { ok, error, bytes } — `bytes` being how much flash it occupies.
 *
 * Worth doing properly: the user picks this file by hand, and a wrong choice
 * would otherwise produce a package that fails inside a loader with no clue why.
 */
export function validateHex(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'The .hex file is empty.' };
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { ok: false, error: 'The .hex file has no records.' };

  let bytes = 0;
  let sawEof = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const where = `line ${i + 1}`;
    if (line[0] !== ':') {
      return { ok: false, error: `${where} does not start with ":" — this does not look like an Intel HEX file. Did you pick the .ino or a .bin by mistake?` };
    }
    if (!/^:[0-9A-Fa-f]+$/.test(line) || line.length % 2 !== 1) {
      return { ok: false, error: `${where} is not valid hexadecimal.` };
    }
    const raw = [];
    for (let at = 1; at < line.length; at += 2) raw.push(parseInt(line.substr(at, 2), 16));
    if (raw.length < 5) return { ok: false, error: `${where} is too short to be a record.` };

    const count = raw[0];
    const type = raw[3];
    if (raw.length !== count + 5) {
      return { ok: false, error: `${where} claims ${count} data bytes but carries ${raw.length - 5}.` };
    }
    // Every record ends with a two's-complement checksum of the bytes before it.
    const sum = raw.slice(0, -1).reduce((n, b) => n + b, 0);
    if (((~sum + 1) & 0xff) !== raw[raw.length - 1]) {
      return { ok: false, error: `${where} has a bad checksum — the file looks corrupted or truncated.` };
    }
    if (type === 0x00) bytes += count;
    if (type === 0x01) sawEof = true;
  }

  if (!sawEof) {
    return { ok: false, error: 'The .hex file has no end-of-file record — it looks truncated.' };
  }
  if (bytes > MAX_FLASH_BYTES) {
    return { ok: false, error: `The .hex holds ${bytes} bytes of flash, over the ~${MAX_FLASH_BYTES} an Arduboy has. It will not fit.` };
  }
  return { ok: true, bytes };
}

// The control scheme, as the schema's optional buttons[] list. The four fixed
// bindings plus whatever the project attaches with Attach Script To Button —
// which is the part a player could not otherwise guess.
function buttonList(project) {
  const attached = new Map();
  for (const scene of project.scenes) {
    for (const { events } of sceneScripts(scene)) {
      forEachEvent(events, (ev) => {
        if (ev.type !== 'ATTACH_SCRIPT' || !ev.button) return;
        if (!BUTTON_ORDER.includes(ev.button)) return;
        if (!attached.has(ev.button)) attached.set(ev.button, ev.override ? 'custom action' : 'extra action');
      });
    }
  }
  const NAMES = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', a: 'A', b: 'B' };
  const base = [
    { control: 'Up', action: 'move up' },
    { control: 'Down', action: 'move down' },
    { control: 'Left', action: 'move left' },
    { control: 'Right', action: 'move right' },
    { control: 'A', action: 'interact / advance text' },
    { control: 'B', action: 'skip typewriter' },
  ];
  // A button the game scripts gets its action noted alongside the default.
  return base.map((b) => {
    const key = Object.keys(NAMES).find((k) => NAMES[k] === b.control);
    const extra = key && attached.get(key);
    return extra ? { control: b.control, action: `${b.action} (+ ${extra})` } : b;
  });
}

/**
 * Build the info.json object. Separate from packaging so it can be asserted on
 * directly in tests without unzipping anything.
 */
export function buildInfoJson(project, compiled, { hexFilename, bannerFilename, date = new Date() } = {}) {
  const settings = project.settings || {};
  const genre = ARDUBOY_GENRES.includes(settings.genre) ? settings.genre : 'Misc';
  const info = {
    schemaVersion: ARDUBOY_SCHEMA_VERSION,
    title: String(project.name || '').trim(),
    author: String(project.author || '').trim(),
    version: String(settings.version || '').trim(),
    genre,
    date: date.toISOString().slice(0, 10), // ISO 8601, as the schema asks
    binaries: [{
      title: String(project.name || '').trim(),
      filename: hexFilename,
      device: 'Arduboy',
    }],
  };
  const description = String(settings.description || '').trim();
  if (description) info.description = description;
  if (bannerFilename) info.banner = bannerFilename;

  // Only a game that actually saves touches EEPROM; claiming a range otherwise
  // would tell a loader to back up bytes this game never writes.
  if (compiled && compiled.features && compiled.features.SAVES) {
    info.eeprom = { variable: false, start: EEPROM_START, end: EEPROM_START + EEPROM_SIZE - 1 };
  }
  info.buttons = buttonList(project);
  return info;
}

/**
 * Why this project cannot be packaged yet, or null when it can. The schema
 * demands non-empty title, author and version, so catch that here with a
 * message naming the field rather than emitting something a loader will reject.
 */
export function packageProblem(project) {
  const settings = project.settings || {};
  if (!String(project.name || '').trim()) return 'The package needs a title — set the project Name.';
  if (!String(project.author || '').trim()) return 'The package needs an author — set the project Author.';
  if (!String(settings.version || '').trim()) return 'The package needs a version, for example 1.0.';
  return null;
}

/**
 * Render the game's opening screen as the banner PNG. Runs the real emulator
 * headlessly, so the image is always the actual game.
 * @param {object} compiled  output of compileProject()
 * @param {Function} Emulator  the Emulator class, injected so this module stays
 *   free of a circular import between packaging and the runtime
 */
export function renderBanner(compiled, Emulator, frames = 40) {
  const emu = new Emulator(compiled, { onTone: () => {} });
  for (let i = 0; i < frames; i++) { emu.setButtons(0); emu.step(); }
  return framebufferToPng(emu.fb, 128, 64);
}

/**
 * Assemble the package.
 * @param {{project: object, compiled: object, hex: string, banner?: Uint8Array, date?: Date}} opts
 * @returns {Uint8Array} the .arduboy bytes
 */
export function buildArduboyPackage({ project, compiled, hex, banner, date = new Date() }) {
  const problem = packageProblem(project);
  if (problem) throw new Error(problem);
  const check = validateHex(hex);
  if (!check.ok) throw new Error(check.error);

  const base = packageBaseName(project);
  const hexFilename = `${base}.hex`;
  const bannerFilename = banner ? 'banner.png' : null;

  const info = buildInfoJson(project, compiled, { hexFilename, bannerFilename, date });
  const entries = [
    { name: 'info.json', data: `${JSON.stringify(info, null, 2)}\n` },
    { name: hexFilename, data: hex },
  ];
  if (banner) entries.push({ name: bannerFilename, data: banner });
  return makeZip(entries, date);
}
