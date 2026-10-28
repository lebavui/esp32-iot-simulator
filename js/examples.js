// Example projects: Arduino sketch + diagram (diagram.json format).
// ESP32 is at (0,0). Right header pins x=116: D23 y60, D22 72, TX0 84, RX0 96, D21 108, D19 120, D18 132, D5 144,
// TX2 156, RX2 168, D4 180, D2 192, D15 204, GND.2 216, 3V3 228. Left header x=8: VP 72 ... GND.1 216, VIN 228.

const ESP = { type: 'esp32-iot-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} };
const C = (from, to, color, points) => (points ? [from, to, color, points] : [from, to, color]);

const LED_D4 = {
  parts: [
    { type: 'esp32-iot-resistor', id: 'r1', top: 174, left: 140, attrs: { value: '220' } },
    { type: 'esp32-iot-led', id: 'led1', top: 110, left: 230, attrs: { color: 'red' } },
  ],
  conns: [
    C('esp:D4', 'r1:1', 'green', []),
    C('r1:2', 'led1:A', 'green', [[240, 180]]),
    C('led1:C', 'esp:GND.2', 'black', [[250, 248], [132, 248], [132, 216]]),
  ],
};

const DHT_LCD_PARTS = [
  { type: 'esp32-iot-lcd1602', id: 'lcd1', top: -60, left: 200, attrs: { size: '16x2', address: '0x27', color: 'green' } },
  { type: 'esp32-iot-dht22', id: 'dht1', top: 120, left: 260, attrs: { temperature: 28.5, humidity: 65 } },
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
const OLED_PARTS = [{ type: 'esp32-iot-ssd1306', id: 'oled1', top: -40, left: 200, attrs: { address: '0x3C' } }];
const OLED_CONNS = [
  C('esp:D21', 'oled1:SDA', 'blue', [[160, 108], [160, -55], [291, -55]]),
  C('esp:D22', 'oled1:SCL', 'yellow', [[150, 72], [150, -60], [277, -60]]),
  C('esp:3V3', 'oled1:VCC', 'red', [[175, 228], [175, -50], [263, -50]]),
  C('esp:GND.2', 'oled1:GND', 'black', [[185, 216], [185, -45], [249, -45]]),
];
const POT_LEFT = {
  parts: [{ type: 'esp32-iot-potentiometer', id: 'pot1', top: 150, left: -110, attrs: { value: 512 } }],
  conns: [
    C('esp:D34', 'pot1:SIG', 'green', [[-30, 96], [-30, 245], [-82, 245]]),
    C('esp:3V3', 'pot1:VCC', 'red', [[130, 228], [130, 275], [-66, 275]]),
    C('esp:GND.1', 'pot1:GND', 'black', [[-20, 216], [-20, 255], [-98, 255]]),
  ],
};

function diagram(parts, conns) {
  return { version: 1, author: 'ESP32 IoT Simulator', editor: 'esp32-iot-sim', parts: [ESP, ...parts], connections: conns };
}
// Other boards at (0,0): left header x=8, right header x=84, pins from y=26 every 12 (see boards.js for the order).
function boardDiagram(type, parts, conns) {
  return { ...diagram(parts, conns), parts: [{ type, id: 'esp', top: 0, left: 0, attrs: {} }, ...parts] };
}

// Parts reused by the sensor / actuator / radio examples (wires without bends are routed when the example is opened)
// buzzer on the kit's buzzer pin (BOARDS[…].buzzer: GPIO4 on the DevKit, D3 of the XIAO expansion board)
const buzzerAt = (gp = 'D4', left = 300, top = 140) => ({
  parts: [{ type: 'esp32-iot-buzzer', id: 'bz1', top, left, attrs: {} }],
  conns: [C(`esp:${gp}`, 'bz1:2', 'orange'), C('bz1:1', 'esp:GND.2', 'black')],
});
// LED + 220 Ω on GPIO5 (for examples whose GPIO4 is taken by the buzzer)
const LED_D5 = {
  parts: [
    { type: 'esp32-iot-resistor', id: 'r1', top: 138, left: 140, attrs: { value: '220' } },
    { type: 'esp32-iot-led', id: 'led1', top: 50, left: 230, attrs: { color: 'red' } },
  ],
  conns: [C('esp:D5', 'r1:1', 'green'), C('r1:2', 'led1:A', 'green'), C('led1:C', 'esp:GND.2', 'black')],
};
// second LED (green) + 220 Ω on GPIO5, beside LED_D4
const LED2_D5 = {
  parts: [
    { type: 'esp32-iot-resistor', id: 'r2', top: 138, left: 140, attrs: { value: '220' } },
    { type: 'esp32-iot-led', id: 'led2', top: 40, left: 290, attrs: { color: 'green' } },
  ],
  conns: [C('esp:D5', 'r2:1', 'green'), C('r2:2', 'led2:A', 'green'), C('led2:C', 'esp:GND.2', 'black')],
};
const BUTTON_D15 = {
  parts: [{ type: 'esp32-iot-pushbutton', id: 'btn1', top: 220, left: 160, attrs: { color: 'green' } }],
  conns: [C('esp:D15', 'btn1:1', 'blue'), C('btn1:2', 'esp:GND.2', 'black')],
};
// comparator sensor module (VCC GND DO AO) left of the board
const sensorLeft = (type, id, attrs, w, pins, top = 80) => ({
  parts: [{ type, id, top, left: -60 - w, attrs }],
  conns: [C('esp:3V3', `${id}:VCC`, 'red'), C('esp:GND.1', `${id}:GND`, 'black'), ...pins.map(([gp, pin, color]) => C(`esp:${gp}`, `${id}:${pin}`, color))],
});
// MQ-2 wired as the real module needs: VCC from VIN (its heater needs 5 V) and the 0–5 V output (AO or DO) brought
// to ≤ 3.3 V by a 10 kΩ / 20 kΩ divider before the GPIO
const mq2At5V = (out, gp) => ({
  parts: [
    { type: 'esp32-iot-mq2', id: 'mq1', top: 70, left: -280, attrs: { gas: 300, threshold: 2000 } },
    { type: 'esp32-iot-resistor', id: 'rdiv1', top: 120, left: -150, attrs: { value: '10k' } },
    { type: 'esp32-iot-resistor', id: 'rdiv2', top: 170, left: -120, attrs: { value: '20k' } },
  ],
  conns: [
    C('esp:VIN', 'mq1:VCC', 'red'), C('esp:GND.1', 'mq1:GND', 'black'), C(`mq1:${out}`, 'rdiv1:1', 'green'),
    C('rdiv1:2', `esp:${gp}`, 'green'), C('rdiv2:1', `esp:${gp}`, 'green'), C('rdiv2:2', 'esp:GND.1', 'black'),
  ],
});
// relay module switching a 5 V lamp: VIN → COM, NO → lamp → GND
const relayLamp = (inPin, top = 120) => ({
  parts: [
    { type: 'esp32-iot-relay-module', id: 'relay1', top, left: 200, attrs: { trigger: 'high' } },
    { type: 'esp32-iot-lamp', id: 'lamp1', top: top - 70, left: 360, attrs: { volt: 5 } },
  ],
  conns: [
    C('esp:VIN', 'relay1:VCC', 'red'), C('esp:GND.2', 'relay1:GND', 'black'), C(`esp:${inPin}`, 'relay1:IN', 'green'),
    C('esp:VIN', 'relay1:COM', 'red'), C('relay1:NO', 'lamp1:1', 'orange'), C('lamp1:2', 'esp:GND.2', 'black'),
  ],
});
// SX1278 module on the hardware SPI pins (SCK 18, MISO 19, MOSI 23), NSS = 5, RST = 4, DIO0 = 2
const loraRight = (top = 20) => ({
  parts: [{ type: 'esp32-iot-lora-ra02', id: 'lora1', top, left: 200, attrs: {} }],
  conns: [
    C('esp:3V3', 'lora1:VCC', 'red'), C('esp:GND.2', 'lora1:GND', 'black'), C('esp:D5', 'lora1:NSS', 'purple'),
    C('esp:D18', 'lora1:SCK', 'yellow'), C('esp:D23', 'lora1:MOSI', 'blue'), C('esp:D19', 'lora1:MISO', 'green'),
    C('esp:D4', 'lora1:RST', 'gray'), C('esp:D2', 'lora1:DIO0', 'orange'),
  ],
});
const OLED_AUTO = [
  C('esp:D21', 'oled1:SDA', 'blue'), C('esp:D22', 'oled1:SCL', 'yellow'), C('esp:3V3', 'oled1:VCC', 'red'), C('esp:GND.2', 'oled1:GND', 'black'),
];
// diagram from groups of { parts, conns }
const compose = (...groups) => diagram(groups.flatMap((g) => g.parts), groups.flatMap((g) => g.conns));
const dhtAt = (left, top) => ({
  parts: [{ type: 'esp32-iot-dht22', id: 'dht1', top, left, attrs: { temperature: 28.5, humidity: 65 } }],
  conns: [C('esp:D15', 'dht1:SDA', 'green'), C('esp:3V3', 'dht1:VCC', 'red'), C('esp:GND.2', 'dht1:GND', 'black')],
});

const ALL = [
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
    diagram: diagram([...LED_D4.parts, { type: 'esp32-iot-pushbutton', id: 'btn1', top: 160, left: 290, attrs: { color: 'green' } }],
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
      { type: 'esp32-iot-led', id: 'led1', top: 60, left: -190, attrs: { color: 'red' } },
      { type: 'esp32-iot-led', id: 'led2', top: 60, left: -150, attrs: { color: 'yellow' } },
      { type: 'esp32-iot-led', id: 'led3', top: 60, left: -110, attrs: { color: 'green' } },
      { type: 'esp32-iot-resistor', id: 'r1', top: 138, left: -80, attrs: { value: '220' } },
      { type: 'esp32-iot-resistor', id: 'r2', top: 150, left: -80, attrs: { value: '220' } },
      { type: 'esp32-iot-resistor', id: 'r3', top: 162, left: -80, attrs: { value: '220' } },
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
      { type: 'esp32-iot-resistor', id: 'r1', top: 126, left: 140, attrs: { value: '220' } },
      { type: 'esp32-iot-led', id: 'led1', top: 60, left: 230, attrs: { color: 'blue' } },
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
      { type: 'esp32-iot-7segment', id: 'sevseg1', top: -80, left: 250, attrs: { common: 'cathode', color: 'red' } },
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
    id: 'dht-oled', name: '06. DHT22 + OLED: nhiệt độ & độ ẩm', category: 'Cảm biến',
    code: `// DHT22 đo nhiệt độ/độ ẩm, hiển thị trên OLED SSD1306 128x64 (I2C, địa chỉ 0x3C).
// Khi chạy: chọn cảm biến DHT22 và kéo thanh "Nhiệt độ" / "Độ ẩm".
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

#define DHTPIN 15
#define DHTTYPE DHT22

Adafruit_SSD1306 display(128, 64, &Wire, -1);
DHT dht(DHTPIN, DHTTYPE);

// một dòng: nhãn nhỏ, giá trị chữ to, thanh mức trong khoảng [lo, hi]
void drawValue(int y, const char* label, float v, const char* unit, float lo, float hi) {
  display.setTextSize(1);
  display.setCursor(0, y + 4);
  display.print(label);
  display.setTextSize(2);
  display.setCursor(40, y);
  display.print(v, 1);
  int x = display.getCursorX();
  if (unit[0] == 'C') {                       // font 5x7 không có dấu độ: vẽ vòng tròn nhỏ
    display.drawCircle(x + 3, y + 2, 2, SSD1306_WHITE);
    x += 8;
  }
  display.setCursor(x, y);
  display.print(unit);
  int w = constrain((int)((v - lo) * 126 / (hi - lo)), 0, 126);
  display.drawRect(0, y + 18, 128, 5, SSD1306_WHITE);
  display.fillRect(1, y + 19, w, 3, SSD1306_WHITE);
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
  display.clearDisplay();
  display.setCursor(24, 28);
  display.print("ESP32 + DHT22");
  display.display();
  delay(1000);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  display.clearDisplay();
  if (isnan(t) || isnan(h)) {
    Serial.println("Lỗi đọc DHT22!");
    display.setTextSize(1);
    display.setCursor(0, 28);
    display.print("Loi doc DHT22!");
    display.display();
    delay(2000);
    return;
  }
  drawValue(0, "Nhiet", t, "C", -10, 50);
  drawValue(34, "Do am", h, "%", 0, 100);
  display.display();
  Serial.printf("T = %.1f C, H = %.1f %%\\n", t, h);
  delay(2000);
}
`,
    diagram: compose({ parts: OLED_PARTS, conns: OLED_AUTO }, dhtAt(260, 120)),
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
const int BUZZER = 4;      // buzzer nối sẵn trên kit: GPIO4 (DevKit), D3 (board mở rộng XIAO), A3 (C3 SuperMini)

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
      { type: 'esp32-iot-hc-sr04', id: 'ultrasonic1', top: -40, left: 180, attrs: { distance: 120 } },
      { type: 'esp32-iot-buzzer', id: 'bz1', top: 120, left: 300, attrs: {} },
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
      { type: 'esp32-iot-servo', id: 'servo1', top: 60, left: 200, attrs: {} },
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
      { type: 'esp32-iot-pir-motion-sensor', id: 'pir1', top: 100, left: 220, attrs: {} },
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
      { type: 'esp32-iot-photoresistor-sensor', id: 'ldr1', top: 60, left: -140, attrs: { lux: 500, threshold: 100 } },
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
      { type: 'esp32-iot-neopixel-strip', id: 'strip1', top: -60, left: 200, attrs: { pixels: 8 } },
    ], [
      C('esp:D23', 'strip1:DIN', 'green', [[150, 60], [150, -49]]),
      C('esp:3V3', 'strip1:VDD', 'red', [[180, 228], [180, -41]]),
      C('esp:GND.2', 'strip1:VSS', 'black', [[165, 216], [165, -33]]),
    ]),
  },
  {
    id: 'http-get', name: '13. WiFi + HTTP GET thời tiết (JSON) → OLED', category: 'IoT',
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const char* ssid = "ESP32-IoT-GUEST";
const char* password = "";
// Open-Meteo: API miễn phí, không cần khóa (Hà Nội)
const char* url = "https://api.open-meteo.com/v1/forecast?latitude=21.03&longitude=105.85&current_weather=true";

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void showMessage(const char* line1, const char* line2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.println(line1);
  display.println(line2);
  display.display();
}

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
  showMessage("Dang ket noi WiFi", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi OK, IP: ");
  Serial.println(WiFi.localIP());
  showMessage("WiFi OK, IP:", WiFi.localIP().toString().c_str());
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
      String time = doc["current_weather"]["time"] | "";
      Serial.printf("Ha Noi: %.1f C, gio %.1f km/h\\n", temp, wind);

      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.print("Ha Noi");
      display.setCursor(128 - 6 * 5, 0);
      display.print(time.substring(11, 16));           // giờ cập nhật hh:mm (GMT)
      display.drawFastHLine(0, 10, 128, SSD1306_WHITE);
      display.setTextSize(3);
      display.setCursor(0, 18);
      display.print(temp, 1);
      int x = display.getCursorX();
      display.drawCircle(x + 4, 20, 3, SSD1306_WHITE);   // dấu độ
      display.setCursor(x + 10, 18);
      display.print("C");
      display.setTextSize(1);
      display.setCursor(0, 54);
      display.printf("Gio: %.1f km/h", wind);
      display.display();
    } else {
      Serial.print("JSON error: ");
      Serial.println(err.c_str());
      showMessage("Loi JSON:", err.c_str());
    }
  } else {
    Serial.println("Lỗi: " + http.errorToString(code));
    showMessage("Loi HTTP", http.errorToString(code).c_str());
  }
  http.end();
  delay(30000);
}
`,
    diagram: diagram(OLED_PARTS, OLED_CONNS),
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
  WiFi.begin("ESP32-IoT-GUEST", "");
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
  WiFi.begin("ESP32-IoT-GUEST", "");
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
    id: 'freertos', name: 'FreeRTOS: 2 task nháy 2 LED', category: 'Nâng cao',
    code: `// Hai task FreeRTOS chạy song song, mỗi task nháy một LED với chu kỳ riêng:
//  - LED đỏ (GPIO4): đổi trạng thái mỗi 200 ms
//  - LED xanh (GPIO5): đổi trạng thái mỗi 1000 ms
// Nếu viết bằng delay() trong loop() thì hai chu kỳ phải chờ lẫn nhau; với task, vTaskDelay() chỉ dừng task đó.
const int LED_RED = 4;
const int LED_GREEN = 5;

struct BlinkParam {
  int pin;
  int periodMs;
};

BlinkParam fast = {LED_RED, 200};
BlinkParam slow = {LED_GREEN, 1000};

// một hàm task dùng cho cả hai LED, tham số truyền qua pvParameters
void taskBlink(void *pv) {
  BlinkParam *p = (BlinkParam *)pv;
  pinMode(p->pin, OUTPUT);
  for (;;) {
    digitalWrite(p->pin, !digitalRead(p->pin));
    if (p->periodMs >= 1000) Serial.printf("[core %d] LED GPIO%d đổi trạng thái, millis=%lu\\n", xPortGetCoreID(), p->pin, millis());
    vTaskDelay(pdMS_TO_TICKS(p->periodMs));
  }
}

void setup() {
  Serial.begin(115200);
  xTaskCreatePinnedToCore(taskBlink, "blinkFast", 2048, &fast, 1, NULL, 0);
  xTaskCreatePinnedToCore(taskBlink, "blinkSlow", 2048, &slow, 1, NULL, 1);
}

void loop() {
  vTaskDelete(NULL);   // không dùng loop()
}
`,
    diagram: compose(LED_D4, LED2_D5),
  },
  {
    id: 'ntp-oled', name: '16. Đồng hồ NTP trên OLED', category: 'IoT',
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
  WiFi.begin("ESP32-IoT-GUEST", "");
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
  {
    id: 'supermini-boot', name: '18. Nút BOOT & LED trên board', category: 'Cơ bản',
    code: `// Nút BOOT trên board nối xuống GND — khi đang chạy, nhấn giữ chuột lên board để nhấn BOOT.
// LED trên board (LED_BUILTIN) nháy 1 Hz; trên ESP32-C3 SuperMini / XIAO ESP32-S3 nó sáng khi xuất LOW.
// Board không có nút BOOT / LED trên board thì được thay bằng nút nhấn / LED ngoài khi mở ví dụ.
#define BOOT_PIN 9
#define LED_PIN 3   // LED ngoài: LED_PIN -> điện trở -> LED -> GND

bool last = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  Serial.printf("%s sẵn sàng\\n", ESP.getChipModel());
}

void loop() {
  bool pressed = digitalRead(BOOT_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
  digitalWrite(LED_BUILTIN, (millis() / 500) % 2 ? LOW : HIGH);
  if (pressed != last) {
    Serial.println(pressed ? "BOOT: nhấn" : "BOOT: nhả");
    last = pressed;
  }
  delay(20);
}
`,
    diagram: boardDiagram('board-esp32-c3-supermini', [
      { type: 'esp32-iot-resistor', id: 'r1', top: 68, left: -90, attrs: { value: '220' } },
      { type: 'esp32-iot-led', id: 'led1', top: 0, left: -150, attrs: { color: 'green' } },
    ], [
      C('esp:3', 'r1:2', 'green', []),
      C('r1:1', 'led1:A', 'green', [[-140, 74]]),
      C('led1:C', 'esp:GND', 'black', [[-130, 44], [-10, 44], [-10, 38]]),
    ]),
  },
  {
    id: 'xiao-c3-pot', name: '19. Biến trở điều khiển LED (tên chân A0/D10)', category: 'Cơ bản',
    code: `// Biến trở ở chân analog POT_PIN điều khiển độ sáng LED ở LED_PIN (PWM).
// Dùng tên chân in trên board (A0, D10…) theo pins_arduino.h; board không có tên đó thì được đổi sang số GPIO.
#define POT_PIN A0
#define LED_PIN D10

void setup() {
  Serial.begin(115200);
  ledcAttach(LED_PIN, 5000, 12);   // PWM 5 kHz, 12 bit
}

void loop() {
  int raw = analogRead(POT_PIN);   // 0..4095
  ledcWrite(LED_PIN, raw);
  Serial.printf("POT = %4d  (%d%%)\\n", raw, raw * 100 / 4095);
  delay(300);
}
`,
    diagram: boardDiagram('board-xiao-esp32-c3', [
      { type: 'esp32-iot-potentiometer', id: 'pot1', top: -20, left: -110, attrs: { value: 512 } },
      { type: 'esp32-iot-resistor', id: 'r1', top: 56, left: 110, attrs: { value: '220' } },
      { type: 'esp32-iot-led', id: 'led1', top: -10, left: 190, attrs: { color: 'red' } },
    ], [
      C('esp:D0', 'pot1:SIG', 'green', [[-30, 26], [-30, 62], [-82, 62]]),
      C('pot1:VCC', 'esp:3V3', 'red', [[-66, 125], [100, 125], [100, 50]]),
      C('pot1:GND', 'esp:GND', 'black', [[-98, 132], [108, 132], [108, 38]]),
      C('esp:D10', 'r1:1', 'orange', []),
      C('r1:2', 'led1:A', 'orange', [[200, 62]]),
      C('led1:C', 'esp:GND', 'black', [[210, 80], [96, 80], [96, 38]]),
    ]),
  },
  {
    id: 'xiao-s3-oled', name: '20. OLED: thông tin chip & LED trên board', category: 'Hiển thị',
    code: `// OLED I2C trên chân SDA/SCL mặc định của board; hiển thị tên chip và số giây đã chạy.
// LED trên board (LED_BUILTIN) nháy 1 Hz.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Wire.begin();   // SDA, SCL theo pins_arduino.h của board
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED");
    while (true) delay(100);
  }
  Serial.printf("Chip %s, %d nhân, %d MHz\\n", ESP.getChipModel(), ESP.getChipCores(), ESP.getCpuFreqMHz());
}

void loop() {
  unsigned long s = millis() / 1000;
  digitalWrite(LED_BUILTIN, s % 2 ? LOW : HIGH);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(ESP.getChipModel());
  display.setTextSize(2);
  display.setCursor(0, 24);
  display.print(s);
  display.print(" s");
  display.display();
  delay(200);
}
`,
    diagram: boardDiagram('board-xiao-esp32-s3', [{ type: 'esp32-iot-ssd1306', id: 'oled1', top: -70, left: 150, attrs: { address: '0x3C' } }], [
      C('esp:D4', 'oled1:SDA', 'blue', [[-20, 74], [-20, -85], [241, -85]]),
      C('esp:D5', 'oled1:SCL', 'yellow', [[-30, 86], [-30, -90], [227, -90]]),
      C('esp:3V3', 'oled1:VCC', 'red', [[120, 50], [120, -80], [213, -80]]),
      C('esp:GND', 'oled1:GND', 'black', [[110, 38], [110, -75], [199, -75]]),
    ]),
  },
  {
    id: 'lcd-i2c', name: '21. LCD 16x2 I2C: chữ chạy & ký tự tự tạo', category: 'Hiển thị',
    code: `// LCD 16x2 qua module I2C (PCF8574, địa chỉ 0x27) nối vào chân SDA/SCL mặc định của board.
// Dòng 1: thời gian chạy + ký tự tự tạo (trái tim nhấp nháy); dòng 2: chữ chạy.
// LCD HD44780 không có dấu tiếng Việt nên chỉ in chữ không dấu.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define LCD_ADDR 0x27

LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

byte heart[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000};
byte clock8[8] = {0b00000, 0b01110, 0b10101, 0b10111, 0b10001, 0b01110, 0b00000, 0b00000};

String message = "Xin chao! Day la vi du LCD I2C tren ESP32 IoT Simulator";
int pos = 0;

// quét bus I2C, in các địa chỉ có thiết bị trả lời
void scanI2C() {
  Serial.println("Quét I2C...");
  int found = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  Thiết bị ở 0x%02X\\n", addr);
      found++;
    }
  }
  if (!found) Serial.println("  Không có thiết bị — kiểm tra dây SDA/SCL, VCC, GND");
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  scanI2C();

  lcd.init();
  lcd.backlight();
  lcd.createChar(0, heart);
  lcd.createChar(1, clock8);

  lcd.setCursor(0, 0);
  lcd.print("  LCD 16x2 I2C");
  lcd.setCursor(0, 1);
  lcd.print("  Dia chi 0x");
  lcd.print(LCD_ADDR, HEX);
  delay(1500);
  lcd.clear();

  message = "                " + message + " ";   // bắt đầu từ mép phải màn hình
}

void loop() {
  unsigned long s = millis() / 1000;

  // dòng 1: biểu tượng đồng hồ + mm:ss + trái tim nháy mỗi giây
  char buf[17];
  snprintf(buf, sizeof(buf), " %02lu:%02lu         ", s / 60, s % 60);
  lcd.setCursor(0, 0);
  lcd.write(1);
  lcd.print(buf);
  lcd.setCursor(15, 0);
  if (s % 2) lcd.write(0); else lcd.print(" ");

  // dòng 2: cửa sổ 16 ký tự trượt dần trên chuỗi
  String window = message.substring(pos, pos + 16);
  while (window.length() < 16) window += " ";
  lcd.setCursor(0, 1);
  lcd.print(window);
  pos++;
  if (pos >= (int)message.length()) pos = 0;

  delay(300);
}
`,
    diagram: diagram([DHT_LCD_PARTS[0]], LCD_CONNS),
  },

  // ---------------------------------------------------------------- digital-output sensors
  {
    id: 'ldr-digital', name: '22. Ánh sáng (DO): đèn ngủ tự động', category: 'Cảm biến số (digital)',
    code: `// Đèn ngủ tự động dùng chân DO (digital) của module quang trở.
// Module có bộ so sánh LM393: DO = HIGH khi trời tối (độ sáng dưới ngưỡng), LOW khi sáng.
// Ngưỡng được chỉnh bằng biến trở trên module (thuộc tính "Ngưỡng DO").
// Khi chạy: chọn cảm biến và kéo thanh "Độ sáng (lux)" xuống dưới ngưỡng để đèn bật.
const int LDR_DO = 35;   // GPIO35: chân chỉ vào (input-only), module tự đẩy mức HIGH/LOW
const int LAMP_PIN = 4;

int lastState = -1;

void setup() {
  Serial.begin(115200);
  pinMode(LDR_DO, INPUT);
  pinMode(LAMP_PIN, OUTPUT);
  Serial.println("Đèn ngủ tự động (LDR - chân DO)");
}

void loop() {
  int dark = digitalRead(LDR_DO);
  if (dark != lastState) {          // chỉ in khi trạng thái thay đổi
    lastState = dark;
    digitalWrite(LAMP_PIN, dark);
    Serial.println(dark ? "Trời tối  -> BẬT đèn" : "Trời sáng -> TẮT đèn");
  }
  delay(100);
}
`,
    diagram: compose(sensorLeft('esp32-iot-photoresistor-sensor', 'ldr1', { lux: 500, threshold: 100 }, 98, [['D35', 'DO', 'purple']]), LED_D4),
  },
  {
    id: 'flame-digital', name: '23. Cảm biến lửa (DO): báo cháy', category: 'Cảm biến số (digital)',
    code: `// Báo cháy với cảm biến lửa hồng ngoại (IR 760–1100 nm).
// Chân DO tích cực mức THẤP: LOW = phát hiện lửa (cường độ vượt ngưỡng của biến trở trên module).
// Khi chạy: chọn cảm biến, kéo "Cường độ lửa (%)" lên trên ngưỡng.
const int FLAME_DO = 35;
const int LED_PIN = 5;
const int BUZZER_PIN = 4;    // buzzer nối sẵn trên kit: GPIO4 (DevKit), D3 (board mở rộng XIAO), A3 (C3 SuperMini)

bool lastFire = false;
unsigned long fireCount = 0;

void setup() {
  Serial.begin(115200);
  pinMode(FLAME_DO, INPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Hệ thống báo cháy sẵn sàng");
}

void loop() {
  bool fire = digitalRead(FLAME_DO) == LOW;
  if (fire != lastFire) {
    lastFire = fire;
    if (fire) {
      fireCount++;
      Serial.printf("🔥 PHÁT HIỆN LỬA! (lần %lu)\\n", fireCount);
    } else {
      Serial.println("Hết lửa - tắt báo động");
      noTone(BUZZER_PIN);
      digitalWrite(LED_PIN, LOW);
    }
  }
  if (fire) {
    // còi hai tông + LED nháy
    bool phase = (millis() / 250) % 2;
    tone(BUZZER_PIN, phase ? 2500 : 1800);
    digitalWrite(LED_PIN, phase);
  }
  delay(20);
}
`,
    diagram: compose(sensorLeft('esp32-iot-flame-sensor', 'flame1', { flame: 0, threshold: 40 }, 122, [['D35', 'DO', 'purple']]), LED_D5, buzzerAt()),
  },
  {
    id: 'gas-digital', name: '24. Khí gas MQ-2 (DO) + ngắt ngoài', category: 'Cảm biến số (digital)',
    code: `// Báo rò rỉ khí gas: module MQ-2, chân DO xuống LOW khi nồng độ vượt ngưỡng.
// Dùng ngắt ngoài (attachInterrupt) để không bỏ lỡ sự kiện dù loop() đang bận.
// Đấu nối như MQ-2 thật: VCC -> VIN (5 V, dây nung cần 5 V); DO ra mức 0/5 V nên phải qua cầu phân áp
// DO -> 10 kΩ -> GPIO34 -> 20 kΩ -> GND (mức HIGH còn 3.3 V, an toàn cho ESP32).
// Ngưỡng DO chỉnh bằng biến trở trên module (thuộc tính "Ngưỡng DO").
// Cảm biến cần làm nóng (≥ 1–3 phút, mô phỏng: 2 s) trước khi báo động ổn định.
// Khi chạy: chọn cảm biến, kéo "Nồng độ khí (ppm)" vượt "Ngưỡng DO".
const int GAS_DO = 34;
const int LED_PIN = 5;
const int BUZZER_PIN = 4;    // buzzer nối sẵn trên kit: GPIO4 (DevKit), D3 (board mở rộng XIAO), A3 (C3 SuperMini)

volatile bool changed = false;

void IRAM_ATTR onGasChange() {
  changed = true;        // trong ISR chỉ đặt cờ, xử lý ở loop()
}

void setup() {
  Serial.begin(115200);
  pinMode(GAS_DO, INPUT);
  pinMode(LED_PIN, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(GAS_DO), onGasChange, CHANGE);
  Serial.println("Đang làm nóng cảm biến MQ-2...");
  delay(2000);
  Serial.println("Giám sát khí gas bắt đầu");
  changed = true;        // kiểm tra trạng thái ban đầu
}

void loop() {
  if (changed) {
    changed = false;
    bool leak = digitalRead(GAS_DO) == LOW;
    digitalWrite(LED_PIN, leak);
    if (leak) {
      tone(BUZZER_PIN, 3000);
      Serial.println("⚠ CẢNH BÁO: phát hiện khí gas vượt ngưỡng!");
    } else {
      noTone(BUZZER_PIN);
      Serial.println("Không khí bình thường");
    }
  }
  delay(50);
}
`,
    diagram: compose(mq2At5V('DO', 'D34'), LED_D5, buzzerAt()),
  },

  // ---------------------------------------------------------------- analog-output sensors
  {
    id: 'ldr-analog', name: '25. Ánh sáng (AO): đèn tự điều chỉnh độ sáng', category: 'Cảm biến tương tự (analog)',
    code: `// Đọc chân AO (analog) của module quang trở: điện áp càng cao khi càng tối.
// Đèn LED (PWM) sáng mạnh dần khi môi trường tối đi.
// Khi chạy: chọn cảm biến và kéo thanh "Độ sáng (lux)".
const int LDR_AO = 34;     // ADC1
const int LED_PIN = 4;

const int ADC_BRIGHT = 450;   // giá trị ADC khi rất sáng (≈ 2000 lux) – đo lại khi dùng module thật
const int ADC_DARK = 3900;    // giá trị ADC khi rất tối

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);    // 0..4095
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // lấy trung bình 8 lần đọc cho ổn định
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(LDR_AO);
  int raw = sum / 8;

  int light = constrain(map(raw, ADC_DARK, ADC_BRIGHT, 0, 100), 0, 100);    // % độ sáng môi trường
  int duty = constrain(map(raw, ADC_BRIGHT, ADC_DARK, 0, 255), 0, 255);      // tối hơn -> đèn sáng hơn
  analogWrite(LED_PIN, duty);

  float volt = analogReadMilliVolts(LDR_AO) / 1000.0;
  Serial.printf("ADC=%4d  (%.2f V)  ánh sáng=%3d%%  độ sáng đèn=%3d/255\\n", raw, volt, light, duty);
  delay(500);
}
`,
    diagram: compose(sensorLeft('esp32-iot-photoresistor-sensor', 'ldr1', { lux: 120, threshold: 100 }, 98, [['D34', 'AO', 'green']]), LED_D4),
  },
  {
    id: 'rain-analog', name: '26. Cảm biến mưa (AO): tự đóng mái che', category: 'Cảm biến tương tự (analog)',
    code: `// Cảm biến mưa: tấm cảm biến càng ướt thì điện trở càng nhỏ -> điện áp AO càng THẤP.
// Phân 3 mức (khô / mưa nhỏ / mưa to) và dùng servo đóng mái che khi trời mưa.
// Khi chạy: chọn cảm biến và kéo "Mức mưa (%)".
#include <ESP32Servo.h>

const int RAIN_AO = 32;
const int SERVO_PIN = 18;
const int ADC_DRY = 4095;     // tấm khô
const int ADC_WET = 500;      // tấm ướt hoàn toàn

Servo roof;
int lastLevel = -1;
const char* LEVELS[] = {"Khô ráo", "Mưa nhỏ", "Mưa to"};

void setup() {
  Serial.begin(115200);
  roof.attach(SERVO_PIN);
  roof.write(0);              // 0° = mái mở
}

void loop() {
  int raw = analogRead(RAIN_AO);
  int wet = constrain(map(raw, ADC_DRY, ADC_WET, 0, 100), 0, 100);
  int level = wet < 20 ? 0 : (wet < 60 ? 1 : 2);
  Serial.printf("ADC=%4d  độ ướt=%3d%%  -> %s\\n", raw, wet, LEVELS[level]);
  if (level != lastLevel) {
    lastLevel = level;
    roof.write(level == 0 ? 0 : 90);
    Serial.println(level == 0 ? ">> Mở mái che" : ">> Đóng mái che");
  }
  delay(1000);
}
`,
    diagram: compose(sensorLeft('esp32-iot-rain-sensor', 'rain1', { rain: 0, threshold: 30 }, 174, [['D32', 'AO', 'green']], 60), {
      parts: [{ type: 'esp32-iot-servo', id: 'servo1', top: 110, left: 210, attrs: {} }],
      conns: [C('esp:D18', 'servo1:PWM', 'orange'), C('esp:3V3', 'servo1:V+', 'red'), C('esp:GND.2', 'servo1:GND', 'black')],
    }),
  },
  {
    id: 'water-level', name: '27. Cảm biến mực nước (AO): báo mức bồn', category: 'Cảm biến tương tự (analog)',
    code: `// Cảm biến mực nước: phần ngập trong nước càng dài, điện áp chân S càng cao.
// Cấp nguồn cho cảm biến từ một chân GPIO và chỉ bật khi đo -> các đường đồng ít bị ăn mòn (điện phân).
// 3 LED báo mức: xanh (thấp), vàng (vừa), đỏ (cao). Khi chạy: chọn cảm biến, kéo "Mực nước (%)".
const int SENSOR_POWER = 27;
const int SENSOR_SIG = 33;
const int LED_LOW = 19, LED_MID = 18, LED_HIGH = 5;

const int ADC_EMPTY = 0;      // hiệu chỉnh: đọc khi cảm biến khô
const int ADC_FULL = 3480;    // hiệu chỉnh: đọc khi ngập đến vạch trên cùng

int readLevel() {
  digitalWrite(SENSOR_POWER, HIGH);   // bật nguồn cảm biến
  delay(10);                          // chờ ổn định
  int raw = analogRead(SENSOR_SIG);
  digitalWrite(SENSOR_POWER, LOW);    // tắt nguồn
  return raw;
}

void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_POWER, OUTPUT);
  digitalWrite(SENSOR_POWER, LOW);
  pinMode(LED_LOW, OUTPUT);
  pinMode(LED_MID, OUTPUT);
  pinMode(LED_HIGH, OUTPUT);
}

void loop() {
  int raw = readLevel();
  int percent = constrain(map(raw, ADC_EMPTY, ADC_FULL, 0, 100), 0, 100);
  digitalWrite(LED_LOW, percent > 5);
  digitalWrite(LED_MID, percent >= 40);
  digitalWrite(LED_HIGH, percent >= 80);
  Serial.printf("ADC=%4d  mực nước=%3d%%  %s\\n", raw, percent, percent >= 90 ? "⚠ SẮP TRÀN!" : (percent <= 5 ? "Bồn cạn" : ""));
  delay(1000);
}
`,
    diagram: diagram([
      { type: 'esp32-iot-water-level-sensor', id: 'wl1', top: 110, left: -110, attrs: { level: 30 } },
      { type: 'esp32-iot-resistor', id: 'r1', top: 114, left: 150, attrs: { value: '220' } },
      { type: 'esp32-iot-resistor', id: 'r2', top: 126, left: 150, attrs: { value: '220' } },
      { type: 'esp32-iot-resistor', id: 'r3', top: 138, left: 150, attrs: { value: '220' } },
      { type: 'esp32-iot-led', id: 'led1', top: 20, left: 240, attrs: { color: 'green' } },
      { type: 'esp32-iot-led', id: 'led2', top: 20, left: 280, attrs: { color: 'yellow' } },
      { type: 'esp32-iot-led', id: 'led3', top: 20, left: 320, attrs: { color: 'red' } },
    ], [
      C('esp:D33', 'wl1:S', 'green'), C('esp:D27', 'wl1:VCC', 'red'), C('esp:GND.1', 'wl1:GND', 'black'),
      C('esp:D19', 'r1:1', 'green'), C('esp:D18', 'r2:1', 'yellow'), C('esp:D5', 'r3:1', 'orange'),
      C('r1:2', 'led1:A', 'green'), C('r2:2', 'led2:A', 'yellow'), C('r3:2', 'led3:A', 'orange'),
      C('led1:C', 'esp:GND.2', 'black'), C('led2:C', 'esp:GND.2', 'black'), C('led3:C', 'esp:GND.2', 'black'),
    ]),
  },
  {
    id: 'soil-irrigation', name: '28. Độ ẩm đất (AO): tưới cây tự động', category: 'Cảm biến tương tự (analog)',
    code: `// Tưới cây tự động: đọc độ ẩm đất (AO) và bật máy bơm qua relay.
// Đất càng ẩm -> điện áp AO càng THẤP. Dùng 2 ngưỡng (trễ / hysteresis) để bơm không bật tắt liên tục.
// Máy bơm 5 V được mô phỏng bằng bóng đèn nối qua tiếp điểm COM–NO của relay.
// Khi chạy: chọn cảm biến, kéo "Độ ẩm đất (%)".
const int SOIL_AO = 32;
const int RELAY_PIN = 4;

const int ADC_DRY = 3890;     // hiệu chỉnh: cảm biến để ngoài không khí
const int ADC_WET = 1020;     // hiệu chỉnh: cảm biến nhúng trong nước
const int START_BELOW = 30;   // % – bắt đầu tưới
const int STOP_ABOVE = 60;    // % – ngừng tưới

bool pumping = false;

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("Hệ thống tưới tự động");
}

void loop() {
  int raw = analogRead(SOIL_AO);
  int moisture = constrain(map(raw, ADC_DRY, ADC_WET, 0, 100), 0, 100);
  if (!pumping && moisture < START_BELOW) {
    pumping = true;
    Serial.println(">> Đất khô: BẬT máy bơm");
  } else if (pumping && moisture > STOP_ABOVE) {
    pumping = false;
    Serial.println(">> Đủ ẩm: TẮT máy bơm");
  }
  digitalWrite(RELAY_PIN, pumping ? HIGH : LOW);
  Serial.printf("ADC=%4d  độ ẩm=%3d%%  bơm: %s\\n", raw, moisture, pumping ? "ĐANG TƯỚI" : "nghỉ");
  delay(1000);
}
`,
    diagram: compose(sensorLeft('esp32-iot-soil-moisture-sensor', 'soil1', { moisture: 35, threshold: 40 }, 144, [['D32', 'AO', 'green']], 60), relayLamp('D4', 150)),
  },
  {
    id: 'gas-analog', name: '29. Khí gas MQ-2 (AO): đo ppm + OLED', category: 'Cảm biến tương tự (analog)',
    code: `// Đo nồng độ khí gas (LPG) với module MQ-2 qua chân AO, hiển thị lên OLED SSD1306.
//
// Đấu nối như MQ-2 thật:
//  - VCC module -> VIN (5 V): dây nung của MQ-2 cần 5 V (~150 mA), cấp 3.3 V sẽ đo sai.
//  - AO ra tới 5 V, vượt mức 3.6 V tối đa của ESP32 -> qua cầu phân áp: AO -> 10 kΩ -> GPIO34 -> 20 kΩ -> GND
//    (điện áp vào GPIO = AO × 20/30, AO = 5 V -> 3.33 V).
//
// Tính ppm: Vout = VCC × RL / (RL + Rs)  =>  Rs = RL × (VCC − Vout) / Vout
//           log10(Rs/R0) = M × log10(ppm) + B   (đường LPG trong datasheet)
// Hiệu chỉnh khi dùng module thật:
//  - RL: điện trở tải trên module (đo hoặc đọc mã in, vd. 102 = 1 kΩ, 502 = 5 kΩ).
//  - R0: đặt CALIBRATE = true, để cảm biến ở nơi không khí sạch, nạp code: R0 = Rs / 9.83 được in ra -> ghi vào R0.
//  - Cảm biến mới cần "nung" 24–48 h lần đầu; mỗi lần bật cần làm nóng ≥ 1–3 phút (WARMUP_MS).
// Buzzer nối sẵn trên kit (GPIO4 trên DevKit, D3 trên board mở rộng XIAO), kêu khi vượt 3000 ppm.
// Khi chạy: chọn cảm biến, kéo "Nồng độ khí (ppm)".
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const int GAS_AO = 34;
const int BUZZER_PIN = 4;
const float VCC = 5.0;                          // điện áp cấp cho module MQ-2
const float DIVIDER = (10.0 + 20.0) / 20.0;     // hệ số cầu phân áp: AO = V(GPIO) × 1.5
const float RL = 5.0;                           // kΩ – điện trở tải trên module
float R0 = 10.0;                                // kΩ – kết quả hiệu chỉnh trong không khí sạch
const float CLEAN_AIR_RATIO = 9.83;             // Rs/R0 trong không khí sạch (datasheet)
const float M = -0.455, B = 1.251;              // đường LPG
const bool CALIBRATE = false;
const unsigned long WARMUP_MS = 10000;          // mô phỏng: 10 s; MQ-2 thật nên ≥ 60 000

Adafruit_SSD1306 display(128, 64, &Wire, -1);

// điện áp chân AO (trước cầu phân áp), trung bình 16 lần đọc
float readAoVolt() {
  long mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(GAS_AO);   // đã hiệu chỉnh ADC của ESP32
  return mv / 16.0 / 1000.0 * DIVIDER;
}

float readRs() {
  float v = readAoVolt();
  if (v < 0.01) v = 0.01;
  return RL * (VCC - v) / v;
}

float ppmFromRs(float rs) {
  return pow(10, (log10(rs / R0) - B) / M);
}

void calibrate() {
  Serial.println("Hiệu chỉnh R0 trong không khí sạch...");
  float sum = 0;
  for (int i = 0; i < 50; i++) { sum += readRs(); delay(100); }
  R0 = sum / 50 / CLEAN_AIR_RATIO;
  Serial.printf("R0 = %.2f kΩ  -> ghi giá trị này vào biến R0 rồi đặt CALIBRATE = false\\n", R0);
}

void setup() {
  Serial.begin(115200);
  analogSetPinAttenuation(GAS_AO, ADC_11db);    // dải đo 0 – ~3.1 V
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  unsigned long t = millis();
  if (t < WARMUP_MS) {                           // làm nóng dây nung, chưa đo
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 20);
    display.println("MQ-2 dang lam nong...");
    display.printf("con %lu s", (WARMUP_MS - t) / 1000 + 1);
    display.display();
    delay(500);
    return;
  }
  static bool calibrated = false;
  if (CALIBRATE && !calibrated) { calibrate(); calibrated = true; }

  float vao = readAoVolt();
  float rs = readRs();
  float ppm = ppmFromRs(rs);
  bool danger = ppm >= 3000;
  const char* level = ppm < 1000 ? "AN TOAN" : (danger ? "NGUY HIEM!" : "CANH BAO");
  Serial.printf("AO=%.2f V  Rs=%.2f kΩ  Rs/R0=%.2f  LPG≈%6.0f ppm  -> %s\\n", vao, rs, rs / R0, ppm, level);

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.printf("AO %.2fV  Rs %.1fk", vao, rs);
  display.setTextSize(2);
  display.setCursor(0, 14);
  display.printf("%.0f", ppm);
  display.setTextSize(1);
  display.print(" ppm");
  // thanh mức theo thang log (100 … 10000 ppm)
  int w = constrain((int)((log10(max(ppm, 100.0f)) - 2) / 2 * 126), 0, 126);
  display.drawRect(0, 34, 128, 8, SSD1306_WHITE);
  display.fillRect(1, 35, w, 6, SSD1306_WHITE);
  // trạng thái: chữ đảo màu khi nguy hiểm
  if (danger && (millis() / 500) % 2) {
    display.fillRect(0, 48, 128, 16, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  }
  display.setTextSize(2);
  display.setCursor(0, 49);
  display.print(level);
  display.setTextColor(SSD1306_WHITE);
  display.display();

  if (danger) tone(BUZZER_PIN, 2800);
  else noTone(BUZZER_PIN);
  delay(500);
}
`,
    diagram: compose(mq2At5V('AO', 'D34'), { parts: OLED_PARTS, conns: OLED_AUTO }, buzzerAt('D4', 300, 130)),
  },

  // ---------------------------------------------------------------- actuators
  {
    id: 'relay', name: '30. Relay: bật/tắt bóng đèn bằng nút & Serial', category: 'Chấp hành',
    code: `// Module relay 1 kênh (kích mức HIGH) đóng/ngắt bóng đèn 5 V: VIN -> COM, NO -> bóng đèn -> GND.
// Relay cách ly mạch điều khiển 3.3 V với tải; tiếp điểm NO đóng khi cuộn dây có điện.
// Điều khiển: nhấn nút (GPIO15) hoặc gõ ON / OFF / TOGGLE / TIMER <giây> trong Serial Monitor.
const int RELAY_PIN = 4;
const int BUTTON_PIN = 15;

bool relayOn = false;
unsigned long offAt = 0;      // tự tắt sau một khoảng thời gian (0 = không hẹn giờ)
int lastButton = HIGH;

void setRelay(bool on, const char* why) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  Serial.printf("Relay %s (%s)\\n", on ? "BẬT - đèn sáng" : "TẮT - đèn tắt", why);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  setRelay(false, "khởi động");
  Serial.println("Lệnh: ON, OFF, TOGGLE, TIMER 5");
}

void loop() {
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton) {
    lastButton = b;
    if (b == LOW) setRelay(!relayOn, "nút nhấn");
    delay(30);   // chống dội phím
  }

  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\\n');
    cmd.trim();
    cmd.toUpperCase();
    if (cmd == "ON") setRelay(true, "lệnh Serial");
    else if (cmd == "OFF") setRelay(false, "lệnh Serial");
    else if (cmd == "TOGGLE") setRelay(!relayOn, "lệnh Serial");
    else if (cmd.startsWith("TIMER")) {
      int s = cmd.substring(5).toInt();
      if (s <= 0) s = 5;
      setRelay(true, "hẹn giờ");
      offAt = millis() + s * 1000UL;
      Serial.printf("Tự tắt sau %d giây\\n", s);
    } else if (cmd.length()) Serial.println("Lệnh không hợp lệ: " + cmd);
  }

  if (offAt && millis() >= offAt) {
    offAt = 0;
    setRelay(false, "hết giờ");
  }
  delay(10);
}
`,
    diagram: compose(relayLamp('D4'), BUTTON_D15),
  },

  // ---------------------------------------------------------------- radio
  {
    id: 'lora-sender', name: '31. LoRa: node gửi nhiệt độ/độ ẩm', category: 'Truyền thông',
    code: `// LoRa SX1278 (Ra-02, 433 MHz) qua SPI: gửi nhiệt độ/độ ẩm DHT22 mỗi 5 giây.
// Thư viện: LoRa by Sandeep Mistry (#include <LoRa.h>).
// Thử nghiệm: mở trình giả lập ở MỘT TAB KHÁC với ví dụ "30. LoRa: node nhận" rồi chạy cả hai —
// các tab chung một "không gian sóng" ảo. Tần số, spreading factor và sync word hai bên phải giống nhau.
#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>

#define LORA_SS 5      // NSS
#define LORA_RST 4
#define LORA_DIO0 2
#define DHT_PIN 15

DHT dht(DHT_PIN, DHT22);
int counter = 0;

void setup() {
  Serial.begin(115200);
  dht.begin();
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);   // SCK/MISO/MOSI = 18/19/23 (SPI mặc định)
  if (!LoRa.begin(433E6)) {
    Serial.println("Khởi động LoRa thất bại! Kiểm tra dây nối.");
    while (true) delay(1000);
  }
  LoRa.setSpreadingFactor(7);
  LoRa.setSyncWord(0xF3);      // "mạng riêng": chỉ node cùng sync word mới nhận
  LoRa.setTxPower(17);
  Serial.println("LoRa node gửi: 433 MHz, SF7, sync word 0xF3");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  String msg = "#" + String(counter) + " T=" + String(t, 1) + "C H=" + String(h, 0) + "%";

  Serial.print("Gửi gói: ");
  Serial.println(msg);
  LoRa.beginPacket();
  LoRa.print(msg);
  LoRa.endPacket();            // chờ phát xong (thời gian phát phụ thuộc SF/BW/độ dài)
  counter++;
  delay(5000);
}
`,
    diagram: compose(loraRight(), dhtAt(330, 150)),
  },
  {
    id: 'lora-receiver', name: '32. LoRa: node nhận + OLED (RSSI/SNR)', category: 'Truyền thông',
    code: `// LoRa SX1278: nhận gói tin, in nội dung + RSSI/SNR và hiển thị lên OLED SSD1306 kèm vạch sóng.
// Chạy cùng ví dụ "29. LoRa: node gửi" ở một tab khác, hoặc chọn module LoRa
// và bấm "Nhận gói tin thử" để giả lập một gói từ node khác (sửa nội dung/RSSI trong thuộc tính).
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define LORA_SS 5
#define LORA_RST 4
#define LORA_DIO0 2

Adafruit_SSD1306 display(128, 64, &Wire, -1);
unsigned long packets = 0;

// 4 vạch sóng theo RSSI: > -70, -85, -100, -115 dBm
void drawSignal(int x, int y, int rssi) {
  for (int i = 0; i < 4; i++) {
    int h = 3 + i * 3;
    if (rssi > -70 - (3 - i) * 15) display.fillRect(x + i * 5, y - h, 3, h, SSD1306_WHITE);
    else display.drawRect(x + i * 5, y - h, 3, h, SSD1306_WHITE);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
  display.clearDisplay();
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("Khởi động LoRa thất bại!");
    display.setCursor(0, 28);
    display.print("LoRa loi!");
    display.display();
    while (true) delay(1000);
  }
  LoRa.setSpreadingFactor(7);
  LoRa.setSyncWord(0xF3);
  Serial.println("LoRa node nhận: đang chờ gói tin...");
  display.setCursor(0, 0);
  display.print("LoRa 433 MHz SF7");
  display.setCursor(0, 28);
  display.print("Cho goi tin...");
  display.display();
}

void loop() {
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String data = "";
    while (LoRa.available()) data += (char)LoRa.read();
    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();
    packets++;
    Serial.printf("[%lu] Nhận %d byte: \\"%s\\"  RSSI=%d dBm  SNR=%.1f dB\\n", packets, packetSize, data.c_str(), rssi, snr);

    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.printf("Goi #%lu  %d byte", packets, packetSize);
    drawSignal(108, 10, rssi);
    display.drawFastHLine(0, 12, 128, SSD1306_WHITE);
    display.setCursor(0, 16);
    display.print(data);                       // tự xuống dòng khi dài
    display.setCursor(0, 56);
    display.printf("RSSI %d  SNR %.1f", rssi, snr);
    display.display();

    digitalWrite(LED_BUILTIN, HIGH);
    delay(100);
    digitalWrite(LED_BUILTIN, LOW);
  }
}
`,
    diagram: compose(loraRight(120), { parts: OLED_PARTS, conns: OLED_AUTO }),
  },
  {
    id: 'espnow-sender', name: '33. ESP-NOW: gửi struct (broadcast)', category: 'Truyền thông',
    code: `// ESP-NOW: gửi dữ liệu trực tiếp giữa các ESP32, không cần router WiFi (tối đa 250 byte/gói).
// Gửi một struct (biến trở + nút nhấn) tới địa chỉ broadcast FF:FF:FF:FF:FF:FF mỗi giây và ngay khi nhấn nút.
// Thử nghiệm: mở ví dụ "28. ESP-NOW: nhận struct" ở một tab khác rồi chạy cả hai.
// Muốn gửi riêng (unicast) cho một board: thay broadcastAddress bằng MAC board nhận (in ở Serial của nó).
#include <WiFi.h>
#include <esp_now.h>

const int POT_PIN = 34;
const int BUTTON_PIN = 15;
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// struct phải giống hệt bên nhận
typedef struct {
  int id;
  int potValue;
  bool button;
  float voltage;
  char text[32];
} struct_message;

struct_message myData;
esp_now_peer_info_t peerInfo;
int lastButton = HIGH;
unsigned long lastSend = 0;
int counter = 0;

// arduino-esp32 3.3+: (const wifi_tx_info_t *info, ...); bản cũ: (const uint8_t *mac_addr, ...)
void OnDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "  -> gửi thành công" : "  -> gửi thất bại");
}

void sendData() {
  myData.id = counter++;
  myData.potValue = analogRead(POT_PIN);
  myData.button = digitalRead(BUTTON_PIN) == LOW;
  myData.voltage = myData.potValue * 3.3 / 4095;
  snprintf(myData.text, sizeof(myData.text), "Gói số %d", myData.id);
  esp_err_t result = esp_now_send(broadcastAddress, (uint8_t *)&myData, sizeof(myData));
  Serial.printf("Gửi #%d: pot=%d nút=%d (%d byte) %s\\n", myData.id, myData.potValue, myData.button, sizeof(myData),
                result == ESP_OK ? "" : esp_err_to_name(result));
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  WiFi.mode(WIFI_STA);
  Serial.print("MAC của board gửi: ");
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != ESP_OK) {
    Serial.println("Lỗi khởi tạo ESP-NOW");
    return;
  }
  esp_now_register_send_cb(OnDataSent);

  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Không thêm được peer");
    return;
  }
}

void loop() {
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton || millis() - lastSend > 1000) {
    lastButton = b;
    lastSend = millis();
    sendData();
  }
  delay(20);
}
`,
    diagram: compose(POT_LEFT, BUTTON_D15),
  },
  {
    id: 'espnow-receiver', name: '34. ESP-NOW: nhận struct → LED', category: 'Truyền thông',
    code: `// ESP-NOW: nhận struct từ ví dụ "27. ESP-NOW: gửi struct" (chạy ở tab khác).
// Biến trở bên gửi điều khiển độ sáng LED (PWM), nút nhấn bên gửi bật LED trên board.
#include <WiFi.h>
#include <esp_now.h>

const int LED_PIN = 4;

typedef struct {
  int id;
  int potValue;
  bool button;
  float voltage;
  char text[32];
} struct_message;

struct_message incoming;
volatile bool hasData = false;

// arduino-esp32 3.x: (const esp_now_recv_info_t *info, ...); bản 2.x: (const uint8_t *mac, ...)
void OnDataRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  memcpy(&incoming, data, sizeof(incoming));
  const uint8_t *mac = info->src_addr;
  Serial.printf("Từ %02X:%02X:%02X:%02X:%02X:%02X (%d byte): #%d \\"%s\\" pot=%d (%.2f V) nút=%s\\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], len,
                incoming.id, incoming.text, incoming.potValue, incoming.voltage, incoming.button ? "NHẤN" : "thả");
  hasData = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  WiFi.mode(WIFI_STA);
  Serial.print("MAC của board nhận: ");
  Serial.println(WiFi.macAddress());
  if (esp_now_init() != ESP_OK) {
    Serial.println("Lỗi khởi tạo ESP-NOW");
    return;
  }
  esp_now_register_recv_cb(OnDataRecv);
  Serial.println("Đang chờ dữ liệu ESP-NOW...");
}

void loop() {
  if (hasData) {
    hasData = false;
    analogWrite(LED_PIN, map(incoming.potValue, 0, 4095, 0, 255));
    digitalWrite(LED_BUILTIN, incoming.button);
  }
  delay(10);
}
`,
    diagram: diagram(LED_D4.parts, LED_D4.conns),
  },

  // ---------------------------------------------------------------- protocols
  {
    id: 'coap-server', name: '35. CoAP server: LED & nhiệt độ', category: 'Giao thức',
    code: `// CoAP (Constrained Application Protocol, RFC 7252): giao thức kiểu REST chạy trên UDP cho thiết bị IoT.
// Board này là CoAP server (IP tĩnh 10.13.37.50, cổng 5683) với 2 tài nguyên:
//   coap://10.13.37.50/led   GET -> "0"/"1"; PUT "1" | "0" | "toggle" để điều khiển LED
//   coap://10.13.37.50/temp  GET -> JSON nhiệt độ/độ ẩm DHT22
//   coap://10.13.37.50/.well-known/core -> danh sách tài nguyên (thư viện tự trả lời)
// Thử nghiệm: chạy ví dụ "23. CoAP client" ở một tab khác (cùng mạng WiFi ảo 10.13.37.x).
// Thư viện: CoAP simple library (#include <coap-simple.h>).
#include <WiFi.h>
#include <WiFiUdp.h>
#include <coap-simple.h>
#include <DHT.h>

const int LED_PIN = 4;
IPAddress local_IP(10, 13, 37, 50);
IPAddress gateway(10, 13, 37, 1);
IPAddress subnet(255, 255, 255, 0);

WiFiUDP udp;
Coap coap(udp);
DHT dht(15, DHT22);
bool ledState = false;

void callback_led(CoapPacket &packet, IPAddress ip, int port) {
  char p[packet.payloadlen + 1];
  memcpy(p, packet.payload, packet.payloadlen);
  p[packet.payloadlen] = NULL;
  String message(p);

  if (packet.code == COAP_PUT || packet.code == COAP_POST) {
    if (message == "1" || message == "on") ledState = true;
    else if (message == "0" || message == "off") ledState = false;
    else if (message == "toggle") ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
  }
  Serial.printf("[CoAP] %s /led từ %s:%d  payload=\\"%s\\"  -> LED %s\\n", packet.code == COAP_GET ? "GET" : "PUT",
                ip.toString().c_str(), port, p, ledState ? "BẬT" : "TẮT");
  coap.sendResponse(ip, port, packet.messageid, ledState ? "1" : "0");
}

void callback_temp(CoapPacket &packet, IPAddress ip, int port) {
  char json[64];
  snprintf(json, sizeof(json), "{\\"t\\":%.1f,\\"h\\":%.0f}", dht.readTemperature(), dht.readHumidity());
  Serial.printf("[CoAP] GET /temp từ %s -> %s\\n", ip.toString().c_str(), json);
  coap.sendResponse(ip, port, packet.messageid, json, strlen(json), COAP_CONTENT, COAP_APPLICATION_JSON, packet.token, packet.tokenlen);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();
  WiFi.config(local_IP, gateway, subnet);
  WiFi.begin("ESP32-IoT-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.print("\\nWiFi OK, IP: ");
  Serial.println(WiFi.localIP());

  coap.server(callback_led, "led");
  coap.server(callback_temp, "temp");
  coap.start();               // cổng 5683
  Serial.println("CoAP server đang chạy: coap://10.13.37.50/led, /temp");
}

void loop() {
  coap.loop();                // xử lý yêu cầu đến
  delay(10);
}
`,
    diagram: compose(LED_D4, dhtAt(300, 120)),
  },
  {
    id: 'coap-client', name: '36. CoAP client: GET/PUT tới server', category: 'Giao thức',
    code: `// CoAP client: nhấn nút -> PUT "toggle" tới coap://10.13.37.50/led (ví dụ "22. CoAP server" ở tab khác),
// mỗi 5 giây GET /temp. Khi khởi động còn thử GET coap://coap.me/test — server CoAP công cộng trên Internet
// (cần chạy bằng "node server.js": trình duyệt không gửi được UDP, server sẽ chuyển tiếp gói tin).
// Phản hồi đến hàm callback_response(): mã 2.05 = Content, 2.04 = Changed, 4.04 = Not Found...
#include <WiFi.h>
#include <WiFiUdp.h>
#include <coap-simple.h>

const int BUTTON_PIN = 15;
IPAddress serverIP(10, 13, 37, 50);

WiFiUDP udp;
Coap coap(udp);
int lastButton = HIGH;
unsigned long lastGet = 0;

void callback_response(CoapPacket &packet, IPAddress ip, int port) {
  char p[packet.payloadlen + 1];
  memcpy(p, packet.payload, packet.payloadlen);
  p[packet.payloadlen] = NULL;
  Serial.printf("[CoAP] Phản hồi %d.%02d từ %s (mid %d): %s\\n", packet.code >> 5, packet.code & 0x1F,
                ip.toString().c_str(), packet.messageid, p);
  if (ip == serverIP && packet.payloadlen == 1) digitalWrite(LED_BUILTIN, p[0] == '1');   // trạng thái LED bên server
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  WiFi.begin("ESP32-IoT-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.print("\\nWiFi OK, IP: ");
  Serial.println(WiFi.localIP());

  coap.response(callback_response);
  coap.start();

  IPAddress coapMe;
  if (WiFi.hostByName("coap.me", coapMe)) {
    Serial.print("coap.me = ");
    Serial.println(coapMe);
    coap.get(coapMe, 5683, "test");
  }
}

void loop() {
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton) {
    lastButton = b;
    if (b == LOW) {
      int id = coap.put(serverIP, 5683, "led", "toggle");
      Serial.printf("PUT /led toggle (mid %d)\\n", id);
    }
    delay(30);
  }
  if (millis() - lastGet > 5000) {
    lastGet = millis();
    coap.get(serverIP, 5683, "temp");
  }
  coap.loop();                // nhận phản hồi
  delay(10);
}
`,
    diagram: diagram(BUTTON_D15.parts, BUTTON_D15.conns),
  },
  // ---------------------------------------------------------------- catalog additions
  {
    id: 'rain-digital', name: 'Cảm biến mưa (DO): báo mưa', category: 'Cảm biến số (digital)',
    code: `// Báo mưa dùng chân DO của module cảm biến mưa (bộ so sánh LM393).
// DO tích cực mức THẤP: LOW = tấm cảm biến bị ướt (vượt ngưỡng chỉnh bằng biến trở trên module).
// Khi có mưa: LED sáng, còi kêu ngắn 3 lần, đếm thời gian mưa.
// Khi chạy: chọn cảm biến, kéo "Mức mưa (%)" lên trên "Ngưỡng DO".
const int RAIN_DO = 35;
const int LED_PIN = 5;
const int BUZZER_PIN = 4;    // buzzer nối sẵn trên kit: GPIO4 (DevKit), D3 (board mở rộng XIAO), A3 (C3 SuperMini)

bool raining = false;
unsigned long rainStart = 0;

void beep(int times) {
  for (int i = 0; i < times; i++) {
    tone(BUZZER_PIN, 2000);
    delay(120);
    noTone(BUZZER_PIN);
    delay(120);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RAIN_DO, INPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Trạm báo mưa sẵn sàng");
}

void loop() {
  bool wet = digitalRead(RAIN_DO) == LOW;
  if (wet != raining) {
    raining = wet;
    digitalWrite(LED_PIN, raining);
    if (raining) {
      rainStart = millis();
      Serial.println("☔ Trời bắt đầu mưa -> đóng cửa sổ, thu quần áo!");
      beep(3);
    } else {
      Serial.printf("Tạnh mưa (mưa kéo dài %lu giây)\\n", (millis() - rainStart) / 1000);
    }
  }
  delay(100);
}
`,
    diagram: compose(sensorLeft('esp32-iot-rain-sensor', 'rain1', { rain: 0, threshold: 30 }, 174, [['D35', 'DO', 'purple']], 60), LED_D5, buzzerAt()),
  },
  {
    id: 'photodiode-digital', name: 'Photodiode (DO): đếm số lần chắn tia sáng', category: 'Cảm biến số (digital)',
    code: `// Cảm biến ánh sáng photodiode, chân DO: LOW khi ánh sáng mạnh hơn ngưỡng, HIGH khi tối/bị che.
// Photodiode phản ứng nhanh hơn quang trở nhiều nên hợp với "hàng rào ánh sáng": đếm vật đi qua
// chắn tia sáng (người qua cửa, sản phẩm trên băng chuyền...). Dùng ngắt ngoài cạnh lên (RISING) trên DO.
// Khi chạy: chọn cảm biến, kéo "Độ sáng (lux)" xuống dưới ngưỡng rồi lên lại = một lần chắn.
const int PD_DO = 35;
const int LED_PIN = 4;

volatile unsigned long count = 0;
volatile unsigned long lastIrq = 0;

void IRAM_ATTR onBlocked() {
  unsigned long t = millis();
  if (t - lastIrq > 50) {        // chống nhiễu: bỏ các xung cách nhau < 50 ms
    count++;
    lastIrq = t;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PD_DO, INPUT);
  pinMode(LED_PIN, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(PD_DO), onBlocked, RISING);
  Serial.println("Hàng rào ánh sáng: đang đếm...");
}

unsigned long shown = 0;

void loop() {
  bool blocked = digitalRead(PD_DO) == HIGH;
  digitalWrite(LED_PIN, blocked);          // LED sáng khi tia sáng đang bị chắn
  if (count != shown) {
    shown = count;
    Serial.printf("Vật đi qua! Tổng số lần: %lu\\n", shown);
  }
  delay(20);
}
`,
    diagram: compose(sensorLeft('esp32-iot-photodiode-sensor', 'pd1', { lux: 1500, threshold: 200 }, 98, [['D35', 'DO', 'purple']]), LED_D4),
  },
  {
    id: 'photodiode-analog', name: 'Photodiode (AO): đo cường độ sáng (lux) lên OLED', category: 'Cảm biến tương tự (analog)',
    code: `// Đo cường độ ánh sáng bằng photodiode, chân AO (analog).
// Dòng quang điện của photodiode tỉ lệ gần tuyến tính với độ rọi, chảy qua điện trở tải trên module:
// sáng hơn -> điện áp AO THẤP hơn. Công thức đổi sang lux dưới đây hiệu chỉnh cho module trong trình
// giả lập (AO = 0.98·VCC khi tối hẳn, giảm 0.93·VCC khi 2000 lux) — module thật cần đo lại 2 điểm này.
// Hiển thị lux, mức sáng và thanh mức trên OLED SSD1306 (I2C, 0x3C). Khi chạy: chọn cảm biến, kéo "Độ sáng (lux)".
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const int PD_AO = 34;            // ADC1
const float VCC = 3.3;
const float V_DARK = 0.98 * VCC; // điện áp AO khi tối hẳn
const float V_PER_LUX = 0.93 * VCC / 2000;

Adafruit_SSD1306 display(128, 64, &Wire, -1);

float readLux() {
  long mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PD_AO);
  float v = mv / 16.0 / 1000.0;
  return max(0.0f, (V_DARK - v) / V_PER_LUX);
}

const char* level(float lux) {
  if (lux < 50) return "Toi";
  if (lux < 300) return "Trong nha";
  if (lux < 1000) return "Sang";
  return "Rat sang";
}

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  float lux = readLux();
  Serial.printf("ADC=%4d  lux≈%6.1f  (%s)\\n", analogRead(PD_AO), lux, level(lux));
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("Photodiode - AO");
  display.setTextSize(2);
  display.setCursor(0, 16);
  display.printf("%.0f", lux);
  display.setTextSize(1);
  display.print(" lux");
  display.setCursor(0, 36);
  display.print(level(lux));
  // thanh mức 0..2000 lux
  int w = constrain((int)(lux * 126 / 2000), 0, 126);
  display.drawRect(0, 50, 128, 10, SSD1306_WHITE);
  display.fillRect(1, 51, w, 8, SSD1306_WHITE);
  display.display();
  delay(500);
}
`,
    diagram: compose(sensorLeft('esp32-iot-photodiode-sensor', 'pd1', { lux: 300, threshold: 200 }, 98, [['D34', 'AO', 'green']]), { parts: OLED_PARTS, conns: OLED_AUTO }),
  },
  {
    id: 'ds18b20', name: 'DS18B20: 2 cảm biến nhiệt độ trên một bus 1-Wire', category: 'Cảm biến 1 dây (OneWire)',
    code: `// DS18B20 giao tiếp 1-Wire: nhiều cảm biến dùng chung MỘT chân dữ liệu (DQ), mỗi con có mã ROM 64 bit riêng.
// Đấu nối: DQ -> GPIO15, VDD -> 3V3, GND -> GND, và BẮT BUỘC điện trở kéo lên 4.7 kΩ giữa DQ và 3V3.
// Thư viện: OneWire + DallasTemperature. Độ phân giải 9–12 bit (12 bit: 0.0625 °C, chuyển đổi mất 750 ms).
// Khi chạy: chọn từng cảm biến, kéo thanh "Nhiệt độ".
#include <OneWire.h>
#include <DallasTemperature.h>

const int ONE_WIRE_PIN = 15;

OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature sensors(&oneWire);
int count = 0;

void printAddress(uint8_t* addr) {
  for (int i = 0; i < 8; i++) Serial.printf("%02X", addr[i]);
}

void setup() {
  Serial.begin(115200);
  sensors.begin();
  count = sensors.getDeviceCount();
  Serial.printf("Tìm thấy %d cảm biến DS18B20\\n", count);
  uint8_t addr[8];
  for (int i = 0; i < count; i++) {
    if (sensors.getAddress(addr, i)) {
      Serial.printf("  #%d mã ROM: ", i);
      printAddress(addr);
      Serial.println();
    }
  }
  sensors.setResolution(12);
}

void loop() {
  sensors.requestTemperatures();        // ra lệnh tất cả cảm biến cùng chuyển đổi (chờ ~750 ms)
  for (int i = 0; i < count; i++) {
    float t = sensors.getTempCByIndex(i);
    if (t == DEVICE_DISCONNECTED_C) Serial.printf("#%d: lỗi đọc (mất kết nối)\\n", i);
    else Serial.printf("#%d: %.2f °C  (%.2f °F)\\n", i, t, DallasTemperature::toFahrenheit(t));
  }
  Serial.println("----");
  delay(2000);
}
`,
    diagram: diagram([
      { type: 'esp32-iot-ds18b20', id: 'ds1', top: 150, left: 190, attrs: { temperature: 26.5 } },
      { type: 'esp32-iot-ds18b20', id: 'ds2', top: 150, left: 250, attrs: { temperature: 31.2 } },
      { type: 'esp32-iot-resistor', id: 'rpu', top: 110, left: 300, attrs: { value: '4.7k' } },
    ], [
      C('esp:D15', 'ds1:DQ', 'green'), C('esp:3V3', 'ds1:VDD', 'red'), C('esp:GND.2', 'ds1:GND', 'black'),
      C('ds1:DQ', 'ds2:DQ', 'green'), C('ds1:VDD', 'ds2:VDD', 'red'), C('ds1:GND', 'ds2:GND', 'black'),
      C('ds2:DQ', 'rpu:1', 'green'), C('rpu:2', 'esp:3V3', 'red'),
    ]),
  },
  {
    id: 'dht11', name: 'DHT11: nhiệt độ & độ ẩm lên OLED', category: 'Cảm biến 1 dây (OneWire)',
    code: `// DHT11 đo nhiệt độ (0–50 °C, ±2 °C) và độ ẩm (20–90 %, ±5 %), độ phân giải 1 đơn vị.
// Giao tiếp 1 dây riêng của DHT (single-wire, không phải 1-Wire của Dallas): ESP32 kéo chân DATA xuống
// để bắt đầu, cảm biến trả về 40 bit. Không đọc nhanh hơn 1 lần/giây.
// Hiển thị lên OLED SSD1306 (I2C, 0x3C). Khi chạy: chọn DHT11 và kéo thanh "Nhiệt độ" / "Độ ẩm".
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

#define DHTPIN 15
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  dht.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Không tìm thấy OLED SSD1306!");
    for (;;) delay(1000);
  }
  display.setTextColor(SSD1306_WHITE);
  display.clearDisplay();
  display.setCursor(20, 28);
  display.print("DHT11 + OLED I2C");
  display.display();
  delay(1000);
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  display.clearDisplay();
  display.setTextSize(1);
  if (isnan(h) || isnan(t)) {
    Serial.println("Lỗi đọc DHT11!");
    display.setCursor(0, 28);
    display.print("Loi doc DHT11!");
    display.display();
    delay(2000);
    return;
  }
  float hi = dht.computeHeatIndex(t, h, false);
  Serial.printf("Nhiệt độ: %.0f °C  Độ ẩm: %.0f %%  Cảm giác như: %.1f °C\\n", t, h, hi);
  display.setCursor(0, 0);
  display.print("Nhiet do");
  display.setCursor(0, 32);
  display.print("Do am");
  display.setTextSize(2);
  display.setCursor(56, 0);
  display.printf("%.0f", t);
  int x = display.getCursorX();
  display.drawCircle(x + 3, 2, 2, SSD1306_WHITE);      // font 5x7 không có dấu độ: vẽ vòng tròn nhỏ
  display.setCursor(x + 8, 0);
  display.print("C");
  display.setCursor(56, 32);
  display.printf("%.0f %%", h);
  display.setTextSize(1);
  display.setCursor(0, 54);
  display.printf("Cam giac nhu %.1f C", hi);
  display.display();
  delay(2000);
}
`,
    diagram: compose({ parts: OLED_PARTS, conns: OLED_AUTO }, {
      parts: [{ type: 'esp32-iot-dht11', id: 'dht1', top: 120, left: 260, attrs: { temperature: 29, humidity: 70 } }],
      conns: [C('esp:D15', 'dht1:SDA', 'green'), C('esp:3V3', 'dht1:VCC', 'red'), C('esp:GND.2', 'dht1:GND', 'black')],
    }),
  },
  {
    id: 'aht10', name: 'AHT10/AHT20 (I2C): nhiệt độ & độ ẩm lên OLED', category: 'Cảm biến I2C',
    code: `// AHT10/AHT20: cảm biến nhiệt độ/độ ẩm số giao tiếp I2C (địa chỉ 0x38), chính xác hơn DHT
// (±0.3 °C, ±2 %RH). Dùng chung bus I2C với màn hình OLED (0x3C): cả hai nối vào SDA/SCL mặc định.
// Thư viện: Adafruit AHTX0 (dùng được cho cả AHT10, AHT20).
// Khi chạy: chọn cảm biến AHT và kéo thanh "Nhiệt độ" / "Độ ẩm".
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_AHTX0 aht;
Adafruit_SSD1306 display(128, 64, &Wire, -1);

// quét bus I2C: in địa chỉ các thiết bị trả lời
void scanI2C() {
  Serial.print("Thiết bị I2C:");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) Serial.printf(" 0x%02X", addr);
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  scanI2C();
  if (!aht.begin()) {
    Serial.println("Không tìm thấy AHT10/AHT20 — kiểm tra dây nối!");
    for (;;) delay(1000);
  }
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("Không tìm thấy OLED!");
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  sensors_event_t humidity, temp;
  aht.getEvent(&humidity, &temp);      // đo một lần (~80 ms)
  Serial.printf("Nhiệt độ: %.2f °C  Độ ẩm: %.2f %%RH\\n", temp.temperature, humidity.relative_humidity);

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("AHT10 - I2C 0x38");
  display.setTextSize(2);
  display.setCursor(0, 18);
  display.printf("%.1f C", temp.temperature);
  display.setCursor(0, 42);
  display.printf("%.1f %%", humidity.relative_humidity);
  display.display();
  delay(1000);
}
`,
    diagram: compose({ parts: OLED_PARTS, conns: OLED_AUTO }, {
      parts: [{ type: 'esp32-iot-aht10', id: 'aht1', top: 130, left: 250, attrs: { temperature: 26.5, humidity: 60 } }],
      conns: [C('esp:D21', 'aht1:SDA', 'blue'), C('esp:D22', 'aht1:SCL', 'yellow'), C('esp:3V3', 'aht1:VIN', 'red'), C('esp:GND.2', 'aht1:GND', 'black')],
    }),
  },
  {
    id: 'webserver-config', name: 'HTTP server: trang web cấu hình thiết bị', category: 'Kết nối',
    code: `// Web server trên ESP32 (thư viện WebServer): trang cấu hình thiết bị.
//  - GET  /            trang HTML: trạng thái + form cấu hình
//  - POST /save        lưu cấu hình (tên thiết bị, chu kỳ đọc cảm biến, ngưỡng nhiệt độ) vào flash (Preferences)
//  - GET  /led?state=on|off   bật/tắt LED
//  - GET  /api/status  trạng thái dạng JSON (trang web tự gọi mỗi 2 giây)
// Board dùng IP tĩnh 10.13.37.60 trong mạng WiFi ảo. Khi chạy, mở đường link trong tab "Mạng"
// (http://<địa chỉ trình giả lập>/__dev/10.13.37.60/) ở tab trình duyệt mới để dùng trang cấu hình.
// Board khác cũng truy cập được bằng HTTPClient: http.begin("http://10.13.37.60/api/status").
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <DHT.h>

const int LED_PIN = 4;
DHT dht(15, DHT22);
WebServer server(80);
Preferences prefs;

// cấu hình (lưu trong flash, giữ lại sau khi khởi động lại)
String deviceName;
int interval;          // giây giữa 2 lần đọc cảm biến
float tempLimit;       // vượt ngưỡng -> LED nháy cảnh báo
bool ledOn = false;
float temperature = NAN, humidity = NAN;
unsigned long lastRead = 0;

const char PAGE[] = R"rawliteral(<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%NAME%</title>
<style>body{font-family:sans-serif;max-width:420px;margin:20px auto;padding:0 12px;color:#222}
.card{border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0}
label{display:block;margin:8px 0 2px}input{width:100%;padding:6px;box-sizing:border-box}
button{padding:8px 14px;margin:6px 6px 0 0}.big{font-size:26px;font-weight:bold}</style></head>
<body><h2>%NAME%</h2>
<div class="card">Nhiệt độ: <span class="big" id="t">%TEMP%</span> °C &nbsp; Độ ẩm: <span class="big" id="h">%HUM%</span> %<br>
LED: <b id="led">%LED%</b> <span id="alarm"></span><br>
<button onclick="led('on')">Bật LED</button><button onclick="led('off')">Tắt LED</button></div>
<form class="card" method="POST" action="save"><b>Cấu hình</b>
<label>Tên thiết bị</label><input name="name" value="%NAME%" maxlength="24">
<label>Chu kỳ đọc cảm biến (giây)</label><input name="interval" type="number" min="1" max="3600" value="%INTERVAL%">
<label>Ngưỡng cảnh báo nhiệt độ (°C)</label><input name="limit" type="number" step="0.1" value="%LIMIT%">
<button type="submit">Lưu cấu hình</button></form>
<script>
function show(s){document.getElementById('t').textContent=s.temperature.toFixed(1);
document.getElementById('h').textContent=s.humidity.toFixed(0);
document.getElementById('led').textContent=s.led?'BẬT':'TẮT';
document.getElementById('alarm').textContent=s.alarm?'⚠ Vượt ngưỡng nhiệt độ!':'';}
function led(st){fetch('led?state='+st).then(function(r){return r.json();}).then(show);}
setInterval(function(){fetch('api/status').then(function(r){return r.json();}).then(show);},2000);
</script></body></html>)rawliteral";

void loadConfig() {
  prefs.begin("config", true);
  deviceName = prefs.getString("name", "ESP32 Phòng khách");
  interval = prefs.getInt("interval", 5);
  tempLimit = prefs.getFloat("limit", 32.0);
  prefs.end();
}

bool alarmOn() { return !isnan(temperature) && temperature > tempLimit; }

String statusJson() {
  JsonDocument doc;
  doc["name"] = deviceName;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["led"] = ledOn;
  doc["alarm"] = alarmOn();
  doc["uptime"] = millis() / 1000;
  String s;
  serializeJson(doc, s);
  return s;
}

void handleRoot() {
  String html = PAGE;
  html.replace("%NAME%", deviceName);
  html.replace("%TEMP%", String(temperature, 1));
  html.replace("%HUM%", String(humidity, 0));
  html.replace("%LED%", ledOn ? "BẬT" : "TẮT");
  html.replace("%INTERVAL%", String(interval));
  html.replace("%LIMIT%", String(tempLimit, 1));
  server.send(200, "text/html", html);
}

void handleSave() {
  if (server.hasArg("name") && server.arg("name").length() > 0) deviceName = server.arg("name");
  interval = constrain(server.arg("interval").toInt(), 1, 3600);
  tempLimit = server.arg("limit").toFloat();
  prefs.begin("config", false);
  prefs.putString("name", deviceName);
  prefs.putInt("interval", interval);
  prefs.putFloat("limit", tempLimit);
  prefs.end();
  Serial.printf("Đã lưu cấu hình: tên=\\"%s\\", chu kỳ=%d s, ngưỡng=%.1f °C\\n", deviceName.c_str(), interval, tempLimit);
  server.sendHeader("Location", "/");
  server.send(303);                    // quay lại trang chủ
}

void handleLed() {
  String st = server.arg("state");
  if (st == "on") ledOn = true;
  else if (st == "off") ledOn = false;
  else { server.send(400, "text/plain", "state phải là on hoặc off"); return; }
  Serial.printf("Web: LED %s\\n", ledOn ? "BẬT" : "TẮT");
  server.send(200, "application/json", statusJson());
}

void handleStatus() { server.send(200, "application/json", statusJson()); }

void handleNotFound() { server.send(404, "text/plain", "Không tìm thấy: " + server.uri()); }

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();
  loadConfig();
  Serial.printf("Cấu hình: tên=\\"%s\\", chu kỳ=%d s, ngưỡng=%.1f °C\\n", deviceName.c_str(), interval, tempLimit);

  WiFi.mode(WIFI_STA);
  WiFi.config(IPAddress(10, 13, 37, 60), IPAddress(10, 13, 37, 1), IPAddress(255, 255, 255, 0));
  WiFi.begin("ESP32-IoT-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.print("\\nWiFi OK, mở trang cấu hình: http://");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/led", HTTP_GET, handleLed);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("HTTP server đã chạy");
}

void loop() {
  server.handleClient();               // xử lý yêu cầu HTTP đến
  if (millis() - lastRead >= (unsigned long)interval * 1000 || lastRead == 0) {
    lastRead = millis();
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    Serial.printf("[%s] %.1f °C, %.0f %%%s\\n", deviceName.c_str(), temperature, humidity, alarmOn() ? "  ⚠ VƯỢT NGƯỠNG" : "");
  }
  // LED: theo lệnh từ web, hoặc nháy khi vượt ngưỡng nhiệt độ
  digitalWrite(LED_PIN, alarmOn() ? (millis() / 250) % 2 : ledOn);
  delay(2);
}
`,
    diagram: compose(LED_D4, dhtAt(300, 120)),
  },
  {
    id: 'freertos-queue', name: 'FreeRTOS: gửi & nhận dữ liệu đồng thời (queue, mutex)', category: 'FreeRTOS',
    code: `// Ba task FreeRTOS chạy đồng thời:
//  - taskSensor : đọc DHT22 mỗi 2 giây, đẩy kết quả vào hàng đợi (queue) — không đụng tới mạng
//  - taskSend   : chờ dữ liệu trong hàng đợi, gửi lên MQTT (publish)
//  - taskReceive: liên tục nhận lệnh MQTT (client.loop()) để bật/tắt LED ngay lập tức
// PubSubClient không an toàn khi 2 task dùng cùng lúc -> bảo vệ bằng mutex (xSemaphoreTake/Give).
// Thử: ở tab "MQTT", subscribe "esp32sim/rtos/#" để xem dữ liệu, publish "on"/"off" vào "esp32sim/rtos/led".
// Đổi TOPIC_BASE thành tên riêng để không trùng với người khác!
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

#define TOPIC_BASE "esp32sim/rtos"
const int LED_PIN = 4;

struct Reading {
  float temp;
  float hum;
  unsigned long at;
};

WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(15, DHT22);
QueueHandle_t readings;
SemaphoreHandle_t mqttMutex;

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[nhận] %s = %s\\n", topic, msg.c_str());
  if (msg == "on" || msg == "1") digitalWrite(LED_PIN, HIGH);
  if (msg == "off" || msg == "0") digitalWrite(LED_PIN, LOW);
}

void taskSensor(void* pv) {
  for (;;) {
    Reading r;
    r.temp = dht.readTemperature();
    r.hum = dht.readHumidity();
    r.at = millis();
    if (xQueueSend(readings, &r, pdMS_TO_TICKS(100)) != pdTRUE) Serial.println("[cảm biến] hàng đợi đầy, bỏ mẫu");
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

void taskSend(void* pv) {
  Reading r;
  char buf[96];
  for (;;) {
    if (xQueueReceive(readings, &r, portMAX_DELAY) == pdTRUE) {   // ngủ cho tới khi có dữ liệu
      snprintf(buf, sizeof(buf), "{\\"temp\\":%.1f,\\"hum\\":%.1f,\\"t\\":%lu}", r.temp, r.hum, r.at / 1000);
      xSemaphoreTake(mqttMutex, portMAX_DELAY);
      bool ok = client.connected() && client.publish(TOPIC_BASE "/sensor", buf);
      xSemaphoreGive(mqttMutex);
      Serial.printf("[gửi] %s %s (còn %d mẫu chờ)\\n", buf, ok ? "OK" : "LỖI", uxQueueMessagesWaiting(readings));
    }
  }
}

void taskReceive(void* pv) {
  for (;;) {
    xSemaphoreTake(mqttMutex, portMAX_DELAY);
    if (!client.connected()) {
      String id = "esp32-rtos-" + String(random(0xffff), HEX);
      if (client.connect(id.c_str())) {
        client.subscribe(TOPIC_BASE "/led");
        Serial.println("[nhận] MQTT đã kết nối, đã subscribe " TOPIC_BASE "/led");
      }
    }
    client.loop();
    xSemaphoreGive(mqttMutex);
    vTaskDelay(pdMS_TO_TICKS(client.connected() ? 10 : 3000));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();
  WiFi.begin("ESP32-IoT-GUEST", "");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println("\\nWiFi connected");
  client.setServer("broker.hivemq.com", 1883);
  client.setCallback(callback);

  readings = xQueueCreate(5, sizeof(Reading));
  mqttMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(taskSensor, "sensor", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskSend, "send", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskReceive, "receive", 4096, NULL, 2, NULL, 0);
}

void loop() {
  vTaskDelete(NULL);   // mọi việc đã chia cho các task
}
`,
    diagram: compose(LED_D4, dhtAt(300, 120)),
  },
];

// Example menu: categories in order and the examples they list (numbered in this order). Examples not listed stay in
// EXAMPLES — still run by the tests and found by id — but are hidden from the menu.
const CATALOG = [
  ['Vào ra cơ bản', [
    ['blink', 'Nhấp nháy LED'],
    ['button', 'Nút nhấn điều khiển LED'],
    ['lcd-i2c', 'LCD 16x2 I2C: chữ chạy & ký tự tự tạo'],
    ['oled', 'OLED SSD1306 I2C: đồ họa'],
  ]],
  ['Cảm biến số (digital)', [
    ['flame-digital', 'Cảm biến lửa (DO): báo cháy'],
    ['rain-digital', 'Cảm biến mưa (DO): báo mưa'],
    ['pir-interrupt', 'Cảm biến chuyển động PIR (ngắt ngoài)'],
    ['ldr-digital', 'Quang trở (DO): đèn ngủ tự động'],
    ['photodiode-digital', 'Photodiode (DO): đếm số lần chắn tia sáng'],
  ]],
  ['Cảm biến tương tự (analog)', [
    ['ldr-analog', 'Quang trở (AO): đèn tự điều chỉnh độ sáng'],
    ['photodiode-analog', 'Photodiode (AO): đo cường độ sáng (lux) lên OLED'],
    ['gas-analog', 'Khí gas MQ-2 (AO): đo ppm + OLED'],
    ['soil-irrigation', 'Độ ẩm đất (AO): tưới cây tự động'],
    ['water-level', 'Cảm biến mực nước (AO): báo mức bồn'],
    ['ultrasonic', 'Cảm biến siêu âm HC-SR04: đo khoảng cách + còi'],
  ]],
  ['Cảm biến 1 dây (OneWire)', [
    ['ds18b20', 'DS18B20: 2 cảm biến nhiệt độ trên một bus 1-Wire'],
    ['dht11', 'DHT11: nhiệt độ & độ ẩm lên OLED'],
  ]],
  ['Cảm biến I2C', [
    ['aht10', 'AHT10/AHT20: nhiệt độ & độ ẩm lên OLED'],
  ]],
  ['Kết nối', [
    ['http-get', 'HTTP GET: nhận dữ liệu thời tiết (JSON) → OLED'],
    ['http-post', 'HTTP POST: gửi dữ liệu cảm biến (JSON)'],
    ['mqtt', 'MQTT: gửi DHT22, nhận lệnh bật/tắt LED'],
    ['coap-server', 'CoAP server: LED & nhiệt độ'],
    ['coap-client', 'CoAP client: GET/PUT tới server'],
    ['webserver-config', 'HTTP server: trang web cấu hình thiết bị'],
  ]],
  ['FreeRTOS', [
    ['freertos', 'Nhấp nháy 2 LED với chu kỳ khác nhau'],
    ['freertos-queue', 'Gửi & nhận dữ liệu đồng thời (queue, mutex)'],
  ]],
  ['Khác', [
    ['espnow-sender', 'ESP-NOW: gửi struct (broadcast)'],
    ['espnow-receiver', 'ESP-NOW: nhận struct → LED'],
    ['lora-sender', 'LoRa: node gửi nhiệt độ/độ ẩm'],
    ['lora-receiver', 'LoRa: node nhận + OLED (RSSI/SNR)'],
  ]],
];

const byId = new Map(ALL.map((e) => [e.id, e]));
let num = 0;
const LISTED = CATALOG.flatMap(([category, items]) => items.map(([id, name]) => {
  if (!byId.has(id)) throw new Error('CATALOG: unknown example ' + id);
  return { ...byId.get(id), category, name: `${String(++num).padStart(2, '0')}. ${name}` };
}));
const listedIds = new Set(LISTED.map((e) => e.id));
export const EXAMPLES = [...LISTED, ...ALL.filter((e) => !listedIds.has(e.id)).map((e) => ({ ...e, name: e.name.replace(/^\d+\.\s*/, ''), hidden: true }))];
