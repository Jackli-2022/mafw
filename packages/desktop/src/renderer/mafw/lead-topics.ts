import type { LeadBoundaryView, LeadTopicView } from "@mafw/sdk"

export interface LeadTopicListItem {
  id: string
  title: string
  summary: string
  stateLabel: string
  lastActiveAt: string
  goalId: string
  resumedFrom: string | null
}

const STATE_LABELS: Record<string, string> = {
  resident: "当前",
  warm: "近期",
  cold: "更早",
  archived: "已归档",
}

/** User-facing state label; unknown values pass through instead of disappearing. */
export function leadTopicStateLabel(state?: string | null): string {
  if (!state) return "未知"
  return STATE_LABELS[state] ?? state
}

/** Project a topic list into user-facing rows (never carries session ids). */
export function buildTopicList(topics: readonly LeadTopicView[]): LeadTopicListItem[] {
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title || "未命名话题",
    summary: topic.summary?.trim() ?? "",
    stateLabel: leadTopicStateLabel(topic.state),
    lastActiveAt: topic.lastActiveAt,
    goalId: topic.goalId,
    resumedFrom: topic.resumedFrom,
  }))
}

/** The inline boundary card belongs to the most recently active topic. */
export function currentLeadTopicId(items: readonly LeadTopicListItem[]): string | null {
  let current: LeadTopicListItem | null = null
  for (const item of items) {
    if (!current) {
      current = item
      continue
    }
    const at = Date.parse(item.lastActiveAt)
    const previous = Date.parse(current.lastActiveAt)
    if (Number.isFinite(at) && (!Number.isFinite(previous) || at > previous)) current = item
  }
  return current?.id ?? null
}

/** Only open proposals are actionable; accepted/merged/undone stay as history. */
export function proposedBoundaries(items: readonly LeadBoundaryView[]): LeadBoundaryView[] {
  return items.filter((item) => item.status === "proposed")
}
