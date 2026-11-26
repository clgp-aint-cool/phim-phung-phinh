"""Chỉ mục toàn bộ phim KKPhim để sắp xếp theo đánh giá / độ phổ biến.

KKPhim API chỉ sắp xếp được theo thời gian cập nhật, năm, _id. Nhưng mỗi phim trong danh sách
đều kèm điểm + số lượt đánh giá của TMDB và IMDb, nên ta quét hết các danh sách (~480 trang,
64 phim/trang) rồi tự sắp xếp.

Các kiểu sắp xếp:
  year     Năm phát hành mới nhất
  rating   Đánh giá cao nhất  (điểm có trọng số Bayes, phim ít lượt đánh giá bị kéo về mức trung bình)
  popular  Phổ biến nhất      (tổng số lượt đánh giá TMDB + IMDb)
"""
import json
import os
import threading
import time
from datetime import datetime, timezone

from update_top import KK, get_json, log

LISTS = ["phim-le", "phim-bo", "tv-shows", "hoat-hinh"]
# loại danh sách trên web -> giá trị "type" của KKPhim
TYPE_MAP = {"phim-le": "single", "phim-bo": "series", "tv-shows": "tvshows", "hoat-hinh": "hoathinh"}
SORTS = ("year", "rating", "popular")
LIMIT = 64          # tối đa KKPhim cho phép mỗi trang
MIN_VOTES = 200     # ngưỡng "đủ tin cậy" cho điểm Bayes
MEAN_SCORE = 6.5    # điểm trung bình giả định
PAGE_SIZE = 24      # số phim mỗi trang trả về cho web (giống KKPhim)


def _num(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def slim(it):
    """Giữ các trường cần cho web + tính điểm."""
    tm, im = it.get("tmdb") or {}, it.get("imdb") or {}
    tv, iv = _num(tm.get("vote_count")), _num(im.get("vote_count"))
    ta, ia = _num(tm.get("vote_average")), _num(im.get("vote_average"))
    # Lấy nguồn có nhiều lượt đánh giá hơn làm điểm chính
    avg, votes = (ia, iv) if iv >= tv and ia > 0 else (ta, tv)
    score = (votes / (votes + MIN_VOTES)) * avg + (MIN_VOTES / (votes + MIN_VOTES)) * MEAN_SCORE if votes else 0
    return {
        "slug": it["slug"],
        "name": it.get("name"),
        "origin_name": it.get("origin_name"),
        "poster_url": it.get("poster_url"),
        "thumb_url": it.get("thumb_url"),
        "year": it.get("year"),
        "episode_current": it.get("episode_current"),
        "type": it.get("type"),
        "cat": [c["slug"] for c in it.get("category") or []],
        "ctry": [c["slug"] for c in it.get("country") or []],
        "rating": round(avg, 1) if votes else None,
        "votes": int(tv + iv),
        "score": score,
        "modified": (it.get("modified") or {}).get("time"),
    }


class Catalog:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.items, self.sorted, self.updated = [], {}, None
        self._load()

    # ---------- lưu / nạp ----------
    def _load(self):
        try:
            with open(self.path) as f:
                d = json.load(f)
            self._set(d["items"], d.get("updated"))
            log(f"catalog: nạp {len(self.items)} phim từ {self.path} ({self.updated})")
        except FileNotFoundError:
            pass
        except Exception as e:
            log("catalog: không đọc được file cũ:", e)

    def _set(self, items, updated):
        by_year = sorted(items, key=lambda m: (m["year"] or 0, m["modified"] or ""), reverse=True)
        by_rating = sorted(items, key=lambda m: (m["score"], m["votes"]), reverse=True)
        by_popular = sorted(items, key=lambda m: (m["votes"], m["score"]), reverse=True)
        with self.lock:
            self.items, self.updated = items, updated
            self.sorted = {"year": by_year, "rating": by_rating, "popular": by_popular}

    def age_hours(self):
        if not self.updated:
            return float("inf")
        return (datetime.now(timezone.utc) - datetime.fromisoformat(self.updated)).total_seconds() / 3600

    # ---------- quét KKPhim ----------
    def crawl(self):
        t0, seen, items = time.time(), set(), []
        for lst in LISTS:
            page, total = 1, 1
            while page <= total:
                d = get_json(f"{KK}/v1/api/danh-sach/{lst}?page={page}&limit={LIMIT}")
                data = (d or {}).get("data") or {}
                total = ((data.get("params") or {}).get("pagination") or {}).get("totalPages") or 0
                for it in data.get("items") or []:
                    if it.get("slug") and it["slug"] not in seen:
                        seen.add(it["slug"])
                        items.append(slim(it))
                page += 1
                time.sleep(0.3)  # nhẹ tay với API KKPhim
            log(f"catalog: {lst} xong, tổng {len(items)} phim")
        if len(items) < 1000:  # quét hỏng giữa chừng -> giữ chỉ mục cũ
            raise RuntimeError(f"chỉ lấy được {len(items)} phim")
        updated = datetime.now(timezone.utc).isoformat(timespec="seconds")
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"updated": updated, "items": items}, f, ensure_ascii=False)
        os.replace(tmp, self.path)
        self._set(items, updated)
        log(f"catalog: xong {len(items)} phim trong {time.time() - t0:.0f}s")

    # ---------- truy vấn ----------
    def query(self, type_="", category="", country="", sort="rating", page=1):
        with self.lock:
            src = self.sorted.get(sort) or []
            updated = self.updated
        want = TYPE_MAP.get(type_)
        res = [m for m in src
               if (not want or m["type"] == want)
               and (not category or category in m["cat"])
               and (not country or country in m["ctry"])]
        total_pages = max(1, -(-len(res) // PAGE_SIZE))
        page = min(max(1, page), total_pages)
        chunk = res[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        return {
            "status": True,
            "data": {
                "items": [{k: v for k, v in m.items() if k not in ("cat", "ctry", "score")} for m in chunk],
                "params": {"pagination": {"totalItems": len(res), "totalItemsPerPage": PAGE_SIZE,
                                          "currentPage": page, "totalPages": total_pages}},
                "updated": updated,
            },
        }
