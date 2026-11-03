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

export interface CreatorPageState {
  cursor: string | null
  hasMore: boolean
  loading: boolean
}

export interface ReusableCreatorSessionInput {
  activeSessionID: string | null | undefined
  /** Loaded message lists keyed by Session id (`store.message`). */
  messagesBySession: Record<string, readonly unknown[] | undefined>
  /**
   * Per-session history load state (`MafwShell.pageState`). Only a completed
   * page proves that an empty message list means “blank”, because
   * `openSessionTab` seeds `message[sid] = []` before history arrives.
   */
  pageState: Record<string, CreatorPageState | undefined>
}

/**
 * Reuse the active Session only when its history actually finished loading and
 * came back empty:
 *
 * - `openSessionTab` seeds `message[sid] = []` for every new tab, and history
 *   is only merged back when the page has messages, so the empty array alone
 *   cannot distinguish a blank Session from one whose load is in flight or
 *   failed;
 * - `pageState` is written only by a completed page load (`cursor`/`hasMore`),
 *   and a still-loading page never qualifies;
 * - any loaded message disables reuse.
 *
 * Everything else returns `null`, and the caller creates a fresh persisted
 * Session instead of hijacking someone's conversation.
 */
export function reusableCreatorSession(input: ReusableCreatorSessionInput): string | null {
  const sid = input.activeSessionID
  if (!sid) return null
  const page = input.pageState[sid]
  if (!page) return null
  if (page.loading === true) return null
  if (page.cursor !== null || page.hasMore !== false) return null
  const messages = input.messagesBySession[sid]
  if (!Array.isArray(messages) || messages.length > 0) return null
  return sid
}
