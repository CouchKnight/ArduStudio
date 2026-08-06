// Minimal Arduboy2/Arduino stub used ONLY to syntax-check generated sketches
// with a host g++ (tools/check_codegen.mjs). It mirrors the API surface the
// ArduStudio code generator emits — it is not a functional implementation.
#pragma once
#include <cstdint>
#include <cstring>

#define PROGMEM
#define pgm_read_byte(addr) (*(const uint8_t*)(addr))
#define pgm_read_word(addr) (*(const uint16_t*)(addr))
#define pgm_read_ptr(addr) (*(void* const*)(addr))
#define memcpy_P ::memcpy

#define WHITE 1
#define BLACK 0
#define INVERT 2

#define LEFT_BUTTON 32
#define RIGHT_BUTTON 64
#define UP_BUTTON 128
#define DOWN_BUTTON 16
#define A_BUTTON 8
#define B_BUTTON 4

#define WIDTH 128
#define HEIGHT 64

long random(long howbig);
long random(long howsmall, long howbig);

template <typename T> T min(T a, T b) { return a < b ? a : b; }
template <typename T> T max(T a, T b) { return a > b ? a : b; }

class Arduboy2 {
 public:
  uint16_t frameCount;
  void begin();
  void setFrameRate(uint8_t rate);
  bool nextFrame();
  void pollButtons();
  bool pressed(uint8_t buttons);
  bool justPressed(uint8_t button);
  bool justReleased(uint8_t button);
  void initRandomSeed();
  void clear();
  void display();
  void drawPixel(int16_t x, int16_t y, uint8_t color);
  void drawRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color);
  void fillRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color);
  void drawChar(int16_t x, int16_t y, unsigned char c, uint8_t color, uint8_t bg, uint8_t size);
  void setCursor(int16_t x, int16_t y);
  static const PROGMEM uint8_t font5x7[];
};

class Sprites {
 public:
  static void drawOverwrite(int16_t x, int16_t y, const uint8_t* bitmap, uint8_t frame);
  static void drawSelfMasked(int16_t x, int16_t y, const uint8_t* bitmap, uint8_t frame);
  static void drawErase(int16_t x, int16_t y, const uint8_t* bitmap, uint8_t frame);
  static void drawExternalMask(int16_t x, int16_t y, const uint8_t* bitmap, const uint8_t* mask, uint8_t frame, uint8_t mask_frame);
  static void drawPlusMask(int16_t x, int16_t y, const uint8_t* bitmap, uint8_t frame);
};

class BeepPin1 {
 public:
  void begin();
  void timer();
  static void tone(uint16_t count);
  static void tone(uint16_t count, uint8_t dur);
  static void noTone();
  static constexpr uint16_t freq(const float hz) { return (uint16_t)(500000 / hz - 1); }
};
