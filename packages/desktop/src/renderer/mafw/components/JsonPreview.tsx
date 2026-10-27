// JSON 预览（2026-10-27 G8）：可折叠树，默认展开两层；解析失败显示错误 + 建议切源码。
import { For, Show, createSignal, createMemo, type JSX } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { jsonEntries, jsonSummary, parseJsonSafe, isJsonContainer } from "../json-tree"

const MAX_CHILDREN = 500

function JsonValue(props: { value: unknown; depth: number }) {
  const [open, setOpen] = createSignal(props.depth < 2)
  const container = createMemo(() => isJsonContainer(props.value))

  return (
    <Show
      when={container()}
      fallback={<span class="mafw-json-value">{jsonSummary(props.value)}</span>}
    >
      <div class="mafw-json-branch">
        <div
          class="mafw-json-row mafw-json-toggle"
          role="button"
          tabIndex={0}
          onClick={() => setOpen(!open())}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setOpen(!open())
            }
          }}
        >
          <span class="mafw-json-chevron">
            <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          </span>
          <span class="mafw-json-summary">{jsonSummary(props.value)}</span>
        </div>
        <Show when={open()}>
          <div class="mafw-json-children">
            <For each={jsonEntries(props.value, MAX_CHILDREN).items}>
              {([key, child]) => (
                <div class="mafw-json-entry">
                  <span class="mafw-json-key">{key}</span>
                  <span class="mafw-json-colon">:</span>
                  <JsonValue value={child} depth={props.depth + 1} />
                </div>
              )}
            </For>
            <Show when={jsonEntries(props.value, MAX_CHILDREN).truncated > 0}>
              <div class="mafw-json-more">… 还有 {jsonEntries(props.value, MAX_CHILDREN).truncated} 项（切换源码查看）</div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export function JsonPreview(props: { text: string }): JSX.Element {
  const parsed = createMemo(() => parseJsonSafe(props.text))
  return (
    <div class="mafw-json-preview">
      <Show when={parsed().ok} fallback={<div class="mafw-json-error">JSON 解析失败：{(parsed() as { ok: false; error: string }).error}</div>}>
        <JsonValue value={(parsed() as { ok: true; value: unknown }).value} depth={0} />
      </Show>
    </div>
  )
}
