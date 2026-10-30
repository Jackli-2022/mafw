import type { Message, Task } from '@a2a-js/sdk';
import { TaskState } from '@a2a-js/sdk';
import { PodError, type PodStore } from './pod-store';
import { redactSecrets } from '../../recall/redact';
import type { PodAccess } from './pod-access';
import type { PodMessageService } from './pod-message-service';
import type { PodTaskService } from './pod-task-service';
import {
  buildA2AMessage,
  buildA2ATask,
  parseHandoffMessage,
} from './pod-a2a-mapping';

export interface PodA2ABridgeDeps {
  store: PodStore;
  tasks: PodTaskService;
  messages: PodMessageService;
  access?: PodAccess;
  delivery?: { deliver(messageId: string): Promise<string> };
  now(): string;
  newId(): string;
  notify?(podId: string): void;
  log?(message: string): void;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

export class PodA2ABridge {
  constructor(private readonly deps: PodA2ABridgeDeps) {}

  async sendMessage(
    podId: string,
    message: Message,
    opts: { actorSessionID?: string } = {},
  ): Promise<Task | Message> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);

    const parsed = parseHandoffMessage(message);
    const body = redactSecrets(parsed.body);
    const partsJson = redactSecrets(JSON.stringify(message.parts ?? []));
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const metadataPodId = typeof metadata.podId === 'string' ? metadata.podId : null;
    if (metadataPodId && metadataPodId !== podId) {
      throw new PodError(403, 'message targets another pod');
    }

    const members = this.deps.store.listMembers(podId);
    let fromMemberId = parsed.fromMemberId;
    if (opts.actorSessionID) {
      const actor = this.deps.access?.requireMember(
        opts.actorSessionID,
        ['lead', 'builder', 'reviewer'],
        podId,
      );
      if (actor) {
        if (fromMemberId && fromMemberId !== actor.id) {
          throw new PodError(403, 'fromMemberId does not match authenticated actor');
        }
        fromMemberId = actor.id;
      }
    }
    if (!fromMemberId || !members.some((member) => member.id === fromMemberId)) {
      throw new PodError(400, 'unknown sender');
    }
    if (parsed.toMemberId && !members.some((member) => member.id === parsed.toMemberId)) {
      throw new PodError(400, 'unknown recipient');
    }
    if (parsed.kind === 'request' && !parsed.toMemberId) {
      throw new PodError(400, 'request requires toMemberId');
    }

    const existing = this.deps.store
      .listMessages(podId, 1000)
      .find((item) => item.externalMessageId === parsed.messageId);
    if (existing) {
      const taskId = parsed.podTaskId
        ?? (parsed.kind === 'request' ? `podtask_${safeId(parsed.messageId)}` : null)
        ?? this.deps.store.getA2ALocalId(podId, 'message', parsed.messageId)
        ?? null;
      const task = taskId ? this.deps.store.getTask(taskId) : null;
      if (task) return buildA2ATask({ task });
      return buildA2AMessage({
        messageId: parsed.messageId,
        contextId: parsed.contextId ?? `pod:${podId}`,
        text: existing.body,
        metadata: { podId, idempotent: true },
      });
    }

    if (parsed.kind !== 'request') {
      const saved = this.deps.store.insertMessage({
        id: this.deps.newId(),
        podId,
        fromMemberId,
        toMemberId: parsed.toMemberId,
        kind: parsed.kind,
        body: body || parsed.title || parsed.kind,
        protocol: 'a2a',
        externalMessageId: parsed.messageId,
        partsJson: partsJson,
        now: this.deps.now(),
      });
      this.deps.store.linkA2A({
        id: this.deps.newId(),
        podId,
        localKind: 'message',
        localId: saved.id,
        a2aId: parsed.messageId,
        contextId: parsed.contextId,
        now: this.deps.now(),
      });
      if (this.deps.delivery && parsed.toMemberId) {
        try {
          await this.deps.delivery.deliver(saved.id);
        } catch (err: any) {
          this.deps.log?.(`[PodA2A] delivery failed for ${saved.id}: ${err?.message ?? err}`);
        }
      }
      this.deps.notify?.(podId);
      return buildA2AMessage({
        messageId: this.deps.newId(),
        contextId: parsed.contextId ?? `pod:${podId}`,
        text: 'accepted',
        metadata: { podId, messageId: saved.id },
      });
    }

    const taskId = parsed.podTaskId || `podtask_${safeId(parsed.messageId)}`;
    let task = this.deps.store.getTask(taskId);
    if (task && task.podId !== podId) {
      throw new PodError(403, 'task belongs to another pod');
    }
    if (!task) {
      task = this.deps.store.upsertTask({
        id: taskId,
        podId,
        goalId: parsed.goalId,
        sourceKey: `a2a:${parsed.messageId}`,
        externalTaskId: null,
        title: parsed.title || parsed.body.slice(0, 80) || 'A2A task',
        description: parsed.expectedOutput,
        ownerMemberId: parsed.toMemberId,
        status: 'pending',
        dependenciesJson: null,
        artifactRefsJson: parsed.artifactRefs.length ? JSON.stringify(parsed.artifactRefs) : null,
        now: this.deps.now(),
      });
    }

    const saved = this.deps.store.insertMessage({
      id: this.deps.newId(),
      podId,
      fromMemberId,
      toMemberId: parsed.toMemberId,
      kind: 'request',
      body: body || parsed.title || 'A2A task',
      protocol: 'a2a',
      externalMessageId: parsed.messageId,
      partsJson: partsJson,
      now: this.deps.now(),
    });
    this.deps.store.linkA2A({
      id: this.deps.newId(),
      podId,
      localKind: 'task',
      localId: task.id,
      a2aId: task.id,
      contextId: parsed.contextId,
      now: this.deps.now(),
    });
    this.deps.store.linkA2A({
      id: this.deps.newId(),
      podId,
      localKind: 'message',
      localId: saved.id,
      a2aId: parsed.messageId,
      contextId: parsed.contextId,
      now: this.deps.now(),
    });

    if (this.deps.delivery) {
      try {
        await this.deps.delivery.deliver(saved.id);
      } catch (err: any) {
        this.deps.log?.(`[PodA2A] delivery failed for ${saved.id}: ${err?.message ?? err}`);
      }
    }
    this.deps.notify?.(podId);
    return buildA2ATask({ task });
  }

  getTask(podId: string, a2aTaskId: string): Task | null {
    const link = this.deps.store.getA2ALink(podId, 'task', a2aTaskId);
    const localId = link?.localId ?? a2aTaskId;
    const task = this.deps.store.getTask(localId);
    if (!task || task.podId !== podId) return null;
    const state = link?.state ? (TaskState as any)[link.state] : undefined;
    return buildA2ATask({ task, state });
  }

  cancelTask(podId: string, a2aTaskId: string): Task | null {
    const link = this.deps.store.getA2ALink(podId, 'task', a2aTaskId);
    const localId = link?.localId ?? a2aTaskId;
    const task = this.deps.store.getTask(localId);
    if (!task || task.podId !== podId) return null;
    if (task.status === 'done' || task.status === 'failed') return null;
    this.deps.store.updateTask(task.id, { status: 'failed' }, this.deps.now());
    this.deps.store.setA2AState(podId, 'task', task.id, 'TASK_STATE_CANCELED');
    this.deps.notify?.(podId);
    return buildA2ATask({ task: { ...task, status: 'failed' }, state: TaskState.TASK_STATE_CANCELED });
  }

  listTasks(podId: string, contextId?: string | null): Task[] {
    return this.deps.store.listTasks(podId)
      .filter((task) => !contextId || (task.goalId ? `pod:${task.podId}:goal:${task.goalId}` : `pod:${podId}`) === contextId)
      .map((task) => this.getTask(podId, task.id))
      .filter((task): task is Task => !!task);
  }
}

