// 待发送批注列表（composer 上方）：草稿可攒、逐条删、清空；发送时随消息打包。
import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { clearPending, pendingFor, removePending } from "../annotation-store"
import { describeAnchor } from "../annotation-anchor"

export function PendingAnnotations(props: { sessionID: string | null }) {
  const items = () => (props.sessionID ? pendingFor(props.sessionID) : [])
  const label = (a: { rel: string; anchor?: Parameters<typeof describeAnchor>[0]; startLine: number; endLine: number }) => {
    if (a.anchor) return `${a.rel} › ${describeAnchor(a.anchor)}`
    return `${a.rel}:L${a.startLine}${a.endLine !== a.startLine ? `-${a.endLine}` : ""}`
  }
  return (
    <Show when={props.sessionID && items().length > 0}>
      <div class="mafw-pending-annotations">
        <div class="mafw-pending-annotations-head">
          <span class="mafw-pending-annotations-count">待发送批注 {items().length}</span>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.sessionID && clearPending(props.sessionID)}>清空</ButtonV2>
        </div>
        <For each={items()}>
          {(a) => (
            <div class="mafw-pending-annotation">
              <span class="mafw-pending-annotation-kind" data-kind={a.anchor?.kind ?? "lines"} aria-hidden="true" />
              <span class="mafw-pending-annotation-where" title={label(a)}>
                {label(a)}
              </span>
              <span class="mafw-pending-annotation-text" title={a.comment}>{a.comment}</span>
              <ButtonV2
                variant="ghost"
                size="small"
                aria-label="移除批注"
                onClick={() => removePending(a.sessionID, a.id)}
              >✕</ButtonV2>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
