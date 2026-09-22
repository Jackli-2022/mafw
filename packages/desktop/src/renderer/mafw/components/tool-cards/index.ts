import { ToolRegistry } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"

export function registerMafwToolCards() {
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    ToolRegistry.register({ name, render: familyCard(spec) })
  }
}
