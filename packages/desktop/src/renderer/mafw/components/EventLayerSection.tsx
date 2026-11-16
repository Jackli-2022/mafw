import { For, Show, createSignal, onMount } from 'solid-js';
import { ButtonV2 } from '@mafw/ui/v2/button-v2';
import type {
  EventDeliveryView,
  EventSourceView,
  EventThreadView,
} from '@mafw/sdk';

/**
 * Developer-only event layer diagnostics. Read-only except source enable/disable;
 * never renders session ids or raw tokens.
 */
export function EventLayerSection(props: { projectDir?: string }) {
  const [sources, setSources] = createSignal<EventSourceView[]>([]);
  const [threads, setThreads] = createSignal<EventThreadView[]>([]);
  const [deliveries, setDeliveries] = createSignal<EventDeliveryView[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const load = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const sourceResult = await window.api.mafw.events.sources({ projectDir: props.projectDir });
      setSources(sourceResult.items);
      const threadResult = await window.api.mafw.events.threads({ projectDir: props.projectDir });
      setThreads(threadResult.items);
      const deliveryItems: EventDeliveryView[] = [];
      for (const thread of threadResult.items.slice(0, 5)) {
        const response = await window.api.mafw.events.deliveries(thread.id);
        deliveryItems.push(...response.items);
      }
      setDeliveries(deliveryItems);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    }
    setBusy(false);
  };

  const toggleSource = async (source: EventSourceView): Promise<void> => {
    try {
      await window.api.mafw.events.setSourceEnabled(source.id, !source.enabled);
      await load();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    }
  };

  onMount(() => { void load(); });

  return (
    <div class="mafw-config-section" aria-label="事件层诊断">
      <div class="mafw-config-section-header">
        <span class="mafw-config-section-title">事件层（开发者）</span>
        <ButtonV2 variant="ghost" size="small" onClick={() => void load()} disabled={busy()}>
          刷新
        </ButtonV2>
      </div>
      <div class="mafw-config-section-body">
        <Show when={error()}>
          <div class="mafw-config-hint">{error()}</div>
        </Show>
        <div class="mafw-config-section-desc">
          来源 {sources().length} · 线程 {threads().length} · 投递 {deliveries().length}
        </div>
        <Show when={sources().length > 0} fallback={<div class="mafw-config-hint">当前项目没有外部事件来源（internal / cron 为系统来源，不在此列表）。</div>}>
          <For each={sources()}>
            {(source) => (
              <div class="mafw-config-grid-row">
                <span class="mafw-config-grid-label">{source.kind}</span>
                <strong>{source.name}</strong>
                <span class="mafw-config-hint">{source.enabled ? '启用' : '停用'}</span>
                <ButtonV2 variant="ghost" size="small" onClick={() => void toggleSource(source)}>
                  {source.enabled ? '停用' : '启用'}
                </ButtonV2>
              </div>
            )}
          </For>
        </Show>
        <Show when={threads().length > 0}>
          <div class="mafw-config-section-desc">最近线程</div>
          <For each={threads().slice(0, 5)}>
            {(thread) => (
              <div class="mafw-config-grid-row">
                <code>{thread.externalKey}</code>
                <span>{thread.title}</span>
                <span class="mafw-config-hint">{thread.state}</span>
              </div>
            )}
          </For>
        </Show>
        <Show when={deliveries().length > 0}>
          <div class="mafw-config-section-desc">最近投递</div>
          <For each={deliveries().slice(0, 10)}>
            {(delivery) => (
              <div class="mafw-config-grid-row">
                <code>{delivery.state}</code>
                <span class="mafw-config-hint">attempts {delivery.attempts}</span>
                <Show when={delivery.lastError}>
                  <span class="mafw-config-hint">{delivery.lastError}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
