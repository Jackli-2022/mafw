// Task 21：结果循环的 UI 状态（已查看结果 + 打开请求）。
//
// 为什么是模块单例：结果面板在右工作台 PodDock 里，而「通知/rail 点」在 MafwShell；
// 两条 UI 树之间没有父子 props 通道（ExecutionView 只是透传层）。用一个小 store
// 表达「用户要打开哪个结果/哪个 Tech Lead」，比穿过三层 props 更不容易漏接线。
//
// 纯读写 helper（read/save）与 signal 分离：前者可在 node --test 里用假 storage 测。
import { createSignal } from "solid-js"
import {
  addViewedResult,
  parseViewedResults,
  resultViewedKey,
} from "./pod-rail-badge"
import { isResultViewed, podEvents, type PodEventsStore } from "./pod-events"

export const VIEWED_RESULTS_STORAGE_KEY = "mafw-pod-result-viewed:v1"

type StorageLike = Pick<Storage, "getItem" | "setItem">

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** 读取已查看结果键（坏 JSON / 无 storage → 空）。 */
export function readViewedResults(storage: StorageLike | null = defaultStorage()): string[] {
  try {
    return parseViewedResults(storage?.getItem(VIEWED_RESULTS_STORAGE_KEY) ?? null)
  } catch {
    return []
  }
}

/** 写入已查看结果键（fail-open：隐私模式/配额满不阻塞 UI）。 */
export function saveViewedResults(keys: string[], storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(VIEWED_RESULTS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    /* fail-open */
  }
}

const [viewedKeys, setViewedKeys] = createSignal<string[]>(readViewedResults())

export function podViewedResultKeys(): string[] {
  return viewedKeys()
}

export function isPodResultViewed(podId: string, goalId: string, revision: number): boolean {
  // 双读：`pod_events` 是新的真相源，legacy localStorage 只读兼容（spec §7）。
  return isResultViewed({
    podId,
    goalId,
    revision,
    events: podEvents.items(),
    legacy: viewedKeys(),
  })
}

/** 打开结果即视为已查看（点通知/rail 点/队列按钮同一口径）。 */
export function markPodResultViewed(podId: string, goalId: string, revision: number): void {
  const key = resultViewedKey(podId, goalId, revision)
  if (viewedKeys().includes(key)) return
  const next = addViewedResult(viewedKeys(), key)
  setViewedKeys(next)
  saveViewedResults(next)
}

/** 供测试重置（模块单例跨用例会串）。 */
export function resetPodResultViewed(): void {
  setViewedKeys(readViewedResults())
}

/**
 * 结果数据加载成功后才标记已查看（面板打开本身不算）。
 *
 * 之前 PodDock 在 `resultGoalId` 一设置就标记，结果接口失败/网关重启时用户什么都没看到，
 * rail 上的「有新结果」却已消失。这里把口径收敛到「确实拿到结果数据」：
 * - result 为空（加载失败）→ 不标记，返回 false；
 * - revision 以结果自带为准，缺失回退 Goal revision；都拿不到就不写（避免误标下一版）。
 *
 * 2026-11-04 Task 9：默认写 `pod_events`（seenAll，只清当前 revision）；旧 gateway
 * 没有事件路由时退回 legacy localStorage（特性门控，见 spec §7）。
 */
export function markResultViewedAfterLoad(input: {
  podId: string
  goalId: string
  result: { goalId?: string | null; revision?: number | null } | null | undefined
  fallbackRevision?: number | null
  mark?: (podId: string, goalId: string, revision: number) => void
  events?: Pick<PodEventsStore, "supported" | "markSeen">
}): boolean {
  if (!input.result) return false
  const revision = positiveRevision(input.result.revision) ?? positiveRevision(input.fallbackRevision)
  if (revision === null) return false
  const goalId = (input.result.goalId ?? input.goalId ?? "").trim() || input.goalId
  const markLegacy = input.mark ?? markPodResultViewed
  // 注入 mark 视为「测试里的 legacy 写点」；只有注入 events 才走事件路由。
  // 生产调用（PodResultView）两者都不传 → 默认全局 podEvents。
  const events = input.events ?? (input.mark ? null : podEvents)
  if (!events || !events.supported()) {
    markLegacy(input.podId, goalId, revision)
    return true
  }
  void events.markSeen(input.podId, goalId, revision)
    .then((ok) => {
      // seenAll 才发现路由缺失（明细列表还没拉过）：补写 legacy，别让角标永远清不掉。
      if (!ok && !events.supported()) markLegacy(input.podId, goalId, revision)
    })
    .catch(() => { /* 标记已查看是 best-effort；失败时结果点保留，用户可重试 */ })
  return true
}

function positiveRevision(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

// ── 打开请求（SSE/通知侧 → Tech Lead 讨论） ───────────────────────────────

export type PodTechLeadOpenRequest = { goalId: string; revision: number | null; seq: number }

const [techLeadOpenRequest, setTechLeadOpenRequest] = createSignal<PodTechLeadOpenRequest | null>(null)

export function podTechLeadOpenRequest(): PodTechLeadOpenRequest | null {
  return techLeadOpenRequest()
}

/** 打回成功后：打开同一 Goal 的 Tech Lead 讨论（新 revision 的会话由 gateway 确保）。 */
export function requestPodTechLeadOpen(goalId: string, revision: number | null): void {
  if (!goalId) return
  setTechLeadOpenRequest((prev) => ({ goalId, revision, seq: (prev?.seq ?? 0) + 1 }))
}
