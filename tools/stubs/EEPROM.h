// Minimal Arduino EEPROM stub for host g++ syntax checks.
#pragma once
#include <cstdint>

#define EEPROM_STORAGE_SPACE_START 16

class EEPROMClass {
 public:
  uint8_t read(int addr);
  void write(int addr, uint8_t value);
  void update(int addr, uint8_t value);
};

extern EEPROMClass EEPROM;
