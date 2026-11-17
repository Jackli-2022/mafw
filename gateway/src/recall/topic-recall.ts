import type { TopicState } from './topic-state';

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
