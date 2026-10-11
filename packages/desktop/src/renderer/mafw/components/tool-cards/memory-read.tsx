import { For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { searchResults } from "./extract"

export function MafwSearchCard(props: ToolProps) {
  const model = () => searchResults(props.output)
  return (
    <BasicTool
      icon="magnifying-glass-menu"
      trigger={{ title: "MAFW Hybrid Search", subtitle: props.input?.query, args: [`topK: ${props.input?.topK || 20}`] }}
      status={props.status}
      defaultOpen
    >
      <div class="mafw-tool-box">
      <div class="mafw-tool-results">
        <For each={model().results}>{(r) => (
          <div class="mafw-tool-result">
            <span class="mafw-tool-tag" classList={{
              "mafw-tag-semantic": r.type === "semantic",
              "mafw-tag-procedural": r.type === "procedural",
              "mafw-tag-episodic": r.type === "episodic",
              "mafw-tag-delta": r.source === "parametric",
            }}>{r.source === "parametric" ? "Δ" : r.type?.[0]?.toUpperCase()}</span>
            <span class="mafw-tool-result-text">{r.title}</span>
            <Show when={r.energy !== undefined}><span class="mafw-tool-energy">E:{r.energy}</span></Show>
          </div>
        )}</For>
        <Show when={model().results.length === 0 && props.status === "completed"}>
          <div class="mafw-tool-empty">No results</div>
        </Show>
      </div>
      <Show when={model().fok}><div class="mafw-tool-meta">{model().fok}</div></Show>
      <Show when={model().hint}><div class="mafw-tool-meta" style="font-size:11px">{model().hint}</div></Show>
      </div>
    </BasicTool>
  )
}
