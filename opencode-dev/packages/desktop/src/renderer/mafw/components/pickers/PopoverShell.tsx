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

  const compute = () => {
    const t = props.trigger
    if (!t || !props.open) return
    const rect = t.getBoundingClientRect()
    const W = 288
    const GAP = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Prefer above; flip below if not enough room (leave 8px margin).
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    let top: number
    if (spaceAbove >= 120 || spaceAbove >= spaceBelow) {
      top = rect.top - GAP
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
