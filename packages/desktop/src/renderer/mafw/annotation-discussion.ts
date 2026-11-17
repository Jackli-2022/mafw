// Explicit discussion routing for local annotation drafts. Sending here is a
// discussion action only: it never calls createReviewItems or creates a Goal.
import type { Annotation } from "../../shared/annotation-types"
import { annotationRefPart } from "./annotation-message-part"
import { buildAnnotationBatch } from "./editor-annotation"

export type DiscussionTarget =
  | { kind: "lead"; podId: string }
  | { kind: "free"; sessionID: string }
  | { kind: "techlead"; podId: string; goalId: string }

export function chatAcceptsAnnotation(
  annotation: Annotation,
  chat: { kind: "free" | "lead" | "techlead"; goalId?: string | null },
): boolean {
  if (chat.kind !== "techlead") return true
  if (annotation.source?.kind !== "goal") return true
  return !!chat.goalId && annotation.source.goalId === chat.goalId
}

export async function deliverAnnotationDiscussion(input: {
  annotations: readonly Annotation[]
  target: DiscussionTarget
}, deps: {
  ensureLead(podId: string): Promise<{ sessionId: string }>
  ensureTechLead(goalId: string): Promise<{ sessionID: string; revision: number }>
  sendChat(input: {
    sessionID: string
    message: string
    parts: Array<{ type: "text"; text: string; synthetic?: boolean }>
  }): Promise<unknown>
  sendTechLead(input: {
    podId: string
    goalId: string
    text: string
    parts: Array<{ type: "text"; text: string; synthetic?: boolean }>
  }): Promise<unknown>
  markDiscussed(ids: readonly string[], at: number): void
}): Promise<{ sessionID: string }> {
  const annotations = input.annotations.filter((annotation) => !annotation.delegatedAt)
  if (annotations.length === 0) throw new Error("没有可讨论的批注")
  const message = buildAnnotationBatch(annotations)
  const parts = [annotationRefPart(annotations.map((annotation) => annotation.id))]
  const ids = annotations.map((annotation) => annotation.id)
  let sessionID: string
  if (input.target.kind === "lead") {
    sessionID = (await deps.ensureLead(input.target.podId)).sessionId
    await deps.sendChat({ sessionID, message, parts })
  } else if (input.target.kind === "free") {
    sessionID = input.target.sessionID
    await deps.sendChat({ sessionID, message, parts })
  } else {
    const goalId = input.target.goalId
    const invalid = annotations.find((annotation) =>
      !chatAcceptsAnnotation(annotation, { kind: "techlead", goalId }))
    if (invalid) throw new Error(`批注属于其他 Goal，不能发给 Goal ${goalId} 的 Tech Lead`)
    const techLead = await deps.ensureTechLead(goalId)
    sessionID = techLead.sessionID
    await deps.sendTechLead({
      podId: input.target.podId,
      goalId,
      text: message,
      parts,
    })
  }
  deps.markDiscussed(ids, Date.now())
  return { sessionID }
}
