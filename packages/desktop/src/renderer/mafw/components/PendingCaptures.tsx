// PendingCaptures：composer 上方的截图/元素点选待发草稿（G1/G2）。
// 与 PendingAnnotations 并列；发送时由 useSendMessage 打包（formatCaptureBatch）。
// 用 Index 保持输入框 DOM/焦点稳定（For 按引用重建会在每次输入后丢焦点）。
import { Index, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { getPendingCaptures, type PendingCapture } from "../chat/pending-captures"

export function PendingCaptures(props: {
  sessionID: string | null
  /** 移除联动（ChatPane 用来同时移除同名附件）。 */
  onRemove?: (item: PendingCapture) => void
}) {
  const store = getPendingCaptures()
  const items = () => (props.sessionID ? store.pendingFor(props.sessionID) : [])
  const remove = (item: PendingCapture) => {
    if (!props.sessionID) return
    props.onRemove?.(item)
    store.remove(props.sessionID, item.id)
  }
  const clear = () => {
    if (!props.sessionID) return
    for (const item of store.pendingFor(props.sessionID)) props.onRemove?.(item)
    store.clear(props.sessionID)
  }
  return (
    <Show when={items().length > 0}>
      <div class="mafw-pending-captures">
        <div class="mafw-pending-captures-head">
          <span>{items().length} 条截图/元素批注</span>
          <ButtonV2 variant="ghost" size="small" onClick={clear}>清空</ButtonV2>
        </div>
        <Index each={items()}>
          {(c) => (
            <div class="mafw-pending-capture-row">
              <Show when={c().dataUrl}>
                <img class="mafw-pending-capture-thumb" src={c().dataUrl} alt="" />
              </Show>
              <span class="mafw-pending-capture-kind">{c().kind === "element" ? "元素点选" : "截屏"}</span>
              <TextInputV2
                class="mafw-pending-capture-comment"
                value={c().comment}
                placeholder="补充说明（可选）…"
                onInput={(e) => props.sessionID && store.updateComment(props.sessionID, c().id, e.currentTarget.value)}
              />
              <TooltipV2 value="移除" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  aria-label="移除"
                  onClick={() => remove(c())}
                >
                  <Icon name="close-small" size="small" />
                </ButtonV2>
              </TooltipV2>
            </div>
          )}
        </Index>
      </div>
    </Show>
  )
}
