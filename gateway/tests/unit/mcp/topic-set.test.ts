import { DEFINITIONS, createToolRegistry } from '../../../src/mcp/tool-registry';
import { handleTopicSet } from '../../../src/mcp/handlers/topic-set';

const parse = (result: any) => JSON.parse(result.content[0].text);

describe('mafw_topic_set MCP handler', () => {
  test('definition requires sessionID and the registry handles the tool', () => {
    const def = DEFINITIONS.find((entry) => entry.name === 'mafw_topic_set');
    expect(def).toBeDefined();
    expect(def?.inputSchema.required).toContain('sessionID');
    expect(createToolRegistry().handlers.mafw_topic_set).toBe(handleTopicSet);
  });

  test('missing sessionID fails closed without writing', async () => {
    const setTopic = jest.fn();
    const result: any = await handleTopicSet({ topic: 'x' }, { setTopic } as any);

    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe('sessionID_required');
    expect(setTopic).not.toHaveBeenCalled();
  });

  test('forwards the explicit session and fields to the topic service', async () => {
    const setTopic = jest.fn(() => ({
      sessionId: 's1',
      topic: '记忆设计',
      entities: [],
      aliases: [],
      openLoops: [],
      retrievalKeys: [],
      active: true,
      revision: 1,
      updatedAt: '2026-11-17T00:00:00.000Z',
    }));
    const result: any = await handleTopicSet(
      {
        sessionID: 's1',
        topic: '记忆设计',
        entities: ['记忆'],
        expectedRevision: 0,
      },
      { setTopic } as any,
    );

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({ success: true, state: { topic: '记忆设计' } });
    expect(setTopic).toHaveBeenCalledWith({
      sessionID: 's1',
      topic: '记忆设计',
      summary: undefined,
      entities: ['记忆'],
      aliases: undefined,
      openLoops: undefined,
      retrievalKeys: undefined,
      matterId: undefined,
      active: undefined,
      expectedRevision: 0,
    });
  });

  test('revision conflict returns a structured error', async () => {
    const err: any = new Error('stale');
    err.name = 'TopicRevisionConflict';
    const result: any = await handleTopicSet(
      { sessionID: 's1', topic: 'x' },
      {
        setTopic: () => {
          throw err;
        },
      } as any,
    );

    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe('topic_revision_conflict');
  });
});
