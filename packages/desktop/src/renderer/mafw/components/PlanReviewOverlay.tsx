// @ts-nocheck
// W1 计划审阅浮层：goal 泳道 plan 格子下钻——waves.json 渲染 + 批准/驳回。
// 批注（引文锚）在 Task 4 接入；本组件先交付渲染 + 动作条。
import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { Markdown } from "@mafw/session-ui/markdown"
import { renderPlanMarkdown } from "./plan-render"
import { planReviewViewModel } from "./plan-review-model"

export function PlanReviewOverlay(props: { goalId: string; terminal: boolean; onClose: () => void }) {
  const [info, setInfo] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [acting, setActing] = createSignal(false)
  const [rejectText, setRejectText] = createSignal("")
  const [rejectOpen, setRejectOpen] = createSignal(false)

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
    const feedback = rejectText().trim()
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
          <div class="mafw-plan-body">
            <Show when={!vm().empty} fallback={<div class="mafw-empty">暂无计划内容（plan 尚未产出 waves.json）</div>}>
              <Markdown text={markdown()} cacheKey={`plan:${props.goalId}:${markdown().length}`} streaming={false} />
            </Show>
          </div>

          <Show when={vm().showActions}>
            <div class="mafw-plan-actions">
              <Show when={!rejectOpen()} fallback={
                <div class="mafw-plan-reject">
                  <textarea
                    class="mafw-plan-reject-input"
                    rows={3}
                    placeholder="驳回意见（会注入下一版计划；批注草稿也将一并打包）"
                    value={rejectText()}
                    onInput={e => setRejectText(e.currentTarget.value)}
                  />
                  <div class="mafw-plan-reject-actions">
                    <ButtonV2 variant="ghost" size="small" onClick={() => setRejectOpen(false)}>返回</ButtonV2>
                    <ButtonV2
                      variant="contrast" size="small"
                      disabled={acting() || !rejectText().trim()}
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
