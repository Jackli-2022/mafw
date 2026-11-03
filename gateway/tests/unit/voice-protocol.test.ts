import { parseClientMessage, serverError } from '../../src/voice/transport/protocol';

test('parses a valid hello', () => {
  const m = parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true,
  }));
  expect(m).toMatchObject({ type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', tier: 'auto' });
});

test('hello requires both voiceSessionId and chatSessionId', () => {
  expect(parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true,
  }))).toMatchObject({ voiceSessionId: 'v1', chatSessionId: 'c1' });

  expect(() => parseClientMessage(JSON.stringify({
    type: 'hello', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', format: 'pcm16', clientVad: true,
  }))).toThrow(/voiceSessionId/);

  expect(() => parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', mode: 'continuous',
    tier: 'auto', format: 'pcm16', clientVad: true,
  }))).toThrow(/chatSessionId/);
});

test('rejects unknown type', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'nope' }))).toThrow(/invalid_voice_message/);
});

test('rejects invalid tier', () => {
  expect(() => parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', tier: 'bogus',
  }))).toThrow(/tier/);
});

test('serverError has a stable shape', () => {
  expect(serverError('hello_required', 'send hello first')).toEqual({
    type: 'error', code: 'hello_required', message: 'send hello first', recoverable: false,
  });
});
