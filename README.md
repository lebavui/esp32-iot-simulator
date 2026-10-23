# ESP32 IoT Simulator

Ứng dụng web mô phỏng kit **ESP32 DevKit V1**, giao diện tương tự Wokwi: viết code Arduino (C/C++), lắp mạch với
các linh kiện điện tử bằng kéo-thả/nối dây, và chạy mô phỏng ngay trong trình duyệt. Hỗ trợ **WiFi, HTTP và MQTT thật**
(kết nối Internet), phục vụ giảng dạy IoT và hệ nhúng.

## Chạy ứng dụng

Yêu cầu: Node.js ≥ 18 (không cần cài thêm gói nào).

```bash
node server.js          # hoặc: npm start
# mở http://127.0.0.1:8080/
```

`server.js` vừa phục vụ file tĩnh vừa cung cấp **proxy HTTP** (`/__proxy`) để các yêu cầu `HTTPClient` của ESP32 ảo
không bị trình duyệt chặn do CORS / mixed-content. Proxy chỉ lắng nghe trên `127.0.0.1`.
Có thể dùng bất kỳ web server tĩnh nào khác (ví dụ `npx serve`), khi đó HTTP được gọi trực tiếp bằng `fetch`
và chỉ hoạt động với API cho phép CORS.

## Tính năng

**Lập trình kiểu Arduino** — trình biên dịch tự viết (lexer → parser → sinh mã JavaScript bất đồng bộ) cho tập con C/C++:
`#define`/`#if`/macro hàm, kiểu số nguyên có tràn bit như trên ESP32 (`byte`, `uint8_t`, `unsigned long`…), chia nguyên,
`float` in 2 chữ số, `String` của Arduino, mảng nhiều chiều, `struct`, `enum`, tham chiếu `&`, con trỏ cơ bản,
lambda, range-for, `switch`, biến `static`. Lỗi biên dịch được báo theo dòng/cột kiểu GCC
(`'x' was not declared in this scope`, `expected ';' …`).

**Linh kiện**: ESP32 DevKit V1 (30 chân, LED onboard GPIO2), LED, LED RGB, điện trở, nút nhấn, công tắc gạt,
biến trở, buzzer, DHT22/DHT11, HC-SR04, cảm biến ánh sáng LDR, PIR, servo, LED 7 đoạn, LCD 16x2/20x4 I2C,
OLED SSD1306 128x64, dải NeoPixel.

**Mô phỏng mạch điện**: dây và công tắc gộp chân thành các net; điện áp được giải bằng phân tích nút
(điện trở, cầu phân áp, biến trở, điện trở kéo lên/xuống nội `INPUT_PULLUP`). Phát hiện ngắn mạch, PWM điều chỉnh
độ sáng, ngắt ngoài (`attachInterrupt`) kích hoạt theo sườn tín hiệu. Linh kiện I2C chỉ hoạt động khi nối đúng
SDA/SCL và cấp nguồn; ADC2 khi bật WiFi và chân chỉ-vào (34–39) đều có cảnh báo như ESP32 thật.

**Thư viện**: Arduino core, `Serial`, `WiFi.h`, `HTTPClient.h`, `PubSubClient.h` (MQTT), `ArduinoJson.h` (v6 & v7),
`LiquidCrystal_I2C`, `Adafruit_SSD1306`/`Adafruit_GFX`, `Adafruit_NeoPixel`, `DHT.h`, `DHTesp.h`, `ESP32Servo.h`,
`Wire.h`, `Preferences.h`, `time.h` (NTP), FreeRTOS (`xTaskCreate`, `vTaskDelay`…), LEDC v2 & v3.

**Mạng**:
- `WiFi.begin(...)` kết nối vào một AP ảo (mọi SSID), sau đó ESP32 ảo truy cập Internet thật.
- MQTT: trình duyệt không mở được TCP, nên `client.setServer("broker.hivemq.com", 1883)` được tự động nối qua
  WebSocket (`wss://broker.hivemq.com:8884/mqtt`). Bảng ánh xạ broker sửa trong ⚙ Cài đặt.
- Tab **MQTT Client** có sẵn để subscribe/publish và điều khiển thiết bị ảo; tab **Nhật ký mạng** ghi mọi sự kiện WiFi/HTTP/MQTT.

**Giao diện**: trình soạn thảo code (CodeMirror) + tab `diagram.json` sửa trực tiếp, canvas kéo-thả có zoom/pan,
nối dây có điểm gấp và đổi màu, bảng thuộc tính (thanh trượt nhiệt độ, khoảng cách, độ sáng… thay đổi khi đang chạy),
Serial Monitor hai chiều, 17 ví dụ mẫu, tự lưu vào trình duyệt, lưu/mở file `.json`/`.ino`, chia sẻ dự án qua link.

## Cấu trúc mã nguồn

```
index.html, css/style.css
js/main.js               giao diện chính, điều khiển mô phỏng, Serial Monitor, lưu trữ
js/compiler/             lexer.js (tiền xử lý), parser.js (AST), codegen.js (AST → JS), compile.js
js/runtime/              runtime.js (Arduino core, lập lịch delay/task/ngắt), libs.js (thư viện), meta.js, format.js
js/circuit/              parts.js (linh kiện: hình SVG, chân, hành vi điện), circuit.js (bộ giải mạch), editor.js (canvas)
js/examples.js           ví dụ mẫu (code + sơ đồ)
js/mqttpanel.js, js/help.js, js/font5x7.js
vendor/                  CodeMirror 5, mqtt.js (đã tải sẵn, chạy offline được trừ phần Internet)
server.js                server tĩnh + proxy HTTP
tests/                   kiểm thử bằng Node (biên dịch & chạy ví dụ với bộ giải mạch)
```

Thêm linh kiện mới: khai báo trong `PARTS` (`js/circuit/parts.js`) — kích thước, chân, `render()` SVG, `update()`
hiển thị, `links()`/`drive()` cho hành vi điện. Thêm thư viện mới: tạo lớp trong `js/runtime/libs.js`, đăng ký vào `LIBS`
và khai báo kiểu trả về trong `meta.ret` để trình biên dịch định dạng đúng khi in.

## Kiểm thử

```bash
npm test                               # biên dịch + chạy toàn bộ ví dụ với bộ giải mạch
node tests/harness.mjs tests/t_basic.ino   # chạy một sketch, in Serial
```

## Giới hạn

- Code được dịch sang JavaScript, không giả lập tập lệnh Xtensa: thời gian theo đồng hồ thực, không chính xác theo chu kỳ máy.
- Chưa hỗ trợ: lớp tự định nghĩa có phương thức, template tự viết, `new`/`delete`, `goto`, socket TCP thô (`WiFiClient.connect`).
- Bộ giải mạch là mô hình DC đơn giản (LED/diode không được mô hình như phần tử dẫn điện).
