import { createMemo, createSignal, For, Show } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { Icon } from "@mafw/ui/icon"
import { TextShimmer } from "@mafw/ui/text-shimmer"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { genericSections, rawSection } from "./extract"
import { ToolSections } from "./shared"
import {
  executeCallArgs,
  executeCalls,
  executeHeaderSubtitle,
  executeOutputView,
  executeToolIcon,
  executeToolLabel,
  type ExecuteCall,
} from "./execute-model"

function statusText(status: ExecuteCall["status"]) {
  if (status === "completed") return "✓"
  if (status === "error") return "✗"
  return "›"
}

function ExecuteCallRow(props: { call: ExecuteCall }) {
  const [open, setOpen] = createSignal(false)
  const input = createMemo(() => props.call.input)
  const hasInput = createMemo(() => !!input() && Object.keys(input()!).length > 0)
  const args = createMemo(() => executeCallArgs(input()))
  const toggle = () => {
    if (!hasInput()) return
    setOpen((value) => !value)
  }

  return (
    <div class="mafw-execute-call-item">
      <div
        class="mafw-execute-call"
        data-status={props.call.status}
        data-expanded={open() ? "true" : undefined}
        role={hasInput() ? "button" : undefined}
        tabIndex={hasInput() ? 0 : undefined}
        aria-expanded={hasInput() ? open() : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="mafw-execute-call-status" aria-hidden="true">{statusText(props.call.status)}</span>
        <span class="mafw-execute-call-icon" aria-hidden="true">
          <Icon name={executeToolIcon(props.call.tool) as any} size="small" />
        </span>
        <span class="mafw-execute-call-name">
          <TextShimmer text={executeToolLabel(props.call.tool)} active={props.call.status === "running"} />
        </span>
        <Show when={args().length > 0}>
          <span class="mafw-execute-call-args">{args().join(", ")}</span>
        </Show>
        <Show when={hasInput()}>
          <span class="mafw-execute-call-chevron" aria-hidden="true">{open() ? "▾" : "▸"}</span>
        </Show>
      </div>
      <Show when={open() && hasInput()}>
        <pre class="mafw-execute-call-input">{JSON.stringify(input(), null, 2)}</pre>
      </Show>
    </div>
  )
}

/** Code Mode execute: child calls stream through metadata.toolCalls. */
export function MafwExecuteCard(props: ToolProps) {
  const calls = createMemo(() => executeCalls(props.metadata))
  const subtitle = createMemo(() => executeHeaderSubtitle(calls()))
  const pending = () => props.status === "pending" || props.status === "running"
  const failed = () =>
    props.status === "error" ||
    props.metadata?.error === true ||
    calls().some((call) => call.status === "error")
  const [showAll, setShowAll] = createSignal(false)
  const output = createMemo(() => executeOutputView(props.output))
  const sections = createMemo(() => {
    if (pending()) return []
    if (output().truncated && showAll()) return rawSection(props.output)
    return genericSections(output().truncated ? output().preview : props.output)
  })

  return (
    <BasicTool
      icon="console"
      status={props.status}
      defaultOpen
      defer={false}
      trigger={(open) => (
        <div class="mafw-execute-trigger">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text="Code Mode 执行" active={pending()} />
              </span>
              <Show when={!open() && subtitle()}>
                <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
              </Show>
              <Show when={calls().length > 0}>
                <span class="mafw-execute-count" data-failed={failed() ? "true" : undefined}>
                  {calls().length} 次调用{failed() ? " · 有失败" : ""}
                </span>
              </Show>
            </div>
          </div>
        </div>
      )}
    >
      <div class="mafw-tool-box mafw-execute-box">
        <Show
          when={calls().length > 0}
          fallback={
            <div class="mafw-execute-empty">
              {pending() ? "等待脚本调用工具…" : "脚本未调用工具"}
            </div>
          }
        >
          <div class="mafw-execute-calls">
            <For each={calls()}>{(call) => <ExecuteCallRow call={call} />}</For>
          </div>
        </Show>
        <Show when={!pending() && failed() && sections().length === 0}>
          <div class="mafw-tool-meta" style="color:#e8636b">执行失败</div>
        </Show>
        <Show when={!pending() && output().truncated}>
          <div class="mafw-execute-more">
            <span>输出已截断（{output().chars} 字符 / {output().lines} 行）</span>
            <ButtonV2 variant="ghost" size="small" onClick={() => setShowAll((value) => !value)}>
              {showAll() ? "收起" : "展开全部"}
            </ButtonV2>
          </div>
        </Show>
        <Show when={sections().length > 0}>
          <div class="mafw-execute-output">
            <div class="mafw-execute-output-label">{showAll() && output().truncated ? "输出（全文）" : "输出"}</div>
            <ToolSections sections={sections()} />
          </div>
        </Show>
      </div>
    </BasicTool>
  )
}
