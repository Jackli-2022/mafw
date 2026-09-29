// Thin HTTP client for the laya-nli-memory-conflict sidecar (one-sided v1
// cascade). Every failure returns null — the cascade treats null as
// "escalate to LLM judge" (fail-open). A circuit breaker stops log spam and
// per-call timeout cost when the sidecar is down: after 3 consecutive
// failures the client stops calling for `breakerCooldownMs`, then probes once
// (half-open) before restoring.
import { log } from '../core/utils/logger';

export interface LayaClientDeps {
  url: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  breakerCooldownMs?: number;
}

/** Exact question contract from Modusnsus/laya-nli-memory-conflict model card — do not reword. */
export const CONFLICT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)与已有记忆(known)是否冲突？冲突=矛盾需更新旧记忆，兼容=一致或无关',
  labels: { false: '兼容', true: '冲突' },
} as const;

export class LayaConflictClient {
  private url: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;
  private breakerCooldownMs: number;
  private consecutiveFails = 0;
  private breakerOpenUntil = 0;

  constructor(deps: LayaClientDeps) {
    this.url = deps.url.replace(/\/$/, '');
    this.timeoutMs = deps.timeoutMs ?? 2000;
    this.fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.breakerCooldownMs = deps.breakerCooldownMs ?? 5 * 60_000;
  }

  async askConflict(known: string, newInfo: string): Promise<number | null> {
    if (Date.now() < this.breakerOpenUntil) return null;
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/v1/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: { known, new: newInfo },
            questions: { conflict: CONFLICT_QUESTION },
          }),
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('laya timeout')), this.timeoutMs);
          timer.unref?.();
        }),
      ]) as Response;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const p = data?.answers?.conflict?.noul;
      if (typeof p !== 'number' || !Number.isFinite(p)) return null;
      this.consecutiveFails = 0;
      return p;
    } catch (err: any) {
      this.consecutiveFails++;
      if (this.consecutiveFails >= 3) {
        this.breakerOpenUntil = Date.now() + this.breakerCooldownMs;
        this.consecutiveFails = 0;
        log.warn(`[Laya] circuit breaker open for ${this.breakerCooldownMs / 1000}s (${err?.message || err})`);
      }
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/health`),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 1000);
          timer.unref?.();
        }),
      ]) as Response;
      return resp.ok;
    } catch {
      return false;
    }
  }
}
