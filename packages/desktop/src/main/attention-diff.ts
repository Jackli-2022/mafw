// packages/desktop/src/main/attention-diff.ts
// Attention is a read-time projection on the gateway, so the only way to know
// "a new blocker appeared" is to diff successive snapshots by id.

export interface AttentionLike {
  id: string
}

export function diffAttention(
  prev: readonly string[],
  next: ReadonlyArray<AttentionLike>,
): { added: AttentionLike[]; removed: string[] } {
  const prevSet = new Set(prev)
  const nextIds = new Set(next.map((item) => item.id))
  return {
    added: next.filter((item) => !prevSet.has(item.id)),
    removed: prev.filter((id) => !nextIds.has(id)),
  }
}
