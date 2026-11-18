import { For, Show } from 'solid-js'
import { ButtonV2 } from '@mafw/ui/v2/button-v2'
import { Icon } from '@mafw/ui/icon'
import { HoverCard } from '@mafw/ui/hover-card'
import type { MemoryReceiptView } from '../memory-receipt'

/**
 * Lead memory receipt: a 28px capsule under the answer, with a 300ms hover
 * card. The view is already projected (no ids / energy / type enums shown);
 * this component only lays it out.
 */
export function MemoryReceipt(props: {
  view: MemoryReceiptView
  onOpenMemory: () => void
}) {
  return (
    <HoverCard
      openDelay={300}
      closeDelay={100}
      placement="top-start"
      trigger={
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-memory-receipt-pill"
          aria-label={`${props.view.pill}${props.view.sub ? `，${props.view.sub}` : ''}`}
        >
          <span class="mafw-memory-receipt-icon" aria-hidden="true">
            <Icon name="brain" size="small" />
          </span>
          <span class="mafw-memory-receipt-label">{props.view.pill}</span>
          <Show when={props.view.sub}>
            <span class="mafw-memory-receipt-div" aria-hidden="true" />
            <span class="mafw-memory-receipt-sub">{props.view.sub}</span>
          </Show>
        </ButtonV2>
      }
    >
      <div class="mafw-memory-receipt-card">
        <div class="mafw-memory-receipt-head">
          <span>这轮回忆</span>
          <span class="mafw-memory-receipt-count">{props.view.memories.length} 条</span>
        </div>

        <Show when={props.view.statusCopy}>
          <div class="mafw-memory-receipt-status">{props.view.statusCopy}</div>
        </Show>

        <Show when={props.view.memories.length > 0}>
          <div class="mafw-memory-receipt-sec">记忆</div>
          <For each={props.view.memories}>
            {(item) => (
              <div classList={{ 'mafw-memory-receipt-row': true, neighbor: item.neighbor }}>
                <span class="mafw-memory-receipt-tag">{item.label}</span>
                <div class="mafw-memory-receipt-main">
                  <div class="mafw-memory-receipt-text">{item.text}</div>
                  <Show when={item.meta}><div class="mafw-memory-receipt-meta">{item.meta}</div></Show>
                </div>
              </div>
            )}
          </For>
        </Show>

        <Show when={props.view.t1.length > 0}>
          <div class="mafw-memory-receipt-sec">摘要</div>
          <For each={props.view.t1}>
            {(item) => (
              <div class="mafw-memory-receipt-quote">
                <span class="mafw-memory-receipt-qmark" aria-hidden="true">“</span>
                <div class="mafw-memory-receipt-main">
                  <div class="mafw-memory-receipt-text">{item.excerpt}</div>
                  <div class="mafw-memory-receipt-meta">{item.meta}</div>
                </div>
              </div>
            )}
          </For>
        </Show>

        <Show when={props.view.filteredLine}>
          <div class="mafw-memory-receipt-filtered">{props.view.filteredLine}</div>
        </Show>

        <div class="mafw-memory-receipt-foot">
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenMemory()}>
            打开记忆页 →
          </ButtonV2>
          <span class="mafw-memory-receipt-fix">记错了？</span>
        </div>
      </div>
    </HoverCard>
  )
}
