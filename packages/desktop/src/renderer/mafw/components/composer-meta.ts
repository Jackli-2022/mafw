// composer-meta：composer 区实时元数据行（耗时 + token，tabular-nums 呈现）。
// 纯逻辑无 Solid 依赖，便于 bun:test。
const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
const fmtTok = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function formatComposerMeta(opts: {
  elapsedMs: number | null
  tokens: number | null
  streaming: boolean
}): string {
  const parts: string[] = []
  if (opts.elapsedMs != null) parts.push(fmtDur(opts.elapsedMs))
  if (opts.tokens != null) parts.push(`${fmtTok(opts.tokens)} tok`)
  return parts.join(" · ")
}
