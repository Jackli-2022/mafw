import { isMenuKey } from "./keyboard"

/** Bridges Shift+F10 / ContextMenu on a focused element to its existing onContextMenu handler. */
export function openMenuOnKey(event: KeyboardEvent): void {
  if (!isMenuKey(event)) return
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  event.preventDefault()
  const rect = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 12,
      clientY: Math.min(rect.bottom, window.innerHeight - 8),
    }),
  )
}
