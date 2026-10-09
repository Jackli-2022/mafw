import { createEffect, createSignal, onCleanup } from "solid-js"

/** Must mirror `--dur-surface` in mafw.css (CSS can't be read back at runtime). */
export const SURFACE_MS = 280

export type PresenceAction = "mount" | "hold" | "schedule-unmount"

/** Pure transition: what should happen when `open` moves from prevOpen to nextOpen? */
export function presenceStep(prevOpen: boolean, nextOpen: boolean, present: boolean): PresenceAction {
  if (nextOpen) return "mount"
  if (prevOpen && present) return "schedule-unmount"
  return "hold"
}

/**
 * Solid lifecycle for a collapsible surface: mount when open; on close keep
 * mounted for `exitMs` (so the CSS exit transition can run), then unmount.
 * Purely DOM lifecycle — animation is CSS.
 */
export function createPresence(open: () => boolean, exitMs: number = SURFACE_MS): () => boolean {
  const [present, setPresent] = createSignal(open())
  let timer: ReturnType<typeof setTimeout> | null = null
  let prevOpen = open()
  let initialized = false

  createEffect(() => {
    const nextOpen = open()
    if (!initialized) { initialized = true; prevOpen = nextOpen; return }
    const action = presenceStep(prevOpen, nextOpen, present())
    prevOpen = nextOpen
    if (action === "mount") {
      if (timer) { clearTimeout(timer); timer = null }
      setPresent(true)
    } else if (action === "schedule-unmount") {
      if (timer) { clearTimeout(timer); timer = null }
      timer = setTimeout(() => { timer = null; setPresent(false) }, exitMs)
    }
  })

  onCleanup(() => { if (timer) clearTimeout(timer) })
  return present
}
