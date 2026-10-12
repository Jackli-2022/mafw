;(function () {
  // 与 MafwShell 同源：读 mafw-theme（light/dark/缺省=跟随系统）。
  // 无保存值时删除 data-theme，让 mafw.css 的跟随系统媒体查询从首帧生效
  //（旧实现无条件写 oc-2，使 html:not([data-theme]) 亮色块死代码化 → 亮 OS 首帧闪暗）。
  var saved = localStorage.getItem("mafw-theme")
  var root = document.documentElement
  var isDark
  if (saved === "light" || saved === "dark") {
    root.dataset.theme = saved
    isDark = saved === "dark"
  } else {
    root.removeAttribute("data-theme")
    isDark = !matchMedia("(prefers-color-scheme: light)").matches
  }
  var mode = isDark ? "dark" : "light"
  root.dataset.colorScheme = mode
  root.style.backgroundColor = isDark ? "#100F0E" : "#FAF9F5"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#100F0E" : "#FAF9F5")
})()
