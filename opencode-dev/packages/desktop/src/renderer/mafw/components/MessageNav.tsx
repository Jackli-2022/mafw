// @ts-nocheck
// DeepSeek-style user-turn node navigation: a vertical rail of dashes on the
// right edge of the chat container, one dash per user input; click = smooth
// scroll to that turn; the turn nearest the viewport top is highlighted.
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"

type Turn = { id: string; text: string }

export function MessageNav(props: { container: () => HTMLDivElement | null; turns: () => Turn[] }) {
  const [active, setActive] = createSignal(0)

  const recompute = () => {
    const el = props.container()
    if (!el) return
    const turns = props.turns()
    if (turns.length === 0) return
    const threshold = el.scrollTop + 96
    let idx = 0
    for (let i = 0; i < turns.length; i++) {
      const anchor = el.querySelector(`[data-turn-id="${turns[i].id}"]`) as HTMLElement | null
      if (!anchor) continue
      if (anchor.offsetTop <= threshold) idx = i
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) idx = turns.length - 1
    setActive(idx)
  }

  createEffect(() => {
    const el = props.container()
    if (!el) return
    props.turns()
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
    <Show when={props.turns().length >= 2}>
      <div class="mafw-msgnav">
        <For each={props.turns()}>
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
