import { PodError } from '../pod/pod-store';
import type { LeadTopicRow, LeadTopicStore } from './lead-topic-store';
import type { TopicMessageIndexStore } from './topic-message-index';

export interface ResumeResult {
  sessionID: string;
  resumedFrom: string | null;
}

export interface LeadTopicResumeDeps {
  topics: LeadTopicStore;
  index: Pick<TopicMessageIndexStore, 'listByTopic'>;
  sessions: {
    current(projectDir: string): { sessionId: string } | null;
    isAlive(sessionID: string): Promise<boolean>;
    ensure(projectDir: string): Promise<{ sessionId: string }>;
  };
  promptAsync(input: { sessionID: string; parts: Array<{ type: 'text'; text: string }> }): Promise<void>;
  now(): string;
  newId(): string;
  log?(message: string): void;
}

function resumedBlock(topic: LeadTopicRow, rows: ReturnType<TopicMessageIndexStore['listByTopic']>): string {
  const userWords = rows
    .filter((row) => row.role === 'user')
    .slice(0, 5)
    .map((row) => `- ${row.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  return [
    `<resumed-topic topicId="${topic.id}" title="${topic.title.replace(/"/g, '&quot;')}">`,
    'Summary:',
    topic.summary?.trim() || '(no summary yet)',
    ...(userWords.length > 0 ? ['User words:', ...userWords] : []),
    '</resumed-topic>',
  ].join('\n');
}

/**
 * Resume an old topic: alive sessions are reused in place; dead sessions get a
 * new Lead session seeded with the topic summary, and provenance is a new row.
 * The old transcript is never rewritten.
 */
export class LeadTopicResumeService {
  private readonly inflight = new Map<string, Promise<ResumeResult>>();

  constructor(private readonly deps: LeadTopicResumeDeps) {}

  resume(topicId: string): Promise<ResumeResult> {
    const running = this.inflight.get(topicId);
    if (running) return running;
    const promise = this.run(topicId).finally(() => this.inflight.delete(topicId));
    this.inflight.set(topicId, promise);
    return promise;
  }

  private demoteOtherResidents(projectDir: string, keepId: string, now: string): void {
    for (const topic of this.deps.topics.listByProject(projectDir)) {
      if (topic.id !== keepId && topic.state === 'resident') {
        this.deps.topics.setState(topic.id, 'warm', now);
      }
    }
  }

  private async run(topicId: string): Promise<ResumeResult> {
    const topic = this.deps.topics.get(topicId);
    if (!topic) throw new PodError(404, `topic not found: ${topicId}`);
    if (topic.state === 'archived') throw new PodError(409, `topic is archived: ${topicId}`);

    const now = this.deps.now();
    const targetSession = topic.ownerSessionId ?? topic.leadSessionId;
    if (await this.deps.sessions.isAlive(targetSession)) {
      this.deps.topics.setState(topicId, 'resident', now);
      this.demoteOtherResidents(topic.projectDir, topicId, now);
      return { sessionID: targetSession, resumedFrom: null };
    }

    const ensured = await this.deps.sessions.ensure(topic.projectDir);
    const block = resumedBlock(topic, this.deps.index.listByTopic(topicId));
    try {
      await this.deps.promptAsync({
        sessionID: ensured.sessionId,
        parts: [{ type: 'text', text: block }],
      });
    } catch (err: any) {
      // The new session/topic are still valid; the user can continue and the
      // summary is available through the topic index.
      this.deps.log?.(`[LeadTopicResume] seed prompt failed for ${topicId}: ${err?.message ?? err}`);
    }

    const newId = this.deps.newId();
    this.deps.topics.insert({
      id: newId,
      projectDir: topic.projectDir,
      leadSessionId: ensured.sessionId,
      title: topic.title,
      startMessageId: topic.startMessageId,
      endMessageId: topic.endMessageId,
      goalId: topic.goalId,
      ownerRole: 'lead',
      ownerSessionId: ensured.sessionId,
      createdAt: now,
      summary: topic.summary,
      summaryHash: topic.summaryHash,
      summaryUpdatedAt: topic.summaryUpdatedAt,
      state: 'resident',
      lastActiveAt: now,
      residentTokens: topic.residentTokens,
      resumedFrom: topicId,
    });
    this.deps.topics.setState(topicId, 'warm', now);
    this.demoteOtherResidents(topic.projectDir, newId, now);

    return { sessionID: ensured.sessionId, resumedFrom: topicId };
  }
}
