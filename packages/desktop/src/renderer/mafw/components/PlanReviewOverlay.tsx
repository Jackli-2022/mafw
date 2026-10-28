// @ts-nocheck
// W1 计划审阅浮层：goal 泳道 plan 格子下钻——waves.json 渲染 + 划选批注 + 批准/驳回。
// 批注驳回专用（Task 4）：Enter 攒草稿，驳回时 buildRejectFeedback 打包；非 pending 可复制文本。
import { createSignal, createEffect, Show, onMount, onCleanup, For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { Markdown } from "@mafw/session-ui/markdown"
import { AnnotationSheet } from "./AnnotationSheet"
import { renderPlanMarkdown } from "./plan-render"
import { planReviewViewModel, buildRejectFeedback, type PlanAnnotationDraft } from "./plan-review-model"
import type { BoxRect } from "../annotation-placement"

export function PlanReviewOverlay(props: { goalId: string; terminal: boolean; onClose: () => void }) {
  const [info, setInfo] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [acting, setActing] = createSignal(false)
  const [rejectText, setRejectText] = createSignal("")
  const [rejectOpen, setRejectOpen] = createSignal(false)
  // Task 4：批注草稿池 + AnnotationSheet 挂载态
  const [drafts, setDrafts] = createSignal<PlanAnnotationDraft[]>([])
  const [sheet, setSheet] = createSignal<{ anchor: BoxRect; quote: string } | null>(null)
  let bodyEl: HTMLDivElement | undefined

  async function load() {
    setLoading(true); setError(null)
    try {
      setInfo(await window.api.mafw.goals.plan(props.goalId))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setLoading(false)
  }

  createEffect(() => { void load() })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !rejectOpen()) props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const vm = () => planReviewViewModel({
    planReview: info()?.planReview,
    planApproval: info()?.planApproval,
    waves: info()?.waves,
    terminal: props.terminal,
  })
  const markdown = () => renderPlanMarkdown(info()?.waves)

  async function approve() {
    setActing(true)
    try {
      await window.api.mafw.goals.approvePlan(props.goalId)
      showToastV2({ title: "已批准计划", description: "goal 将进入 execute", variant: "success" })
      props.onClose()
    } catch (e: any) {
      showToastV2({ title: "批准失败", description: String(e?.message || e).slice(0, 120), variant: "error" })
    }
    setActing(false)
  }

  async function reject() {
    const feedback = buildRejectFeedback(drafts(), rejectText())
    if (!feedback) return
    setActing(true)
    try {
      await window.api.mafw.goals.rejectPlan(props.goalId, feedback)
      showToastV2({ title: "已驳回并重新规划", description: "plan 将带着你的意见重跑", variant: "success" })
      props.onClose()
    } catch (e: any) {
      showToastV2({ title: "驳回失败", description: String(e?.message || e).slice(0, 120), variant: "error" })
    }
    setActing(false)
  }

  // ── Task 4：划选 → 引文锚 → AnnotationSheet（Enter 攒草稿） ──────────────
  const captureSelection = () => {
    if (!bodyEl) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === 1 ? node : node.parentElement
    if (!el || !bodyEl.contains(el)) return
    const text = sel.toString().replace(/\s+/g, " ").trim()
    if (!text) return
    const rect = range.getBoundingClientRect()
    const host = bodyEl.getBoundingClientRect()
    setSheet({
      anchor: { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height },
      quote: text,
    })
  }

  const addDraft = (comment: string) => {
    const s = sheet()
    if (!s) return
    setDrafts(prev => [...prev, { quote: s.quote, comment }])
    setSheet(null)
    try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
  }

  const copyDrafts = () => {
    const text = buildRejectFeedback(drafts(), "")
    if (!text) return
    try { navigator.clipboard.writeText(text) } catch { /* ignore */ }
    showToastV2({ description: "批注已复制", duration: 2000 })
  }

  onMount(() => {
    // 点外关闭 sheet（EditorDock 同款 capture 语义；sheet 内部点击不关）
    const onPointerDown = (e: PointerEvent) => {
      const s = sheet()
      if (!s) return
      const target = e.target as HTMLElement | null
      if (target && target.closest(".mafw-annot-sheet")) return
      setSheet(null)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

  return (
    <div class="mafw-goal-overlay mafw-plan-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
      <div class="mafw-goal-panel mafw-plan-panel">
        <div class="mafw-goal-head">
          <div style={{ "min-width": 0 }}>
            <div class="mafw-card-title">计划审阅 · Loop {info()?.round ?? "—"}</div>
            <div class="mafw-card-meta">{props.goalId}</div>
          </div>
          <span class={`mafw-phase-badge ${vm().status === "pending" ? "mafw-phase-badge-run" : "mafw-phase-badge-ok"}`}>{vm().badge}</span>
          <ButtonV2 variant="ghost" size="small" onClick={props.onClose} aria-label="关闭计划">✕</ButtonV2>
        </div>

        <Show when={!loading() && !error()} fallback={
          error()
            ? <div class="mafw-empty" style={{ display: "flex", gap: 8, "align-items": "center" }}>
                加载失败：{error()}
                <ButtonV2 variant="neutral" size="small" onClick={() => void load()}>重试</ButtonV2>
              </div>
            : <div style={{ display: "flex", gap: 8, padding: "32px 0", "justify-content": "center" }}>
                <LoaderV2 width={16} height={16} />
              </div>
        }>
          <div class="mafw-plan-body" ref={bodyEl} onMouseUp={captureSelection}>
            <Show when={!vm().empty} fallback={<div class="mafw-empty">暂无计划内容（plan 尚未产出 waves.json）</div>}>
              <Markdown text={markdown()} cacheKey={`plan:${props.goalId}:${markdown().length}`} streaming={false} />
            </Show>
            <Show when={sheet()}>
              <AnnotationSheet
                anchor={sheet()!.anchor}
                meta={`计划 › ${sheet()!.quote.slice(0, 24)}${sheet()!.quote.length > 24 ? "…" : ""}`}
                placeholder="对这段计划的意见（Enter 攒草稿，驳回时打包）"
                onSubmit={(v) => addDraft(v)}
                onCancel={() => setSheet(null)}
              />
            </Show>
          </div>

          <Show when={drafts().length > 0}>
            <div class="mafw-plan-drafts">
              <div class="mafw-plan-drafts-head">
                <span class="mafw-card-meta">批注草稿 {drafts().length} 条（驳回时随意见打包）</span>
                <ButtonV2 variant="ghost" size="small" onClick={() => setDrafts([])}>清空</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={copyDrafts}>复制批注文本</ButtonV2>
              </div>
              <For each={drafts()}>
                {(d, i) => (
                  <div class="mafw-plan-draft">
                    <div class="mafw-plan-draft-quote">「{d.quote.slice(0, 60)}{d.quote.length > 60 ? "…" : ""}」</div>
                    <div class="mafw-plan-draft-comment">{d.comment}</div>
                    <ButtonV2
                      variant="ghost" size="small" class="mafw-plan-draft-x" aria-label="删除此批注"
                      onClick={() => setDrafts(prev => prev.filter((_, j) => j !== i()))}
                    >✕</ButtonV2>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={vm().showActions}>
            <div class="mafw-plan-actions">
              <Show when={!rejectOpen()} fallback={
                <div class="mafw-plan-reject">
                  <textarea
                    class="mafw-plan-reject-input"
                    rows={3}
                    placeholder="驳回意见（批注草稿将一并打包；也可只留批注）"
                    value={rejectText()}
                    onInput={e => setRejectText(e.currentTarget.value)}
                  />
                  <div class="mafw-plan-reject-actions">
                    <ButtonV2 variant="ghost" size="small" onClick={() => setRejectOpen(false)}>返回</ButtonV2>
                    <ButtonV2
                      variant="contrast" size="small"
                      disabled={acting() || !buildRejectFeedback(drafts(), rejectText())}
                      onClick={() => void reject()}
                    >驳回并重新规划</ButtonV2>
                  </div>
                </div>
              }>
                <ButtonV2 variant="ghost" size="small" onClick={() => setRejectOpen(true)}>驳回并反馈…</ButtonV2>
                <ButtonV2
                  variant="contrast" size="small" disabled={acting()}
                  onClick={() => void approve()}
                >批准（进入 execute）</ButtonV2>
              </Show>
            </div>
          </Show>
          <Show when={vm().status === "pending" && props.terminal}>
            <div class="mafw-plan-terminal-note">goal 已终止，批准入口已关闭。</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
