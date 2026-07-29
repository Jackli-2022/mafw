// @ts-nocheck
import { createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

type Props = {
  summary?: string
}

export function CompressionDivider(props: Props) {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div class="mafw-compression-divider" onClick={() => setExpanded(!expanded)}>
      <div class="mafw-compression-line" />
      <div class="mafw-compression-label">
        <Icon name="collapse" size="small" />
        <span>已压缩 · 查看摘要</span>
        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
      </div>
      <div class="mafw-compression-line" />
      {expanded() && props.summary && (
        <div class="mafw-compression-summary">{props.summary}</div>
      )}
    </div>
  )
}
