import { PodStore, type PodMessageRow, type PodSessionRow } from './pod-store';

export type DeliveryDecision = 'push' | 'pull' | 'pending';

export interface PodMessageDeliveryDeps {
  store: PodStore;
  promptAsync(input: { sessionID: string; message: string; delivery?: 'queue' }): Promise<void>;
  /** Broadcast a pod change after a message becomes delivered (badge/待投递 refresh). */
  notify?(podId: string): void;
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

  private memberBlockedForPush(podId: string, memberId: string): boolean {
    const member = this.deps.store.listMembers(podId).find((item) => item.id === memberId);
    return member?.status === 'sleeping' || member?.status === 'retired';
  }

  async deliver(messageId: string, _opts: { force?: boolean } = {}): Promise<'delivered' | 'pending' | 'skipped'> {
    const message = this.findMessage(messageId);
    if (!message) return 'skipped';
    if (!message.toMemberId) return 'skipped';
    if (this.deps.store.hasDelivery(message.id, message.toMemberId)) return 'skipped';
    if (this.memberBlockedForPush(message.podId, message.toMemberId)) return 'pending';
    // `force` is retained for API compatibility, but it never converts a
    // pull-by-design node handoff into an immediate push.
    if (this.decide(messageId) !== 'push') return 'pending';

    const session = activeSessionForMember(this.deps.store, message.podId, message.toMemberId);
    if (!session) return 'pending';
    try {
      await this.deps.promptAsync({
        sessionID: session.sessionId,
        message: this.render(message),
        delivery: 'queue',
      });
      this.deps.store.markDeliveryDelivered(message.id, message.toMemberId, session.sessionId, this.now());
      this.deps.store.markMessageDelivered(message.id, session.sessionId, this.now());
      this.deps.notify?.(message.podId);
      return 'delivered';
    } catch (err: any) {
      this.deps.store.markDeliveryFailed(message.id, message.toMemberId, String(err?.message ?? err), this.now());
      this.deps.log?.(`[PodDelivery] push failed for ${message.id}: ${err?.message ?? err}`);
      return 'pending';
    }
  }

  async pendingForSession(sessionId: string): Promise<string | null> {
    return this.pendingForSessionSync(sessionId);
  }

  claimPendingForSession(sessionId: string): { block: string; ids: string[] } | null {
    const member = this.deps.store.getMemberBySession(sessionId);
    if (!member) return null;
    const messages = this.deps.store.listPendingMessages(member.podId, member.id);
    if (messages.length === 0) return null;
    return {
      block: messages.map((message) => this.render(message)).join('\n\n'),
      ids: messages.map((message) => message.id),
    };
  }

  commitDelivered(ids: string[], sessionId: string): void {
    const member = this.deps.store.getMemberBySession(sessionId);
    if (!member) return;
    const now = this.now();
    let podId: string | null = null;
    for (const id of ids) {
      const message = this.deps.store.getMessage(id);
      if (!message) continue;
      this.deps.store.markDeliveryDelivered(id, member.id, sessionId, now);
      // Preserve the legacy direct-message display for one recipient only.
      if (message.toMemberId) this.deps.store.markMessageDelivered(id, sessionId, now);
      podId = message.podId;
    }
    if (podId) this.deps.notify?.(podId);
  }

  pendingForSessionSync(sessionId: string): string | null {
    const claim = this.claimPendingForSession(sessionId);
    if (!claim) return null;
    this.commitDelivered(claim.ids, sessionId);
    return claim.block;
  }

  listFailures(podId: string) {
    return this.deps.store.listDeliveryFailures(podId);
  }

  retryFailure(messageId: string): Promise<'delivered' | 'pending' | 'skipped'> {
    return this.deliver(messageId);
  }

  dismissFailure(messageId: string, memberId: string): boolean {
    return this.deps.store.dismissDeliveryFailure(messageId, memberId);
  }

  render(message: PodMessageRow): string {
    let data: any = {};
    try {
      const parts = message.partsJson ? JSON.parse(message.partsJson) : [];
      for (const part of Array.isArray(parts) ? parts : []) {
        if (part?.data && typeof part.data === 'object') data = part.data;
      }
    } catch { /* ignore malformed parts */ }
    const lines = ['[POD HANDOFF]'];
    lines.push(`goal: ${data.goalId ?? '-'} / task: ${data.taskId ?? data.podTaskId ?? '-'}`);
    lines.push(`from: ${message.fromMemberId}${message.toMemberId ? ` → ${message.toMemberId}` : ''}`);
    lines.push(`kind: ${message.kind}`);
    if (data.title) lines.push(`title: ${data.title}`);
    if (data.expectedOutput) lines.push(`expected: ${data.expectedOutput}`);
    if (Array.isArray(data.contextRefs) && data.contextRefs.length) lines.push(`context: ${data.contextRefs.join(', ')}`);
    if (Array.isArray(data.acceptance) && data.acceptance.length) {
      lines.push('acceptance:');
      for (const item of data.acceptance) lines.push(`- ${item}`);
    }
    lines.push(`body: ${message.body}`);
    lines.push(`message: ${message.id}`);
    return lines.join('\n');
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private findMessage(messageId: string): PodMessageRow | null {
    return this.deps.store.getMessage(messageId);
  }
}
