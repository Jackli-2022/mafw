// Per-session composer drafts. ChatPane is a keyed Show per sessionID, so
// switching tabs destroys and recreates the pane; this module-level map is
// where the draft survives. In-memory only (cleared on app restart).
const drafts = new Map<string, string>()

export function getDraft(sid: string): string {
  return drafts.get(sid) || ""
}

export function setDraft(sid: string, text: string): void {
  if (!sid) return
  drafts.set(sid, text)
}

export function clearDraft(sid: string): void {
  drafts.delete(sid)
}
