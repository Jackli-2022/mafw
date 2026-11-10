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

function takeBudgeted(lines: string[], budget: number, maxLines: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (out.length >= maxLines) break;
    const room = budget - used;
    if (room <= 8) break;
    const text = `- ${line}`.slice(0, room);
    out.push(text);
    used += text.length + 1;
  }
  return out;
}

function takeToolLines(lines: string[], budget: number): string[] {
  if (budget <= 8 || lines.length === 0) return [];
  const picked: string[] = [];
  let used = 0;
  const add = (line: string): void => {
    if (picked.includes(line)) return;
    const cost = line.length + 1;
    if (used + cost > budget) return;
    picked.unshift(line);
    used += cost;
  };
  for (const line of lines.filter((item) => ERROR_RE.test(item)).slice(-2).reverse()) add(line);
  for (let i = lines.length - 1; i >= 0 && picked.length < MAX_TOOL_LINES; i -= 1) {
    add(lines[i]);
    if (used >= budget) break;
  }
  return picked.slice(0, MAX_TOOL_LINES);
}

function buildSummary(messages: MafwMessage[], maxChars: number): TopicSummary {
  const limit = Math.max(200, maxChars);
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
    .reverse()
    .map((text) => text.replace(/\s+/g, ' ').slice(0, 200));

  // Reserve header/newline overhead, then split the content budget by section.
  // Decisions / open loops / user words each get their own cap so a single long
  // line cannot evict another section (the hard P1 invariant).
  const contentBudget = Math.max(120, limit - 70);
  const decisionBudget = Math.floor(contentBudget * 0.4);
  const openBudget = Math.floor(contentBudget * 0.3);
  const userBudget = Math.floor(contentBudget * 0.2);
  const toolBudget = Math.max(0, contentBudget - decisionBudget - openBudget - userBudget);
  const baseLines = [
    'Decisions:',
    ...takeBudgeted(decisions, decisionBudget, 6),
    'Open loops:',
    ...takeBudgeted(openLoops, openBudget, 6),
    'User words:',
    ...takeBudgeted(userWords, userBudget, 3),
  ];

  let summary = baseLines.join('\n');
  const tools = takeToolLines(toolLines(messages), Math.min(toolBudget, Math.max(0, limit - summary.length - 14)));
  if (tools.length > 0) summary += `\nTool output:\n${tools.join('\n')}`;
  if (summary.length > limit) summary = summary.slice(0, limit);

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
