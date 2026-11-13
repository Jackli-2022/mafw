// 讨论 turn → 左栏“改动”树的一个可展开项；纯函数，便于单测。
import type { MafwMessage } from "@mafw/sdk"
import type { FileDiffEntry } from "../components/DiffReviewPanel"
import { promptTextOf } from "../components/checkpoint-model"
import { isLocalMessageId } from "../chat/local-id"

export type SessionTurnChange = {
  id: string
  title: string
  timeLabel: string
  createdAt: number | null
  files: FileDiffEntry[]
  additions: number
  deletions: number
}

function createdOf(message: MafwMessage): number {
  const value = message?.time?.created
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function turnTimeLabel(created: number | null): string {
  if (!created) return ""
  const date = new Date(created)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

export function turnTitle(text: string, max = 40): string {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
  if (!first) return "(无文本)"
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export function buildSessionTurnChanges(
  messages: readonly MafwMessage[],
  parts: Record<string, any[] | undefined>,
  perTurn: Record<string, FileDiffEntry[] | null>,
  maxTurns = 30,
): SessionTurnChange[] {
  const items = (Array.isArray(messages) ? messages : [])
    .map((message, index) => ({ message, index }))
    .sort((left, right) => createdOf(left.message) - createdOf(right.message) || left.index - right.index)
    .map((entry) => entry.message)
  const out: SessionTurnChange[] = []
  for (const message of items) {
    if (message?.role !== "user") continue
    const id = typeof message.id === "string" ? message.id : ""
    if (!id || isLocalMessageId(id)) continue
    const files = perTurn?.[id]
    if (!Array.isArray(files) || files.length === 0) continue
    const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
    const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
    const createdAt = createdOf(message) || null
    out.push({
      id,
      title: turnTitle(promptTextOf(message, parts as Record<string, any[]>)),
      timeLabel: turnTimeLabel(createdAt),
      createdAt,
      files,
      additions,
      deletions,
    })
  }
  return out.slice(-Math.max(1, maxTurns))
}
