import { renderTopicRecallHeader } from '../../../src/recall/topic-recall';
import type { TopicState } from '../../../src/recall/topic-state';

function state(overrides: Partial<TopicState> = {}): TopicState {
  return {
    sessionId: 's1',
    topic: '个人 Agent 记忆',
    entities: [],
    aliases: [],
    openLoops: [],
    retrievalKeys: [],
    active: true,
    revision: 1,
    updatedAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('topic recall header', () => {
  test('shows the topic and points to the existing recall body', () => {
    expect(renderTopicRecallHeader(state(), true)).toBe(
      '<topic-recall>\n主题：个人 Agent 记忆\n相关记忆：见下方\n</topic-recall>',
    );
  });

  test('shows an explicit empty related-memory result', () => {
    expect(renderTopicRecallHeader(state(), false)).toContain('相关记忆：无');
  });

  test('unset topic is honest and tells the agent which tool to use', () => {
    const header = renderTopicRecallHeader(null, false);
    expect(header).toContain('主题：未设置');
    expect(header).toContain('相关记忆：无');
    expect(header).toContain('mafw_topic_set');
  });

  test('unset topic keeps the tool hint even when a legacy recall body exists', () => {
    const header = renderTopicRecallHeader(null, true);
    expect(header).toContain('相关记忆：见下方');
    expect(header).toContain('mafw_topic_set');
  });

  test('topic text is bounded to one display line', () => {
    const header = renderTopicRecallHeader(state({ topic: '第一行\n第二行' }), false);
    expect(header).toContain('主题：第一行 第二行');
    expect(header).not.toContain('第一行\n第二行');
  });
});
