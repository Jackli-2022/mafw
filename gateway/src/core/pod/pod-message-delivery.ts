import { PodStore, type PodMessageRow, type PodSessionRow } from './pod-store';

export type DeliveryDecision = 'push' | 'pull' | 'pending';

export interface PodMessageDeliveryDeps {
  store: PodStore;
  getSession(sessionId: string): Promise<{ directory?: string } | null>;
  promptAsync(input: { sessionID: string; message: string; delivery?: 'queue' }): Promise<void>;
  now?(): string;
  log?(message: string): void;
}

function activeSessionForMember(store: PodStore, podId: string, memberId: string): PodSessionRow | null {
  return [...store.listSessions(podId)]
    .filter((session) => session.memberId === memberId && !session.endedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export class PodMessageDelivery {
  constructor(private readonly deps: PodMessageDeliveryDeps) {}

  decide(messageId: string): DeliveryDecision {
    const message = this.findMessage(messageId);
    if (!message || !message.toMemberId) return 'pending';
    const session = activeSessionForMember(this.deps.store, message.podId, message.toMemberId);
    if (!session) return 'pending';
    return session.node === 'coordination' ? 'push' : 'pull';
  }

  async deliver(messageId: string): Promise<'delivered' | 'pending' | 'skipped'> {
    const message = this.findMessage(messageId);
    if (!message) return 'skipped';
    if (message.deliveredAt) return 'skipped';
    const decision = this.decide(messageId);
    if (decision !== 'push') return 'pending';

    const session = activeSessionForMember(this.deps.store, message.podId, message.toMemberId!);
    if (!session) return 'pending';
    try {
      await this.deps.promptAsync({
        sessionID: session.sessionId,
        message: this.render(message),
        delivery: 'queue',
      });
      this.deps.store.markMessageDelivered(message.id, session.sessionId, this.now());
      return 'delivered';
    } catch (err: any) {
      this.deps.log?.(`[PodDelivery] push failed for ${message.id}: ${err?.message ?? err}`);
      return 'pending';
    }
  }

  async pendingForSession(sessionId: string): Promise<string | null> {
    const member = this.deps.store.getMemberBySession(sessionId);
    if (!member) return null;
    const messages = this.deps.store
      .listMessages(member.podId, 1000)
      .filter((message) => message.toMemberId === member.id && !message.deliveredAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (messages.length === 0) return null;
    const now = this.now();
    for (const message of messages) {
      this.deps.store.markMessageDelivered(message.id, sessionId, now);
    }
    return messages.map((message) => this.render(message)).join('\n\n');
  }

  render(message: PodMessageRow): string {
    const lines = ['[POD HANDOFF]'];
    lines.push(`from: ${message.fromMemberId}${message.toMemberId ? ` → ${message.toMemberId}` : ''}`);
    lines.push(`kind: ${message.kind}`);
    lines.push(`body: ${message.body}`);
    lines.push(`message: ${message.id}`);
    return lines.join('\n');
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private findMessage(messageId: string): PodMessageRow | null {
    for (const pod of this.deps.store.listPods()) {
      const found = this.deps.store.listMessages(pod.id, 1000).find((message) => message.id === messageId);
      if (found) return found;
    }
    return null;
  }
}
