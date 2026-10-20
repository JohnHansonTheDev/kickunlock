/* ============================================================
   AUTHOR BADGE — small clickable "made by" pill (bottom-left)
   Edit the config block below to change avatar, link or text.
   Call window.createAuthorBadge({ ...overrides }) to remount.
   ============================================================ */

(function () {
  "use strict";

  const BADGE = {
    avatarUrl: "https://github.com/JohnHansonTheDev.png",
    linkUrl: "https://github.com/JohnHansonTheDev/kickunlock",
    title: "KickUnlock",
    subtitle: "made by JohnHansonTheDev",
    id: "ku-author-badge",
    tooltip: "KickUnlock on GitHub — made by JohnHansonTheDev",
    position: "bottom-left",
    accent: "#53fc18"
  };

  function createAuthorBadge(cfg) {
    const c = Object.assign({}, BADGE, cfg || {});
    const existing = document.getElementById(c.id);
    if (existing) return existing;

    const pos = {
      "top-left": "top:10px;left:10px;",
      "top-right": "top:10px;right:10px;",
      "bottom-left": "bottom:10px;left:10px;",
      "bottom-right": "bottom:10px;right:10px;"
    }[c.position] || "bottom:10px;left:10px;";

    const a = document.createElement("a");
    a.id = c.id;
    a.href = c.linkUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = c.tooltip;
    a.style.cssText =
      "position:fixed;" + pos +
      "z-index:999997;display:flex;align-items:center;gap:7px;" +
      "padding:4px 12px 4px 4px;background:rgba(15,15,15,.82);" +
      "border:1px solid " + c.accent + ";border-radius:22px;color:#eee;" +
      "font-family:inherit;text-decoration:none;" +
      "box-shadow:0 3px 12px rgba(0,0,0,.45);transition:transform .15s;";
    a.innerHTML =
      '<img src="' + c.avatarUrl + '" alt="" ' +
      'style="width:30px;height:30px;border-radius:50%;object-fit:cover;' +
      "background:#1c1c1c;border:1px solid " + c.accent + ";flex:0 0 auto;display:block;\">" +
      '<span style="font-size:11px;line-height:1.15;">' +
      '<b style="color:' + c.accent + ';">' + c.title + "</b><br>" +
      '<span style="color:#aaa;">' + c.subtitle + "</span></span>";

    document.body.appendChild(a);
    a.addEventListener("mouseenter", () => { a.style.transform = "scale(1.04)"; });
    a.addEventListener("mouseleave", () => { a.style.transform = "scale(1)"; });
    return a;
  }

  window.createAuthorBadge = createAuthorBadge;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => createAuthorBadge());
  } else {
    createAuthorBadge();
  }
})();
