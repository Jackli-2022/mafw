// G2 网页元素点选：注入脚本（悬停高亮 + 点击捕获元素信息）。
// 脚本在 webview 页面上下文运行；返回 Promise，点击 resolve(payload) / Esc resolve(null)。
export type ElementPickPayload = {
  tag?: string
  selector?: string
  text?: string
  rect?: { x: number; y: number; width: number; height: number }
  outerHTML?: string
  attrs?: Record<string, string>
}

/** 生成自包含注入脚本（executeJavaScript 一次一 pick）。 */
export function buildPickScript(): string {
  return `(function () {
  var HL = "mafw-pick-highlight";
  var STYLE_ID = "mafw-pick-style";
  if (!document.getElementById(STYLE_ID)) {
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = "." + HL + "{outline:2px solid #4FD388 !important;outline-offset:1px !important;cursor:crosshair !important;}";
    (document.head || document.documentElement).appendChild(st);
  }
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      var tag = cur.tagName.toLowerCase();
      var cls = (cur.className && typeof cur.className === "string") ? cur.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
      var part = tag + (cls ? "." + cls : "");
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";
      }
      parts.unshift(part);
      cur = parent;
      depth++;
    }
    return parts.join(" > ");
  }
  function textOf(el) {
    var t = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    return t.length > 200 ? t.slice(0, 200) + "\\u2026" : t;
  }
  function attrsOf(el) {
    var out = {};
    ["href", "value", "src", "title", "placeholder", "aria-label", "name", "type"].forEach(function (k) {
      var v = el.getAttribute && el.getAttribute(k);
      if (v) out[k] = v.length > 120 ? v.slice(0, 120) + "\\u2026" : v;
    });
    return out;
  }
  function infoOf(el) {
    var r = el.getBoundingClientRect();
    var html = (el.outerHTML || "").replace(/\\s+/g, " ").trim();
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      selector: selectorOf(el),
      text: textOf(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      outerHTML: html.length > 500 ? html.slice(0, 500) + "\\u2026" : html,
      attrs: attrsOf(el)
    };
  }
  var last = null;
  var resolve = null;
  function clear() {
    if (last) { try { last.classList.remove(HL); } catch (e) {} last = null; }
  }
  function cleanup() {
    clear();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onMove(e) {
    var el = e.target;
    if (!el || el === last || el.nodeType !== 1) return;
    clear();
    last = el;
    try { el.classList.add(HL); } catch (err) {}
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var payload = infoOf(e.target);
    cleanup();
    if (resolve) resolve(payload);
  }
  function onKey(e) {
    if (e.key === "Escape") { cleanup(); if (resolve) resolve(null); }
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  return new Promise(function (res) { resolve = res; });
})()`
}
