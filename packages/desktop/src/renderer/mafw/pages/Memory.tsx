// @ts-nocheck
import { createSignal, onMount } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

interface EnergyDistribution { critical: number; high: number; medium: number; low: number; total: number }
interface L5Axiom { id: string; content: string; energy: number; created_at?: string }
interface L5Heuristic { id: string; pattern: string; trigger_context: string[]; success_rate?: number; energy: number; created_at?: string }

export function MemoryPage() {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<any[]>([])
  const [searching, setSearching] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)
  const [dist, setDist] = createSignal<EnergyDistribution | null>(null)
  const [axioms, setAxioms] = createSignal<L5Axiom[]>([])
  const [heuristics, setHeuristics] = createSignal<L5Heuristic[]>([])

  const loadStats = async () => {
    try {
      const [d, l5] = await Promise.all([
        window.api.mafw.memory.getEnergyDistribution(),
        window.api.mafw.memory.getL5Axioms(10).catch(() => ({ axioms: [], heuristics: [] })),
      ])
      setDist(d)
      setAxioms(l5.axioms || [])
      setHeuristics(l5.heuristics || [])
    } catch (e) { console.warn("[mafw] memory stats failed:", e) }
  }

  const loadResults = async (q: string) => {
    setSearching(true)
    try {
      const items = await window.api.mafw.memory.search({ query: q, topK: 100 })
      setResults(Array.isArray(items) ? items : [])
      setLoaded(true)
    } catch (e) {
      console.warn("[mafw] memory search failed:", e)
      setResults([])
      setLoaded(true)
    }
    setSearching(false)
  }

  const loadAll = async () => {
    await Promise.all([loadResults(query()), loadStats()])
  }

  onMount(() => { void loadAll() })

  const handleSearch = async () => {
    await loadResults(query())
    void loadStats()
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.mafw.memory.delete(id)
      setResults(prev => prev.filter(u => u.id !== id))
      void loadStats()
    } catch (e) { console.warn("[mafw] memory delete failed:", e) }
  }

  const distItems = dist()
    ? [
        { key: "critical", label: "Critical", value: dist()!.critical, cls: "mafw-mem-dist-critical" },
        { key: "high", label: "High", value: dist()!.high, cls: "mafw-mem-dist-high" },
        { key: "medium", label: "Medium", value: dist()!.medium, cls: "mafw-mem-dist-medium" },
        { key: "low", label: "Low", value: dist()!.low, cls: "mafw-mem-dist-low" },
      ]
    : []

  return (
    <div>
      <h2 class="mafw-page-title">Memory</h2>

      {/* Energy distribution badges */}
      {dist() && (
        <div class="mafw-mem-dist-row">
          <span class="mafw-mem-dist-total">Total: {dist()!.total}</span>
          {distItems.map(d => (
            <span classList={{ "mafw-mem-dist-badge": true, [d.cls]: true }}>
              {d.label}: {d.value}
            </span>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, "margin-bottom": 16 }}>
        <TextInputV2
          value={query()}
          onInput={e => setQuery(e.currentTarget.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Search memories... (empty = show all)"
          class="flex-1"
        />
        <ButtonV2 variant="contrast" size="small" onClick={handleSearch} disabled={searching()}>
          {searching() ? "Searching..." : "Search"}
        </ButtonV2>
      </div>

      {/* L5 block */}
      {(axioms().length > 0 || heuristics().length > 0) && (
        <div class="mafw-card" style={{ "flex-direction": "column", "align-items": "stretch", "margin-bottom": 16 }}>
          <div class="mafw-card-title">L5 Axioms & Heuristics</div>
          {axioms().map(a => (
            <div class="mafw-delta-row">
              <div class="mafw-delta-content">
                <div class="mafw-delta-text">{a.content}</div>
                <div class="mafw-delta-priority">E: {typeof a.energy === "number" ? a.energy.toFixed(2) : a.energy}</div>
              </div>
            </div>
          ))}
          {heuristics().map(h => (
            <div class="mafw-delta-row">
              <div class="mafw-delta-content">
                <div class="mafw-delta-text">{h.pattern}</div>
                <div class="mafw-delta-priority">
                  {h.trigger_context?.join(" / ")}{h.success_rate != null ? ` — success: ${(h.success_rate * 100).toFixed(0)}%` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      <div>
        {searching() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: 20 }}>
            <LoaderV2 width={16} height={16} />
            <span style={{ "font-size": 13, color: "var(--text-base)" }}>Searching...</span>
          </div>
        ) : results().length > 0 ? results().map(unit => {
          const memItems: ContextMenuItem[] = [
            { label: "Copy Abstraction", onSelect: () => navigator.clipboard.writeText(unit.primary_abstraction ?? "") },
            { label: "Copy Full Text", onSelect: () => navigator.clipboard.writeText(unit.memory_value ?? "") },
            { separator: true },
            { label: "Delete", danger: true, onSelect: () => void handleDelete(unit.id) },
          ]
          return (
            <MafwContextMenu items={memItems}>
              <div class="mafw-card" style={{ "flex-direction": "column", "align-items": "stretch", "margin-bottom": 6 }}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                  <div class="mafw-card-title">{unit.primary_abstraction ?? unit.id}</div>
                  <div style={{ display: "flex", "align-items": "center", gap: 6, "flex-shrink": 0 }}>
                    <span class="mafw-tool-tag" classList={{
                      "mafw-tag-semantic": unit.type === "semantic" || unit.type === "global",
                      "mafw-tag-procedural": unit.type === "procedural",
                      "mafw-tag-episodic": unit.type === "episodic",
                    }}>{unit.type ?? "?"}</span>
                    <span class="mafw-card-meta">E: {typeof unit.energy === "number" ? unit.energy.toFixed(2) : unit.energy}</span>
                  </div>
                </div>
                {Array.isArray(unit.cue_anchors) && unit.cue_anchors.length > 0 && (
                  <div class="mafw-tool-anchors">
                    {unit.cue_anchors.slice(0, 5).map(a => <span class="mafw-tool-chip">{a}</span>)}
                  </div>
                )}
                {unit.memory_value && (
                  <div class="mafw-card-meta" style={{ "margin-top": 4, "white-space": "pre-wrap" }}>{unit.memory_value}</div>
                )}
              </div>
            </MafwContextMenu>
          )
        }) : loaded() ? (
          <div class="mafw-empty">No memories found</div>
        ) : null}
      </div>
    </div>
  )
}
