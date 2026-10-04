# 🔓 KickUnlock `v1.0.0-alpha`

**Watch ANY Kick channel unlocked. No login. No ads. No limits.**

KickUnlock turns any public Kick livestream into a clean, direct video feed —
then hands you a broadcast desk: a 6-way wall, one-key clipping, and a
frame-accurate trim studio. Built for viewers who hate friction and clippers
who live on speed.

## 👀 For viewers

- **Any channel, instantly** — paste `kick.com/anything` or browse the live
  directory (thumbnails, viewer counts, categories, search, favorites ★).
- **Truly ad-free** — plays the raw HLS feed directly. No embeds, no pop-ups,
  no chat spam, no tracking pixels.
- **🧱 The Wall** — watch up to 6 channels side by side (1 / 2 / 3 / 2×2 / 3-col
  auto-layout). One click mutes all; unmute just the one you want.
- **Player keys** — hold `Z` to rewind, hold `X` for 2× fast-forward
  (remappable, with on-screen readout + live timestamp badge).
- **Hover previews** — scrub the timeline strip and see a thumbnail of that
  exact moment before you jump.

## ✂️ For clippers

- **One-click record** — `✂ Record` saves 10/30/60/120s of the live edge
  straight to `.ts` (VLC-ready), per channel — including every Wall tile.
- **Trim studio (overlay)** — pause, drag orange start/end cursors on the
  timeline, **loop the selection** to check the cut, then **export to `.webm`**
  with correct duration metadata. Works on the main player AND on wall tiles.
- **Zero re-encoding** — server-side capture is a byte-exact stream copy, so
  clips are pixel-identical to the broadcast and export in seconds, not minutes.

## 🚀 Run it (2 minutes, Windows)

No installs. No admin. The folder ships its own portable Node — just:

1. Extract the folder anywhere.
2. Double-click **`start-kickunlock.bat`**.
3. Your browser opens at `http://localhost:3001`. Done.

Prefer your own Node? `npm install` then `node server.js` (Node 20+).

## 🛠️ How it works

- **Browse** — Kick's own directory API (featured, categories, per-channel
  status) via a real Chrome TLS fingerprint (`curl-impersonate`, vendored in
  `bin/`), so directory endpoints don't get WAF-blocked.
- **Playback** — per-channel signed HLS resolved fresh on every tune, proxied
  locally (`/api/hls`) with correct referers: CORS-safe, cookie-free, ad-free.
- **Clips** — the server re-reads the live playlist and stitches segments
  itself (variant-aware: picks the best bitrate from master playlists).
- **Stack** — Node + Express, hls.js, vanilla JS. No build step, no framework,
  no telemetry, nothing leaves your machine except Kick's own API/CDN traffic.

## ⚠️ Honest limits

- Public streams only — subscriber-only / private content is out of reach.
- No DRM to break and none needed: Kick's public HLS is unencrypted.
- Your network is your network: region-locked streams need a VPN on your end;
  this app doesn't (and can't) change your location.
- Live edge only for recording — you can't clip what already aired unless the
  replay/VOD is up.

## 📜 License

MIT — do what you want, clips included.
