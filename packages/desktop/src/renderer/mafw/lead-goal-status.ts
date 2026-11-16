export interface LeadGoalStatusSource {
  goalId: string;
  title: string;
  endedAt?: string | null;
  verdict?: string | null;
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
  pendingAttention: number;
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
const FAILED_VERDICTS = new Set(["FAIL", "ERROR", "MAX_RETRIES"]);

function isTerminalFailure(goal: LeadGoalStatusSource): boolean {
  return !!goal.endedAt && (FAILED_VERDICTS.has(goal.verdict ?? "") || !!goal.lastError);
}

function failureLabel(goal: LeadGoalStatusSource): string {
  if (goal.verdict === "ERROR") return "异常";
  if (goal.verdict === "MAX_RETRIES") return "重试耗尽";
  return "失败";
}

export function buildLeadGoalStatusCards(
  goals: readonly LeadGoalStatusSource[],
  attention: readonly { goalId: string }[] = [],
  limit = 5,
): LeadGoalStatusCardModel[] {
  const attentionByGoal = new Map<string, number>();
  for (const item of attention) {
    attentionByGoal.set(item.goalId, (attentionByGoal.get(item.goalId) ?? 0) + 1);
  }
  const rankOf = (goal: LeadGoalStatusSource) =>
    isTerminalFailure(goal) ? 0.5 : (OWNER_RANK[goal.stage?.owner ?? "team"] ?? 1);
  return goals
    .filter((goal) => !goal.endedAt || isTerminalFailure(goal))
    .sort((a, b) => {
      const rank = rankOf(a) - rankOf(b);
      if (rank !== 0) return rank;
      const priority = (b.priority ?? 0) - (a.priority ?? 0);
      if (priority !== 0) return priority;
      return (b.enqueuedAt ?? "").localeCompare(a.enqueuedAt ?? "");
    })
    .slice(0, Math.max(0, limit))
    .map((goal) => {
      const failed = isTerminalFailure(goal);
      return {
        goalId: goal.goalId,
        title: goal.title,
        stageLabel: failed
          ? failureLabel(goal)
          : (STAGE_LABELS[goal.stage?.kind ?? ""] ?? goal.stage?.kind ?? "未知"),
        progressText: goal.progress ? `${goal.progress.done}/${goal.progress.total}` : "",
        blocker: failed
          ? (goal.lastError || "需要你决定重试或新建 Goal")
          : goal.pendingQuestion
            ? "待你回答"
            : (goal.stage?.kind === "blocked" ? "阻塞" : (goal.lastError ?? "")),
        pendingAttention: attentionByGoal.get(goal.goalId) ?? 0,
      };
    });
}
