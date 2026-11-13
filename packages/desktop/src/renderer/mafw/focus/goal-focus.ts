// Goal 作用域的焦点 helpers：Goal 总览 / 变更集 / 评审项。
import { openSubject, type Scope, type WorkbenchState } from "./focus-model"

export type GoalFocusInput = {
  projectDir: string
  goalId: string
  revision: number
  worktreeDir: string
  title?: string | null
}

export function goalFocusScope(input: GoalFocusInput): Scope {
  return {
    kind: "goal",
    worldId: input.projectDir,
    goalId: input.goalId,
    revision: input.revision,
    worktreeDir: input.worktreeDir,
  }
}

export function openGoalFocus(state: WorkbenchState, input: GoalFocusInput): WorkbenchState {
  return openSubject(state, goalFocusScope(input), { kind: "goal", goalId: input.goalId })
}

export function openChangeSetFocus(state: WorkbenchState, input: GoalFocusInput): WorkbenchState {
  return openSubject(
    state,
    goalFocusScope(input),
    {
      kind: "changeSet",
      scope: "goal",
      goalId: input.goalId,
      revision: input.revision,
    },
  )
}

export function openReviewItemFocus(
  state: WorkbenchState,
  input: GoalFocusInput & { itemId: string; rel: string; line?: number },
): WorkbenchState {
  return openSubject(
    state,
    goalFocusScope(input),
    {
      kind: "reviewItem",
      id: input.itemId,
      anchor: input.line === undefined ? { rel: input.rel } : { rel: input.rel, line: input.line },
    },
  )
}
