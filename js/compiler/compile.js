// Compiler entry point: source -> { code, warnings } or throws CompileError.
import { preprocessAndTokenize, CompileError } from './lexer.js';
import { parse } from './parser.js';
import { generate, INT_TYPES } from './codegen.js';
import { LIBS } from '../runtime/libs.js';
import { JSON_VALUE_TYPES } from '../runtime/meta.js';
import { BOARDS, DEFAULT_BOARD, boardConsts } from '../boards.js';

const EXTRA_TYPES = ['TaskHandle_t', 'SemaphoreHandle_t', 'QueueHandle_t', 'TimerHandle_t', 'hw_timer_t', 'portMUX_TYPE',
  'esp_err_t', 'TickType_t', 'BaseType_t', 'UBaseType_t', 'time_t'];

const SUPPORTED_HEADERS = [
  'Arduino.h', 'WiFi.h', 'HTTPClient.h', 'PubSubClient.h', 'ArduinoJson.h', 'Wire.h', 'LiquidCrystal_I2C.h',
  'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'DHT.h', 'DHTesp.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'ESP32Servo.h', 'Servo.h',
  'Adafruit_NeoPixel.h', 'Preferences.h', 'time.h', 'WiFiClient.h', 'WiFiClientSecure.h', 'SPI.h', 'math.h', 'stdio.h',
  'stdlib.h', 'string.h', 'esp_system.h', 'freertos/FreeRTOS.h', 'freertos/task.h', 'esp_wifi.h', 'WiFiMulti.h', 'esp_timer.h',
  'LoRa.h', 'esp_now.h', 'esp_mac.h', 'WiFiUdp.h', 'WiFiUDP.h', 'coap-simple.h',
  'OneWire.h', 'DallasTemperature.h', 'Adafruit_AHTX0.h', 'WebServer.h', 'freertos/queue.h', 'freertos/semphr.h',
];

// board: part type of the microcontroller board in the diagram (its pins_arduino.h constants and target macros)
export function compile(source, { board = DEFAULT_BOARD } = {}) {
  const b = BOARDS[board] || BOARDS[DEFAULT_BOARD];
  const consts = boardConsts(board);
  // like the variants' "#define LED_BUILTIN LED_BUILTIN", so #ifdef LED_BUILTIN works where the board has one
  const hasLed = b.consts ? b.consts.LED_BUILTIN != null : true;
  const defines = b.defines.map((d) => `#define ${d} 1\n`).join('') + (hasLed ? '#define LED_BUILTIN LED_BUILTIN\n' : '');
  const { tokens, includes } = preprocessAndTokenize(source, defines);
  const ast = parse(tokens, [...Object.keys(LIBS), ...JSON_VALUE_TYPES, ...EXTRA_TYPES, ...INT_TYPES]);
  const { code, warnings } = generate(ast, LIBS, consts);
  for (const inc of includes) {
    if (!SUPPORTED_HEADERS.includes(inc.name)) warnings.push({ msg: `#include <${inc.name}>: thư viện này chưa được trình giả lập hỗ trợ đầy đủ`, line: inc.line });
  }
  return { code, warnings };
}
export { CompileError };
