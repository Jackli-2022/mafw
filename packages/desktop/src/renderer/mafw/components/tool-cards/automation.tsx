import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { ruleSections } from "./rule-model"
import { ToolSections } from "./shared"

export function MafwRuleCard(props: ToolProps) {
  const toolName = () => props.tool?.replace(/^mafw_/, "") || ""
  const isTriage = () => toolName().includes("triage")
  return (
    <BasicTool
      icon={isTriage() ? "warning" : "sliders"}
      trigger={{
        title: `MAFW ${toolName()}`,
        subtitle: props.input?.rule_id || props.input?.id || props.input?.triage_id,
      }}
      status={props.status}
    >
      <ToolSections sections={ruleSections(props.tool, props.output)} />
    </BasicTool>
  )
}
