import { Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"

export function MafwAddMemoryCard(props: ToolProps) {
  return (
    <BasicTool
      icon="brain"
      trigger={{ title: "MAFW Add Memory", subtitle: props.input?.primary_abstraction }}
      status={props.status}
    >
      <div class="mafw-tool-meta-grid">
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Type</span>{props.input?.memory_type}</div>
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Energy</span>{props.input?.energy}</div>
        <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">Salience</span>{props.input?.salience ?? props.input?.salience === 0 ? props.input.salience : "-"}</div>
      </div>
      <Show when={props.input?.cue_anchors?.length}>
        <div class="mafw-tool-anchors">
          <span class="mafw-tool-meta-label">Anchors</span>
          {(props.input?.cue_anchors || []).map((a: string) => (
            <span class="mafw-tool-chip">{a}</span>
          ))}
        </div>
      </Show>
    </BasicTool>
  )
}
