import { For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { RULE_TOOLS } from "./registered-tools"

function safeJson(text: string): any {
  try { return JSON.parse(text) } catch (e) { console.warn("[mafw]", e); return [] }
}

export { RULE_TOOLS }

export function MafwRuleCard(props: ToolProps) {
  const toolName = () => props.tool?.replace(/^mafw_/, "") || ""
  const isTriage = () => toolName().includes("triage")
  const rules = () => {
    const parsed = safeJson(props.output || "[]")
    return Array.isArray(parsed) ? parsed : parsed.rules || parsed.items || []
  }
  const nextRuns = () => {
    const parsed = safeJson(props.output || "[]")
    return Array.isArray(parsed) ? [] : parsed.nextRuns || parsed.next5 || []
  }
  return (
    <BasicTool
      icon={isTriage() ? "warning" : "sliders"}
      trigger={{ title: `MAFW ${toolName()}`, subtitle: props.input?.rule_id || props.input?.id || props.input?.triage_id || `${rules().length} item(s)` }}
      status={props.status}
    >
      <For each={rules()}>{(r: any) => (
        <div class="mafw-card" style={{ "margin-bottom": 4 }}>
          <div style={{ flex: 1 }}>
            <div class="mafw-tool-result-text">{r.name || r.id || r.goalId || r.reason}</div>
            <Show when={r.trigger?.schedule}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.trigger.schedule}{r.trigger.timezone ? ` (${r.trigger.timezone})` : ""}</div>
            </Show>
            <Show when={r.action?.type}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.action.type}</div>
            </Show>
            <Show when={r.reason}>
              <div class="mafw-tool-meta" style="font-size:11px">{r.reason}</div>
            </Show>
          </div>
          <Show when={r.enabled !== undefined}>
            <span class="mafw-tool-tag" style={{
              background: r.enabled ? "var(--accent-bg)" : "transparent",
              color: r.enabled ? "var(--accent)" : "var(--text-muted)",
              border: "0.5px solid var(--border-base)",
            }}>{r.enabled ? "ON" : "OFF"}</span>
          </Show>
          <Show when={r.severity}>
            <span class="mafw-tool-tag" style={{
              background: r.severity === "high" ? "rgba(232,99,107,0.15)" : r.severity === "medium" ? "rgba(232,184,75,0.15)" : "rgba(118,152,253,0.15)",
              color: r.severity === "high" ? "#e8636b" : r.severity === "medium" ? "#e8b84b" : "#7698fd",
            }}>{r.severity}</span>
          </Show>
        </div>
      )}</For>
      <For each={nextRuns()}>{(t: string) => (
        <div class="mafw-tool-meta" style="font-size:11px">下次触发: {t}</div>
      )}</For>
    </BasicTool>
  )
}
