// @ts-nocheck
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

// Two approval sources, one page:
//  - permission cards (opencode tool approvals, live in chat flow) — the badge counts these
//  - user-questions (manager askUser), backed by GET /api/approvals
export function ApprovalsPage(props: {
  permissionCards?: () => any[]
  onPermissionReply?: (card: any, reply: "once" | "always" | "reject") => void
} = {}) {
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

  const pendingQuestions = () => items().filter(a => a.status === "pending")
  const answeredQuestions = () => items().filter(a => a.status !== "pending")
  const perms = () => props.permissionCards?.() ?? []
  const hasAnything = () => perms().length > 0 || pendingQuestions().length > 0

  return (
    <div>
      <h2 class="mafw-page-title">Approvals</h2>
      {loading() ? (
        <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
          <LoaderV2 width={16} height={16} />
          <span class="mafw-empty">Loading...</span>
        </div>
      ) : !hasAnything() ? (
        <div class="mafw-empty">No pending approvals</div>
      ) : (
        <>
        <Show when={perms().length > 0}>
          <div class="mafw-approvals-group-title">权限审批 · {perms().length}</div>
          <For each={perms()}>
            {(p) => (
              <div class="mafw-card">
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div class="mafw-card-title">{p.action?.title || p.id}</div>
                  <div class="mafw-card-meta">
                    {p.agentName} · {p.action?.type} · 风险 {p.risk} · 会话 {String(p.sessionID).slice(0, 8)}
                  </div>
                  <Show when={p.action?.payload}>
                    <div class="mafw-card-meta" style={{ "white-space": "pre-wrap", "word-break": "break-all" }}>{p.action.payload}</div>
                  </Show>
                </div>
                <div style={{ display: "flex", gap: 4, "flex-shrink": 0 }}>
                  <ButtonV2 variant="contrast" size="small" onClick={() => props.onPermissionReply?.(p, "once")}>✓ 允许一次</ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => props.onPermissionReply?.(p, "always")}>始终允许</ButtonV2>
                  <ButtonV2 variant="ghost" size="small" onClick={() => props.onPermissionReply?.(p, "reject")}>✕ 拒绝</ButtonV2>
                </div>
              </div>
            )}
          </For>
        </Show>
        <Show when={pendingQuestions().length > 0}>
          <div class="mafw-approvals-group-title">待回答问题 · {pendingQuestions().length}</div>
          {pendingQuestions().map(a => {
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
                <div style={{ display: "flex", gap: 4, "flex-shrink": 0 }}>
                  <ButtonV2 variant="contrast" size="small" onClick={() => respond(a.id, "approve")}>✓ Approve</ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => respond(a.id, "reject")}>✕ Reject</ButtonV2>
                </div>
              </div>
            </MafwContextMenu>
          )})}
        </Show>
        <Show when={answeredQuestions().length > 0}>
          <div class="mafw-approvals-group-title">已回答 · {answeredQuestions().length}</div>
          {answeredQuestions().map(a => (
            <div class="mafw-card">
              <div style={{ flex: 1 }}>
                <div class="mafw-card-title">{a.question || a.id}</div>
                <div class="mafw-card-meta">Goal: {a.goalId} · {a.status} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</div>
              </div>
            </div>
          ))}
        </Show>
        </>
      )}
    </div>
  )
}
