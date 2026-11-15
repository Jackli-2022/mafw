import type { LeadBoundaryView } from "@mafw/sdk"

const TRIGGER_LABELS: Record<string, string> = {
  explicit: "显式换话题",
  idle: "空闲 30 分钟",
  semantic: "语义变化",
  goal_closed: "Goal 已结束",
  keyword: "关键词",
}

export function boundaryTriggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger
}

/** The transcript only surfaces open proposals, newest first is not guaranteed. */
export function visibleBoundaryProposals(
  items: readonly LeadBoundaryView[],
  limit = 2,
): LeadBoundaryView[] {
  return items.filter((item) => item.status === "proposed").slice(0, limit)
}
