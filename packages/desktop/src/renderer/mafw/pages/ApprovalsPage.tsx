import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"
import { SkeletonRows } from "../components/Skeleton"
import { menuController } from "../context-menu/controller"
import { buildApprovalPermissionMenu, buildApprovalQuestionMenu } from "../context-menu/builders/card"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"

// Two approval sources, one page:
//  - permission cards (opencode tool approvals, live in chat flow) — the badge counts these
//  - user-questions (manager askUser), backed by GET /api/approvals
export function ApprovalsPage(props: {
  permissionCards?: () => any[]
  onPermissionReply?: (card: any, reply: "once" | "always" | "reject", message?: string, persist?: boolean | "tool" | "prefix") => void
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

  const requestPermissionMenu = (card: any, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const command = card.action?.payload
    menuController.request(
      buildApprovalPermissionMenu,
      { id: card.id, command },
      (id) => {
        if (id === "approvalP.allowOnce") props.onPermissionReply?.(card, "once")
        else if (id === "approvalP.alwaysAllow") props.onPermissionReply?.(card, "always")
        else if (id === "approvalP.reject") props.onPermissionReply?.(card, "reject")
        else if (id === "approvalP.rememberPrefix") props.onPermissionReply?.(card, "always", undefined, "prefix")
        else if (id === "approvalP.rememberTool") props.onPermissionReply?.(card, "always", undefined, "tool")
        else if (id === "approvalP.copyCommand" && command) void navigator.clipboard.writeText(command)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  const requestQuestionMenu = (question: any, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    menuController.request(
      buildApprovalQuestionMenu,
      { id: question.id },
      (id) => {
        if (id === "approvalQ.approve") void respond(question.id, "approve")
        else if (id === "approvalQ.reject") void respond(question.id, "reject")
        else if (id === "approvalQ.copyQuestion") void navigator.clipboard.writeText(question.question || question.id)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <div>
      <PageHeader title="Approvals" subtitle="待审批的工具调用" />
      {loading() ? (
        <SkeletonRows rows={3} h="52px" />
      ) : !hasAnything() ? (
          <EmptyState glyph="✓" title="没有待审批项" hint="需要确认的工具调用会出现在这里" />
      ) : (
        <>
        <Show when={perms().length > 0}>
          <div class="mafw-approvals-group-title">权限审批 · {perms().length}</div>
          <For each={perms()}>
            {(p) => (
              <div class="mafw-card" onContextMenu={(event) => requestPermissionMenu(p, event)}>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div class="mafw-card-title">{p.action?.title || p.id}</div>
                  <div class="mafw-card-meta">
                    {p.agentName} · {p.action?.type} · 风险 {p.risk} · 会话 {String(p.sessionID).slice(0, 8)}
                  </div>
                  <Show when={p.action?.payload}>
                    <div class="mafw-card-meta" style={{ "white-space": "pre-wrap", "word-break": "break-all" }}>{p.action.payload}</div>
                  </Show>
                </div>
                <div style={{ display: "flex", gap: "4px", "flex-shrink": "0px" }}>
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
            return (
            <div class="mafw-card" onContextMenu={(event) => requestQuestionMenu(a, event)}>
                <div style={{ flex: 1 }}>
                  <div class="mafw-card-title">{a.question || a.id}</div>
                  <div class="mafw-card-meta">Goal: {a.goalId} · {a.status} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</div>
                </div>
                <div style={{ display: "flex", gap: "4px", "flex-shrink": "0px" }}>
                  <ButtonV2 variant="contrast" size="small" onClick={() => respond(a.id, "approve")}>批准</ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => respond(a.id, "reject")}>拒绝</ButtonV2>
                </div>
            </div>
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
