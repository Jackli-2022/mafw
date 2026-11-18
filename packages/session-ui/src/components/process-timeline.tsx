import { For, Show, createMemo, createSignal } from 'solid-js'
import { Collapsible } from '@mafw/ui/collapsible'
import { Icon } from '@mafw/ui/icon'
import { TextShimmer } from '@mafw/ui/text-shimmer'
import { Markdown } from './markdown'
import { getToolInfo } from './message-part'
import { formatDuration, processSummary, defaultSegmentOpen } from './process-timeline-model'
import type { MafwPart } from '@mafw/sdk'
import type { ProcessStep, TurnEntry } from './turn-transcript'
import './process-timeline.css'

export interface ProcessTimelineProps {
  entries: TurnEntry[]
  working?: boolean
  showReasoning?: boolean
  /** Project root for relative-path display. */
  directory?: string
  /** Historical fallback when part timestamps are missing (whole turn). */
  fallbackDurationMs?: number
  renderCard: (part: any) => any
  renderData: (part: MafwPart) => any
  /** Render an output text part with the shell's normal text-part actions. */
  renderOutput?: (part: any) => any
}

/** Action tools keep their native diff/detail card inside the drawer. */
const CARD_TOOLS = new Set(['edit', 'write', 'apply_patch'])

function stateOf(part: any): string {
  return part?.state?.status ?? 'completed'
}

function isRunning(part: any): boolean {
  const status = stateOf(part)
  return status === 'running' || status === 'pending'
}

function statusIcon(part: any) {
  const status = stateOf(part)
  if (status === 'error') return '⚠'
  if (status === 'running' || status === 'pending') return '·'
  return '✓'
}

function outputText(part: any): string {
  const content = part?.state?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item: any) => (typeof item === 'string' ? item : item?.text ?? ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function ToolRow(props: { step: Extract<ProcessStep, { type: 'tool' }>; directory?: string }) {
  const [open, setOpen] = createSignal(false)
  const info = createMemo(() => getToolInfo(
    props.step.tool,
    (props.step.part.state as any)?.input ?? {},
    (props.step.part.state as any)?.metadata ?? {},
    props.directory,
  ))
  const running = createMemo(() => isRunning(props.step.part))
  const input = createMemo(() => {
    const value = (props.step.part.state as any)?.input
    if (value === undefined) return ''
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  })
  const output = createMemo(() => outputText(props.step.part))
  const error = createMemo(() => (props.step.part.state as any)?.error)

  return (
    <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="mafw-process-tool">
      <Collapsible.Trigger>
        <div class="mafw-process-tool-row">
          <Show when={running()} fallback={<span class="mafw-process-tool-title">{info().title}</span>}>
            <TextShimmer text={info().title} class="mafw-process-tool-title" active />
          </Show>
          <Show when={info().subtitle}><span class="mafw-process-tool-sub">{info().subtitle}</span></Show>
          <span classList={{ 'mafw-process-tool-status': true, error: stateOf(props.step.part) === 'error' }}>
            {statusIcon(props.step.part)}
          </span>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="mafw-process-tool-detail">
          <Show when={input()}><pre>{input()}</pre></Show>
          <Show when={error()} fallback={<Show when={output()}><pre>{output()}</pre></Show>}>
            <pre class="error">{String(error())}</pre>
          </Show>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

/** Thinking collapsible: label `思考` matches the tool names; body is opt-in. */
function ThinkingRow(props: { parts: Extract<ProcessStep, { type: 'thinking' }>['parts'] }) {
  const [open, setOpen] = createSignal(false)
  const text = createMemo(() => props.parts.map((part) => part.text ?? '').join('\n\n').trim())
  const preview = createMemo(() => {
    const first = text().split('\n').map((line) => line.trim()).find(Boolean) ?? ''
    return first.length > 96 ? `${first.slice(0, 96)}…` : first
  })
  return (
    <Show when={text()}>
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="mafw-process-think">
        <Collapsible.Trigger>
          <div class="mafw-process-think-row">
            <span class="mafw-process-think-label">思考</span>
            <span class="mafw-process-think-preview">{preview()}</span>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="mafw-process-think-body">
            <Markdown text={text()} cacheKey={props.parts[0]?.id ?? 'thinking'} streaming={false} />
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}

export function ProcessTimeline(props: ProcessTimelineProps) {
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})
  const lastKey = createMemo(() => {
    const segs = props.entries.filter((entry) => entry.type === 'segment')
    return segs.at(-1)?.key
  })
  const isOpen = (key: string) => {
    const override = overrides()[key]
    if (override !== undefined) return override
    return defaultSegmentOpen(Boolean(props.working), key === lastKey())
  }
  const toggle = (key: string, open: boolean) => {
    setOverrides((prev) => ({ ...prev, [key]: open }))
  }
  const fallbackDuration = () =>
    props.entries.filter((entry) => entry.type === 'segment').length === 1
      ? props.fallbackDurationMs
      : undefined

  return (
    <div class="mafw-process-timeline">
      <For each={props.entries}>
        {(entry) => {
          if (entry.type === 'data') return props.renderData(entry.part)

          const summary = createMemo(() => processSummary(entry))
          const thinkingParts = createMemo(() =>
            entry.process.flatMap((step) => (step.type === 'thinking' ? step.parts : [])))
          const toolSteps = createMemo(() =>
            entry.process.filter((step): step is Extract<ProcessStep, { type: 'tool' }> => step.type === 'tool'))
          const hasProcess = entry.process.length > 0
          const active = () => Boolean(props.working) && entry.key === lastKey()
          const title = () => {
            if (active()) return summary().thinking > 0 ? '正在思考' : '正在执行'
            if (summary().thinking > 0) {
              const duration = formatDuration(summary().durationMs ?? fallbackDuration())
              return duration ? `已思考 ${duration}` : '已思考'
            }
            return `已执行 ${summary().tools} 个步骤`
          }
          return (
            <div class="mafw-process-segment">
              <Show when={hasProcess}>
                <Collapsible
                  open={isOpen(entry.key)}
                  onOpenChange={(open) => toggle(entry.key, open)}
                  variant="ghost"
                  class="mafw-process-segment-collapsible"
                >
                  <Collapsible.Trigger>
                    <div class="mafw-process-seg-head">
                      <span classList={{ 'mafw-process-seg-icon': true, active: active() }}>
                        <Show when={active()} fallback={<Icon name="check" size="small" />}>
                          <span class="mafw-process-seg-pulse" aria-hidden="true" />
                        </Show>
                      </span>
                      <Show when={active()} fallback={<span class="mafw-process-seg-title">{title()}</span>}>
                        <TextShimmer text={title()} class="mafw-process-seg-title" active />
                      </Show>
                      <Collapsible.Arrow />
                    </div>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div class="mafw-process-steps">
                      <Show when={thinkingParts().length > 0}>
                        <ThinkingRow parts={thinkingParts()} />
                      </Show>
                      <For each={toolSteps()}>
                        {(step) => (
                          <Show
                            when={CARD_TOOLS.has(step.tool)}
                            fallback={
                              <div class="mafw-process-step">
                                <span class="mafw-process-dot" />
                                <ToolRow step={step} directory={props.directory} />
                              </div>
                            }
                          >
                            <div class="mafw-process-step-card">
                              {props.renderCard(step.part)}
                            </div>
                          </Show>
                        )}
                      </For>
                    </div>
                  </Collapsible.Content>
                </Collapsible>
              </Show>
              <div class="mafw-process-output">
                <For each={entry.output}>
                  {(part) => (
                    props.renderOutput
                      ? props.renderOutput(part)
                      : <Markdown text={part.text} cacheKey={part.id} streaming={active()} />
                  )}
                </For>
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}
