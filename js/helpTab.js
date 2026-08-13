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
      dialogue, variables, if/else branching, scene changes, moving actors, projectiles, music,
      save games, tones, tile swaps… Each entity has several script slots (see below).</li>
  <li><b>▶ Play</b> — instant play-test. The emulator runs the <i>same bytecode</i> your exported
      game uses, with the genuine Arduboy2 font.</li>
  <li><b>Export</b> — download the <code>.ino</code> sketch and flash it from the Arduino IDE.</li>
</ol>

<h2>Script lifecycle: when each script runs</h2>
<p>Every actor, trigger and scene carries <i>several</i> scripts rather than one. Pick the
slot in the inspector's tab strip; a ● marks a tab that already has events in it.</p>
<table>
  <tr><th>Where</th><th>Slot</th><th>Runs when</th></tr>
  <tr><td rowspan="4">Actor</td><td><b>On Interact</b></td><td>the player faces it and presses A</td></tr>
  <tr><td><b>On Init</b></td><td>the scene loads — before the scene's own On Init</td></tr>
  <tr><td><b>On Hit</b></td><td>something it collides with touches it</td></tr>
  <tr><td><b>On Update</b></td><td>every frame</td></tr>
  <tr><td rowspan="2">Trigger</td><td><b>On Enter</b></td><td>the player steps into the area</td></tr>
  <tr><td><b>On Leave</b></td><td>the player steps back out</td></tr>
  <tr><td rowspan="2">Scene</td><td><b>On Init</b></td><td>the scene loads, after every actor's On Init</td></tr>
  <tr><td><b>On Player Hit</b></td><td>the player touches a grouped actor that has no On Hit of its own</td></tr>
</table>
<p>Only one script runs at a time, so a script that pauses (dialogue, a menu, a wait) holds
the others up; anything that fires meanwhile queues and runs as soon as the way is clear.</p>
<p class="hint"><b>On Update is the exception</b> — it runs outside that queue, every frame,
and must finish in that frame. Waits, dialogue, menus, fades and scene pushes are therefore
not allowed in it; the exporter warns you and skips them. Use it for per-frame logic like
watching a variable or firing a projectile on a timer.</p>

<h2>Collisions</h2>
<p>An actor with a <b>collision group</b> (1, 2 or 3) can be touched. Its <i>Runs On Hit for</i>
list says what may set its <b>On Hit</b> script off — tick <b>Player</b> to react to the player
walking into it, and a group to react to projectiles aimed at that group. An actor left in
group <i>None</i> is not collidable at all.</p>
<p>A hit re-arms only once the two separate, so standing on an actor fires its script once
rather than every frame.</p>

<h2>Projectiles</h2>
<p><b>Launch Projectile</b> fires a sprite from an actor (or from the player) in one of eight
directions, or in whatever direction the launcher is currently facing. Give it a speed in
pixels per frame, a lifetime in frames, and the collision groups it should hit. It also dies
on a solid tile. <b>Six</b> can be in flight at once; a seventh shot is dropped.</p>
<p class="hint">Aim it with <b>Set Actor Direction</b>, which is also what the actor's
<i>Facing</i> field in the inspector sets — and what <b>Store Actor Direction In Variable</b>
reads back.</p>

<h2>Actor movement and effects</h2>
<ul>
  <li><b>Set Actor Movement Speed</b> — pixels per frame, or ½ for one pixel every other
      frame. Applies to patrol/wander and to scripted <b>Move Actor</b> walks.</li>
  <li><b>Actor Effects</b> — <i>flicker</i> blinks the actor and <i>shake</i> jitters it one
      pixel sideways, for a chosen number of frames. Both are draw-only: the actor keeps
      moving and colliding normally.</li>
</ul>

<h2>The scene stack</h2>
<p><b>Push Scene</b> remembers the current scene <i>and where the player is standing</i>, then
loads another one. <b>Pop Scene</b> comes back to exactly that spot, and <b>Pop All Scenes</b>
unwinds the lot. That is how you build a shop, a menu room or a cutscene without wiring a
return trigger by hand. The stack is 8 deep, and popping with nothing pushed simply does
nothing.</p>
<p><b>Fade In</b> and <b>Fade Out</b> dither the screen over a few frames and pause the script
until they finish; push and pop take the same <i>Fade speed</i>. Dialogue and menus are drawn
on top of a fade, so text stays readable throughout.</p>

<h2>How the game plays</h2>
<table>
  <tr><th>Input</th><th>On Arduboy</th><th>In the emulator</th></tr>
  <tr><td>Move (tile by tile)</td><td>D‑pad</td><td>Arrow keys</td></tr>
  <tr><td>Interact / advance text</td><td>A</td><td>Z, Space or Enter</td></tr>
  <tr><td>Skip typewriter</td><td>B</td><td>X or Shift</td></tr>
</table>
<p>The player walks tile-by-tile (Bitsy-style) and is blocked by solid tiles and solid actors.
Press <b>A</b> while facing an actor to run its <i>On Interact</i> script. A scene's <i>On Init</i>
script runs every time the scene loads — use an <code>If Variable</code> block for one-time intros.</p>

<h2>Resizing the panels</h2>
<p>Drag the thin bar on the inner edge of either side panel to make it wider or narrower —
useful when a script gets deep or a scene list gets long. The width is remembered between
sessions; double-click the bar to go back to the default.</p>

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

<h2>Buttons and input</h2>
<p>The Arduboy has six buttons — ◀ ▶ ▲ ▼ A and B. (There is no Start or Select.)
By default the D‑pad walks the player and A interacts; the <b>Input</b> event group
lets a script take over.</p>
<ul>
  <li><b>Attach Script To Button</b> — run a script every time a button is pressed.
      Tick <i>Override default button action</i> to replace what the button normally
      does; leave it off and the button keeps its usual job <i>and</i> runs your script.
      An attached script stays attached across scene changes until you remove it.</li>
  <li><b>Remove Button Script</b> — detach it again, restoring the default behaviour.</li>
  <li><b>Pause Script Until Input Pressed</b> — hold the script here until one of the
      chosen buttons is pressed ("press A to continue"). Tick several under <i>Any of</i>
      to accept any of them.</li>
  <li><b>If Joypad Input Held</b> — branch on buttons held <i>right now</i>. It checks
      once and carries straight on; it never waits. To react every time a button is
      pressed, use <b>Attach Script To Button</b> instead.</li>
</ul>
<p class="hint">Overriding a D‑pad direction stops the player walking that way — handy
for a menu or a driving section — so remember to remove the script afterwards.</p>

<h2>Changing an actor's look</h2>
<p><b>Set Actor Sprite</b> (in the <b>Actors</b> group) swaps the sprite an actor is
drawn with: a chest opening, an NPC changing clothes, an enemy showing damage. If the
new sprite has fewer animation frames than the old one, the actor's frame resets so it
never points past the end.</p>

<h2>Targeting the player</h2>
<p>Most actor events can act on <b>the player</b>, not just on <i>Self</i> or a named
scene actor — pick <b>Player</b> from the <i>Actor</i> dropdown. That covers
<b>Set Actor Sprite</b>, <b>Actor Effects</b>, <b>Set Actor Direction</b>,
<b>Hide / Show Actor</b> and <b>Set Actor Animation Frame / Speed / State</b>, alongside
the questions that already asked about it — <b>If Actor At Position</b>,
<b>If Actor Distance From Actor</b> and the two <b>Store Actor…</b> events.</p>
<ul>
  <li><b>Set Actor Sprite</b> on the player is how you do a sword swing, a costume change
      or a damage state — swap the sprite, wait, swap it back.</li>
  <li><b>Actor Effects</b> flickers or shakes the player for a few frames: the usual
      "you got hit" feedback. Like the actor version it is draw-only.</li>
  <li><b>Set Actor Direction</b> turns the player on the spot, which also aims a
      <b>Launch Projectile</b> set to fire in the launcher's own direction.</li>
  <li><b>Hide Actor</b> on the player is <i>visual only</i> — the player keeps moving and
      still sets triggers off, so a cutscene cannot strand the game. Remember to
      <b>Show Actor</b> again afterwards.</li>
  <li>The player has no animation of its own beyond the two-frame walk cycle, so the
      first <b>Set Actor Animation State</b> also starts it animating.</li>
</ul>
<p class="hint">Two events stay actor-only. <b>Set Actor Movement Speed</b> means nothing
for a player that walks tile-by-tile rather than at a pixel speed — the exporter warns you
and skips it — and <b>Move Actor</b> is covered for the player by <b>Teleport Player</b>.</p>

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

<h2>Math expressions</h2>
<p>Two events in <b>Control Flow</b> take an expression rather than a single comparison:
<b>If Math Expression</b> branches on it, and <b>Loop While Math Expression</b> repeats a
block for as long as it stays true. Anything non-zero counts as true.</p>
<table>
  <tr><td>Variables</td><td><code>$health</code> — the name from the Variables tab</td></tr>
  <tr><td>Arithmetic</td><td><code>+ - * / %</code>, unary <code>-</code>, and parentheses</td></tr>
  <tr><td>Comparison</td><td><code>== != &lt; &gt; &lt;= &gt;=</code></td></tr>
  <tr><td>Logic</td><td><code>&amp;&amp; || !</code></td></tr>
  <tr><td>Functions</td><td><code>min(a,b)</code> <code>max(a,b)</code> <code>abs(a)</code> <code>rnd(n)</code> — a random number from 0 to n−1</td></tr>
</table>
<p>The whole expression is worked out when you export, so the Arduboy never parses anything —
it just runs the finished sum. Maths is done in 16-bit signed integers, so intermediate values
up to ±32767 are safe even though variables themselves only hold 0–255; dividing by zero gives
0 rather than crashing. The editor checks as you type and tells you what is wrong.</p>
<p class="hint">A loop whose condition never becomes false will stall that script — the game
keeps drawing and the screen keeps updating, but the script stops making progress. Make sure
something inside the loop changes what the condition tests. For that reason a loop is not
allowed in an <b>On Update</b> script at all.</p>

<h2>Switch</h2>
<p><b>Switch</b> compares one variable against up to eight values and runs the matching block,
or the <i>Else</i> block if none match. It is the tidy way to write a state machine — far
easier to read than a stack of nested <code>If Variable</code> blocks.</p>

<h2>Randomness</h2>
<p><code>rnd(n)</code> in an expression gives you a random number, and actors set to
<i>Wander</i> move randomly. Both come from the same generator, which starts from the same
place every time the Arduboy powers on — so without help, every playthrough would roll exactly
the same numbers. <b>Seed Random Number Generator</b> fixes that: run it in response to a
button press (a title screen's "press A to start" is the classic spot) and the timing of that
press seeds the generator.</p>

<h2>Sprite animation states</h2>
<p>A sprite's frames can be grouped into named <b>animation states</b> in the <b>Sprites</b>
tab — <i>Idle</i> might be frames 0–1 and <i>Walk</i> frames 2–3. Every sprite starts with a
<i>Default</i> state covering all its frames, and the preview plays whichever state you have
selected.</p>
<ul>
  <li><b>Set Actor Animation State</b> — plays one of that sprite's states. Untick
      <i>Loop animation</i> and it stops on the state's last frame instead of repeating.</li>
  <li><b>Set Actor Animation Frame</b> — jumps straight to one frame.</li>
  <li><b>Set Actor Animation Speed</b> — how many frames pass between animation steps, or
      <i>None</i> to freeze the actor on its current frame.</li>
</ul>

<h2>The overlay</h2>
<p>The overlay is a panel of solid black or white drawn over the game. Its corner sits at a
tile position and it covers everything below and to the right of there, which is what makes it
useful for status bars, shop windows and title screens.</p>
<ul>
  <li><b>Show Overlay</b> — choose black or white and where its corner goes. <code>0,8</code>
      parks it just off the bottom of the screen, ready to slide up.</li>
  <li><b>Overlay Move To</b> — slides it to a new corner at a chosen speed; the script waits
      until it arrives.</li>
  <li><b>Hide Overlay</b> — takes it away.</li>
  <li><b>Set Overlay Scanline Cutoff</b> — the overlay and the dialogue box are only drawn
      above this line. Use it to keep a band across the top of the screen; 64 means no cutoff.</li>
  <li><b>Draw Text</b> — writes text at a pixel position, either on the <i>background</i>
      (which scrolls with the scene) or on the <i>overlay</i> (which stays put on screen).
      Four pieces of text can be live at once; drawing again at the same spot replaces the
      text already there, so a score counter is free to update every frame.</li>
</ul>
<p class="hint">A status bar is <b>Show Overlay</b> at <code>0,0</code>, <b>Set Overlay
Scanline Cutoff</b> at 16, then <b>Draw Text</b> on the overlay.</p>

<h2>Asking about actors</h2>
<p>Four events read an actor's state, and each of them can target the <b>player</b> as well as
an actor in the scene.</p>
<ul>
  <li><b>If Actor At Position</b> — branches on whether an actor is standing on a given tile.</li>
  <li><b>If Actor Distance From Actor</b> — branches on how far one actor is from another, in
      tiles. The distance is straight-line, so an actor 3 tiles across and 4 down is 5 away,
      not 7. Both events check once and carry straight on; neither waits.</li>
  <li><b>Store Actor Direction In Variable</b> — writes which way an actor faces:
      <code>Down 0</code>, <code>Right 1</code>, <code>Up 2</code>, <code>Left 3</code>.</li>
  <li><b>Store Actor Position In Variables</b> — writes an actor's tile X and Y into two
      variables. Use two <i>different</i> variables; the exporter warns you if you don't.</li>
</ul>
<p class="hint">These are what a chase turns into: an <b>On Update</b> script that tests
<i>If Actor Distance From Actor</i> against the player and moves the actor when it is close.</p>

<h2>Showing a variable's value in text</h2>
<p>Any event that puts words on screen — <b>Show Dialogue</b>, <b>Draw Text</b>, and the
labels of <b>Display Menu</b> and <b>Display Multiple Choice</b> — can print a variable's
value. Type <code>$</code> and the editor drops down a list of your variables to search;
pick one and it writes the reference for you.</p>
<table>
  <tr><td><code>$name</code></td><td>prints that variable's value</td></tr>
  <tr><td><code>\${name}</code></td><td>the same, when the value is followed straight away by
      more letters — <code>$goldcoins</code> would read as a variable called
      <i>goldcoins</i>, so write <code>\${gold}coins</code></td></tr>
  <tr><td><code>$$</code></td><td>a literal dollar sign</td></tr>
</table>
<p>The value is read at the moment it is drawn, not when the script starts, so text that
stays on screen keeps itself up to date — a <b>Draw Text</b> score counter needs no repainting
logic at all. A name that matches no variable is printed exactly as you typed it, and the
exporter warns you about it.</p>
<p class="hint">Line wrapping has to reserve room before it knows the value, so it counts every
reference as <b>three characters</b> — the widest a 0–255 variable can print. A short value
just leaves a little space; a line can never overrun the box.</p>

<h2>Keeping scripts readable</h2>
<ul>
  <li><b>Comment</b> — notes to yourself. It does nothing in the game and costs no space on
      the device. Whatever you type becomes the block's title, so a collapsed comment still
      reads as a heading for the section under it.</li>
  <li><b>Event Group</b> — folds a run of events into one block, optionally named. It is
      purely organisational: the events inside compile exactly as if the group were not
      there.</li>
</ul>
<p>Every event block collapses with the <b>▾</b> button in its corner, which is how you keep
a long script navigable.</p>

<h2>Variables</h2>
<p>The <b>Variables</b> tab is the single place to manage all 32 byte variables. Each row shows every
script that reads or writes it, so you can tell at a glance what a variable does — and what deleting
it would break.</p>

<h2>Scripting tips</h2>
<ul>
  <li>Variables are bytes (0–255). Use them as flags (0/1), counters, or states.</li>
  <li>Actor visibility resets when a scene loads. To keep an actor gone forever, set a variable when it
      disappears and hide it again in the scene's <i>On Init</i> script (see the slime in the Key Quest demo).</li>
  <li><b>Set Tile</b> is great for opening doors and revealing passages — combine with the solid flag of tiles.</li>
  <li>Dialogue wraps automatically (~20 chars/line, 3 lines/page). Use <code>\\f</code> in the text for a manual page break.</li>
  <li><b>Change Scene</b> both switches the map and places the player — build doorways with a 1-tile trigger.</li>
  <li><b>Move Actor</b> walks an actor to a tile and pauses the script until it arrives (handy for
      cutscenes). Walking moves ignore walls; tick <i>Teleport</i> to jump there instantly.</li>
</ul>

<h2>Running offline</h2>
<p>ArduStudio ships in three forms, all identical in behaviour:</p>
<ul>
  <li><b>Portable single file</b> — <code>dist/ArduStudio.html</code>, about 215 KB. Double-click
      it; it runs offline in any browser and makes no network requests at all. In <b>Chrome and
      Edge</b> you also get real Save/Open dialogs, and <b>Save</b> writes straight back to the
      same file. Build it with <code>npm run build:offline</code>.</li>
  <li><b>Desktop app</b> (<code>npm run package:win</code> / <code>package:linux</code>) — the same
      app in its own window with a native <b>File</b> menu. Mostly useful if you want a taskbar
      app, or use Firefox, which has no file-picker API and falls back to downloads.</li>
  <li><b>From source</b>, served by any static web server.</li>
</ul>
<p class="hint">The source <code>index.html</code> can't be opened directly from disk because
browsers block ES module scripts over <code>file://</code> — that is what the offline build
exists to solve.</p>

<p class="hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> saves, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>
saves as, <kbd>Ctrl</kbd>+<kbd>O</kbd> opens. The Export tab shows which file mode is active and
the title bar shows the open filename.</p>

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
  <tr><td>Buttons</td><td>6 (◀ ▶ ▲ ▼ A B) — one attached script each</td></tr>
  <tr><td>Projectiles</td><td>6 in flight at once</td></tr>
  <tr><td>Scene stack</td><td>8 pushed scenes deep</td></tr>
  <tr><td>Collision groups</td><td>3, plus the player</td></tr>
  <tr><td>Animation states</td><td>4 per sprite</td></tr>
  <tr><td>Switch options</td><td>8, plus Else</td></tr>
  <tr><td>Drawn text</td><td>4 pieces on screen at once</td></tr>
  <tr><td>Value in text</td><td>reserves 3 characters when wrapping</td></tr>
</table>
<p class="hint">Your game only carries the engine features it actually uses: a game with no
overlay has no overlay code in its sketch, and the same goes for projectiles, expressions,
save games, music, menus, scene stack and fades. That is why the exported sketch grows as you
reach for new kinds of event, and why using everything at once leaves the least room.</p>
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
