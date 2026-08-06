#!/usr/bin/env bash
# Full hardware-target verification: compiles the demo project's generated
# sketch with avr-gcc against the REAL Arduboy2 library and Arduino AVR core,
# producing a flashable game.hex for the ATmega32u4 (Arduboy / FX / FX-C).
#
# Requirements: avr-gcc + avr-libc (apt: gcc-avr avr-libc), node, curl.
# Normal users don't need this — export the .ino and use the Arduino IDE.
#
# Usage: tools/build_avr.sh [output-dir]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/build-avr}"
CORE_URL="https://raw.githubusercontent.com/arduino/ArduinoCore-avr/1.8.6"
AB2_URL="https://raw.githubusercontent.com/MLXXXp/Arduboy2/master/src"
TONES_URL="https://raw.githubusercontent.com/MLXXXp/ArduboyTones/master/src"

mkdir -p "$OUT/core" "$OUT/ab2" "$OUT/tones" "$OUT/obj"

fetch() { # fetch <url> <dest> — skip if already present
  [ -s "$2" ] || curl -sSL ${CURL_CA_BUNDLE:+--cacert "$CURL_CA_BUNDLE"} -o "$2" "$1"
}

echo "== fetching Arduino AVR core 1.8.6 =="
CORE_FILES="Arduino.h binary.h WCharacter.h WString.h WString.cpp Print.h Print.cpp Printable.h \
Stream.h Stream.cpp HardwareSerial.h HardwareSerial.cpp HardwareSerial_private.h \
HardwareSerial0.cpp HardwareSerial1.cpp HardwareSerial2.cpp HardwareSerial3.cpp \
USBAPI.h USBCore.h USBCore.cpp USBDesc.h CDC.cpp PluggableUSB.h PluggableUSB.cpp \
IPAddress.h IPAddress.cpp abi.cpp main.cpp wiring.c wiring_digital.c wiring_analog.c \
wiring_pulse.c wiring_shift.c WInterrupts.c hooks.c wiring_private.h WMath.cpp \
Client.h Server.h Udp.h"
for f in $CORE_FILES; do fetch "$CORE_URL/cores/arduino/$f" "$OUT/core/$f"; done
fetch "$CORE_URL/variants/leonardo/pins_arduino.h" "$OUT/core/pins_arduino.h"
fetch "$CORE_URL/libraries/EEPROM/src/EEPROM.h" "$OUT/core/EEPROM.h"
# core/new.cpp needs libstdc++ headers the apt avr toolchain lacks; Arduboy2
# doesn't use heap allocation, so it is intentionally omitted.

echo "== fetching Arduboy2 library =="
AB2_FILES="Arduboy2.h Arduboy2.cpp Arduboy2Audio.h Arduboy2Audio.cpp Arduboy2Beep.h \
Arduboy2Beep.cpp Arduboy2Core.h Arduboy2Core.cpp Arduboy2Data.cpp Sprites.h Sprites.cpp \
SpritesB.h SpritesB.cpp SpritesCommon.h"
for f in $AB2_FILES; do fetch "$AB2_URL/$f" "$OUT/ab2/$f"; done

echo "== fetching ArduboyTones library =="
for f in ArduboyTones.h ArduboyTones.cpp ArduboyTonesPitches.h; do
  fetch "$TONES_URL/$f" "$OUT/tones/$f"
done
# EEPROM.h lives in the core's libraries dir; the sketch includes it directly.
fetch "$CORE_URL/libraries/EEPROM/src/EEPROM.h" "$OUT/tones/EEPROM.h"

echo "== generating sketch from demo project =="
node -e "
import('$ROOT/js/model.js').then(async (model) => {
  const codegen = await import('$ROOT/js/codegen.js');
  const { ino } = codegen.generateIno(model.makeDemoProject());
  require('fs').writeFileSync('$OUT/sketch.cpp', ino);
  console.log('sketch.cpp written:', ino.length, 'chars');
});"

echo "== compiling for ATmega32u4 =="
CFLAGS="-c -g -Os -w -ffunction-sections -fdata-sections -mmcu=atmega32u4 \
-DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_LEONARDO -DARDUINO_ARCH_AVR \
-DUSB_VID=0x2341 -DUSB_PID=0x8036 -DUSB_MANUFACTURER=\"ArduinoLLC\" -DUSB_PRODUCT=\"Leonardo\" \
-I$OUT/core -I$OUT/ab2 -I$OUT/tones"
rm -f "$OUT/obj/"*
for f in "$OUT"/core/*.c; do
  avr-gcc $CFLAGS -std=gnu11 "$f" -o "$OUT/obj/$(basename "$f").o"
done
for f in "$OUT"/core/*.cpp "$OUT"/ab2/*.cpp "$OUT"/tones/*.cpp "$OUT/sketch.cpp"; do
  avr-g++ $CFLAGS -std=gnu++11 -fpermissive -fno-exceptions -fno-threadsafe-statics \
    "$f" -o "$OUT/obj/$(basename "$f").o"
done

echo "== linking =="
avr-gcc -w -Os -g -Wl,--gc-sections -mmcu=atmega32u4 -o "$OUT/game.elf" "$OUT/obj/"*.o -lm
avr-objcopy -O ihex -R .eeprom "$OUT/game.elf" "$OUT/game.hex"
avr-size "$OUT/game.elf"
echo "OK: $OUT/game.hex is flashable to an Arduboy / FX / FX-C."
