import { createHash } from 'crypto';
import type { PromptFn, PromptPart, PromptOptions } from './media-service';
import type { AgentRuntime } from '../runtime/contract';
import { fixMediaPayload } from './pi-adapter';
import { DEFAULT_AUTH_PATH } from './auth-util';
import { log } from '../core/utils/logger';

export interface MediaRuntimeExecutorOptions {
  /** 会话 TTL（默认 24h） */
  sessionTtlMs?: number;
  /** 单次分析超时（默认 180s） */
  timeoutMs?: number;
  /** video/audio 单次路径（默认内部 complete 实现） */
  completeFn?: (parts: PromptPart[], opts: PromptOptions) => Promise<string>;
  /** auth.json 路径（默认 DEFAULT_AUTH_PATH） */
  authPath?: string;
}

interface SessionEntry {
  sessionID: string;
  kind: string;
  dataUrl: string;
  providerID: string;
  modelID: string;
  createdAt: number;
}

export function mediaSessionKey(dataUrl: string, providerID: string, modelID: string): string {
  return createHash('sha256').update(dataUrl).update('\x00').update(providerID).update('\x00').update(modelID).digest('hex').slice(0, 16);
}

export class MediaRuntimeExecutor {
  private sessions = new Map<string, SessionEntry>();
  private inflight = new Set<string>();
  private readonly ttlMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly rt: AgentRuntime,
    private readonly opts: MediaRuntimeExecutorOptions = {},
    private readonly completeFn: (parts: PromptPart[], opts: PromptOptions) => Promise<string>,
  ) {
    this.ttlMs = opts.sessionTtlMs ?? 24 * 60 * 60 * 1000;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
  }

  /** PromptFn 实现——MediaService 注入点。 */
  prompt: PromptFn = async (parts, opts) => {
    const filePart = parts.find((p) => p.type === 'file');
    const textPart = parts.find((p) => p.type === 'text');
    const kind = this.kindOf(filePart);

    // 无媒体 part（追问轮）：复用最近使用的 image 会话（同 provider/model）
    if (!filePart) {
      const entry = this.latestFor(opts.providerID, opts.modelID);
      if (entry) {
        return this.analyzeInSession(entry, textPart ? String(textPart.text ?? '') : '请描述这个媒体内容。');
      }
      return this.withTimeout('media analysis', () => this.completeFn(parts, opts));
    }

    // video/audio：单次 complete 路径（fixMediaPayload wire 重写，已验证）
    if (kind !== 'image') {
      return this.withTimeout('media analysis', () => this.completeFn(parts, opts));
    }

    const dataUrl = String(filePart.url ?? '');
    const key = mediaSessionKey(dataUrl, opts.providerID, opts.modelID);
    this.gc();
    let entry = this.sessions.get(key);
    this.inflight.add(key);
    try {
      if (!entry) {
        const { id } = await this.rt.session.create({ directory: undefined });
        entry = { sessionID: id, kind, dataUrl, providerID: opts.providerID, modelID: opts.modelID, createdAt: Date.now() };
        this.sessions.set(key, entry);
        await this.rt.session.promptAsync({
          sessionID: id,
          parts: [
            { type: 'file', url: dataUrl, mime: filePart.mime, text: '' },
            ...(textPart ? [{ type: 'text', text: String(textPart.text ?? '') }] : []),
          ] as any,
        });
      } else {
        const text = textPart ? String(textPart.text ?? '') : '请描述这个媒体内容。';
        await this.rt.session.promptAsync({ sessionID: entry.sessionID, message: text });
      }
      const result = await this.fetchLatestAssistant(entry.sessionID);
      return result;
    } catch (err: any) {
      if (entry) await this.cancel(key);
      log.error(`[MediaRuntimeExecutor] analysis failed: ${err?.message ?? String(err)}`);
      throw err;
    } finally {
      this.inflight.delete(key);
    }
  };

  /** 在同一会话内发消息并取最新 assistant 输出。 */
  private async analyzeInSession(entry: SessionEntry, text: string): Promise<string> {
    const key = `inflight:${entry.sessionID}`;
    this.inflight.add(key);
    try {
      await this.rt.session.promptAsync({ sessionID: entry.sessionID, message: text });
      return await this.fetchLatestAssistant(entry.sessionID);
    } catch (err: any) {
      await this.cancelBySession(entry.sessionID);
      throw err;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async fetchLatestAssistant(sessionID: string): Promise<string> {
    return this.withTimeout('fetch latest assistant message', async () => {
      const { data } = await this.rt.session.messages({ sessionID });
      const latest = [...data].reverse().find((m: any) => m?.role === 'assistant');
      const text = (latest?.content || []).map((c: any) => c?.text ?? '').join('\n').trim();
      return text || '（无文本输出）';
    });
  }

  /** 同 provider/model 下最近使用的会话（追问轮复用）。 */
  private latestFor(providerID: string, modelID: string): SessionEntry | undefined {
    let latest: SessionEntry | undefined;
    for (const entry of this.sessions.values()) {
      if (entry.providerID !== providerID || entry.modelID !== modelID) continue;
      if (!latest || entry.createdAt > latest.createdAt) latest = entry;
    }
    return latest;
  }

  /** 中止指定媒体会话。 */
  async cancel(key: string): Promise<void> {
    const entry = this.sessions.get(key);
    if (entry) await this.cancelBySession(entry.sessionID);
  }

  private async cancelBySession(sessionID: string): Promise<void> {
    try { await this.rt.session.abort({ sessionID }); } catch { /* ignore */ }
  }

  /** A2A cancelTask 调用：中止所有进行中会话。 */
  async cancelInflight(): Promise<void> {
    for (const key of this.inflight) await this.cancel(key);
    this.inflight.clear();
  }

  async dispose(): Promise<void> {
    for (const entry of this.sessions.values()) {
      try { await this.rt.session.delete({ sessionID: entry.sessionID }); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.inflight.clear();
  }

  private kindOf(filePart?: PromptPart): string {
    if (!filePart) return 'text';
    const mime = String(filePart.mime ?? filePart.url ?? '');
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'image';
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now - entry.createdAt > this.ttlMs) {
        this.sessions.delete(key);
        try { void this.rt.session.delete({ sessionID: entry.sessionID }); } catch { /* ignore */ }
      }
    }
  }

  private async withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createMediaRuntimeExecutor(
  rt: AgentRuntime,
  opts: MediaRuntimeExecutorOptions = {},
): MediaRuntimeExecutor {
  const authPath = opts.authPath ?? DEFAULT_AUTH_PATH();
  const completeFn = opts.completeFn ?? (async (parts: PromptPart[], po: PromptOptions) => {
    const { createPiPromptAdapter } = await import('./pi-adapter.js');
    const adapter = createPiPromptAdapter({ fixPayload: fixMediaPayload, authPath });
    return adapter(parts, po);
  });
  return new MediaRuntimeExecutor(rt, opts, completeFn);
}