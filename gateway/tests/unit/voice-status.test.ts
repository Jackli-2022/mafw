import { handleVoiceStatus } from '../../src/voice/routes/voice-status';
import { DEFAULT_VOICE_CONFIG } from '../../src/voice/config';

function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b: string) { this.body = b; },
  } as any;
}

test('status returns config and an engine list', async () => {
  const res = fakeRes();
  await handleVoiceStatus({}, res, { config: DEFAULT_VOICE_CONFIG });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({
    ok: true,
    engines: [],
    routing: { status: 'local_accelerated' },
  });
});

test('status reports routing from config when the lazy runtime is absent', async () => {
  const res = fakeRes();
  await handleVoiceStatus({}, res, { config: { ...DEFAULT_VOICE_CONFIG, localTier: 'igpu' } });
  expect(JSON.parse(res.body).routing).toEqual({ status: 'local_cpu' });
});

test('status prefers the live runtime routing over the config projection', async () => {
  const res = fakeRes();
  const runtime = {
    status: () => ({
      config: DEFAULT_VOICE_CONFIG,
      engines: [{ name: 'qwen3-asr-vllm' }],
      routing: { status: 'local_cpu' },
    }),
  } as any;
  await handleVoiceStatus({}, res, { runtime, config: DEFAULT_VOICE_CONFIG });
  const body = JSON.parse(res.body);
  expect(body.routing).toEqual({ status: 'local_cpu' });
  expect(body.engines).toHaveLength(1);
});

test('status exposes the duplex flag through config', async () => {
  const res = fakeRes();
  await handleVoiceStatus({}, res, { config: DEFAULT_VOICE_CONFIG });
  expect(JSON.parse(res.body).config.duplexV1).toBe(false);
});
