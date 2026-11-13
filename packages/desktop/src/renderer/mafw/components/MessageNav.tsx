// DeepSeek-style user-turn node navigation: a vertical rail of dashes on the
// right edge of the chat container, one dash per user input; click = smooth
// scroll to that turn; the turn nearest the viewport top is highlighted.
import { createSignal, createEffect, createMemo, For, Show, onCleanup } from "solid-js"
import { normalizeMessageNavTurns, type MessageNavTurn } from "./message-nav-model"

export function MessageNav(props: { container: () => HTMLDivElement | null; turns: () => MessageNavTurn[] }) {
  const [active, setActive] = createSignal(0)
  const turns = createMemo(() => normalizeMessageNavTurns(props.turns()))

  const recompute = () => {
    const el = props.container()
    if (!el) return
    const list = turns()
    if (list.length === 0) return
    const threshold = el.scrollTop + 96
    let idx = 0
    for (let i = 0; i < list.length; i++) {
      const anchor = el.querySelector(`[data-turn-id="${list[i].id}"]`) as HTMLElement | null
      if (!anchor) continue
      if (anchor.offsetTop <= threshold) idx = i
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) idx = list.length - 1
    setActive(idx)
  }

  createEffect(() => {
    const el = props.container()
    if (!el) return
    turns()
    recompute()
    el.addEventListener("scroll", recompute, { passive: true })
    onCleanup(() => el.removeEventListener("scroll", recompute))
  })

  const jump = (id: string) => {
    const el = props.container()
    if (!el) return
    const anchor = el.querySelector(`[data-turn-id="${id}"]`) as HTMLElement | null
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <Show when={turns().length >= 2}>
      <div class="mafw-msgnav">
        <For each={turns()}>
          {(t, i) => (
            <div class="mafw-msgnav-node" classList={{ active: i() === active() }} onClick={() => jump(t.id)}>
              <span class="mafw-msgnav-tip">{t.text || "New conversation"}</span>
              <span class="mafw-msgnav-dash" />
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
