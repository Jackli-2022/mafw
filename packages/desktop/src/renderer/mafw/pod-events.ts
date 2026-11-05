// packages/desktop/src/renderer/mafw/pod-events.ts
// Human-facing view of pod events. `viewedResults` (localStorage) is read-only
// legacy: new state lives in `pod_events`, but old unviewed results must not
// disappear on upgrade.
import { createSignal } from "solid-js"
import { resultViewedKey } from "./pod-rail-badge"

export interface PodEventItem {
  id: string
  podId?: string
  goalId: string | null
  revision: number | null
  kind: string
  severity: "p1" | "p2" | "p3"
  title: string
  summary: string | null
  state: "unread" | "seen"
  createdAt: string
}

/**
 * 双读已查看判定（spec 2026-11-04 §7）：
 * events 里同 goal+revision 已 seen → 已查看；否则 legacy `viewedResults` 键命中 → 已查看。
 * 存量未查看结果（升级前只写 localStorage）因此不会丢，随查看自然收敛。
 */
export function isResultViewed(input: {
  podId: string
  goalId: string
  revision: number
  events: readonly PodEventItem[]
  legacy: readonly string[]
}): boolean {
  const seenInEvents = input.events.some(
    (event) =>
      event.goalId === input.goalId &&
      // 事件带 podId 时必须同 Pod（切换项目时同名 goal id 不能互相顶账）。
      (!event.podId || event.podId === input.podId) &&
      event.revision === input.revision &&
      event.state === "seen",
  )
  if (seenInEvents) return true
  return input.legacy.includes(resultViewedKey(input.podId, input.goalId, input.revision))
}

/** Only a successfully loaded result may clear the unread marker. */
export function shouldMarkSeen(result: { status: "fulfilled" | "rejected" | "pending" }): boolean {
  return result.status === "fulfilled"
}

/** Inbox order: p1 first, then newest first. */
export function listUnread(events: readonly PodEventItem[]): PodEventItem[] {
  const weight = (event: PodEventItem) => (event.severity === "p1" ? 0 : 1)
  return events
    .filter((event) => event.state === "unread")
    .slice()
    .sort((a, b) => weight(a) - weight(b) || b.createdAt.localeCompare(a.createdAt))
}

export interface PodEventsPage {
  items: PodEventItem[]
  unread: number
}

export interface PodEventsApi {
  list(podId: string, opts: { state?: "unread"; limit?: number }): Promise<PodEventsPage>
  seenAll(podId: string, goalId: string, revision: number): Promise<unknown>
}

export interface PodEventsStore {
  /** 当前 Pod 的未读事件（server truth，最近 200 条）。 */
  items(): PodEventItem[]
  unreadCount(): number
  /** false = 旧 gateway 没有事件路由（特性门控：退回纯 resultReady + legacy localStorage）。 */
  supported(): boolean
  podId(): string | null
  /** 项目/Pod 切换：换 Pod 时清空，绝不把上一个项目的结果点带过去。 */
  setPod(podId: string | null): void
  refresh(podId?: string): Promise<void>
  /** `pod.event` SSE → 本地先落一条（角标立即动），再拉 server truth。 */
  ingest(event: unknown): boolean
  /** 结果加载成功后清当前 goal+revision 的未读（乐观 + 失败回滚）。 */
  markSeen(podId: string, goalId: string, revision: number): Promise<boolean>
  reset(): void
}

function httpStatusOf(err: unknown): number | null {
  const message = String((err as any)?.message ?? err)
  const match = message.match(/HTTP (\d{3})/)
  return match ? Number(match[1]) : null
}

/** 旧 gateway 的事件路由缺失（404 或反代 HTML 回退页），与「网关抖了一下」不同。 */
function routeMissing(err: unknown): boolean {
  const message = String((err as any)?.message ?? err)
  return httpStatusOf(err) === 404 || /older than the SDK|Received HTML instead of JSON/i.test(message)
}

function seenMarker(podId: string, goalId: string, revision: number): PodEventItem {
  return {
    id: `seen:${goalId}:${revision}`,
    podId,
    goalId,
    revision,
    kind: "goal.result",
    severity: "p1",
    title: "",
    summary: null,
    state: "seen",
    createdAt: new Date().toISOString(),
  }
}

export function createPodEventsStore(api: PodEventsApi): PodEventsStore {
  const [items, setItems] = createSignal<PodEventItem[]>([])
  const [supported, setSupported] = createSignal(true)
  const [currentPod, setCurrentPod] = createSignal<string | null>(null)
  let seq = 0
  let inflight: Promise<void> | null = null
  let inflightPod: string | null = null
  let queued = false

  function setPod(podId: string | null): void {
    const next = podId || null
    if (currentPod() === next) return
    setCurrentPod(next)
    seq++
    setItems([])
  }

  async function fetchPage(podId: string): Promise<void> {
    const my = ++seq
    try {
      // 不带 state 过滤：已 seen 的事件也要拿回来（否则重启后角标会「复活」）。
      const page = await api.list(podId, { limit: 200 })
      if (my !== seq || currentPod() !== podId) return
      const server = Array.isArray(page?.items) ? page.items : []
      // 本地已知的 seen（刚点开结果、还没被下一次刷新覆盖）不能被 server 分页挤掉。
      setItems((prev) => {
        const keptSeen = prev.filter(
          (item) => item.state === "seen" && !server.some((next) => next.id === item.id),
        )
        return [...server, ...keptSeen].slice(0, 200)
      })
      setSupported(true)
    } catch (err) {
      if (my !== seq || currentPod() !== podId) return
      if (routeMissing(err)) {
        setSupported(false)
        setItems([])
      }
      // 其余失败 fail-open：保留上一次快照——网关抖了一下不等于结果已看过。
    }
  }

  async function refresh(podId?: string): Promise<void> {
    const target = podId ?? currentPod()
    if (!target || target !== currentPod()) return
    if (inflight && inflightPod === target) {
      queued = true
      return inflight
    }
    const run = fetchPage(target)
    inflight = run
    inflightPod = target
    try {
      await run
    } finally {
      if (inflight === run) {
        inflight = null
        inflightPod = null
      }
      if (queued) {
        queued = false
        void refresh(target)
      }
    }
  }

  function ingest(event: unknown): boolean {
    const raw = event as any
    if (raw?.type !== "pod.event") return false
    const props = raw.properties ?? {}
    const podId = typeof props.podId === "string" ? props.podId : ""
    // 其他项目的事件消费掉但不入库（dispatcher 已按类型分流，别让它们 missTrace）。
    if (!podId || podId !== currentPod()) return true
    const id = typeof props.eventId === "string" ? props.eventId : ""
    if (!id) return true
    const revision = Number(props.revision)
    const item: PodEventItem = {
      id,
      podId,
      goalId: typeof props.goalId === "string" && props.goalId ? props.goalId : null,
      revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null,
      kind: typeof props.kind === "string" ? props.kind : "unknown",
      severity: props.severity === "p1" || props.severity === "p2" ? props.severity : "p3",
      title: "",
      summary: null,
      state: "unread",
      createdAt: new Date().toISOString(),
    }
    setItems((prev) => (prev.some((existing) => existing.id === id) ? prev : [item, ...prev].slice(0, 200)))
    void refresh(podId)
    return true
  }

  async function markSeen(podId: string, goalId: string, revision: number): Promise<boolean> {
    if (!podId) return false
    // Goal 详情可能在 podStore 解析前打开：首次标记时采纳这个 Pod（之后由 shell 的
    // effect 维持作用域），绝不把别的 Pod 的未读带进来。
    if (currentPod() === null) setCurrentPod(podId)
    if (podId !== currentPod()) return false
    const matches = (item: PodEventItem) => item.goalId === goalId && item.revision === revision
    const previous = items()
    const matching = previous.filter(matches)
    if (matching.length > 0 && matching.every((item) => item.state === "seen")) return true
    setItems((prev) => {
      if (prev.some(matches)) {
        return prev.map((item) => (item.state === "unread" && matches(item) ? { ...item, state: "seen" } : item))
      }
      // 本地还没有这条事件（inbox 没拉过/分页外）：补一条 seen 标记，角标立即收敛；
      // 下一次刷新用 server truth 覆盖。
      return [seenMarker(podId, goalId, revision), ...prev].slice(0, 200)
    })
    try {
      await api.seenAll(podId, goalId, revision)
      // 成功路径必须重新落 seen：await 期间可能有一次刷新（另一条 pod.event）带回了
      // 提交前的 unread 快照；只靠乐观写会让角标在「已成功清过」后复活且不自愈。
      if (currentPod() === podId) {
        setItems((prev) => {
          if (prev.some(matches)) {
            return prev.map((item) => (matches(item) ? { ...item, state: "seen" } : item))
          }
          // 并发刷新把事件挤掉了：补一条 seen 标记，保证「成功清过」不会被下一次刷新复活。
          return [seenMarker(podId, goalId, revision), ...prev].slice(0, 200)
        })
      }
      return true
    } catch (err) {
      // 接口失败必须回滚：角标清了但用户什么都没看到是更糟的状态。
      // 只回滚同一个 Pod（切换项目后不能把上一个 Pod 的列表塞进新 Pod）。
      if (currentPod() === podId) setItems(previous)
      if (routeMissing(err)) setSupported(false)
      return false
    }
  }

  function reset(): void {
    seq++
    setCurrentPod(null)
    setItems([])
    setSupported(true)
  }

  return {
    items,
    unreadCount: () => listUnread(items()).length,
    supported,
    podId: currentPod,
    setPod,
    refresh,
    ingest,
    markSeen,
    reset,
  }
}

const defaultApi: PodEventsApi = {
  list: (podId, opts) => window.api.mafw.pod.events.list(podId, opts),
  seenAll: (podId, goalId, revision) => window.api.mafw.pod.events.seenAll(podId, goalId, revision),
}

export const podEvents = createPodEventsStore(defaultApi)
