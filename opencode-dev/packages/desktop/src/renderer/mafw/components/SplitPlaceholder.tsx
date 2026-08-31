// @ts-nocheck
import { createMemo, createSignal, Show, For } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

/**
 * Chat placeholder pane. Rendered in a `{ empty: true }` split leaf: it takes
 * the same pane footprint as a real chat view (title bar + body) but its body
 * is a session picker — pick an existing session or create a new one to fill
 * the pane (Windows-snap style).
 */
export function SplitPlaceholder(props: {
  openSessions: { id: string; title?: string }[]
  historySessions: { id: string; title?: string; time?: { updated?: number } }[]
  canClosePane: boolean
  onSelect: (sid: string) => void
  onCreate: () => void
  onClose?: () => void
}) {
  const [q, setQ] = createSignal("")

  const list = createMemo(() => {
    const seen = new Set<string>()
    const merged: { id: string; title: string; isOpen: boolean }[] = []
    for (const s of props.openSessions) {
      if (!s?.id || seen.has(s.id)) continue
      seen.add(s.id)
      merged.push({ id: s.id, title: s.title || s.id, isOpen: true })
    }
    for (const s of props.historySessions) {
      if (!s?.id || seen.has(s.id)) continue
      seen.add(s.id)
      merged.push({ id: s.id, title: s.title || s.id, isOpen: false })
    }
    const needle = q().trim().toLowerCase()
    const filtered = needle
      ? merged.filter(s => s.title.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle))
      : merged
    return filtered.slice(0, 30)
  })

  return (
    <div class="mafw-placeholder-pane" onClick={e => e.stopPropagation()}>
      <div class="mafw-session-titlebar">
        <div class="mafw-session-titlebar-inner">
          <span class="mafw-agent-avatar">＋</span>
          <span class="mafw-session-titlebar-text">选择会话</span>
          <span style={{ flex: 1 }} />
          <Show keyed when={props.canClosePane && props.onClose}>
            <TooltipV2 value="关闭分屏" openDelay={300}>
              <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); props.onClose!() }} aria-label="关闭分屏">✕</ButtonV2>
            </TooltipV2>
          </Show>
        </div>
      </div>
      <div class="mafw-split-placeholder-body">
        <div class="mafw-split-placeholder-title">选择会话填充此分屏</div>
        <TextInputV2
          value={q()}
          onInput={v => setQ(v)}
          placeholder="搜索会话…"
          class="mafw-split-placeholder-search"
        />
        <div class="mafw-split-placeholder-list">
          <For each={list()}>
            {(s) => (
              <ButtonV2 variant="ghost" size="small" class="mafw-split-placeholder-item" onClick={() => props.onSelect(s.id)}>
                <span class={`mafw-agent-dot${s.isOpen ? "" : " mafw-split-placeholder-dot-closed"}`} />
                <span class="mafw-split-placeholder-item-title">{s.title}</span>
                {!s.isOpen && <span class="mafw-split-placeholder-item-tag">历史</span>}
              </ButtonV2>
            )}
          </For>
          <Show when={list().length === 0}>
            <div class="mafw-split-placeholder-empty">无匹配会话</div>
          </Show>
        </div>
        <ButtonV2 variant="contrast" size="small" class="mafw-split-placeholder-new" onClick={props.onCreate}>
          ＋ 新建会话
        </ButtonV2>
      </div>
    </div>
  )
}
