import type { PodMemberRole } from "@mafw/sdk"

export type MemberAvatar = { kind: "lore" } | { kind: "initial"; text: string }

export function memberAvatar(role: string, displayName: string): MemberAvatar {
  if (role === "lead") return { kind: "lore" }
  return { kind: "initial", text: displayName.trim().charAt(0) || "?" }
}

export function sessionPodRole(
  role: PodMemberRole | null | undefined,
  lead: boolean | undefined,
): PodMemberRole | null {
  return role ?? (lead ? "lead" : null)
}
