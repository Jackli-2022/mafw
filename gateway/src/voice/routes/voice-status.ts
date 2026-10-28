import type { VoiceConfig } from '../config';
import type { VoiceRuntime } from '../runtime';

export interface VoiceStatusDeps {
  runtime?: VoiceRuntime;
  config: VoiceConfig;
}

/**
 * GET /api/voice/status — config + registered ASR engines. The sidecar may not
 * be initialized yet, so a missing runtime is a valid 200 with an empty list.
 */
export async function handleVoiceStatus(
  _req: any,
  res: any,
  deps: VoiceStatusDeps,
): Promise<void> {
  const engines = deps.runtime?.status().engines ?? [];
  const body = JSON.stringify({ ok: true, config: deps.config, engines });
  if (typeof res.writeHead === 'function') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  res.statusCode = 200;
  res.setHeader?.('Content-Type', 'application/json');
  res.end(body);
}
