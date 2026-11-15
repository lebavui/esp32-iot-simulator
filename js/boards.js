// Microcontroller boards and their chips: header pin → GPIO map, chip capabilities used by the runtime's checks,
// and the Arduino variant constants (pins_arduino.h of arduino-esp32 3.3.x) the compiler inlines.
// DOM-free: used by the compiler, runtime, circuit solver and part definitions.

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const CHIPS = {
  esp32: {
    name: 'ESP32', model: 'ESP32-D0WD-V3', revision: 3, cores: 2, mhz: 240,
    gpios: [0, 1, 2, 3, 4, 5, ...range(12, 19), 21, 22, 23, 25, 26, 27, ...range(32, 39)],
    flash: range(6, 11), inputOnly: range(34, 39),
    adc1: range(32, 39), adc2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27], adc2Note: 'wifi', // ADC2 blocked while WiFi is on
    touch: true, hall: true,
    banner: 'ets Jun  8 2016 00:22:57\r\n\r\nrst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\r\n' +
      'configsip: 0, SPIWP:0xee\r\nclk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00\r\n' +
      'mode:DIO, clock div:2\r\nload:0x3fff0030,len:1156\r\nload:0x40078000,len:11456\r\nentry 0x400805a4\r\n',
  },
  esp32c3: {
    name: 'ESP32-C3', model: 'ESP32-C3', revision: 4, cores: 1, mhz: 160,
    gpios: [...range(0, 10), ...range(18, 21)],
    flash: range(11, 17), inputOnly: [],
    // ADC2 (GPIO5) is not usable on the C3 (hardware erratum; the core refuses it)
    adc1: range(0, 4), adc2: [5], adc2Note: 'unusable',
    touch: false, hall: false,
    banner: 'ESP-ROM:esp32c3-api1-20210207\r\nBuild:Feb  7 2021\r\nrst:0x1 (POWERON),boot:0xc (SPI_FAST_FLASH_BOOT)\r\n' +
      'SPIWP:0xee\r\nmode:DIO, clock div:1\r\nload:0x3fcd5820,len:0x118c\r\nload:0x403cbf10,len:0xb9c\r\n' +
      'load:0x403ce710,len:0x2f68\r\nentry 0x403cbf1a\r\n',
  },
  esp32c6: {
    name: 'ESP32-C6', model: 'ESP32-C6', revision: 0, cores: 1, mhz: 160,
    gpios: range(0, 23),
    flash: range(24, 30), inputOnly: [],
    adc1: range(0, 6), adc2: [], adc2Note: null, // a single ADC (ADC1, GPIO0-6)
    touch: false, hall: false,
    banner: 'ESP-ROM:esp32c6-20220919\r\nBuild:Sep 19 2022\r\nrst:0x1 (POWERON),boot:0x6c (SPI_FAST_FLASH_BOOT)\r\n' +
      'SPIWP:0xee\r\nmode:DIO, clock div:2\r\nload:0x4086c410,len:0xc18\r\nload:0x4086e610,len:0x2a3c\r\n' +
      'load:0x40875728,len:0x1658\r\nentry 0x4086c410\r\n',
  },
};

// Constants that come from a board's pins_arduino.h; boards other than the DevKit replace all of them.
const PIN_CONSTS = ['LED_BUILTIN', 'BUILTIN_LED', 'RGB_BUILTIN', 'SDA', 'SCL', 'TX', 'RX', 'MOSI', 'MISO', 'SCK', 'SS',
  'DAC1', 'DAC2', ...range(0, 19).map((i) => 'A' + i), ...range(0, 14).map((i) => 'T' + i)];
const seq = (prefix, gpios) => Object.fromEntries(gpios.map((g, i) => [prefix + i, g]));

export const ESP32_LEFT = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND.1', 'VIN'];
export const ESP32_RIGHT = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND.2', '3V3'];
const ESP32_GPIO = { VP: 36, VN: 39, TX0: 1, RX0: 3, TX2: 17, RX2: 16 };
for (const n of [...ESP32_LEFT, ...ESP32_RIGHT]) if (/^D\d+$/.test(n)) ESP32_GPIO[n] = Number(n.slice(1));

const XIAO_C3_D = [2, 3, 4, 5, 6, 7, 21, 20, 8, 9, 10];
const XIAO_C6_D = [0, 1, 2, 21, 22, 23, 16, 17, 19, 20, 18];
const XIAO_LEFT = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const XIAO_RIGHT = ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7'];

export const BOARDS = {
  'esp32-iot-esp32-devkit-v1': {
    label: 'ESP32 DevKit V1', chip: 'esp32', left: ESP32_LEFT, right: ESP32_RIGHT, gpio: ESP32_GPIO,
    power: { 'GND.1': 0, 'GND.2': 0, '3V3': 3.3, VIN: 5 },
    led: { gpio: 2, activeLow: false }, buzzer: 4, consts: null, // the defaults in runtime/meta.js are the DevKit's
    // header GPIOs preferred when a project is moved to this board (port.js): general I/O, then ADC inputs
    prefer: { digital: [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 15, 12], analog: [34, 35, 32, 33, 36, 39] },
    defines: ['ARDUINO_ESP32_DEV', 'CONFIG_IDF_TARGET_ESP32'],
  },
  'board-xiao-esp32-c3': {
    label: 'Seeed XIAO ESP32-C3', chip: 'esp32c3', left: XIAO_LEFT, right: XIAO_RIGHT,
    gpio: seq('D', XIAO_C3_D), power: { GND: 0, '3V3': 3.3, '5V': 5 },
    led: null, boot: { gpio: 9 }, buzzer: 5, // no user LED; BOOT button = GPIO9 (D9); buzzer on D3 (XIAO expansion board)
    prefer: { digital: [3, 4, 5, 10, 2, 21, 20, 8, 6, 7], analog: [2, 3, 4] },
    consts: { TX: 21, RX: 20, SDA: 6, SCL: 7, SS: 20, MOSI: 10, MISO: 9, SCK: 8, A0: 2, A1: 3, A2: 4, ...seq('D', XIAO_C3_D) },
    defines: ['ARDUINO_XIAO_ESP32C3', 'CONFIG_IDF_TARGET_ESP32C3'],
  },
  'board-xiao-esp32-c6': {
    label: 'Seeed XIAO ESP32-C6', chip: 'esp32c6', left: XIAO_LEFT, right: XIAO_RIGHT,
    gpio: seq('D', XIAO_C6_D), power: { GND: 0, '3V3': 3.3, '5V': 5 },
    // user LED (yellow) GPIO15, lit when LOW, and BOOT button GPIO9: neither is on the header; buzzer on D3 (XIAO expansion board)
    led: { gpio: 15, activeLow: true }, boot: { gpio: 9 }, buzzer: 21,
    prefer: { digital: [0, 1, 2, 21, 16, 17, 18, 19, 20, 22, 23], analog: [0, 1, 2] },
    consts: {
      LED_BUILTIN: 15, BUILTIN_LED: 15, TX: 16, RX: 17, SDA: 22, SCL: 23, SS: 21, MOSI: 18, MISO: 20, SCK: 19,
      A0: 0, A1: 1, A2: 2, ...seq('D', XIAO_C6_D),
    },
    defines: ['ARDUINO_XIAO_ESP32C6', 'CONFIG_IDF_TARGET_ESP32C6'],
  },
};
// board types removed from the simulator → the board that replaces them in a loaded project
export const LEGACY_BOARDS = { 'board-xiao-esp32-s3': 'board-xiao-esp32-c6' };
export const DEFAULT_BOARD = 'esp32-iot-esp32-devkit-v1';
export const isBoard = (type) => !!BOARDS[type];

// Board description + its chip, for a part type (DevKit when unknown, e.g. in the Node tests without a diagram)
export function boardInfo(type) {
  const b = BOARDS[type] || BOARDS[DEFAULT_BOARD];
  return { type: BOARDS[type] ? type : DEFAULT_BOARD, ...b, chip: CHIPS[b.chip] };
}

// Overrides of runtime/meta.js CONSTS for a board: null removes a constant ("was not declared in this scope")
export function boardConsts(type) {
  const b = BOARDS[type];
  if (!b || !b.consts) return {};
  return { ...Object.fromEntries(PIN_CONSTS.map((n) => [n, null])), ...Object.fromEntries(Object.entries(b.consts).map(([k, v]) => [k, [v, 'int']])) };
}
