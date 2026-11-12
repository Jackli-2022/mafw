import { CapabilityRegistry } from '../capability-registry';
import { log } from '../../core/utils/logger';
import type { TtsProfile, TtsEngine } from '../../tts/types';

export const DEFAULT_ENGINE = 'mimo';

/**
 * TTS 引擎注册表 —— 优先级：包 > legacy > 内置（同名覆盖）。
 * 未知名 fail-open 回退默认引擎（mimo）+ warn。
 *
 * The tier/fallback bookkeeping lives in CapabilityRegistry; this façade keeps
 * the legacy public surface so routes and loaders do not change.
 */
export class TtsEngineRegistry {
  private readonly caps = new CapabilityRegistry<TtsEngine>({
    defaultId: DEFAULT_ENGINE,
    tiers: ['builtin', 'legacy', 'package'],
    onFallback: (wanted, usedDefault) => {
      log.warn(`[TTS] unknown engine "${wanted}", falling back to ${usedDefault}`);
    },
    missingMessage: (wanted) => `no tts engine registered (want: ${wanted})`,
  });

  registerBuiltin(engine: TtsEngine): void {
    this.caps.register('builtin', { id: engine.name, value: engine });
  }

  setLegacyEngines(engines: TtsEngine[]): void {
    this.caps.replaceTier('legacy', engines.map((engine) => ({ id: engine.name, value: engine })));
  }

  setPackageEngines(engines: TtsEngine[]): void {
    this.caps.replaceTier('package', engines.map((engine) => ({ id: engine.name, value: engine })));
  }

  resolve(name?: string): TtsEngine {
    return this.caps.resolve(name);
  }

  list(): { name: string; profile: TtsProfile; source: 'builtin' | 'legacy' | 'package' }[] {
    return this.caps.list().map(({ id, value, tier }) => ({
      name: id,
      profile: value.profile,
      source: tier,
    }));
  }

  /** Additive shutdown hook; not wired into kernel.stop() in the spike. */
  async dispose(): Promise<void> {
    const diagnostics = await this.caps.dispose();
    for (const diagnostic of diagnostics) {
      log.warn(`[TTS] engine "${diagnostic.id}" dispose failed: ${diagnostic.message}`);
    }
  }
}
