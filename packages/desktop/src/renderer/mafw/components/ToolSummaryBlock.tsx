// ToolSummaryBlock：把一回合的元数据行折叠成一行（工具名摘要），点击展开看全部行。
// 仅 1 行时直接渲染，不提供无意义的折叠。
import { createMemo, createSignal, For, Show } from "solid-js"
import { toolLineSummary, type ToolSummaryLine } from "./tool-summary"

const SummaryLine = (props: { line: ToolSummaryLine }) => (
  <div class="mafw-tool-summary-line" classList={{ error: !!props.line.error }}>
    <span class="mafw-tool-summary-icon">{props.line.icon}</span>
    <span class="mafw-tool-summary-text">{props.line.text}</span>
  </div>
)

export function ToolSummaryBlock(props: { lines: ToolSummaryLine[] }) {
  const [open, setOpen] = createSignal(false)
  const summary = createMemo(() => toolLineSummary(props.lines))
  const hasError = createMemo(() => (props.lines ?? []).some(l => l.error))
  const toggle = () => setOpen(o => !o)

  return (
    <Show when={(props.lines ?? []).length > 0}>
      <div class="mafw-tool-summary">
        <Show
          when={(props.lines ?? []).length > 1}
          fallback={<SummaryLine line={props.lines[0]} />}
        >
          <div
            class="mafw-tool-summary-line mafw-tool-summary-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={open() ? "true" : "false"}
            onClick={toggle}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle() } }}
          >
            <span class="mafw-tool-summary-icon">{hasError() ? "✗" : "✓"}</span>
            <span class="mafw-tool-summary-text">
              {summary().text}{summary().extra > 0 ? ` +${summary().extra}` : ""}
            </span>
            <span class="mafw-approval-caret" aria-hidden="true">{open() ? "▾" : "▸"}</span>
          </div>
          <Show when={open()}>
            <For each={props.lines}>{(line) => <SummaryLine line={line} />}</For>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
