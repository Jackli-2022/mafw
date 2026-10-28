import { handleVoiceStatus } from '../../src/voice/routes/voice-status';
import { DEFAULT_VOICE_CONFIG } from '../../src/voice/config';

test('status returns config and an engine list', async () => {
  const res = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b: string) { this.body = b; },
  } as any;
  await handleVoiceStatus({}, res, { config: DEFAULT_VOICE_CONFIG });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ ok: true, engines: [] });
});
