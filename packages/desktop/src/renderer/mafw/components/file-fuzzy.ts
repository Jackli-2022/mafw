// Fuzzy file matcher for the @file mention picker (opencode-style).
// Subsequence scoring: substring hits and shorter paths win.
export function fuzzyMatchFiles(files: string[], query: string, limit = 20): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files].sort().slice(0, limit)
  const scored: { path: string; score: number }[] = []
  for (const f of files) {
    const lower = f.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx >= 0) {
      // substring: strongest signal; earlier + shorter is better
      scored.push({ path: f, score: 1000 - idx - f.length })
      continue
    }
    // subsequence walk
    let qi = 0
    let run = 0
    let score = 0
    for (let i = 0; i < lower.length && qi < q.length; i++) {
      if (lower[i] === q[qi]) {
        run++
        score += 10 + run * 2 // consecutive hits compound
        qi++
      } else {
        run = 0
      }
    }
    if (qi === q.length) scored.push({ path: f, score: score - f.length })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.path)
}
