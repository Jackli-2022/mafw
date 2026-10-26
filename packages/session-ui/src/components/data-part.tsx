// T2-3 通用 data part 卡（AI SDK 6 `data-<name>`）：名称徽标 + JSON 视图 + transient。
import { Show, createMemo } from "solid-js"
import { dataPartView } from "./data-part-model"

export { dataPartView, isDataPartType, type DataPartView } from "./data-part-model"

export function DataPartCard(props: { part: any; [key: string]: any }) {
  const view = createMemo(() => dataPartView(props.part))
  return (
    <div class="mafw-data-part" data-part-name={view().name}>
      <div class="mafw-data-part-head">
        <span class="mafw-data-part-badge">data</span>
        <span class="mafw-data-part-name">{view().name}</span>
        <Show when={props.part?.transient === true}>
          <span class="mafw-data-part-transient">transient</span>
        </Show>
        <Show when={view().truncated}>
          <span class="mafw-data-part-transient">truncated</span>
        </Show>
      </div>
      <pre class="mafw-data-part-body">{view().empty ? "（空数据）" : view().json}</pre>
    </div>
  )
}
