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
const GENERIC_NOTE_TOKENS = new Set([
  '个人', 'agent', '记忆', '系统', '工具', '当前', '主题', '召回', '验证', '上线',
  '长期', '意图', '后续', '方向', 'topic', 'state', 'mafw', 'prompt',
]);

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isNoteBoardRelevant(
  note: { primary_abstraction?: string; memory_value?: string; cue_anchors?: string[] },
  topic: TopicState | null,
  query: string,
): boolean {
  if (REMINDER_QUERY.test(query)) return true;

  const context = normalizeText([
    topic?.topic,
    topic?.summary,
    ...(topic?.entities ?? []),
    ...(topic?.aliases ?? []),
    ...(topic?.openLoops ?? []),
    ...(topic?.retrievalKeys ?? []),
    query,
  ].filter(Boolean).join(' '));
  if (!context) return false;

  // Exact user-authored anchors are strong evidence, but generic words such as
  // "agent" or "个人" must not put every personal-agent note on every topic.
  for (const anchor of note.cue_anchors ?? []) {
    const normalized = normalizeText(anchor);
    if (normalized.length >= 3 && context.includes(normalized)) return true;
  }

  const title = normalizeText(note.primary_abstraction ?? '');
  const currentTopic = normalizeText(topic?.topic ?? '');
  if (title.length >= 6 && (context.includes(title) || (currentTopic.length >= 6 && title.includes(currentTopic)))) {
    return true;
  }

  const contextTokens = topicTokens(context);
  const noteTokens = topicTokens([
    note.primary_abstraction,
    note.memory_value,
    ...(note.cue_anchors ?? []),
  ].filter(Boolean).join(' '));
  const overlap = [...noteTokens].filter(
    (token) => contextTokens.has(token) && !GENERIC_NOTE_TOKENS.has(token),
  );
  if (overlap.length >= 3) return true;
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
