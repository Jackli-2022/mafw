// packages/desktop/src/renderer/mafw/pod-events.ts
// Human-facing view of pod events. `viewedResults` (localStorage) is read-only
// legacy: new state lives in `pod_events`, but old unviewed results must not
// disappear on upgrade.
export interface PodEventItem {
  id: string
  goalId: string | null
  revision: number | null
  kind: string
  severity: 'p1' | 'p2' | 'p3'
  title: string
  summary: string | null
  state: 'unread' | 'seen'
  createdAt: string
}

export function isResultViewed(
  key: string,
  events: readonly PodEventItem[],
  legacy: readonly string[],
): boolean {
  const [goalId, revisionPart] = key.split(':r')
  const revision = Number(revisionPart)
  const seenInEvents = events.some(
    (event) => event.goalId === goalId && event.revision === revision && event.state === 'seen',
  )
  if (seenInEvents) return true
  return legacy.includes(key)
}

/** Only a successfully loaded result may clear the unread marker. */
export function shouldMarkSeen(result: { status: 'fulfilled' | 'rejected' | 'pending' }): boolean {
  return result.status === 'fulfilled'
}

export function listUnread(events: readonly PodEventItem[]): PodEventItem[] {
  const weight = (event: PodEventItem) => (event.severity === 'p1' ? 0 : 1)
  return events
    .filter((event) => event.state === 'unread')
    .slice()
    .sort((a, b) => weight(a) - weight(b) || b.createdAt.localeCompare(a.createdAt))
}
