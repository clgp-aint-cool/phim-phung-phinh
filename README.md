# Phim Phúng Phính

Trang xem phim đơn giản, không cần đăng nhập. Danh sách phim và link phát lấy từ API mở của
[KKPhim](https://phimapi.com); Top 10 lấy từ [TMDB](https://www.themoviedb.org).

> **Lưu ý:** dự án không lưu trữ phim nào. Toàn bộ video được phát trực tiếp từ máy chủ của KKPhim,
> và bản quyền nội dung thuộc về các bên liên quan. Dự án chỉ dùng cho mục đích học tập hoặc cá nhân.

## Tính năng

- Danh sách phim mới cập nhật, Phim lẻ, Phim bộ, TV Shows và Anime.
- Lọc kết hợp theo loại, thể loại và quốc gia, có nút bỏ lọc nhanh.
- Sắp xếp theo năm, điểm đánh giá và độ phổ biến (dùng dữ liệu TMDB/IMDb), có nhảy tới trang bất kỳ.
- Mục Top 10 cho Phim lẻ, Phim bộ và Anime, tự cập nhật mỗi 6 giờ.
- Trình phát HLS (hls.js). Safari dùng trình phát gốc của Apple để tránh tiếng rè ở đoạn quảng cáo.
- Chế độ rạp: làm tối cả trang, chỉ chừa khung phim.
- Chiếu lên tivi bằng **Chromecast** (Chrome, Edge) hoặc **AirPlay** (Safari). Tivi tải thẳng bản gốc nên hình nét.
- Tự phát tập tiếp theo (cả khi cast) và nhớ vị trí đang xem.
- Mục **Đang xem** trên trang chủ. Lịch sử lưu trong trình duyệt nên mỗi máy có danh sách riêng.

## Cấu trúc thư mục

```
web/                    Giao diện (HTML/CSS/JS thuần, không cần build)
  index.html
  app.js                Toàn bộ logic: định tuyến, danh sách, trình phát, Cast, AirPlay, Đang xem
  style.css
updater/                Dịch vụ nền bằng Python (chỉ dùng thư viện chuẩn)
  server.py             HTTP API /api/list + /api/health, chạy các tác vụ định kỳ
  update_top.py         Lấy Top 10 từ TMDB rồi tìm phim tương ứng trên KKPhim -> top.json
  catalog.py            Quét toàn bộ KKPhim (~30.000 phim, ~7 phút) -> catalog.json để sắp xếp
nginx.conf              Phục vụ web, chuyển /api/ sang updater
Dockerfile              Image web (nginx-unprivileged)
docker-compose.yml      Bản chạy trên server: web + updater + Caddy (HTTPS tự động)
docker-compose.local.yml  Bản chạy trên máy cá nhân: web + updater, mở cổng 8080
Caddyfile               Tên miền và HTTPS cho bản server
.env.example            Mẫu biến môi trường (copy thành .env)
k8s/                    Bản Kubernetes cũ (chỉ có web, chưa có updater/API), không còn dùng
```

Luồng hoạt động:

```
Trình duyệt ──► nginx (web) ──► file tĩnh trong web/
     │               └── /api/*, /data/top.json ──► updater (Python, cổng 8000)
     ├──► phimapi.com      (danh sách, chi tiết phim)
     └──► máy chủ video    (m3u8/ts phát trực tiếp)
```

## Chạy trên máy cá nhân

### 1. Chuẩn bị

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac, Windows) hoặc Docker Engine kèm Compose (Linux).
- Khoá API TMDB (miễn phí, **không bắt buộc**, chỉ cần cho mục Top 10): đăng ký ở themoviedb.org, vào
  **Settings → API**. Dùng được "API Key" (v3) hoặc "API Read Access Token" (v4, chuỗi bắt đầu bằng `eyJ`).

### 2. Tải mã nguồn và cấu hình

```bash
git clone <địa chỉ repo này>
cd <thư mục repo>
cp .env.example .env
```

Mở file `.env` và điền `TMDB_API_KEY=...`. Có thể để trống nếu không cần Top 10.

> Không bao giờ commit file `.env`. File này đã có trong `.gitignore`.

### 3. Chạy

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Mở **http://localhost:8080**.

- **Lần chạy đầu tiên**, updater mất khoảng **7 phút** để quét KKPhim. Trong lúc đó, chọn kiểu sắp xếp
  theo đánh giá hoặc độ phổ biến sẽ hiện "Đang xây dựng dữ liệu sắp xếp". Các trang khác dùng được ngay.
- Dữ liệu lưu ở `web/data/` nên các lần khởi động sau không phải quét lại (tự quét lại mỗi 24 giờ).
- Cổng 8080 bị chiếm thì sửa `"8080:8080"` thành ví dụ `"8090:8080"` trong `docker-compose.local.yml`.

Các lệnh hay dùng:

```bash
docker compose -f docker-compose.local.yml logs -f updater   # xem tiến độ quét / cập nhật Top 10
docker compose -f docker-compose.local.yml up -d --build      # áp dụng thay đổi code
docker compose -f docker-compose.local.yml down               # dừng
```

Sửa file trong `web/` chỉ cần build lại và tải lại trang bằng **Cmd/Ctrl + Shift + R**. Nếu trình duyệt
vẫn giữ bản cũ, tăng số `?v=` của `app.js` và `style.css` trong `web/index.html`. Thư mục `updater/` được
gắn thẳng vào container, nên sau khi sửa chỉ cần chạy `docker compose -f docker-compose.local.yml restart updater`.

### Chạy không cần Docker

Cần Python 3.10 trở lên; không phải cài thêm thư viện nào.

```bash
STATIC_DIR=web DATA_DIR=web/data TMDB_API_KEY=<khoá của bạn> python3 updater/server.py
```

Mở **http://localhost:8000**. Server Python phục vụ cả giao diện lẫn API.

## Triển khai lên server (HTTPS với tên miền riêng)

Đã chạy thử trên máy ảo Ubuntu (CMC Cloud). Các bước:

1. **Cài Docker** trên server:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. **Trỏ tên miền:** tạo bản ghi `A @` và `A www` trỏ về IP công khai của server. Mở cổng **80** và **443**
   (TCP, thêm UDP 443 cho HTTP/3) trong firewall hoặc security group.
3. **Sửa `Caddyfile`:** thay `motdongphim.xyz` bằng tên miền của bạn. Nên bỏ dấu `#` ở dòng `email` và điền email
   để nhận thông báo về chứng chỉ.
4. **Đưa code lên server** bằng `git clone` hoặc `rsync` (đừng gửi `web/data/`):
   ```bash
   rsync -av --exclude .git --exclude web/data --exclude .env ./ <user>@<ip-server>:~/phim/
   ```
5. **Tạo `.env` trên server** (copy từ `.env.example` và điền khoá TMDB), rồi chạy:
   ```bash
   cd ~/phim && docker compose up -d --build
   ```
   Caddy tự xin chứng chỉ Let's Encrypt. Kiểm tra bằng `docker compose logs -f caddy`.

**Cập nhật phiên bản mới:** đưa code mới lên (bước 4) rồi chạy:

```bash
docker compose up -d --build && docker compose restart updater
```

Không xoá volume `caddy_data`, vì nó chứa chứng chỉ HTTPS.

## Biến môi trường (`.env`)

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `TMDB_API_KEY` | (trống) | Khoá TMDB v3 hoặc token v4. Trống thì bỏ qua Top 10 |
| `TOP_INTERVAL_HOURS` | `6` | Chu kỳ cập nhật Top 10 (giờ) |
| `CATALOG_INTERVAL_HOURS` | `24` | Chu kỳ quét lại KKPhim để sắp xếp (giờ) |

## API nội bộ (updater)

| Đường dẫn | Mô tả |
|-----------|-------|
| `GET /api/list?type=&category=&country=&sort=year\|rating\|popular&page=N` | Danh sách đã sắp xếp, định dạng giống KKPhim |
| `GET /api/health` | Trạng thái và số phim trong chỉ mục |
| `GET /data/top.json` | Top 10 hiện tại |

## Xem trên tivi

- **Chromecast / Google TV / Android TV:** mở web bằng Chrome hoặc Edge, cùng Wi-Fi với tivi, rồi bấm biểu tượng
  Cast cạnh nút "Chế độ rạp". Chrome chỉ cho Cast trên trang **HTTPS** hoặc **localhost**. Nếu mở web bằng
  `http://192.168.x.x` thì nút Cast sẽ không hiện.
- **AirPlay:** mở bằng Safari trên Mac, iPhone hoặc iPad, rồi bấm nút "📺 AirPlay". Nút chỉ hiện khi tìm thấy tivi.
- Không dùng "Truyền thẻ" hoặc phản chiếu màn hình, vì hình sẽ bị nén và mờ.
- Phim khổ rộng (2.4:1) luôn có viền đen trên và dưới trên tivi 16:9. Đây là khổ gốc của phim, không phải lỗi.

## Sự cố thường gặp

**Không tìm thấy tivi khi Cast**
- macOS: vào **Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Mạng cục bộ** và bật Google Chrome.
- Tắt VPN; kiểm tra máy và tivi cùng một mạng Wi-Fi (không dùng mạng khách).
- Rút điện tivi khoảng 1 phút; khởi động lại router; tắt "AP Isolation" trên router.

**Máy ảo không ra được Internet (ping 1.1.1.1 thất bại)**
Thường do mạng con không có default route, hoặc DHCP đẩy sai route. Thêm file netplan, ví dụ
`/etc/netplan/99-gateway.yaml` (thay `eth0` và IP gateway cho đúng mạng của bạn):

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4-overrides: { use-routes: false, use-dns: false }
      routes: [{ to: default, via: 192.168.4.1 }]
      nameservers: { addresses: [1.1.1.1, 1.0.0.1] }
```

Sau đó chạy `sudo netplan apply`.

**Caddy báo lỗi chứng chỉ cho `www`:** thiếu bản ghi DNS `A www`. Thêm bản ghi, hoặc xoá khối `www.` trong `Caddyfile`.

**Sắp xếp báo "Đang xây dựng dữ liệu":** chờ updater quét xong, khoảng 7 phút ở lần đầu (xem `logs -f updater`).
