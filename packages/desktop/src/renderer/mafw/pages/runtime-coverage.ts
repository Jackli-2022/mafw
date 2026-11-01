// Runtime 契约覆盖摘要（Config › 插件中心展示用纯函数）。
// 数据源：GET /api/runtime 的 active.coverage.static（RuntimeCoverage）。
export type CoverageTone = 'ok' | 'warn'

export interface RuntimeCoverageSummary {
  label: string
  tone: CoverageTone
}

const WARN_MODES = new Set(['self', 'legacy-self'])

/**
 * @param rt `window.api.mafw.runtime.get()` 结果（可能为 null / 旧 gateway 无 coverage）
 * @param preset 展示用的 preset 档位（缺省 conversation，与编写指南默认档一致）
 */
export function runtimeCoverageSummary(rt: any, preset = 'conversation'): RuntimeCoverageSummary | null {
  const st = rt?.active?.coverage?.static
  if (!st) return null
  const p = st.presets?.[preset]
  const mode: string | undefined = st.translation?.mode
  if (!p && !mode) return null

  const parts: string[] = []
  if (p) parts.push(`覆盖 ${p.covered}/${p.required}（${preset}）`)
  if (mode) parts.push(`翻译 ${mode}`)

  const warn = (p ? (p.missing?.length ?? 0) > 0 : false) || (mode ? WARN_MODES.has(mode) : false)
  return { label: (warn ? '⚠️ ' : '') + parts.join(' · '), tone: warn ? 'warn' : 'ok' }
}
