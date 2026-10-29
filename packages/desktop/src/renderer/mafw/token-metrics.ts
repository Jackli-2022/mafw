// packages/desktop/src/renderer/mafw/token-metrics.ts
// Token 指标统一口径（UsageDock / 模型卡共用）：
// - totalTokens: 全部 token（input+output+reasoning+cache.read+cache.write）
// - cacheHitRate: prompt 侧缓存命中率 = cache.read / (input + cache.read + cache.write)
//   注意：input 不含缓存命中；cache.write 是写入缓存的 prompt 部分，计入分母。
export interface TokenCountsLike {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export function totalTokens(t: TokenCountsLike | null | undefined): number {
  if (!t) return 0
  return (
    (t.input || 0) +
    (t.output || 0) +
    (t.reasoning || 0) +
    (t.cache?.read || 0) +
    (t.cache?.write || 0)
  )
}

export function cacheHitRate(t: TokenCountsLike | null | undefined): number {
  if (!t) return 0
  const read = t.cache?.read || 0
  const denom = (t.input || 0) + read + (t.cache?.write || 0)
  return denom > 0 ? Math.round((read / denom) * 100) : 0
}
