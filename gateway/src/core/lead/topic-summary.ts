import { createHash } from 'crypto';
import type { MafwMessage } from '../../runtime/canonical-types';
import { estimateTopicTokens } from './working-set';

export interface TopicSummary {
  summary: string;
  summaryHash: string;
  residentTokens: number;
}

export interface CompactTopicResult extends TopicSummary {
  beforeTokens: number;
  afterTokens: number;
  evictedMessageIds: string[];
}

const DECISION_RE = /决定|结论|decision|decided/i;
const OPEN_LOOP_RE = /待|未|TODO|open|pending|\?/i;
const ERROR_RE = /error|fail|exception|traceback/i;
const MAX_TOOL_LINES = 8;

function textParts(message: MafwMessage): string[] {
  if (message.role !== 'user' && message.role !== 'assistant') return [];
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((part: any) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
    .map((part: any) => String(part.text).trim())
    .filter(Boolean);
}

function toolOutputs(message: MafwMessage): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((part: any) => part?.type === 'tool')
    .map((part: any) => {
      const raw = part?.state?.output ?? part?.output ?? part?.result ?? part?.state?.error ?? '';
      if (typeof raw === 'string') return raw;
      try { return JSON.stringify(raw); } catch { return ''; }
    })
    .filter((text) => !!text);
}

function uniqueLines(lines: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function toolLines(messages: MafwMessage[]): string[] {
  const outputs = messages.flatMap(toolOutputs);
  if (outputs.length === 0) return [];
  const lines = outputs.flatMap((output) => output.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);
  const tail = lines.slice(-MAX_TOOL_LINES);
  const missingErrors = lines.filter((line) => ERROR_RE.test(line) && !tail.includes(line));
  if (missingErrors.length > 0) {
    tail.splice(0, Math.min(missingErrors.length, tail.length), ...missingErrors.slice(-MAX_TOOL_LINES));
  }
  return tail.slice(-MAX_TOOL_LINES);
}

function buildSummary(messages: MafwMessage[], maxChars: number): TopicSummary {
  const texts = messages.flatMap(textParts);
  const joined = [
    ...texts,
    ...messages.flatMap(toolOutputs),
  ].join('\n');

  const decisions = uniqueLines(
    texts.flatMap((text) => text.split(/\r?\n/)).filter((line) => DECISION_RE.test(line)),
    6,
  );
  const decisionSet = new Set(decisions);
  const openLoops = uniqueLines(
    texts.flatMap((text) => text.split(/\r?\n/))
      .filter((line) => OPEN_LOOP_RE.test(line) && !decisionSet.has(line.trim())),
    6,
  );
  const userWords = messages
    .filter((message) => message.role === 'user')
    .flatMap(textParts)
    .slice(-3)
    .map((text) => text.replace(/\s+/g, ' ').slice(0, 200));

  const lines = ['Decisions:', ...decisions.map((line) => `- ${line}`), 'Open loops:', ...openLoops.map((line) => `- ${line}`), 'User words:'];
  if (userWords.length > 0) lines.push(...userWords.map((line) => `- ${line}`));
  const tools = toolLines(messages);
  if (tools.length > 0) lines.push('Tool output:', ...tools);

  const summary = lines.join('\n').slice(0, Math.max(0, maxChars));
  return {
    summary,
    summaryHash: createHash('sha256').update(joined).digest('hex'),
    residentTokens: estimateTopicTokens(summary),
  };
}

/** Deterministic summary that always keeps decisions, open loops and user words. */
export function summarizeTopic(messages: MafwMessage[], maxChars = 1200): TopicSummary {
  return buildSummary(messages, maxChars);
}

/**
 * Compaction is a page swap, never a delete: the summary is persisted and the
 * evicted ids are reported; the original transcript stays untouched.
 */
export function compactTopic(input: {
  topicId: string;
  messages: MafwMessage[];
  keepRecentTurns?: number;
  maxChars?: number;
}): CompactTopicResult {
  const messages = input.messages ?? [];
  const keep = Math.max(0, Math.trunc(input.keepRecentTurns ?? 6)) * 2;
  const keptFrom = Math.max(0, messages.length - keep);
  const evictedMessageIds = messages
    .slice(0, keptFrom)
    .map((message) => message.id)
    .filter((id): id is string => !!id);
  const summary = buildSummary(messages, input.maxChars ?? 1200);
  const beforeTokens = messages.reduce((sum, message) => {
    const text = [...textParts(message), ...toolOutputs(message)].join('\n');
    return sum + estimateTopicTokens(text);
  }, 0);

  return {
    ...summary,
    beforeTokens,
    afterTokens: estimateTopicTokens(summary.summary),
    evictedMessageIds,
  };
}
