// 批注反馈标记（spec 2026-10-27 预览批注 · 回路闭合在原地）：
// 立即发送 → pending；本会话回合结束（turn.completed）→ responded。按 sessionID 隔离。
import { createSignal } from "solid-js"
import type { AnnotationAnchor } from "../../shared/annotation-types"

export type AnnotationMarkStatus = "pending" | "responded"
export type AnnotationMark = {
  id: string
  rel: string
  anchor?: AnnotationAnchor
  status: AnnotationMarkStatus
  createdAt: number
}

const [rev, setRev] = createSignal(0)
const bySession = new Map<string, AnnotationMark[]>()
const bump = () => setRev((v) => v + 1)

export function addMark(sessionID: string, rel: string, anchor?: AnnotationAnchor): AnnotationMark {
  const mark: AnnotationMark = {
    id: `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    rel,
    anchor,
    status: "pending",
    createdAt: Date.now(),
  }
  bySession.set(sessionID, [...(bySession.get(sessionID) ?? []), mark])
  bump()
  return mark
}

export function marksFor(sessionID: string, rel: string): AnnotationMark[] {
  rev() // 订阅
  return (bySession.get(sessionID) ?? []).filter((m) => m.rel === rel)
}

export function markResponded(sessionID: string): void {
  const list = bySession.get(sessionID)
  if (!list || list.length === 0) return
  if (!list.some((m) => m.status === "pending")) return
  bySession.set(sessionID, list.map((m) => (m.status === "pending" ? { ...m, status: "responded" } : m)))
  bump()
}

export function clearMarks(sessionID: string): void {
  if (!bySession.has(sessionID)) return
  bySession.delete(sessionID)
  bump()
}

export function resetMarks(): void {
  bySession.clear()
  bump()
}
