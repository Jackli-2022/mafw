// @ts-nocheck
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { searchTurns, type SearchableTurn } from "./transcript-search"

// In-session transcript search: filter-as-you-type over visible turns,
// ↑/↓ to select, Enter jumps to the turn anchor (data-turn-id).
export function TranscriptSearchOverlay(props: {
  open: boolean
  turns: () => SearchableTurn[]
  container: () => HTMLDivElement | null
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(0)

  const hits = createMemo(() => searchTurns(props.turns(), query()))

  const jump = (id: string) => {
    const el = props.container()
    const anchor = el?.querySelector(`[data-turn-id="${id}"]`) as HTMLElement | null
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.key === "Escape") { e.preventDefault(); props.onClose() }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, hits().length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
      else if (e.key === "Enter") {
        e.preventDefault()
        const hit = hits()[hi()]
        if (hit) jump(hit.id)
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={props.open}>
      <div class="mafw-tsearch">
        <TextInputV2
          value={query()}
          placeholder="搜索会话内容…（Enter 跳转 · Esc 关闭）"
          onInput={e => { setQuery(e.currentTarget.value); setHi(0) }}
        />
        <span class="mafw-tsearch-count">{hits().length ? `${hits().length} 处` : "无匹配"}</span>
        <Show when={query()}>
          <div class="mafw-tsearch-hits">
            <For each={hits()}>
              {(h, i) => (
                <div class="mafw-tsearch-hit" classList={{ sel: i() === hi() }} onClick={() => { setHi(i()); jump(h.id) }}>
                  <span class="mafw-tsearch-role">{h.role === "user" ? "你" : "AI"}</span>
                  <span class="mafw-tsearch-snippet">{h.snippet}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
