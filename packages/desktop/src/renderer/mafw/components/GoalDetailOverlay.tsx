// Goal 详情：泳道（阶段 × loop）+ 点格子内联明细 + goal_node SSE 实时刷新。
// 数据源：window.api.mafw.goals.timeline（P1 gateway API）；会话下钻经 onOpenSession。
import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { PodDirectionState, PodGoalRevision, PodProbe } from "@mafw/sdk"
import { GoalTimelineLane } from "./GoalTimelineLane"
import { PlanReviewOverlay } from "./PlanReviewOverlay"
import { PodDirectionPanel } from "./PodDirectionPanel"
import { PodProbePanel } from "./PodProbePanel"
import { buildGoalLanes, formatDuration } from "../goal-timeline"
import { createPodIdResolver, podStore } from "../pod-store"
import { podStageLabel } from "../pod-model"
import { goalsRev } from "../goals-rev"

const TERMINAL_ACTIONS = new Set(["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"])

/** revision.directionJson 是 DirectionState 的镜像；坏 JSON 只当没有（fail-open）。 */
function parseDirectionState(json: string | null | undefined, revision: number | null): PodDirectionState | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== "object") return null
    const state = parsed as PodDirectionState
    return {
      version: typeof state.version === "number" ? state.version : 1,
      goalId: typeof state.goalId === "string" ? state.goalId : "",
      revision: typeof state.revision === "number" ? state.revision : (revision ?? 1),
      status: state.status === "pending" || state.status === "decided" ? state.status : "none",
      options: Array.isArray(state.options) ? state.options : [],
      requests: Array.isArray(state.requests) ? state.requests : [],
      decisions: Array.isArray(state.decisions) ? state.decisions : [],
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
    }
  } catch {
    return null
  }
}

export function GoalDetailOverlay(props: {
  goalId: string | null
  projectDir?: string | null
  podId?: string | null
  onClose: () => void
  onOpenSession: (sid: string) => void
}) {
  const [timeline, setTimeline] = createSignal<any>(null)
  const [revisions, setRevisions] = createSignal<PodGoalRevision[]>([])
  const [probes, setProbes] = createSignal<PodProbe[]>([])
  const [directionBusy, setDirectionBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [retrying, setRetrying] = createSignal(false)
  const [planOpen, setPlanOpen] = createSignal(false)

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

  // 显式 podId → 已加载的 Pod store → 按项目目录 lookup（Pod 面板没开也能拿到证据）。
  // 只缓存命中 + in-flight 去重；Pod 未建立时不会把 null 永久钉住。
  const resolvePod = createPodIdResolver({ lookup: (dir) => window.api.mafw.pod.lookup(dir) })
  async function resolvePodIdForGoal(): Promise<string | null> {
    return resolvePod({
      podId: props.podId,
      loadedPodId: podStore.detail()?.pod.id,
      projectDir: props.projectDir,
    })
  }

  // Task 20：方向裁定与 Spike 证据是 Goal 级协作事实（pod.updated / 项目切换后重拉）。
  async function loadCollaboration(id: string) {
    const podId = await resolvePodIdForGoal()
    if (!podId) { setRevisions([]); setProbes([]); return }
    const [revResult, probeResult] = await Promise.allSettled([
      window.api.mafw.pod.revisions(podId, id),
      window.api.mafw.pod.probes(podId, id),
    ])
    const revs = revResult.status === "fulfilled" && Array.isArray(revResult.value?.items) ? revResult.value.items : []
    setRevisions(revs)
    // 只展示当前 revision 的证据（打回后旧 revision 的 Spike 不冒充本轮事实）。
    const goal: any = podGoal()
    const target = typeof goal?.activeRevision === "number"
      ? goal.activeRevision
      : (revs.length > 0 ? Math.max(...revs.map((item) => item.revision)) : null)
    const items = probeResult.status === "fulfilled" && Array.isArray(probeResult.value?.items) ? probeResult.value.items : []
    setProbes(target == null ? items : items.filter((probe) => probe.revision === target))
  }

  // 实时：goalId 或 goalsRev（SSE goal_node bump）变化 → 重拉。
  // 协作数据由下面 pod 绑定的 effect 单点加载（避免 mount 时双请求）。
  createEffect(() => {
    const id = props.goalId
    void goalsRev() // 订阅信号
    if (!id) { setTimeline(null); setError(null); setRevisions([]); setProbes([]); return }
    void load(id)
  })

  // podId / 项目 / Pod store 变化 → 重新读取方向/探针（Pod 尚未加载时也会在加载后刷新）。
  createEffect(() => {
    const id = props.goalId
    if (!id) return
    void props.podId
    void props.projectDir
    void podStore.projectDir()
    void podStore.detail()
    void loadCollaboration(id)
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

  // W1 计划审阅入口：最新 plan run 存在即可看；manual+pending 显「待批准」徽标。
  const planEntry = () => {
    const g = timeline()?.goal
    if (!g) return null
    const hasPlanRun = (timeline()?.nodes || []).some((n: any) => n.node === "plan")
    if (!hasPlanRun && !g.planApproval) return null
    return {
      canOpen: true,
      pending: g.planApproval?.status === "pending",
      badge: g.planApproval?.status === "pending" ? "待批准"
        : g.planApproval?.status === "approved" ? "已批准"
        : g.planApproval?.status === "rejected" ? "已驳回" : undefined,
      onOpen: () => setPlanOpen(true),
    }
  }
  const goalTerminal = () => TERMINAL_ACTIONS.has(timeline()?.goal?.nextAction)

  // ── Task 20：方向裁定 / Spike / 阶段 ─────────────────────────────────────
  const podGoal = () => {
    const id = props.goalId
    if (!id) return null
    return (podStore.detail()?.goals ?? []).find((goal) => goal.goalId === id) ?? null
  }
  const stageText = () => {
    const goal = podGoal()
    if (goal) return podStageLabel(goal.stage)
    const phase = timeline()?.goal?.phase
    return typeof phase === "string" ? phase : null
  }
  const activeRevision = () => {
    const goal = podGoal() as any
    if (typeof goal?.activeRevision === "number") return goal.activeRevision
    if (typeof goal?.revision === "number") return goal.revision
    const list = revisions()
    return list.length > 0 ? Math.max(...list.map((item) => item.revision)) : null
  }
  const currentRevision = () => {
    const target = activeRevision()
    const list = revisions()
    if (list.length === 0) return null
    if (target == null) return list[list.length - 1]
    return list.find((item) => item.revision === target) ?? null
  }
  const directionState = (): PodDirectionState | null => {
    const revision = currentRevision()
    const parsed = parseDirectionState(revision?.directionJson, revision?.revision ?? null)
    if (parsed) return parsed
    const status = revision?.directionStatus
    if (status === "pending" || status === "decided") {
      return {
        version: 1,
        goalId: props.goalId ?? "",
        revision: revision?.revision ?? 1,
        status,
        options: [],
        requests: [],
        decisions: [],
        updatedAt: null,
      }
    }
    return null
  }
  const showDirection = () => {
    const state = directionState()
    if (!state) return false
    return state.status === "pending"
      || state.status === "decided"
      || (state.decisions?.length ?? 0) > 0
  }

  async function decideDirection(input: { userWords: string; optionId?: string }): Promise<boolean> {
    const podId = await resolvePodIdForGoal()
    const id = props.goalId
    if (!podId || !id) {
      showToastV2({ description: "当前项目还没有鲸群，无法记录方向", duration: 3000 })
      return false
    }
    setDirectionBusy(true)
    try {
      const result = await window.api.mafw.pod.directionDecision(podId, id, {
        mode: "decided",
        userWords: input.userWords,
        optionId: input.optionId,
      })
      showToastV2({
        description: result?.planningStarted ? "已记录方向，Tech Lead 开始规划" : "已记录方向",
        duration: 2500,
      })
      await load(id)
      void podStore.refresh()
      return true
    } catch (e: any) {
      showToastV2({ description: `记录方向失败：${String(e?.message || e).slice(0, 120)}`, duration: 3500 })
      return false
    } finally {
      setDirectionBusy(false)
    }
  }

  return (
    <Show when={props.goalId} keyed>
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
              ? <div class="mafw-empty" style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                  加载失败：{error()}
                  <ButtonV2 variant="neutral" size="small" onClick={() => void load(props.goalId!)}>重试</ButtonV2>
                </div>
              : <div style={{ display: "flex", gap: "8px", padding: "32px 0", "justify-content": "center" }}>
                  <LoaderV2 width={16} height={16} />
                </div>
          }>
            <div class="mafw-goal-meta" style={{ "flex-wrap": "wrap", "row-gap": "6px" }}>
              <span class={`mafw-phase-badge ${phaseBadge()}`}>{timeline()?.goal?.phase}</span>
              <Show when={stageText()}>
                <span class="mafw-card-meta">{stageText()}</span>
              </Show>
              <Show when={activeRevision() != null}>
                <span class="mafw-card-meta">revision {activeRevision()}</span>
              </Show>
              <span class="mafw-card-meta">Loop {timeline()?.goal?.round ?? 0}/{timeline()?.goal?.maxRounds ?? "?"}</span>
              <Show when={elapsed() != null}><span class="mafw-card-meta">已用 {formatDuration(elapsed())}</span></Show>
              <Show when={timeline()?.goal?.verdict}><span class="mafw-card-meta">verdict {timeline()?.goal?.verdict}</span></Show>
              <Show when={planEntry()}>
                <ButtonV2 variant="outline" size="small" onClick={planEntry()!.onOpen}>
                  计划{planEntry()!.badge ? ` · ${planEntry()!.badge}` : ""}
                </ButtonV2>
              </Show>
            </div>

            <Show when={showDirection()}>
              <PodDirectionPanel
                state={directionState()}
                revision={activeRevision()}
                busy={directionBusy()}
                onDecide={(input) => decideDirection(input)}
              />
            </Show>

            <Show when={probes().length > 0}>
              <PodProbePanel
                probes={probes()}
                revision={activeRevision()}
                busy={directionBusy()}
                onOpenPlan={planEntry() ? () => setPlanOpen(true) : undefined}
              />
            </Show>

            <Show when={(timeline()?.nodes || []).length} fallback={<div class="mafw-empty">尚未开始执行</div>}>
              <GoalTimelineLane
                goalId={props.goalId!}
                loops={lanes().loops}
                lanes={lanes().lanes}
                artifacts={timeline()?.artifacts}
                plan={planEntry() ?? undefined}
                onOpenSession={(sid) => { props.onClose(); props.onOpenSession(sid) }}
                onRetry={retry}
                retrying={retrying()}
              />
            </Show>

            <div class="mafw-goal-actions">
              <ButtonV2
                variant="ghost" size="small"
                onClick={() => window.api.mafw.goals.control({ goalId: props.goalId!, action: "ABORT" }).catch((e: any) => console.warn("[mafw]", e))}
              >取消 Goal</ButtonV2>
            </div>
          </Show>
        </div>
      </div>
      <Show when={planOpen()}>
        <PlanReviewOverlay
          goalId={props.goalId!}
          terminal={goalTerminal()}
          projectDir={props.projectDir}
          podId={props.podId}
          onClose={() => setPlanOpen(false)}
        />
      </Show>
    </Show>
  )
}
