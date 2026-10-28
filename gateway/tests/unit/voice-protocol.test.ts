import { parseClientMessage, serverError } from '../../src/voice/transport/protocol';

test('parses a valid hello', () => {
  const m = parseClientMessage(JSON.stringify({
    type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto',
    language: 'zh', format: 'pcm16', clientVad: true,
  }));
  expect(m).toMatchObject({ type: 'hello', sessionId: 's1', tier: 'auto' });
});

test('rejects missing sessionId', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'hello', mode: 'continuous' })))
    .toThrow(/sessionId/);
});

test('rejects unknown type', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'nope' }))).toThrow(/invalid_voice_message/);
});

test('rejects invalid tier', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'hello', sessionId: 's1', tier: 'bogus' })))
    .toThrow(/tier/);
});

test('serverError has a stable shape', () => {
  expect(serverError('hello_required', 'send hello first')).toEqual({
    type: 'error', code: 'hello_required', message: 'send hello first', recoverable: false,
  });
});
