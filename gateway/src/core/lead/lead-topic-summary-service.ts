import type { MafwMessage } from '../../runtime/canonical-types';
import type { LeadTopicStore } from './lead-topic-store';
import type { TopicMessageIndexRow, TopicMessageIndexStore } from './topic-message-index';
import { summarizeTopic } from './topic-summary';
import { estimateTopicTokens } from './working-set';

export interface LeadTopicSummaryDeps {
  topics: Pick<LeadTopicStore, 'updateSummary' | 'get'>;
  index: Pick<TopicMessageIndexStore, 'replaceTopic'>;
  summarize: typeof summarizeTopic;
  now(): string;
  log?(message: string): void;
}

function messageText(message: MafwMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part: any) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
    .map((part: any) => String(part.text).trim())
    .filter(Boolean)
    .join('\n');
}

function messageCreatedAt(message: MafwMessage, fallback: string): string {
  const created = (message as any)?.time?.created;
  return typeof created === 'number' ? new Date(created).toISOString() : fallback;
}

/**
 * Post-handoff indexing: writes the searchable page-out rows and the topic
 * summary. Fail-open — a broken index must never fail the Goal/handoff.
 */
export class LeadTopicSummaryService {
  constructor(private readonly deps: LeadTopicSummaryDeps) {}

  indexAndSummarize(prepared: { topicId: string; messages: MafwMessage[]; createdAt: string }): void {
    try {
      const rows: TopicMessageIndexRow[] = [];
      for (const message of prepared.messages) {
        const text = messageText(message);
        if (!text || !message.id) continue;
        rows.push({
          topicId: prepared.topicId,
          messageId: message.id,
          role: message.role === 'user' ? 'user' : 'assistant',
          text,
          tokenEstimate: estimateTopicTokens(text),
          createdAt: messageCreatedAt(message, prepared.createdAt),
        });
      }
      this.deps.index.replaceTopic(prepared.topicId, rows);

      const summary = this.deps.summarize(prepared.messages);
      if (this.deps.topics.get(prepared.topicId)?.summaryHash === summary.summaryHash) return;
      this.deps.topics.updateSummary(prepared.topicId, {
        summary: summary.summary,
        summaryHash: summary.summaryHash,
        now: this.deps.now(),
        residentTokens: summary.residentTokens,
      });
    } catch (err: any) {
      this.deps.log?.(`[LeadTopicSummary] index failed for ${prepared.topicId}: ${err?.message ?? err}`);
    }
  }
}
