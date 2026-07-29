// @ts-nocheck
import { createSignal, createEffect, onCleanup } from "solid-js"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function TriagePage() {
  const [items, setItems] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

  async function fetch() {
    setLoading(true)
    try {
      const list = await window.api.mafw.triage.list() as any[]
      setItems(list)
    } catch (e) { console.warn("[mafw]", e) }
    setLoading(false)
  }

  createEffect(() => {
    fetch()
    const interval = setInterval(fetch, 10000)
    onCleanup(() => clearInterval(interval))
  })

  const severityColor = (s: string) => {
    if (s === "high") return "#e8636b"
    if (s === "medium") return "#e8b84b"
    return "#7698fd"
  }

  return (
    <div>
      <h2 class="mafw-page-title">Triage</h2>
        {loading() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
            <LoaderV2 width={16} height={16} />
            <span class="mafw-empty">Loading...</span>
          </div>
      ) : items().length === 0 ? (
        <div class="mafw-empty">No triage items</div>
      ) : (
        items().map(t => {
          const menu: ContextMenuItem[] = [
            { label: "View Goal", onSelect: () => window.api.mafw.goals.get(t.goalId).catch((e: any) => console.warn("[mafw]", e)) },
            { separator: true },
            { label: "Dismiss", danger: true, onSelect: () => window.api.mafw.triage.dismiss(t.id).catch((e: any) => console.warn("[mafw]", e)) },
          ]
          return (
          <MafwContextMenu items={menu}>
            <div class="mafw-card">
              <div style={{ flex: 1 }}>
                <div class="mafw-card-title">{t.reason || t.id}</div>
                <div class="mafw-card-meta">Goal: {t.goalId} · {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</div>
              </div>
              <span class="mafw-tool-tag" style={{ background: severityColor(t.severity) + "22", color: severityColor(t.severity), border: `0.5px solid ${severityColor(t.severity)}44` }}>{t.severity}</span>
            </div>
          </MafwContextMenu>
        )})
      )}
    </div>
  )
}
