import type { NotificationTarget } from "../shared/notifications"

export type AttentionKind =
  | "plan_approval"
  | "direction_review"
  | "question"
  | "blocked"
  | "review"
  | "failed"

export interface AttentionTargetInput {
  kind: AttentionKind
  goalId: string
  projectId?: string
}

/** Presence attention → the Goal panel that actually needs the human. */
export function attentionTarget(input: AttentionTargetInput): NotificationTarget {
  const focus =
    input.kind === "plan_approval"
      ? "plan"
      : input.kind === "direction_review"
        ? "direction"
        : input.kind === "question"
          ? "question"
          : "timeline"
  return { type: "goal", goalId: input.goalId, projectId: input.projectId, focus }
}
