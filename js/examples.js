// Example projects: Arduino sketch + diagram (Wokwi-like diagram.json format).
// ESP32 is at (0,0). Right header pins x=116: D23 y60, D22 72, TX0 84, RX0 96, D21 108, D19 120, D18 132, D5 144,
// TX2 156, RX2 168, D4 180, D2 192, D15 204, GND.2 216, 3V3 228. Left header x=8: VP 72 ... GND.1 216, VIN 228.

const ESP = { type: 'wokwi-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} };
const C = (from, to, color, points) => (points ? [from, to, color, points] : [from, to, color]);

const LED_D4 = {
  parts: [
    { type: 'wokwi-resistor', id: 'r1', top: 174, left: 140, attrs: { value: '220' } },
    { type: 'wokwi-led', id: 'led1', top: 110, left: 230, attrs: { color: 'red' } },
  ],
  conns: [
    C('esp:D4', 'r1:1', 'green', []),
    C('r1:2', 'led1:A', 'green', [[240, 180]]),
    C('led1:C', 'esp:GND.2', 'black', [[250, 248], [132, 248], [132, 216]]),
  ],
};

const DHT_LCD_PARTS = [
  { type: 'wokwi-lcd1602', id: 'lcd1', top: -60, left: 200, attrs: { size: '16x2', address: '0x27', color: 'green' } },
  { type: 'wokwi-dht22', id: 'dht1', top: 120, left: 260, attrs: { temperature: 28.5, humidity: 65 } },
];
const LCD_CONNS = [
  C('esp:D21', 'lcd1:SDA', 'blue', [[170, 108], [170, -12]]),
  C('esp:D22', 'lcd1:SCL', 'yellow', [[160, 72], [160, -2]]),
  C('esp:3V3', 'lcd1:VCC', 'red', [[190, 228], [190, -22]]),
  C('esp:GND.2', 'lcd1:GND', 'black', [[180, 216], [180, -32]]),
];
const DHT_CONNS = [
  C('esp:D15', 'dht1:SDA', 'green', [[276, 204]]),
  C('esp:3V3', 'dht1:VCC', 'red', [[268, 228]]),
  C('esp:GND.2', 'dht1:GND', 'black', [[292, 216]]),
];
const OLED_PARTS = [{ type: 'wokwi-ssd1306', id: 'oled1', top: -40, left: 200, attrs: { address: '0x3C' } }];
const OLED_CONNS = [
  C('esp:D21', 'oled1:SDA', 'blue', [[160, 108], [160, -55], [291, -55]]),
  C('esp:D22', 'oled1:SCL', 'yellow', [[150, 72], [150, -60], [277, -60]]),
  C('esp:3V3', 'oled1:VCC', 'red', [[175, 228], [175, -50], [263, -50]]),
  C('esp:GND.2', 'oled1:GND', 'black', [[185, 216], [185, -45], [249, -45]]),
];
const POT_LEFT = {
  parts: [{ type: 'wokwi-potentiometer', id: 'pot1', top: 150, left: -110, attrs: { value: 512 } }],
  conns: [
    C('esp:D34', 'pot1:SIG', 'green', [[-30, 96], [-30, 245], [-82, 245]]),
    C('esp:3V3', 'pot1:VCC', 'red', [[130, 228], [130, 275], [-66, 275]]),
    C('esp:GND.1', 'pot1:GND', 'black', [[-20, 216], [-20, 255], [-98, 255]]),
  ],
};

function diagram(parts, conns) {
  return { version: 1, author: 'ESP32 IoT Simulator', editor: 'esp32-iot-sim', parts: [ESP, ...parts], connections: conns };
}

export const EXAMPLES = [
  {
    id: 'blink', name: '01. Blink – Nháy LED', category: 'Cơ bản',
    code: `// Nháy LED ngoài (GPIO4) và LED trên board (GPIO2)
#define LED_PIN 4

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("Blink bắt đầu!");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED OFF");
  delay(500);
}
`,
    diagram: diagram(LED_D4.parts, LED_D4.conns),
  },
  {
    id: 'button', name: '02. Nút nhấn bật/tắt LED', category: 'Cơ bản',
    code: `// Nhấn nút (GPIO15, INPUT_PULLUP) để đảo trạng thái LED (GPIO4)
const int BUTTON_PIN = 15;
const int LED_PIN = 4;

bool ledState = false;
int lastButton = HIGH;
unsigned long lastDebounce = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastButton && millis() - lastDebounce > 50) {
    lastDebounce = millis();
    if (reading == LOW) {           // nút được nhấn (kéo xuống GND)
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState);
      Serial.printf("Nhấn nút -> LED %s\\n", ledState ? "BẬT" : "TẮT");
    }
    lastButton = reading;
  }
  delay(10);
}
`,
    diagram: diagram([...LED_D4.parts, { type: 'wokwi-pushbutton', id: 'btn1', top: 160, left: 290, attrs: { color: 'green' } }],
      [...LED_D4.conns,
        C('esp:D15', 'btn1:1', 'blue', [[298, 204]]),
        C('esp:GND.2', 'btn1:2', 'black', [[132, 216], [132, 256], [318, 256]])]),
  },
  {
    id: 'traffic', name: '03. Đèn giao thông', category: 'Cơ bản',
    code: `// Đèn giao thông: đỏ (GPIO25), vàng (GPIO26), xanh (GPIO27)
const int RED = 25, YELLOW = 26, GREEN = 27;

void setLights(int r, int y, int g) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
}

void setup() {
  Serial.begin(115200);
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  Serial.println("ĐỎ - dừng lại");
  setLights(HIGH, LOW, LOW);
  delay(3000);
  Serial.println("XANH - được đi");
  setLights(LOW, LOW, HIGH);
  delay(3000);
  Serial.println("VÀNG - chú ý");
  for (int i = 0; i < 3; i++) {
    setLights(LOW, HIGH, LOW);
    delay(400);
    setLights(LOW, LOW, LOW);
    delay(300);
  }
}
`,
    diagram: diagram([
      { type: 'wokwi-led', id: 'led1', top: 60, left: -190, attrs: { color: 'red' } },
      { type: 'wokwi-led', id: 'led2', top: 60, left: -150, attrs: { color: 'yellow' } },
      { type: 'wokwi-led', id: 'led3', top: 60, left: -110, attrs: { color: 'green' } },
      { type: 'wokwi-resistor', id: 'r1', top: 138, left: -80, attrs: { value: '220' } },
      { type: 'wokwi-resistor', id: 'r2', top: 150, left: -80, attrs: { value: '220' } },
      { type: 'wokwi-resistor', id: 'r3', top: 162, left: -80, attrs: { value: '220' } },
    ], [
      C('esp:D25', 'r1:2', 'green', []), C('esp:D26', 'r2:2', 'green', []), C('esp:D27', 'r3:2', 'green', []),
      C('r1:1', 'led1:A', 'orange', [[-180, 144]]), C('r2:1', 'led2:A', 'orange', [[-140, 156]]), C('r3:1', 'led3:A', 'orange', [[-100, 168]]),
      C('led1:C', 'esp:GND.1', 'black', [[-170, 235], [-20, 235], [-20, 216]]),
      C('led2:C', 'esp:GND.1', 'black', [[-130, 235]]),
      C('led3:C', 'esp:GND.1', 'black', [[-90, 235]]),
    ]),
  },
  {
    id: 'pot-pwm', name: '04. Biến trở + PWM điều chỉnh độ sáng', category: 'Cơ bản',
    code: `// Đọc biến trở (GPIO34 – ADC1) và điều chỉnh độ sáng LED bằng PWM (GPIO18)
const int POT_PIN = 34;
const int LED_PIN = 18;

void setup() {
  Serial.begin(115200);
  ledcAttach(LED_PIN, 5000, 8);   // API Arduino-ESP32 3.x: tần số 5kHz, 8 bit
}

void loop() {
  int raw = analogRead(POT_PIN);              // 0..4095
  int duty = map(raw, 0, 4095, 0, 255);
  float volt = raw * 3.3 / 4095.0;
  ledcWrite(LED_PIN, duty);
  Serial.printf("ADC=%4d  U=%.2fV  duty=%3d\\n", raw, volt, duty);
  delay(200);
}
`,
    diagram: diagram([
      ...POT_LEFT.parts,
      { type: 'wokwi-resistor', id: 'r1', top: 126, left: 140, attrs: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', top: 60, left: 230, attrs: { color: 'blue' } },
    ], [
      ...POT_LEFT.conns,
      C('esp:D18', 'r1:1', 'green', []),
      C('r1:2', 'led1:A', 'green', [[240, 132]]),
      C('led1:C', 'esp:GND.2', 'black', [[250, 248], [132, 248], [132, 216]]),
    ]),
  },
  {
    id: 'sevenseg', name: '05. LED 7 đoạn đếm 0–9', category: 'Hiển thị',
    code: `// LED 7 đoạn (cathode chung): đếm 0..9
//              A   B   C   D   E   F   G
const int SEG[7] = {23, 22, 21, 19, 18, 5, 4};
const int DP = 15;

const byte DIGITS[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

void showDigit(int d) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(SEG[i], bitRead(DIGITS[d], i));
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 7; i++) pinMode(SEG[i], OUTPUT);
  pinMode(DP, OUTPUT);
}

void loop() {
  for (int d = 0; d <= 9; d++) {
    showDigit(d);
    digitalWrite(DP, d % 2);
    Serial.print("Số: ");
    Serial.println(d);
    delay(700);
  }
}
`,
    diagram: diagram([
      { type: 'wokwi-7segment', id: 'sevseg1', top: -80, left: 250, attrs: { common: 'cathode', color: 'red' } },
    ], [
      C('esp:D23', 'sevseg1:A', 'green', [[335, 60], [335, -95], [290, -95]]),
      C('esp:D22', 'sevseg1:B', 'green', [[345, 72], [345, -100], [300, -100]]),
      C('esp:D21', 'sevseg1:C', 'green', [[290, 108]]),
      C('esp:D19', 'sevseg1:D', 'green', [[270, 120]]),
      C('esp:D18', 'sevseg1:E', 'green', [[260, 132]]),
      C('esp:D5', 'sevseg1:F', 'green', [[355, 144], [355, -105], [270, -105]]),
      C('esp:D4', 'sevseg1:G', 'green', [[365, 180], [365, -110], [260, -110]]),
      C('esp:D15', 'sevseg1:DP', 'purple', [[300, 204]]),
      C('esp:GND.2', 'sevseg1:COM.2', 'black', [[230, 216], [230, 30], [280, 30]]),
    ]),
  },
  {
    id: 'lcd-dht', name: '06. DHT22 + LCD 16x2 I2C', category: 'Hiển thị',
    code: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

#define DHTPIN 15
#define DHTTYPE DHT22

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(DHTPIN, DHTTYPE);

byte degree[8] = {0b01100, 0b10010, 0b10010, 0b01100, 0, 0, 0, 0};

void setup() {
  Serial.begin(115200);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, degree);
  lcd.setCursor(0, 0);
  lcd.print("ESP32 + DHT22");
  delay(1000);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Lỗi đọc DHT22!");
    lcd.clear();
    lcd.print("DHT error");
    delay(2000);
    return;
  }
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Nhiet do: ");
  lcd.print(t, 1);
  lcd.write(0);
  lcd.print("C");
  lcd.setCursor(0, 1);
  lcd.print("Do am:    ");
  lcd.print(h, 1);
  lcd.print("%");
  Serial.printf("T = %.1f C, H = %.1f %%\\n", t, h);
  delay(2000);
}
`,
    diagram: diagram(DHT_LCD_PARTS, [...LCD_CONNS, ...DHT_CONNS]),
  },
  {
    id: 'oled', name: '07. OLED SSD1306 đồ họa', category: 'Hiển thị',
    code: `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

int frame = 0;

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(10, 20);
  display.println("Hello IoT");
  display.display();
  delay(1500);
}

void loop() {
  display.clearDisplay();
  display.drawRect(0, 0, 128, 64, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(4, 4);
  display.print("Frame: ");
  display.println(frame);
  display.setCursor(4, 14);
  display.print("Uptime: ");
  display.print(millis() / 1000);
  display.print(" s");
  // con lắc
  float a = sin(frame * 0.15) * 0.9;
  int x = 64 + sin(a) * 30, y = 26 + cos(a) * 30;
  display.drawLine(64, 26, x, y, SSD1306_WHITE);
  display.fillCircle(x, y, 4, SSD1306_WHITE);
  // thanh tiến trình
  display.fillRect(100, 60 - (frame % 30), 20, frame % 30, SSD1306_WHITE);
  display.display();
  frame++;
  delay(50);
}
`,
    diagram: diagram(OLED_PARTS, OLED_CONNS),
  },
  {
    id: 'ultrasonic', name: '08. HC-SR04 đo khoảng cách + còi', category: 'Cảm biến',
    code: `// Đo khoảng cách bằng HC-SR04, còi kêu khi vật cản < 30 cm
const int TRIG = 18;
const int ECHO = 5;
const int BUZZER = 4;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

float readDistanceCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long duration = pulseIn(ECHO, HIGH, 30000);
  return duration * 0.0343 / 2;
}

void loop() {
  float d = readDistanceCm();
  Serial.print("Khoảng cách: ");
  Serial.print(d);
  Serial.println(" cm");
  if (d > 0 && d < 30) {
    tone(BUZZER, 1000, 100);
  }
  delay(500);
}
`,
    diagram: diagram([
      { type: 'wokwi-hc-sr04', id: 'ultrasonic1', top: -40, left: 180, attrs: { distance: 120 } },
      { type: 'wokwi-buzzer', id: 'bz1', top: 120, left: 300, attrs: {} },
    ], [
      C('esp:D18', 'ultrasonic1:TRIG', 'orange', [[231, 132]]),
      C('esp:D5', 'ultrasonic1:ECHO', 'purple', [[241, 144]]),
      C('esp:3V3', 'ultrasonic1:VCC', 'red', [[200, 228], [200, 40], [221, 40]]),
      C('esp:GND.2', 'ultrasonic1:GND', 'black', [[270, 216], [270, 40], [251, 40]]),
      C('esp:D4', 'bz1:2', 'green', [[325, 180]]),
      C('bz1:1', 'esp:GND.2', 'black', [[315, 195], [285, 195], [285, 216]]),
    ]),
  },
  {
    id: 'servo', name: '09. Servo điều khiển bằng biến trở', category: 'Chấp hành',
    code: `#include <ESP32Servo.h>

Servo myServo;
const int POT_PIN = 34;
const int SERVO_PIN = 18;

void setup() {
  Serial.begin(115200);
  myServo.setPeriodHertz(50);
  myServo.attach(SERVO_PIN, 500, 2400);
}

void loop() {
  int raw = analogRead(POT_PIN);
  int angle = map(raw, 0, 4095, 0, 180);
  myServo.write(angle);
  Serial.printf("Góc servo: %d°\\n", angle);
  delay(100);
}
`,
    diagram: diagram([
      ...POT_LEFT.parts,
      { type: 'wokwi-servo', id: 'servo1', top: 60, left: 200, attrs: {} },
    ], [
      ...POT_LEFT.conns,
      C('esp:D18', 'servo1:PWM', 'orange', [[170, 132], [170, 94]]),
      C('esp:3V3', 'servo1:V+', 'red', [[180, 228], [180, 86]]),
      C('esp:GND.2', 'servo1:GND', 'black', [[190, 216], [190, 78]]),
    ]),
  },
  {
    id: 'pir-interrupt', name: '10. PIR + ngắt ngoài (interrupt)', category: 'Cảm biến',
    code: `// Cảm biến chuyển động PIR dùng ngắt ngoài. Bấm vào cảm biến khi chạy để mô phỏng chuyển động.
const int PIR_PIN = 19;
volatile bool motion = false;
volatile int count = 0;

void IRAM_ATTR onMotion() {
  motion = true;
  count++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(PIR_PIN), onMotion, RISING);
  Serial.println("Chờ chuyển động...");
}

void loop() {
  if (motion) {
    motion = false;
    Serial.printf("Phát hiện chuyển động! (lần %d)\\n", count);
  }
  digitalWrite(LED_BUILTIN, digitalRead(PIR_PIN));
  delay(50);
}
`,
    diagram: diagram([
      { type: 'wokwi-pir-motion-sensor', id: 'pir1', top: 100, left: 220, attrs: {} },
    ], [
      C('esp:D19', 'pir1:OUT', 'green', [[200, 120], [200, 185], [252, 185]]),
      C('esp:3V3', 'pir1:VCC', 'red', [[242, 228]]),
      C('esp:GND.2', 'pir1:GND', 'black', [[140, 216], [140, 240], [262, 240]]),
    ]),
  },
  {
    id: 'ldr', name: '11. Cảm biến ánh sáng LDR', category: 'Cảm biến',
    code: `// Đọc cảm biến quang trở: AO -> GPIO34 (analog), DO -> GPIO35 (digital)
const int AO_PIN = 34;
const int DO_PIN = 35;
const float GAMMA = 0.7;
const float RL10 = 50;

void setup() {
  Serial.begin(115200);
  pinMode(DO_PIN, INPUT);
}

void loop() {
  int analogValue = analogRead(AO_PIN);
  float voltage = analogValue / 4095.0 * 3.3;
  float resistance = 10000 * voltage / (3.3 - voltage);
  float lux = pow(RL10 * 1e3 * pow(10, GAMMA) / resistance, (1 / GAMMA));
  Serial.printf("ADC=%d  lux≈%.0f  %s\\n", analogValue, lux, digitalRead(DO_PIN) ? "TỐI" : "SÁNG");
  delay(500);
}
`,
    diagram: diagram([
      { type: 'wokwi-photoresistor-sensor', id: 'ldr1', top: 60, left: -140, attrs: { lux: 500, threshold: 100 } },
    ], [
      C('esp:D34', 'ldr1:AO', 'green', [[-44, 96]]),
      C('esp:D35', 'ldr1:DO', 'purple', [[-10, 108], [-10, 83]]),
      C('esp:3V3', 'ldr1:VCC', 'red', [[130, 228], [130, 275], [-20, 275], [-20, 67]]),
      C('esp:GND.1', 'ldr1:GND', 'black', [[-30, 216], [-30, 75]]),
    ]),
  },
  {
    id: 'neopixel', name: '12. NeoPixel cầu vồng', category: 'Hiển thị',
    code: `#include <Adafruit_NeoPixel.h>

#define PIN 23
#define NUMPIXELS 8
Adafruit_NeoPixel strip(NUMPIXELS, PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  strip.begin();
  strip.setBrightness(150);
}

void loop() {
  for (long first = 0; first < 65536; first += 1024) {
    for (int i = 0; i < strip.numPixels(); i++) {
      int hue = first + (i * 65536L / strip.numPixels());
      strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue)));
    }
    strip.show();
    delay(30);
  }
}
`,
    diagram: diagram([
      { type: 'wokwi-neopixel-strip', id: 'strip1', top: -60, left: 200, attrs: { pixels: 8 } },
    ], [
      C('esp:D23', 'strip1:DIN', 'green', [[150, 60], [150, -49]]),
      C('esp:3V3', 'strip1:VDD', 'red', [[180, 228], [180, -41]]),
      C('esp:GND.2', 'strip1:VSS', 'black', [[165, 216], [165, -33]]),
    ]),
  },
  {
    id: 'http-get', name: '13. WiFi + HTTP GET thời tiết (JSON) → LCD', category: 'IoT',
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>

const char* ssid = "Wokwi-GUEST";
const char* password = "";
// Open-Meteo: API miễn phí, không cần khóa (Hà Nội)
const char* url = "https://api.open-meteo.com/v1/forecast?latitude=21.03&longitude=105.85&current_weather=true";

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  lcd.print("Connecting WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi OK, IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  Serial.printf("HTTP code: %d\\n", code);
  if (code == HTTP_CODE_OK) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      float temp = doc["current_weather"]["temperature"];
      float wind = doc["current_weather"]["windspeed"];
      Serial.printf("Ha Noi: %.1f C, gio %.1f km/h\\n", temp, wind);
      lcd.clear();
      lcd.print("Ha Noi ");
      lcd.print(temp, 1);
      lcd.print((char)223);
      lcd.print("C");
      lcd.setCursor(0, 1);
      lcd.print("Gio: ");
      lcd.print(wind, 1);
      lcd.print(" km/h");
    } else {
      Serial.print("JSON error: ");
      Serial.println(err.c_str());
    }
  } else {
    Serial.println("Lỗi: " + http.errorToString(code));
  }
  http.end();
  delay(30000);
}
`,
    diagram: diagram([DHT_LCD_PARTS[0]], LCD_CONNS),
  },
  {
    id: 'http-post', name: '14. HTTP POST dữ liệu cảm biến (JSON)', category: 'IoT',
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

DHT dht(15, DHT22);
const char* serverUrl = "https://httpbin.org/post";   // server thử nghiệm, trả lại dữ liệu đã gửi

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin("Wokwi-GUEST", "");
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(200); Serial.print("."); }
  Serial.println(" OK");
}

void loop() {
  JsonDocument doc;
  doc["device"] = "esp32-sim";
  doc["temperature"] = dht.readTemperature();
  doc["humidity"] = dht.readHumidity();
  doc["uptime"] = millis() / 1000;
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("POST %s -> %d\\n", body.c_str(), code);
  if (code > 0) {
    JsonDocument resp;
    deserializeJson(resp, http.getString());
    Serial.print("Server nhận: ");
    serializeJson(resp["json"], Serial);
    Serial.println();
  }
  http.end();
  delay(10000);
}
`,
    diagram: diagram([DHT_LCD_PARTS[1]], DHT_CONNS),
  },
  {
    id: 'mqtt', name: '15. MQTT: gửi DHT22, nhận lệnh bật/tắt LED', category: 'IoT',
    code: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// Đổi TOPIC thành tên riêng của bạn để không trùng với người khác!
#define TOPIC_BASE "esp32sim/demo"

const char* mqttServer = "broker.hivemq.com";
const int mqttPort = 1883;

WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(15, DHT22);
const int LED_PIN = 4;
unsigned long lastSend = 0;

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("Nhận [%s]: %s\\n", topic, msg.c_str());
  if (String(topic) == TOPIC_BASE "/led") {
    if (msg == "on" || msg == "1") digitalWrite(LED_PIN, HIGH);
    if (msg == "off" || msg == "0") digitalWrite(LED_PIN, LOW);
    client.publish(TOPIC_BASE "/led/state", digitalRead(LED_PIN) ? "on" : "off");
  }
}

void reconnect() {
  while (!client.connected()) {
    String clientId = "esp32-sim-" + String(random(0xffff), HEX);
    Serial.print("Kết nối MQTT... ");
    if (client.connect(clientId.c_str())) {
      Serial.println("OK");
      client.subscribe(TOPIC_BASE "/led");
    } else {
      Serial.printf("lỗi rc=%d, thử lại sau 3s\\n", client.state());
      delay(3000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();
  WiFi.begin("Wokwi-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println("\\nWiFi connected");
  client.setServer(mqttServer, mqttPort);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  if (millis() - lastSend > 5000) {
    lastSend = millis();
    JsonDocument doc;
    doc["temp"] = dht.readTemperature();
    doc["hum"] = dht.readHumidity();
    char buf[128];
    serializeJson(doc, buf);
    client.publish(TOPIC_BASE "/sensor", buf);
    Serial.printf("Gửi: %s\\n", buf);
  }
  delay(10);
}
`,
    diagram: diagram([...LED_D4.parts, Object.assign({}, DHT_LCD_PARTS[1], { left: 310 })], [...LED_D4.conns,
      C('esp:D15', 'dht1:SDA', 'green', [[326, 204]]),
      C('esp:3V3', 'dht1:VCC', 'red', [[318, 228]]),
      C('esp:GND.2', 'dht1:GND', 'black', [[342, 216]])]),
  },
  {
    id: 'freertos', name: '16. FreeRTOS: 2 task song song', category: 'Nâng cao',
    code: `// Hai task FreeRTOS chạy song song, mỗi task nháy một LED với chu kỳ khác nhau
const int LED1 = 4;

void taskBlinkFast(void *pv) {
  for (;;) {
    digitalWrite(LED1, !digitalRead(LED1));
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

void taskBlinkSlow(void *pv) {
  for (;;) {
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
    Serial.printf("[core %d] task chậm, millis=%lu\\n", xPortGetCoreID(), millis());
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED1, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  xTaskCreatePinnedToCore(taskBlinkFast, "fast", 2048, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(taskBlinkSlow, "slow", 4096, NULL, 1, NULL, 1);
}

void loop() {
  vTaskDelete(NULL);   // không dùng loop()
}
`,
    diagram: diagram(LED_D4.parts, LED_D4.conns),
  },
  {
    id: 'ntp-oled', name: '17. Đồng hồ NTP trên OLED', category: 'IoT',
    code: `#include <WiFi.h>
#include <time.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
const long GMT_OFFSET = 7 * 3600;   // UTC+7 (Việt Nam)

void setup() {
  Serial.begin(115200);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Connecting WiFi...");
  display.display();
  WiFi.begin("Wokwi-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) delay(200);
  configTime(GMT_OFFSET, 0, "pool.ntp.org");
}

void loop() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Chưa lấy được thời gian");
    return;
  }
  char timeStr[16], dateStr[24];
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &timeinfo);
  strftime(dateStr, sizeof(dateStr), "%a %d/%m/%Y", &timeinfo);
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(18, 6);
  display.print(dateStr);
  display.setTextSize(2);
  display.setCursor(16, 28);
  display.print(timeStr);
  display.display();
  Serial.println(&timeinfo, "%A, %d %B %Y %H:%M:%S");
  delay(1000);
}
`,
    diagram: diagram(OLED_PARTS, OLED_CONNS),
  },
];
