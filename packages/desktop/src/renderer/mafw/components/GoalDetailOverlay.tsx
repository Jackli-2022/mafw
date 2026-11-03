// Goal 详情（Task 13 统一实现）：当前行动 + 计划/任务 + 产品产物 + 结果/打回 +
// 方向/问题 + 次级执行时间线。数据源复用既有 Goal/Pod API，不建第二套状态。
import { createEffect, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { PodDirectionState, PodGoalRevision, PodMember, PodProbe, PodTask } from "@mafw/sdk"
import { GoalTimelineLane } from "./GoalTimelineLane"
import { PlanReviewOverlay } from "./PlanReviewOverlay"
import { PodDirectionPanel } from "./PodDirectionPanel"
import { PodProbePanel } from "./PodProbePanel"
import { PodResultView } from "./PodResultView"
import { PodTaskBoard } from "./PodTaskBoard"
import { buildGoalLanes, formatDuration, hideEmptyReviewLane, timelineFailure } from "../goal-timeline"
import { createPodIdResolver, podStore } from "../pod-store"
import {
  planEditGate,
  podStageLabel,
  revisionHistory,
  revisionStatusLabel,
  type GoalDetailFocus,
} from "../pod-model"
import { requestPodTechLeadOpen } from "../pod-result-store"
import { goalsRev } from "../goals-rev"

const TERMINAL_ACTIONS = new Set(["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"])

/** revision.directionJson 是 DirectionState 的镜像；坏 JSON 只当没有（fail-open）。 */
function parseDirectionState(json: string | null | undefined, revision: number | null): PodDirectionState | null {
  if (!json) return null
  try {
    const state = JSON.parse(json)
    if (!state || typeof state !== "object") return null
    return {
      version: 1,
      goalId: String(state.goalId ?? ""),
      revision: typeof state.revision === "number" ? state.revision : (revision ?? 1),
      status: state.status === "decided" ? "decided" : "pending",
      options: Array.isArray(state.options) ? state.options : [],
      requests: Array.isArray(state.requests) ? state.requests : [],
      decisions: Array.isArray(state.decisions) ? state.decisions : [],
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
    } as PodDirectionState
  } catch {
    return null
  }
}

function artifactName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

export function GoalDetailOverlay(props: {
  goalId: string | null
  projectDir?: string | null
  podId?: string | null
  /** shell 打开 attention 时指定要展开/滚动到的区域。 */
  focus?: GoalDetailFocus | null
  onClose: () => void
  onOpenSession: (sid: string) => void
}) {
  const [timeline, setTimeline] = createSignal<any>(null)
  const [podDetail, setPodDetail] = createSignal<any>(null)
  const [resolvedPodId, setResolvedPodId] = createSignal<string | null>(null)
  const [revisions, setRevisions] = createSignal<PodGoalRevision[]>([])
  const [probes, setProbes] = createSignal<PodProbe[]>([])
  const [tasks, setTasks] = createSignal<PodTask[]>([])
  const [members, setMembers] = createSignal<PodMember[]>([])
  const [pendingQuestions, setPendingQuestions] = createSignal<Array<{ id: string; question: string }>>([])
  const [questionDrafts, setQuestionDrafts] = createSignal<Record<string, string>>({})
  const [questionBusy, setQuestionBusy] = createSignal<string | null>(null)
  const [tableBusy, setTableBusy] = createSignal(false)
  const [directionBusy, setDirectionBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [retrying, setRetrying] = createSignal(false)
  const [planOpen, setPlanOpen] = createSignal(false)

  let questionRef: HTMLDivElement | undefined
  let directionRef: HTMLDivElement | undefined
  let resultRef: HTMLDivElement | undefined
  let disposed = false
  onCleanup(() => { disposed = true })

  async function load(id: string) {
    setLoading(true); setError(null)
    try {
      const t = await window.api.mafw.goals.timeline(id)
      if (disposed) return
      setTimeline(t)
    } catch (e: any) {
      if (disposed) return
      const failure = timelineFailure(e)
      if (failure.unavailable) {
        // discussing Goal 还没有 GoalState：timeline 不可用不是页面错误，
        // 阶段/版本/方向/探针协作面照常渲染。
        setTimeline(null)
        setError(null)
      } else {
        setError(failure.error)
      }
    }
    setLoading(false)
  }

  // 显式 podId → 已加载的 Pod store → 按项目目录 lookup（Pod 面板没开也能拿到证据）。
  // 只缓存命中 + in-flight 去重；Pod 未建立时不会把 null 永久钉住。
  const resolvePod = createPodIdResolver({ lookup: (dir) => window.api.mafw.pod.lookup(dir) })
  async function resolvePodIdForGoal(): Promise<string | null> {
    const loaded = podStore.detail()
    const loadedFor = podStore.projectDir()
    const loadedPodId = loaded && (!loadedFor || loadedFor === props.projectDir)
      ? loaded.pod.id
      : null
    return resolvePod({
      podId: props.podId,
      loadedPodId,
      projectDir: props.projectDir,
    })
  }

  // Task 20：方向裁定与 Spike 证据是 Goal 级协作事实（pod.updated / 项目切换后重拉）。
  // Task 13：同一趟取回当前 Goal 的计划任务与人工作答的问题，不新建第二套详情状态。
  async function loadCollaboration(id: string) {
    const podId = await resolvePodIdForGoal()
    if (disposed) return
    setResolvedPodId(podId ?? null)
    const [revResult, probeResult, detailResult, approvalsResult] = await Promise.allSettled([
      podId ? window.api.mafw.pod.revisions(podId, id) : Promise.resolve({ items: [] }),
      podId ? window.api.mafw.pod.probes(podId, id) : Promise.resolve({ items: [] }),
      podId ? window.api.mafw.pod.get(podId) : Promise.resolve(null),
      window.api.mafw.approvals.list(),
    ])
    if (disposed) return
    const revs = revResult.status === "fulfilled" && Array.isArray(revResult.value?.items) ? revResult.value.items : []
    setRevisions(revs)
    if (detailResult.status === "fulfilled" && detailResult.value) {
      setPodDetail(detailResult.value)
      setTasks(Array.isArray(detailResult.value.tasks) ? detailResult.value.tasks : [])
      setMembers(Array.isArray(detailResult.value.members) ? detailResult.value.members : [])
    } else {
      setPodDetail(null)
      setTasks([])
      setMembers([])
    }
    if (approvalsResult.status === "fulfilled" && Array.isArray(approvalsResult.value)) {
      setPendingQuestions(
        approvalsResult.value
          .filter((item) => item.goalId === id && item.status === "pending")
          .map((item) => ({ id: item.id, question: item.question })),
      )
    } else {
      setPendingQuestions([])
    }
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
    if (!id) { setTimeline(null); setError(null); setRevisions([]); setProbes([]); setTasks([]); setPendingQuestions([]); return }
    void load(id)
  })

  // podId / 项目 / Pod store 变化 → 重新读取方向/探针/任务/问题（Pod 尚未加载时也会在加载后刷新）。
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
    const t = setInterval(() => {
      void load(id)
      void loadCollaboration(id)
    }, 15000)
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
    const built = buildGoalLanes(t.nodes || [], t.goal?.maxRounds ?? 3)
    return { loops: built.loops, lanes: hideEmptyReviewLane(built.lanes, podGoal()?.strategy) }
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
    return (podStore.detail()?.goals ?? []).find((goal) => goal.goalId === id)
      ?? (podDetail()?.goals ?? []).find((goal: any) => goal.goalId === id)
      ?? null
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
  // Task 21：版本历史（新→旧）。旧 revision 的 verdict/feedback 是审计事实，永不丢。
  const revisionRows = () => revisionHistory(revisions(), activeRevision())
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
      void loadCollaboration(id)
      void podStore.refresh()
      return true
    } catch (e: any) {
      showToastV2({ description: `记录方向失败：${String(e?.message || e).slice(0, 120)}`, duration: 3500 })
      return false
    } finally {
      setDirectionBusy(false)
    }
  }

  // ── Task 13：结果 / 打回 / 计划任务 / 人工作答 ────────────────────────────

  const hasResult = () => {
    const goal = podGoal() as any
    if (!goal) return false
    // Cancelled/aborted Goals have a terminal verdict but no result evidence.
    if (goal.status === "aborted") return false
    if (goal.resultReady === true) return true
    return goal.status === "done" && !!goal.verdict
  }

  const planGate = () => planEditGate({
    terminal: goalTerminal() || podGoal()?.status === "done" || podGoal()?.status === "aborted",
    stage: podGoal()?.stage ?? null,
  })
  const planTaskCount = () => tasks().filter(
    (task) => task.goalId === props.goalId && task.kind === "plan",
  ).length

  async function reloadTasks(): Promise<void> {
    const podId = await resolvePodIdForGoal()
    if (!podId) return
    const detail = await window.api.mafw.pod.get(podId)
    setTasks(Array.isArray(detail?.tasks) ? detail.tasks : [])
    setMembers(Array.isArray(detail?.members) ? detail.members : [])
  }

  async function withTableBusy(run: () => Promise<boolean>): Promise<boolean> {
    if (tableBusy()) return false
    setTableBusy(true)
    try {
      return await run()
    } catch (err: any) {
      showToastV2({ description: `计划任务失败：${String(err?.message || err).slice(0, 120)}`, duration: 3500 })
      return false
    } finally {
      setTableBusy(false)
    }
  }

  const createPlanTask = (title: string) => withTableBusy(async () => {
    const podId = await resolvePodIdForGoal()
    const id = props.goalId
    if (!podId || !id) return false
    await window.api.mafw.pod.createTask(podId, { plan: true, goalId: id, title })
    await reloadTasks()
    return true
  })

  const editPlanTask = (taskId: string, patch: { title: string; acceptance: string[] }) => withTableBusy(async () => {
    const podId = await resolvePodIdForGoal()
    if (!podId) return false
    await window.api.mafw.pod.updateTask(podId, taskId, patch)
    await reloadTasks()
    return true
  })

  const deletePlanTask = (taskId: string) => withTableBusy(async () => {
    const podId = await resolvePodIdForGoal()
    if (!podId) return false
    await window.api.mafw.pod.deleteTask(podId, taskId)
    await reloadTasks()
    return true
  })

  const rejectGoal = async (feedback: string): Promise<boolean> => {
    const podId = await resolvePodIdForGoal()
    const id = props.goalId
    if (!podId || !id) {
      showToastV2({ description: "当前项目还没有鲸群，无法打回", duration: 3000 })
      return false
    }
    const result = await window.api.mafw.pod.rejectResult(podId, id, feedback)
    showToastV2({
      description: `已打回：进入 revision ${result?.revision ?? "?"}，正在打开 Tech Lead 讨论`,
      variant: "success",
      duration: 3200,
    } as any)
    await podStore.refresh()
    requestPodTechLeadOpen(id, typeof result?.revision === "number" ? result.revision : null)
    props.onClose()
    return true
  }

  async function answerQuestion(questionId: string): Promise<void> {
    const id = props.goalId
    const answer = (questionDrafts()[questionId] ?? "").trim()
    if (!id || !answer || questionBusy()) return
    setQuestionBusy(questionId)
    try {
      await window.api.mafw.goals.respondQuestion(id, questionId, { type: "answer", answer })
      showToastV2({ description: "已提交回答", duration: 2200 })
      setQuestionDrafts((drafts) => ({ ...drafts, [questionId]: "" }))
      await load(id)
      await loadCollaboration(id)
    } catch (e: any) {
      showToastV2({ description: `回答失败：${String(e?.message || e).slice(0, 120)}`, duration: 3500 })
    } finally {
      setQuestionBusy(null)
    }
  }

  async function cancelQuestion(questionId: string): Promise<void> {
    const id = props.goalId
    if (!id || questionBusy()) return
    setQuestionBusy(questionId)
    try {
      await window.api.mafw.goals.respondQuestion(id, questionId, { type: "cancel" })
      showToastV2({ description: "已取消该提问", duration: 2200 })
      await load(id)
      await loadCollaboration(id)
    } catch (e: any) {
      showToastV2({ description: `取消失败：${String(e?.message || e).slice(0, 120)}`, duration: 3500 })
    } finally {
      setQuestionBusy(null)
    }
  }

  // 当前行动：详情打开时先告诉用户「现在要做什么」，而不是让人自己找。
  const currentAction = () => {
    if (!podGoal()) return null
    if (planEntry()?.pending) return { label: "审核计划", run: () => setPlanOpen(true) }
    if (pendingQuestions().length > 0) {
      return { label: "回答问题", run: () => questionRef?.scrollIntoView({ block: "start", behavior: "smooth" }) }
    }
    if (directionState()?.status === "pending") {
      return { label: "裁定方向", run: () => directionRef?.scrollIntoView({ block: "start", behavior: "smooth" }) }
    }
    if (hasResult()) {
      return { label: "查看结果", run: () => resultRef?.scrollIntoView({ block: "start", behavior: "smooth" }) }
    }
    return null
  }

  const artifactChips = () => {
    const artifacts = timeline()?.artifacts
    if (!artifacts) return [] as string[]
    const chips: string[] = []
    if (artifacts.wavesPath) chips.push("waves.json")
    for (const receipt of artifacts.receipts ?? []) {
      const name = artifactName(String(receipt ?? ""))
      if (name) chips.push(name)
    }
    if (artifacts.reviewsDir) chips.push("review 报告")
    return Array.from(new Set(chips))
  }

  // attention 打开时展开/滚动到 action 对应区域（plan 直接开审阅浮层）。
  createEffect(() => {
    const focus = props.focus
    if (!focus || focus === "timeline") return
    if (focus === "plan") {
      if (timeline() && planEntry()) setPlanOpen(true)
      return
    }
    // 任务/问题/方向是异步加载的：订阅信号，等区域存在后再滚动。
    void pendingQuestions()
    void directionState()
    void hasResult()
    const timer = setTimeout(() => {
      const target = focus === "question" ? questionRef
        : focus === "direction" ? directionRef
        : focus === "result" ? resultRef
        : undefined
      target?.scrollIntoView({ block: "start", behavior: "smooth" })
    }, 30)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <Show when={props.goalId} keyed>
      <div class="mafw-goal-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-goal-panel">
          <div class="mafw-goal-head">
            <div class="mafw-goal-head-main">
              <div class="mafw-work-kicker">Goal · {stageText() || "工作项"}</div>
              <div class="mafw-card-title">{timeline()?.goal?.title || podGoal()?.title || props.goalId}</div>
              <div class="mafw-goal-id">{timeline()?.goal?.goalId || props.goalId}</div>
            </div>
            <ButtonV2
              variant="ghost"
              size="small"
              icon="close"
              onClick={props.onClose}
              aria-label="关闭详情"
            />
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
              <Show when={timeline()?.goal?.phase}>
                <span class={`mafw-phase-badge mafw-goal-chip is-phase ${phaseBadge()}`}>{timeline()?.goal?.phase}</span>
              </Show>
              <Show when={stageText()}>
                <span class="mafw-card-meta mafw-goal-chip">{stageText()}</span>
              </Show>
              <Show when={activeRevision() != null}>
                <span class="mafw-card-meta mafw-goal-chip">
                  revision {activeRevision()}
                  {currentRevision() ? ` · ${revisionStatusLabel(currentRevision()!.status)}` : ""}
                </span>
              </Show>
              <Show when={podGoal()?.strategy === "quick"}>
                <span class="mafw-card-meta mafw-goal-chip is-accent">快速执行</span>
              </Show>
              <Show when={podGoal()?.assessment === "unreviewed"}>
                <span class="mafw-card-meta mafw-goal-chip">未独立评审</span>
              </Show>
              <Show when={timeline()?.goal}>
                <span class="mafw-card-meta mafw-goal-chip">Loop {timeline()?.goal?.round ?? 0}/{timeline()?.goal?.maxRounds ?? "?"}</span>
              </Show>
              <Show when={elapsed() != null}><span class="mafw-card-meta mafw-goal-chip">已用 {formatDuration(elapsed())}</span></Show>
              <Show when={timeline()?.goal?.verdict}><span class="mafw-card-meta mafw-goal-chip">verdict {timeline()?.goal?.verdict}</span></Show>
              <Show when={!timeline()}><span class="mafw-card-meta mafw-goal-chip">尚无执行记录</span></Show>
              <Show when={planEntry()}>
                <ButtonV2 variant="outline" size="small" onClick={planEntry()!.onOpen}>
                  计划{planEntry()!.badge ? ` · ${planEntry()!.badge}` : ""}
                </ButtonV2>
              </Show>
            </div>

            <Show when={currentAction()}>
              {(action) => (
                <div class="mafw-goal-current-action">
                  <div>
                    <span class="mafw-work-kicker">当前行动</span>
                    <div class="mafw-goal-current-hint">处理完这一步，团队才能继续推进。</div>
                  </div>
                  <ButtonV2 variant="contrast" size="small" onClick={() => action().run()}>
                    {action().label}
                  </ButtonV2>
                </div>
              )}
            </Show>

            <Show when={pendingQuestions().length > 0}>
              <div class="mafw-goal-section" ref={(el) => { questionRef = el }} data-section="question">
                <div class="mafw-pod-section-head">
                  <span>需要你回答</span>
                  <span class="mafw-pod-section-count">{pendingQuestions().length}</span>
                </div>
                <For each={pendingQuestions()}>
                  {(question) => (
                    <div class="mafw-goal-question">
                      <div class="mafw-goal-question-text">{question.question}</div>
                      <TextInputV2
                        value={questionDrafts()[question.id] ?? ""}
                        placeholder="写下你的回答"
                        onInput={(event) => setQuestionDrafts((drafts) => ({ ...drafts, [question.id]: event.currentTarget.value }))}
                        onKeyDown={(event) => { if (event.key === "Enter") void answerQuestion(question.id) }}
                      />
                      <div class="mafw-goal-question-actions">
                        <ButtonV2
                          variant="outline"
                          size="small"
                          disabled={!(questionDrafts()[question.id] ?? "").trim() || questionBusy() === question.id}
                          onClick={() => void answerQuestion(question.id)}
                        >
                          {questionBusy() === question.id ? "提交中…" : "回答"}
                        </ButtonV2>
                        <ButtonV2
                          variant="ghost"
                          size="small"
                          disabled={questionBusy() === question.id}
                          onClick={() => void cancelQuestion(question.id)}
                        >
                          取消提问
                        </ButtonV2>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={showDirection()}>
              <div class="mafw-goal-section" ref={(el) => { directionRef = el }} data-section="direction">
                <PodDirectionPanel
                  state={directionState()}
                  revision={activeRevision()}
                  busy={directionBusy()}
                  onDecide={(input) => decideDirection(input)}
                />
              </div>
            </Show>

            <Show when={planEntry() || planTaskCount() > 0}>
              <div class="mafw-goal-section" data-section="plan">
                <Show when={!planGate().editable && planGate().reason}>
                  <div class="mafw-goal-hint">{planGate().reason}</div>
                </Show>
                <PodTaskBoard
                  scope="plan"
                  goalId={props.goalId}
                  tasks={tasks()}
                  members={members()}
                  busy={tableBusy()}
                  planEditable={planGate().editable}
                  onCreate={async () => false}
                  onCreatePlan={createPlanTask}
                  onEdit={editPlanTask}
                  onRenameNote={async () => false}
                  onDelete={deletePlanTask}
                  onOpenGoal={() => {}}
                />
              </div>
            </Show>

            <Show when={hasResult()}>
              <div class="mafw-goal-section" ref={(el) => { resultRef = el }} data-section="result">
                <div class="mafw-pod-section-head">
                  <span>结果</span>
                </div>
                <Show when={resolvedPodId() ?? podStore.detail()?.pod.id} fallback={<div class="mafw-empty">结果需要鲸群上下文</div>}>
                  {(podId) => (
                    <PodResultView
                      podId={podId()}
                      goalId={props.goalId!}
                      onResubmit={() => {
                        showToastV2({ description: "在鲸群「工作」页基于失败反馈重新提交", duration: 3200 })
                      }}
                      onReject={rejectGoal}
                    />
                  )}
                </Show>
              </div>
            </Show>

            <Show when={probes().length > 0}>
              <PodProbePanel
                probes={probes()}
                revision={activeRevision()}
                busy={directionBusy()}
                onOpenPlan={planEntry() ? () => setPlanOpen(true) : undefined}
              />
            </Show>

            <Show when={!hasResult() && revisionRows().length > 0}>
              <div class="mafw-pod-revisions mafw-goal-section">
                <div class="mafw-pod-section-head">
                  <span>版本历史</span>
                  <span class="mafw-pod-section-count">{revisionRows().length} 版</span>
                </div>
                <For each={revisionRows()}>
                  {(row) => (
                    <div class="mafw-pod-result-revision" classList={{ "is-current": row.current }}>
                      <span class="mafw-pod-result-revision-id">revision {row.revision}</span>
                      <span class="mafw-pod-result-revision-status">{row.statusLabel}</span>
                      <Show when={row.verdictLabel}>
                        <span class="mafw-pod-result-revision-verdict">{row.verdictLabel}</span>
                      </Show>
                      <Show when={row.feedback}>
                        <span class="mafw-pod-result-revision-feedback">{row.feedback}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={artifactChips().length > 0}>
              <div class="mafw-goal-artifacts">
                <span class="mafw-work-kicker">产物</span>
                <For each={artifactChips()}>{(name) => <code class="mafw-goal-artifact">{name}</code>}</For>
              </div>
            </Show>

            <Show when={(timeline()?.nodes || []).length} fallback={<div class="mafw-goal-empty">尚未开始执行</div>}>
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

            <Show when={!goalTerminal() && podGoal()?.status !== "done" && podGoal()?.status !== "aborted"}>
              <div class="mafw-goal-actions">
                <ButtonV2
                  variant="ghost" size="small"
                  onClick={() => {
                    if (!window.confirm("取消 Goal 会中止当前工作，旧 revision 结果仍保留。确认取消？")) return
                    window.api.mafw.goals.control({ goalId: props.goalId!, action: "ABORT" })
                      .catch((e: any) => console.warn("[mafw]", e))
                  }}
                >取消 Goal</ButtonV2>
              </div>
            </Show>
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
