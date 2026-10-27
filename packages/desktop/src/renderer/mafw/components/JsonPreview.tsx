// JSON 预览（2026-10-27 G8）：可折叠树，默认展开两层；解析失败显示错误 + 建议切源码。
// rev（预览批注 A2）：行尾 hover「批注」入口 → 节点路径（JSON Pointer 风格）锚点。
import { For, Show, createSignal, createMemo, type JSX } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { jsonEntries, jsonSummary, parseJsonSafe, isJsonContainer } from "../json-tree"

const MAX_CHILDREN = 500

type AnnotateFn = (path: (string | number)[], summary: string, rect: { left: number; top: number; bottom: number }) => void

function JsonValue(props: {
  value: unknown
  depth: number
  path: (string | number)[]
  onAnnotate?: AnnotateFn
}) {
  const [open, setOpen] = createSignal(props.depth < 2)
  const container = createMemo(() => isJsonContainer(props.value))
  const isArray = () => Array.isArray(props.value)

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
              {([key, child]) => {
                const childPath = (): (string | number)[] =>
                  isArray() ? [...props.path, Number(key)] : [...props.path, key]
                return (
                  <div class="mafw-json-entry">
                    <span class="mafw-json-key">{key}</span>
                    <span class="mafw-json-colon">:</span>
                    <JsonValue value={child} depth={props.depth + 1} path={childPath()} onAnnotate={props.onAnnotate} />
                    <Show when={props.onAnnotate}>
                      <ButtonV2
                        class="mafw-json-annot"
                        variant="ghost"
                        size="small"
                        onMouseDown={(e: MouseEvent) => e.preventDefault()}
                        onClick={(e: MouseEvent) => {
                          const el = e.currentTarget as HTMLElement
                          props.onAnnotate!(childPath(), jsonSummary(child), el.getBoundingClientRect())
                        }}
                      >批注</ButtonV2>
                    </Show>
                  </div>
                )
              }}
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

export function JsonPreview(props: { text: string; onAnnotate?: AnnotateFn }): JSX.Element {
  const parsed = createMemo(() => parseJsonSafe(props.text))
  return (
    <div class="mafw-json-preview" data-annotatable="json">
      <Show when={parsed().ok} fallback={<div class="mafw-json-error">JSON 解析失败：{(parsed() as { ok: false; error: string }).error}</div>}>
        <JsonValue value={(parsed() as { ok: true; value: unknown }).value} depth={0} path={[]} onAnnotate={props.onAnnotate} />
      </Show>
    </div>
  )
}
