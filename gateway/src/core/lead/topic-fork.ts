import type { MafwMessage } from '../../runtime/canonical-types';
import type { LeadTopicRow } from './lead-topic-store';

export interface ForkPlan {
  sourceTopicId: string;
  inheritedFrom: string;
  inheritedTo: string;
  mode: 'reference' | 'summary';
  summary: string;
  handoffText: string;
}

function textOf(message: MafwMessage): string {
  if (message.role !== 'user') return '';
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part: any) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
    .map((part: any) => String(part.text).trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Plan a copy-on-write fork: only a reference range + summary + user words.
 * The source transcript is never copied.
 */
export function planFork(input: {
  topic: LeadTopicRow;
  messages: MafwMessage[];
  summary: string;
  budgetTokens?: number;
}): ForkPlan {
  const inheritedFrom = input.topic.inheritedMessageRange?.from ?? input.topic.startMessageId;
  const inheritedTo = input.topic.inheritedMessageRange?.to ?? input.topic.endMessageId;
  const maxChars = Math.max(1, Math.trunc((input.budgetTokens ?? 1200) * 4));
  const summary = input.summary.trim().slice(0, maxChars);
  const userWords = input.messages
    .flatMap((message) => {
      const text = textOf(message);
      return text ? [text] : [];
    })
    .slice(-5);

  const lines = [
    `<forked-topic sourceTopicId="${input.topic.id}" from="${inheritedFrom}" to="${inheritedTo}">`,
    `Source: ${input.topic.id}`,
    'Summary:',
    summary || '(no summary yet)',
  ];
  if (userWords.length > 0) lines.push('User words:', ...userWords.map((text) => `- ${text.slice(0, 200)}`));
  lines.push('</forked-topic>');

  return {
    sourceTopicId: input.topic.id,
    inheritedFrom,
    inheritedTo,
    mode: 'reference',
    summary,
    handoffText: lines.join('\n'),
  };
}
