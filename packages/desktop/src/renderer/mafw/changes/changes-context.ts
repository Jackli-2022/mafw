// 左栏「改动」面的上下文：纯模型，不依赖 Solid / window。
export type ChangesMode = "session" | "goal" | "project"

export type GoalRef = {
  podId: string
  goalId: string
  revision: number
  title: string
  worktreeDir: string | null
}

export type ChangesContext =
  | { kind: "session"; sessionID: string; goal: GoalRef | null }
  | { kind: "goal"; goal: GoalRef }
  | { kind: "project" }

export type ChangesContextInput = {
  mode: ChangesMode
  projectDir: string | null
  activeSession: { id: string; title: string } | null
  sessionGoal: GoalRef | null
  currentGoal: GoalRef | null
}

/** 项目必须有根；没有讨论 / Goal 时对应 mode 返回 null，由 UI 禁用选项。 */
export function resolveChangesContext(input: ChangesContextInput): ChangesContext | null {
  if (!input.projectDir) return null
  switch (input.mode) {
    case "session":
      return input.activeSession
        ? { kind: "session", sessionID: input.activeSession.id, goal: input.sessionGoal }
        : null
    case "goal":
      return input.currentGoal ? { kind: "goal", goal: input.currentGoal } : null
    case "project":
      return { kind: "project" }
  }
}

export function changesContextKey(context: ChangesContext | null): string {
  if (!context) return "none"
  if (context.kind === "project") return "project"
  if (context.kind === "goal") return `goal:${context.goal.goalId}:${context.goal.revision}`
  return context.goal
    ? `session:${context.sessionID}:${context.goal.goalId}:${context.goal.revision}`
    : `session:${context.sessionID}`
}
