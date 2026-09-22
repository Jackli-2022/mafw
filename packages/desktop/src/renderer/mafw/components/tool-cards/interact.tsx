import { For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"

function safeJson(text: string): any {
  try { return JSON.parse(text) } catch (e) { console.warn("[mafw]", e); return [] }
}

export function MafwDeltasCard(props: ToolProps) {
  const deltas = () => {
    const raw = props.output || "[]"
    const parsed = safeJson(raw)
    return Array.isArray(parsed) ? parsed : parsed.deltas || parsed.results || []
  }
  return (
    <BasicTool
      icon="pencil-line"
      trigger={{ title: "MAFW Δ Deltas", subtitle: `${deltas().length} parametric constraint(s)` }}
      status={props.status}
    >
      <For each={deltas()}>{(d: any) => (
        <div class="mafw-delta-row">
          <span class="mafw-tool-tag mafw-tag-delta">{d.type?.startsWith("C") ? "C" : "P"}</span>
          <div class="mafw-delta-content">
            <div class="mafw-delta-text">{d.content || d.constraint || d.prompt || ""}</div>
            <Show when={d.priority}><span class="mafw-delta-priority">prio: {d.priority}</span></Show>
          </div>
        </div>
      )}</For>
    </BasicTool>
  )
}
