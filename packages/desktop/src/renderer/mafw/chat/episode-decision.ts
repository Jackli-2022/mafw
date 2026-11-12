// Episode 关闭 → 决定记录的 Goal 归属：Pod 会话身份优先，其次 Tech Lead 映射/工作台焦点。
export type EpisodeGoalReference = {
  goalId: string
  revision: number | null
}

export function resolveEpisodeGoalReference(input: {
  sessionID: string
  techLeadGoalBySession: Readonly<Record<string, string>>
  /** Pod detail 中的会话身份（重载后仍可用）。 */
  sessionGoal?: { goalId: string; revision: number | null } | null
  /** Pod detail 是否已加载；加载后可以判定旧映射是否失效。 */
  podLoaded?: boolean
  podGoals?: ReadonlyArray<{ goalId: string; activeRevision?: number; revision?: number }>
  focusGoal?: { goalId: string; revision: number } | null
  contentGoal?: { goalId: string; revision: number } | null
}): EpisodeGoalReference | null {
  const mapped = input.techLeadGoalBySession[input.sessionID]
  const mappedIsLive = !!mapped && (
    !input.podLoaded
    || !!input.podGoals?.some((item) => item.goalId === mapped)
  )
  const threadGoalId = input.sessionGoal?.goalId ?? (mappedIsLive ? mapped : null)
  if (threadGoalId) {
    const goal = input.podGoals?.find((item) => item.goalId === threadGoalId)
    return {
      goalId: threadGoalId,
      revision: input.sessionGoal?.revision
        ?? goal?.activeRevision
        ?? goal?.revision
        ?? null,
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
