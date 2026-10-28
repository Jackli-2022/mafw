import { VoiceSession } from '../../src/voice/session';

function fakeAsr() {
  const sent: any[] = [];
  let partialCb: ((t: string) => void) | undefined;
  let aborted = false;
  const engine = {
    name: 'fake', capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({
      push: () => {},
      abort: () => { aborted = true; },
      onPartial: (cb: any) => { partialCb = cb; },
      end: async () => ({ text: '你好。', language: 'zh', durationMs: 40, engine: 'fake', final: true }),
    }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: 'fake', final: true }),
  } as any;
  return { engine, sent, emitPartial: (t: string) => partialCb?.(t), wasAborted: () => aborted };
}

test('hello -> partial -> final -> turn.done', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  f.emitPartial('你');
  s.handleAudio(Buffer.alloc(320));
  await s.handleControl({ type: 'end_audio' });
  const types = f.sent.map(m => m.type);
  expect(types).toEqual(['ready', 'asr.partial', 'asr.final', 'turn.done']);
  expect(f.sent[2]).toMatchObject({ text: '你好。', final: true });
});

test('cancel aborts the stream and suppresses a late final', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  await s.handleControl({ type: 'cancel' });
  expect(f.wasAborted()).toBe(true);
  expect(f.sent.some(m => m.type === 'turn.cancelled')).toBe(true);
  expect(f.sent.some(m => m.type === 'asr.final')).toBe(false);
});

test('binary before hello is rejected', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  s.handleAudio(Buffer.alloc(320));
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'hello_required' });
});

test('unsupported language is rejected before ASR call', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'en', format: 'pcm16', clientVad: true });
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'language_unsupported' });
});

test('end_audio with no audio returns empty_audio', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  await s.handleControl({ type: 'end_audio' });
  expect(f.sent.some(m => m.code === 'empty_audio')).toBe(true);
});

test('cancel during processing suppresses the late final', async () => {
  const f = fakeAsr();
  const resolvers: Array<(r: any) => void> = [];
  f.engine.createStream = () => ({
    push: () => {},
    abort: () => {},
    onPartial: () => {},
    end: () => new Promise((resolve) => { resolvers.push(resolve); }),
  });
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  s.handleAudio(Buffer.alloc(320));
  const pending = s.handleControl({ type: 'end_audio' });
  await s.handleControl({ type: 'cancel' });
  resolvers[0]({ text: 'late', durationMs: 1, engine: 'fake', final: true });
  await pending;
  expect(f.sent.some(m => m.type === 'asr.final')).toBe(false);
  expect(f.sent.some(m => m.type === 'turn.cancelled')).toBe(true);
});
