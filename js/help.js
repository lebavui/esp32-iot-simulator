export const HELP_HTML = `
<h3>Bắt đầu nhanh</h3>
<ul>
  <li>Chọn một <b>Ví dụ mẫu</b> ở thanh trên cùng, rồi bấm <b>▶</b> (hoặc <code>Ctrl+Enter</code>) để biên dịch và chạy.</li>
  <li>Viết code Arduino (C/C++) trong tab <b>sketch.ino</b> với <code>setup()</code> và <code>loop()</code> như trên Arduino IDE.</li>
  <li>Kết quả <code>Serial.print</code> hiện ở <b>Serial Monitor</b>; có thể gửi dữ liệu xuống ESP32 qua ô nhập bên dưới.</li>
  <li>Nút <b>☀ / 🌙</b> trên thanh công cụ chuyển giao diện sáng / tối; trong ⚙ Cài đặt có thêm lựa chọn "Theo hệ điều hành".</li>
  <li>Dự án được tự động lưu trong trình duyệt. Dùng <b>💾 Lưu</b> để tải file .json (Shift+bấm để tải .ino), <b>🔗 Chia sẻ</b> để tạo link.</li>
</ul>
<h3>Lắp mạch</h3>
<ul>
  <li><b>＋ Linh kiện</b> để thêm linh kiện; kéo thả để di chuyển; phím <code>R</code> xoay, <code>Delete</code> xóa.</li>
  <li>Nối dây: bấm vào một chân (di chuột lên chân để xem tên), bấm vào nền để thêm điểm gấp, bấm vào chân thứ hai để kết thúc. <code>Esc</code>/chuột phải để hủy.</li>
  <li>Chọn dây để đổi màu/xóa; nháy đúp lên dây để thêm điểm gấp, kéo điểm gấp để chỉnh.</li>
  <li>Khi đang chạy: nhấn giữ <b>nút nhấn</b>, bấm <b>công tắc gạt</b>, bấm <b>PIR</b> để mô phỏng chuyển động; chọn cảm biến (DHT22, DS18B20, AHT10, LDR, photodiode, HC-SR04, biến trở…) để kéo thanh trượt thay đổi giá trị đo.</li>
  <li>Mô phỏng điện: điện trở, điện trở kéo lên/xuống nội (<code>INPUT_PULLUP</code>), cầu phân áp, biến trở được giải theo định luật Ohm; phát hiện ngắn mạch; cảnh báo khi chân GPIO nhận điện áp trên 3,6 V (cảm biến 5 V như MQ-2 cần cầu phân áp). LED/7 đoạn/RGB sáng theo chênh lệch điện áp (PWM điều chỉnh độ sáng).</li>
  <li>Linh kiện I2C (LCD, OLED) phải nối vào chân SDA/SCL mặc định của board — ESP32 DevKit: GPIO21/22, XIAO ESP32-C3: D4/D5 (GPIO6/7), XIAO ESP32-S3: D4/D5 (GPIO5/6), C3 SuperMini: GPIO8/9 — hoặc chân trong <code>Wire.begin(sda, scl)</code>, và cấp nguồn VCC/GND.</li>
  <li>Đổi board bằng ô chọn board trên thanh công cụ: sơ đồ và code được chuyển sang board mới — I2C sang chân SDA/SCL của board, đầu vào analog sang chân ADC1, các chân khác giữ nguyên số GPIO nếu board có (hoặc vị trí D0…D10 giữa hai board XIAO), số chân trong code được sửa theo; board không có LED trên board / nút BOOT thì thêm LED / nút nhấn ngoài. Các thay đổi được ghi trong Serial Monitor. Ví dụ mẫu luôn được mở theo board đang chọn. Chọn board trên sơ đồ để xem <code>LED_BUILTIN</code> và chân I2C của nó.</li>
</ul>
<h3>Linh kiện</h3>
<table>
<tr><td>Vi điều khiển</td><td>ESP32 DevKit V1; Seeed XIAO ESP32-C3 (không có LED_BUILTIN); Seeed XIAO ESP32-S3 (LED_BUILTIN = GPIO21, sáng khi LOW); ESP32-C3 SuperMini (LED_BUILTIN = GPIO8, sáng khi LOW). Trên các board C3, nhấn giữ chuột lên board khi đang chạy = nhấn nút BOOT (GPIO9). Hằng số chân (<code>A0</code>, <code>D0</code>…, <code>SDA</code>, <code>LED_BUILTIN</code>) theo <code>pins_arduino.h</code> của từng board.</td></tr>
<tr><td>Cơ bản</td><td>LED (nhiều màu), LED RGB, điện trở, nút nhấn, công tắc gạt, biến trở, còi buzzer</td></tr>
<tr><td>Cảm biến</td><td>DHT22/DHT11, HC-SR04, PIR; module AO/DO: ánh sáng LDR, lửa, khí gas MQ-2, mưa, độ ẩm đất (DO tích cực mức thấp trừ LDR: HIGH khi tối); cảm biến mực nước (chân S)</td></tr>
<tr><td>Hiển thị</td><td>LED 7 đoạn (anode/cathode chung), LCD 16x2 / 20x4 I2C, OLED SSD1306 128x64 I2C, NeoPixel WS2812</td></tr>
<tr><td>Chấp hành</td><td>Servo, module relay 1 kênh (kích HIGH/LOW, COM–NO đóng khi có điện), bóng đèn</td></tr>
<tr><td>Truyền thông</td><td>LoRa SX1278 Ra-02 (SPI: SCK/MISO/MOSI theo board, NSS/RST/DIO0 theo <code>LoRa.setPins</code>); nút "Nhận gói tin thử" giả lập gói từ node khác</td></tr>
</table>
<h3>Thư viện & API được hỗ trợ</h3>
<table>
<tr><td>Arduino core</td><td>pinMode, digitalWrite/Read, analogRead (12 bit), analogWrite, ledcAttach/ledcWrite (v3) & ledcSetup/ledcAttachPin (v2), tone/noTone, pulseIn, millis/micros/delay, attachInterrupt, map/constrain/random, toán học, String, sprintf/snprintf, dtostrf, strcpy/strcmp…</td></tr>
<tr><td>Serial</td><td>begin, print/println (DEC/HEX/BIN, số chữ số thập phân), printf, write, available, read, readString, readStringUntil, parseInt, parseFloat</td></tr>
<tr><td>WiFi.h</td><td>WiFi.begin (mọi SSID đều kết nối vào AP ảo), status, localIP, RSSI, macAddress, scanNetworks, disconnect</td></tr>
<tr><td>HTTPClient.h</td><td>begin, addHeader, GET, POST, PUT, PATCH, sendRequest, getString, errorToString, setAuthorization, end</td></tr>
<tr><td>PubSubClient.h</td><td>setServer, setCallback, connect (id, user, pass, will), publish, subscribe, unsubscribe, loop, connected, state</td></tr>
<tr><td>ArduinoJson.h</td><td>JsonDocument / StaticJsonDocument / DynamicJsonDocument, doc["key"], as&lt;T&gt;(), is&lt;T&gt;(), | mặc định, createNestedObject/Array, add, serializeJson(Pretty), deserializeJson, duyệt range-for</td></tr>
<tr><td>Hiển thị</td><td>LiquidCrystal_I2C, Adafruit_SSD1306 + Adafruit_GFX (vẽ điểm/đường/hình/chữ/bitmap), Adafruit_NeoPixel</td></tr>
<tr><td>Truyền thông</td><td>LoRa.h (begin, beginPacket/print/endPacket, parsePacket/read, packetRssi/Snr, onReceive/receive, setSyncWord, setSpreadingFactor…), esp_now.h (init, add_peer, send, register_send/recv_cb — chữ ký 2.x và 3.x), WiFiUdp.h, coap-simple.h (server, response, get/put/post, sendResponse, loop)</td></tr>
<tr><td>Cảm biến/khác</td><td>DHT.h, DHTesp.h, ESP32Servo.h, Wire.h (máy quét I2C), Preferences.h (lưu NVS vào trình duyệt), time.h (configTime, getLocalTime, strftime), FreeRTOS (xTaskCreate, vTaskDelay, vTaskDelete), ESP.restart/getFreeHeap</td></tr>
</table>
<h3>Ghi chú về mạng</h3>
<ul>
  <li>Trình duyệt không mở được socket TCP, vì vậy MQTT được nối qua <b>WebSocket</b>: <code>client.setServer("broker.hivemq.com", 1883)</code> tự động dùng <code>wss://broker.hivemq.com:8884/mqtt</code>. Xem/sửa bảng ánh xạ trong ⚙ Cài đặt.</li>
  <li>Dùng tab <b>MQTT Client</b> để subscribe/publish cùng broker và tương tác với ESP32 ảo.</li>
  <li>HTTP được thực hiện bằng <code>fetch</code>. Khi chạy bằng <code>node server.js</code>, yêu cầu được chuyển qua proxy cục bộ nên không bị lỗi CORS và gọi được cả <code>http://</code>.</li>
  <li>Tab <b>Nhật ký mạng</b> ghi lại mọi sự kiện WiFi / HTTP / MQTT / LoRa / ESP-NOW / CoAP của thiết bị.</li>
  <li><b>Nhiều board</b>: mở trình giả lập ở nhiều tab (cùng địa chỉ) — mỗi tab là một board, các tab nghe thấy nhau qua LoRa, ESP-NOW và UDP/CoAP/HTTP trong mạng WiFi ảo 10.13.37.x (IP động .100–.249, đặt IP tĩnh bằng <code>WiFi.config</code>). Ví dụ: chạy "LoRa: node gửi" ở tab này và "LoRa: node nhận" ở tab khác.</li>
  <li><b>Web server trên board</b> (<code>WebServer.h</code>): khi board chạy, tab Nhật ký mạng hiện link <code>…/__dev/10.13.37.x/</code> — mở trong tab mới để dùng trang web của board (form, nút bấm, <code>fetch</code>); board khác truy cập bằng <code>HTTPClient</code>.</li>
  <li>UDP/CoAP ra Internet (vd. <code>coap.me</code>) và <code>WiFi.hostByName</code> cần chạy bằng <code>node server.js</code>.</li>
</ul>
<h3>Giới hạn</h3>
<ul>
  <li>Code được biên dịch sang JavaScript (không giả lập tập lệnh Xtensa), nên thời gian thực thi không chính xác theo chu kỳ máy; <code>delay()</code>, <code>millis()</code> theo thời gian thực.</li>
  <li>Chưa hỗ trợ: lớp tự định nghĩa có phương thức, template, cấp phát động (new/delete), con trỏ số học phức tạp, goto.</li>
</ul>
<h3>Phím tắt</h3>
<table>
<tr><td>Ctrl+Enter</td><td>Biên dịch và chạy</td></tr>
<tr><td>Ctrl+S</td><td>Lưu vào trình duyệt</td></tr>
<tr><td>Ctrl+B</td><td>Ẩn / hiện khung code (nút <code>&lt;/&gt;</code> trên thanh mô phỏng, nút « trong khung code)</td></tr>
<tr><td>Ctrl+J</td><td>Thu gọn / mở panel dưới — Serial Monitor, MQTT Client, Nhật ký mạng (nút ▾ hoặc nháy đúp thanh tab; bấm một tab để mở lại)</td></tr>
<tr><td>R / Delete</td><td>Xoay / xóa linh kiện hoặc dây đang chọn</td></tr>
<tr><td>Lăn chuột</td><td>Phóng to/thu nhỏ; kéo nền để di chuyển</td></tr>
</table>
`;
