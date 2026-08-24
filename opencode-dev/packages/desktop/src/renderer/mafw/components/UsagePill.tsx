// @ts-nocheck
import { createSignal, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const fmtTime = (ms: number): string => {
  if (ms <= 0) return "<1h"
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d${hours % 24}h`
  }
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`
}

const severityColor = (severity: string): string => {
  if (severity === "critical") return "var(--danger)"
  if (severity === "high") return "#d19a66"
  if (severity === "mid") return "var(--warning)"
  return "var(--accent)"
}

type Props = {
  onClick?: () => void
}

export function UsagePill(props: Props) {
  const [data, setData] = createSignal<any>(null)

  const fetchUsage = async () => {
    try {
      const r = await window.api.mafw.sessions.usage()
      setData(r)
    } catch (e: any) {
      console.warn("[UsagePill] fetch failed:", e?.message)
    }
  }

  createEffect(() => { fetchUsage() })
  const timer = setInterval(fetchUsage, 60000)
  onCleanup(() => clearInterval(timer))

  const hottest = createMemo(() => {
    const d = data()
    if (!d?.providers || d.providers.length === 0) return null
    let best: { provider: string; window: any } | null = null
    let bestPct = -1
    for (const p of d.providers) {
      for (const w of p.windows) {
        if (w.pct > bestPct) {
          bestPct = w.pct
          best = { provider: p.name, window: w }
        }
      }
    }
    return best
  })

  const tooltipContent = createMemo(() => {
    const d = data()
    if (!d?.providers || d.providers.length === 0) return "暂无配额数据"
    const lines: string[] = []
    for (const p of d.providers) {
      lines.push(`${p.name}${p.plan ? ` (${p.plan})` : ""}`)
      for (const w of p.windows) {
        const reset = w.resetAt ? ` · ${fmtTime(w.resetAt - Date.now())}` : ""
        lines.push(`  ${w.window}: ${w.pct}% · $${w.used}/${w.limit}${reset}`)
      }
    }
    return lines.join("\n")
  })

  return (
    <Show when={hottest()}>
      {(h) => (
        <TooltipV2 value={tooltipContent()} openDelay={300}>
          <div class="mafw-usage-pill" onClick={() => props.onClick?.()}>
            <span class="mafw-usage-pill-dot" style={{ background: severityColor(h().window.pct >= 90 ? "critical" : h().window.pct >= 75 ? "high" : h().window.pct >= 50 ? "mid" : "low") }} />
            <span class="mafw-usage-pill-provider">{h().provider}</span>
            <span class="mafw-usage-pill-window">{h().window.window}</span>
            <span class="mafw-usage-pill-pct">{h().window.pct}%</span>
            <Show when={h().window.resetAt}>
              <span class="mafw-usage-pill-reset">{fmtTime(h().window.resetAt - Date.now())}</span>
            </Show>
          </div>
        </TooltipV2>
      )}
    </Show>
  )
}
