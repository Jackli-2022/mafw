import { For, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import {
  CHAT_MODE_ITEMS,
  type ChatMode,
  type ChatModeAvailability,
} from "../chat/composer-mode"
import "../chat-mode-bar.css"

/** Composer 意图栏：讨论 / 提议 / 委托 / 解决。模式是瞬态，不改变权限。 */
export function ChatModeBar(props: {
  mode: ChatMode
  availability: ChatModeAvailability
  onMode: (mode: ChatMode) => void
}): JSX.Element {
  return (
    <div class="mafw-chat-mode-bar" role="group" aria-label="Chat 模式">
      <For each={CHAT_MODE_ITEMS}>
        {(item) => (
          <TooltipV2 value={item.hint} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-chat-mode-btn"
              data-mode={item.id}
              aria-pressed={props.mode === item.id}
              disabled={!props.availability[item.id]}
              onClick={() => props.onMode(item.id)}
            >
              {item.label}
            </ButtonV2>
          </TooltipV2>
        )}
      </For>
    </div>
  )
}
