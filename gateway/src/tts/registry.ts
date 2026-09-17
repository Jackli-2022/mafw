import { log } from '../core/utils/logger';
import type { TtsCapabilities, TtsEngine } from './types';

export const DEFAULT_ENGINE = 'mimo';

/**
 * TTS 引擎注册表 —— 优先级：包 > legacy > 内置（同名覆盖）。
 * 未知名 fail-open 回退默认引擎（mimo）+ warn。
 */
export class TtsEngineRegistry {
  private builtin = new Map<string, TtsEngine>();
  private legacy = new Map<string, TtsEngine>();
  private pkg = new Map<string, TtsEngine>();

  registerBuiltin(engine: TtsEngine): void {
    this.builtin.set(engine.name, engine);
  }

  setLegacyEngines(engines: TtsEngine[]): void {
    this.legacy = new Map(engines.map(e => [e.name, e]));
  }

  setPackageEngines(engines: TtsEngine[]): void {
    this.pkg = new Map(engines.map(e => [e.name, e]));
  }

  resolve(name?: string): TtsEngine {
    const want = name || DEFAULT_ENGINE;
    const found = this.pkg.get(want) ?? this.legacy.get(want) ?? this.builtin.get(want);
    if (found) return found;
    const fallback = this.pkg.get(DEFAULT_ENGINE) ?? this.legacy.get(DEFAULT_ENGINE) ?? this.builtin.get(DEFAULT_ENGINE);
    if (!fallback) throw new Error(`no tts engine registered (want: ${want})`);
    log.warn(`[TTS] unknown engine "${want}", falling back to ${DEFAULT_ENGINE}`);
    return fallback;
  }

  list(): { name: string; capabilities: TtsCapabilities; source: 'builtin' | 'legacy' | 'package' }[] {
    const merged = new Map<string, { engine: TtsEngine; source: 'builtin' | 'legacy' | 'package' }>();
    for (const [n, e] of this.builtin) merged.set(n, { engine: e, source: 'builtin' });
    for (const [n, e] of this.legacy) merged.set(n, { engine: e, source: 'legacy' });
    for (const [n, e] of this.pkg) merged.set(n, { engine: e, source: 'package' });
    return [...merged.values()].map(({ engine, source }) => ({
      name: engine.name, capabilities: engine.capabilities, source,
    }));
  }
}
