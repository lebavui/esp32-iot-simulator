# ESP32 IoT Simulator

Ứng dụng web mô phỏng kit **ESP32 DevKit V1**: viết code Arduino (C/C++), lắp mạch với
các linh kiện điện tử bằng kéo-thả/nối dây, và chạy mô phỏng ngay trong trình duyệt. Hỗ trợ **WiFi, HTTP, MQTT và CoAP thật**
(kết nối Internet), LoRa và ESP-NOW giữa nhiều tab trình duyệt, phục vụ giảng dạy IoT và hệ nhúng.

## Chạy ứng dụng

Yêu cầu: Node.js ≥ 18 (không cần cài thêm gói nào).

```bash
node server.js          # hoặc: npm start
# mở http://127.0.0.1:8080/
```

`server.js` vừa phục vụ file tĩnh vừa cung cấp **proxy HTTP** (`/__proxy`) để các yêu cầu `HTTPClient` của ESP32 ảo
không bị trình duyệt chặn do CORS / mixed-content, cùng DNS (`/__proxy/dns`) và chuyển tiếp UDP (`/__proxy/udp`, mặc định chỉ
cổng CoAP 5683 — đổi bằng biến môi trường `UDP_PORTS`) cho `WiFi.hostByName`, `WiFiUDP` và CoAP. Proxy chỉ lắng nghe trên `127.0.0.1`.
Có thể dùng bất kỳ web server tĩnh nào khác (ví dụ `npx serve`), khi đó HTTP được gọi trực tiếp bằng `fetch`
và chỉ hoạt động với API cho phép CORS.

## Tính năng

**Lập trình kiểu Arduino** — trình biên dịch tự viết (lexer → parser → sinh mã JavaScript bất đồng bộ) cho tập con C/C++:
`#define`/`#if`/macro hàm, kiểu số nguyên có tràn bit như trên ESP32 (`byte`, `uint8_t`, `unsigned long`…), chia nguyên,
`float` in 2 chữ số, `String` của Arduino, mảng nhiều chiều, `struct`, `enum`, tham chiếu `&`, con trỏ cơ bản,
lambda, range-for, `switch`, biến `static`. Lỗi biên dịch được báo theo dòng/cột kiểu GCC
(`'x' was not declared in this scope`, `expected ';' …`).

**Board**: ESP32 DevKit V1 (30 chân, LED onboard GPIO2), Seeed XIAO ESP32-C3, Seeed XIAO ESP32-S3 (LED onboard GPIO21),
ESP32-C3 SuperMini (LED onboard GPIO8, nút BOOT GPIO9). Mỗi board có hằng số chân (`A0`, `D0`…, `SDA`/`SCL`, `LED_BUILTIN`)
theo `pins_arduino.h` của arduino-esp32 3.3, macro `CONFIG_IDF_TARGET_ESP32C3`/`…S3`, và kiểm tra theo chip (chân flash,
ADC1/ADC2, chân chỉ-vào của ESP32, ADC2 của ESP32-C3 không dùng được). Board chọn ở ô riêng trên thanh công cụ; đổi board
(hoặc mở ví dụ khi đang chọn board khác) sẽ tự chuyển dây nối và số chân trong code sang board đó.

**Linh kiện**: LED, LED RGB, điện trở, nút nhấn, công tắc gạt,
biến trở, buzzer, DHT22/DHT11, HC-SR04, PIR, các module cảm biến có chân AO/DO (bộ so sánh LM393): ánh sáng LDR,
lửa hồng ngoại, khí gas MQ-2 (đường đặc tuyến LPG theo datasheet), mưa, độ ẩm đất; cảm biến mực nước, module relay 1 kênh
(kích HIGH/LOW, tiếp điểm COM/NO/NC), bóng đèn, servo, LED 7 đoạn, LCD 16x2/20x4 I2C, OLED SSD1306 128x64, dải NeoPixel,
module LoRa SX1278 (Ra-02, SPI).

**Mô phỏng mạch điện**: dây và công tắc gộp chân thành các net; điện áp được giải bằng phân tích nút
(điện trở, cầu phân áp, biến trở, điện trở kéo lên/xuống nội `INPUT_PULLUP`). Phát hiện ngắn mạch, PWM điều chỉnh
độ sáng, ngắt ngoài (`attachInterrupt`) kích hoạt theo sườn tín hiệu. Linh kiện I2C chỉ hoạt động khi nối đúng
SDA/SCL và cấp nguồn; ADC2 khi bật WiFi, chân chỉ-vào (34–39) và điện áp vào GPIO vượt 3,6 V (vd. cảm biến 5 V không qua
cầu phân áp) đều có cảnh báo như ESP32 thật.

**Thư viện**: Arduino core, `Serial`, `WiFi.h`, `HTTPClient.h`, `PubSubClient.h` (MQTT), `ArduinoJson.h` (v6 & v7),
`LiquidCrystal_I2C`, `Adafruit_SSD1306`/`Adafruit_GFX`, `Adafruit_NeoPixel`, `DHT.h`, `DHTesp.h`, `ESP32Servo.h`,
`Wire.h`, `Preferences.h`, `time.h` (NTP), FreeRTOS (`xTaskCreate`, `vTaskDelay`…), LEDC v2 & v3,
`LoRa.h` (Sandeep Mistry), `esp_now.h`, `WiFiUdp.h`, `coap-simple.h` (CoAP simple library).

**Mạng**:
- `WiFi.begin(...)` kết nối vào một AP ảo (mọi SSID), sau đó ESP32 ảo truy cập Internet thật.
- MQTT: trình duyệt không mở được TCP, nên `client.setServer("broker.hivemq.com", 1883)` được tự động nối qua
  WebSocket (`wss://broker.hivemq.com:8884/mqtt`). Bảng ánh xạ broker sửa trong ⚙ Cài đặt.
- Tab **MQTT Client** có sẵn để subscribe/publish và điều khiển thiết bị ảo; tab **Nhật ký mạng** ghi mọi sự kiện WiFi/HTTP/MQTT/LoRa/ESP-NOW/CoAP.
- **Nhiều board cùng lúc**: mỗi tab trình duyệt (cùng địa chỉ) là một board; các tab chung một "không gian sóng" ảo
  (`BroadcastChannel`) cho gói LoRa (lọc theo tần số, SF, BW, sync word), khung ESP-NOW (broadcast/unicast có ACK) và UDP
  trong mạng WiFi ảo `10.13.37.0/24` (IP động .100–.249 suy từ MAC, IP tĩnh bằng `WiFi.config`). Module LoRa có nút
  "Nhận gói tin thử" để thử một tab.
- UDP/CoAP tới địa chỉ Internet đi qua `server.js` (ví dụ `coap://coap.me/test`).

**Giao diện**: trình soạn thảo code (CodeMirror) + tab `diagram.json` sửa trực tiếp, canvas kéo-thả có zoom/pan,
nối dây có điểm gấp và đổi màu (dây tự đi vuông góc vòng qua linh kiện, đi lại khi di chuyển linh kiện), bảng thuộc tính (thanh trượt nhiệt độ, khoảng cách, độ sáng… thay đổi khi đang chạy),
Serial Monitor hai chiều, giao diện tối/sáng (nút ☀/🌙 hoặc theo hệ điều hành), ẩn/hiện khung code (Ctrl+B) và panel dưới (Ctrl+J), 36 ví dụ mẫu, tự lưu vào trình duyệt, lưu/mở file `.json`/`.ino`, chia sẻ dự án qua link.

## Cấu trúc mã nguồn

```
index.html, css/style.css
js/boards.js             các board & chip: sơ đồ chân → GPIO, khả năng của chip, hằng số pins_arduino.h
js/port.js               chuyển dự án sang board khác (gán lại chân, dây nối, số chân trong code)
js/main.js               giao diện chính, điều khiển mô phỏng, Serial Monitor, lưu trữ
js/compiler/             lexer.js (tiền xử lý), parser.js (AST), codegen.js (AST → JS), compile.js
js/runtime/              runtime.js (Arduino core, lập lịch delay/task/ngắt), libs.js (thư viện), radio.js (LoRa, ESP-NOW,
                         UDP, CoAP qua không gian sóng ảo), print.js, meta.js, format.js
js/circuit/              parts.js (linh kiện: hình SVG, chân, hành vi điện), circuit.js (bộ giải mạch), editor.js (canvas),
                         route.js (tự đi dây vuông góc, tránh linh kiện)
js/examples.js           ví dụ mẫu (code + sơ đồ)
js/mqttpanel.js, js/help.js, js/font5x7.js
vendor/                  CodeMirror 5, mqtt.js (đã tải sẵn, chạy offline được trừ phần Internet)
server.js                server tĩnh + proxy HTTP, DNS, UDP
tests/                   kiểm thử bằng Node (biên dịch & chạy ví dụ với bộ giải mạch)
```

Thêm linh kiện mới: khai báo trong `PARTS` (`js/circuit/parts.js`) — kích thước, chân, `render()` SVG, `update()`
hiển thị, `links()`/`drive()` cho hành vi điện. Thêm thư viện mới: tạo lớp trong `js/runtime/libs.js`, đăng ký vào `LIBS`
và khai báo kiểu trả về trong `meta.ret` để trình biên dịch định dạng đúng khi in.

## Kiểm thử

```bash
npm test                               # biên dịch + chạy toàn bộ ví dụ với bộ giải mạch
node tests/harness.mjs tests/t_basic.ino   # chạy một sketch, in Serial
node tests/t_radio.mjs                 # cảm biến/relay mới, LoRa/ESP-NOW/CoAP giữa hai runtime
```

## Giới hạn

- Code được dịch sang JavaScript, không giả lập tập lệnh Xtensa: thời gian theo đồng hồ thực, không chính xác theo chu kỳ máy.
- Chưa hỗ trợ: lớp tự định nghĩa có phương thức, template tự viết, `new`/`delete`, `goto`, socket TCP thô (`WiFiClient.connect`).
- `struct` sao chép theo byte (`memcpy`, ESP-NOW) không có byte đệm (padding), khớp với `sizeof` của trình giả lập.
- Bộ giải mạch là mô hình DC đơn giản (LED/diode không được mô hình như phần tử dẫn điện).
