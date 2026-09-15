// Wire-contract tests for the Mode A SSE broadcast envelope builders used by
// MafwScheduler. The desktop renderer / TUI parse `data` — shape changes here
// are breaking changes for every SSE consumer.
import { opencodeBroadcast, projectRegisteredEvent } from '../../../src/runtime/event-broadcast';

describe('opencodeBroadcast', () => {
  it('wraps a passthrough event without internal flag', () => {
    const envelope = opencodeBroadcast({
      type: 'session.updated',
      properties: { sessionID: 's1', info: { id: 's1' } },
      sessionID: 's1',
    });
    expect(envelope).toEqual({
      type: 'opencode_event',
      data: {
        type: 'session.updated',
        properties: { sessionID: 's1', info: { id: 's1' } },
        sessionID: 's1',
      },
    });
    expect('internal' in envelope.data).toBe(false);
  });

  it('carries directory when provided (event-driven consumers locate the project)', () => {
    const envelope = opencodeBroadcast({
      type: 'session.created',
      properties: { sessionID: 's1' },
      sessionID: 's1',
      directory: 'C:\\proj',
    });
    expect(envelope.data.directory).toBe('C:\\proj');
  });

  it('omits directory key when absent (keeps the wire shape stable)', () => {
    const envelope = opencodeBroadcast({ type: 'session.updated', properties: {}, sessionID: 's1' });
    expect('directory' in envelope.data).toBe(false);
  });

  it('sets internal only when flagged', () => {
    const flagged = opencodeBroadcast({ type: 'message.complete', sessionID: 's1' }, true);
    expect(flagged.data.internal).toBe(true);
    const plain = opencodeBroadcast({ type: 'message.complete', sessionID: 's1' });
    expect('internal' in plain.data).toBe(false);
  });

  it('passes through error payloads', () => {
    const envelope = opencodeBroadcast({ type: 'message.error', sessionID: 's1', error: 'boom' }, true);
    expect(envelope.data).toMatchObject({ type: 'message.error', sessionID: 's1', error: 'boom', internal: true });
  });
});

describe('projectRegisteredEvent', () => {
  // FLAT envelope, no `data` key: the desktop renderer strips `raw.data` as
  // the opencode_event inner payload (event = raw?.data || raw), so a `data`
  // key would swallow the type. Top-level broadcasts (runtime_switched,
  // user_question) are flat by convention — this must match.
  it('builds the flat registration broadcast envelope', () => {
    expect(projectRegisteredEvent('C:\\work\\proj')).toEqual({
      type: 'project_registered',
      projectDir: 'C:\\work\\proj',
    });
  });
});
