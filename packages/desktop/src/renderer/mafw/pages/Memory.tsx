import { createSignal, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"
import { SkeletonRows } from "../components/Skeleton"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { ConfirmOverlay } from "../components/ConfirmOverlay"
import { menuController } from "../context-menu/controller"
import { buildMemoryCardMenu } from "../context-menu/builders/card"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { openMenuOnKey } from "../context-menu/menu-key"

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

  const [deleteConfirmId, setDeleteConfirmId] = createSignal<string | null>(null)

  const applyMemoryChange = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await loadResults(query())
      void loadStats()
    } catch (e: any) {
      showToastV2({ description: `操作失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const requestMemoryMenu = (unit: any, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const sticky = !!unit.sticky_until
    menuController.request(
      buildMemoryCardMenu,
      { id: unit.id, pinned: !!unit.pinned, sticky },
      (id) => {
        if (id === "memory.copyAbstraction") void navigator.clipboard.writeText(unit.primary_abstraction ?? "")
        else if (id === "memory.copyFull") void navigator.clipboard.writeText(unit.memory_value ?? "")
        else if (id === "memory.pin") void applyMemoryChange(() => window.api.mafw.memory.setPinned(unit.id, !unit.pinned))
        else if (id === "memory.sticky" || id === "memory.renew") void applyMemoryChange(() => window.api.mafw.memory.setSticky(unit.id, true, 7))
        else if (id === "memory.unsticky") void applyMemoryChange(() => window.api.mafw.memory.setSticky(unit.id, false))
        else if (id === "memory.delete") setDeleteConfirmId(unit.id)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
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
      <PageHeader title="Memory" subtitle="谐波记忆检索与便签板" />

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
      <div style={{ display: "flex", gap: "8px", "margin-bottom": "16px" }}>
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
        <div class="mafw-card" style={{ "flex-direction": "column", "align-items": "stretch", "margin-bottom": "16px" }}>
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
          <SkeletonRows rows={3} h="52px" />
        ) : results().length > 0 ? results().map(unit => {
          return (
            <div class="mafw-card" tabIndex={0} onKeyDown={openMenuOnKey} style={{ "flex-direction": "column", "align-items": "stretch", "margin-bottom": "6px" }} onContextMenu={(event) => requestMemoryMenu(unit, event)}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                  <div class="mafw-card-title">{unit.primary_abstraction ?? unit.id}</div>
                  <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-shrink": "0px" }}>
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
                    {unit.cue_anchors.slice(0, 5).map((a: string) => <span class="mafw-tool-chip">{a}</span>)}
                  </div>
                )}
                {unit.memory_value && (
                  <div class="mafw-card-meta" style={{ "margin-top": "4px", "white-space": "pre-wrap" }}>{unit.memory_value}</div>
                )}
            </div>
          )
        }) : loaded() ? (
          <EmptyState glyph="⌕" title="没有匹配的记忆" hint="换个关键词，或先用 BM25 默认检索试试" />
        ) : null}
      </div>
      <ConfirmOverlay
        open={deleteConfirmId() !== null}
        title="删除记忆"
        message="删除后这条记忆会从谐波索引中移除，无法恢复。"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          const id = deleteConfirmId()
          setDeleteConfirmId(null)
          if (id) void handleDelete(id)
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
