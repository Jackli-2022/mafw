import { assertAsrCapabilities, type AsrCapabilities, type AsrEngine } from './types';

export const DEFAULT_ASR_ENGINE = 'qwen3-asr-vllm';

export interface AsrEngineListEntry {
  name: string;
  capabilities: AsrCapabilities;
  source: 'builtin' | 'plugin';
}

/**
 * Registry for ASR adapters. Built-in engines register at gateway init; package
 * plugins can use the same `register` seam later without changing consumers.
 */
export class AsrEngineRegistry {
  private engines = new Map<string, AsrEngine>();

  register(engine: AsrEngine): void {
    assertAsrCapabilities(engine.capabilities);
    this.engines.set(engine.name, engine);
  }

  resolve(name?: string): AsrEngine {
    const wanted = name || DEFAULT_ASR_ENGINE;
    const engine = this.engines.get(wanted);
    if (!engine) throw new Error(`unknown ASR engine: ${wanted}`);
    return engine;
  }

  list(): AsrEngineListEntry[] {
    return [...this.engines.values()].map((engine) => ({
      name: engine.name,
      capabilities: engine.capabilities,
      source: 'builtin',
    }));
  }
}
