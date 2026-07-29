// @ts-nocheck
import { createSignal, createEffect, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function ApprovalsPage() {
  const [items, setItems] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

  async function fetch() {
    setLoading(true)
    try {
      const list = await window.api.mafw.approvals.list() as any[]
      setItems(list)
    } catch (e) { console.warn("[mafw]", e) }
    setLoading(false)
  }

  createEffect(() => {
    fetch()
    const interval = setInterval(fetch, 10000)
    onCleanup(() => clearInterval(interval))
  })

  async function respond(id: string, decision: "approve" | "reject") {
    try {
      await window.api.mafw.approvals.respond(id, decision)
      fetch()
    } catch (e) { console.warn("[mafw]", e) }
  }

  return (
    <div>
      <h2 class="mafw-page-title">Approvals</h2>
      {loading() ? (
        <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
          <LoaderV2 width={16} height={16} />
          <span class="mafw-empty">Loading...</span>
        </div>
      ) : items().length === 0 ? (
        <div class="mafw-empty">No pending approvals</div>
      ) : (
        items().map(a => {
          const menu: ContextMenuItem[] = [
            { label: "✓ Approve", onSelect: () => respond(a.id, "approve").catch((e: any) => console.warn("[mafw]", e)) },
            { label: "✕ Reject", onSelect: () => respond(a.id, "reject").catch((e: any) => console.warn("[mafw]", e)) },
            { separator: true },
            { label: "Copy Question", onSelect: () => navigator.clipboard.writeText(a.question || a.id) },
          ]
          return (
          <MafwContextMenu items={menu}>
            <div class="mafw-card">
              <div style={{ flex: 1 }}>
                <div class="mafw-card-title">{a.question || a.id}</div>
                <div class="mafw-card-meta">Goal: {a.goalId} · {a.status} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</div>
              </div>
              {a.status === "pending" && (
                <div style={{ display: "flex", gap: 4, "flex-shrink": 0 }}>
                  <ButtonV2 variant="contrast" size="small" onClick={() => respond(a.id, "approve")}>✓ Approve</ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => respond(a.id, "reject")}>✕ Reject</ButtonV2>
                </div>
              )}
            </div>
          </MafwContextMenu>
        )})
      )}
    </div>
  )
}
