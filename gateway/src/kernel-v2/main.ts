/**
 * Isolated kernel-v2 entrypoint for Phase 1 shadow compare.
 *
 * Required env:
 *   MAFW_KERNEL_V2_PORT      TCP port (1-65535)
 *   MAFW_KERNEL_V2_DATA_DIR  absolute data-copy directory
 *
 * Missing/invalid env → exit 2. Never falls back to ~/.mafw.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { CapabilityRegistry } from './capability-registry';
import { createKernelV2Server } from './facade';
import { createTtsCapability } from './providers/tts';
import { createUsageCapability } from './providers/usage';
import { TTS_VOICES } from '../media/tts-service';
import type { ExternalAdapter, UsageProvider } from '../usage/types';
import type { TtsEngine } from '../tts/types';

export interface KernelV2Config {
  port: number;
  dataDir: string;
}

export function readKernelV2Config(env: NodeJS.ProcessEnv = process.env): KernelV2Config {
  const port = Number(env.MAFW_KERNEL_V2_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MAFW_KERNEL_V2_PORT is required and must be a valid TCP port');
  }
  const dataDir = env.MAFW_KERNEL_V2_DATA_DIR;
  if (!dataDir || !path.isAbsolute(dataDir)) {
    throw new Error('MAFW_KERNEL_V2_DATA_DIR is required and must be an absolute path');
  }
  return { port, dataDir };
}

function shadowTtsEngine(): TtsEngine {
  return {
    name: 'mimo',
    profile: {
      streaming: 'native',
      voiceCloning: true,
      styleControl: true,
      languages: ['zh', 'en'],
      sampleRate: 24000,
    },
    voices: () => TTS_VOICES,
    async *synthesizeStream(): AsyncIterable<never> {
      throw new Error('kernel-v2 shadow: synthesis is not wired');
    },
    async synthesize(): Promise<Buffer> {
      throw new Error('kernel-v2 shadow: synthesis is not wired');
    },
  };
}

export function createShadowDeps(dataDir: string): {
  tts: ReturnType<typeof createTtsCapability>;
  usage: ReturnType<typeof createUsageCapability>;
  usageSnapshot: () => Promise<UsageProvider[]>;
  diagnostics: () => ReturnType<CapabilityRegistry<TtsEngine>['diagnostics']>;
} {
  const ttsRegistry = new CapabilityRegistry<TtsEngine>({
    defaultId: 'mimo',
    capability: 'tts',
    version: '1.0.0',
    revision: 'shadow',
    plane: 'gateway',
  });
  ttsRegistry.register('builtin', { id: 'mimo', value: shadowTtsEngine() });

  const usageRegistry = new CapabilityRegistry<ExternalAdapter>({
    defaultId: 'fixture',
    capability: 'usage',
    version: '1.0.0',
    revision: 'shadow',
    plane: 'gateway',
  });

  return {
    tts: createTtsCapability(ttsRegistry),
    usage: createUsageCapability(usageRegistry),
    usageSnapshot: async () => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'usage.json'), 'utf8')) as {
          providers?: UsageProvider[];
        };
        return Array.isArray(raw.providers) ? raw.providers : [];
      } catch {
        return [];
      }
    },
    diagnostics: () => [...ttsRegistry.diagnostics(), ...usageRegistry.diagnostics()],
  };
}

export function startKernelV2(config: KernelV2Config): http.Server {
  const deps = createShadowDeps(config.dataDir);
  const server = createKernelV2Server(deps);
  server.listen(config.port, '127.0.0.1');
  return server;
}

if (require.main === module) {
  try {
    const config = readKernelV2Config();
    const server = startKernelV2(config);
    server.on('listening', () => {
      process.stdout.write(`kernel-v2 listening on 127.0.0.1:${config.port}\n`);
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
