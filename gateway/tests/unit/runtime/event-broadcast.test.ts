// Wire-contract tests for the Mode A SSE broadcast envelope builders used by
// MafwScheduler. The desktop renderer / TUI parse `data` — shape changes here
// are breaking changes for every SSE consumer.
// v2（2026-10-12）：信封名 mafw_event（原 opencode_event）。
import { mafwBroadcast, projectRegisteredEvent } from '../../../src/runtime/event-broadcast';

describe('mafwBroadcast', () => {
  it('wraps a passthrough event without internal flag', () => {
    const envelope = mafwBroadcast({
      type: 'session.updated',
      properties: { sessionID: 's1', info: { id: 's1' } },
      sessionID: 's1',
    });
    expect(envelope).toEqual({
      type: 'mafw_event',
      data: {
        type: 'session.updated',
        properties: { sessionID: 's1', info: { id: 's1' } },
        sessionID: 's1',
      },
    });
    expect('internal' in envelope.data).toBe(false);
  });

  it('carries directory when provided (event-driven consumers locate the project)', () => {
    const envelope = mafwBroadcast({
      type: 'session.created',
      properties: { sessionID: 's1' },
      sessionID: 's1',
      directory: 'C:\\proj',
    });
    expect(envelope.data.directory).toBe('C:\\proj');
  });

  it('omits directory key when absent (keeps the wire shape stable)', () => {
    const envelope = mafwBroadcast({ type: 'session.updated', properties: {}, sessionID: 's1' });
    expect('directory' in envelope.data).toBe(false);
  });

  it('sets internal only when flagged', () => {
    const flagged = mafwBroadcast({ type: 'turn.completed', sessionID: 's1' }, true);
    expect(flagged.data.internal).toBe(true);
    const plain = mafwBroadcast({ type: 'turn.completed', sessionID: 's1' });
    expect('internal' in plain.data).toBe(false);
  });

  it('passes through error payloads (turn.failed error extraction contract)', () => {
    const envelope = mafwBroadcast({ type: 'turn.failed', sessionID: 's1', error: 'boom' }, true);
    expect(envelope.data).toMatchObject({ type: 'turn.failed', sessionID: 's1', error: 'boom', internal: true });
  });
});

describe('projectRegisteredEvent', () => {
  // FLAT envelope, no `data` key: the desktop renderer strips `raw.data` as
  // the mafw_event inner payload (event = raw?.data || raw), so a `data`
  // key would swallow the type. Top-level broadcasts (runtime_switched,
  // user_question) are flat by convention — this must match.
  it('builds the flat registration broadcast envelope', () => {
    expect(projectRegisteredEvent('C:\\work\\proj')).toEqual({
      type: 'project_registered',
      projectDir: 'C:\\work\\proj',
    });
  });
});

describe('flat-emit-registry（v2 发射注册表）', () => {
  it('每个 emitter 产出带 type 的扁平载荷（无 data 键）', async () => {
    const { FLAT_EMITTERS } = await import('../../../src/runtime/flat-emit-registry');
    expect(FLAT_EMITTERS.size).toBe(10);
    for (const [name, emit] of FLAT_EMITTERS) {
      const out = emit({ goalId: 'g1' });
      expect(out.type).toBe(name);
      expect('data' in out).toBe(false);
      expect(out.goalId).toBe('g1');
    }
  });
});
