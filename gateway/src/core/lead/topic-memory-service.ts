import type { LeadTopicStore } from './lead-topic-store';
import { buildTopicMemory, type TopicMemory } from './topic-memory';

export interface TopicMemoryDeps {
  topics: Pick<LeadTopicStore, 'findByGoal'>;
  addMemory(input: TopicMemory): Promise<void> | void;
  enabled(): boolean;
  now(): string;
  wasPromoted(key: string): boolean;
  markPromoted(key: string): void;
  log?(message: string): void;
}

/**
 * Promote a completed Goal's source-topic summary into semantic memory.
 * Idempotent per topic + summary hash; never writes the Tech Lead transcript.
 */
export class TopicMemoryService {
  constructor(private readonly deps: TopicMemoryDeps) {}

  async promoteForGoal(goalId: string): Promise<boolean> {
    if (!this.deps.enabled()) return false;
    try {
      const topic = this.deps.topics.findByGoal(goalId);
      if (!topic || !topic.summary?.trim() || !topic.summaryHash) return false;
      const key = `${topic.id}:${topic.summaryHash}`;
      if (this.deps.wasPromoted(key)) return false;
      await this.deps.addMemory(buildTopicMemory({
        topic,
        summary: topic.summary,
        goalId,
        projectDir: topic.projectDir,
      }));
      this.deps.markPromoted(key);
      return true;
    } catch (err: any) {
      this.deps.log?.(`[TopicMemory] promote failed for ${goalId}: ${err?.message ?? err}`);
      return false;
    }
  }
}
