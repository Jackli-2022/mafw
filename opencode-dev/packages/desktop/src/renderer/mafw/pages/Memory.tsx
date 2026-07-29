// @ts-nocheck
import { createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function MemoryPage() {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<any[]>([])
  const [searching, setSearching] = createSignal(false)

  async function handleSearch() {
    if (!query().trim()) return
    setSearching(true)
    try {
      const items = await window.api.mafw.memory.search({ query: query() }) as any[]
      setResults(items)
    } catch (e) { console.warn("[mafw]", e) }
    setSearching(false)
  }

  return (
    <div>
      <h2 class="mafw-page-title">Memory</h2>
      <div style={{ display: "flex", gap: 8, "margin-bottom": 24 }}>
        <TextInputV2
          value={query()}
          onInput={e => setQuery(e.currentTarget.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Search memories..."
          class="flex-1"
        />
        <ButtonV2 variant="contrast" size="small" onClick={handleSearch} disabled={searching()}>
          {searching() ? "Searching..." : "Search"}
        </ButtonV2>
      </div>
      <div>
        {searching() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: 20 }}>
            <LoaderV2 width={16} height={16} />
            <span style={{ "font-size": 13, color: "var(--text-base)" }}>Searching...</span>
          </div>
        ) : results().length > 0 ? results().map(unit => {
          const memItems: ContextMenuItem[] = [
            { label: "Copy Abstraction", onSelect: () => navigator.clipboard.writeText(unit.primary_abstraction) },
            { label: "Copy Full Text", onSelect: () => navigator.clipboard.writeText(unit.memory_value) },
            { separator: true },
            { label: "Delete", danger: true, onSelect: () => window.api.mafw.memory.delete(unit.id).catch((e: any) => console.warn("[mafw]", e)) },
          ]
          return (
          <MafwContextMenu items={memItems}>
            <div class="mafw-card" style={{ "flex-direction": "column", "align-items": "stretch", "margin-bottom": 6 }}>
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                <div class="mafw-card-title">{unit.primary_abstraction}</div>
                <div style={{ display: "flex", "align-items": "center", gap: 6, "flex-shrink": 0 }}>
                  <span class="mafw-tool-tag" classList={{
                    "mafw-tag-semantic": unit.type === "semantic",
                    "mafw-tag-procedural": unit.type === "procedural",
                    "mafw-tag-episodic": unit.type === "episodic",
                  }}>{unit.type}</span>
                  <span class="mafw-card-meta">E: {typeof unit.energy === "number" ? unit.energy.toFixed(1) : unit.energy}</span>
                </div>
              </div>
              <div class="mafw-card-meta" style={{ "margin-top": 4 }}>{unit.memory_value}</div>
            </div>
          </MafwContextMenu>
        )}) : query() ? (
          <div class="mafw-empty">No memories found</div>
        ) : null}
      </div>
    </div>
  )
}
