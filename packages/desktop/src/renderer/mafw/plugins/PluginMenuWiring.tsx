import { createEffect, onCleanup } from "solid-js"
import { menuContributions } from "../context-menu/contributions"
import { pluginDescriptors } from "./plugin-store"
import { applyPluginMenuDescriptors } from "./plugin-menu-contributions"

/**
 * Keeps the host context-menu registry in sync with committed plugin
 * descriptors. Mounted once by the shell; revision changes and package removal
 * dispose the previous contributions before registering the next snapshot.
 */
export function PluginMenuWiring(props: { sessionID: string | null }) {
  createEffect(() => {
    const descriptors = pluginDescriptors()
    const dispose = applyPluginMenuDescriptors({
      descriptors,
      register: (contribution) => menuContributions.register(contribution),
      invoke: (name, action, input, sessionID) =>
        window.api.mafw.plugins.invoke(name, action, input, sessionID),
      sessionID: () => props.sessionID,
      onError: (message) => console.warn(`[plugins] ${message}`),
    })
    onCleanup(dispose)
  })
  return null
}
