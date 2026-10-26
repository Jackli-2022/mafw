// PendingCaptures：composer 上方的截图/元素点选待发草稿（G1/G2）。
// 与 PendingAnnotations 并列；发送时由 useSendMessage 打包（formatCaptureBatch）。
import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { getPendingCaptures } from "../chat/pending-captures"

export function PendingCaptures(props: { sessionID: string | null }) {
  const store = getPendingCaptures()
  const items = () => (props.sessionID ? store.pendingFor(props.sessionID) : [])
  return (
    <Show when={items().length > 0}>
      <div class="mafw-pending-captures">
        <div class="mafw-pending-captures-head">
          <span>{items().length} 条截图/元素批注</span>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.sessionID && store.clear(props.sessionID)}>清空</ButtonV2>
        </div>
        <For each={items()}>
          {(c) => (
            <div class="mafw-pending-capture-row">
              <img class="mafw-pending-capture-thumb" src={c.dataUrl} alt="" />
              <span class="mafw-pending-capture-kind">{c.kind === "element" ? "元素点选" : "截屏"}</span>
              <TextInputV2
                class="mafw-pending-capture-comment"
                value={c.comment}
                placeholder="补充说明（可选）…"
                onInput={(e) => props.sessionID && store.updateComment(props.sessionID, c.id, e.currentTarget.value)}
              />
              <TooltipV2 value="移除" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  aria-label="移除"
                  onClick={() => props.sessionID && store.remove(props.sessionID, c.id)}
                >
                  <Icon name="close-small" size="small" />
                </ButtonV2>
              </TooltipV2>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
