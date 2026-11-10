import * as fs from 'fs';
import * as path from 'path';
import type { GoalSourceRef } from '../goal/goal-intake';
import type { MafwMessage } from '../../runtime/canonical-types';
import { buildLeadHandoff, renderHandoffMessages, selectHandoffMessages } from './lead-handoff';
import type { LeadTopicStore } from './lead-topic-store';

export interface LeadHandoffDeps {
  topics: LeadTopicStore;
  listMessages(input: { sessionID: string; limit: number }): Promise<{ data: MafwMessage[] }>;
  now(): string;
  newId(): string;
  /** Bounded history read; default 10s. */
  timeoutMs?: number;
  log?(message: string): void;
  /** P1: index + summarize the committed topic (fail-open). */
  onCommitted?(prepared: LeadHandoffPrepared): void;
}

export interface LeadHandoffPrepared {
  sourceRef: GoalSourceRef;
  handoffPath: string;
  topicId: string;
  messageRange: { from: string; to: string } | null;
  fullText: string;
  /** Scoped messages (text-only, completed assistant turns) for P1 indexing. */
  messages: MafwMessage[];
  projectDir: string;
  goalId: string;
  leadSessionId: string;
  title: string;
  startMessageId: string;
  endMessageId: string;
  createdAt: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`handoff history read timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Two-phase current-topic handoff:
 * - `prepareForGoal` reads messages and builds the snapshot in memory (no side effects);
 * - `commit` writes the full text and the topic row after the Goal/revision is durable.
 * This keeps a duplicate/concurrent create from overwriting another Goal's handoff file.
 */
export class LeadHandoffService {
  constructor(private readonly deps: LeadHandoffDeps) {}

  async prepareForGoal(input: {
    projectDir: string;
    leadSessionId: string;
    goalId: string;
    goalDir: string;
    title: string;
    topicId?: string;
    untilMessageId?: string;
    maxMessages?: number;
  }): Promise<LeadHandoffPrepared | null> {
    const resolvedGoalDir = path.resolve(input.goalDir);
    if (path.basename(resolvedGoalDir) !== input.goalId) {
      throw new Error(`unsafe handoff goal dir for ${input.goalId}`);
    }
    const previous = input.topicId
      ? this.deps.topics.get(input.topicId)
      : this.deps.topics.latestForProject(input.projectDir);
    if (input.topicId && !previous) return null;

    const fetched = await withTimeout(
      this.deps.listMessages({
        sessionID: input.leadSessionId,
        limit: input.maxMessages ?? 200,
      }),
      this.deps.timeoutMs ?? 10_000,
    );

    const scoped = input.untilMessageId
      ? (() => {
          const index = fetched.data.findIndex((message) => message.id === input.untilMessageId);
          return index >= 0 ? fetched.data.slice(0, index + 1) : fetched.data;
        })()
      : fetched.data;

    const built = buildLeadHandoff({
      messages: scoped,
      fromMessageId: previous?.endMessageId,
    });
    if (!built.messageRange) return null;

    const messages = selectHandoffMessages(scoped, previous?.endMessageId);
    const topicId = this.deps.newId();
    const capturedAt = this.deps.now();
    return {
      sourceRef: {
        sessionID: input.leadSessionId,
        messageID: built.messageRange.to,
        snapshot: built.snapshot,
        capturedAt,
        topicId,
        messageRange: built.messageRange,
      },
      handoffPath: path.join(input.goalDir, 'context', 'lead-handoff.md'),
      topicId,
      messageRange: built.messageRange,
      fullText: renderHandoffMessages(messages),
      messages,
      projectDir: input.projectDir,
      goalId: input.goalId,
      leadSessionId: input.leadSessionId,
      title: input.title,
      startMessageId: built.messageRange.from,
      endMessageId: built.messageRange.to,
      createdAt: capturedAt,
    };
  }

  /** Persist the prepared handoff after the Goal/revision is durable. */
  commit(prepared: LeadHandoffPrepared): void {
    fs.mkdirSync(path.dirname(prepared.handoffPath), { recursive: true });
    const tmp = `${prepared.handoffPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, prepared.fullText, 'utf8');
    fs.renameSync(tmp, prepared.handoffPath);
    try {
      this.deps.topics.insert({
        id: prepared.topicId,
        projectDir: prepared.projectDir,
        leadSessionId: prepared.leadSessionId,
        title: prepared.title,
        startMessageId: prepared.startMessageId,
        endMessageId: prepared.endMessageId,
        goalId: prepared.goalId,
        ownerRole: 'tech-lead',
        ownerSessionId: null,
        createdAt: prepared.createdAt,
      });
    } catch (err: any) {
      // The Goal is already durable; provenance failure must not fail it.
      this.deps.log?.(`[LeadHandoff] topic insert failed for ${prepared.goalId}: ${err?.message ?? err}`);
    }
    try {
      this.deps.onCommitted?.(prepared);
    } catch (err: any) {
      this.deps.log?.(`[LeadHandoff] post-commit indexing failed for ${prepared.goalId}: ${err?.message ?? err}`);
    }
  }

  /** Best-effort rollback for callers that committed before a later failure. */
  rollback(topicId: string, handoffPath?: string): void {
    try {
      this.deps.topics.remove(topicId);
    } catch {
      /* best effort */
    }
    if (handoffPath) {
      try {
        fs.rmSync(handoffPath, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}
