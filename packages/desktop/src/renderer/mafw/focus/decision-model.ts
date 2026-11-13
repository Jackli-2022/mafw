// 决定板投影：把 attention / review / decision record 压成 Chat 里的四组决定。
// 纯函数；不读 DOM、不读存储，方便被 MafwShell 和测试共用。
import type { AttentionItem, DecisionKind, DecisionRecord } from "@mafw/sdk"

export type DecisionStatus = "needs_you" | "pending" | "decided" | "shelved"

export type DecisionAction =
  | { kind: "goal"; goalId: string; target: "timeline" | "plan" | "question" | "direction" | "result" }
  | { kind: "reviewItem"; goalId: string; itemId: string; rel: string; line?: number }
  | { kind: "record"; recordId: string }
  | { kind: "none" }

export type DecisionItem = {
  id: string
  status: DecisionStatus
  kind: DecisionKind
  title: string
  detail: string | null
  goalId: string | null
  revision: number | null
  source: "attention" | "review" | "record"
  action: DecisionAction
}

export type DecisionBoardGroup = {
  status: DecisionStatus
  label: string
  items: readonly DecisionItem[]
}

export type DecisionBoardView = {
  groups: readonly DecisionBoardGroup[]
  counts: { needsYou: number; pending: number; decided: number; shelved: number }
}

export const DECISION_PAGE_SIZE = 25

export function visibleDecisionItems(
  items: readonly DecisionItem[],
  limit: number,
): readonly DecisionItem[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  return items.slice(0, Math.floor(limit))
}

export function decisionLimitToInclude(
  items: readonly DecisionItem[],
  itemId: string,
  page = DECISION_PAGE_SIZE,
): number {
  const size = page > 0 ? page : DECISION_PAGE_SIZE
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) return size
  return Math.ceil((index + 1) / size) * size
}

const GROUPS: readonly { status: DecisionStatus; label: string }[] = [
  { status: "needs_you", label: "需要你定" },
  { status: "pending", label: "待确认" },
  { status: "decided", label: "已定" },
  { status: "shelved", label: "已搁置" },
]

const KIND_PRIORITY: Record<DecisionKind, number> = {
  plan: 100,
  direction: 90,
  acceptance: 80,
  authorization: 70,
  scope: 60,
  priority: 50,
  disposition: 40,
  other: 10,
}

export function decisionGoalFocus(
  action: DecisionAction,
): "timeline" | "plan" | "question" | "direction" | "result" | null {
  if (action.kind === "goal") return action.target
  if (action.kind === "reviewItem") return "timeline"
  return null
}

function attentionKind(item: AttentionItem): DecisionKind {
  switch (item.kind) {
    case "plan_approval": return "plan"
    case "direction_review": return "direction"
    case "review": return "acceptance"
    // The attention DTO carries only `decision`, not the record kind: the record
    // is the source of truth for kind, so do not invent one here.
    case "decision": return "other"
    case "answer":
    case "review_item":
    case "blocked":
    case "failed":
    default: return "other"
  }
}

export function decisionActionForAttention(item: AttentionItem): DecisionAction {
  switch (item.kind) {
    case "plan_approval":
      return { kind: "goal", goalId: item.goalId, target: "plan" }
    case "direction_review":
      return { kind: "goal", goalId: item.goalId, target: "direction" }
    case "answer":
      return { kind: "goal", goalId: item.goalId, target: "question" }
    case "review":
      return { kind: "goal", goalId: item.goalId, target: "result" }
    case "decision": {
      const recordId = item.action.itemId
      if (!recordId) return { kind: "none" }
      return { kind: "record", recordId }
    }
    case "review_item": {
      const itemId = item.action.itemId
      if (!itemId) return { kind: "none" }
      const rel = item.action.rel ?? item.title
      return {
        kind: "reviewItem",
        goalId: item.goalId,
        itemId,
        rel,
        ...(item.action.line !== undefined ? { line: item.action.line } : {}),
      }
    }
    case "blocked":
    case "failed":
    default:
      return { kind: "goal", goalId: item.goalId, target: "timeline" }
  }
}

function attentionItem(item: AttentionItem): DecisionItem {
  return {
    id: item.id,
    status: "needs_you",
    kind: attentionKind(item),
    title: item.title,
    detail: item.detail ?? null,
    goalId: item.goalId,
    revision: item.revision,
    source: item.kind === "review_item" ? "review" : "attention",
    action: decisionActionForAttention(item),
  }
}

function recordStatus(status: DecisionRecord["status"]): DecisionStatus {
  if (status === "decided") return "decided"
  if (status === "shelved") return "shelved"
  return "pending"
}

function recordItem(record: DecisionRecord): DecisionItem {
  return {
    id: record.id,
    status: recordStatus(record.status),
    kind: record.kind,
    title: record.question,
    detail: record.rationale ?? record.consequences ?? null,
    goalId: record.goalId,
    revision: record.revision,
    source: "record",
    action: { kind: "record", recordId: record.id },
  }
}

function byKindAndTitle(a: DecisionItem, b: DecisionItem): number {
  const diff = KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]
  return diff !== 0 ? diff : a.title.localeCompare(b.title)
}

export function buildDecisionBoard(input: {
  attention: readonly AttentionItem[]
  records: readonly DecisionRecord[]
  goalId?: string | null
}): DecisionBoardView {
  const goalId = input.goalId ?? null
  // Draft decisions already projected through attention (E9-2) must not show up
  // twice; their attention item is the needs-you copy, the record would be the
  // pending copy of the same decision.
  const attentionRecordIds = new Set<string>()
  for (const item of input.attention) {
    if (item.action.type !== "open_decision") continue
    const recordId = item.action.itemId
    if (recordId) attentionRecordIds.add(recordId)
  }
  const items: DecisionItem[] = [
    ...input.attention
      .filter((item) => goalId === null || item.goalId === goalId)
      .map(attentionItem),
    ...input.records
      .filter((record) => goalId === null || record.goalId === goalId)
      .filter((record) => !attentionRecordIds.has(record.id))
      .map(recordItem),
  ]

  const groups = GROUPS.map(({ status, label }) => ({
    status,
    label,
    items: items.filter((item) => item.status === status).sort(byKindAndTitle),
  }))

  return {
    groups,
    counts: {
      needsYou: groups[0]!.items.length,
      pending: groups[1]!.items.length,
      decided: groups[2]!.items.length,
      shelved: groups[3]!.items.length,
    },
  }
}
