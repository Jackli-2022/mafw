import type { VoiceConfig } from './config';
import { findVoiceModel } from './catalog';
import { AsrEngineRegistry } from './registry';
import { VoiceSession } from './session';
import type { AsrEngine } from './types';
import type { VoiceServerMessage } from './transport/protocol';

export interface VoiceRuntimeDeps {
  registry: AsrEngineRegistry;
  config: VoiceConfig;
  createAsr: (name: string) => Promise<AsrEngine>;
}

/**
 * Gateway-level voice facade. It owns the configured ASR engine and creates a
 * per-connection VoiceSession. P1 only uses the ASR half; P2 adds TTS/LLM.
 */
export class VoiceRuntime {
  constructor(private readonly deps: VoiceRuntimeDeps) {}

  /** Config stores catalogue model ids; engines are registered by engine id. */
  private resolveEngineName(configured: string): string {
    return findVoiceModel(configured)?.engine ?? configured;
  }

  async createSession(
    send: (msg: VoiceServerMessage) => void,
  ): Promise<VoiceSession> {
    const engineName = this.resolveEngineName(this.deps.config.asrEngine);
    let asr: AsrEngine;
    try {
      asr = this.deps.registry.resolve(engineName);
    } catch {
      asr = await this.deps.createAsr(engineName);
      this.deps.registry.register(asr);
    }
    return new VoiceSession({ asr, send });
  }

  status(): {
    config: VoiceConfig;
    engines: ReturnType<AsrEngineRegistry['list']>;
  } {
    return {
      config: this.deps.config,
      engines: this.deps.registry.list(),
    };
  }
}
