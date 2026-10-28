import { createSignal, createEffect, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"
import { SkeletonRows } from "../components/Skeleton"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { ConfirmOverlay } from "../components/ConfirmOverlay"
import { menuController } from "../context-menu/controller"
import { buildTriageCardMenu } from "../context-menu/builders/card"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"

export function TriagePage(props: { onOpenGoals?: () => void } = {}) {
  const [items, setItems] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [dismissConfirmId, setDismissConfirmId] = createSignal<string | null>(null)

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

  const act = async (label: string, fn: () => Promise<any>) => {
    try {
      await fn()
      showToastV2({ description: `${label} 成功`, duration: 2000 })
      await fetch()
    } catch (e: any) {
      showToastV2({ description: `${label} 失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const requestTriageMenu = (t: any, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    menuController.request(
      buildTriageCardMenu,
      { id: t.id, goalId: t.goalId },
      (id) => {
        if (id === "triage.confirm") void act("确认", () => window.api.mafw.triage.confirm(t.id))
        else if (id === "triage.proposeConfirm") void act("提议确认", () => window.api.mafw.triage.propose(t.id, "confirm", "用户在桌面端提议确认"))
        else if (id === "triage.proposeReject") void act("提议拒绝", () => window.api.mafw.triage.propose(t.id, "reject", "用户在桌面端提议拒绝"))
        else if (id === "triage.viewGoal") props.onOpenGoals?.()
        else if (id === "triage.dismiss") setDismissConfirmId(t.id)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <div>
      <PageHeader title="Triage" subtitle="自动化扫描结果确认" />
        {loading() ? (
          <SkeletonRows rows={3} h="52px" />
      ) : items().length === 0 ? (
          <EmptyState glyph="⚖" title="没有待确认项" hint="自动化扫描的结果会出现在这里" />
      ) : (
        items().map(t => {
          const confirmIt = () => void act("确认", () => window.api.mafw.triage.confirm(t.id))
          const proposeConfirm = () => void act("提议确认", () => window.api.mafw.triage.propose(t.id, "confirm", "用户在桌面端提议确认"))
          const proposeReject = () => void act("提议拒绝", () => window.api.mafw.triage.propose(t.id, "reject", "用户在桌面端提议拒绝"))
          return (
            <div class="mafw-card" onContextMenu={(event) => requestTriageMenu(t, event)}>
              <div style={{ flex: 1 }}>
                <div class="mafw-card-title">{t.reason || t.id}</div>
                <div class="mafw-card-meta">Goal: {t.goalId} · {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</div>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                <ButtonV2 variant="outline" size="small" onClick={confirmIt}>确认</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={proposeConfirm}>提议确认</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={proposeReject}>提议拒绝</ButtonV2>
                <span class="mafw-tool-tag" style={{ background: severityColor(t.severity) + "22", color: severityColor(t.severity), border: `0.5px solid ${severityColor(t.severity)}44` }}>{t.severity}</span>
              </div>
            </div>
          )
        })
      )}
      <ConfirmOverlay
        open={dismissConfirmId() !== null}
        title="忽略待确认项"
        message="忽略后这条扫描结果不会再出现在列表里。"
        confirmLabel="忽略"
        danger
        onConfirm={() => {
          const id = dismissConfirmId()
          setDismissConfirmId(null)
          if (id) void act("忽略", () => window.api.mafw.triage.dismiss(id))
        }}
        onCancel={() => setDismissConfirmId(null)}
      />
    </div>
  )
}
