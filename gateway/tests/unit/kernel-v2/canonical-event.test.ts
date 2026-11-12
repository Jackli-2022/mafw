import { toCanonicalEvent } from '../../../src/kernel-v2/canonical-event';

test('copies only the canonical snapshot fields and drops secrets', () => {
  const event = toCanonicalEvent(
    {
      type: 'tool.updated',
      sessionID: 's1',
      directory: 'C:/p',
      properties: { tool: 'x', prompt: 'secret', apiToken: 'sk', projectId: 'p1' },
    },
    123,
  );
  expect(event).toEqual({
    type: 'tool.updated',
    sessionID: 's1',
    projectId: 'p1',
    at: 123,
    properties: { tool: 'x', projectId: 'p1' },
  });
});

test('filters nested secrets, caps depth and truncates long strings', () => {
  const event = toCanonicalEvent(
    {
      type: 'message.updated',
      properties: {
        nested: { token: 'hidden', ok: 'visible' },
        long: 'x'.repeat(5_000),
        deep: { a: { b: { c: { d: { e: 'too deep' } } } } },
      },
    },
    1,
  );
  expect(event.properties).toEqual({
    nested: { ok: 'visible' },
    long: `${'x'.repeat(2_000)}…`,
    deep: { a: { b: {} } },
  });
});
