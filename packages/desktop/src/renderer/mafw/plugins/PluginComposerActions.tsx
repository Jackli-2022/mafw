import { For, Show, createMemo, type ComponentProps } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { pushComposerInsert } from "../composer-insert"
import { pluginDescriptors } from "./plugin-store"
import {
  composerActionsFromDescriptors,
  type PluginComposerAction,
} from "./plugin-composer-actions"

type IconName = ComponentProps<typeof Icon>["name"]

/**
 * Declarative package composer buttons. The shell renders buttons only; the
 * package action runs in the gateway and may return `{ insertText }` to append
 * text to the current draft (never to send automatically).
 */
export function PluginComposerActions(props: { sessionID: string | null }) {
  const actions = createMemo<PluginComposerAction[]>(() =>
    composerActionsFromDescriptors({
      descriptors: pluginDescriptors(),
      invoke: (name, action, input, sessionID) =>
        window.api.mafw.plugins.invoke(name, action, input, sessionID),
      onInsert: (sessionID, text) => pushComposerInsert(sessionID, text),
      onError: (message) =>
        showToastV2({ description: message, duration: 4000 } as any),
    }),
  )

  return (
    <Show when={actions().length > 0}>
      <For each={actions()}>
        {(action) => (
          <TooltipV2 value={action.label} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-composer-icon mafw-composer-plugin"
              aria-label={action.label}
              disabled={!props.sessionID}
              onClick={() => {
                const sessionID = props.sessionID
                if (!sessionID) return
                void action.run(sessionID)
              }}
            >
              <Icon name={action.icon as IconName} size="small" />
            </ButtonV2>
          </TooltipV2>
        )}
      </For>
    </Show>
  )
}
