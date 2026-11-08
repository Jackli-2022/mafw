import type { PodDetail } from "@mafw/sdk"
import { memberFocus, type MemberFocusTarget } from "./pod-model"

export interface PodContactRow {
  role: "lead" | "tech_lead"
  memberId: string
  displayName: string
  description: string
  focusText: string | null
  goalId: string | null
  canOpen: boolean
}

const CONTACT_COPY = {
  lead: "讨论需求、创建 Goal、了解整体进展。",
  tech_lead: "围绕当前 Goal 讨论方案、计划与取舍。",
} as const

function goalOfTarget(detail: PodDetail, target: MemberFocusTarget): string | null {
  if (!target) return null
  if (target.kind === "techlead") return target.goalId
  if (target.kind !== "session") return null
  return detail.sessions.find((session) => session.sessionId === target.sessionId)?.goalId ?? null
}

/**
 * The left Pod is a launcher, not a roster. Only the two roles a person
 * actually talks to surface; Builder / Reviewer remain inside Goal progress.
 */
export function buildPodContacts(detail: PodDetail | null): PodContactRow[] {
  if (!detail) return []
  const rows: PodContactRow[] = []
  for (const role of ["lead", "tech_lead"] as const) {
    const member = detail.members.find((item) => item.role === role)
    if (!member) continue
    const focus = memberFocus(detail, member.id)
    const target = focus.target
    const goalId = goalOfTarget(detail, target)
    if (role === "lead") {
      rows.push({
        role,
        memberId: member.id,
        displayName: member.displayName,
        description: CONTACT_COPY.lead,
        focusText: focus.focusText ?? "协调中",
        goalId: null,
        canOpen: true,
      })
      continue
    }
    const canOpen = target?.kind === "techlead" || target?.kind === "session"
    rows.push({
      role,
      memberId: member.id,
      displayName: member.displayName,
      description: CONTACT_COPY.tech_lead,
      focusText: canOpen ? focus.focusText : null,
      goalId: canOpen ? goalId : null,
      canOpen,
    })
  }
  return rows
}
