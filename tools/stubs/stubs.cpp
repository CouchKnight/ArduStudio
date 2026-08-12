// Empty bodies for everything the stub headers declare, so generated sketches
// can be *linked* rather than only syntax-checked.
//
// That matters because engine subsystems are stripped from the sketch when a
// game does not use them (the //#IF regions in js/codegen.js). A helper that
// ends up inside the wrong region still parses perfectly — the calls to it are
// declared — and only fails at link time with "undefined reference". Syntax
// checking alone let exactly that bug through to the AVR build once.
//
// Nothing here needs to do anything: the linker only has to find the symbols.

#include <Arduboy2.h>
#include <ArduboyTones.h>
#include <EEPROM.h>

long random(long howbig) { return howbig ? 0 : 0; }
long random(long howsmall, long howbig) { return howbig > howsmall ? howsmall : howsmall; }

bool Arduboy2Audio::enabled() { return true; }
void Arduboy2Audio::on() {}
void Arduboy2Audio::off() {}
void Arduboy2Audio::toggle() {}
void Arduboy2Audio::saveOnOff() {}

const uint8_t Arduboy2::font5x7[] = { 0 };

void Arduboy2::begin() {}
void Arduboy2::setFrameRate(uint8_t) {}
bool Arduboy2::nextFrame() { return true; }
void Arduboy2::pollButtons() {}
bool Arduboy2::pressed(uint8_t) { return false; }
bool Arduboy2::justPressed(uint8_t) { return false; }
bool Arduboy2::justReleased(uint8_t) { return false; }
void Arduboy2::initRandomSeed() {}
void Arduboy2::setRGBled(uint8_t, uint8_t, uint8_t) {}
void Arduboy2::setRGBled(uint8_t, uint8_t) {}
void Arduboy2::freeRGBled() {}
void Arduboy2::digitalWriteRGB(uint8_t, uint8_t, uint8_t) {}
void Arduboy2::digitalWriteRGB(uint8_t, uint8_t) {}
void Arduboy2::clear() {}
void Arduboy2::display() {}
uint8_t* Arduboy2::getBuffer() { static uint8_t buf[WIDTH * HEIGHT / 8]; return buf; }
void Arduboy2::drawPixel(int16_t, int16_t, uint8_t) {}
void Arduboy2::drawRect(int16_t, int16_t, uint8_t, uint8_t, uint8_t) {}
void Arduboy2::fillRect(int16_t, int16_t, uint8_t, uint8_t, uint8_t) {}
void Arduboy2::drawChar(int16_t, int16_t, unsigned char, uint8_t, uint8_t, uint8_t) {}
void Arduboy2::setCursor(int16_t, int16_t) {}

void Sprites::drawOverwrite(int16_t, int16_t, const uint8_t*, uint8_t) {}
void Sprites::drawSelfMasked(int16_t, int16_t, const uint8_t*, uint8_t) {}
void Sprites::drawErase(int16_t, int16_t, const uint8_t*, uint8_t) {}
void Sprites::drawExternalMask(int16_t, int16_t, const uint8_t*, const uint8_t*, uint8_t, uint8_t) {}
void Sprites::drawPlusMask(int16_t, int16_t, const uint8_t*, uint8_t) {}

void BeepPin1::begin() {}
void BeepPin1::timer() {}
void BeepPin1::tone(uint16_t) {}
void BeepPin1::tone(uint16_t, uint8_t) {}
void BeepPin1::noTone() {}

ArduboyTones::ArduboyTones(bool (*)()) {}
ArduboyTones::ArduboyTones(bool) {}
void ArduboyTones::tone(uint16_t, uint16_t) {}
void ArduboyTones::tone(uint16_t, uint16_t, uint16_t, uint16_t) {}
void ArduboyTones::tones(const uint16_t*) {}
void ArduboyTones::tonesInRAM(uint16_t*) {}
void ArduboyTones::noTone() {}
void ArduboyTones::volumeMode(uint8_t) {}
bool ArduboyTones::playing() { return false; }

EEPROMClass EEPROM;
uint8_t EEPROMClass::read(int) { return 0; }
void EEPROMClass::write(int, uint8_t) {}
void EEPROMClass::update(int, uint8_t) {}

// The sketch supplies these, exactly as an Arduino sketch does. Referencing
// them from a main() the linker needs anyway also proves both exist. The
// binary is never run — only linked.
void setup();
void loop();
int main() { setup(); loop(); return 0; }
