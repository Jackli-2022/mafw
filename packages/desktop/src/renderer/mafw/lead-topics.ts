import type { LeadTopicView } from "@mafw/sdk"

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
