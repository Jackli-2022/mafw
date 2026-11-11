// Goal 与 Chat 的上下文规则：换讨论负责人，不换当前 Goal 和项目。
import type { PodDetail, PodGoal } from "@mafw/sdk"

export function shouldOpenTechLeadForGoal(
  goal: Pick<PodGoal, "endedAt"> | null | undefined,
): boolean {
  return !!goal && !goal.endedAt
}

export function goalDiscussionTarget(
  detail: PodDetail | null,
  goalId: string,
): PodGoal | null {
  if (!detail || !goalId) return null
  return detail.goals.find((goal) => goal.goalId === goalId) ?? null
}

export function techLeadSessionForGoal(input: {
  detail: PodDetail | null
  goalId: string | null
  activeSessionId: string | null
}): boolean {
  const { detail, goalId, activeSessionId } = input
  if (!detail || !goalId || !activeSessionId) return false
  const techLead = detail.members.find((member) => member.role === "tech_lead")
  if (!techLead) return false
  return detail.sessions.some((session) =>
    session.memberId === techLead.id
    && session.sessionId === activeSessionId
    && session.goalId === goalId
    && !session.endedAt
    && (session.node === "discussion" || session.scopeKind === "discussion"))
}

export function shouldShowReturnLead(input: {
  detail: PodDetail | null
  selectedGoalId: string | null
  activeSessionId: string | null
}): boolean {
  const { detail, selectedGoalId, activeSessionId } = input
  if (!detail || !selectedGoalId) return false
  const goal = goalDiscussionTarget(detail, selectedGoalId)
  if (!goal || goal.endedAt) return false
  return techLeadSessionForGoal({
    detail,
    goalId: selectedGoalId,
    activeSessionId,
  })
}
