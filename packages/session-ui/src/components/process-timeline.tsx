import { For, Show, createMemo, createSignal } from 'solid-js'
import { Collapsible } from '@mafw/ui/collapsible'
import { Icon } from '@mafw/ui/icon'
import { TextShimmer } from '@mafw/ui/text-shimmer'
import { Markdown } from './markdown'
import { getToolInfo } from './message-part'
import { formatDuration, processSummary } from './process-timeline-model'
import type { MafwPart } from '@mafw/sdk'
import type { ProcessStep, TurnEntry } from './turn-transcript'
import './process-timeline.css'

export interface ProcessTimelineProps {
  entries: TurnEntry[]
  working?: boolean
  showReasoning?: boolean
  renderCard: (part: any) => any
  renderData: (part: MafwPart) => any
}

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

function ToolRow(props: { step: Extract<ProcessStep, { type: 'tool' }> }) {
  const [open, setOpen] = createSignal(false)
  const info = createMemo(() => getToolInfo(
    props.step.tool,
    (props.step.part.state as any)?.input ?? {},
    (props.step.part.state as any)?.metadata ?? {},
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
          <span class="mafw-process-tool-icon"><Icon name={info().icon} size="small" /></span>
          <Show when={running()} fallback={<span class="mafw-process-tool-title">{info().title}</span>}>
            <TextShimmer text={info().title} class="mafw-process-tool-title" active />
          </Show>
          <Show when={info().subtitle}><span class="mafw-process-tool-sub">{info().subtitle}</span></Show>
          <span classList={{ 'mafw-process-tool-status': true, error: stateOf(props.step.part) === 'error' }}>
            {statusIcon(props.step.part)}
          </span>
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

export function ProcessTimeline(props: ProcessTimelineProps) {
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})
  const lastKey = createMemo(() => {
    const segs = props.entries.filter((entry) => entry.type === 'segment')
    return segs.at(-1)?.key
  })
  const isOpen = (key: string) => {
    const override = overrides()[key]
    if (override !== undefined) return override
    return Boolean(props.working) && key === lastKey()
  }
  const toggle = (key: string, open: boolean) => {
    setOverrides((prev) => ({ ...prev, [key]: open }))
  }

  return (
    <div class="mafw-process-timeline">
      <For each={props.entries}>
        {(entry) => {
          if (entry.type === 'card') return props.renderCard(entry.part)
          if (entry.type === 'data') return props.renderData(entry.part)

          const summary = createMemo(() => processSummary(entry))
          const hasProcess = entry.process.length > 0
          const active = () => Boolean(props.working) && entry.key === lastKey()
          const title = () => {
            if (active()) return summary().thinking > 0 ? '正在思考' : '正在执行'
            if (summary().thinking > 0) {
              const duration = formatDuration(summary().durationMs)
              return duration ? `已思考（用时 ${duration}）` : '已思考'
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
                        {active() ? '✦' : '✓'}
                      </span>
                      <Show when={active()} fallback={<span class="mafw-process-seg-title">{title()}</span>}>
                        <TextShimmer text={title()} class="mafw-process-seg-title" active />
                      </Show>
                      <Show when={summary().tools > 0}>
                        <span class="mafw-process-seg-meta">· 工具 {summary().tools} 次</span>
                      </Show>
                      <Collapsible.Arrow />
                    </div>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div class="mafw-process-steps">
                      <For each={entry.process}>
                        {(step) => (
                          <div class="mafw-process-step">
                            <span classList={{ 'mafw-process-dot': true, thinking: step.type === 'thinking' }} />
                            <Show
                              when={step.type === 'thinking'}
                              fallback={<ToolRow step={step as Extract<ProcessStep, { type: 'tool' }>} />}
                            >
                              <div class="mafw-process-thinking">
                                <Markdown
                                  text={step.type === 'thinking' ? step.parts.map((part) => part.text).join('') : ''}
                                  cacheKey={step.key}
                                  streaming={active()}
                                />
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Collapsible.Content>
                </Collapsible>
              </Show>
              <div class="mafw-process-output">
                <For each={entry.output}>
                  {(part) => (
                    <Markdown text={part.text} cacheKey={part.id} streaming={active()} />
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
