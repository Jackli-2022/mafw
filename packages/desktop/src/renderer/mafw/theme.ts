// 主题状态契约：与 public/oc-theme-preload.js 读写同一 localStorage 键 mafw-theme。
// data-theme = 手动覆盖（light/dark），缺省移除 = 跟随系统（CSS 媒体查询块生效）；
// data-color-scheme 是上游 v2/session-ui 的主题门，始终与生效主题同步双写。
export type ThemeChoice = "light" | "dark" | null

export function readSavedTheme(storage: Pick<Storage, "getItem">): ThemeChoice {
  const v = storage.getItem("mafw-theme")
  return v === "light" || v === "dark" ? v : null
}

export function nextTheme(current: "light" | "dark"): "light" | "dark" {
  return current === "light" ? "dark" : "light"
}

export function applyTheme(root: HTMLElement, choice: ThemeChoice, systemLight: boolean): void {
  const effective = choice ?? (systemLight ? "light" : "dark")
  if (choice) root.dataset.theme = choice
  else root.removeAttribute("data-theme")
  root.dataset.colorScheme = effective
}
