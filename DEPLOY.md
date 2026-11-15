# Triển khai lên VPS bằng Docker — `iot.dcelab.io.vn`

Mô hình: **máy dev build image → push lên Docker Hub → VPS pull về chạy**.
Trên VPS: **Internet → nginx (80/443, HTTPS của Let's Encrypt) → container `esp32sim` (127.0.0.1:8020 trên VPS → cổng 8080 trong container)**.
Container chỉ nghe trên localhost của VPS, nên bên ngoài chỉ vào được qua nginx. VPS **không cần mã nguồn**,
chỉ cần 3 file: `docker-compose.yml`, `.env` và file cấu hình nginx.

Các file liên quan:

| File | Vai trò |
|---|---|
| `Dockerfile` | Image `node:20-alpine`, chạy `node server.js` với `HOST=0.0.0.0`, user không phải root, có healthcheck |
| `deploy/push.ps1` | (Máy dev) build image và push lên Docker Hub, gắn tag `latest` + mã commit git |
| `docker-compose.yml` | (VPS) kéo image `<DOCKERHUB_USER>/esp32-iot-simulator:<TAG>`, map `127.0.0.1:8020` → `8080` trong container, tự khởi động lại, giới hạn log |
| `.env.example` | (VPS) mẫu file `.env`: tên tài khoản Docker Hub và tag cần chạy, giới hạn link chia sẻ |
| `deploy/nginx-iot.dcelab.io.vn.conf` | Reverse proxy + giới hạn tần suất cho `/__proxy` và `/__share` |
| `share-store.js`, `tools/share-admin.mjs` | Lưu link chia sẻ ngắn; công cụ quản trị (xem phần Link chia sẻ) |

> **Bảo mật:** khi public, `/__proxy` (proxy HTTP cho `HTTPClient` mô phỏng) có thể bị dùng để gọi vào mạng nội bộ của VPS.
> Container đặt `PROXY_BLOCK_PRIVATE=1` nên proxy từ chối localhost, IP private (10.x, 172.16–31.x, 192.168.x),
> link-local/metadata (169.254.x) và IPv6 nội bộ, kiểm tra lại ở mọi bước redirect. Hệ quả: sketch chạy trên bản
> online **không gọi được** server HTTP trong LAN/localhost — muốn vậy thì chạy `npm start` trên máy mình.
> Bộ chuyển tiếp UDP (`/__proxy/udp`, dùng cho CoAP) chỉ cho gửi tới các cổng trong `UDP_PORTS` (mặc định `5683`)
> và cũng áp dụng chặn địa chỉ nội bộ như trên.
> Cầu nối MQTT (`/__proxy/mqtt`, WebSocket → TCP, cho broker không có cổng WebSocket như `thingsboard.cloud`) chỉ cho
> kết nối tới các cổng trong `MQTT_PORTS` (mặc định `1883`), cũng chặn địa chỉ nội bộ; nginx cần khối
> `location = /__proxy/mqtt` có header `Upgrade` (xem `deploy/nginx-iot.dcelab.io.vn.conf`) — nhớ cập nhật file trên VPS.

## Link chia sẻ

Nút **🔗 Chia sẻ** gửi dự án (đã nén) lên server, server lưu thành file và trả về mã ngắn: link có dạng
`https://iot.dcelab.io.vn/#s=k3F9xQ2aBc`. File nằm trong volume Docker `esp32sim-data` (`/app/data/share` trong
container), nên vẫn còn sau khi cập nhật image; `docker compose down -v` sẽ **xoá hết** link. Nếu server từ chối
(quá giới hạn) hoặc không có `server.js`, trang tự dùng link dài kiểu cũ `#p=…` (chứa cả dự án; link cũ vẫn mở được).

Các lớp kiểm soát (chỉnh trong `.env`, rồi `docker compose up -d`):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SHARE_MAX_KB` | `64` | Kích thước tối đa một dự án sau khi nén (dự án thường 1–3 KB). Server còn giải nén kiểm tra đúng là dự án (có `code`, `diagram`) |
| `SHARE_RATE` | `30` | Số link **mới** tối đa mỗi giờ cho một IP (`0` = không giới hạn). Cả lớp dùng chung Wi-Fi có thể chung một IP — đừng đặt quá thấp |
| `SHARE_QUOTA_MB` | `1024` | Tổng dung lượng (tính theo khối 4 KB trên đĩa); `0` = không giới hạn |
| `SHARE_EVICT` | `1` | Khi vượt hạn mức: `1` xoá các link lâu không được mở nhất (xuống còn 90%), `0` từ chối tạo link mới |
| `SHARE_TTL_DAYS` | `365` | Mỗi ngày xoá các link không ai mở trong N ngày (`0` = không bao giờ xoá). Mở link là làm mới hạn |

Ngoài ra: cùng một dự án luôn cho cùng một link (mã là hash nội dung, không tạo file trùng); nginx giới hạn
`POST /__share` 10 request/phút/IP; không có API liệt kê hay xoá link. Mỗi link mới được ghi log
(`[share] + <mã> <kích thước> from <IP>`), dòng khởi động in số link và dung lượng.

Quản trị trên VPS:

```bash
docker exec esp32sim node tools/share-admin.mjs stats          # số link, dung lượng, số link mở gần đây
docker exec esp32sim node tools/share-admin.mjs show <mã|link> # thông tin một link
docker exec esp32sim node tools/share-admin.mjs rm <mã|link>   # xoá link vi phạm
docker exec esp32sim node tools/share-admin.mjs prune 180      # xoá link quá 180 ngày không mở
docker compose logs esp32sim | grep '\[share\]'                # lịch sử tạo link
```

---

## 1. Trỏ DNS

Tại nơi quản lý DNS của `dcelab.io.vn`, tạo bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| `A` | `iot` | IPv4 của VPS |
| `AAAA` (tuỳ chọn) | `iot` | IPv6 của VPS |

Kiểm tra (đợi vài phút): `nslookup iot.dcelab.io.vn` phải trả về IP của VPS.

## 2. Chuẩn bị VPS (Ubuntu/Debian)

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # đăng xuất/đăng nhập lại để có hiệu lực

# nginx + certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Mở firewall (nếu dùng ufw)
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
```

Nếu VPS đã có nginx phục vụ các site khác thì bỏ qua bước cài, chỉ cần thêm site ở bước 4.

## 3. Build và push image lên Docker Hub (máy Windows)

1. Tạo tài khoản tại https://hub.docker.com (nếu chưa có). Repo `esp32-iot-simulator` sẽ tự được tạo
   ở lần push đầu tiên, ở chế độ **public**. Muốn private thì tạo repo trước trên web và chọn Private
   (gói miễn phí có 1 repo private).
2. Đăng nhập rồi chạy script (PowerShell, trong thư mục dự án; thay `lebavui` bằng username Docker Hub của bạn):

```powershell
docker login
.\deploy\push.ps1 -User lebavui
```

Script build cho `linux/amd64` (đa số VPS). VPS dùng chip ARM (ví dụ Oracle Ampere) thì thêm
`-Platform linux/arm64`. Nếu PowerShell chặn chạy script thì dùng
`powershell -ExecutionPolicy Bypass -File .\deploy\push.ps1 -User lebavui`.

Mỗi lần push có 2 tag: `latest` và mã commit git (ví dụ `d70604c`). Tag theo commit dùng để quay lại bản cũ.

## 3b. Chạy container trên VPS

Chép 3 file từ máy Windows lên VPS (PowerShell, trong thư mục dự án):

```powershell
ssh user@IP-VPS "sudo mkdir -p /opt/esp32sim && sudo chown `$USER: /opt/esp32sim"
scp docker-compose.yml .env.example deploy/nginx-iot.dcelab.io.vn.conf user@IP-VPS:/opt/esp32sim/
```

Trên VPS:

```bash
cd /opt/esp32sim
cp .env.example .env
nano .env                     # sửa DOCKERHUB_USER=<username Docker Hub>
# docker login               # chỉ cần nếu repo trên Docker Hub là private
docker compose pull
docker compose up -d
```

Kiểm tra:

```bash
docker compose ps                         # STATUS phải là "healthy" sau ~30 giây
curl http://127.0.0.1:8020/__proxy/ping   # → esp32sim-proxy
docker compose logs -f                    # xem log (Ctrl+C để thoát)
```

## 4. Cấu hình nginx

```bash
sudo cp /opt/esp32sim/nginx-iot.dcelab.io.vn.conf /etc/nginx/sites-available/iot.dcelab.io.vn
sudo ln -s /etc/nginx/sites-available/iot.dcelab.io.vn /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Mở thử `http://iot.dcelab.io.vn` — phải thấy giao diện simulator.

## 5. Bật HTTPS

```bash
sudo certbot --nginx -d iot.dcelab.io.vn --redirect -m <email-của-bạn> --agree-tos
```

Certbot tự thêm khối `listen 443 ssl` và chuyển hướng HTTP → HTTPS vào file site, đồng thời cài
timer tự gia hạn. Kiểm tra gia hạn: `sudo certbot renew --dry-run`.

Vào `https://iot.dcelab.io.vn`, mở ⚙ Cài đặt: dòng trạng thái phải là **“✓ Đã phát hiện proxy của server.js”**.

> **HTTPS và MQTT:** trang chạy trên HTTPS nên trình duyệt chỉ cho kết nối WebSocket **`wss://`**.
> Các broker mặc định (HiveMQ, Mosquitto, EMQX…) đã được ánh xạ sang `wss://`. Nếu bạn tự thêm broker trong
> bảng ánh xạ thì phải dùng `wss://`, không dùng `ws://`.

## 6. Cập nhật phiên bản mới

Trên máy Windows (sau khi commit thay đổi):

```powershell
.\deploy\push.ps1 -User lebavui
```

Trên VPS:

```bash
cd /opt/esp32sim
docker compose pull && docker compose up -d
docker image prune -f         # xoá image cũ
```

**Quay lại bản cũ:** sửa `TAG=<mã commit>` trong `.env` (xem danh sách tag trên Docker Hub), rồi
`docker compose pull && docker compose up -d`. Đặt lại `TAG=latest` để trở về bản mới nhất.

Trình duyệt không bị cache bản cũ vì `server.js` trả `Cache-Control: no-cache`.

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| `docker compose pull` báo `pull access denied` | Sai `DOCKERHUB_USER` trong `.env`, hoặc repo private mà VPS chưa `docker login` |
| Container lỗi `exec format error` | Image sai kiến trúc CPU — push lại với `-Platform linux/arm64` (hoặc `linux/amd64,linux/arm64`) |
| `502 Bad Gateway` | Container có chạy không: `docker compose ps`, `docker compose logs` |
| Certbot báo lỗi xác thực | DNS đã trỏ đúng chưa; cổng 80 có mở trên firewall và firewall của nhà cung cấp VPS không |
| Cổng 8020 đã bị dùng | Đổi cổng bên trái trong `docker-compose.yml` (ví dụ `"127.0.0.1:8030:8080"`) và sửa cả 2 dòng `proxy_pass` trong file nginx thành `127.0.0.1:8030` |
| HTTPClient báo `Địa chỉ nội bộ bị chặn` | Đúng thiết kế (xem phần Bảo mật ở trên) |
| HTTPClient báo lỗi `503` | Bị giới hạn tần suất của nginx (5 req/s, burst 20 cho mỗi IP) — tăng `rate`/`burst` trong file nginx nếu cần |
| Chia sẻ báo "Không tạo được link ngắn (…)" | Xem lý do trong thông báo / `docker compose logs`: quá `SHARE_RATE`, quá `SHARE_MAX_KB`, kho đầy (`SHARE_EVICT=0`), hoặc `503` do nginx (khối `location = /__share`) |
| Log báo `[share] không dùng được /app/data/share: EACCES` | Volume tạo trước khi image có thư mục `data`: `docker run --rm -v esp32sim_esp32sim-data:/d alpine chown -R 1000:1000 /d` |
