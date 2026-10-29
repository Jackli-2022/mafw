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

export function formatContextTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** 统一 pill 与 UsageDock 的上下文文案（窗口未知时也一致）。 */
export function formatContextUsage(u: ContextUsage): { main: string; tooltip: string } {
  if (u.total > 0) {
    // 0<ratio<0.5% 时显示 <1%，避免「有上下文但一直 0%」的歧义
    const subOne = u.used > 0 && u.percent === 0
    const pct = subOne ? "<1%" : `${u.percent}%`
    return {
      main: pct,
      tooltip: `上下文: ${formatContextTokens(u.used)} / ${formatContextTokens(u.total)} (${pct})`,
    }
  }
  if (u.used > 0) {
    return {
      main: formatContextTokens(u.used),
      tooltip: `上下文: ${formatContextTokens(u.used)} tokens（窗口大小未知）`,
    }
  }
  return { main: "—", tooltip: "上下文: 暂无数据" }
}
