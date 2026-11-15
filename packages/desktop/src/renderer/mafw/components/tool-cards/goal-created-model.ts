/** View model for a `mafw_create_goal` tool call. */
export type GoalCreatedView = {
  kind: "tech_lead" | "legacy" | "pending" | "error"
  title: string
  goalId: string
  stage: string
  sessionID: string | null
  hasHandoff: boolean
  warning: string | null
}

function parseOutput(output: string | undefined): any {
  if (!output) return undefined
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Only a completed, successful, Lead-routed call is an actionable discussion
 * Goal. Everything else keeps the generic tool card (legacy intake, pending,
 * or a failed call).
 */
export function goalCreatedView(
  input: Record<string, any> | undefined,
  output: string | undefined,
  status: string | undefined,
): GoalCreatedView {
  const title = text(input?.title)
  const goalId = text(input?.goalId)
  const base: GoalCreatedView = {
    kind: "pending",
    title,
    goalId,
    stage: "",
    sessionID: null,
    hasHandoff: false,
    warning: null,
  }
  if (status !== "completed") return base

  const payload = parseOutput(output)
  if (!payload || payload.success !== true) {
    return { ...base, kind: "error" }
  }
  const routedGoalId = text(payload.goalId) || goalId
  if (payload.routedTo !== "tech_lead") {
    return { ...base, kind: "legacy", goalId: routedGoalId }
  }
  const warning = text(payload.sessionError) || text(payload.promptError)
  return {
    kind: "tech_lead",
    title: title || text(payload.title) || routedGoalId,
    goalId: routedGoalId,
    stage: text(payload.stage),
    sessionID: text(payload.sessionID) || null,
    hasHandoff: !!payload.sourceRef || !!payload.handoffPath,
    warning: warning || null,
  }
}
