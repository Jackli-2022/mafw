/**
 * T2-4: prompt-time sync of MAFW instruction blocks into opencode 2.1
 * per-session instruction entries.
 *
 * The service owns change detection (content compare), the 250ms whole-sync
 * budget, single-flight per session, and a 60s breaker for the experimental
 * API. It never blocks a prompt: every failure returns `managed:false` and the
 * caller's prompt proceeds; the plugin/pi fallback covers the model.
 */
import { InstructionBlocks, INSTRUCTION_KEYS } from '../../recall/instruction-blocks';
import type { AgentRuntime } from '../../runtime/contract';

export interface InstructionSyncDeps {
  render(signal?: AbortSignal): Promise<InstructionBlocks>;
  getRuntime(): AgentRuntime | null;
  isEnabled(): boolean;
  now?: () => number;
  log?: { info(msg: string): void; warn(msg: string): void };
  syncTimeoutMs?: number;
  disabledCooldownMs?: number;
  maxBlockBytes?: number;
  /** Session-cache cap (default 1000). */
  maxSessions?: number;
}

export interface InstructionSyncResult {
  managed: boolean;
  revision?: string;
  error?: string;
}

export type InstructionInspectReason =
  | 'capability_absent'
  | 'disabled'
  | 'list_failed'
  | 'breaker';

export interface InstructionInspectResult {
  managed: boolean;
  missing: string[];
  staleKeys: string[];
  reason?: InstructionInspectReason;
}

interface DesiredBlock {
  key: string;
  value: string | null;
  error?: string;
}

const ALL_KEYS = [
  INSTRUCTION_KEYS.memoryGuide,
  INSTRUCTION_KEYS.userProfile,
  INSTRUCTION_KEYS.agentPriors,
] as const;

const INSPECT_TIMEOUT_MS = 150;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 1000;

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value == null) return null;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Race a promise against an AbortSignal; HTTP implementations also get the signal. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('timeout'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

export class InstructionSyncService {
  private readonly syncTimeoutMs: number;
  private readonly disabledCooldownMs: number;
  private readonly maxBlockBytes: number;
  private readonly maxSessions: number;
  private readonly log: { info(msg: string): void; warn(msg: string): void };
  private readonly now: () => number;

  /** sessionID -> key -> exact value last known to be stored. */
  private readonly cache = new Map<string, Map<string, string>>();
  private readonly cacheAt = new Map<string, number>();
  private readonly seeded = new Set<string>();
  private readonly singleFlight = new Map<string, Promise<InstructionSyncResult>>();
  private breakerUntil = 0;
  private breakerReason?: string;
  private lastError?: string;

  constructor(private readonly deps: InstructionSyncDeps) {
    this.syncTimeoutMs = deps.syncTimeoutMs ?? 250;
    this.disabledCooldownMs = deps.disabledCooldownMs ?? 60_000;
    this.maxBlockBytes = deps.maxBlockBytes ?? 16 * 1024;
    this.maxSessions = deps.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.log = deps.log ?? { info: () => {}, warn: () => {} };
    this.now = deps.now ?? (() => Date.now());
  }

  async sync(sessionID: string): Promise<InstructionSyncResult> {
    if (!sessionID) return { managed: false, error: 'no_session' };

    if (!this.deps.isEnabled()) {
      await this.removeAll(sessionID);
      return { managed: false, error: 'disabled' };
    }

    const rt = this.deps.getRuntime();
    if (!this.canManage(rt)) return { managed: false, error: 'capability_absent' };
    const dialect = (rt as { activeDialect?: string }).activeDialect;
    if (dialect && dialect !== 'v21') return { managed: false, error: 'capability_absent' };

    if (this.now() < this.breakerUntil) {
      return { managed: false, error: this.breakerReason ?? 'breaker' };
    }

    this.prune(sessionID);
    const existing = this.singleFlight.get(sessionID);
    if (existing) return existing;

    let promise: Promise<InstructionSyncResult>;
    promise = this.runSync(sessionID, rt).finally(() => {
      if (this.singleFlight.get(sessionID) === promise) this.singleFlight.delete(sessionID);
    });
    this.singleFlight.set(sessionID, promise);
    return promise;
  }

  async inspect(sessionID: string, blocks: InstructionBlocks): Promise<InstructionInspectResult> {
    if (!this.deps.isEnabled()) return this.allMissing('disabled');

    const rt = this.deps.getRuntime();
    if (!this.canManage(rt)) return this.allMissing('capability_absent');
    const dialect = (rt as { activeDialect?: string }).activeDialect;
    if (dialect && dialect !== 'v21') return this.allMissing('capability_absent');
    if (this.now() < this.breakerUntil) return this.allMissing('breaker');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSPECT_TIMEOUT_MS);
    try {
      const list = await raceAbort(
        this.instructionsOf(rt).list(sessionID, { signal: controller.signal }),
        controller.signal,
      );
      const stored = new Map<string, string | null>();
      for (const entry of list ?? []) {
        if (!entry || typeof entry.key !== 'string') continue;
        stored.set(entry.key, asString(entry.value));
      }

      const missing: string[] = [];
      const staleKeys: string[] = [];
      for (const desired of this.desired(blocks)) {
        if (desired.error) continue; // unknown value: neither missing nor stale
        const current = stored.get(desired.key);
        if (desired.value === null) {
          if (current !== undefined) staleKeys.push(desired.key);
          continue;
        }
        if (current === undefined || current === null) {
          missing.push(desired.key);
        } else if (current !== this.cap(desired.value, false)) {
          staleKeys.push(desired.key);
        }
      }
      return { managed: missing.length === 0, missing, staleKeys };
    } catch {
      return this.allMissing('list_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  forget(sessionID: string): void {
    this.cache.delete(sessionID);
    this.cacheAt.delete(sessionID);
    this.seeded.delete(sessionID);
    this.singleFlight.delete(sessionID);
  }

  reset(): void {
    this.breakerUntil = 0;
    this.breakerReason = undefined;
    this.lastError = undefined;
    this.cache.clear();
    this.cacheAt.clear();
    this.seeded.clear();
  }

  diagnostics(): { disabledUntil?: number; disabledReason?: string; lastError?: string } {
    return {
      ...(this.breakerUntil > this.now() ? { disabledUntil: this.breakerUntil } : {}),
      ...(this.breakerReason ? { disabledReason: this.breakerReason } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private async runSync(sessionID: string, rt: AgentRuntime): Promise<InstructionSyncResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.syncTimeoutMs);
    const api = this.instructionsOf(rt);
    try {
      const blocks = await raceAbort(this.deps.render(controller.signal), controller.signal);
      const desired = this.desired(blocks);

      let store: Map<string, string>;
      if (!this.seeded.has(sessionID)) {
        const list = await raceAbort(api.list(sessionID, { signal: controller.signal }), controller.signal);
        store = new Map();
        for (const entry of list ?? []) {
          if (!entry || typeof entry.key !== 'string') continue;
          const value = asString(entry.value);
          if (value !== null) store.set(entry.key, value);
        }
      } else {
        store = new Map(this.cache.get(sessionID) ?? []);
      }

      for (const desiredBlock of desired) {
        if (desiredBlock.error) continue; // keep the previous entry
        const current = store.get(desiredBlock.key);
        if (desiredBlock.value === null) {
          if (current !== undefined) {
            await raceAbort(
              api.remove(sessionID, desiredBlock.key, { signal: controller.signal }),
              controller.signal,
            );
            store.delete(desiredBlock.key);
          }
          continue;
        }
        const value = this.cap(desiredBlock.value, true);
        if (current === value) continue;
        await raceAbort(
          api.put(sessionID, desiredBlock.key, value, { signal: controller.signal }),
          controller.signal,
        );
        store.set(desiredBlock.key, value);
      }

      if (controller.signal.aborted) return { managed: false, error: 'timeout' };
      this.cache.set(sessionID, store);
      this.cacheAt.set(sessionID, this.now());
      this.seeded.add(sessionID);
      this.enforceCacheCap(sessionID);
      this.breakerUntil = 0;
      this.breakerReason = undefined;
      this.lastError = undefined;
      return { managed: true, revision: blocks.revision };
    } catch (err: any) {
      const aborted = controller.signal.aborted;
      const message = aborted ? 'timeout' : messageOf(err);
      this.lastError = message;
      const status = Number(err?.status);
      if (!aborted && (status === 404 || status === 405)) {
        this.breakerUntil = this.now() + this.disabledCooldownMs;
        this.breakerReason = `HTTP ${status}`;
        this.log.warn(`[Instructions] breaker open for ${this.disabledCooldownMs}ms: HTTP ${status}`);
      }
      return { managed: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  private prune(sessionID: string): void {
    const at = this.cacheAt.get(sessionID);
    if (at !== undefined && this.now() - at > CACHE_TTL_MS) {
      this.cache.delete(sessionID);
      this.cacheAt.delete(sessionID);
      this.seeded.delete(sessionID);
    }
  }

  private enforceCacheCap(keep: string): void {
    while (this.cache.size > this.maxSessions) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      if (oldest === keep && this.cache.size === 1) break;
      this.cache.delete(oldest);
      this.cacheAt.delete(oldest);
      this.seeded.delete(oldest);
    }
  }

  private async removeAll(sessionID: string): Promise<void> {
    const rt = this.deps.getRuntime();
    if (!this.canManage(rt)) return;
    const api = this.instructionsOf(rt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.syncTimeoutMs);
    try {
      for (const key of ALL_KEYS) {
        try {
          await raceAbort(api.remove(sessionID, key, { signal: controller.signal }), controller.signal);
        } catch { /* best-effort */ }
      }
    } finally {
      clearTimeout(timer);
      this.cache.delete(sessionID);
      this.seeded.delete(sessionID);
    }
  }

  private desired(blocks: InstructionBlocks): DesiredBlock[] {
    return [
      { key: INSTRUCTION_KEYS.memoryGuide, value: blocks.memoryGuide?.trim() ? blocks.memoryGuide : null },
      { key: INSTRUCTION_KEYS.userProfile, value: blocks.userProfile, error: blocks.errors?.userProfile },
      { key: INSTRUCTION_KEYS.agentPriors, value: blocks.agentPriors, error: blocks.errors?.agentPriors },
    ];
  }

  private cap(value: string, warn: boolean): string {
    if (Buffer.byteLength(value, 'utf8') <= this.maxBlockBytes) return value;
    let out = value;
    while (Buffer.byteLength(out, 'utf8') > this.maxBlockBytes) out = out.slice(0, -1);
    if (warn) this.log.warn(`[Instructions] block truncated to ${this.maxBlockBytes} bytes`);
    return out;
  }

  private allMissing(reason: InstructionInspectReason): InstructionInspectResult {
    return { managed: false, missing: [...ALL_KEYS], staleKeys: [], reason };
  }

  private canManage(rt: AgentRuntime | null): rt is AgentRuntime {
    return !!rt?.capabilities?.instructionsApi && !!(rt as any).session?.instructions;
  }

  private instructionsOf(rt: AgentRuntime): NonNullable<AgentRuntime['session']['instructions']> {
    const api = (rt as any).session?.instructions;
    if (!api) throw new Error('instruction entries API not available');
    return api;
  }
}
