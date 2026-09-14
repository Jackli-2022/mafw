// Busy-turn queue primitives for the chat composer. Immutable helpers so a
// SolidJS signal can hold the list and rerun on replacement (renderer/mafw
// has no component test framework; this module is the testable core).
export type QueuedTurn = { text: string; atts: unknown[]; agents: { name: string }[] }

export function enqueueTurn(list: QueuedTurn[], turn: QueuedTurn): QueuedTurn[] {
  return [...list, turn]
}

export function removeTurnAt(list: QueuedTurn[], index: number): QueuedTurn[] {
  if (index < 0 || index >= list.length) return list
  return list.filter((_, i) => i !== index)
}

export function takeFirstTurn(list: QueuedTurn[]): { first: QueuedTurn | null; rest: QueuedTurn[] } {
  if (list.length === 0) return { first: null, rest: [] }
  const [first, ...rest] = list
  return { first, rest }
}
