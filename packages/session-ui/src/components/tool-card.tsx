import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Collapsible } from "@mafw/ui/collapsible"
import { TextShimmer } from "@mafw/ui/text-shimmer"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import stripAnsi from "strip-ansi"
import { Markdown } from "./markdown"
import type { ToolProps } from "./message-part"
import type { ResolvedToolPresentation, Section, ToolAction } from "./tool-presentation"
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
  /** Context-group mode: collapsed row only, no chevron/body. */
  group?: boolean
  /** Navigate to a subagent session from an `open-subagent` action. */
  onOpenSession?: (sessionID: string) => void
}

function safeHref(href: string | undefined): string | undefined {
  return href && /^https?:\/\//i.test(href) ? href : undefined
}

export function ToolCard(input: ToolCardProps) {
  const [internalOpen, setInternalOpen] = createSignal(input.defaultOpen ?? false)
  const open = () => input.open ?? internalOpen()
  const setOpen = (value: boolean) => {
    if (input.open === undefined) setInternalOpen(value)
    input.onOpenChange?.(value)
  }
  const status = () => input.presentation.collapsed.status
  const pending = () => status() === "pending" || status() === "running"
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
  const linkAction = () => actions().find((action) => action.kind === "link" && safeHref(action.href))
  const state = () => (open() ? "expanded" : "collapsed")
  const internalHref = (href: string | undefined) => (href && /^\/(?!\/)/.test(href) ? href : undefined)
  const visibleActions = () =>
    actions().filter((action) => {
      if (action.kind === "link") return !!safeHref(action.href)
      if (action.kind !== "open-subagent" || !action.sessionID) return false
      return !!internalHref(action.href) || !!input.onOpenSession
    })

  const renderAction = (action: ToolAction) => {
    if (action.kind === "link") {
      const href = safeHref(action.href)
      return href ? (
        <a class="mafw-tool-card-link" href={href} target="_blank" rel="noopener noreferrer">
          {action.label ?? href}
        </a>
      ) : null
    }
    if (action.kind !== "open-subagent" || !action.sessionID) return null
    const sessionID = action.sessionID
    const label = action.label ?? sessionID
    const href = internalHref(action.href)
    if (href) {
      return (
        <a
          class="mafw-tool-card-link"
          href={href}
          onClick={(event) => {
            if (!input.onOpenSession) return
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            event.preventDefault()
            input.onOpenSession(sessionID)
          }}
        >
          {label}
          <Icon name="square-arrow-top-right" size="small" />
        </a>
      )
    }
    if (!input.onOpenSession) return null
    return (
      <ButtonV2 size="small" variant="ghost-muted" onClick={() => input.onOpenSession?.(sessionID)}>
        {label}
        <Icon name="square-arrow-top-right" size="small" />
      </ButtonV2>
    )
  }

  const defaultRow = () => (
    <div class="mafw-tool-card-row">
      <Show
        when={pending()}
        fallback={<span class="mafw-tool-card-title">{input.presentation.collapsed.title}</span>}
      >
        <TextShimmer text={input.presentation.collapsed.title} class="mafw-tool-card-title" active />
      </Show>
      <Show when={input.presentation.collapsed.object}>
        <Show
          when={linkAction()?.href ? safeHref(linkAction()!.href) : undefined}
          fallback={<span class="mafw-tool-card-object">{input.presentation.collapsed.object}</span>}
        >
          {(href) => (
            <a class="mafw-tool-card-object" href={href()} target="_blank" rel="noopener noreferrer">
              {input.presentation.collapsed.object}
            </a>
          )}
        </Show>
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

  const header = () => (
    <Show when={input.renderCollapsed} fallback={defaultRow()}>
      {(render) => render()(input.props)}
    </Show>
  )

  const defaultBody = () => (
    <div class="mafw-tool-card-default">
      <Show when={inputJson()}>
        <div class="mafw-tool-card-label">input</div>
        <pre tabIndex={0} role="region" aria-label="tool input">{inputJson()}</pre>
      </Show>
      <Show when={output()}>
        <div class="mafw-tool-card-label">output</div>
        <pre tabIndex={0} role="region" aria-label="tool output">{output()}</pre>
      </Show>
      <Show when={!inputJson() && !output()}>
        <span class="mafw-tool-card-empty">(无输入/输出)</span>
      </Show>
    </div>
  )

  const terminalText = () => {
    const command = typeof input.props.input?.command === "string" ? input.props.input.command : ""
    const out = stripAnsi(output())
    return command ? `$ ${command}${out ? `\n\n${out}` : ""}` : out
  }

  const body = () => {
    if (input.renderBody) return <Dynamic component={input.renderBody} {...input.props} />
    const sections = input.presentation.expanded.sections
    if (sections?.length && input.renderSections) return input.renderSections(sections)
    const kind = input.presentation.expanded.body ?? "default"
    if (kind === "markdown") return <Markdown text={output()} />
    if (kind === "terminal") return <pre class="mafw-tool-card-pre" tabIndex={0} role="region" aria-label="tool output">{terminalText()}</pre>
    if (kind === "json") return <pre class="mafw-tool-card-pre" tabIndex={0} role="region" aria-label="tool output">{stripAnsi(output())}</pre>
    return defaultBody()
  }

  if (input.group) {
    return (
      <div class="mafw-tool-card mafw-tool-card-group" data-component="tool-card" data-state="collapsed" data-status={status()}>
        <div class="mafw-tool-card-trigger" data-state="collapsed">{header()}</div>
      </div>
    )
  }

  return (
    <div class="mafw-tool-card" data-component="tool-card" data-state={state()} data-status={status()}>
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
        <Collapsible.Trigger>
          <div class="mafw-tool-card-trigger" data-state={state()}>
            {header()}
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="mafw-tool-card-body" data-state={state()}>
            {body()}
            <Show when={visibleActions().length > 0}>
              <div class="mafw-tool-card-actions" data-component="tool-card-actions">
                <For each={visibleActions()}>{(action) => renderAction(action)}</For>
              </div>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
