// @ts-nocheck
// Goal 详情：泳道（阶段 × loop）+ 点格子内联明细 + goal_node SSE 实时刷新。
// 数据源：window.api.mafw.goals.timeline（P1 gateway API）；会话下钻经 onOpenSession。
import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { GoalTimelineLane } from "./GoalTimelineLane"
import { buildGoalLanes, formatDuration } from "../goal-timeline"
import { goalsRev } from "../goals-rev"

export function GoalDetailOverlay(props: { goalId: string | null; onClose: () => void; onOpenSession: (sid: string) => void }) {
  const [timeline, setTimeline] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [retrying, setRetrying] = createSignal(false)

  async function load(id: string) {
    setLoading(true); setError(null)
    try {
      const t = await window.api.mafw.goals.timeline(id)
      setTimeline(t)
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setLoading(false)
  }

  // 实时：goalId 或 goalsRev（SSE goal_node bump）变化 → 重拉
  createEffect(() => {
    const id = props.goalId
    void goalsRev() // 订阅信号
    if (!id) { setTimeline(null); setError(null); return }
    void load(id)
  })
  // 慢轮询兜底
  createEffect(() => {
    const id = props.goalId
    if (!id) return
    const t = setInterval(() => void load(id), 15000)
    onCleanup(() => clearInterval(t))
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  async function retry(runId: number, node: string) {
    const id = props.goalId!
    if (node === "execute" && !window.confirm("execute 重跑会再次执行写操作，确认重跑？")) return
    setRetrying(true)
    try {
      await window.api.mafw.goals.retryNode(id, runId, { confirm: node === "execute" })
      showToastV2({ description: "已触发重跑", duration: 2000 })
      void load(id)
    } catch (e: any) {
      showToastV2({ description: `重跑失败：${e?.message || e}`, duration: 3000 })
    }
    setRetrying(false)
  }

  const lanes = () => {
    const t = timeline()
    if (!t) return { loops: [], lanes: [] }
    return buildGoalLanes(t.nodes || [], t.goal?.maxRounds ?? 3)
  }
  const elapsed = () => {
    const nodes = timeline()?.nodes || []
    const starts = nodes.map((n: any) => Date.parse(n.startedAt)).filter((x: number) => Number.isFinite(x))
    if (!starts.length) return null
    const finished = nodes.filter((n: any) => n.finishedAt).map((n: any) => Date.parse(n.finishedAt))
    const end = finished.length ? Math.max(...finished) : Date.now()
    return end - Math.min(...starts)
  }
  const phaseBadge = () => {
    const g = timeline()?.goal
    if (g?.verdict === "PASS" || g?.phase === "ARCHIVED" || g?.phase === "COMPLETED") return "mafw-phase-badge-ok"
    if (g?.phase === "FAILED") return "mafw-phase-badge-fail"
    return "mafw-phase-badge-run"
  }

  return (
    <Show when={props.goalId}>
      <div class="mafw-goal-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-goal-panel">
          <div class="mafw-goal-head">
            <div style={{ "min-width": 0 }}>
              <div class="mafw-card-title">{timeline()?.goal?.title || props.goalId}</div>
              <div class="mafw-card-meta">{timeline()?.goal?.goalId || props.goalId}</div>
            </div>
            <ButtonV2 variant="ghost" size="small" onClick={props.onClose} aria-label="关闭详情">✕</ButtonV2>
          </div>

          <Show when={!loading() && !error()} fallback={
            error()
              ? <div class="mafw-empty" style={{ display: "flex", gap: 8, "align-items": "center" }}>
                  加载失败：{error()}
                  <ButtonV2 variant="neutral" size="small" onClick={() => void load(props.goalId!)}>重试</ButtonV2>
                </div>
              : <div style={{ display: "flex", gap: 8, padding: "32px 0", "justify-content": "center" }}>
                  <LoaderV2 width={16} height={16} />
                </div>
          }>
            <div class="mafw-goal-meta">
              <span class={`mafw-phase-badge ${phaseBadge()}`}>{timeline()?.goal?.phase}</span>
              <span class="mafw-card-meta">Loop {timeline()?.goal?.round ?? 0}/{timeline()?.goal?.maxRounds ?? "?"}</span>
              <Show when={elapsed() != null}><span class="mafw-card-meta">已用 {formatDuration(elapsed())}</span></Show>
              <Show when={timeline()?.goal?.verdict}><span class="mafw-card-meta">verdict {timeline()?.goal?.verdict}</span></Show>
            </div>

            <Show when={(timeline()?.nodes || []).length} fallback={<div class="mafw-empty">尚未开始执行</div>}>
              <GoalTimelineLane
                goalId={props.goalId!}
                loops={lanes().loops}
                lanes={lanes().lanes}
                artifacts={timeline()?.artifacts}
                onOpenSession={(sid) => { props.onClose(); props.onOpenSession(sid) }}
                onRetry={retry}
                retrying={retrying()}
              />
            </Show>

            <div class="mafw-goal-actions">
              <ButtonV2
                variant="ghost" size="small"
                onClick={() => window.api.mafw.goals.control({ goalId: props.goalId, action: "ABORT" }).catch((e: any) => console.warn("[mafw]", e))}
              >取消 Goal</ButtonV2>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
