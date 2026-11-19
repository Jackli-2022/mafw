import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Collapsible } from "@mafw/ui/collapsible"
import { TextShimmer } from "@mafw/ui/text-shimmer"
import { Markdown } from "./markdown"
import type { ToolProps } from "./message-part"
import type { ResolvedToolPresentation, Section } from "./tool-presentation"
import "./tool-card.css"

export interface ToolCardProps {
  props: ToolProps
  presentation: ResolvedToolPresentation
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Header-only custom collapsed row; ToolCard still supplies the chevron. */
  renderCollapsed?: (props: ToolProps) => JSX.Element
  /** Body-only custom expanded content; ToolCard still supplies the shell. */
  renderBody?: (props: ToolProps) => JSX.Element
  /** Optional rich-section renderer (desktop injects ToolSections). */
  renderSections?: (sections: Section[]) => JSX.Element
}

export function ToolCard(input: ToolCardProps) {
  const [internalOpen, setInternalOpen] = createSignal(
    input.defaultOpen ?? input.presentation.expanded.defaultOpen ?? false,
  )
  const open = () => input.open ?? internalOpen()
  const setOpen = (value: boolean) => {
    if (input.open === undefined) setInternalOpen(value)
    input.onOpenChange?.(value)
  }
  const pending = () => input.props.status === "pending" || input.props.status === "running"
  const inputJson = createMemo(() => {
    const value = input.props.input
    if (!value || Object.keys(value).length === 0) return ""
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  })
  const output = () => input.props.output ?? ""
  const meta = () => input.presentation.collapsed.meta ?? []
  const actions = () => input.presentation.expanded.actions ?? []
  const state = () => (open() ? "expanded" : "collapsed")

  const defaultRow = () => (
    <div class="mafw-tool-card-row">
      <Show
        when={pending()}
        fallback={<span class="mafw-tool-card-title">{input.presentation.collapsed.title}</span>}
      >
        <TextShimmer text={input.presentation.collapsed.title} class="mafw-tool-card-title" active />
      </Show>
      <Show when={input.presentation.collapsed.object}>
        <span class="mafw-tool-card-object">{input.presentation.collapsed.object}</span>
      </Show>
      <For each={meta()}>
        {(item) => (
          <span class="mafw-tool-card-meta" data-tone={item.tone}>
            {item.text}
          </span>
        )}
      </For>
    </div>
  )

  const defaultBody = () => (
    <div class="mafw-tool-card-default">
      <Show when={inputJson()}>
        <div class="mafw-tool-card-label">input</div>
        <pre>{inputJson()}</pre>
      </Show>
      <Show when={output()}>
        <div class="mafw-tool-card-label">output</div>
        <pre>{output()}</pre>
      </Show>
      <Show when={!inputJson() && !output()}>
        <span class="mafw-tool-card-empty">(无输入/输出)</span>
      </Show>
    </div>
  )

  const body = () => {
    if (input.renderBody) return input.renderBody(input.props)
    const sections = input.presentation.expanded.sections
    if (sections?.length && input.renderSections) return input.renderSections(sections)
    const kind = input.presentation.expanded.body ?? "default"
    if (kind === "markdown") return <Markdown text={output()} />
    if (kind === "terminal" || kind === "json") {
      return <pre class="mafw-tool-card-pre">{output()}</pre>
    }
    return defaultBody()
  }

  return (
    <div
      class="mafw-tool-card"
      data-component="tool-card"
      data-state={state()}
      data-status={input.props.status ?? "completed"}
    >
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
        <Collapsible.Trigger>
          <div class="mafw-tool-card-trigger" data-state={state()}>
            <Show when={input.renderCollapsed} fallback={defaultRow()}>
              {(render) => render()(input.props)}
            </Show>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="mafw-tool-card-body" data-state={state()}>
            {body()}
            <Show when={actions().length > 0}>
              <div class="mafw-tool-card-actions" data-component="tool-card-actions">
                <For each={actions()}>
                  {(action) =>
                    action.kind === "link" && action.href ? (
                      <a class="mafw-tool-card-link" href={action.href} target="_blank" rel="noopener noreferrer">
                        {action.label ?? action.href}
                      </a>
                    ) : null
                  }
                </For>
              </div>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
