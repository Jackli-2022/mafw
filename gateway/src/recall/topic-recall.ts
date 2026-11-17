import type { TopicState } from './topic-state';

const REMINDER_QUERY = /(?:提醒|记着|记住|便签|待办|note[\s-]?board|sticky)/i;

function topicTokens(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLowerCase();
  const out = new Set<string>();
  for (const token of normalized.match(/[a-z0-9][a-z0-9_.:/-]{2,}/g) ?? []) out.add(token);
  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

/**
 * Note-board is user-authored, but it is not automatically in scope for every
 * topic. Show it only when the current query/topic shares enough meaningful
 * anchors, or when the user explicitly asks about reminders/sticky notes.
 */
export function isNoteBoardRelevant(
  note: { primary_abstraction?: string; memory_value?: string; cue_anchors?: string[] },
  topic: TopicState | null,
  query: string,
): boolean {
  if (REMINDER_QUERY.test(query)) return true;
  const context = [
    topic?.topic,
    topic?.summary,
    ...(topic?.entities ?? []),
    ...(topic?.aliases ?? []),
    ...(topic?.openLoops ?? []),
    ...(topic?.retrievalKeys ?? []),
    query,
  ].filter(Boolean).join(' ');
  const contextTokens = topicTokens(context);
  if (contextTokens.size === 0) return false;

  const noteTokens = topicTokens([
    note.primary_abstraction,
    note.memory_value,
    ...(note.cue_anchors ?? []),
  ].filter(Boolean).join(' '));
  const overlap = [...noteTokens].filter((token) => contextTokens.has(token));
  if (overlap.length >= 2) return true;
  return overlap.some((token) => /[a-z0-9]/.test(token) && token.length >= 6);
}

/**
 * Whether the body immediately below the header contains related recall
 * memories. Note-board and goal snapshots are rendered separately and are not
 * "相关记忆"; a FOK no-memory block also does not count as related.
 */
export function hasRelatedRecallBody(
  formattedPointers: string | null | undefined,
  fokStatus: string,
  snapshotPointers?: string | null,
  snapshotFokStatus?: string,
): boolean {
  if (snapshotPointers) return (snapshotFokStatus ?? 'inject') === 'inject';
  return Boolean(formattedPointers) && (fokStatus ?? 'inject') === 'inject';
}

/**
 * A small, stable header above the legacy recall body. It reports attention
 * state honestly; it does not upgrade existing candidates into verified
 * relevance. `hasRecallBody` only says whether related recall memories follow.
 */
export function renderTopicRecallHeader(
  state: TopicState | null,
  hasRecallBody: boolean,
): string {
  const topic = String(state?.topic ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, (char) => (char === '<' ? '‹' : '›'))
    .trim()
    .slice(0, 200);
  const lines = [
    '<topic-recall>',
    `主题：${topic || '未设置'}`,
    `相关记忆：${hasRecallBody ? '见下方' : '无'}`,
  ];
  if (!topic) lines.push('Agent：理解当前对话后，使用 mafw_topic_set 设置主题');
  lines.push('</topic-recall>');
  return lines.join('\n');
}
