// @ts-nocheck
import { createMemo, createSignal, createEffect, Show, For } from "solid-js"
import { PopoverShell } from "./PopoverShell"

export type CommandItem = {
  id: string
  trigger: string          // "/name"
  title: string
  description?: string
  group: "local" | "mafw" | "custom"
  source?: "skill" | "mcp" | "command" | "builtin"
  run?: () => void         // local commands execute immediately
}

const SOURCE_BADGE: Record<string, string> = {
  skill: "Skill",
  mcp: "MCP",
  command: "Cmd",
  builtin: "Local",
}

export function CommandPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  items: CommandItem[]
  query?: string
  onSelect: (item: CommandItem) => void
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(0)
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    if (props.open) { setQuery(""); setHi(0) }
  })

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return props.items
    return props.items.filter(i =>
      i.trigger.toLowerCase().includes(q) || i.title.toLowerCase().includes(q) ||
      (i.description || "").toLowerCase().includes(q))
  })

  const groups = createMemo(() => {
    const order: Record<string, number> = { local: 0, mafw: 1, custom: 2 }
    const gs: { label: string; items: CommandItem[] }[] = []
    const sorted = [...filtered()].sort((a, b) => (order[a.group] ?? 9) - (order[b.group] ?? 9))
    for (const it of sorted) {
      const label = it.group === "local" ? "本地操作" : it.group === "mafw" ? "MAFW 命令" : "命令与技能"
      const g = gs.find(x => x.label === label)
      if (g) g.items.push(it)
      else gs.push({ label, items: [it] })
    }
    return gs
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, filtered().length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); const it = filtered()[hi()]; if (it) props.onSelect(it) }
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="below-center" width={380} onClose={props.onClose}>
      {/* Search */}
      <div class="mafw-picker-search">
        <span class="mafw-picker-search-icon">/</span>
        <input
          class="mafw-picker-search-input"
          placeholder="搜索命令 / 技能 / 操作…"
          value={query()}
          onInput={e => { setQuery(e.currentTarget.value); setHi(0) }}
          onKeyDown={onKey}
          autofocus
        />
      </div>
      <div class="mafw-picker-list" ref={listRef}>
        <For each={groups()}>
          {(g) => (
            <>
              <div class="mafw-picker-group-label">{g.label}</div>
              <For each={g.items}>
                {(it, i) => <CommandRow it={it} hi={hi() === i()} onClick={() => props.onSelect(it)} />}
              </For>
            </>
          )}
        </For>
        <Show when={filtered().length === 0}>
          <div class="mafw-picker-empty">无匹配命令</div>
        </Show>
      </div>
      <div class="mafw-picker-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </PopoverShell>
  )
}

function CommandRow(props: { it: CommandItem; hi: boolean; onClick: () => void }) {
  return (
    <div class="mafw-picker-row" classList={{ hi: props.hi }} onClick={props.onClick}>
      <span class="mafw-picker-row-name">
        <span class="mafw-picker-row-title">{props.it.trigger}</span>
        <Show when={props.it.description}>
          <span class="mafw-picker-row-id">{props.it.description}</span>
        </Show>
      </span>
      <span class="mafw-picker-row-meta">
        <Show when={props.it.source && SOURCE_BADGE[props.it.source!]}>
          <span class="mafw-command-badge">{SOURCE_BADGE[props.it.source!]}</span>
        </Show>
      </span>
    </div>
  )
}
