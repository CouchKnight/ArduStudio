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
  <li><b>Audio</b> — compose songs and sound effects as ArduboyTones sequences; start from a
      preset, preview in the browser, import/export them as files.</li>
  <li><b>Scenes</b> — a scene is one Arduboy screen (16×8 tiles) by default, or up to 4×4 screens
      that <b>scroll</b> to follow the player. Paint the map, place <b>actors</b> (☺) and drag
      <b>trigger</b> areas (▦). Set the player start with ⚑.</li>
  <li><b>Script</b> — select an actor/trigger/scene and add event blocks in the right panel:
      dialogue, variables, if/else branching, scene changes, moving actors, music, save games,
      tones, tile swaps…</li>
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

<h2>Undo / redo</h2>
<p>Every edit is undoable: <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo,
<kbd>Ctrl</kbd>+<kbd>Y</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>) to redo, or use the
↶ ↷ buttons in the top bar. One paint stroke counts as one step. History holds the last 100 edits.</p>

<h2>Scrolling scenes</h2>
<p>Set <i>Screens</i> in the scene inspector to make a scene span up to 4×4 Arduboy screens
(64×32 tiles). The camera then follows the player and clamps at the map edges — a 1×1 scene never
scrolls, so single-screen Bitsy-style rooms behave exactly as before. Green lines in the editor mark
where one screen ends and the next begins.</p>

<h2>Music and sound effects</h2>
<p>The <b>Audio</b> tab writes <a href="https://github.com/MLXXXp/ArduboyTones" target="_blank" rel="noreferrer">ArduboyTones</a>
scores: a list of notes, each a frequency (or a rest) plus a duration in milliseconds. Pick notes by
name (C4, A#5…) or enter a raw frequency. Presets cover common retro jingles and SFX — pickup,
jump, hurt, victory, game over, and a looping overworld theme.</p>
<ul>
  <li><b>Preview</b> plays the song through your browser's speakers with a square wave, close to how
      the Arduboy's piezo sounds.</li>
  <li><b>Export/import</b> songs as <code>.song.json</code> files to reuse across projects, or copy
      the generated <b>ArduboyTones C array</b> to paste straight into a hand-written sketch.</li>
  <li>Use a <b>Play Song</b> event to start one (tick <i>Loop</i> for background music) and
      <b>Stop Song</b> to silence it. A <b>Play Tone</b> event interrupts any playing song.</li>
</ul>

<h2>Menus and choices</h2>
<p>Two events in the <b>Dialogue</b> group ask the player a question and store the answer
in a variable, so an <code>If Variable</code> block can branch on it.</p>
<ul>
  <li><b>Display Menu</b> — 2 to 8 options. The chosen option sets the variable to its
      number: first option → <code>1</code>, second → <code>2</code>, and so on.
      <ul>
        <li><i>Last option sets to '0'</i> turns the final entry into a "cancel"/"leave" row.</li>
        <li><i>Set to '0' if 'B' is pressed'</i> lets the player back out with B.</li>
        <li><i>Layout</i>: <b>Menu</b> is a single column down the right-hand side of the
            screen; <b>Dialogue</b> is a full-width box at the bottom with two columns.</li>
      </ul></li>
  <li><b>Display Multiple Choice</b> — a two-option prompt: the first option sets the
      variable to <code>1</code> (true), the second to <code>0</code> (false).</li>
</ul>
<p>Arrows move the cursor (left/right hop columns in the dialogue layout) and A confirms.
Labels are drawn as-is, so keep them to about <b>9 characters</b> — anything longer is
clipped, and the exporter warns you about it.</p>
<p class="hint">A title screen is just <b>Save Exists → Var</b> followed by a menu offering
"Continue" and "New game".</p>

<h2>The RGB LED</h2>
<p><b>Set RGB LED</b> (in the <b>Hardware</b> group) drives the LED next to the screen —
ideal feedback for a hit, a pickup or a menu confirmation.</p>
<ul>
  <li><b>Analog</b> is what most games want: one event sets all three channels to a
      brightness from 0 to 255, e.g. <code>255, 0, 128</code> for hot pink. Use
      <code>0, 0, 0</code> to switch it off.</li>
  <li><b>Digital</b> is the cheaper on/off mode — it needs no PWM timer. ArduStudio
      releases the PWM hardware (<code>freeRGBled()</code>) before writing the channels,
      so you can mix the two modes freely; a later analog event simply takes the LED back.</li>
</ul>
<p class="hint">Flash it briefly rather than leaving it on: pair the event with a
<b>Wait</b> and a second event that sets it back to <code>0, 0, 0</code>, as the demo's
key pickup does. The Play tab shows a live LED dot beside the screen.</p>

<h2>Save games (EEPROM)</h2>
<p>Four events manage a save slot in the Arduboy's EEPROM, which survives power-off:</p>
<ul>
  <li><b>Save Game</b> — stores every variable plus the current scene and player position.</li>
  <li><b>Load Game</b> — restores them if a save exists; otherwise the script simply continues.</li>
  <li><b>Save Exists → Var</b> — sets a variable to 1 or 0, so a title screen can offer "Continue".</li>
  <li><b>Delete Save</b> — erases the slot.</li>
</ul>
<p class="hint">In the browser the save lives in localStorage and persists between play sessions —
use <b>🗑 Wipe save</b> on the Play tab to test a fresh start. Note that scene changes made with
<b>Set Tile</b> are <i>not</i> saved; drive anything that must persist from a variable.</p>

<h2>Variables</h2>
<p>The <b>Variables</b> tab is the single place to manage all 32 byte variables. Each row shows every
script that reads or writes it, so you can tell at a glance what a variable does — and what deleting
it would break.</p>

<h2>Scripting tips</h2>
<ul>
  <li>Variables are bytes (0–255). Use them as flags (0/1), counters, or states.</li>
  <li>Actor visibility resets when a scene loads. To keep an actor gone forever, set a variable when it
      disappears and hide it again in the scene's <i>On enter</i> script (see the slime in the Key Quest demo).</li>
  <li><b>Set Tile</b> is great for opening doors and revealing passages — combine with the solid flag of tiles.</li>
  <li>Dialogue wraps automatically (~20 chars/line, 3 lines/page). Use <code>\\f</code> in the text for a manual page break.</li>
  <li><b>Change Scene</b> both switches the map and places the player — build doorways with a 1-tile trigger.</li>
  <li><b>Move Actor</b> walks an actor to a tile and pauses the script until it arrives (handy for
      cutscenes). Walking moves ignore walls; tick <i>Teleport</i> to jump there instantly.</li>
</ul>

<h2>Running offline</h2>
<p>ArduStudio ships in three forms, all identical in behaviour:</p>
<ul>
  <li><b>Portable single file</b> — <code>dist/ArduStudio.html</code>, about 210 KB. Double-click
      it; it runs offline in any browser and makes no network requests at all. Build it with
      <code>npm run build:offline</code>.</li>
  <li><b>Desktop app</b> (<code>npm run package:win</code> / <code>package:linux</code>) — adds a
      native <b>File</b> menu with real Open/Save dialogs, so projects live wherever you put them
      instead of in the Downloads folder.</li>
  <li><b>From source</b>, served by any static web server.</li>
</ul>
<p class="hint">The source <code>index.html</code> can't be opened directly from disk because
browsers block ES module scripts over <code>file://</code> — that is what the offline build
exists to solve.</p>

<h2>Flashing to the Arduboy FX‑C</h2>
<ol>
  <li>Install the <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer">Arduino IDE</a>.</li>
  <li>In <i>Library Manager</i>, install <b>Arduboy2</b> and <b>ArduboyTones</b>.</li>
  <li>Open your exported <code>.ino</code>, select board <b>Arduino Leonardo</b>
      (or the <b>Arduboy</b> board if you added the Arduboy boards package), pick the USB port, press Upload.</li>
  <li>On the FX‑C, your game uploads over USB‑C. To return to the built-in game library,
      use the FX loader as usual — your uploaded game lives in the ATmega32u4's own flash.</li>
</ol>
<p class="hint">See the <a href="https://www.arduboy.com/quick-start" target="_blank" rel="noreferrer">Arduboy quick-start</a>
for driver/port help. The generated sketch needs only <b>Arduboy2</b> and <b>ArduboyTones</b>;
save games use the AVR's built-in EEPROM.</p>

<h2>Limits (per project)</h2>
<table>
  <tr><td>Scenes</td><td>up to 255 (flash-bound in practice; a scene ≈ 150–400 bytes)</td></tr>
  <tr><td>Tiles</td><td>64 (8×8, solid flag)</td></tr>
  <tr><td>Sprites</td><td>32, up to 4 frames, 8×8 / 16×8 / 8×16 / 16×16</td></tr>
  <tr><td>Actors / triggers</td><td>8 + 8 per scene</td></tr>
  <tr><td>Variables</td><td>32 bytes (all saved to EEPROM)</td></tr>
  <tr><td>Songs</td><td>32, up to 192 notes each</td></tr>
  <tr><td>Scene size</td><td>1×1 up to 4×4 screens (16×8 … 64×32 tiles)</td></tr>
  <tr><td>Set Tile changes</td><td>16 live tile changes per scene</td></tr>
  <tr><td>Dialogue</td><td>256 unique strings (shared with menu labels)</td></tr>
  <tr><td>Menu options</td><td>8 per menu, ~9 characters per label</td></tr>
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
  <li><a href="https://cloud.arduboy.com" target="_blank" rel="noreferrer">Arduboy Cloud</a> — browser IDE
      with its own music and sound-effect creators; ArduStudio's Audio tab exports the same
      ArduboyTones format, so scores move between the two.</li>
</ul>
`;
  return { refresh: () => {} };
}
