import type { TopicState } from './topic-state';

/**
 * A small, stable header above the legacy recall body. It reports attention
 * state honestly; it does not upgrade existing candidates into verified
 * relevance. `hasRecallBody` only says whether anything follows below.
 */
export function renderTopicRecallHeader(
  state: TopicState | null,
  hasRecallBody: boolean,
): string {
  const topic = String(state?.topic ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const lines = [
    '<topic-recall>',
    `主题：${topic || '未设置'}`,
    `相关记忆：${hasRecallBody ? '见下方' : '无'}`,
  ];
  if (!topic) lines.push('Agent：理解当前对话后，使用 mafw_topic_set 设置主题');
  lines.push('</topic-recall>');
  return lines.join('\n');
}
