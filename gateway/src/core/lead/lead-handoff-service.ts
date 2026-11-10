import * as fs from 'fs';
import * as path from 'path';
import type { GoalSourceRef } from '../goal/goal-intake';
import type { MafwMessage } from '../../runtime/canonical-types';
import { buildLeadHandoff, renderHandoffMessages, selectHandoffMessages } from './lead-handoff';
import { planFork } from './topic-fork';
import type { LeadTopicStore } from './lead-topic-store';
import type { TopicMessageIndexStore } from './topic-message-index';
import type { TopicForkStore } from './topic-fork-store';

export interface LeadHandoffDeps {
  topics: LeadTopicStore;
  /** P2 fork: source topic index rows. */
  index?: Pick<TopicMessageIndexStore, 'listByTopic'>;
  /** P2 fork: provenance rows. */
  forks?: Pick<TopicForkStore, 'insert'>;
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
  /** P2 COW fork provenance (absent for ordinary current-topic handoffs). */
  fork?: { sourceTopicId: string; inheritedFrom: string; inheritedTo: string; mode: 'reference' | 'summary' };
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

  /**
   * P2 COW fork: reference an existing topic (range + summary + user words)
   * instead of copying the current conversation. Source rows stay untouched.
   */
  async buildForkForGoal(input: {
    projectDir: string;
    goalId: string;
    goalDir: string;
    title: string;
    sourceTopicId: string;
  }): Promise<LeadHandoffPrepared | null> {
    const source = this.deps.topics.get(input.sourceTopicId);
    if (!source) return null;
    if (!this.deps.index || !this.deps.forks) return null;

    const resolvedGoalDir = path.resolve(input.goalDir);
    if (path.basename(resolvedGoalDir) !== input.goalId) {
      throw new Error(`unsafe fork goal dir for ${input.goalId}`);
    }

    const rows = this.deps.index.listByTopic(input.sourceTopicId);
    const messages: MafwMessage[] = rows.map((row) => ({
      id: row.messageId,
      role: row.role,
      content: [{ type: 'text', text: row.text } as any],
    }));
    const summary = source.summary?.trim() || source.title;
    const plan = planFork({ topic: source, messages, summary });
    const topicId = this.deps.newId();
    const capturedAt = this.deps.now();

    return {
      sourceRef: {
        sessionID: source.leadSessionId,
        messageID: plan.inheritedTo,
        snapshot: plan.summary.slice(0, 4000),
        capturedAt,
        topicId,
        messageRange: { from: plan.inheritedFrom, to: plan.inheritedTo },
      },
      handoffPath: path.join(input.goalDir, 'context', 'lead-handoff.md'),
      topicId,
      messageRange: { from: plan.inheritedFrom, to: plan.inheritedTo },
      fullText: plan.handoffText,
      messages: [],
      projectDir: input.projectDir,
      goalId: input.goalId,
      leadSessionId: source.leadSessionId,
      title: input.title,
      startMessageId: plan.inheritedFrom,
      endMessageId: plan.inheritedTo,
      createdAt: capturedAt,
      fork: {
        sourceTopicId: plan.sourceTopicId,
        inheritedFrom: plan.inheritedFrom,
        inheritedTo: plan.inheritedTo,
        mode: plan.mode,
      },
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
        forkedFrom: prepared.fork?.sourceTopicId ?? null,
        forkedAt: prepared.fork ? prepared.createdAt : null,
        inheritedMessageRange: prepared.fork
          ? { from: prepared.fork.inheritedFrom, to: prepared.fork.inheritedTo }
          : null,
      });
      if (prepared.fork) {
        this.deps.forks?.insert({
          id: prepared.topicId,
          sourceTopicId: prepared.fork.sourceTopicId,
          targetGoalId: prepared.goalId,
          inheritedFrom: prepared.fork.inheritedFrom,
          inheritedTo: prepared.fork.inheritedTo,
          mode: prepared.fork.mode,
          createdAt: prepared.createdAt,
        });
      }
    } catch (err: any) {
      // The Goal is already durable; provenance failure must not fail it.
      this.deps.log?.(`[LeadHandoff] topic insert failed for ${prepared.goalId}: ${err?.message ?? err}`);
    }
    if (!prepared.fork) {
      try {
        this.deps.onCommitted?.(prepared);
      } catch (err: any) {
        this.deps.log?.(`[LeadHandoff] post-commit indexing failed for ${prepared.goalId}: ${err?.message ?? err}`);
      }
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
