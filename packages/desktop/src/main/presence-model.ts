// packages/desktop/src/main/presence-model.ts
// Pure mapping from the gateway's cross-project presence payload to the three
// surfaces main can drive: tray icon state, taskbar progress, tooltip text.

export interface PresenceItem {
  podId: string
  projectId: string
  projectName: string
  goalId: string
  title: string
  phase: string | null
  node: string | null
  progress: { current: number; total: number } | null
  startedAt: string
  updatedAt: string
}

export interface PresencePayload {
  running: PresenceItem[]
  attention: { count: number; items: Array<{ id: string }> }
  unreadResults: { count: number; latest: PresenceItem | null }
}

export interface PodPresenceView {
  trayState: 'idle' | 'running' | 'attention'
  /** -1 = no progress bar, 2 = indeterminate, 0..1 = determinate. */
  progress: number
  tooltip: string
  clickTarget: { podId: string; goalId: string } | null
}

const IDLE: PodPresenceView = {
  trayState: 'idle',
  progress: -1,
  tooltip: 'MAFW Desktop',
  clickTarget: null,
}

export function podPresence(payload: PresencePayload | null): PodPresenceView {
  if (!payload) return IDLE

  const running = payload.running ?? []
  const attentionCount = payload.attention?.count ?? 0
  const unread = payload.unreadResults?.count ?? 0
  const trayState: PodPresenceView['trayState'] =
    attentionCount > 0 || unread > 0 ? 'attention' : running.length > 0 ? 'running' : 'idle'

  const withProgress = running.find((item) => item.progress && item.progress.total > 0)
  const progress = running.length === 0
    ? -1
    : withProgress?.progress
      ? withProgress.progress.current / withProgress.progress.total
      : 2

  const head = running[0] ?? payload.unreadResults?.latest ?? null
  const parts: string[] = []
  if (running.length > 1) parts.push(`${running.length} 个 Goal 在跑`)
  if (head) parts.push(describe(head))
  else if (unread > 0) parts.push(`${unread} 个结果待查看`)

  return {
    trayState,
    progress,
    tooltip: parts.length ? `MAFW — ${parts.join(' · ')}` : 'MAFW Desktop',
    clickTarget: head ? { podId: head.podId, goalId: head.goalId } : null,
  }
}

function describe(item: PresenceItem): string {
  const node = item.node ? ` · ${item.node}` : ''
  const ratio = item.progress && item.progress.total > 0 ? ` ${item.progress.current}/${item.progress.total}` : ''
  return `${item.title}${node}${ratio}`
}
