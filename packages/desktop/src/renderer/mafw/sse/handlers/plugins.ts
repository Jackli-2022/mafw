// Task 7: pre-session-id SSE branch for unified plugin frames.
//
// `plugins.changed` carries only the committed revision; `plugin:<package>:<event>`
// is a registered package event. Both are global frames (often without a
// sessionID) and must be consumed before the dispatcher's session-id routing —
// otherwise global plugin events would be dropped by the tail miss-trace and the
// revision notification would be silently ignored by class.
import type { ShellEventDeps } from "../dispatcher"

export function handlePluginSseEvent(event: any, deps: ShellEventDeps): boolean {
  const type = typeof event?.type === "string" ? event.type : ""

  if (type === "plugins.changed") {
    deps.core.trace(event, "plugins:changed")
    deps.plugins.onChanged(event)
    return true
  }

  if (!type.startsWith("plugin:")) return false

  deps.core.trace(event, "plugins:event")
  deps.plugins.onEvent(event)
  return true
}
