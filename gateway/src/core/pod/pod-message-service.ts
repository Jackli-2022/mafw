import { PodError, PodStore, type PodMessageRow } from './pod-store';

export type PodMessageKind = 'note' | 'request' | 'review' | 'decision' | 'escalation';

export interface PodMessageServiceDeps {
  store: PodStore;
  now(): string;
  newId(): string;
  notify(podId: string): void;
}

export class PodMessageService {
  constructor(private readonly deps: PodMessageServiceDeps) {}

  send(input: {
    podId: string;
    fromMemberId: string;
    toMemberId?: string | null;
    kind: PodMessageKind;
    body: string;
  }): PodMessageRow {
    const body = input.body?.trim();
    if (!body) throw new PodError(400, 'message body is required');
    const members = this.deps.store.listMembers(input.podId);
    if (!members.some((member) => member.id === input.fromMemberId)) {
      throw new PodError(400, `unknown sender: ${input.fromMemberId}`);
    }
    if (input.toMemberId && !members.some((member) => member.id === input.toMemberId)) {
      throw new PodError(400, `unknown recipient: ${input.toMemberId}`);
    }
    const message = this.deps.store.insertMessage({
      id: this.deps.newId(),
      podId: input.podId,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId ?? null,
      kind: input.kind,
      body,
      now: this.deps.now(),
    });
    this.deps.notify(input.podId);
    return message;
  }

  list(podId: string, limit?: number): PodMessageRow[] {
    return this.deps.store.listMessages(podId, limit);
  }

  markRead(messageId: string): boolean {
    const message = this.deps.store.getMessage(messageId);
    if (!message) return false;
    this.deps.store.markMessageRead(messageId, this.deps.now());
    this.deps.notify(message.podId);
    return true;
  }
}
