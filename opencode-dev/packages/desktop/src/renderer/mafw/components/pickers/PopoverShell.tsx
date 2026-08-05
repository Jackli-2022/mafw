// @ts-nocheck
import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"

/**
 * Self-drawn popover shell for the ModelPicker / AgentPicker.
 * Rendered through a Portal into document.body so no ancestor container
 * (overflow/transform/filter) can clip or constrain it — it floats over the
 * whole desktop window. Anchors above the trigger (8px gap), right-edge (tr)
 * or left-edge (bl) aligned; flips below when there is no room above; clamps
 * to the viewport. Closes on outside click / Esc. 120ms appear animation.
 */
export function PopoverShell(props: {
  open: boolean
  trigger: HTMLElement | null
  anchor: "tr" | "bl" | "below-center"
  onClose: () => void
  children: JSX.Element
  class?: string
  width?: number
}) {
  const [pos, setPos] = createSignal<{ top: number; left: number; width: number } | null>(null)
  const [selfRef, setSelfRef] = createSignal<HTMLDivElement | null>(null)

  const compute = () => {
    const t = props.trigger
    if (!t || !props.open) return
    const rect = t.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 8
    // Clamp width to the viewport (8px margin, symmetric with the left clamp) so
    // fixed-width popovers (e.g. the 560px TaskList) never overflow narrow windows.
    const W = Math.min(props.width ?? selfRef()?.offsetWidth ?? 288, vw - 16)
    const h = Math.min(selfRef()?.offsetHeight || 320, 380)
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    let top: number
    let left: number
    if (props.anchor === "below-center") {
      // Below the trigger, centered; flip above when not enough room below.
      if (spaceBelow >= h) {
        top = rect.bottom + 2
      } else {
        top = Math.max(8, rect.top - GAP - h)
      }
      left = rect.left + rect.width / 2 - W / 2
    } else {
      // Three-state placement: fully above → fully below → clamp on the larger side.
      if (spaceAbove >= h) {
        top = rect.top - GAP - h
      } else if (spaceBelow >= h) {
        top = rect.bottom + GAP
      } else if (spaceAbove >= spaceBelow) {
        top = Math.max(8, rect.top - GAP - h)
      } else {
        top = Math.min(vh - 8 - h, rect.bottom + GAP)
      }
      left = props.anchor === "tr" ? rect.right - W : rect.left
    }
    if (left < 8) left = 8
    if (left + W > vw - 8) left = vw - 8 - W
    // Only update when the position actually changed: `setPos` always receives a
    // fresh object, so without this guard the rAF re-position loop (compute →
    // setPos → effect → rAF) spins at 60fps for the whole time the popover is
    // open, and anything creating computations inside it runs on a null Owner.
    const p = pos()
    if (!p || p.top !== top || p.left !== left || p.width !== W) setPos({ top, left, width: W })
  }

  createEffect(() => {
    if (!props.open) { setPos(null); return }
    compute()
    const onResize = () => compute()
    const onScroll = () => compute()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, true)
    })
  })

  // Re-position once the popover has actually rendered (content height known).
  createEffect(() => {
    if (props.open && pos()) {
      requestAnimationFrame(() => compute())
    }
  })

  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); props.onClose() }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const trig = props.trigger
      if (trig && trig.contains(t)) return
      const el = e.composedPath?.()?.find(n => n instanceof HTMLElement && n.dataset?.pickpop !== undefined)
      if (el) return
      props.onClose()
    }
    document.addEventListener("keydown", onKey, true)
    document.addEventListener("mousedown", onDown)
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("mousedown", onDown)
    })
  })

  return (
    <Portal>
      <Show when={props.open && pos()}>
        {(p) => (
          <div
            ref={setSelfRef}
            data-pickpop=""
            class={`mafw-picker-pop ${props.class || ""}`}
            style={{ top: `${p().top}px`, left: `${p().left}px`, width: `${p().width}px` }}
          >
            {props.children}
          </div>
        )}
      </Show>
    </Portal>
  )
}
