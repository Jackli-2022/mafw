// @ts-nocheck
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"

export type PaletteItem = {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}

// Global command palette (Ctrl+P): app-level navigation and actions. The
// in-chat slash commands stay in the composer; this palette covers shell
// navigation (tabs, settings, window management) that has no composer focus.
export function CommandPalette(props: {
  open: boolean
  items: PaletteItem[]
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(0)

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return props.items
    return props.items.filter(i =>
      i.label.toLowerCase().includes(q) || (i.hint || "").toLowerCase().includes(q))
  })

  const groups = createMemo(() => {
    const gs: { label: string; items: PaletteItem[] }[] = []
    for (const it of filtered()) {
      const g = gs.find(x => x.label === it.group)
      if (g) g.items.push(it)
      else gs.push({ label: it.group, items: [it] })
    }
    return gs
  })

  const flat = createMemo(() => groups().flatMap(g => g.items))

  const activate = (item: PaletteItem) => {
    props.onClose()
    item.run()
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.key === "Escape") { e.preventDefault(); props.onClose() }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, flat().length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
      else if (e.key === "Enter") { e.preventDefault(); const it = flat()[hi()]; if (it) activate(it) }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={props.open}>
      <div class="mafw-palette-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-palette">
          <TextInputV2
            value={query()}
            placeholder="输入命令…（↑↓ 选择 · Enter 执行 · Esc 关闭）"
            onInput={e => { setQuery(e.currentTarget.value); setHi(0) }}
            autofocus
          />
          <div class="mafw-palette-list">
            <For each={groups()}>
              {(g) => (
                <>
                  <div class="mafw-palette-group">{g.label}</div>
                  <For each={g.items}>
                    {(item) => {
                      const idx = flat().indexOf(item)
                      return (
                        <div class="mafw-palette-row" classList={{ sel: idx === hi() }} onClick={() => activate(item)}>
                          <span class="mafw-palette-label">{item.label}</span>
                          <Show when={item.hint}><span class="mafw-palette-hint">{item.hint}</span></Show>
                        </div>
                      )
                    }}
                  </For>
                </>
              )}
            </For>
            <Show when={flat().length === 0}>
              <div class="mafw-picker-empty">无匹配命令</div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
