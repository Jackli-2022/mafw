// @ts-nocheck
import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"

/**
 * Self-drawn popover shell for the ModelPicker / AgentPicker / TaskList.
 * Rendered through a Portal into document.body so no ancestor container
 * (overflow/transform/filter) can clip or constrain it — it floats over the
 * whole desktop window. Anchors above the trigger (8px gap), right-edge (tr)
 * or left-edge (bl) aligned; flips below when there is no room above; clamps
 * to the viewport. Closes on outside click / Esc. 120ms appear animation.
 *
 * IMPORTANT: owner-less callbacks (rAF / scroll / resize / DOM events) must
 * never read reactive `props` getters — SolidJS materializes dynamic props as
 * lazily-created memos, and creating one with a null Owner emits
 * "computations created outside a createRoot" and leaks it. All reactive
 * reads happen inside effects; callbacks receive plain snapshots instead.
 */
export function PopoverShell(props: {
  open: boolean
  trigger: HTMLElement | null
  anchor: "tr" | "bl" | "below-center"
  onClose: () => void
  onHoverEnter?: () => void
  onHoverExit?: () => void
  children: JSX.Element
  class?: string
  width?: number
}) {
  const [pos, setPos] = createSignal<{ top: number; left: number; width: number } | null>(null)
  const [selfRef, setSelfRef] = createSignal<HTMLDivElement | null>(null)

  // Pure placement math — parameterized so it never touches reactive props.
  const compute = (t: HTMLElement | null, anchor: string, width: number) => {
    if (!t) return
    const rect = t.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 8
    // Clamp width to the viewport (8px margin, symmetric with the left clamp) so
    // fixed-width popovers (e.g. the 560px TaskList) never overflow narrow windows.
    const W = Math.min(width, vw - 16)
    const h = Math.min(selfRef()?.offsetHeight || 320, 380)
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    let top: number
    let left: number
    if (anchor === "below-center") {
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
      left = anchor === "tr" ? rect.right - W : rect.left
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

  // Positioning: read all reactive props here (owner = this effect) and hand
  // plain snapshots to the owner-less resize/scroll callbacks.
  createEffect(() => {
    const t = props.trigger
    const a = props.anchor
    const w = props.width ?? 288
    if (!props.open) { setPos(null); return }
    if (!t) return
    compute(t, a, w)
    const onResize = () => compute(t, a, w)
    const onScroll = () => compute(t, a, w)
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, true)
    })
  })

  // Re-position once after the popover has rendered (content height known).
  createEffect(() => {
    const t = props.trigger
    const a = props.anchor
    const w = props.width ?? 288
    if (props.open && pos()) {
      requestAnimationFrame(() => compute(t, a, w))
    }
  })

  // Outside click / Esc close. `close` is snapshotted — DOM event callbacks
  // run with a null Owner, where reading the props getter would allocate.
  createEffect(() => {
    const t = props.trigger
    const close = props.onClose
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close() }
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (t && t.contains(target)) return
      const el = e.composedPath?.()?.find(n => n instanceof HTMLElement && n.dataset?.pickpop !== undefined)
      if (el) return
      close()
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
            onMouseEnter={props.onHoverEnter}
            onMouseLeave={props.onHoverExit}
          >
            {props.children}
          </div>
        )}
      </Show>
    </Portal>
  )
}
