import { For, Show, createSignal } from 'solid-js'
import { ButtonV2 } from '@mafw/ui/v2/button-v2'
import { Icon } from '@mafw/ui/icon'
import { PopoverShell } from './pickers/PopoverShell'
import type { MemoryReceiptView } from '../memory-receipt'

/**
 * Lead memory receipt: a quiet line under the turn, with a click-to-open
 * floating peek. The trigger is deliberately not a capsule — it reads as the
 * turn's closing line, and the panel never reflows the turn.
 */
export function MemoryReceipt(props: {
  view: MemoryReceiptView
  onOpenMemory: () => void
}) {
  const [open, setOpen] = createSignal(false)
  const [showNeighbors, setShowNeighbors] = createSignal(false)
  const [triggerEl, setTriggerEl] = createSignal<HTMLElement | null>(null)
  const headMeta = () => [props.view.statusCopy, props.view.latestLabel].filter(Boolean).join(' · ')

  return (
    <>
      <span ref={setTriggerEl} class="mafw-memory-receipt-anchor">
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-memory-receipt-trigger"
          aria-label={props.view.pill}
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <span class="mafw-memory-receipt-glyph" aria-hidden="true">
            <Icon name="brain" size="small" />
          </span>
          <span class="mafw-memory-receipt-label">{props.view.pill}</span>
          <span
            class="mafw-memory-receipt-chev"
            classList={{ open: open() }}
            aria-hidden="true"
          >
            ›
          </span>
        </ButtonV2>
      </span>

      <PopoverShell
        open={open()}
        trigger={triggerEl()}
        anchor="below-start"
        width={320}
        onClose={() => setOpen(false)}
        class="mafw-memory-receipt-pop"
      >
        <div class="mafw-memory-receipt-card">
          <div class="mafw-memory-receipt-head">
            <span>{props.view.header}</span>
            <Show when={headMeta()}>
              <span class="mafw-memory-receipt-head-time">{headMeta()}</span>
            </Show>
          </div>

          <For each={props.view.primary}>
            {(item) => (
              <div class="mafw-memory-receipt-row">
                <div class="mafw-memory-receipt-title">{item.title}</div>
                <Show when={item.body}>
                  <div class="mafw-memory-receipt-body">{item.body}</div>
                </Show>
                <Show when={item.meta}>
                  <div class="mafw-memory-receipt-meta">{item.meta}</div>
                </Show>
              </div>
            )}
          </For>

          <Show when={props.view.t1.length > 0}>
            <div class="mafw-memory-receipt-t1">
              <div class="mafw-memory-receipt-t1-label">原话</div>
              <For each={props.view.t1}>
                {(item) => (
                  <div class="mafw-memory-receipt-quote">
                    <div class="mafw-memory-receipt-quote-text">{item.excerpt}</div>
                    <Show when={item.meta}>
                      <div class="mafw-memory-receipt-meta">{item.meta}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={props.view.neighbors.length > 0}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-memory-receipt-neighbors"
              aria-expanded={showNeighbors()}
              onClick={() => setShowNeighbors((value) => !value)}
            >
              <span>{props.view.neighborLabel}</span>
              <span
                class="mafw-memory-receipt-neighbors-chev"
                classList={{ open: showNeighbors() }}
                aria-hidden="true"
              >
                ▾
              </span>
            </ButtonV2>
            <Show when={showNeighbors()}>
              <For each={props.view.neighbors}>
                {(item) => (
                  <div class="mafw-memory-receipt-row is-neighbor">
                    <div class="mafw-memory-receipt-title">{item.title}</div>
                    <Show when={item.body}>
                      <div class="mafw-memory-receipt-body">{item.body}</div>
                    </Show>
                    <Show when={item.meta}>
                      <div class="mafw-memory-receipt-meta">{item.meta}</div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          <div class="mafw-memory-receipt-foot">
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-memory-receipt-open"
              onClick={(event: MouseEvent) => {
                event.stopPropagation()
                setOpen(false)
                props.onOpenMemory()
              }}
            >
              翻记忆 →
            </ButtonV2>
          </div>
        </div>
      </PopoverShell>
    </>
  )
}
