import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { addMemorySections, trunc, type Section } from "./extract"
import { ToolSections } from "./shared"

export function MafwAddMemoryCard(props: ToolProps) {
  const sections = (): Section[] => addMemorySections(props.input, props.output)
  return (
    <BasicTool
      icon="brain"
      trigger={{ title: "MAFW Add Memory", subtitle: props.input?.primaryAbstraction ?? trunc(props.input?.content, 40) }}
      status={props.status}
      animated
    >
      <div class="mafw-tool-box"><ToolSections sections={sections()} /></div>
    </BasicTool>
  )
}
