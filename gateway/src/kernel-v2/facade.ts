import * as http from 'node:http';
import type { KernelDiagnostic } from './diagnostics';
import type { TtsCapability } from './providers/tts';
import type { UsageCapability } from './providers/usage';
import type { UsageProvider } from '../usage/types';

export interface KernelV2Deps {
  tts: TtsCapability;
  usage: UsageCapability;
  /** Record/replay snapshot; Phase 1 must not live-fetch usage. */
  usageSnapshot: () => Promise<UsageProvider[]>;
  diagnostics: () => KernelDiagnostic[];
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createKernelV2Server(deps: KernelV2Deps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        kernel: 'v2',
        providers: deps.diagnostics().map((item) => ({
          providerId: item.providerId,
          capability: item.capability,
          state: item.state,
        })),
      });
      return;
    }

    if (url.pathname === '/api/tts/voices') {
      try {
        const engine = deps.tts.resolve();
        sendJson(res, 200, {
          engine: engine.name,
          sampleRate: engine.profile.sampleRate,
          voices: engine.voices(),
          engines: deps.tts.list().map((item) => ({ name: item.id, source: item.tier })),
        });
      } catch (error) {
        sendJson(res, 502, { error: errorMessage(error) });
      }
      return;
    }

    if (url.pathname === '/api/usage') {
      try {
        const providers = await deps.usageSnapshot();
        sendJson(res, 200, { providers, updatedAt: 0 });
      } catch (error) {
        sendJson(res, 502, { error: errorMessage(error) });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}
