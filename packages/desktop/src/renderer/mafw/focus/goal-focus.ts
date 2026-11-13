// Goal 作用域的焦点 helper：Goal 总览。
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
