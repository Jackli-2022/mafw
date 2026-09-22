import { For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"

function safeJson(text: string): any {
  try { return JSON.parse(text) } catch (e) { console.warn("[mafw]", e); return [] }
}

export function MafwSearchCard(props: ToolProps) {
  const results = () => safeJson(props.output || "[]")
  return (
    <BasicTool
      icon="magnifying-glass-menu"
      trigger={{ title: "MAFW Hybrid Search", subtitle: props.input?.query, args: [`topK: ${props.input?.topK || 20}`] }}
      status={props.status}
      defaultOpen
    >
      <div class="mafw-tool-results">
        <For each={results()}>{(r: any) => (
          <div class="mafw-tool-result">
            <span class="mafw-tool-tag" classList={{
              "mafw-tag-semantic": r.type === "semantic",
              "mafw-tag-procedural": r.type === "procedural",
              "mafw-tag-episodic": r.type === "episodic",
              "mafw-tag-delta": r.source === "parametric",
            }}>{r.source === "parametric" ? "Δ" : r.type?.[0]?.toUpperCase()}</span>
            <span class="mafw-tool-result-text">{r.primary_abstraction || r.content}</span>
            <span class="mafw-tool-energy">E:{typeof r.energy === "number" ? r.energy.toFixed(1) : r.energy}</span>
          </div>
        )}</For>
        <Show when={results().length === 0 && props.status === "completed"}>
          <div class="mafw-tool-empty">No results</div>
        </Show>
      </div>
    </BasicTool>
  )
}
