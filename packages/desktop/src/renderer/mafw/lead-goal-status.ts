export interface LeadGoalStatusSource {
  goalId: string;
  title: string;
  endedAt?: string | null;
  stage?: { owner?: string; kind?: string } | null;
  progress?: { done: number; total: number } | null;
  pendingQuestion?: unknown;
  lastError?: string | null;
  priority?: number;
  enqueuedAt?: string;
}

export interface LeadGoalStatusCardModel {
  goalId: string;
  title: string;
  stageLabel: string;
  progressText: string;
  blocker: string;
}

const STAGE_LABELS: Record<string, string> = {
  discussing: "讨论中",
  direction_review: "方向待定",
  planning: "规划中",
  plan_approval: "待批准计划",
  queued: "排队中",
  probing: "探针中",
  implementing: "执行中",
  reviewing: "审阅中",
  result_notified: "结果已出",
  working: "执行中",
  waiting: "等待中",
  question: "待你回答",
  blocked: "阻塞",
  ended: "已结束",
};

const OWNER_RANK: Record<string, number> = { person: 0, team: 1, system: 2 };

export function buildLeadGoalStatusCards(
  goals: readonly LeadGoalStatusSource[],
  limit = 5,
): LeadGoalStatusCardModel[] {
  return goals
    .filter((goal) => !goal.endedAt)
    .sort((a, b) => {
      const rank = (OWNER_RANK[a.stage?.owner ?? "team"] ?? 1) - (OWNER_RANK[b.stage?.owner ?? "team"] ?? 1);
      if (rank !== 0) return rank;
      const priority = (b.priority ?? 0) - (a.priority ?? 0);
      if (priority !== 0) return priority;
      return (b.enqueuedAt ?? "").localeCompare(a.enqueuedAt ?? "");
    })
    .slice(0, Math.max(0, limit))
    .map((goal) => ({
      goalId: goal.goalId,
      title: goal.title,
      stageLabel: STAGE_LABELS[goal.stage?.kind ?? ""] ?? goal.stage?.kind ?? "未知",
      progressText: goal.progress ? `${goal.progress.done}/${goal.progress.total}` : "",
      blocker: goal.pendingQuestion
        ? "待你回答"
        : (goal.stage?.kind === "blocked" ? "阻塞" : (goal.lastError ?? "")),
    }));
}
