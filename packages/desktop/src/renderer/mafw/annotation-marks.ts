// 批注反馈标记（spec 2026-10-27 预览批注 · 回路闭合在原地）：
// 立即发送 → pending；本会话回合结束（turn.completed）→ responded。按 sessionID 隔离。
import { createSignal } from "solid-js"
import type { AnnotationAnchor } from "../../shared/annotation-types"

export type AnnotationMarkStatus = "pending" | "responded"
/** 锚点原地标记（rev2）：文字高亮矩形 / 单点标记（相对 editor-body 的 px）。 */
export type MarkVisual = {
  rects?: { x: number; y: number; w: number; h: number }[]
  point?: { x: number; y: number }
}
export type AnnotationMark = {
  id: string
  /** 关联的 pending Annotation id；用于删除/发送后同步移除高亮。 */
  annotationID?: string
  rel: string
  anchor?: AnnotationAnchor
  status: AnnotationMarkStatus
  createdAt: number
  /** 创建时所属回合序号（I4：只翻转早于本回合起点创建的 mark）。 */
  seq: number
  visual?: MarkVisual
}

const [rev, setRev] = createSignal(0)
const bySession = new Map<string, AnnotationMark[]>()
/** 回合序号：noteTurnActivity 在每回合首个活动帧 +1；mark.seq 记录创建时序号。 */
const turnSeq = new Map<string, number>()
const turnOpen = new Set<string>()
const bump = () => setRev((v) => v + 1)

/** 回合活动标记：每回合首个非终态事件到达时推进序号。 */
export function noteTurnActivity(sessionID: string): void {
  if (!sessionID || turnOpen.has(sessionID)) return
  turnOpen.add(sessionID)
  turnSeq.set(sessionID, (turnSeq.get(sessionID) ?? 0) + 1)
}

export function addMark(
  sessionID: string,
  rel: string,
  anchor?: AnnotationAnchor,
  visual?: MarkVisual,
  annotationID?: string,
): AnnotationMark {
  const mark: AnnotationMark = {
    id: `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    annotationID,
    rel,
    anchor,
    status: "pending",
    createdAt: Date.now(),
    seq: turnSeq.get(sessionID) ?? 0,
    visual,
  }
  bySession.set(sessionID, [...(bySession.get(sessionID) ?? []), mark].slice(-50))
  bump()
  return mark
}

/** 删除某条 pending 批注的高亮（删除/发送后调用）。 */
export function removeMarkByAnnotation(sessionID: string, annotationID: string): void {
  const list = bySession.get(sessionID)
  if (!list) return
  const next = list.filter((m) => m.annotationID !== annotationID)
  if (next.length === list.length) return
  bySession.set(sessionID, next)
  bump()
}

export function marksFor(sessionID: string, rel: string): AnnotationMark[] {
  rev() // 订阅
  return (bySession.get(sessionID) ?? []).filter((m) => m.rel === rel)
}

/** 会话内全部文件的 mark（发送/删除批注后清理高亮用）。 */
export function marksForSession(sessionID: string): AnnotationMark[] {
  rev() // 订阅
  return [...(bySession.get(sessionID) ?? [])]
}

export function markResponded(sessionID: string): void {
  const list = bySession.get(sessionID)
  const current = turnSeq.get(sessionID) ?? 0
  turnOpen.delete(sessionID)
  if (!list || list.length === 0) return
  // 无回合序号（历史 mark / 测试直发）时全翻；有回合时只翻早于本回合创建的。
  const shouldFlip = (m: AnnotationMark) => m.status === "pending" && (current === 0 || m.seq < current)
  if (!list.some(shouldFlip)) return
  bySession.set(sessionID, list.map((m) => (shouldFlip(m) ? { ...m, status: "responded" } : m)))
  bump()
}

export function clearMarks(sessionID: string): void {
  if (!bySession.has(sessionID)) return
  bySession.delete(sessionID)
  bump()
}

export function resetMarks(): void {
  bySession.clear()
  turnSeq.clear()
  turnOpen.clear()
  bump()
}
