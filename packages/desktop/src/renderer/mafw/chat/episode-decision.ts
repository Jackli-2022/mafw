// Episode 关闭 → 决定记录的 Goal 归属：Tech Lead 线程优先，其次工作台焦点/内容 scope。
export type EpisodeGoalReference = {
  goalId: string
  revision: number | null
}

export function resolveEpisodeGoalReference(input: {
  sessionID: string
  techLeadGoalBySession: Readonly<Record<string, string>>
  podGoals?: ReadonlyArray<{ goalId: string; activeRevision?: number; revision?: number }>
  focusGoal?: { goalId: string; revision: number } | null
  contentGoal?: { goalId: string; revision: number } | null
}): EpisodeGoalReference | null {
  const threadGoalId = input.techLeadGoalBySession[input.sessionID]
  if (threadGoalId) {
    const goal = input.podGoals?.find((item) => item.goalId === threadGoalId)
    return {
      goalId: threadGoalId,
      revision: goal?.activeRevision ?? goal?.revision ?? null,
    }
  }
  if (input.focusGoal) {
    return { goalId: input.focusGoal.goalId, revision: input.focusGoal.revision }
  }
  if (input.contentGoal) {
    return { goalId: input.contentGoal.goalId, revision: input.contentGoal.revision }
  }
  return null
}
