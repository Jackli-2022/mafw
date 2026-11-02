import { createSignal } from "solid-js"
import type {
  PodCreateGoalInput, PodCreateGoalResult, PodDetail, PodGoal, PodGoalResult, PodMessage, PodStatus,
  PodTechLeadHistory,
} from "@mafw/sdk"
import { podEventAction, podIsUnsupported, podRouteMissing } from "./pod-model"

// ── Task 19：Lead 入口与 Tech Lead 讨论入口的纯逻辑 ──
// 这里只放判定/文案（可单测、不读写 signal）；tab 打开与隐藏会话生命周期归 MafwShell。

/** 用户可见的协调入口文案。Manager 已退役（kv/API 名保持内部兼容），界面只称 Lead。 */
export function leadEntryLabel(): "Lead" {
  return "Lead"
}

/** 邀请卡动作文案：单源，测试钉死字面量。 */
export const TECH_LEAD_INVITE_LABEL = "与 Tech Lead 讨论"

/** Goal stage 的宽松形状（网关已投影 role；旧 gateway 可能缺 stage/role）。 */
export type TechLeadStageLike = { kind?: string | null; role?: string | null } | null | undefined

/**
 * Lead 会话里的 Tech Lead 入口判定。
 *
 * 只有 `discussing` 阶段的 Goal 才需要「去和 Tech Lead 讨论」——这时 NodeDriver 还没
 * 开始跑，Lead 不负责技术方案讨论（spec §3.1）。其他阶段/角色一律不提示，避免把用户
 * 引回已经进入规划/执行/审阅的 Goal。
 */
export function techLeadInvite(
  goal: { stage?: TechLeadStageLike } | null | undefined,
  goalID: string,
): { goalId: string; label: string } | null {
  if (!goalID) return null
  const stage = goal?.stage
  if (!stage || stage.kind !== "discussing") return null
  if (stage.role && stage.role !== "tech_lead") return null
  return { goalId: goalID, label: TECH_LEAD_INVITE_LABEL }
}

/** Tech Lead tab 标题：由 Goal 标题派生，绝不含 runtime session id。
 *  新 revision（打回后的讨论）在标题上带 `rev N`，让用户知道在讨论哪一版。 */
export function techLeadTabTitle(title?: string | null, revision?: number | null): string {
  const goalTitle = (title ?? "").trim()
  const suffix = typeof revision === "number" && Number.isFinite(revision) && revision > 1
    ? ` · rev ${Math.floor(revision)}`
    : ""
  return `Tech Lead · ${goalTitle || "未命名目标"}${suffix}`
}

/**
 * Tech Lead 讨论的发送目标（Task 20）：只有当前 tab 确实绑定到某个 Goal、且 Pod
 * 已知时才返回。发送必须经 `pod.sendTechLeadMessage`——它注入 Tech Lead agent 身份与
 * 当前 revision 的 ContextManifest；普通 `sessions.promptAsync` 会丢掉这两者。
 */
export function techLeadSendTarget(
  goalId: string | null | undefined,
  podId: string | null | undefined,
): { podId: string; goalId: string } | null {
  const goal = (goalId ?? "").trim()
  const pod = (podId ?? "").trim()
  if (!goal || !pod) return null
  return { podId: pod, goalId: goal }
}

/**
 * 完整 Pod 详情解析（发送守卫/方向裁定用）：跨项目时不信任 store 里的旧 detail。
 * 显式 loaded detail 优先；否则按项目目录 lookup；失败 fail-open（null）。
 */
export async function resolvePodDetail(options: {
  loaded?: PodDetail | null
  projectDir?: string | null
  lookup?: (projectDir: string) => Promise<PodDetail>
}): Promise<PodDetail | null> {
  if (options.loaded) return options.loaded
  const dir = (options.projectDir ?? "").trim()
  if (!dir || !options.lookup) return null
  try {
    return await options.lookup(dir)
  } catch {
    return null
  }
}

/**
 * 短 TTL 的 Pod 详情解析（发送路径用）：同一次发送的 target/blocked 两次调用只
 * lookup 一次；并发调用共享同一个 in-flight promise。null 结果只在 TTL 内复用
 * （不是永久缓存），TTL 过后重新探测。
 */
const POD_DETAIL_TTL_MS = 5_000
let podDetailCache: { key: string; at: number; detail: PodDetail | null } | null = null
let podDetailInflight: { key: string; promise: Promise<PodDetail | null> } | null = null

export function resetPodDetailCache(): void {
  podDetailCache = null
  podDetailInflight = null
}

export async function resolvePodDetailCached(options: {
  loaded?: PodDetail | null
  projectDir?: string | null
  lookup?: (projectDir: string) => Promise<PodDetail>
  now?: () => number
  ttlMs?: number
  /** 缓存键（缺省 = 项目目录）；项目切换/Pod 身份变化时应不同。 */
  key?: string
}): Promise<PodDetail | null> {
  if (options.loaded) return options.loaded
  const dir = (options.projectDir ?? "").trim()
  if (!dir || !options.lookup) return null
  const key = (options.key ?? dir).trim()
  const now = options.now ? options.now() : Date.now()
  const ttl = options.ttlMs ?? POD_DETAIL_TTL_MS
  if (podDetailCache?.key === key && now - podDetailCache.at < ttl) return podDetailCache.detail
  if (podDetailInflight?.key === key) return podDetailInflight.promise
  const lookup = options.lookup
  const promise = (async (): Promise<PodDetail | null> => {
    try {
      return await lookup(dir)
    } catch {
      return null
    } finally {
      if (podDetailInflight?.key === key) podDetailInflight = null
    }
  })()
  podDetailInflight = { key, promise }
  const detail = await promise
  podDetailCache = { key, at: now, detail }
  return detail
}

/**
 * 组件级 Pod id 解析器（Goal 详情 / 计划审阅）：只缓存**命中**，null 每次重新探测；
 * 同一 key 的并发调用共享 in-flight promise（不会重复 lookup）。
 */
export function createPodIdResolver(deps: {
  lookup: (projectDir: string) => Promise<{ pod: { id: string } }>
}) {
  const hits = new Map<string, string>()
  const inflight = new Map<string, Promise<string | null>>()
  return async function resolve(options: {
    podId?: string | null
    loadedPodId?: string | null
    projectDir?: string | null
  }): Promise<string | null> {
    const explicit = (options.podId ?? "").trim()
    if (explicit) return explicit
    const loaded = (options.loadedPodId ?? "").trim()
    if (loaded) return loaded
    const dir = (options.projectDir ?? "").trim()
    if (!dir) return null
    const key = podResolveKey({
      podId: explicit,
      projectDir: dir,
      loadedPodId: loaded,
    })
    const hit = hits.get(key)
    if (hit) return hit
    const pending = inflight.get(key)
    if (pending) return pending
    const promise = (async (): Promise<string | null> => {
      try {
        const detail = await deps.lookup(dir)
        const id = detail?.pod?.id?.trim() || null
        // 只缓存命中：Pod 未建立时后续调用必须能重新探测。
        if (id) hits.set(key, id)
        return id
      } catch {
        return null
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, promise)
    return promise
  }
}

/** 解析缓存键：项目/显式 podId/已加载 Pod 任一变化都必须重新解析（不跨项目复用）。 */
export function podResolveKey(input: {
  podId?: string | null
  projectDir?: string | null
  loadedProjectDir?: string | null
  loadedPodId?: string | null
}): string {
  return [input.podId ?? "", input.projectDir ?? "", input.loadedProjectDir ?? "", input.loadedPodId ?? ""]
    .map((part) => part.trim())
    .join("|")
}

/**
 * Pod id 解析（Task 20 review #3）：显式 prop → 已加载的 Pod store → 按项目目录
 * `pod.lookup`。这样 Goal 详情/计划审阅在 Pod 面板未打开时也能拿到 Spike 证据。
 */
export async function resolvePodId(options: {
  podId?: string | null
  loadedPodId?: string | null
  projectDir?: string | null
  lookup?: (projectDir: string) => Promise<{ pod: { id: string } }>
}): Promise<string | null> {
  const explicit = (options.podId ?? "").trim()
  if (explicit) return explicit
  const loaded = (options.loadedPodId ?? "").trim()
  if (loaded) return loaded
  const dir = (options.projectDir ?? "").trim()
  if (!dir || !options.lookup) return null
  try {
    const detail = await options.lookup(dir)
    return detail?.pod?.id ?? null
  } catch {
    return null
  }
}

export type PodStoreApi = {
  lookup(projectDir: string): Promise<PodDetail>
  ensure(projectDir: string): Promise<PodDetail>
  get(podId: string): Promise<PodDetail>
  update(podId: string, body: { status: PodStatus }): Promise<PodDetail>
  createGoal(podID: string, body: PodCreateGoalInput): Promise<PodCreateGoalResult>
  result(podID: string, goalID: string): Promise<PodGoalResult>
  cancelGoal(podID: string, goalID: string): Promise<{ goal: PodGoal }>
  pause(podId: string): Promise<PodDetail>
  resume(podId: string): Promise<PodDetail>
  wake(podId: string): Promise<PodDetail>
  sleep(podId: string): Promise<PodDetail>
  cost(podId: string): Promise<{ spentUsd: number; limitUsd: number }>
  listMessages(podId: string): Promise<{ items: PodMessage[] }>
  markRead(podId: string, messageId: string): Promise<{ message: PodMessage }>
  /** Task 18：Goal 的 Tech Lead 讨论历史（GET 会确保隐藏会话存在）。 */
  techLead(podID: string, goalID: string, limit?: number): Promise<PodTechLeadHistory>
}

export type PodStoreTimers = {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const DEFAULT_TIMERS: PodStoreTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as any),
}

function errorMessage(err: unknown): string {
  return String((err as any)?.message ?? err)
}

export function createPodStore(
  api: PodStoreApi,
  opts: { debounceMs?: number; timers?: PodStoreTimers } = {},
) {
  const debounceMs = opts.debounceMs ?? 200
  const timers = opts.timers ?? DEFAULT_TIMERS

  const [detail, setDetail] = createSignal<PodDetail | null>(null)
  const [cost, setCost] = createSignal<{ spentUsd: number; limitUsd: number } | null>(null)
  const [messages, setMessages] = createSignal<PodMessage[]>([])
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [unsupported, setUnsupported] = createSignal(false)
  const [projectDir, setProjectDir] = createSignal<string | null>(null)

  let seq = 0
  let timer: unknown = null
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (fn: () => void) => {
    clearTimer()
    timer = timers.setTimeout(() => {
      timer = null
      if (!disposed) fn()
    }, debounceMs)
  }

  const loadCost = (id: string, my: number) => {
    void api.cost(id)
      .then((next) => {
        if (!disposed && my === seq) setCost(next)
      })
      .catch(() => {
        if (!disposed && my === seq) setCost(null)
      })
  }

  const loadMessages = (id: string, my: number) => {
    void api.listMessages(id)
      .then((next) => {
        if (!disposed && my === seq) setMessages(next.items ?? [])
      })
      .catch(() => {
        if (!disposed && my === seq) setMessages([])
      })
  }

  const normalizeDetail = (next: PodDetail): PodDetail => {
    const rawGoals = Array.isArray(next.goals) ? next.goals : []
    const stageSupported = Array.isArray((next as any).attention) && rawGoals.every((goal) => !!goal.stage)
    const goals = rawGoals.map((goal) => ({
      ...goal,
      title: goal.title || "未命名目标",
      phase: goal.phase ?? null,
      verdict: goal.verdict ?? null,
      stage: goal.stage ?? { owner: "system" as const, kind: "waiting" as const },
      resultReady: goal.resultReady ?? false,
    }))
    const tasks = (Array.isArray(next.tasks) ? next.tasks : []).map((task) => ({
      ...task,
      kind: task.kind
        ?? (task.goalId && task.externalTaskId
          ? "plan"
          : (task.sourceKey ?? "").startsWith("manual:")
            ? "note"
            : "external_request"),
    }))
    return {
      ...next,
      stageSupported,
      goals,
      tasks,
      attention: Array.isArray((next as any).attention) ? next.attention : [],
      messageHealth: Array.isArray((next as any).messageHealth) ? next.messageHealth : [],
    }
  }

  const applyDetail = (next: PodDetail, my: number) => {
    if (disposed || my !== seq) return
    next = normalizeDetail(next)
    setDetail(next)
    setError(null)
    loadCost(next.pod.id, my)
    loadMessages(next.pod.id, my)
  }

  async function open(dir: string): Promise<void> {
    if (disposed) return
    if (dir === projectDir() && detail()) return
    const switching = dir !== projectDir()
    if (switching) {
      seq++
      clearTimer()
      setProjectDir(dir)
      setDetail(null)
      setCost(null)
      setMessages([])
      setError(null)
      setUnsupported(false)
    }
    const my = seq
    setLoading(true)
    try {
      const next = await api.lookup(dir)
      if (disposed || my !== seq) return
      setUnsupported(false)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      if (podRouteMissing(err)) {
        setDetail(null)
        setCost(null)
        setMessages([])
        setUnsupported(true)
        setError(null)
      } else if (podIsUnsupported(err) || /pod not found/i.test(errorMessage(err))) {
        setDetail(null)
        setCost(null)
        setMessages([])
        setError(null)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      if (!disposed && my === seq) setLoading(false)
    }
  }

  async function create(): Promise<void> {
    const dir = projectDir()
    if (!dir || disposed) return
    const my = seq
    setLoading(true)
    try {
      const next = await api.ensure(dir)
      if (disposed || my !== seq) return
      setUnsupported(false)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      if (podIsUnsupported(err)) {
        setUnsupported(true)
        setError("当前 gateway 不支持 Pod，请更新 gateway")
      } else {
        setError(errorMessage(err))
      }
    } finally {
      if (!disposed && my === seq) setLoading(false)
    }
  }

  async function refresh(): Promise<void> {
    const current = detail()
    if (!current || disposed || refreshing()) return
    const my = seq
    setRefreshing(true)
    try {
      const next = await api.get(current.pod.id)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      setError(errorMessage(err))
    } finally {
      if (!disposed) setRefreshing(false)
    }
  }

  async function setStatus(status: PodStatus): Promise<void> {
    const current = detail()
    if (!current || disposed || refreshing()) return
    const my = seq
    setRefreshing(true)
    try {
      const next = status === "active"
        ? await api.resume(current.pod.id)
        : status === "paused"
          ? await api.pause(current.pod.id)
          : await api.update(current.pod.id, { status })
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      setError(errorMessage(err))
    } finally {
      if (!disposed) setRefreshing(false)
    }
  }

  async function createGoal(body: PodCreateGoalInput): Promise<PodCreateGoalResult> {
    const current = detail()
    if (!current || disposed) throw new Error("pod unavailable")
    const result = await api.createGoal(current.pod.id, body)
    await refresh()
    return result
  }

  async function result(goalID: string): Promise<PodGoalResult> {
    const current = detail()
    if (!current || disposed) throw new Error("pod unavailable")
    return api.result(current.pod.id, goalID)
  }

  async function cancelGoal(goalID: string): Promise<{ goal: PodGoal }> {
    const current = detail()
    if (!current || disposed) throw new Error("pod unavailable")
    const result = await api.cancelGoal(current.pod.id, goalID)
    await refresh()
    return result
  }

  async function markRead(messageId: string): Promise<boolean> {
    const current = detail()
    if (!current || disposed) return false
    const previous = messages()
    const optimistic = new Date().toISOString()
    setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, readAt: optimistic } : message)))
    try {
      const next = await api.markRead(current.pod.id, messageId)
      if (disposed) return false
      const readAt = next?.message?.readAt ?? optimistic
      setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, readAt } : message)))
      return true
    } catch (err) {
      // 旧 gateway 没有 read 路由：静默回滚（spec 冒烟项 #8）；其余失败记录但不抛出
      // （调用点是 void，抛出会变成 unhandled rejection）。
      if (!disposed) {
        setMessages(previous)
        if (!podRouteMissing(err)) setError(errorMessage(err))
      }
      return false
    }
  }

  async function techLead(goalID: string): Promise<PodTechLeadHistory> {
    const current = detail()
    if (!current || disposed) throw new Error("pod unavailable")
    // 隐藏会话 id 只在调用方（MafwShell）短暂持有并用于打开 tab，不缓存进 store——
    // 它不是可枚举的 Pod 会话，缓存会让「已关闭/已重建」的旧 id 复活。
    return api.techLead(current.pod.id, goalID)
  }

  function ingest(event: unknown): void {
    if (disposed) return
    const action = podEventAction({
      currentPodId: detail()?.pod.id ?? null,
      projectDir: projectDir(),
      event,
    })
    if (action === "refresh") {
      schedule(() => { void refresh() })
    } else if (action === "lookup") {
      schedule(() => {
        const dir = projectDir()
        if (dir) void open(dir)
      })
    }
  }

  function dispose(): void {
    disposed = true
    seq++
    clearTimer()
  }

  return {
    open,
    create,
    refresh,
    setStatus,
    createGoal,
    result,
    cancelGoal,
    markRead,
    techLead,
    ingest,
    dispose,
    detail,
    cost,
    messages,
    loading,
    refreshing,
    busy: () => loading() || refreshing(),
    error,
    unsupported,
    projectDir,
  }
}

const defaultApi: PodStoreApi = {
  lookup: (projectDir) => window.api.mafw.pod.lookup(projectDir),
  ensure: (projectDir) => window.api.mafw.pod.ensure(projectDir),
  get: (podId) => window.api.mafw.pod.get(podId),
  update: (podId, body) => window.api.mafw.pod.update(podId, body),
  createGoal: (podId, body) => window.api.mafw.pod.createGoal(podId, body),
  result: (podId, goalID) => window.api.mafw.pod.result(podId, goalID),
  cancelGoal: (podId, goalID) => window.api.mafw.pod.cancelGoal(podId, goalID),
  pause: (podId) => window.api.mafw.pod.pause(podId),
  resume: (podId) => window.api.mafw.pod.resume(podId),
  wake: (podId) => window.api.mafw.pod.wake(podId),
  sleep: (podId) => window.api.mafw.pod.sleep(podId),
  cost: (podId) => window.api.mafw.pod.cost(podId),
  listMessages: (podId) => window.api.mafw.pod.listMessages(podId),
  markRead: (podId, messageId) => window.api.mafw.pod.markRead(podId, messageId),
  techLead: (podID, goalID, limit) => window.api.mafw.pod.techLead(podID, goalID, limit),
}

export const podStore = createPodStore(defaultApi)

export function ingestPodEvent(event: unknown): void {
  podStore.ingest(event)
}
