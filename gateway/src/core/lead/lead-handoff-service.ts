import * as fs from 'fs';
import * as path from 'path';
import type { GoalSourceRef } from '../goal/goal-intake';
import type { MafwMessage } from '../../runtime/canonical-types';
import { buildLeadHandoff, renderHandoffText } from './lead-handoff';
import type { LeadTopicStore } from './lead-topic-store';

export interface LeadHandoffDeps {
  topics: LeadTopicStore;
  listMessages(input: { sessionID: string; limit: number }): Promise<{ data: MafwMessage[] }>;
  now(): string;
  newId(): string;
}

export interface LeadHandoffBuilt {
  sourceRef: GoalSourceRef;
  handoffPath: string;
  topicId: string;
  messageRange: { from: string; to: string } | null;
}

/**
 * Builds the current-topic handoff for a Goal:
 * - start after the previous handoff topic (or at the session start);
 * - snapshot is text-only, capped at 4000 chars;
 * - the full text is written beside the Goal so the Tech Lead can read it;
 * - the topic row is handoff provenance only.
 */
export class LeadHandoffService {
  constructor(private readonly deps: LeadHandoffDeps) {}

  async buildForGoal(input: {
    projectDir: string;
    leadSessionId: string;
    goalId: string;
    goalDir: string;
    title: string;
    untilMessageId?: string;
    maxMessages?: number;
  }): Promise<LeadHandoffBuilt | null> {
    const previous = this.deps.topics.latestForProject(input.projectDir);
    const fetched = (await this.deps.listMessages({
      sessionID: input.leadSessionId,
      limit: input.maxMessages ?? 200,
    })).data;

    const scoped = input.untilMessageId
      ? (() => {
          const index = fetched.findIndex((message) => message.id === input.untilMessageId);
          return index >= 0 ? fetched.slice(0, index + 1) : fetched;
        })()
      : fetched;

    const built = buildLeadHandoff({
      messages: scoped,
      fromMessageId: previous?.endMessageId,
    });
    if (!built.messageRange) return null;

    const topicId = this.deps.newId();
    const capturedAt = this.deps.now();
    const handoffPath = path.join(input.goalDir, 'context', 'lead-handoff.md');
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(
      handoffPath,
      renderHandoffText(scoped, previous?.endMessageId),
      'utf8',
    );

    this.deps.topics.insert({
      id: topicId,
      projectDir: input.projectDir,
      leadSessionId: input.leadSessionId,
      title: input.title,
      startMessageId: built.messageRange.from,
      endMessageId: built.messageRange.to,
      goalId: input.goalId,
      ownerRole: 'tech-lead',
      ownerSessionId: null,
      createdAt: capturedAt,
    });

    return {
      sourceRef: {
        sessionID: input.leadSessionId,
        messageID: built.messageRange.to,
        snapshot: built.snapshot,
        capturedAt,
        topicId,
        messageRange: built.messageRange,
      },
      handoffPath,
      topicId,
      messageRange: built.messageRange,
    };
  }
}
