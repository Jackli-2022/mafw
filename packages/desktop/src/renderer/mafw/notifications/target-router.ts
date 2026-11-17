import type { NotificationTarget } from "../../../shared/notifications"
import type { GoalDetailFocus } from "../pod-model"

export interface NotificationNavigationDeps {
  currentProject(): string | null
  selectProject(projectDir: string): Promise<void>
  openSession(sessionID: string): void
  openGoal(goalId: string, focus: GoalDetailFocus): void | Promise<void>
  openWork(): void
  openConfig(): void
}

/**
 * Single target router shared by the in-app center and the floating window.
 * `projectId` is a project directory (gateway project identity).
 */
export async function navigateNotificationTarget(
  target: NotificationTarget | undefined,
  deps: NotificationNavigationDeps,
): Promise<void> {
  if (!target) return
  const projectId = "projectId" in target ? target.projectId : undefined
  if (projectId && projectId !== deps.currentProject()) {
    await deps.selectProject(projectId)
  }
  switch (target.type) {
    case "session":
      deps.openSession(target.sessionID)
      return
    case "goal":
      await deps.openGoal(target.goalId, target.focus ?? "timeline")
      return
    case "approval":
    case "question":
      deps.openSession(target.sessionID)
      return
    case "work":
      deps.openWork()
      return
    case "config":
      deps.openConfig()
      return
  }
}
