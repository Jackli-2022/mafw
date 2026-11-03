import type { GoalSourceRef } from "@mafw/sdk"

const SNAPSHOT_LIMIT = 4000
const TITLE_LIMIT = 80

const INTERNAL_ROLES = new Set([
  "lead",
  "tech_lead",
  "builder",
  "reviewer",
  "probe",
  "memory_curator",
])

function normalizeRole(role: string | undefined): string {
  return String(role ?? "").trim().toLowerCase().replace(/-/g, "_")
}

function stripSessionIds(value: string): string {
  return value.replace(/\bses_[A-Za-z0-9_-]+\b/g, "").trim()
}

function deriveTitle(sourceText: string, sessionTitle: string): string {
  const first = sourceText.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
  const fromSource = stripSessionIds(first.replace(/^#+\s*/, "").trim())
  const fallback = stripSessionIds(sessionTitle.trim())
  const title = (fromSource || fallback || "未命名讨论").replace(/\s+/g, " ").trim()
  return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title
}

export interface LeadHandoff {
  title: string
  objective: string
  sourceRef: GoalSourceRef
}

/**
 * A free discussion can become a Goal only through an explicit Lead handoff.
 * Internal workers/coordinators are not user discussion containers and cannot
 * mint work this way.
 */
export function buildLeadHandoff(input: {
  sessionTitle: string
  sourceText: string
  sessionID: string
  messageID?: string
  role?: string
}): LeadHandoff | null {
  const sessionID = String(input.sessionID ?? "").trim()
  if (!sessionID) return null
  if (INTERNAL_ROLES.has(normalizeRole(input.role))) return null

  const source = String(input.sourceText ?? "").replace(/\r\n/g, "\n").trim()
  if (!source) return null
  const snapshot = source.slice(0, SNAPSHOT_LIMIT)
  return {
    title: deriveTitle(source, String(input.sessionTitle ?? "")),
    objective: snapshot,
    sourceRef: {
      sessionID,
      ...(input.messageID?.trim() ? { messageID: input.messageID.trim() } : {}),
      snapshot,
      capturedAt: new Date().toISOString(),
    },
  }
}
