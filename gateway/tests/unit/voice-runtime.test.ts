import { VoiceRuntime } from '../../src/voice/runtime';
import { AsrEngineRegistry } from '../../src/voice/registry';
import { DEFAULT_VOICE_CONFIG } from '../../src/voice/config';

test('maps a catalogue model id to its engine id', async () => {
  const registry = new AsrEngineRegistry();
  const engine = {
    name: 'qwen3-asr-vllm',
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push:()=>{}, abort:()=>{}, onPartial:()=>{}, end:async()=>({text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true}) }),
    transcribe: async () => ({ text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true }),
  } as any;
  registry.register(engine);
  const createAsr = jest.fn(async () => engine);
  const rt = new VoiceRuntime({
    registry,
    config: { ...DEFAULT_VOICE_CONFIG, asrEngine: 'qwen3-asr-1.7b-vllm' },
    createAsr,
  });
  await rt.createSession(() => {});
  expect(createAsr).not.toHaveBeenCalled();
});

test('createSession resolves the configured ASR engine', async () => {
  const registry = new AsrEngineRegistry();
  const engine = {
    name: 'qwen3-asr-vllm',
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push:()=>{}, abort:()=>{}, onPartial:()=>{}, end:async()=>({text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true}) }),
    transcribe: async () => ({ text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true }),
  } as any;
  registry.register(engine);
  const rt = new VoiceRuntime({
    registry,
    config: { ...DEFAULT_VOICE_CONFIG, asrEngine: 'qwen3-asr-vllm' },
    createAsr: async () => engine,
  });
  const session = await rt.createSession(() => {});
  expect(session).toBeDefined();
  expect(rt.status().engines[0].name).toBe('qwen3-asr-vllm');
});

test('status and ready report routing projected from the configured local tier', async () => {
  const registry = new AsrEngineRegistry();
  const engine = {
    name: 'qwen3-asr-vllm',
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push:()=>{}, abort:()=>{}, onPartial:()=>{}, end:async()=>({text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true}) }),
    transcribe: async () => ({ text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true }),
  } as any;
  registry.register(engine);
  const rt = new VoiceRuntime({
    registry,
    config: { ...DEFAULT_VOICE_CONFIG, localTier: 'igpu' },
    createAsr: async () => engine,
  });
  const sent: any[] = [];
  const session = await rt.createSession(m => sent.push(m));
  await session.handleControl({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true,
  });
  expect(rt.status().routing).toEqual({ status: 'local_cpu' });
  expect(sent[0]).toMatchObject({ type: 'ready', routing: { status: 'local_cpu' } });
});

test('dgpu config reports accelerated local routing', () => {
  const rt = new VoiceRuntime({
    registry: new AsrEngineRegistry(),
    config: { ...DEFAULT_VOICE_CONFIG, localTier: 'dgpu' },
    createAsr: async () => { throw new Error('unused'); },
  });
  expect(rt.status().routing).toEqual({ status: 'local_accelerated' });
});
