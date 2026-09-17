/** /usage：用量概览 overlay 渲染（数据来自 gateway /api/usage/summary，fail-open）。
 *  真实形状：{ session|project|global: { totalTokens:{input,output,reasoning,cache}, totalCost, turnCount, sessionCount? }, memory? } */

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function blockLines(label: string, b: any, showSessions: boolean): string[] {
  const t = b?.totalTokens
  const out = [`${label}: ${t ? fmtTokens((t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0)) : '—'} tokens`
    + ` · 成本 ${b?.totalCost != null ? `$${b.totalCost.toFixed(2)}` : '—'}`
    + ` · 回合 ${b?.turnCount ?? '—'}`
    + (showSessions ? ` · 会话 ${b?.sessionCount ?? '—'}` : '')]
  if (t) {
    out.push(`  输入 ${fmtTokens(t.input || 0)} · 输出 ${fmtTokens(t.output || 0)} · 推理 ${fmtTokens(t.reasoning || 0)} · 缓存读 ${fmtTokens(t.cache?.read || 0)}`)
  }
  return out
}

export function usageLines(summary: any): string[] {
  const lines: string[] = ['用量概览（gateway trajectory 统计）', '']
  lines.push(...blockLines('本会话', summary?.session, false))
  lines.push(...blockLines('项目', summary?.project, true))
  lines.push(...blockLines('全局', summary?.global, true))
  return lines
}
