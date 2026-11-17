import type { ToolHandler } from '../../types';
import { TopicRevisionConflict, type SetTopicInput } from '../../recall/topic-state';

const asList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

export const handleTopicSet: ToolHandler = async (args, services) => {
  const sessionID = typeof args.sessionID === 'string' ? args.sessionID.trim() : '';
  if (!sessionID) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'sessionID_required' }) }],
      isError: true,
    };
  }
  if (!services.setTopic) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'topic_unavailable' }) }],
      isError: true,
    };
  }

  const input: SetTopicInput = {
    sessionID,
    topic: typeof args.topic === 'string' ? args.topic : undefined,
    summary: typeof args.summary === 'string' ? args.summary : undefined,
    entities: asList(args.entities),
    aliases: asList(args.aliases),
    openLoops: asList(args.openLoops),
    retrievalKeys: asList(args.retrievalKeys),
    matterId: typeof args.matterId === 'string' ? args.matterId : undefined,
    active: typeof args.active === 'boolean' ? args.active : undefined,
    expectedRevision: typeof args.expectedRevision === 'number' ? args.expectedRevision : undefined,
  };

  try {
    const state = services.setTopic(input);
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, state }) }],
      structuredContent: { success: true, state },
    };
  } catch (err: any) {
    const conflict = err instanceof TopicRevisionConflict || err?.name === 'TopicRevisionConflict';
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          code: conflict ? 'topic_revision_conflict' : 'topic_set_failed',
          error: err?.message || String(err),
        }),
      }],
      isError: true,
    };
  }
};
