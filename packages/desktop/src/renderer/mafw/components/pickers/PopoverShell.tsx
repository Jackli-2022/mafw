import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { computePopoverPlacement, type PopoverAnchor } from "../../popover-placement"

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
  const [closing, setClosing] = createSignal(false)

  // Exit phase: when open flips false and the pop was shown, keep it mounted
  // for 120ms with the .closing class (fade+settle) before unmounting. pos is
  // retained during the phase so the pop holds its last position; nulling pos
  // here — instead of in the positioning effect below — is what defers unmount.
  createEffect(() => {
    if (props.open) { setClosing(false); return }
    if (!pos()) return
    setClosing(true)
    const t = setTimeout(() => { setClosing(false); setPos(null) }, 120)
    onCleanup(() => clearTimeout(t))
  })

  // Pure placement math — parameterized so it never touches reactive props.
  const compute = (t: HTMLElement | null, anchor: PopoverAnchor, width: number) => {
    if (!t) return
    const rect = t.getBoundingClientRect()
    const next = computePopoverPlacement({
      trigger: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      anchor,
      width,
      // 真实内容高度（CSS max-height 已限制）；展开子菜单后重新计算，
      // 避免 popover 从旧 top 往下长、底部被 max-height + overflow:hidden 裁掉。
      height: selfRef()?.offsetHeight || 0,
    })
    // Only update when the position actually changed: `setPos` always receives a
    // fresh object, so without this guard the rAF re-position loop (compute →
    // setPos → effect → rAF) spins at 60fps for the whole time the popover is
    // open, and anything creating computations inside it runs on a null Owner.
    const p = pos()
    if (!p || p.top !== next.top || p.left !== next.left || p.width !== next.width) setPos(next)
  }

  // Positioning: read all reactive props here (owner = this effect) and hand
  // plain snapshots to the owner-less resize/scroll callbacks.
  createEffect(() => {
    const t = props.trigger
    const a = props.anchor
    const w = props.width ?? 288
    if (!props.open) return
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

  // Content size changes (expanded Agent/Thinking submenus, async lists) must
  // re-anchor. `top` is fixed once placed, so a popover that grows downward
  // would overflow the viewport or be clipped by its own max-height.
  createEffect(() => {
    const t = props.trigger
    const a = props.anchor
    const w = props.width ?? 288
    if (!props.open) return
    const el = selfRef()
    if (!el) return
    const ro = new ResizeObserver(() => compute(t, a, w))
    ro.observe(el)
    onCleanup(() => ro.disconnect())
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
      <Show when={(props.open || closing()) && pos()}>
        {(p) => (
          <div
            ref={setSelfRef}
            data-pickpop=""
            class={`mafw-picker-pop ${closing() ? "closing" : ""} ${props.class || ""}`}
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
