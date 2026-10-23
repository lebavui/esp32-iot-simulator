// Compiler entry point: source -> { code, warnings } or throws CompileError.
import { preprocessAndTokenize, CompileError } from './lexer.js';
import { parse } from './parser.js';
import { generate } from './codegen.js';
import { LIBS } from '../runtime/libs.js';
import { JSON_VALUE_TYPES } from '../runtime/meta.js';

const EXTRA_TYPES = ['TaskHandle_t', 'SemaphoreHandle_t', 'QueueHandle_t', 'TimerHandle_t', 'hw_timer_t', 'portMUX_TYPE',
  'esp_err_t', 'TickType_t', 'BaseType_t', 'UBaseType_t', 'time_t'];

const SUPPORTED_HEADERS = [
  'Arduino.h', 'WiFi.h', 'HTTPClient.h', 'PubSubClient.h', 'ArduinoJson.h', 'Wire.h', 'LiquidCrystal_I2C.h',
  'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'DHT.h', 'DHTesp.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'ESP32Servo.h', 'Servo.h',
  'Adafruit_NeoPixel.h', 'Preferences.h', 'time.h', 'WiFiClient.h', 'WiFiClientSecure.h', 'SPI.h', 'math.h', 'stdio.h',
  'stdlib.h', 'string.h', 'esp_system.h', 'freertos/FreeRTOS.h', 'freertos/task.h', 'esp_wifi.h', 'WiFiMulti.h', 'esp_timer.h',
];

export function compile(source) {
  const { tokens, includes } = preprocessAndTokenize(source);
  const ast = parse(tokens, [...Object.keys(LIBS), ...JSON_VALUE_TYPES, ...EXTRA_TYPES]);
  const { code, warnings } = generate(ast, LIBS);
  for (const inc of includes) {
    if (!SUPPORTED_HEADERS.includes(inc.name)) warnings.push({ msg: `#include <${inc.name}>: thư viện này chưa được trình giả lập hỗ trợ đầy đủ`, line: inc.line });
  }
  return { code, warnings };
}
export { CompileError };
