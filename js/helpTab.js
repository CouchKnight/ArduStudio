// Help tab content.

export function initHelpTab() {
  document.getElementById('helpContent').innerHTML = `
<h2>Welcome to ArduStudio</h2>
<p>ArduStudio is a visual game maker for the <b>Arduboy FX‑C</b> (and the original Arduboy / Arduboy FX),
inspired by <a href="https://www.gbstudio.dev" target="_blank" rel="noreferrer">GB Studio</a> and
<a href="https://make.bitsy.org" target="_blank" rel="noreferrer">Bitsy</a>. You paint scenes, place actors,
script them with visual event blocks, play-test instantly in the browser, then export a real Arduino sketch.</p>

<h2>Workflow</h2>
<ol>
  <li><b>Tiles</b> — draw 8×8 background tiles. Mark walls, water etc. as <i>Solid</i>.</li>
  <li><b>Sprites</b> — draw animated characters (up to 4 frames, 8×8 to 16×16).</li>
  <li><b>Scenes</b> — each scene is one Arduboy screen (16×8 tiles). Paint the map,
      place <b>actors</b> (☺) and drag <b>trigger</b> areas (▦). Set the player start with ⚑.</li>
  <li><b>Script</b> — select an actor/trigger/scene and add event blocks in the right panel:
      dialogue, variables, if/else branching, scene changes, tones, tile swaps…</li>
  <li><b>▶ Play</b> — instant play-test. The emulator runs the <i>same bytecode</i> your exported
      game uses, with the genuine Arduboy2 font.</li>
  <li><b>Export</b> — download the <code>.ino</code> sketch and flash it from the Arduino IDE.</li>
</ol>

<h2>How the game plays</h2>
<table>
  <tr><th>Input</th><th>On Arduboy</th><th>In the emulator</th></tr>
  <tr><td>Move (tile by tile)</td><td>D‑pad</td><td>Arrow keys</td></tr>
  <tr><td>Interact / advance text</td><td>A</td><td>Z, Space or Enter</td></tr>
  <tr><td>Skip typewriter</td><td>B</td><td>X or Shift</td></tr>
</table>
<p>The player walks tile-by-tile (Bitsy-style) and is blocked by solid tiles and solid actors.
Press <b>A</b> while facing an actor to run its script. Walking onto a trigger area runs its script
(it re-arms after you step off it). A scene's <i>On enter</i> script runs every time the scene loads —
use an <code>If Variable</code> block for one-time intros.</p>

<h2>Scripting tips</h2>
<ul>
  <li>Variables are bytes (0–255). Use them as flags (0/1), counters, or states.</li>
  <li>Actor visibility resets when a scene loads. To keep an actor gone forever, set a variable when it
      disappears and hide it again in the scene's <i>On enter</i> script (see the slime in the Key Quest demo).</li>
  <li><b>Set Tile</b> is great for opening doors and revealing passages — combine with the solid flag of tiles.</li>
  <li>Dialogue wraps automatically (~20 chars/line, 3 lines/page). Use <code>\\f</code> in the text for a manual page break.</li>
  <li><b>Change Scene</b> both switches the map and places the player — build doorways with a 1-tile trigger.</li>
</ul>

<h2>Flashing to the Arduboy FX‑C</h2>
<ol>
  <li>Install the <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer">Arduino IDE</a>.</li>
  <li>In <i>Library Manager</i>, install <b>Arduboy2</b> (by the Arduboy2 contributors).</li>
  <li>Open your exported <code>.ino</code>, select board <b>Arduino Leonardo</b>
      (or the <b>Arduboy</b> board if you added the Arduboy boards package), pick the USB port, press Upload.</li>
  <li>On the FX‑C, your game uploads over USB‑C. To return to the built-in game library,
      use the FX loader as usual — your uploaded game lives in the ATmega32u4's own flash.</li>
</ol>
<p class="hint">See the <a href="https://www.arduboy.com/quick-start" target="_blank" rel="noreferrer">Arduboy quick-start</a>
for driver/port help. The generated sketch only needs the Arduboy2 library — sound uses the built-in beeper
(<code>BeepPin1</code>), no extra libraries.</p>

<h2>Limits (per project)</h2>
<table>
  <tr><td>Scenes</td><td>up to 255 (flash-bound in practice; a scene ≈ 150–400 bytes)</td></tr>
  <tr><td>Tiles</td><td>64 (8×8, solid flag)</td></tr>
  <tr><td>Sprites</td><td>32, up to 4 frames, 8×8 / 16×8 / 8×16 / 16×16</td></tr>
  <tr><td>Actors / triggers</td><td>8 + 8 per scene</td></tr>
  <tr><td>Variables</td><td>32 bytes</td></tr>
  <tr><td>Dialogue</td><td>256 unique strings</td></tr>
</table>
<p class="hint">The ATmega32u4 has ~28 KB of usable flash — roomy for dozens of scenes. The FX‑C's extra
16 MB FX flash chip is not needed for ArduStudio games (that is where the 300-game library lives).</p>

<h2>Arduboy programming references</h2>
<ul>
  <li><a href="https://github.com/MLXXXp/Arduboy2" target="_blank" rel="noreferrer">Arduboy2 library</a> — the standard game library (what exported sketches use)</li>
  <li><a href="https://community.arduboy.com/t/make-your-own-arduboy-game-part-6-graphics/7929" target="_blank" rel="noreferrer">Community graphics tutorial</a> — the image format ArduStudio emits</li>
  <li><a href="https://community.arduboy.com/t/all-the-arduboy-image-converters/3568" target="_blank" rel="noreferrer">Image converters thread</a> — alternatives to the built-in Image Tool</li>
  <li>Other ecosystem libraries you may meet: <b>ArduboyTones</b> / <b>ArduboyPlaytune</b> (music),
      <b>ArduboyFX</b> (the 16 MB flash chip), <b>FixedPoints</b> (fixed-point math), <b>ATMlib</b> (chip tunes).</li>
</ul>
`;
  return { refresh: () => {} };
}
