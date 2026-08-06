# ArduStudio

**A visual game maker for the [Arduboy FX‑C](https://www.arduboy.com/shop/p/arduboy-fx-c)** (and the original
Arduboy / Arduboy FX), in the spirit of [GB Studio](https://www.gbstudio.dev) and
[Bitsy](https://make.bitsy.org): paint scenes, place characters, script them with visual event
blocks, play-test instantly in the browser — then export a real Arduino sketch and flash it to
the hardware.

![Scene editor](docs/shot_actor.png)

No installation, no build step, no dependencies: it's a static web app.

```bash
# from the repo root — any static file server works
npx http-server .        # then open http://localhost:8080
# or: python3 -m http.server
```

> Opening `index.html` directly with `file://` won't work in most browsers because the app uses
> ES modules — serve the folder instead (two keystrokes with `npx http-server`).

The app boots with **Key Quest**, a complete little demo adventure (dialogue, branching, variables,
item fetching, tile swapping, music, a scripted actor move, and a two-screen scrolling lake). Play it
in the **▶ Play** tab, then pick it apart to see how everything is wired.

## What you get

| Tab | What it does |
|---|---|
| **Scenes** | Paint tile maps — one Arduboy screen (Bitsy-style) or up to 4×4 screens that **scroll** to follow the player. Place actors, drag trigger areas, set the player start. Inspector edits the selected entity and its script. |
| **Tiles** | 1-bit 8×8 pixel editor with solid/walkable flag, flip/shift/invert tools. |
| **Sprites** | Animated sprites (up to 4 frames; 8×8, 16×8, 8×16, 16×16) with live preview. |
| **Audio** | Compose songs and sound effects as ArduboyTones sequences. Note-name or raw-Hz entry, browser preview, retro presets, and import/export as `.song.json` or a `PROGMEM` C array. |
| **Variables** | Central manager for all 32 byte variables, with live usage tracking showing every script that reads or writes each one. |
| **Image Tool** | PNG → 1-bit converter (threshold + invert). Import as tiles or a sprite, or copy a `PROGMEM` C array in the standard Arduboy vertical-byte format. |
| **▶ Play** | Full play-test emulator at 60 fps with sound and a live variable watch. Runs the *same bytecode* as the exported game and renders text with the genuine Arduboy2 `font5x7`. |
| **Export** | One click → complete `.ino` sketch. Also project save/load as JSON (plus localStorage autosave). |
| **Help** | The manual: workflow, scripting recipes, flashing instructions, limits. |

![Audio tab](docs/shot_audio.png)

### Visual scripting events

`Show Dialogue` (auto word-wrapped, paged), `Display Menu` (2–8 options, two layouts,
optional cancel), `Display Multiple Choice`, `If Variable… / Else`, `Set / Add Variable`,
`Change Scene`, `Teleport Player`, `Set Tile` (open doors, reveal passages), `Hide / Show Actor`,
`Move Actor` (walks and blocks the script until it arrives, or teleports), `Play Tone`,
`Play / Stop Song`, `Set RGB LED` (analog PWM or digital on/off), `Save Game`, `Load Game`,
`Save Exists → Var`, `Delete Save`, `Wait`, `Stop Script`. Scripts attach to actors
(on interact), triggers (on enter) and scenes (on enter).

### The game engine (on device and in the browser)

- Grid movement with smooth pixel interpolation; solid tiles and solid actors block.
- Scrolling camera for multi-screen scenes, clamped at map edges (single-screen scenes never scroll).
- Actors: static, random wander, horizontal / vertical patrol; frame animation.
- Face an actor and press **A** to run its script; walk onto a trigger to run its script.
- Dialogue box with typewriter effect, page breaks, A-to-advance (B skips the typewriter).
- 32 byte-sized variables drive all game logic.
- Music and SFX via **ArduboyTones**, with looping background tracks.
- Menus and yes/no prompts that write the player's answer into a variable.
- RGB LED feedback, analog (PWM brightness) or digital (on/off).
- Save games in EEPROM — variables, current scene and player position, surviving power-off.

Scripts compile to a compact bytecode. The browser emulator (`js/emulator.js`) and the C++ engine
embedded in the exported sketch (`js/codegen.js`) execute **the same bytes with the same update
order and constants**, so what you play-test is what ships.

![Play test](docs/shot_play.png)

A two-screen scrolling scene in the editor — green lines mark screen boundaries:

![Scrolling scene](docs/shot_scrolling.png)

## From project to hardware

1. **Export** tab → **⬇ Download .ino**.
2. Open it in the [Arduino IDE](https://www.arduino.cc/en/software), install the **Arduboy2** and
   **ArduboyTones** libraries (Library Manager), select board **Arduino Leonardo** (or **Arduboy**),
   and upload over USB‑C.
3. That's it — the sketch needs nothing beyond those two libraries and fits comfortably in the
   ATmega32u4's 28 KB (the Key Quest demo builds to ~18 KB including the USB stack).

## Repo layout

```
index.html, css/          app shell
js/model.js               project data model, default assets, songs, demo game
js/compiler.js            script → bytecode compiler (shared by emulator & export)
js/emulator.js            browser play-test runtime (Arduboy twin)
js/codegen.js             .ino generator (data + C++ engine)
js/font5x7.js             Arduboy2's font, extracted for pixel-identical text
js/*.js                   editor panels (scene, pixel, script, audio, variables, image, play, export)
tools/check_codegen.mjs   g++ syntax check of generated sketches (stub headers)
tools/test_runtime.mjs    scripted full playthrough of the demo in the emulator
tools/build_avr.sh        real avr-gcc build against real Arduboy2 → game.hex
```

## Verification

```bash
node tools/test_runtime.mjs     # 79 assertions: playthrough plus camera, saves, songs, menus, LED
node tools/check_codegen.mjs    # generated sketches pass g++ -Wall -Wextra
tools/build_avr.sh              # optional: full ATmega32u4 build (needs gcc-avr, avr-libc)
```

The AVR build compiles the generated sketch against the unmodified Arduboy2 and ArduboyTones
libraries and the Arduino AVR core, linking a flashable `game.hex` — verified at 19,610 bytes
flash / 1,705 bytes RAM.

## Editing

Undo/redo covers every edit — <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> (or the
↶ ↷ buttons), 100 steps deep, with a drag-paint stroke counting as one step. Projects autosave to
localStorage and can be saved to / loaded from JSON files.

## Limits

64 tiles · 32 sprites × 4 frames · 8 actors + 8 triggers per scene · 32 variables ·
32 songs × 192 notes · 256 dialogue strings · 8 options per menu (~9 chars each) ·
scenes from 1×1 to 4×4 screens (16×8 … 64×32 tiles) · 16 live `Set Tile` changes per scene.

Roadmap ideas: ArduboyFX data export for asset-heavy games, multiple save slots, `.arduboy` package
export, two-channel music.

## References

- [Arduboy2 library](https://github.com/MLXXXp/Arduboy2) — the standard Arduboy game library
- [Arduboy quick start](https://www.arduboy.com/quick-start)
- [Community graphics format tutorial](https://community.arduboy.com/t/make-your-own-arduboy-game-part-6-graphics/7929)
- [Arduboy image converters](https://community.arduboy.com/t/all-the-arduboy-image-converters/3568)
- [ArduboyTones](https://github.com/MLXXXp/ArduboyTones) — the tone-sequence library the Audio tab targets
- [Arduboy Cloud](https://cloud.arduboy.com) — browser IDE with its own music/SFX creators; same ArduboyTones format
- Other ecosystem libraries worth knowing: **ArduboyPlaytune**, **ArduboyFX**, **FixedPoints**, **ATMlib**

The bundled `js/font5x7.js` is extracted from the Arduboy2 library (BSD-3-Clause) so browser text
matches the device pixel-for-pixel.
