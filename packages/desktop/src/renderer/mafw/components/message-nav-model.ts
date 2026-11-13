export type MessageNavTurn = { id: string; text: string }

/** MessageNav 的边界归一化：会话切换/重挂载时上游可能短暂给 undefined。 */
export function normalizeMessageNavTurns(value: unknown): MessageNavTurn[] {
  if (!Array.isArray(value)) return []
  const turns: MessageNavTurn[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== "string") continue
    const text = (item as { text?: unknown }).text
    turns.push({ id, text: typeof text === "string" ? text : "" })
  }
  return turns
}
