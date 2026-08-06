// Minimal ArduboyTones stub for host g++ syntax checks (see Arduboy2.h stub).
#pragma once
#include <cstdint>

#define TONES_END 0x8000
#define TONES_REPEAT 0x8001
#define TONE_HIGH_VOLUME 0x8000
#define NOTE_REST 0

class ArduboyTones {
 public:
  ArduboyTones(bool (*outEn)());
  ArduboyTones(bool enabled);
  static void tone(uint16_t freq, uint16_t dur);
  static void tone(uint16_t freq1, uint16_t dur1, uint16_t freq2, uint16_t dur2);
  static void tones(const uint16_t* tones);
  static void tonesInRAM(uint16_t* tones);
  static void noTone();
  static void volumeMode(uint8_t mode);
  static bool playing();
};
