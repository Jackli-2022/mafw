import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { ruleBadge, ruleSections } from "./rule-model"
import { ToolSections } from "./shared"

export function MafwRuleCard(props: ToolProps) {
  const toolName = () => props.tool?.replace(/^mafw_/, "") || ""
  const isTriage = () => toolName().includes("triage")
  const badge = () => (props.status === "completed" ? ruleBadge(props.tool, props.output) : undefined)
  return (
    <BasicTool
      icon={isTriage() ? "warning" : "sliders"}
      trigger={{
        title: `MAFW ${toolName()}`,
        subtitle: props.input?.rule_id || props.input?.id || props.input?.triage_id,
        action: badge() ? <span class="mafw-tool-badge" data-tone={badge()!.tone ?? "muted"}>{badge()!.text}</span> : undefined,
      }}
      status={props.status}
      animated
    >
      <div class="mafw-tool-box"><ToolSections sections={ruleSections(props.tool, props.output)} /></div>
    </BasicTool>
  )
}
