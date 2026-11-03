// Creator entry availability (spec §15.7): the Desktop only offers “让 Agent
// 创建插件” when the ordinary primary agent `mafw-create` is materialized and
// the current workbench root is the project itself. Worktree sessions are
// excluded so project drafts never disappear with a worktree cleanup.
//
// Pure data only — no Solid/DOM/Electron imports, so the decision is testable
// headlessly and MafwShell stays a thin wiring layer.

export type CreatorEntryReason = "loading" | "no-agent" | "worktree"

export interface CreatorEntryState {
  available: boolean
  reason?: CreatorEntryReason
}

export interface CreatorEntryInput {
  /** Agents have been fetched at least once (`agentsData().length > 0`). */
  agentsLoaded: boolean
  /** A `mafw-create` primary agent is present in `primaryAgents`. */
  hasCreator: boolean
  /** The bench root is not the project root (parallel worktree session). */
  isWorktree: boolean
}

/**
 * Availability is conservative: an unknown agent list counts as loading, a
 * missing agent disables the entry, and worktree sessions never show it.
 */
export function creatorEntryState(input: CreatorEntryInput): CreatorEntryState {
  if (!input.agentsLoaded) return { available: false, reason: "loading" }
  if (!input.hasCreator) return { available: false, reason: "no-agent" }
  if (input.isWorktree) return { available: false, reason: "worktree" }
  return { available: true }
}

/** Neutral inline copy for the disabled reasons. */
export function creatorEntryReasonText(reason: CreatorEntryReason | undefined): string {
  if (reason === "loading") return "正在加载 Agent 列表…"
  if (reason === "no-agent") return "当前 runtime 未提供 mafw-create"
  if (reason === "worktree") return "并行 worktree 会话不提供创建入口"
  return ""
}

export interface ReusableCreatorSessionInput {
  activeSessionID: string | null | undefined
  /** Loaded message lists keyed by Session id (`store.message`). */
  messagesBySession: Record<string, readonly unknown[] | undefined>
}

/**
 * Reuse the active Session only when it is an ordinary blank one: no active
 * Session, no loaded message list for it, or any message disables reuse. The
 * caller then falls back to a persisted new Session.
 */
export function reusableCreatorSession(input: ReusableCreatorSessionInput): string | null {
  const sid = input.activeSessionID
  if (!sid) return null
  const messages = input.messagesBySession[sid]
  if (!Array.isArray(messages) || messages.length > 0) return null
  return sid
}
