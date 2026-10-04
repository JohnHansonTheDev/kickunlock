import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";
const KICK_REFERER = "https://kick.com/";
const CLIPS_DIR = path.join(__dirname, "clips");
fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Kick's directory endpoints reject plain Node TLS fingerprints (403), so all
// kick API calls go through the vendored curl-impersonate (real Chrome
// handshake). Single 4MB exe in bin/, no install needed.
const CI_EXE = path.join(__dirname, "bin", "curl-impersonate.exe");
function ciGet(url, accept = "application/json") {
  return new Promise((resolve, reject) => {
    const p = spawn(CI_EXE, ["--impersonate", "chrome136", "--compressed", "-s",
      "-A", UA, "-H", `Accept: ${accept}`, "-H", `Referer: ${KICK_REFERER}`, url],
      { windowsHide: true });
    const chunks = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => { err += d; });
    const kill = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("kick api timeout")); }, 30000);
    p.on("error", (e) => { clearTimeout(kill); reject(e); });
    p.on("close", (code) => {
      clearTimeout(kill);
      if (code !== 0) reject(new Error(`kick api exit ${code}: ${String(err).slice(-200)}`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/clips", express.static(CLIPS_DIR));
app.use((req, _, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

async function kickApi(p) {
  return JSON.parse(await ciGet("https://kick.com" + p));
}
async function webKickApi(p) {
  // web.kick.com serves the directory endpoints (featured etc.)
  return JSON.parse(await ciGet("https://web.kick.com" + p));
}

const normStream = (s) => ({
  slug: s.channel?.slug || s.slug,
  username: s.channel?.username || s.channel?.slug,
  title: s.session_title || s.title || "",
  category: s.category?.name || "",
  categorySlug: s.category?.slug || "",
  viewers: s.viewer_count ?? s.viewers ?? 0,
  thumb: s.thumbnail?.src || "",
  avatar: s.channel?.profile_pic || "",
  mature: !!s.is_mature,
  started: s.start_time || null,
});

// ---------- BROWSE ----------
app.get("/api/health", (_, res) => res.json({ ok: true, app: "kickunlock" }));

app.get("/api/featured", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "24", 10) || 24, 100);
    const data = await webKickApi(`/api/v1/livestreams/featured?language=en&limit=${limit}`);
    const list = (data.data?.livestreams || []).map(normStream);
    console.log(`[BROWSE] featured: ${list.length}`);
    res.json({ count: list.length, streams: list });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/categories", async (_, res) => {
  try {
    const data = await kickApi("/api/v1/categories/top?limit=24");
    const list = (Array.isArray(data) ? data : []).map((c) => ({
      name: c.name,
      slug: c.slug,
      viewers: c.viewers || 0,
      banner: c.banner?.src || "",
    }));
    res.json({ count: list.length, categories: list });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- WATCH: one channel -> live meta + direct HLS ----------
app.get("/api/watch/:slug", async (req, res) => {
  const slug = (req.params.slug || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!slug) return res.status(400).json({ error: "bad channel slug" });
  try {
    const [meta, pb] = await Promise.all([
      kickApi(`/api/v2/channels/${slug}/livestream`).catch(() => null),
      kickApi(`/api/v2/channels/${slug}/playback-url`).catch(() => null),
    ]);
    const live = meta?.data;
    if (!live) {
      return res.json({ live: false, slug, note: "offline (or channel does not exist)" });
    }
    const direct = pb?.data || null;
    if (!direct) return res.json({ live: true, playable: false, slug, note: "live but no playback URL" });
    console.log(`[WATCH] ${slug} live, ${live.viewer_count ?? "?"} viewers`);
    res.json({
      live: true,
      playable: true,
      slug,
      title: live.session_title || "",
      category: live.category?.name || "",
      viewers: live.viewer_count ?? 0,
      thumb: live.thumbnail?.src || "",
      started: live.start_time || null,
      mature: !!live.is_mature,
      direct,
      referer: KICK_REFERER,
      proxied: `/api/hls?url=${encodeURIComponent(direct)}&referer=${encodeURIComponent(KICK_REFERER)}`,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- HLS PROXY (correct Referer, CORS-safe, ad-free) ----------
async function fetchUpstream(url, referer) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", Referer: referer || KICK_REFERER },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r;
}
app.get("/api/hls", async (req, res) => {
  try {
    const target = (req.query.url || "").toString();
    const referer = (req.query.referer || "").toString() || KICK_REFERER;
    if (!target || !/^https?:\/\//i.test(target)) return res.status(400).send("missing ?url=");
    const upstream = await fetchUpstream(target, referer);
    const ct = upstream.headers.get("content-type") || "";
    const body = Buffer.from(await upstream.arrayBuffer());
    if (target.includes(".m3u8") || ct.includes("mpegurl") || body.toString("utf8", 0, 7).includes("#EXTM3U")) {
      let text = body.toString("utf8");
      const base = target.slice(0, target.lastIndexOf("/") + 1);
      text = text.replace(/^(?!#)(\S+.*)$/gm, (line) => {
        line = line.trim();
        if (!line || line.startsWith("#")) return line;
        return `/api/hls?url=${encodeURIComponent(new URL(line, base).toString())}&referer=${encodeURIComponent(referer)}`;
      });
      text = text.replace(/URI="([^"]+)"/g, (_, uri) => {
        return `URI="/api/hls?url=${encodeURIComponent(new URL(uri, base).toString())}&referer=${encodeURIComponent(referer)}"`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(text);
    }
    res.setHeader("Content-Type", ct || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(body);
  } catch (e) {
    res.status(502).send("hls proxy error: " + String(e.message || e));
  }
});

// ---------- CLIPS: record N seconds of live edge -> .ts (VLC plays it) ----------
function pickVariant(text, base) {
  // master playlists list quality variants via #EXT-X-STREAM-INF — take max bandwidth
  if (!/#EXT-X-STREAM-INF/i.test(text)) return null;
  let best = null, bw = -1, pending = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/#EXT-X-STREAM-INF[^B]*BANDWIDTH=(\d+)/i);
    if (m) pending = parseInt(m[1], 10);
    else if (line && !line.startsWith("#") && pending > 0) {
      if (pending > bw) { bw = pending; best = new URL(line, base).toString(); }
      pending = 0;
    }
  }
  return best;
}
function parseSegments(text, base) {
  const segs = [];
  let dur = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) dur = parseFloat(line.slice(8)) || 0;
    else if (line && !line.startsWith("#")) { segs.push({ url: new URL(line, base).toString(), dur }); dur = 0; }
  }
  return segs;
}
app.post("/api/clip", async (req, res) => {
  try {
    const upstream = (req.body?.upstream || "").toString();
    const referer = (req.body?.referer || "").toString() || KICK_REFERER;
    let seconds = parseInt(req.body?.seconds || "30", 10);
    if (!/^https?:\/\//i.test(upstream)) return res.status(400).json({ error: "bad upstream URL" });
    if (!Number.isFinite(seconds)) seconds = 30;
    seconds = Math.max(5, Math.min(300, seconds));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    console.log(`[CLIP] ${seconds}s <- ${upstream.slice(0, 80)}`);
    const seen = new Set();
    const bufs = [];
    let got = 0;
    const deadline = Date.now() + (seconds + 120) * 1000;
    while (got < seconds && Date.now() < deadline) {
      const r = await fetchUpstream(upstream, referer);
      let plist = await r.text();
      const vbase = upstream.slice(0, upstream.lastIndexOf("/") + 1);
      const variant = pickVariant(plist, vbase); // master -> best media playlist
      if (variant) {
        const vr = await fetchUpstream(variant, referer);
        plist = await vr.text();
      }
      const base = (variant || upstream).slice(0, (variant || upstream).lastIndexOf("/") + 1);
      const fresh = parseSegments(plist, base).filter((s) => !seen.has(s.url));
      if (!fresh.length) { await new Promise((x) => setTimeout(x, 2000)); continue; }
      for (const s of fresh) {
        if (got >= seconds) break;
        seen.add(s.url);
        const sr = await fetchUpstream(s.url, referer);
        const b = Buffer.from(await sr.arrayBuffer());
        if (b.length < 188) continue;
        bufs.push(b);
        got += s.dur || 4;
      }
      if (got < seconds) await new Promise((x) => setTimeout(x, 1500));
    }
    if (!bufs.length) throw new Error("no segments (stream offline?)");
    const file = `clip-${stamp}-${seconds}s.ts`;
    fs.writeFileSync(path.join(CLIPS_DIR, file), Buffer.concat(bufs));
    const st = fs.statSync(path.join(CLIPS_DIR, file));
    console.log(`[CLIP] OK: ${file} (${(st.size / 1048576).toFixed(1)} MB)`);
    res.json({ file, url: `/clips/${file}`, bytes: st.size });
  } catch (e) {
    console.log(`[CLIP] fail: ${e.message}`);
    res.status(500).json({ error: String(e.message || e) });
  }
});
app.get("/api/clips", (_, res) => {
  try {
    const files = fs.readdirSync(CLIPS_DIR)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".mp4"))
      .map((f) => {
        const st = fs.statSync(path.join(CLIPS_DIR, f));
        return { file: f, url: `/clips/${f}`, bytes: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ clips: files });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`KickUnlock on http://localhost:${PORT}`));
