// @ts-nocheck
import { createMemo, createSignal, createEffect, Show, For, onMount } from "solid-js"
import { PopoverShell } from "./PopoverShell"

export type ModelEntry = {
  id: string
  name: string
  providerID: string
  provider: string
  contextK?: number
  vision?: boolean
  thinking?: boolean
}

const RECENT_KEY = "mafw-recent-models"

// Composite identity: same model id under different providers is a different
// model (e.g. deepseek-v4-pro under deepseek vs opencode-go).
const key = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") } catch { return [] }
}
function saveRecent(keys: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(keys.slice(0, 3))) } catch { /* ignore */ }
}

function fmtContext(k?: number): string | undefined {
  if (!k) return undefined
  if (k >= 1000) return `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}M`
  return `${k}K`
}

export function ModelPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  groups: { provider: string; providerID: string; models: ModelEntry[] }[]
  currentKey?: string
  onSelect: (m: ModelEntry) => void
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [recent, setRecent] = createSignal<string[]>(loadRecent())
  const [hi, setHi] = createSignal(0)
  let listRef: HTMLDivElement | undefined

  const allModels = createMemo(() => props.groups.flatMap(g => g.models.map(m => ({ ...m, provider: g.provider, providerID: g.providerID }))))

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return allModels()
    return allModels().filter(m =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))
  })

  const recentModels = createMemo(() => {
    const byKey = new Map(allModels().map(m => [key(m), m]))
    const byId = new Map(allModels().map(m => [m.id, m]))
    return recent().map(k => {
      // Composite key first; legacy plain-id entries resolve to any provider.
      return byKey.get(k) ?? (k.includes("/") ? undefined : byId.get(k))
    }).filter(Boolean)
  })

  const visible = createMemo(() => {
    const q = query().trim()
    const rec = q ? [] : recentModels()
    const recKeys = new Set(rec.map(r => key(r)))
    const rest = filtered().filter(m => !recKeys.has(key(m)))
    // Group rest by provider preserving order
    const groups: { provider: string; items: ModelEntry[] }[] = []
    for (const m of rest) {
      const g = groups.find(x => x.provider === m.provider)
      if (g) g.items.push(m)
      else groups.push({ provider: m.provider, items: [m] })
    }
    return { rec, groups }
  })

  createEffect(() => {
    if (props.open) {
      setQuery("")
      setHi(0)
    }
  })

  // Scroll the current model into view when opened
  createEffect(() => {
    if (!props.open || !listRef) return
    const cur = props.currentKey
    if (!cur) return
    requestAnimationFrame(() => {
      const el = listRef?.querySelector(`[data-model-key="${CSS.escape(cur)}"]`)
      el?.scrollIntoView({ block: "nearest" })
    })
  })

  const select = (m: ModelEntry) => {
    const k = key(m)
    const next = [k, ...recent().filter(x => x !== k)].slice(0, 3)
    setRecent(next)
    saveRecent(next)
    props.onSelect(m)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, filtered().length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); const m = filtered()[hi()]; if (m) select(m) }
  }

  // Flat index of a model within the filtered list (drives the highlight row).
  const flatIdx = (m: ModelEntry) => filtered().findIndex(x => x.id === m.id && x.providerID === m.providerID)

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="tr" onClose={props.onClose}>
      {/* Search */}
      <div class="mafw-picker-search">
        <span class="mafw-picker-search-icon">🔍</span>
        <input
          class="mafw-picker-search-input"
          placeholder="搜索模型…"
          value={query()}
          onInput={e => { setQuery(e.currentTarget.value); setHi(0) }}
          onKeyDown={onKey}
        />
      </div>
      <div class="mafw-picker-list" ref={listRef}>
        <Show when={visible().rec.length > 0}>
          <div class="mafw-picker-group-label">最近使用</div>
          <For each={visible().rec}>
            {(m) => <ModelRow m={m} hi={hi() === flatIdx(m)} current={key(m) === props.currentKey} onClick={() => select(m)} />}
          </For>
        </Show>
        <For each={visible().groups}>
          {(g) => (
            <>
              <div class="mafw-picker-group-label">{g.provider}</div>
              <For each={g.items}>
                {(m) => <ModelRow m={m} hi={hi() === flatIdx(m)} current={key(m) === props.currentKey} onClick={() => select(m)} />}
              </For>
            </>
          )}
        </For>
        <Show when={filtered().length === 0}>
          <div class="mafw-picker-empty">无匹配模型</div>
        </Show>
      </div>
      <div class="mafw-picker-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </PopoverShell>
  )
}

function ModelRow(props: { m: ModelEntry; hi: boolean; current: boolean; onClick: () => void }) {
  return (
    <div
      class="mafw-picker-row"
      classList={{ hi: props.hi, current: props.current }}
      data-model-key={key(props.m)}
      onClick={props.onClick}
    >
      <span class="mafw-picker-row-name">
        <span class="mafw-picker-row-title">{props.m.name}</span>
        <Show when={props.m.name !== props.m.id}>
          <span class="mafw-picker-row-id">{props.m.id}</span>
        </Show>
      </span>
      <span class="mafw-picker-row-meta">
        <Show when={fmtContext(props.m.contextK)}><span class="mafw-picker-row-ctx">{fmtContext(props.m.contextK)}</span></Show>
        <Show when={props.m.vision}><span class="mafw-picker-row-cap" title="多模态">👁</span></Show>
        <Show when={props.m.thinking}><span class="mafw-picker-row-cap" title="思考">🧠</span></Show>
        <Show when={props.current}><span class="mafw-picker-row-check">✓</span></Show>
      </span>
    </div>
  )
}
