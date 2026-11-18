import { Show, createEffect, createSignal } from 'solid-js';
import {
  buildLeadExternalInbox,
  type LeadExternalDeliveryItem,
  type LeadExternalDelivery as LeadExternalDeliveryRow,
  type LeadExternalSubscription as LeadExternalSubscriptionRow,
  type LeadExternalThread as LeadExternalThreadRow,
} from '../lead-external-inbox';
import { LeadExternalDeliveryCard } from './LeadExternalDeliveryCard';

/**
 * Lead-session container: loads external deliveries for the current project,
 * keeps only the Lead's own subscriptions, and exposes read/answered receipts.
 * Human-only routes are reached through the desktop main client (human token).
 */
export function LeadExternalInbox(props: {
  projectDir?: string;
  podId?: string | null;
}) {
  const [items, setItems] = createSignal<LeadExternalDeliveryItem[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  let loadSeq = 0;

  const load = async (projectDir: string, podId: string | null | undefined): Promise<void> => {
    const ticket = ++loadSeq;
    setBusy(true);
    setError('');
    try {
      const [sourceResult, threadResult] = await Promise.all([
        window.api.mafw.events.sources({ projectDir }),
        window.api.mafw.events.threads({ projectDir }),
      ]);
      const recent = threadResult.items
        .filter((thread) => thread.state === 'open')
        .sort((a, b) => (b.lastTriggerAt ?? '').localeCompare(a.lastTriggerAt ?? ''))
        .slice(0, 10);

      const pairs = await Promise.all(recent.map(async (thread) => {
        const [subscriptions, deliveries] = await Promise.all([
          window.api.mafw.events.subscriptions(thread.id),
          window.api.mafw.events.deliveries(thread.id),
        ]);
        return [thread.id, { subscriptions: subscriptions.items, deliveries: deliveries.items }] as const;
      }));
      if (ticket !== loadSeq) return;

      const subscriptions: Record<string, LeadExternalSubscriptionRow[]> = {};
      const deliveries: Record<string, LeadExternalDeliveryRow[]> = {};
      for (const [threadId, pair] of pairs) {
        subscriptions[threadId] = pair.subscriptions;
        deliveries[threadId] = pair.deliveries;
      }
      setItems(buildLeadExternalInbox({
        threads: recent as LeadExternalThreadRow[],
        sources: sourceResult.items,
        subscriptions,
        deliveries,
        podId,
      }));
      setNow(Date.now());
    } catch (err: any) {
      if (ticket === loadSeq) setError(String(err?.message ?? err));
    } finally {
      if (ticket === loadSeq) setBusy(false);
    }
  };

  createEffect(() => {
    const dir = props.projectDir;
    const podId = props.podId;
    if (!dir) {
      setItems([]);
      return;
    }
    void load(dir, podId);
  });

  const read = async (deliveryId: string): Promise<void> => {
    setBusy(true);
    try {
      await window.api.mafw.events.readDelivery(deliveryId);
      setItems((prev) => prev.map((item) =>
        item.deliveryId === deliveryId ? { ...item, state: 'read' } : item));
    } catch (err: any) {
      setError(String(err?.message ?? err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const answer = async (deliveryId: string): Promise<void> => {
    setBusy(true);
    try {
      const current = items().find((item) => item.deliveryId === deliveryId);
      if (current?.state === 'delivered') {
        // Answer requires a read first; cover the race where the expand-time
        // read is still in flight or previously failed.
        try {
          await window.api.mafw.events.readDelivery(deliveryId);
          setItems((prev) => prev.map((item) =>
            item.deliveryId === deliveryId ? { ...item, state: 'read' } : item));
        } catch {
          // answerDelivery below returns the authoritative 409 / 404.
        }
      }
      await window.api.mafw.events.answerDelivery(deliveryId);
      setItems((prev) => prev.map((item) =>
        item.deliveryId === deliveryId ? { ...item, state: 'answered' } : item));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Show when={error()}>
        <div class="mafw-queue-bar mafw-lead-external-error">
          <span class="mafw-card-meta">{error()}</span>
        </div>
      </Show>
      <Show when={items().length > 0}>
        <LeadExternalDeliveryCard
          items={items()}
          busy={busy()}
          now={now()}
          onRead={read}
          onAnswer={answer}
        />
      </Show>
    </>
  );
}
