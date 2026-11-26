"""Dịch vụ nền cho web phim:
  - Mỗi TOP_INTERVAL_HOURS giờ (mặc định 6): cập nhật Top 10 -> DATA_DIR/top.json        (cần TMDB_API_KEY)
  - Mỗi CATALOG_INTERVAL_HOURS giờ (mặc định 24): quét KKPhim -> DATA_DIR/catalog.json
  - HTTP API (cổng PORT, mặc định 8000):
        GET /api/list?type=&category=&country=&sort=year|rating|popular&page=N
        GET /api/health
    Nếu đặt STATIC_DIR (vd khi chạy local), server phục vụ luôn file tĩnh của web và DATA_DIR ở /data/.
"""
import json
import os
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import update_top
from catalog import SORTS, Catalog
from update_top import log

DATA_DIR = os.environ.get("DATA_DIR", "/data")
PORT = int(os.environ.get("PORT", "8000"))
STATIC_DIR = os.environ.get("STATIC_DIR", "")
TOP_EVERY = float(os.environ.get("TOP_INTERVAL_HOURS", os.environ.get("INTERVAL_HOURS", "6")))
CATALOG_EVERY = float(os.environ.get("CATALOG_INTERVAL_HOURS", "24"))

os.makedirs(DATA_DIR, exist_ok=True)
update_top.OUT = os.path.join(DATA_DIR, "top.json")
catalog = Catalog(os.path.join(DATA_DIR, "catalog.json"))


def every(hours, job, name, first_delay=0.0):
    def loop():
        time.sleep(first_delay)
        while True:
            try:
                job()
            except SystemExit:
                log(f"{name}: dừng (cấu hình sai)")
                return
            except Exception as e:
                log(f"{name}: lỗi {e}, thử lại sau 30 phút")
                time.sleep(1800)
                continue
            time.sleep(hours * 3600)
    threading.Thread(target=loop, daemon=True, name=name).start()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC_DIR or None, **kw)

    def log_message(self, fmt, *args):  # bớt log mỗi request
        pass

    def _json(self, code, obj, cache=60):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", f"public, max-age={cache}" if code == 200 else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if u.path == "/api/health":
            return self._json(200, {"ok": True, "catalog": len(catalog.items), "updated": catalog.updated}, cache=0)
        if u.path == "/api/list":
            if not catalog.items:
                return self._json(503, {"status": False, "msg": "Đang xây dựng dữ liệu sắp xếp, vui lòng thử lại sau vài phút"})
            sort = q.get("sort") if q.get("sort") in SORTS else "rating"
            try:
                page = int(q.get("page", 1))
            except ValueError:
                page = 1
            return self._json(200, catalog.query(q.get("type", ""), q.get("category", ""), q.get("country", ""), sort, page))
        if u.path.startswith("/api/"):
            return self._json(404, {"status": False, "msg": "Không có API này"})
        if not STATIC_DIR:
            return self._json(404, {"status": False})
        if u.path.startswith("/data/"):  # local: phục vụ top.json từ DATA_DIR
            name = os.path.basename(u.path)
            fp = os.path.join(DATA_DIR, name)
            if name == "top.json" and os.path.isfile(fp):
                with open(fp, "rb") as f:
                    return self._json(200, json.load(f), cache=0)
            return self._json(404, {"status": False})
        return super().do_GET()


def main():
    if update_top.KEY:
        every(TOP_EVERY, update_top.run_once, "top10")
    else:
        log("Không có TMDB_API_KEY -> bỏ qua cập nhật Top 10")
    # Chỉ quét lại ngay nếu chỉ mục cũ hơn chu kỳ, tránh quét lại mỗi lần khởi động lại container
    delay = max(0.0, (CATALOG_EVERY - catalog.age_hours()) * 3600)
    if delay:
        log(f"catalog: chỉ mục còn mới, lần quét tới sau {delay / 3600:.1f} giờ")
    every(CATALOG_EVERY, catalog.crawl, "catalog", first_delay=delay)
    log(f"API chạy ở cổng {PORT}" + (f", phục vụ web từ {STATIC_DIR}" if STATIC_DIR else ""))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
