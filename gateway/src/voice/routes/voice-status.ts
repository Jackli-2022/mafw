import type { VoiceConfig } from '../config';
import { routingForConfig } from '../routing';
import type { VoiceRuntime } from '../runtime';

export interface VoiceStatusDeps {
  runtime?: VoiceRuntime;
  config: VoiceConfig;
}

/**
 * GET /api/voice/status — config + registered ASR engines + routing. The
 * sidecar may not be initialized yet, so a missing runtime is a valid 200 with
 * an empty engine list; routing is still reported from the resolved config so
 * the UI never has to guess.
 */
export async function handleVoiceStatus(
  _req: any,
  res: any,
  deps: VoiceStatusDeps,
): Promise<void> {
  const live = deps.runtime?.status();
  const engines = live?.engines ?? [];
  const routing = live?.routing ?? routingForConfig(deps.config);
  const body = JSON.stringify({ ok: true, config: deps.config, engines, routing });
  if (typeof res.writeHead === 'function') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  res.statusCode = 200;
  res.setHeader?.('Content-Type', 'application/json');
  res.end(body);
}
