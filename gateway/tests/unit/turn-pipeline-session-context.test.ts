import { sessionContext } from '../../src/recall/turn-pipeline';

describe('sessionContext', () => {
  const index = {
    getIndex: () => ({
      entries: [
        { type: 'episodic', source_session_id: 's1', primary_abstraction: 'legacy narrative' },
        { type: 'episodic', source_session_id: 's2', primary_abstraction: 'other session' },
      ],
    }),
  } as any;

  test('prefers episode intents over legacy episodic narratives', () => {
    const ctx = sessionContext(index, 's1', 10, {
      episodes: [{ intent: 'episode intent' }, { intent: '' }] as any,
    });
    expect(ctx).toContain('episode intent');
    expect(ctx).not.toContain('legacy narrative');
    expect(ctx).not.toContain('other session');
  });

  test('falls back to legacy episodic entries when no episodes are supplied', () => {
    expect(sessionContext(index, 's1', 10)).toContain('legacy narrative');
  });
});
