// packages/desktop/src/renderer/mafw/context-usage.ts
// 上下文占用计算（纯逻辑，供 ChatPane 标题栏 pill 与 UsageDock 共用）。
//
// 关键语义：opencode/DeepSeek 的 `tokens.input` **不含**缓存命中部分；
// 开启 prompt cache 后 input 只有几百 token，而实际 prompt 在
// `tokens.cache.read`（可达数十万）。只用 input 会让「上下文」恒为 0%。
// 正确占用 = input + cache.read + cache.write（与 UsageDock 既有口径一致）。
export interface ContextTokensLike {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export interface ContextUsage {
  used: number
  total: number
  percent: number
}

export function computeContextUsage(
  tokens: ContextTokensLike | null | undefined,
  contextWindow: number,
): ContextUsage {
  const used = tokens
    ? (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
    : 0
  const total = contextWindow > 0 ? contextWindow : 0
  const percent = total > 0 ? Math.round((used / total) * 100) : 0
  return { used, total, percent }
}
