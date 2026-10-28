export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu"
}
