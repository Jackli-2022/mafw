/** Newest turn id (turns are ordered oldest→newest). */
export function tailIdOf(turns: { id: string }[]): string | null {
  return turns.length ? turns[turns.length - 1].id : null
}

/** Animate only when a previously-known tail is replaced by a different one
 *  (new appended turn). Hydration (prev=null) and paging older turns don't animate. */
export function shouldAnimateTail(prevTail: string | null, nextTail: string | null): boolean {
  return prevTail !== null && nextTail !== null && nextTail !== prevTail
}
