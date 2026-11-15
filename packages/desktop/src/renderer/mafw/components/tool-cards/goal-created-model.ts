/** View model for a `mafw_create_goal` tool call. */
export type GoalCreatedView = {
  kind: "tech_lead" | "legacy" | "pending" | "error"
  title: string
  goalId: string
  sessionID: string | null
  hasHandoff: boolean
  warning: string | null
}

/** Live Pod projection used to decide whether "撤销" is still legal. */
export type GoalLiveState = {
  status: string
  stage: string
  label: string
  canCancel: boolean
}

export type GoalCreatedActionState = {
  statusLabel: string
  canOpen: boolean
  canCancel: boolean
}

/**
 * The tool payload is an immutable creation snapshot. Never trust it for
 * destructive actions: the Goal may have advanced or finished since. The card
 * asks the shell for live state and only cancels a still-discussing Goal.
 */
export function goalCreatedActionState(
  view: GoalCreatedView,
  live: GoalLiveState | null | undefined,
  cancelled: boolean,
): GoalCreatedActionState {
  const canOpenBase = !!view.goalId
  if (cancelled) return { statusLabel: "已撤销", canOpen: false, canCancel: false }
  if (live === undefined) return { statusLabel: "正在确认 Goal 状态…", canOpen: canOpenBase, canCancel: false }
  if (live === null) return { statusLabel: "状态未知，仅可打开 Goal", canOpen: canOpenBase, canCancel: false }
  if (live.status === "aborted") return { statusLabel: "已撤销", canOpen: false, canCancel: false }
  if (live.status === "done") return { statusLabel: "已结束", canOpen: canOpenBase, canCancel: false }
  if (!live.canCancel) return { statusLabel: live.label || "已进入执行", canOpen: canOpenBase, canCancel: false }
  return { statusLabel: "Tech Lead 讨论中 · 尚未执行", canOpen: canOpenBase, canCancel: true }
}

function parseOutput(output: string | undefined): any {
  if (!output) return undefined
  try {
    const parsed = JSON.parse(output)
    // MCP results may arrive wrapped as { content, structuredContent } or only
    // { content: [{ type: "text", text: "<json>" }] }. The card wants the
    // structured goal payload, not the transport envelope.
    if (parsed && typeof parsed === "object") {
      if (parsed.structuredContent && typeof parsed.structuredContent === "object") {
        return parsed.structuredContent
      }
      if (Array.isArray(parsed.content)) {
        const textPart = parsed.content.find((part: any) =>
          part?.type === "text" && typeof part.text === "string")
        if (textPart) {
          try { return JSON.parse(textPart.text) } catch { /* keep outer */ }
        }
      }
    }
    return parsed
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
    sessionID: text(payload.sessionID) || null,
    hasHandoff: !!payload.sourceRef || !!payload.handoffPath,
    warning: warning || null,
  }
}
