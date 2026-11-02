// Task 21：结果循环的 UI 状态（已查看结果 + 打开请求）。
//
// 为什么是模块单例：结果面板在右栏 PodDock 里，而「通知/rail 点」在 MafwShell；
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
  const key = resultViewedKey(podId, goalId, revision)
  return viewedKeys().includes(key)
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

// ── 打开请求（SSE/通知侧 → 右栏面板） ─────────────────────────────────────

export type PodResultOpenRequest = { goalId: string; seq: number }

const [resultOpenRequest, setResultOpenRequest] = createSignal<PodResultOpenRequest | null>(null)

export function podResultOpenRequest(): PodResultOpenRequest | null {
  return resultOpenRequest()
}

/** 请求打开某个 Goal 的结果面板（seq 保证同一 Goal 再次触发也会被消费）。 */
export function requestPodResultOpen(goalId: string): void {
  if (!goalId) return
  setResultOpenRequest((prev) => ({ goalId, seq: (prev?.seq ?? 0) + 1 }))
}

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
