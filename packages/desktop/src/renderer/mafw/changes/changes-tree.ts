// 左栏「改动」：Goal 组在前、讨论组在后；组与单项都可收起。纯函数。
import type { PodGoal } from "@mafw/sdk"
import type { FileDiffEntry } from "../components/DiffReviewPanel"
import type { SessionTurnChange } from "./session-turns"

export type ChangesFilter = "all" | "review" | "changes"

export type GoalRevisionNode = {
  revision: number
  current: boolean
}

export type GoalChangeGroup = {
  id: string
  title: string
  goal: PodGoal
  current: boolean
  activeRevision: number
  revisions: GoalRevisionNode[]
  pendingReview: number
}

export type DiscussionChangeGroup = {
  id: string
  title: string
  current: boolean
  turns: SessionTurnChange[]
  fileCount: number
  additions: number
  deletions: number
}

export type BuildGoalGroupsInput = {
  goals: readonly PodGoal[]
  activeGoalId: string | null
  reviewCountForGoal?: (goalId: string) => number
}

export function buildGoalGroups(input: BuildGoalGroupsInput): GoalChangeGroup[] {
  const groups = (input.goals ?? []).map((goal) => {
    const activeRevision = goal.activeRevision ?? goal.revision ?? 1
    const revisions: GoalRevisionNode[] = []
    for (let revision = Math.max(1, activeRevision); revision >= 1; revision--) {
      revisions.push({ revision, current: revision === activeRevision })
    }
    return {
      id: goal.goalId,
      title: goal.title,
      goal,
      current: goal.goalId === input.activeGoalId,
      activeRevision,
      revisions,
      pendingReview: input.reviewCountForGoal?.(goal.goalId) ?? 0,
    }
  })
  return groups.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return 0
  })
}

export type BuildDiscussionGroupsInput = {
  sessions: readonly { id: string; title: string }[]
  activeSessionID: string | null
  turns: readonly SessionTurnChange[]
  sessionDiffs: readonly FileDiffEntry[]
}

export function buildDiscussionGroups(input: BuildDiscussionGroupsInput): DiscussionChangeGroup[] {
  const additions = input.sessionDiffs.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = input.sessionDiffs.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return (input.sessions ?? []).map((session) => {
    const current = session.id === input.activeSessionID
    return {
      id: session.id,
      title: session.title,
      current,
      turns: current ? [...input.turns] : [],
      fileCount: current ? input.sessionDiffs.length : 0,
      additions: current ? additions : 0,
      deletions: current ? deletions : 0,
    }
  })
}

function matches(query: string, values: readonly (string | number | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle))
}

export function filterGoalGroups(
  groups: readonly GoalChangeGroup[],
  query: string,
  filter: ChangesFilter,
): GoalChangeGroup[] {
  return groups.filter((group) => {
    if (filter === "review" && group.pendingReview <= 0) return false
    return matches(query, [
      group.title,
      group.goal.status,
      `rev ${group.activeRevision}`,
      group.revisions.map((revision) => `rev ${revision.revision}`).join(" "),
    ])
  })
}

export function filterDiscussionGroups(
  groups: readonly DiscussionChangeGroup[],
  query: string,
  filter: ChangesFilter,
): DiscussionChangeGroup[] {
  return groups.filter((group) => {
    if (filter === "changes" && group.turns.length === 0 && group.fileCount === 0) return false
    if (filter === "review" && group.fileCount === 0) return false
    return matches(query, [
      group.title,
      ...group.turns.flatMap((turn) => [
        turn.title,
        turn.timeLabel,
        ...turn.files.map((file) => file.file ?? ""),
      ]),
    ])
  })
}
