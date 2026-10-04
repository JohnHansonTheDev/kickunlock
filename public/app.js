const $ = (s) => document.querySelector(s);
const eventsEl = $("#events"), statusEl = $("#status"), catsEl = $("#cats");
const video = $("#hls"), placeholder = $("#placeholder");
const eventTitle = $("#eventTitle"), modeBadge = $("#modeBadge"), eventInfo = $("#eventInfo");
let streams = [], currentClip = null, lastEventPath = "", hls = null;
let activeCat = "";
let currentSlug = "";

// ================= FAVORITES (localStorage) =================
function getFavs() {
  try { return JSON.parse(localStorage.getItem("ku-favs") || "[]"); }
  catch { return []; }
}
function isFav(slug) { return getFavs().some((f) => f.slug === slug); }
function toggleFav(slug, username) {
  let favs = getFavs();
  if (favs.some((f) => f.slug === slug)) favs = favs.filter((f) => f.slug !== slug);
  else favs.unshift({ slug, username: username || slug });
  localStorage.setItem("ku-favs", JSON.stringify(favs.slice(0, 100)));
  renderFavs();
  render(filter());
  syncFavStar();
}
function renderFavs() {
  const favs = getFavs();
  const box = $("#favs");
  box.innerHTML = "";
  favs.forEach((f) => {
    const d = document.createElement("div");
    d.className = "favrow";
    d.innerHTML = `<span>★ ${f.username}</span><button class="x" title="remove">✕</button>`;
    d.onclick = (e) => { if (!e.target.classList.contains("x")) openChannel(f.slug, f.username); };
    d.querySelector(".x").onclick = () => toggleFav(f.slug);
    box.appendChild(d);
  });
}
function syncFavStar() {
  const on = currentSlug && isFav(currentSlug);
  $("#favStar").textContent = on ? "★ Fav" : "☆ Fav";
}

function show(el) { el.style.display = "block"; }
function hide(el) { el.style.display = "none"; }
hide(video);

function fmtViews(n) {
  n = +n || 0;
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

async function loadCats() {
  try {
    const r = await fetch("/api/categories");
    const j = await r.json();
    catsEl.innerHTML = "";
    (j.categories || []).slice(0, 14).forEach((c) => {
      const b = document.createElement("button");
      b.textContent = `${c.name} (${fmtViews(c.viewers)})`;
      b.title = c.slug;
      b.onclick = () => {
        activeCat = activeCat === c.slug ? "" : c.slug;
        catsEl.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.title === activeCat));
        render(filter());
      };
      catsEl.appendChild(b);
    });
  } catch {}
}

async function loadFeatured() {
  statusEl.textContent = "Loading live channels…";
  eventsEl.innerHTML = "";
  try {
    const r = await fetch("/api/featured?limit=48");
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    streams = j.streams;
    statusEl.textContent = `${j.count} live channels`;
    render(filter());
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
  }
}

function filter() {
  const q = $("#search").value.trim().toLowerCase();
  return streams.filter((s) => {
    if (activeCat && s.categorySlug !== activeCat) return false;
    if (!q) return true;
    return ((s.username || "") + " " + (s.title || "") + " " + (s.category || "")).toLowerCase().includes(q);
  });
}

function render(list) {
  eventsEl.innerHTML = "";
  list.forEach((s) => {
    const d = document.createElement("div");
    d.className = "card";
    d.innerHTML = `
      ${s.thumb ? `<img src="${s.thumb}" loading="lazy"/>` : ""}
      <div class="t"><b>${s.username}</b>
      <small>${s.category || ""} • ${fmtViews(s.viewers)} watching<br/>${(s.title || "").slice(0, 60)}</small></div>
      <span class="badge">LIVE</span>
      <button class="starbtn${isFav(s.slug) ? " lit" : ""}" title="favorite">★</button>`;
    d.onclick = (e) => {
      if (e.target.classList.contains("starbtn")) { toggleFav(s.slug, s.username); return; }
      document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
      d.classList.add("active");
      openChannel(s.slug, s.username);
    };
    eventsEl.appendChild(d);
  });
  if (!list.length) eventsEl.innerHTML = `<div class="dim" style="padding:12px">Nothing live matching.</div>`;
}

function slugOf(input) {
  input = (input || "").trim();
  const m = input.match(/kick\.com\/([A-Za-z0-9_]+)/i);
  return (m ? m[1] : input.replace(/^@/, "").split(/[\s/]/)[0]).toLowerCase();
}

async function openChannel(slug, label) {
  slug = slugOf(slug);
  if (!slug) return;
  showView("single");
  stopPlayback();
  currentSlug = slug;
  syncFavStar();
  eventTitle.textContent = label || slug;
  modeBadge.textContent = "🔎 tuning…";
  eventInfo.textContent = `kick.com/${slug}`;
  $("#srcLink").href = `https://kick.com/${slug}`;
  try {
    const r = await fetch(`/api/watch/${encodeURIComponent(slug)}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    if (!j.live) {
      modeBadge.textContent = "";
      placeholder.style.display = "flex";
      placeholder.textContent = `${slug} is offline.`;
      eventInfo.textContent += "\n⚠️ offline";
      currentClip = null;
      updateClipUI();
      return;
    }
    if (!j.playable) throw new Error(j.note || "not playable");
    currentClip = { upstream: j.direct, referer: j.referer || "https://kick.com/" };
    eventTitle.textContent = `${j.title || slug}`;
    eventInfo.textContent = `kick.com/${slug}\n${j.category || ""} • ${fmtViews(j.viewers)} watching${j.started ? "\nStarted: " + new Date(j.started).toLocaleString() : ""}`;
    modeBadge.innerHTML = "✅ <b>DIRECT HLS</b> — ad-free";
    playDirect(j.proxied);
    updateClipUI();
  } catch (e) {
    modeBadge.textContent = "";
    placeholder.style.display = "flex";
    placeholder.textContent = "❌ " + e.message;
    currentClip = null;
    updateClipUI();
  }
}

function stopPlayback() {
  if (typeof mainTrim !== "undefined") mainTrim.close();
  pvDestroy();
  try { hls?.destroy(); } catch {}
  hls = null;
  video.pause?.();
  video.removeAttribute("src");
  video.load?.();
  hide(video);
  placeholder.style.display = "flex";
}

function playDirect(proxiedUrl) {
  hide(placeholder);
  show(video);
  placeholder.style.display = "none";
  video.playbackRate = baseSpeed();
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30 });
    hls.loadSource(proxiedUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) modeBadge.textContent = "⚠️ stream error: " + (data.details || "fatal");
    });
    video.play().catch(() => {});
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = proxiedUrl;
    video.play().catch(() => {});
  } else {
    video.src = proxiedUrl;
  }
  pvEnsure(proxiedUrl);
}

$("#reload").onclick = () => { loadFeatured(); };
$("#search").oninput = () => render(filter());
$("#chanGo").onclick = () => {
  const v = $("#chanInput").value;
  if (v.trim()) openChannel(v);
};
$("#chanInput").onkeydown = (e) => { if (e.key === "Enter") $("#chanGo").click(); };
$("#favStar").onclick = () => {
  if (currentSlug) toggleFav(currentSlug, eventTitle.textContent || currentSlug);
};
$("#wallAdd").onclick = () => {
  const m = $("#srcLink").href.match(/kick\.com\/([A-Za-z0-9_]+)/i);
  if (m) addToWall(m[1]);
};
$("#fs").onclick = () => {
  const w = $("#playerWrap");
  if (document.fullscreenElement) document.exitFullscreen();
  else w.requestFullscreen?.();
};

// Player size
function applyView() {
  const fit = localStorage.getItem("ku-fit") || "width";
  const pct = localStorage.getItem("ku-pct") || "100";
  const th = localStorage.getItem("ku-theater") || "0";
  document.body.dataset.fit = fit;
  document.body.dataset.theater = th;
  document.documentElement.style.setProperty("--pw", pct + "%");
  $("#fitMode").value = fit;
  $("#sizeW").value = pct;
  $("#sizeLbl").textContent = pct + "%";
  $("#theater").checked = th === "1";
  $("#sizeW").disabled = fit !== "width";
}
$("#fitMode").onchange = (e) => { localStorage.setItem("ku-fit", e.target.value); applyView(); };
$("#sizeW").oninput = (e) => { localStorage.setItem("ku-pct", e.target.value); applyView(); };
$("#theater").onchange = (e) => { localStorage.setItem("ku-theater", e.target.checked ? "1" : "0"); applyView(); };
applyView();

// ================= WALL =================
const WALL_MAX = 6;
let wallTiles = [];
let tileSeq = 0;
function layoutWall() {
  const n = wallTiles.length;
  const cols = n <= 1 ? 1 : n <= 3 ? n : Math.ceil(Math.sqrt(n));
  $("#wall").style.setProperty("--cols", cols);
  $("#wallN").textContent = n;
  $("#wallCount").textContent = n ? `(${n})` : "";
  $("#wallEmpty").style.display = n ? "none" : "block";
}
async function addToWall(slug) {
  slug = slugOf(slug);
  if (!slug) return;
  if (wallTiles.length >= WALL_MAX) { alert(`Wall is full (max ${WALL_MAX}).`); return; }
  showView("wall");
  const id = ++tileSeq;
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.innerHTML = `<div class="tbar"><span class="tlabel">${slug}</span>
    <button class="clipb" title="record clip (uses Record duration)">✂</button>
    <button class="trimb" title="trim mode: markers, loop, export">🎞</button>
    <button class="mute" title="mute/unmute">🔇</button><button class="rm" title="remove">✕</button></div>
    <div class="ttrim" hidden>
      <div class="ttl"><div class="ttlBuf"></div><div class="ttlSel"></div>
        <div class="thStart thdl" title="start"></div><div class="thEnd thdl" title="end"></div>
        <div class="ttlPlay"></div></div>
      <div class="tprev" hidden><canvas width="160" height="90"></canvas><div></div></div>
      <div class="trow"><button class="tloop">▶</button><button class="texport">⬇</button><button class="tclose">✕</button></div>
    </div>
    <div class="tstat">tuning…</div>`;
  $("#wall").appendChild(tile);
  const t = { id, hls: null, video: null, muted: true, el: tile, clip: null, clipping: false, trim: null, proxied: null };
  wallTiles.push(t);
  layoutWall();
  const stat = tile.querySelector(".tstat");
  const muteBtn = tile.querySelector(".mute");
  muteBtn.onclick = () => setTileMute(t, !t.muted);
  tile.querySelector(".rm").onclick = () => removeTile(id);
  tile.querySelector(".clipb").onclick = () => clipTile(id);
  tile.querySelector(".trimb").onclick = () => {
    if (t.trim?.on) { t.trim.close(); return; }
    if (!t.video) return;
    if (!t.trim) {
      t.trim = createTrim(() => t.video, {
        panel: tile.querySelector(".ttrim"), tl: tile.querySelector(".ttl"),
        tlBuf: tile.querySelector(".ttlBuf"), tlSel: tile.querySelector(".ttlSel"),
        hStart: tile.querySelector(".thStart"), hEnd: tile.querySelector(".thEnd"),
        tlPlay: tile.querySelector(".ttlPlay"), tlTimes: null,
        loopBtn: tile.querySelector(".tloop"), exportBtn: tile.querySelector(".texport"),
        closeBtn: tile.querySelector(".tclose"), stat: tile.querySelector(".tstat"),
      });
      pvHover(tile.querySelector(".ttl"), tile.querySelector(".tprev"),
        tile.querySelector(".tprev canvas"), tile.querySelector(".tprev div"),
        () => seekWindow(t.video), null);
    }
    pvEnsure(t.proxied);
    t.trim.open();
  };
  try {
    const r = await fetch(`/api/watch/${encodeURIComponent(slug)}`);
    const j = await r.json();
    if (!wallTiles.includes(t)) return;
    if (!j.playable) { stat.textContent = j.note || "offline"; return; }
    t.clip = { upstream: j.direct, referer: j.referer || "https://kick.com/" };
    t.proxied = j.proxied;
    tile.querySelector(".tlabel").textContent = `${j.title || slug} • ${fmtViews(j.viewers)}`;
    const v = document.createElement("video");
    v.controls = true; v.playsInline = true; v.muted = true;
    tile.appendChild(v);
    tile.addEventListener("pointerdown", () => { lastWallVideo = v; });
    t.video = v;
    stat.textContent = "DIRECT — muted, 🔊 to unmute";
    if (window.Hls && Hls.isSupported()) {
      t.hls = new Hls({ maxBufferLength: 30 });
      t.hls.loadSource(j.proxied);
      t.hls.attachMedia(v);
      t.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) stat.textContent = "stream error"; });
    } else v.src = j.proxied;
    v.play().catch(() => { stat.textContent += " — press play"; });
  } catch (e) {
    stat.textContent = "❌ " + e.message;
  }
}
function setTileMute(t, mute) {
  t.muted = mute;
  if (t.video) t.video.muted = mute;
  t.el.querySelector(".mute").textContent = mute ? "🔇" : "🔊";
}
function removeTile(id) {
  const i = wallTiles.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = wallTiles.splice(i, 1);
  try { t.trim?.close(); } catch {}
  try { t.hls?.destroy(); } catch {}
  t.video?.pause?.();
  t.el.remove();
  layoutWall();
}
async function clipTile(id) {
  const t = wallTiles.find((x) => x.id === id);
  if (!t || t.clipping || !t.clip) return;
  t.clipping = true;
  const btn = t.el.querySelector(".clipb");
  const stat = t.el.querySelector(".tstat");
  btn.disabled = true;
  const seconds = parseInt($("#clipSecs").value, 10) || 30;
  stat.textContent = `⏺ recording ${seconds}s… (takes ~${seconds}s)`;
  try {
    const r = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...t.clip, seconds }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    stat.innerHTML = `✅ <a href="${j.url}" download>Download ${j.file}</a> (${(j.bytes / 1048576).toFixed(1)} MB)`;
    refreshClips();
  } catch (e) {
    stat.textContent = "❌ clip failed: " + e.message;
  } finally {
    t.clipping = false;
    btn.disabled = false;
  }
}
$("#wallMuteAll").onclick = () => wallTiles.forEach((t) => setTileMute(t, true));
$("#wallClear").onclick = () => [...wallTiles].forEach((t) => removeTile(t.id));

function freezeView(name) {
  if (name === "single") { video.pause?.(); try { mainTrim.close(); } catch {} }
  else wallTiles.forEach((t) => { t.video?.pause?.(); try { t.trim?.close(); } catch {} });
}
function unfreezeView(name) {
  if (name === "single") { if (video.src || video.currentSrc) video.play?.().catch(() => {}); }
  else wallTiles.forEach((t) => t.video?.play?.().catch(() => {}));
}
function showView(name) {
  const order = ["browse", "single", "wall"];
  if (!order.includes(name)) name = "single";
  document.body.dataset.view = name;
  $("#viewSingle").hidden = name !== "single";
  $("#viewWall").hidden = name !== "wall";
  $("#tabBrowse").classList.toggle("on", name === "browse");
  $("#tabSingle").classList.toggle("on", name === "single");
  $("#tabWall").classList.toggle("on", name === "wall");
  if (name === "wall") { freezeView("single"); unfreezeView("wall"); }
  else if (name === "single") { freezeView("wall"); unfreezeView("single"); }
  else { freezeView("wall"); }
}
document.body.dataset.view = "browse";
$("#tabBrowse").onclick = () => showView("browse");
$("#tabSingle").onclick = () => showView("single");
$("#tabWall").onclick = () => showView("wall");

// ================= PLAYER KEYS =================
const KEY_DEF = { rwKey: "z", rwSec: 10, ffKey: "x", ffSpd: 2 };
function keyOpts() {
  try { return { ...KEY_DEF, ...JSON.parse(localStorage.getItem("ku-keys") || "{}") }; }
  catch { return { ...KEY_DEF }; }
}
function saveKeys(o) { localStorage.setItem("ku-keys", JSON.stringify(o)); refreshKeyUI(); }
function refreshKeyUI() {
  const o = keyOpts();
  $("#optRwKey").value = o.rwKey; $("#optRwSec").value = o.rwSec;
  $("#optFfKey").value = o.ffKey; $("#optFfSpd").value = o.ffSpd;
  $("#keyHint").textContent = `hold ${o.rwKey.toUpperCase()} rewind · hold ${o.ffKey.toUpperCase()} ${o.ffSpd}x FF`;
}
let osdT = 0;
function osd(msg) {
  const el = $("#osd");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(osdT);
  osdT = setTimeout(() => { el.hidden = true; }, 900);
}
let lastWallVideo = null;
let held = { rw: false, ff: false, timer: 0, prevRate: 1, resumePlay: false };
function keyTarget() {
  if (document.body.dataset.view === "wall" && lastWallVideo?.isConnected) return lastWallVideo;
  if (video.style.display !== "none" && (video.src || video.currentSrc)) return video;
  return null;
}
function stopHeld(v) {
  clearInterval(held.timer);
  held.timer = 0;
  if (held.ff && v) v.playbackRate = held.prevRate || 1;
  held.rw = held.ff = false;
}
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tag = (document.activeElement?.tagName || "").toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) return;
  const o = keyOpts();
  const k = e.key.toLowerCase();
  const v = keyTarget();
  if (!v) return;
  if (k === String(o.rwKey).toLowerCase()) {
    e.preventDefault();
    if (held.rw) return;
    stopHeld(v);
    held.rw = true;
    held.resumePlay = !v.paused;
    v.pause();
    const step = Math.max(1, (Number(o.rwSec) || 10) / 5);
    const tick = () => { v.currentTime = Math.max(0, v.currentTime - step); osd(`◀◀ −${o.rwSec}s hold`); };
    tick();
    held.timer = setInterval(tick, 200);
  } else if (k === String(o.ffKey).toLowerCase()) {
    e.preventDefault();
    if (held.ff) return;
    stopHeld(v);
    held.ff = true;
    held.resumePlay = !v.paused;
    held.prevRate = v.playbackRate || 1;
    v.playbackRate = Number(o.ffSpd) || 2;
    v.play().catch(() => {});
    osd(`▶▶ ${v.playbackRate}x hold`);
  }
});
document.addEventListener("keyup", (e) => {
  const o = keyOpts();
  const k = e.key.toLowerCase();
  if (k !== String(o.rwKey).toLowerCase() && k !== String(o.ffKey).toLowerCase()) return;
  const v = keyTarget();
  const resume = held.resumePlay;
  stopHeld(v);
  if (v) {
    if (resume) v.play().catch(() => {});
    else v.pause();
    osd("▶ 1x");
  }
});
window.addEventListener("blur", () => stopHeld(keyTarget()));
$("#optToggle").onclick = () => { $("#optPanel").hidden = !$("#optPanel").hidden; };
$("#optRwKey").onchange = (e) => { const o = keyOpts(); o.rwKey = (e.target.value || "z")[0]; saveKeys(o); };
$("#optRwSec").onchange = (e) => { const o = keyOpts(); o.rwSec = Math.min(120, Math.max(1, +e.target.value || 10)); saveKeys(o); };
$("#optFfKey").onchange = (e) => { const o = keyOpts(); o.ffKey = (e.target.value || "x")[0]; saveKeys(o); };
$("#optFfSpd").onchange = (e) => { const o = keyOpts(); o.ffSpd = Math.min(8, Math.max(1.25, +e.target.value || 2)); saveKeys(o); };
$("#optReset").onclick = () => saveKeys({ ...KEY_DEF });
refreshKeyUI();

// ================= TIMECODE + SPEED =================
function fmtT(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function baseSpeed() { return +(localStorage.getItem("ku-spd") || 1); }
setInterval(() => {
  const el = $("#tcode");
  const on = document.body.dataset.view === "single" && video.style.display !== "none" && (video.src || video.currentSrc);
  if (!on) { el.hidden = true; return; }
  el.hidden = false;
  const clock = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let edge = 0;
  try { const sk = video.seekable; if (sk.length) edge = sk.end(sk.length - 1); } catch {}
  if (isFinite(video.duration) && video.duration > 0) {
    el.textContent = `▶ ${fmtT(video.currentTime)} / ${fmtT(video.duration)} · ${clock}`;
  } else {
    const behind = edge ? Math.max(0, edge - video.currentTime) : 0;
    el.textContent = `🔴 LIVE${behind > 1.5 ? ` −${Math.round(behind)}s` : ""} · ${fmtT(video.currentTime)} · ${clock}`;
  }
}, 500);
document.querySelectorAll(".spd").forEach((b) => {
  if (+b.dataset.s === baseSpeed()) b.classList.add("on");
  b.onclick = () => {
    const s = +b.dataset.s;
    localStorage.setItem("ku-spd", s);
    document.querySelectorAll(".spd").forEach((x) => x.classList.toggle("on", x === b));
    const v = keyTarget();
    if (v) { v.playbackRate = s; held.prevRate = s; osd(`▶ ${s}x`); }
  };
});

// ================= CLIPS (server record from live edge) =================
function updateClipUI() {
  const ok = !!currentClip;
  $("#clipBtn").disabled = !ok;
  $("#clipBtn").title = ok ? "record from live edge" : "play a channel first";
  $("#trimFab").hidden = !ok;
  if (!ok && !video.src) $("#clipStat").textContent = "";
}
async function refreshClips() {
  try {
    const r = await fetch("/api/clips");
    const j = await r.json();
    $("#clipList").innerHTML = (j.clips || []).map((c) =>
      `<div class="cliprow">🎬 <a href="${c.url}" download>${c.file}</a> <small>${(c.bytes / 1048576).toFixed(1)} MB</small></div>`
    ).join("");
  } catch {}
}
$("#clipBtn").onclick = async () => {
  if (!currentClip) return;
  const seconds = parseInt($("#clipSecs").value, 10) || 30;
  $("#clipBtn").disabled = true;
  $("#clipStat").textContent = `⏺ recording ${seconds}s… (takes ~${seconds}s)`;
  try {
    const r = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...currentClip, seconds }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    $("#clipStat").innerHTML = `✅ <a href="${j.url}" download>Download ${j.file}</a> (${(j.bytes / 1048576).toFixed(1)} MB)`;
    refreshClips();
  } catch (e) {
    $("#clipStat").textContent = "❌ clip failed: " + e.message;
  } finally {
    updateClipUI();
  }
};
refreshClips();

// ================= TRIM FACTORY (main player + wall tiles) =================
function createTrim(getVideo, els) {
  const st = { on: false, start: 0, end: 0, loop: false, raf: 0, exporting: false, audio: null };
  const V = () => getVideo();
  function tick() {
    const v = V();
    if (!st.on || st.exporting || !v) return;
    if (st.loop && v.currentTime >= st.end - 0.05) v.currentTime = st.start;
  }
  function open() {
    const v = V();
    if (!v) return false;
    v.pause();
    st.loop = false;
    els.loopBtn.textContent = "▶ Loop";
    const [a, b] = seekWindow(v);
    st.start = Math.max(a, b - 10);
    st.end = b;
    st.on = true;
    els.panel.hidden = false;
    v.currentTime = st.start;
    v.addEventListener("timeupdate", tick);
    cancelAnimationFrame(st.raf);
    render();
    return true;
  }
  function close() {
    if (!st.on) return;
    const v = V();
    st.on = st.loop = st.exporting = false;
    if (v) v.removeEventListener("timeupdate", tick);
    cancelAnimationFrame(st.raf);
    els.panel.hidden = true;
  }
function seekWindow(v) {
  v = v || video;
  let a = 0, b = 0;
  try { const sk = v.seekable; if (sk.length) { a = sk.start(0); b = sk.end(sk.length - 1); } } catch {}
  if (!b || b <= a) {
    try { const bf = v.buffered; if (bf.length) { a = bf.start(0); b = bf.end(bf.length - 1); } } catch {}
  }
  if (!b || b <= a) { const c = v.currentTime || 0; a = Math.max(0, c - 10); b = c; }
  return [a, b];
}
  function render() {
    if (!st.on) return;
    const v = V();
    if (!v) return;
    const [a, b] = seekWindow(v);
    const span = Math.max(0.01, b - a);
    st.start = Math.min(Math.max(st.start, a), b - 0.2);
    st.end = Math.min(Math.max(st.end, a + 0.2), b);
    if (st.end < st.start + 0.2) st.end = Math.min(b, st.start + 0.2);
    const pct = (t) => ((t - a) / span) * 100;
    els.tlSel.style.left = pct(st.start) + "%";
    els.tlSel.style.width = Math.max(0.5, pct(st.end) - pct(st.start)) + "%";
    els.hStart.style.left = pct(st.start) + "%";
    els.hEnd.style.left = pct(st.end) + "%";
    if (els.tlPlay) els.tlPlay.style.left = pct(Math.min(Math.max(v.currentTime, a), b)) + "%";
    els.tlBuf.innerHTML = "";
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        const el = document.createElement("i");
        el.style.left = pct(v.buffered.start(i)) + "%";
        el.style.width = Math.max(0.5, pct(v.buffered.end(i)) - pct(v.buffered.start(i))) + "%";
        els.tlBuf.appendChild(el);
      }
    } catch {}
    if (els.tlTimes) {
      const f = (t) => new Date(t * 1000).toISOString().slice(14, 19);
      els.tlTimes.textContent = `start ${f(st.start)} → end ${f(st.end)} (${(st.end - st.start).toFixed(1)}s)`;
    }
    st.raf = requestAnimationFrame(render);
  }
  function seekFromEvent(e) {
    const r = els.tl.getBoundingClientRect();
    const x = e.clientX - r.left;
    const v = V();
    const [a, b] = seekWindow(v);
    return a + Math.min(Math.max(x / Math.max(1, r.width), 0), 1) * (b - a);
  }
  function drag(el, which) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const t = seekFromEvent(ev);
        const v = V();
        if (which === "start") st.start = Math.min(t, st.end - 0.2);
        else st.end = Math.max(t, st.start + 0.2);
        if (v) v.currentTime = t;
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
  drag(els.hStart, "start");
  drag(els.hEnd, "end");
  els.tl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".hdl,.thdl")) return;
    const v = V();
    if (v) v.currentTime = seekFromEvent(e);
  });
  els.loopBtn.onclick = () => {
    if (!st.on) return;
    const v = V();
    st.loop = !st.loop;
    els.loopBtn.textContent = st.loop ? "⏸ Stop loop" : "▶ Loop";
    if (!v) return;
    if (st.loop) { v.currentTime = st.start; v.play().catch(() => {}); }
    else v.pause();
  };
  els.closeBtn.onclick = () => { const v = V(); if (v) v.pause(); close(); };
async function fixWebmDuration(blob, durationMs) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const find = (pat, from) => {
    outer: for (let i = from || 0; i <= buf.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  };
  const vLen = (p) => { let b = buf[p], l = 1; while (l <= 8 && !(b & 0x80)) { b <<= 1; l++; } return Math.min(l, 8); };
  const vVal = (p) => { const l = vLen(p); let v = buf[p] & ((1 << (8 - l)) - 1); for (let i = 1; i < l; i++) v = v * 256 + buf[p + i]; return { len: l, val: v }; };
  const vEnc = (v, min) => {
    let l = min || 1;
    while (v > Math.pow(2, 7 * l) - 2) l++;
    const out = new Uint8Array(l);
    let t = v;
    for (let i = l - 1; i >= 0; i--) { out[i] = t % 256; t = Math.floor(t / 256); }
    out[0] |= 0x80 >> (l - 1);
    return out;
  };
  const seg = find([0x18, 0x53, 0x80, 0x67], 0);
  if (seg < 0) return blob;
  const info = find([0x15, 0x49, 0xA9, 0x66], seg);
  if (info < 0) return blob;
  const s = vVal(info + 4);
  const ds = info + 4 + s.len;
  let scale = 1000000;
  const ts = find([0x2A, 0xD7, 0xB1], ds);
  if (ts >= 0 && ts < ds + s.val) {
    const tv = vVal(ts + 3);
    let n = 0;
    for (let i = 0; i < tv.val; i++) n = n * 256 + buf[ts + 3 + tv.len + i];
    if (n > 0) scale = n;
  }
  const f = new DataView(new ArrayBuffer(8));
  f.setFloat64(0, (durationMs * 1000000) / scale);
  const durEl = new Uint8Array([0x44, 0x89, 0x88, ...new Uint8Array(f.buffer)]);
  const ex = find([0x44, 0x89], ds);
  if (ex >= 0 && ex < ds + s.val) { buf.set(durEl, ex); return new Blob([buf], { type: "video/webm" }); }
  const enc = vEnc(s.val + durEl.length, s.len);
  const out = new Uint8Array(buf.length + durEl.length + (enc.length - s.len));
  out.set(buf.subarray(0, info + 4), 0);
  out.set(enc, info + 4);
  let p = info + 4 + enc.length;
  out.set(durEl, p); p += durEl.length;
  out.set(buf.subarray(ds), p);
  return new Blob([out], { type: "video/webm" });
}
  els.exportBtn.onclick = async () => {
    const v = V();
    if (!st.on || st.exporting || !v) return;
    const dur = st.end - st.start;
    if (dur < 0.5) { els.stat.textContent = "selection too short"; return; }
    if (dur > 180) { els.stat.textContent = "max 180s per export"; return; }
    if (!window.MediaRecorder || !document.createElement("canvas").captureStream) {
      els.stat.textContent = "browser can't export (needs MediaRecorder)";
      return;
    }
    st.exporting = true;
    st.loop = false;
    els.loopBtn.textContent = "▶ Loop";
    els.stat.textContent = "⏺ exporting… playing selection once";
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    let draw = true;
    const paint = () => {
      if (!draw) return;
      try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); } catch {}
      requestAnimationFrame(paint);
    };
    paint();
    let wasMuted = v.muted;
    try {
      if (!st.audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const src = ac.createMediaElementSource(v);
        const dest = ac.createMediaStreamDestination();
        src.connect(dest);
        src.connect(ac.destination);
        st.audio = { ac, dest };
      }
      await st.audio.ac.resume().catch(() => {});
      const tracks = [...canvas.captureStream(30).getVideoTracks(), ...st.audio.dest.stream.getAudioTracks()];
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      wasMuted = v.muted;
      v.muted = false;
      const done = new Promise((res) => { rec.onstop = res; });
      v.currentTime = st.start;
      await v.play().catch(() => {});
      rec.start(500);
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("export timed out")), (dur + 20) * 1000);
        const wtick = () => {
          if (!st.exporting) { clearTimeout(to); res(); }
          else if (v.currentTime >= st.end) { clearTimeout(to); res(); }
          else setTimeout(wtick, 150);
        };
        wtick();
      });
      rec.stop();
      await done;
      let blob = new Blob(chunks, { type: "video/webm" });
      try { blob = await fixWebmDuration(blob, dur * 1000); } catch {}
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `trim-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      els.stat.textContent = `✅ exported ${dur.toFixed(1)}s webm (${(blob.size / 1048576).toFixed(1)} MB)`;
    } catch (e) {
      els.stat.textContent = "❌ export failed: " + e.message;
    } finally {
      draw = false;
      st.exporting = false;
      v.muted = wasMuted;
      v.pause();
    }
  };
  return { open, close, get on() { return st.on; } };
}
// Shared hover-preview target: seeked frames paint to whichever canvas is active.
let pvCanvasEl = null;
// Main player trim instance
const mainTrim = createTrim(() => video, {
  panel: $("#trimPanel"), tl: $("#tl"), tlBuf: $("#tlBuf"), tlSel: $("#tlSel"),
  hStart: $("#hStart"), hEnd: $("#hEnd"), tlPlay: $("#tlPlay"), tlTimes: $("#tlTimes"),
  loopBtn: $("#loopBtn"), exportBtn: $("#exportBtn"), closeBtn: $("#trimClose"), stat: $("#trimStat"),
});
$("#trimFab").onclick = () => {
  if (mainTrim.on) { mainTrim.close(); return; }
  if (!currentClip || video.style.display === "none") return;
  mainTrim.open();
};

// ================= TIMELINE HOVER PREVIEWS =================
// Hidden second player scrubs the same stream; hover frames render to canvas.
// Same-origin proxy => canvas stays clean. Limited to the DVR window.
let pvHls = null, pvVideo = null, pvUrl = "", pvLastSeek = 0;
function pvEnsure(url) {
  if (pvVideo && pvUrl === url) return;
  pvDestroy();
  pvUrl = url;
  pvVideo = document.createElement("video");
  pvVideo.muted = true;
  pvVideo.playsInline = true;
  pvVideo.preload = "auto";
  if (window.Hls && Hls.isSupported()) {
    pvHls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20 });
    pvHls.loadSource(url);
    pvHls.attachMedia(pvVideo);
  } else pvVideo.src = url;
  pvVideo.addEventListener("seeked", pvDraw);
}
function pvDestroy() {
  try { pvHls?.destroy(); } catch {}
  pvHls = null; pvVideo = null; pvUrl = "";
  const w = $("#pvWrap");
  if (w) w.hidden = true;
}
function pvDraw() {
  if (!pvVideo || !pvVideo.videoWidth) return;
  const c = pvCanvasEl && pvCanvasEl.isConnected ? pvCanvasEl : $("#pvCanvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  const vw = pvVideo.videoWidth, vh = pvVideo.videoHeight;
  const s = Math.max(c.width / vw, c.height / vh);
  const w = vw * s, h = vh * s;
  try { ctx.drawImage(pvVideo, (c.width - w) / 2, (c.height - h) / 2, w, h); } catch {}
}
// Generic hover: barEl timeline, popEl popup, canvasEl thumb, timeEl label,
// winFn() -> [a,b] window, seekFn(t) previews+acts. Used by main strip + tiles.
function pvHover(barEl, popEl, canvasEl, timeEl, winFn, onPick) {
  barEl.addEventListener("pointermove", (e) => {
    if (!pvVideo) return;
    const r = barEl.getBoundingClientRect();
    const [a, b] = winFn();
    const f = Math.min(Math.max((e.clientX - r.left) / Math.max(1, r.width), 0), 1);
    const t = a + f * (b - a);
    pvCanvasEl = canvasEl;
    popEl.hidden = false;
    popEl.style.left = Math.min(Math.max(e.clientX - r.left, 84), r.width - 84) + "px";
    timeEl.textContent = fmtT(t);
    const now = Date.now();
    if (now - pvLastSeek > 250) {
      pvLastSeek = now;
      try { pvVideo.currentTime = t; } catch {}
    }
  });
  barEl.addEventListener("pointerleave", () => { popEl.hidden = true; });
  if (onPick) barEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".hdl,.thdl")) return;
    const r = barEl.getBoundingClientRect();
    const [a, b] = winFn();
    const f = Math.min(Math.max((e.clientX - r.left) / Math.max(1, r.width), 0), 1);
    onPick(a + f * (b - a));
  });
}
function pvTimeAt(clientX) {
  const bar = $("#pvBar");
  const r = bar.getBoundingClientRect();
  const [a, b] = seekWindow();
  const f = Math.min(Math.max((clientX - r.left) / Math.max(1, r.width), 0), 1);
  return { t: a + f * (b - a), f, left: clientX - r.left, width: r.width };
}
pvHover($("#pvBar"), $("#pvPop"), $("#pvCanvas"), $("#pvTime"), () => seekWindow(video), (t) => {
  if (document.body.dataset.view !== "single") return;
  video.currentTime = t; // click strip to jump
});
setInterval(() => {
  const on = document.body.dataset.view === "single" && video.style.display !== "none" && (video.src || video.currentSrc);
  $("#pvWrap").hidden = !on;
  if (!on) return;
  const [a, b] = seekWindow();
  const span = Math.max(0.01, b - a);
  const pct = (t) => ((t - a) / span) * 100;
  $("#pvProg").style.width = pct(Math.min(Math.max(video.currentTime, a), b)) + "%";
  $("#pvHead").style.left = pct(Math.min(Math.max(video.currentTime, a), b)) + "%";
  const buf = $("#pvBuf");
  buf.innerHTML = "";
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      const el = document.createElement("i");
      el.style.left = pct(video.buffered.start(i)) + "%";
      el.style.width = Math.max(0.5, pct(video.buffered.end(i)) - pct(video.buffered.start(i))) + "%";
      buf.appendChild(el);
    }
  } catch {}
}, 500);

loadCats();
loadFeatured();
renderFavs();
