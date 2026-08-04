// @ts-nocheck
import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import type { JSX } from "solid-js"

/**
 * Self-drawn popover shell for the ModelPicker / AgentPicker.
 * Anchors above the trigger (8px gap), right-edge (tr) or left-edge (bl)
 * aligned; flips below when there is no room above; clamps to the viewport.
 * Closes on outside click / Esc. 120ms appear animation.
 */
export function PopoverShell(props: {
  open: boolean
  trigger: HTMLElement | null
  anchor: "tr" | "bl"
  onClose: () => void
  children: JSX.Element
  class?: string
}) {
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null)
  const [selfRef, setSelfRef] = createSignal<HTMLDivElement | null>(null)

  const compute = () => {
    const t = props.trigger
    if (!t || !props.open) return
    const rect = t.getBoundingClientRect()
    const W = 288
    const GAP = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Use the rendered popover height (fallback estimate before first paint).
    const h = selfRef()?.offsetHeight || 320
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    // Only pop above when the popover fully fits; otherwise flip below.
    let top: number
    if (spaceAbove >= Math.min(h, spaceBelow)) {
      top = rect.top - GAP - (h - Math.min(h, spaceAbove))
    } else {
      top = rect.bottom + GAP
    }
    // Right-edge aligned (tr) or left-edge aligned (bl); clamp right overflow.
    let left = props.anchor === "tr" ? rect.right - W : rect.left
    if (left < 8) left = 8
    if (left + W > vw - 8) left = vw - 8 - W
    setPos({ top, left })
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
    <Show when={props.open && pos()}>
      {(p) => (
        <div
          ref={setSelfRef}
          data-pickpop=""
          class={`mafw-picker-pop ${props.class || ""}`}
          style={{ top: `${p().top}px`, left: `${p().left}px` }}
        >
          {props.children}
        </div>
      )}
    </Show>
  )
}
