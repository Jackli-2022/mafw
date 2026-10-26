// T2-2: run banner view model (pure).
import type { RunState } from "@mafw/sdk"

export interface RunBannerView {
  text: string
  canResume: boolean
  canDiscard: boolean
}

function snippet(text: string, max = 60): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  if (!t) return "（无请求摘要）"
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function runBanner(run: RunState | null | undefined, busy: boolean): RunBannerView | null {
  if (!run) return null
  const summary = snippet(run.brief?.lastUserText ?? "")
  if (run.status === "suspended") {
    return {
      text: `已暂停 · ${summary}`,
      canResume: !busy,
      canDiscard: true,
    }
  }
  if (run.status === "resumed") {
    return {
      text: `恢复中 · ${summary}`,
      canResume: false,
      canDiscard: !busy,
    }
  }
  return null
}
