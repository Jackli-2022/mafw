// packages/desktop/src/renderer/mafw/lead-external-inbox.ts
// Pure projection for the Lead external-delivery card. The container fetches
// threads / subscriptions / deliveries; this module decides what the human sees.

export interface LeadExternalSource {
  id: string;
  kind: string;
}

export interface LeadExternalThread {
  id: string;
  sourceId: string;
  title: string;
  externalKey: string;
}

export interface LeadExternalSubscription {
  id: string;
  subscriberType: string;
  subscriberId: string;
}

export interface LeadExternalDelivery {
  id: string;
  subscriptionId: string;
  state: string;
  deliveredAt: string | null;
}

export interface LeadExternalInboxInput {
  threads: LeadExternalThread[];
  sources: LeadExternalSource[];
  subscriptions: Record<string, LeadExternalSubscription[]>;
  deliveries: Record<string, LeadExternalDelivery[]>;
  podId?: string | null;
  limit?: number;
}

export interface LeadExternalDeliveryItem {
  deliveryId: string;
  threadId: string;
  title: string;
  sourceKind: string;
  sourceLabel: string;
  state: 'delivered' | 'read' | 'answered';
  deliveredAt: string | null;
}

const VISIBLE_STATES = new Set(['delivered', 'read']);
const DEFAULT_LIMIT = 5;
const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub',
  webhook: 'Webhook',
  cron: 'Cron',
  internal: 'Internal',
};

export function sourceLabelFor(kind: string): string {
  return SOURCE_LABELS[kind] ?? 'Event';
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildLeadExternalInbox(input: LeadExternalInboxInput): LeadExternalDeliveryItem[] {
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];
  const sourceKind = new Map(input.sources.map((source) => [source.id, source.kind]));
  const items: LeadExternalDeliveryItem[] = [];

  for (const thread of input.threads) {
    const kind = sourceKind.get(thread.sourceId) ?? 'event';
    // Internal decision/goal threads also reach the Lead, but they are not
    // external deliveries and must not appear in this card.
    if (kind === 'internal') continue;
    const subscriptions = (input.subscriptions[thread.id] ?? []).filter((subscription) =>
      subscription.subscriberType === 'lead'
      && (!input.podId || subscription.subscriberId === input.podId));
    if (subscriptions.length === 0) continue;
    const allowed = new Set(subscriptions.map((subscription) => subscription.id));

    for (const delivery of input.deliveries[thread.id] ?? []) {
      if (!allowed.has(delivery.subscriptionId)) continue;
      if (!VISIBLE_STATES.has(delivery.state)) continue;
      items.push({
        deliveryId: delivery.id,
        threadId: thread.id,
        title: thread.title?.trim() || thread.externalKey?.trim() || thread.id,
        sourceKind: kind,
        sourceLabel: sourceLabelFor(kind),
        state: delivery.state as 'delivered' | 'read',
        deliveredAt: delivery.deliveredAt,
      });
    }
  }

  return items
    .sort((a, b) => timestamp(b.deliveredAt) - timestamp(a.deliveredAt))
    .slice(0, limit);
}

export function relativeDeliveryTime(iso: string | null, now: number): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  const diff = Math.max(0, now - parsed);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function formatDeliveryMeta(
  item: { sourceLabel: string; deliveredAt: string | null; state: string },
  now: number,
): string {
  if (item.state === 'answered') return `${item.sourceLabel} · 已回答`;
  const relative = relativeDeliveryTime(item.deliveredAt, now);
  return relative ? `${item.sourceLabel} · ${relative}` : item.sourceLabel;
}
