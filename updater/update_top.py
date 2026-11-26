"""Cập nhật Top 10 (Phim lẻ, Phim bộ, Anime) cho trang chủ.

Cách làm: lấy danh sách phim thịnh hành / phổ biến từ TMDB, rồi tra từng phim trên KKPhim
qua TMDB ID (https://phimapi.com/tmdb/<movie|tv>/<id>). Chỉ giữ phim có trên KKPhim, đủ 10 phim
mỗi mục thì dừng. Kết quả ghi ra OUT_FILE (mặc định /data/top.json), nginx phục vụ ở /data/top.json.

Biến môi trường:
  TMDB_API_KEY   API key (v3) hoặc Read Access Token (v4, bắt đầu bằng "eyJ") của TMDB  [bắt buộc]
  INTERVAL_HOURS Chu kỳ cập nhật, mặc định 6 giờ. Đặt 0 để chạy 1 lần rồi thoát.
  OUT_FILE       Đường dẫn file kết quả, mặc định /data/top.json
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TMDB = "https://api.themoviedb.org/3"
KK = "https://phimapi.com"
KEY = os.environ.get("TMDB_API_KEY", "").strip()
OUT = os.environ.get("OUT_FILE", "/data/top.json")
INTERVAL = float(os.environ.get("INTERVAL_HOURS", "6"))
TOP_N = 10
MAX_PAGES = 5  # mỗi trang TMDB 20 phim -> tối đa 100 ứng viên mỗi mục
UA = {"User-Agent": "phim-top-updater/1.0", "Accept": "application/json"}


def log(*a):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def get_json(url, headers=None, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (401, 403):
                raise
            err = e
        except Exception as e:  # mạng chập chờn -> thử lại
            err = e
        time.sleep(2 * (i + 1))
    raise err


def tmdb(path, **params):
    headers = {}
    if KEY.startswith("eyJ"):  # v4 Read Access Token
        headers["Authorization"] = f"Bearer {KEY}"
    else:
        params["api_key"] = KEY
    return get_json(f"{TMDB}{path}?{urllib.parse.urlencode(params)}", headers)


def candidates(sources):
    """Gộp các nguồn TMDB, giữ thứ tự xuất hiện, bỏ trùng."""
    seen = set()
    for media, path, params in sources:
        for page in range(1, MAX_PAGES + 1):
            data = tmdb(path, page=page, **params) or {}
            for r in data.get("results", []):
                key = (media, r["id"])
                if key not in seen:
                    seen.add(key)
                    yield media, r


def kk_lookup(media, tmdb_id):
    d = get_json(f"{KK}/tmdb/{media}/{tmdb_id}")
    time.sleep(0.2)  # lịch sự với API KKPhim
    if not d or not d.get("status") or not d.get("movie"):
        return None
    return d["movie"]


def build(sources, accept):
    out = []
    for media, r in candidates(sources):
        m = kk_lookup(media, r["id"])
        if not m or not accept(m, r):
            continue
        if any(x["slug"] == m["slug"] for x in out):
            continue
        out.append({
            "rank": len(out) + 1,
            "slug": m["slug"],
            "name": m.get("name"),
            "origin_name": m.get("origin_name"),
            "poster_url": m.get("poster_url"),
            "thumb_url": m.get("thumb_url"),
            "year": m.get("year"),
            "episode_current": m.get("episode_current"),
            "tmdb_id": r["id"],
        })
        if len(out) >= TOP_N:
            break
    return out


def is_jp_animation(r):
    return 16 in r.get("genre_ids", []) and (
        "JP" in r.get("origin_country", []) or r.get("original_language") == "ja")


LISTS = {
    # Phim lẻ: phim điện ảnh thịnh hành tuần này
    "phim-le": (
        [("movie", "/trending/movie/week", {})],
        lambda m, r: m.get("type") == "single",
    ),
    # Phim bộ: series thịnh hành tuần này (không tính hoạt hình, anime có mục riêng)
    "phim-bo": (
        [("tv", "/trending/tv/week", {})],
        lambda m, r: m.get("type") == "series",
    ),
    # Anime: hoạt hình Nhật đang thịnh hành, bổ sung bằng anime phổ biến nhất
    "anime": (
        [
            ("tv", "/trending/tv/week", {}),
            ("tv", "/discover/tv", {"with_genres": 16, "with_origin_country": "JP", "sort_by": "popularity.desc"}),
            ("movie", "/discover/movie", {"with_genres": 16, "with_origin_country": "JP", "sort_by": "popularity.desc"}),
        ],
        lambda m, r: is_jp_animation(r),
    ),
}


def load_old():
    try:
        with open(OUT) as f:
            return json.load(f).get("lists", {})
    except Exception:
        return {}


def run_once():
    old = load_old()
    lists = {}
    for name, (sources, accept) in LISTS.items():
        try:
            lists[name] = build(sources, accept)
            log(f"{name}: {len(lists[name])} phim")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                log("TMDB_API_KEY sai hoặc hết hạn (HTTP", e.code, ")")
                raise SystemExit(1)
            log(f"{name}: lỗi {e}, giữ dữ liệu cũ")
            lists[name] = old.get(name, [])
        except Exception as e:
            log(f"{name}: lỗi {e}, giữ dữ liệu cũ")
            lists[name] = old.get(name, [])
    data = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "TMDB trending", "lists": lists}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT)  # ghi nguyên tử: nginx không bao giờ đọc phải file dở dang
    log("đã ghi", OUT)


def main():
    if not KEY:
        log("Thiếu TMDB_API_KEY. Đặt nó trong file .env cạnh docker-compose.yml")
        sys.exit(1)
    while True:
        run_once()
        if INTERVAL <= 0:
            break
        time.sleep(INTERVAL * 3600)


if __name__ == "__main__":
    main()
