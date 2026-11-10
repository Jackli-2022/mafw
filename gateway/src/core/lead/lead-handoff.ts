import type { MafwMessage } from '../../runtime/canonical-types';

export interface LeadHandoffInput {
  messages: MafwMessage[];
  fromMessageId?: string;
  maxChars?: number;
}

export interface LeadHandoffResult {
  snapshot: string;
  messageRange: { from: string; to: string } | null;
  messageCount: number;
  truncated: boolean;
}

export const LEAD_HANDOFF_MAX_CHARS = 4000;

function textOf(message: MafwMessage): string {
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part: any) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
    .map((part: any) => String(part.text).trim())
    .filter(Boolean)
    .join('\n');
}

function keptMessages(messages: MafwMessage[], fromMessageId?: string): MafwMessage[] {
  const start = fromMessageId ? messages.findIndex((m) => m.id === fromMessageId) : -1;
  // Fail open when the boundary is outside the fetched window: include what we
  // have rather than handing over an empty topic.
  const slice = fromMessageId && start >= 0 ? messages.slice(start + 1) : messages;
  return slice.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false;
    // Exclude the assistant message still being generated. History messages may
    // omit `time` entirely; only skip when the field is present and incomplete.
    if (message.role === 'assistant' && message.time && message.time.completed === undefined) return false;
    return textOf(message).length > 0;
  });
}

function renderKept(messages: MafwMessage[]): string {
  return messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${textOf(message)}`)
    .join('\n\n');
}

/** Full, untruncated text used for `<goalDir>/context/lead-handoff.md`. */
export function renderHandoffText(messages: MafwMessage[], fromMessageId?: string): string {
  return renderKept(keptMessages(messages, fromMessageId));
}

export function buildLeadHandoff(input: LeadHandoffInput): LeadHandoffResult {
  const maxChars = Math.max(1, input.maxChars ?? LEAD_HANDOFF_MAX_CHARS);
  const kept = keptMessages(input.messages, input.fromMessageId);
  if (kept.length === 0) {
    return { snapshot: '', messageRange: null, messageCount: 0, truncated: false };
  }

  const from = kept[0].id;
  const to = kept[kept.length - 1].id;
  const messageRange = from && to ? { from, to } : null;
  const text = renderKept(kept);
  if (text.length <= maxChars) {
    return { snapshot: text, messageRange, messageCount: kept.length, truncated: false };
  }

  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 3);
  return {
    snapshot: text.slice(0, head) + '…' + (tail > 0 ? text.slice(-tail) : ''),
    messageRange,
    messageCount: kept.length,
    truncated: true,
  };
}
