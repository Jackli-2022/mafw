// In-session transcript search: pure matcher over turn records; the overlay
// renders hits and jumps via data-turn-id anchors.
export type SearchableTurn = { id: string; role: string; text: string }
export type SearchHit = { id: string; role: string; snippet: string }

export function searchTurns(turns: SearchableTurn[], query: string, maxHits = 30): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const t of turns) {
    const text = t.text || ""
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 40)
    const end = Math.min(text.length, idx + q.length + 40)
    const prefix = start > 0 ? "…" : ""
    const suffix = end < text.length ? "…" : ""
    hits.push({ id: t.id, role: t.role, snippet: prefix + text.slice(start, end) + suffix })
    if (hits.length >= maxHits) break
  }
  return hits
}
