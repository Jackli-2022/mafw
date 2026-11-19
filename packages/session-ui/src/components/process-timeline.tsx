import { For, Show, createMemo, createSignal } from 'solid-js'
import { Collapsible } from '@mafw/ui/collapsible'
import { Icon } from '@mafw/ui/icon'
import { TextShimmer } from '@mafw/ui/text-shimmer'
import { Markdown } from './markdown'
import { formatDuration, processSummary, defaultSegmentOpen, segmentFallbackDuration } from './process-timeline-model'
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
            <Show when={!open()}>
              <span class="mafw-process-think-preview">{preview()}</span>
            </Show>
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
  const fallbackDuration = (key: string) => segmentFallbackDuration(key === lastKey(), props.fallbackDurationMs)

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
              const duration = formatDuration(summary().durationMs ?? fallbackDuration(entry.key))
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
                          <div class="mafw-process-step-card">
                            {props.renderCard(step.part)}
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
