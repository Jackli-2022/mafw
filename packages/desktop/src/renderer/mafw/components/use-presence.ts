import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/**
 * Presence helper for mount/unmount animation.
 *
 * The parent owns an `open` signal; this hook keeps the surface rendered for
 * `exitMs` after `open` goes false so the exit animation can play, and reports
 * `closing` while that frame is showing. Reopening during the exit window
 * cancels the timer and keeps the same DOM node.
 */
export interface PresenceTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface PresenceOptions {
  exitMs?: number
  timers?: PresenceTimers
}

const defaultTimers: PresenceTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function usePresence(open: Accessor<boolean>, options: PresenceOptions = {}) {
  const exitMs = options.exitMs ?? 140
  const timers = options.timers ?? defaultTimers
  const [rendered, setRendered] = createSignal(open())
  const [closing, setClosing] = createSignal(false)
  let handle: unknown = null

  const clear = () => {
    if (handle !== null) {
      timers.clearTimeout(handle)
      handle = null
    }
  }

  createEffect(() => {
    const isOpen = open()
    clear()
    if (isOpen) {
      setRendered(true)
      setClosing(false)
      return
    }
    if (!rendered()) return
    setClosing(true)
    handle = timers.setTimeout(() => {
      handle = null
      setRendered(false)
      setClosing(false)
    }, exitMs)
  })

  onCleanup(clear)

  return { rendered, closing }
}
