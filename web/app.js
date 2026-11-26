// Nguồn: KKPhim (https://phimapi.com) - phát trực tiếp link m3u8 bằng hls.js
// Routes (hash based):
//   #/                                  -> phim mới cập nhật
//   #/list?type=&category=&country=&sort=&page=N  -> lọc kết hợp (vd phim-bo + han-quoc + tinh-cam)
//        sort: (trống) mới cập nhật - lấy thẳng KKPhim; year | rating | popular - qua API /api/list của server
//   #/search?q=...&page=N
//   #/phim/<slug>                        -> chi tiết
//   #/xem/<slug>/<server>/<ep>           -> xem phim
const API = "https://phimapi.com";
const IMG = "https://phimimg.com/";
const SITE = "Phim Phúng Phính";
const app = document.getElementById("app");
let hls = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const img = (u) => (!u ? "" : /^https?:\/\//.test(u) ? u : IMG + u.replace(/^\//, ""));
const stripTags = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();

// "/api/..." là API sắp xếp của server mình (updater/server.py), còn lại gọi KKPhim
async function get(path) {
  const r = await fetch(path.startsWith("/api/") ? path : API + path);
  if (!r.ok) {
    let msg = "HTTP " + r.status;
    try { msg = (await r.json()).msg || msg; } catch { /* không phải JSON */ }
    throw new Error(msg);
  }
  const d = await r.json();
  if (d.status === false || d.status === "error") throw new Error(d.msg || "Không tìm thấy");
  return d;
}

function parseHash() {
  const h = location.hash.slice(1) || "/";
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
}

function grid(items, ranked = false) {
  if (!items || !items.length) return "<p>Không có phim.</p>";
  return '<div class="grid">' + items.map((m, i) => `
    <a class="card" href="#/phim/${esc(m.slug)}">
      ${ranked ? `<span class="rank">${i + 1}</span>` : ""}
      <img loading="lazy" src="${esc(img(m.poster_url || m.thumb_url))}" alt="">
      <div class="t">${esc(m.name)}</div>
      <div class="s">${esc(m.episode_current || "")} ${m.year ? "· " + esc(m.year) : ""}</div>
      ${m.rating != null ? `<div class="s">★ ${esc(m.rating)} · ${fmtVotes(m.votes)} lượt đánh giá</div>` : ""}
    </a>`).join("") + "</div>";
}

const fmtVotes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "tr" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));

const SORT_OPTIONS = {
  "": "Mới cập nhật",
  year: "Năm phát hành mới nhất",
  rating: "Đánh giá cao nhất",
  popular: "Phổ biến nhất (lượt đánh giá)",
};

function sortBar(f) {
  return `<label class="sortbar">Sắp xếp:
    <select id="sort">${Object.entries(SORT_OPTIONS).map(([v, t]) =>
      `<option value="${v}"${v === (f.sort || "") ? " selected" : ""}>${t}</option>`).join("")}</select>
  </label>`;
}

function pager(p, base) {
  if (!p) return "";
  const cur = p.currentPage, total = p.totalPages;
  const sep = base.includes("?") ? "&" : "?";
  const link = (n, t) => `<a href="#${base}${sep}page=${n}">${t}</a>`;
  return `<div class="pager">
    ${cur > 1 ? link(1, "« Đầu") + link(cur - 1, "‹ Trước") : ""}
    <span>Trang ${cur} / ${total}</span>
    ${cur < total ? link(cur + 1, "Sau ›") + link(total, "Cuối »") : ""}
    <form class="jump" data-base="${esc(base)}" data-total="${total}">
      <input type="number" name="p" min="1" max="${total}" placeholder="Trang" required>
      <button>Đi</button>
    </form>
  </div>`;
}

// "phim-moi-cap-nhat" trả về {items, pagination}; các API /v1/api/* trả về {data:{items, params:{pagination}, titlePage}}
async function listPage(apiPath, base, title, page, prefix = "", f = null) {
  let d;
  try {
    d = await get(`${apiPath}${apiPath.includes("?") ? "&" : "?"}page=${page}`);
  } catch (err) {
    if (!f) throw err;
    // vẫn giữ ô "Sắp xếp" để người xem đổi lại được
    app.innerHTML = `<div class="listhead"><h2 id="list-title">${esc(title)}</h2>${sortBar(f)}</div><p>Lỗi tải dữ liệu: ${esc(err.message)}</p>`;
    return;
  }
  const x = d.data || d;
  const name = title || x.titlePage || "";
  document.title = name + " - " + SITE;
  const head = f ?`<div class="listhead"><h2 id="list-title">${esc(name)}</h2>${sortBar(f)}</div>` : `<h2 id="list-title">${esc(name)}</h2>`;
  const note = f?.sort && x.updated
    ? `<p class="note">Điểm và lượt đánh giá lấy từ TMDB / IMDb, cập nhật ${esc(new Date(x.updated).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }))}.</p>` : "";
  app.innerHTML = prefix + head + note + grid(x.items) + pager(x.params?.pagination || x.pagination, base);
}

const links = (arr, key) => (arr || []).map((x) => `<a href="#${listHash({ [key]: x.slug })}">${esc(x.name)}</a>`).join(", ");

function episodes(slug, eps, curServer, curEp) {
  return (eps || []).map((s, si) => `
    <h4>${esc(s.server_name)}</h4>
    <div class="eps">${s.server_data.map((e) =>
      `<a class="${si === curServer && e.slug === curEp ? "on" : ""}" href="#/xem/${esc(slug)}/${si}/${esc(e.slug)}">${esc(e.name)}</a>`
    ).join("")}</div>`).join("");
}

async function detailPage(slug) {
  const { movie: m, episodes: eps } = await get(`/phim/${encodeURIComponent(slug)}`);
  document.title = m.name + " - " + SITE;
  const first = eps?.[0]?.server_data?.[0];
  app.innerHTML = `
    <div class="detail">
      <img src="${esc(img(m.poster_url))}" alt="">
      <div class="info">
        <h2>${esc(m.name)}</h2>
        <div>${esc(m.origin_name)} (${esc(m.year)})</div>
        <p>${esc(m.episode_current)} · ${esc(m.time)} · ${esc(m.quality)} · ${esc(m.lang)}</p>
        <div><b>Đạo diễn:</b> ${esc((m.director || []).join(", "))}</div>
        <div><b>Diễn viên:</b> ${esc((m.actor || []).join(", "))}</div>
        <div><b>Thể loại:</b> ${links(m.category, "category")}</div>
        <div><b>Quốc gia:</b> ${links(m.country, "country")}</div>
        <p>${esc(stripTags(m.content))}</p>
        ${resumeButtons(m.slug, eps, first)}
      </div>
    </div>
    <h3>Danh sách tập</h3>
    ${episodes(m.slug, eps, -1, "")}`;
}

// ---- Nhớ vị trí đang xem (lưu trong trình duyệt, mỗi máy một lịch sử riêng) ----
//   pp:pos:<slug>/<server>/<ep> = số giây đang xem của tập đó
//   pp:last:<slug>              = { server, ep, name, t } tập xem gần nhất của phim
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("pp:" + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("pp:" + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("pp:" + k); } catch {} },
};
const posKey = (slug, server, ep) => `pos:${slug}/${server}/${ep}`;
function fmtTime(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
// Lưu vị trí của tập idx trong danh sách đang phát (np = nowPlaying). Xem gần hết -> coi như xong,
// "xem tiếp" chuyển sang tập sau (nếu có).
function savePos(np, idx, t, dur) {
  const e = np?.list[idx];
  if (!e || !(t >= 0)) return;
  const key = posKey(np.slug, np.server, e.slug);
  if (dur > 0 && (dur - t < 60 || t / dur > 0.97)) {
    store.del(key);
    const next = np.list[idx + 1];
    if (next) store.set("last:" + np.slug, { ...lastInfo(np), ep: next.slug, name: next.name, t: 0, dur: 0 });
    else store.del("last:" + np.slug);
    return;
  }
  if (t < 10) return;  // mới mở vài giây thì chưa lưu
  store.set(key, Math.floor(t));
  store.set("last:" + np.slug, { ...lastInfo(np), ep: e.slug, name: e.name, t: Math.floor(t), dur: Math.floor(dur) || 0 });
}
// Thông tin phim kèm theo để trang chủ hiện được mục "Đang xem" mà không phải gọi API
const lastInfo = (np) => ({ server: np.server, movie: np.name, poster: np.poster, single: np.list.length === 1, at: Date.now() });

// ---- Mục "Đang xem" trên trang chủ ----
function watchingList() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith("pp:last:")) continue;
      const v = store.get(k.slice(3));
      if (v?.movie) out.push({ slug: k.slice(8), ...v });
    }
  } catch {}
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}
const WATCHING_MAX = 12;
function watchingSection() {
  const list = watchingList();
  if (!list.length) return "";
  const cards = list.slice(0, WATCHING_MAX).map((w) => {
    const pct = w.dur ? Math.min(100, Math.round((w.t / w.dur) * 100)) : 0;
    const where = w.single ? "" : esc(w.name) + (w.t ? " · " : "");
    const time = w.t ? fmtTime(w.t) + (w.dur ? " / " + fmtTime(w.dur) : "") : (w.single ? "" : "chưa xem");
    return `
    <a class="card" href="#/xem/${esc(w.slug)}/${w.server}/${esc(w.ep)}">
      <button class="forget" type="button" data-slug="${esc(w.slug)}" title="Xoá khỏi danh sách đang xem">✕</button>
      <img loading="lazy" src="${esc(w.poster)}" alt="">
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="t">${esc(w.movie)}</div>
      <div class="s">▶ ${where}${time}</div>
    </a>`;
  }).join("");
  return `<section class="top watching"><h2>Đang xem</h2><div class="grid">${cards}</div></section>`;
}
// Xoá một phim khỏi "Đang xem" (xoá cả vị trí đã lưu của các tập)
app.addEventListener("click", (ev) => {
  const b = ev.target.closest(".forget");
  if (!b) return;
  ev.preventDefault();
  const slug = b.dataset.slug;
  try {
    Object.keys(localStorage).filter((k) => k === "pp:last:" + slug || k.startsWith(`pp:pos:${slug}/`))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
  b.closest(".card").remove();
  const sec = app.querySelector(".watching");
  if (sec && !sec.querySelector(".card")) sec.remove();
});
function resumeButtons(slug, eps, first) {
  if (!first) return "";
  const last = store.get("last:" + slug);
  const ok = last && eps?.[last.server]?.server_data.some((x) => x.slug === last.ep);
  const start = `<a href="#/xem/${esc(slug)}/0/${esc(first.slug)}"><button>▶ ${ok ? "Xem từ đầu" : "Xem phim"}</button></a>`;
  if (!ok) return `<p>${start}</p>`;
  const label = `▶ Xem tiếp ${esc(last.name)}${last.t ? ` (${fmtTime(last.t)})` : ""}`;
  return `<p class="resume"><a href="#/xem/${esc(slug)}/${last.server}/${esc(last.ep)}"><button class="primary">${label}</button></a> ${start}</p>`;
}

// Safari (Mac/iPhone/iPad): ưu tiên trình phát HLS gốc của Apple. Video KKPhim chèn quảng cáo bằng nhiều
// đoạn #EXT-X-DISCONTINUITY có tiếng lệch hình ~0.1s; hls.js phải chèn khung âm thanh câm ở mỗi chỗ nối
// nên nghe bị rè/lụp bụp, còn trình phát gốc của Apple nối mượt hơn.
// Chrome cũng báo canPlayType "maybe" nhưng trình phát gốc của Chrome không phát được luồng này -> chỉ áp dụng cho Safari.
const IS_APPLE_SAFARI = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || /^((?!chrome|chromium|crios|fxios|edg|opr|android).)*safari/i.test(navigator.userAgent);

function play(video, src) {
  const useHlsJs = () => {
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }
  };
  if (IS_APPLE_SAFARI && video.canPlayType("application/vnd.apple.mpegurl")) {
    // trình phát gốc lỗi -> tự chuyển sang hls.js
    video.addEventListener("error", () => { if (!hls) { video.removeAttribute("src"); video.load(); useHlsJs(); } }, { once: true });
    video.src = src;
    return;
  }
  useHlsJs();
}

async function watchPage(slug, server, ep) {
  const { movie: m, episodes: eps } = await get(`/phim/${encodeURIComponent(slug)}`);
  const e = eps?.[server]?.server_data.find((x) => x.slug === ep);
  if (!e) { app.innerHTML = "<p>Không tìm thấy tập phim.</p>"; return; }
  document.title = `${m.name} - ${e.name} - ${SITE}`;
  app.innerHTML = `
    <h2><a href="#/phim/${esc(m.slug)}">${esc(m.name)}</a> - ${esc(e.name)}</h2>
    <div class="player"><video controls autoplay playsinline x-webkit-airplay="allow"></video></div>
    <div class="tools">
      <span id="cast-wrap" hidden><google-cast-launcher title="Phát lên tivi (Chromecast)"></google-cast-launcher><span id="cast-status"></span></span>
      <button id="airplay-btn" type="button" title="Phát lên tivi qua AirPlay (nét như bản gốc)" hidden>📺 AirPlay</button>
      <button id="cinema-btn" type="button">🎬 Chế độ rạp</button>
    </div>
    ${episodes(m.slug, eps, server, ep)}`;
  document.getElementById("cinema-btn").addEventListener("click", () => cinema(!document.body.classList.contains("cinema")));
  const list = eps[server].server_data;
  const idx = list.indexOf(e);
  nowPlaying = { slug: m.slug, server, list, idx, name: m.name, poster: imgUrl(m.poster_url || m.thumb_url) };
  const np = nowPlaying;
  const resumeAt = store.get(posKey(m.slug, server, e.slug)) || 0;
  const video = app.querySelector("video");

  // Đang cast: chuyển tập lên tivi (trừ khi tivi đã tự sang đúng tập này trong hàng chờ)
  if (castSession()) { if (castCurrentSrc() !== e.link_m3u8) castLoad(resumeAt); }
  else {
    play(video, e.link_m3u8);
    if (resumeAt) {
      video.addEventListener("loadedmetadata", () => { if (video.currentTime < 1) video.currentTime = resumeAt; }, { once: true });
      showResumeNote(video, resumeAt);
    }
  }
  // Lưu vị trí mỗi 5 giây + khi dừng/rời trang
  let lastSave = 0;
  const save = () => { if (nowPlaying === np && video.currentSrc) savePos(np, idx, video.currentTime, video.duration); };
  video.addEventListener("timeupdate", () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); save(); } });
  video.addEventListener("pause", save);
  np.saveLocal = save;
  // Hết tập -> tự sang tập tiếp theo sau 5 giây (có nút huỷ)
  video.addEventListener("ended", () => { save(); if (list[idx + 1]) nextCountdown(np, idx + 1); });
  castUi();
  airplay(video);
  window.scrollTo(0, 0);
}
const epHash = (np, i) => `#/xem/${np.slug}/${np.server}/${np.list[i].slug}`;

function showResumeNote(video, t) {
  const note = document.createElement("span");
  note.className = "resume-note";
  note.innerHTML = `Xem tiếp từ ${fmtTime(t)} <button type="button">↺ Xem từ đầu</button>`;
  note.querySelector("button").addEventListener("click", () => { video.currentTime = 0; video.play(); note.remove(); });
  document.querySelector(".tools")?.prepend(note);
  setTimeout(() => note.remove(), 15000);
}

function nextCountdown(np, i) {
  const tools = document.querySelector(".tools");
  if (!tools || nowPlaying !== np) return;
  const box = document.createElement("span");
  box.className = "resume-note";
  tools.prepend(box);
  let n = 5;
  const tick = () => {
    if (nowPlaying !== np || !box.isConnected) return clearInterval(timer);
    if (n <= 0) { clearInterval(timer); location.hash = epHash(np, i); return; }
    box.innerHTML = `${esc(np.list[i].name)} sau ${n--} giây… <button type="button">Huỷ</button>`;
    box.querySelector("button").addEventListener("click", () => { clearInterval(timer); box.remove(); });
  };
  const timer = setInterval(tick, 1000);
  tick();
}

// ---- AirPlay (Safari): nút riêng mở danh sách tivi; chỉ hiện khi Safari tìm thấy thiết bị AirPlay ----
function airplay(video) {
  const btn = document.getElementById("airplay-btn");
  if (!btn || !window.WebKitPlaybackTargetAvailabilityEvent) return;
  video.addEventListener("webkitplaybacktargetavailabilitychanged", (ev) => {
    btn.hidden = ev.availability !== "available";
  });
  video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", () => {
    btn.textContent = video.webkitCurrentPlaybackTargetIsWireless ? "📺 Đang phát trên tivi" : "📺 AirPlay";
  });
  btn.addEventListener("click", () => video.webkitShowPlaybackTargetPicker());
}

// ---- Chromecast: gửi link m3u8 gốc cho tivi tự tải (nét 1080p, không phải quay màn hình) ----
let nowPlaying = null, castReady = false;
function imgUrl(p) { return !p ? "" : /^https?:/.test(p) ? p : IMG + p; }
function castSession() { return castReady ? cast.framework.CastContext.getInstance().getCurrentSession() : null; }
function castUi() {
  const wrap = document.getElementById("cast-wrap");
  if (!wrap) return;
  wrap.hidden = !castReady;
  const s = castSession();
  document.getElementById("cast-status").textContent = s ? `Đang phát trên ${s.getCastDevice().friendlyName}` : "";
}
function castMedia(np, i) {
  const e = np.list[i];
  const info = new chrome.cast.media.MediaInfo(e.link_m3u8, "application/x-mpegurl");
  info.streamType = chrome.cast.media.StreamType.BUFFERED;
  info.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.TS;
  info.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
  info.metadata = new chrome.cast.media.TvShowMediaMetadata();
  info.metadata.seriesTitle = np.name;
  info.metadata.title = np.list.length > 1 ? `${np.name} - ${e.name}` : np.name;
  if (np.poster) info.metadata.images = [new chrome.cast.Image(np.poster)];
  info.customData = { slug: np.slug, server: np.server, ep: e.slug };
  return info;
}
const CAST_QUEUE_MAX = 30;  // gửi tối đa 30 tập kế tiếp lên tivi; tivi tự phát nối tiếp
function castLoad(startTime) {
  const s = castSession();
  const np = nowPlaying;
  if (!s || !np) return;
  const items = np.list.slice(np.idx, np.idx + CAST_QUEUE_MAX).map((_, k) => {
    const it = new chrome.cast.media.QueueItem(castMedia(np, np.idx + k));
    it.autoplay = true;
    it.preloadTime = 20;
    it.startTime = k === 0 ? (startTime || 0) : (store.get(posKey(np.slug, np.server, np.list[np.idx + k].slug)) || 0);
    return it;
  });
  const req = new chrome.cast.media.QueueLoadRequest(items);
  req.startIndex = 0;
  req.repeatMode = chrome.cast.media.RepeatMode.OFF;
  // Dừng phát trên máy tính để không tốn băng thông
  np.saveLocal?.();
  if (hls) { hls.destroy(); hls = null; }
  const v = app.querySelector(".player video");
  if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  s.getSessionObj().queueLoad(req, () => {},
    (err) => alert("Không phát được trên tivi: " + (err?.description || err?.code || err)));
}
let remote = null;
function castCurrentSrc() { return remote?.player.mediaInfo?.contentId || null; }
// Tập đang phát trên tivi nằm ở vị trí nào trong danh sách của nowPlaying
function castIdx() {
  const src = castCurrentSrc();
  return src && nowPlaying ? nowPlaying.list.findIndex((x) => x.link_m3u8 === src) : -1;
}
window.__onGCastApiAvailable = (ok) => {
  if (!ok || !window.cast?.framework) return;
  const ctx = cast.framework.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  castReady = true;
  // Theo dõi trình phát trên tivi: lưu vị trí xem + khi tivi tự sang tập sau thì trang cũng sang theo
  remote = { player: new cast.framework.RemotePlayer() };
  remote.ctl = new cast.framework.RemotePlayerController(remote.player);
  const E = cast.framework.RemotePlayerEventType;
  let lastSave = 0;
  remote.ctl.addEventListener(E.CURRENT_TIME_CHANGED, () => {
    if (Date.now() - lastSave < 5000) return;
    lastSave = Date.now();
    const i = castIdx();
    if (i >= 0) savePos(nowPlaying, i, remote.player.currentTime, remote.player.duration);
  });
  remote.ctl.addEventListener(E.MEDIA_INFO_CHANGED, () => {
    const i = castIdx(), np = nowPlaying;
    if (i < 0 || i === np.idx) return;
    savePos(np, np.idx, Infinity, 1);  // tập trước đã xem xong
    if (location.hash.startsWith(`#/xem/${np.slug}/`)) location.hash = epHash(np, i);
  });
  ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (ev) => {
    const S = cast.framework.SessionState;
    if (ev.sessionState === S.SESSION_STARTED && location.hash.startsWith("#/xem/")) {
      const v = app.querySelector(".player video"), np = nowPlaying;
      // tiếp tục từ đoạn đang xem (hoặc vị trí đã lưu nếu video chưa kịp chạy)
      castLoad(v?.currentTime || store.get(posKey(np.slug, np.server, np.list[np.idx].slug)) || 0);
    } else if (ev.sessionState === S.SESSION_ENDED && nowPlaying && location.hash.startsWith("#/xem/")) {
      const v = app.querySelector(".player video");
      if (v && !hls && !v.src) {  // ngắt cast: phát lại trên máy từ chỗ tivi đang dừng
        const np = nowPlaying, t = store.get(posKey(np.slug, np.server, np.list[np.idx].slug)) || 0;
        play(v, np.list[np.idx].link_m3u8);
        if (t) v.addEventListener("loadedmetadata", () => { v.currentTime = t; }, { once: true });
      }
    }
    castUi();
  });
  castUi();
};

// Chế độ rạp: phủ tối cả trang, chỉ chừa khung phim (thoát bằng nút, bấm vùng tối hoặc phím Esc)
const dim = document.createElement("div");
dim.id = "dim";
dim.addEventListener("click", () => cinema(false));
document.body.appendChild(dim);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cinema(false); });

function cinema(on) {
  document.body.classList.toggle("cinema", on);
  const btn = document.getElementById("cinema-btn");
  if (btn) btn.textContent = on ? "💡 Tắt chế độ rạp" : "🎬 Chế độ rạp";
  if (on) document.querySelector(".player")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function route() {
  if (hls) { hls.destroy(); hls = null; }
  cinema(false);
  const { parts, q } = parseHash();
  const page = Math.max(1, parseInt(q.get("page")) || 1);
  app.innerHTML = "Đang tải...";
  try {
    if (parts[0] === "phim" && parts[1]) return await detailPage(parts[1]);
    if (parts[0] === "xem" && parts[3]) return await watchPage(parts[1], parseInt(parts[2]) || 0, parts[3]);
    if (parts[0] === "search") {
      const kw = q.get("q") || "";
      return await listPage(`/v1/api/tim-kiem?keyword=${encodeURIComponent(kw)}`,
        `/search?q=${encodeURIComponent(kw)}`, `Kết quả: ${kw}`, page);
    }
    if (parts[0] === "top") return await topPage();
    const f = getFilters(parts, q);
    // Trang chủ (#/): mục "Đang xem" ở trên, phim mới cập nhật ở dưới
    const home = !parts.length && ![...q.keys()].length;
    await listPage(apiFor(f), listHash(f), titleFor(f), page, home ? watchingSection() : "", f);
    if (home) document.title = SITE;
    return;
  } catch (err) {
    app.innerHTML = `<p>Lỗi tải dữ liệu: ${esc(err.message)}</p>`;
  }
}

document.getElementById("search").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const kw = ev.target.q.value.trim();
  if (kw) location.hash = `/search?q=${encodeURIComponent(kw)}`;
});
// Đổi kiểu sắp xếp: giữ nguyên các bộ lọc, về trang 1
app.addEventListener("change", (ev) => {
  if (ev.target.id === "sort") location.hash = listHash({ ...currentFilters(), sort: ev.target.value });
});

// Nhảy tới số trang (form nằm trong pager, render lại mỗi lần nên dùng event delegation)
app.addEventListener("submit", (ev) => {
  const f = ev.target.closest("form.jump");
  if (!f) return;
  ev.preventDefault();
  const n = Math.min(Math.max(1, parseInt(f.p.value) || 1), parseInt(f.dataset.total) || 1);
  const base = f.dataset.base;
  location.hash = `${base}${base.includes("?") ? "&" : "?"}page=${n}`;
});

// ---- Mục "Top 10": /data/top.json do container "updater" ghi định kỳ (nguồn TMDB) ----
async function topSections() {
  try {
    const r = await fetch("/data/top.json", { cache: "no-cache" });
    if (!r.ok) return "";
    const d = await r.json();
    const L = d.lists || {};
    const sec = (key, title, f) => L[key]?.length
      ? `<section class="top"><h2>${title} <a class="more" href="#${listHash(f)}">Xem thêm ›</a></h2>${grid(L[key], true)}</section>`
      : "";
    const html = sec("phim-le", "🔥 Top 10 Phim lẻ", { type: "phim-le" })
      + sec("phim-bo", "🔥 Top 10 Phim bộ", { type: "phim-bo" })
      + sec("anime", "🔥 Top 10 Anime", { type: "hoat-hinh", country: "nhat-ban" });
    if (!html) return "";
    const when = d.updated ? new Date(d.updated).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "";
    return html + `<p class="note">Xếp hạng theo độ thịnh hành trong tuần trên TMDB${when ? ", cập nhật " + esc(when) : ""}.</p>`;
  } catch {
    return ""; // chưa có top.json
  }
}

async function topPage() {
  document.title = "Top 10 - " + SITE;
  app.innerHTML = (await topSections()) || "<p>Chưa có dữ liệu Top 10, vui lòng quay lại sau.</p>";
}

// ---- Bộ lọc kết hợp: loại danh sách (type) + thể loại (category) + quốc gia (country) ----
const TYPES = { "": "Mới cập nhật", "phim-le": "Phim lẻ", "phim-bo": "Phim bộ", "tv-shows": "TV Shows", "hoat-hinh": "Hoạt hình" };
const isAnime = (f) => f.type === "hoat-hinh" && f.country === "nhat-ban";

// Đọc bộ lọc từ URL; vẫn hiểu link kiểu cũ #/list/danh-sach/x, #/list/the-loai/x, #/list/quoc-gia/x, #/anime
function getFilters(parts, q) {
  const sort = q.get("sort") || "";
  const f = { type: q.get("type") || "", category: q.get("category") || "", country: q.get("country") || "",
    sort: Object.hasOwn(SORT_OPTIONS, sort) ? sort : "" };
  if (parts[0] === "anime") Object.assign(f, { type: "hoat-hinh", country: "nhat-ban" });
  if (parts[0] === "list" && parts[2]) {
    if (parts[1] === "danh-sach") f.type = parts[2] === "phim-moi-cap-nhat" ? "" : parts[2];
    if (parts[1] === "the-loai") f.category = parts[2];
    if (parts[1] === "quoc-gia") f.country = parts[2];
  }
  return f;
}

function listHash(f) {
  const qs = new URLSearchParams();
  for (const k of ["type", "category", "country", "sort"]) if (f[k]) qs.set(k, f[k]);
  const s = qs.toString();
  return s ? `/list?${s}` : "/list";
}

function apiFor(f) {
  const qs = new URLSearchParams();
  if (f.sort) { // sắp xếp theo năm / đánh giá / độ phổ biến -> API của server mình
    for (const k of ["type", "category", "country", "sort"]) if (f[k]) qs.set(k, f[k]);
    return `/api/list?${qs}`;
  }
  if (f.type) {
    if (f.category) qs.set("category", f.category);
    if (f.country) qs.set("country", f.country);
    return `/v1/api/danh-sach/${f.type}?${qs}`;
  }
  if (f.category) {
    if (f.country) qs.set("country", f.country);
    return `/v1/api/the-loai/${f.category}?${qs}`;
  }
  if (f.country) return `/v1/api/quoc-gia/${f.country}`;
  return "/danh-sach/phim-moi-cap-nhat";
}

const optName = (type, slug) => document.querySelector(`select[data-type="${type}"] option[value="${CSS.escape(slug)}"]`)?.textContent || slug;

function titleFor(f) {
  const t = [];
  if (isAnime(f)) t.push("Anime");
  else if (f.type || (!f.category && !f.country)) t.push(TYPES[f.type] || f.type);
  if (f.category) t.push(optName("the-loai", f.category));
  if (f.country && !isAnime(f)) t.push(optName("quoc-gia", f.country));
  return t.join(" · ");
}

// Dropdown Thể loại / Quốc gia
async function loadFilters() {
  for (const sel of document.querySelectorAll("select[data-type]")) {
    const type = sel.dataset.type;
    try {
      const d = await get(`/${type}`);
      const items = Array.isArray(d) ? d : d.data?.items || d.items || [];
      items.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      sel.insertAdjacentHTML("beforeend", items.map((x) => `<option value="${esc(x.slug)}">${esc(x.name)}</option>`).join(""));
    } catch { /* bỏ qua, dropdown chỉ còn tiêu đề */ }
    sel.addEventListener("change", () => {
      // Giữ nguyên loại danh sách + bộ lọc còn lại, chỉ đổi bộ lọc vừa chọn ("" = bỏ lọc)
      location.hash = listHash({ ...currentFilters(), [type === "the-loai" ? "category" : "country"]: sel.value });
    });
  }
  syncFilters();
  // Tiêu đề trang cần tên thể loại/quốc gia -> render lại nếu đang ở trang danh sách
  const h2 = document.getElementById("list-title");
  if (onListPage() && h2) {
    h2.textContent = titleFor(currentFilters());
    document.title = h2.textContent + " - " + SITE;
  }
}

const onListPage = () => { const { parts } = parseHash(); return !parts.length || parts[0] === "list" || parts[0] === "anime"; };
function currentFilters() {
  const { parts, q } = parseHash();
  return onListPage() ? getFilters(parts, q) : lastFilters;
}
let lastFilters = { type: "", category: "", country: "", sort: "" };

// Đồng bộ dropdown + link menu với bộ lọc hiện tại (menu giữ thể loại/quốc gia đang chọn)
function syncFilters() {
  const f = currentFilters();
  lastFilters = f;
  document.getElementById("sel-the-loai").value = f.category;
  document.getElementById("sel-quoc-gia").value = f.country;
  // Nút "Bỏ lọc" chỉ hiện khi đang lọc (lọc Nhật Bản của Anime không tính)
  document.getElementById("reset-filters").hidden = !(f.category || (f.country && !isAnime(f)));
  for (const a of document.querySelectorAll("nav a[data-list]")) {
    const anime = a.dataset.list === "anime";
    const nf = anime ? { ...f, type: "hoat-hinh", country: "nhat-ban" } : { ...f, type: a.dataset.list };
    if (!anime && isAnime(f)) nf.country = ""; // rời Anime thì bỏ lọc Nhật Bản đi kèm
    a.href = "#" + listHash(nf);
    a.classList.toggle("on", onListPage() && (anime ? isAnime(f) : !isAnime(f) && f.type === a.dataset.list));
  }
  document.getElementById("nav-top").classList.toggle("on", parseHash().parts[0] === "top");
}

// Bỏ lọc thể loại + quốc gia, giữ nguyên loại danh sách đang xem (Phim bộ, Anime...)
document.getElementById("reset-filters").addEventListener("click", () => {
  const f = currentFilters();
  location.hash = listHash({ type: f.type, category: "", country: isAnime(f) ? f.country : "", sort: f.sort });
});

window.addEventListener("hashchange", () => { syncFilters(); route(); });
loadFilters();
route();
