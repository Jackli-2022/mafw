// 批注快捷键判定（M10）：macOS 的 Cmd+M 是系统/应用「最小化」，只认 Ctrl+M。
export function isAnnotationHotkey(
  e: { ctrlKey: boolean; metaKey: boolean; code: string },
  isMac: boolean,
): boolean {
  if (e.code !== "KeyM") return false
  return isMac ? e.ctrlKey : e.ctrlKey || e.metaKey
}
