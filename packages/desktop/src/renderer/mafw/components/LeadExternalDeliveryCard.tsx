import { For, Show, createEffect, createSignal } from 'solid-js';
import { ButtonV2 } from '@mafw/ui/v2/button-v2';
import type { LeadExternalDeliveryItem } from '../lead-external-inbox';
import { formatDeliveryMeta } from '../lead-external-inbox';

function sourceBadge(kind: string): string {
  if (kind === 'github') return 'GH';
  if (kind === 'webhook') return 'WH';
  if (kind === 'cron') return 'CR';
  return 'EV';
}

/**
 * Presentational Lead inbox card. The container owns fetching and the human
 * receipt calls; this component only tracks expand/collapse and which visible
 * deliveries have already been marked read.
 */
export function LeadExternalDeliveryCard(props: {
  items: LeadExternalDeliveryItem[];
  busy: boolean;
  now: number;
  onRead: (deliveryId: string) => Promise<void>;
  onAnswer: (deliveryId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const requested = new Set<string>();

  const allAnswered = () => props.items.length > 0
    && props.items.every((item) => item.state === 'answered');
  const sourceSummary = () => [...new Set(props.items.map((item) => item.sourceLabel))].join(' · ');

  const expand = () => {
    setExpanded(true);
  };

  // `read` means the human opened the card. New deliveries that arrive while
  // it is open are read too; the Set prevents duplicate receipt writes.
  createEffect(() => {
    if (!expanded()) return;
    for (const item of props.items) {
      if (item.state !== 'delivered' || requested.has(item.deliveryId)) continue;
      requested.add(item.deliveryId);
      void props.onRead(item.deliveryId).catch(() => {
        requested.delete(item.deliveryId);
      });
    }
  });

  return (
    <div class="mafw-queue-bar mafw-lead-external-inbox">
      <Show
        when={expanded()}
        fallback={(
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-lead-external-toggle"
            onClick={expand}
          >
            <span classList={{ 'mafw-lead-external-dot': true, 'is-done': allAnswered() }} />
            <span class="mafw-run-count">
              {allAnswered() ? '外部事件已全部处理' : `${props.items.length} 条待处理外部事件`}
            </span>
            <Show when={sourceSummary()}>
              <span class="mafw-card-meta">{sourceSummary()}</span>
            </Show>
            <span class="mafw-card-meta mafw-lead-external-chev">展开</span>
          </ButtonV2>
        )}
      >
        <div classList={{ 'mafw-lead-external-head': true, done: allAnswered() }}>
          <span classList={{ 'mafw-lead-external-dot': true, 'is-done': allAnswered() }} />
          <span class="mafw-run-count">
            {allAnswered() ? '外部事件 · 已全部处理' : `外部事件 · ${props.items.length} 条待处理`}
          </span>
          <span class="mafw-card-meta">
            {allAnswered() ? `${props.items.length} / ${props.items.length} 已回答` : '展开后自动已读'}
          </span>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-lead-external-collapse"
            onClick={() => setExpanded(false)}
          >
            收起
          </ButtonV2>
        </div>
        <div class="mafw-lead-external-list">
          <For each={props.items}>
            {(item) => (
              <div classList={{ 'mafw-lead-external-row': true, done: item.state === 'answered' }}>
                <span class="mafw-lead-external-badge" aria-hidden="true">{sourceBadge(item.sourceKind)}</span>
                <div class="mafw-lead-external-main">
                  <span class="mafw-lead-external-title">{item.title}</span>
                  <span class="mafw-lead-external-meta">{formatDeliveryMeta(item, props.now)}</span>
                </div>
                <Show
                  when={item.state !== 'answered'}
                  fallback={<span class="mafw-card-meta mafw-lead-external-done">✓ 已回答</span>}
                >
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={props.busy}
                    onClick={() => void props.onAnswer(item.deliveryId)}
                  >
                    已回答
                  </ButtonV2>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
