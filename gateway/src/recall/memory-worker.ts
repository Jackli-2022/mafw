// Persistent LLM execution channel for the memory pipelines. One long-lived
// gateway-internal session per worker, lazily created and reused (mirrors the
// /api/llm/compress pattern but uses the synchronous `session.prompt` so the
// caller gets the extracted text back). Failure invalidates the cached session
// so the next call re-creates it; sessions rotate periodically to keep the
// accumulated history (and its token cost) bounded.

export interface WorkerClient {
  session: {
    create(opts: { query: { directory: string } }): Promise<{ data?: { id: string } }>;
    prompt(opts: {
      path: { id: string };
      body: {
        parts: Array<{ type: string; text: string }>;
        system?: string;
        model?: { providerID: string; modelID: string };
      };
    }): Promise<any>;
    summarize(opts: {
      path: { id: string };
      body?: { providerID: string; modelID: string };
      query?: { directory?: string };
    }): Promise<any>;
    delete(opts: { path: { id: string } }): Promise<void>;
  };
}

export interface MemoryWorkerOptions {
  directory: string;
  label?: string; // log label, e.g. "mem-<session>:extract"
  promptTimeoutMs?: number; // hard ceiling per prompt (default 120s)
  /** Summarize (compact) the session after this many ms of idle time. */
  compactIdleMs?: number;
  /** Called after a session is (re)created — lets the gateway mark internal
   *  sessions so capture hooks never feed their output back as observations. */
  onSessionCreated?: (sessionId: string) => void;
}

export class MemoryWorker {
  private sessionId: string | null = null;
  private readonly label: string;
  private promptCount = 0;
  private lastPromptAt = 0;

  constructor(private client: WorkerClient, private opts: MemoryWorkerOptions) {
    this.label = opts.label ?? 'memory-worker';
  }

  /** Lazily (re)create the worker session. Persistent: no rotation — the same
   *  session is reused for every prompt; only failures / serve restarts
   *  invalidate it. Throws on failure — caller decides fallback. */
  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const created = await this.client.session.create({ query: { directory: this.opts.directory } });
    this.sessionId = created?.data?.id ?? null;
    if (!this.sessionId) throw new Error('memory worker: failed to create session');
    console.log(`[MemoryWorker] ${this.label} created session ${this.sessionId}`);
    this.opts.onSessionCreated?.(this.sessionId);
    return this.sessionId;
  }

  /**
   * Compact the session after an idle period to bound the per-prompt token cost.
   * Uses opencode's native session.summarize() so the system prefix and recent
   * context survive. Falls back to rotation (dispose + recreate) on failure.
   */
  private async maybeCompact(sessionId: string, model?: { providerID: string; modelID: string }): Promise<void> {
    const compactIdleMs = this.opts.compactIdleMs ?? 8 * 60 * 60 * 1000;
    if (compactIdleMs <= 0) return;
    if (this.promptCount === 0 || this.lastPromptAt === 0) return;
    const idleMs = Date.now() - this.lastPromptAt;
    if (idleMs < compactIdleMs) return;

    const timeoutMs = this.opts.promptTimeoutMs ?? 120_000;
    try {
      const res = await Promise.race([
        this.client.session.summarize({
          path: { id: sessionId },
          ...(model ? { body: model } : {}),
          query: { directory: this.opts.directory },
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`${this.label}: summarize timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
      const ok = res?.data ?? res;
      if (ok === true) {
        console.log(`[MemoryWorker] ${this.label} compacted session ${sessionId}`);
      } else {
        console.log(`[MemoryWorker] ${this.label} summarize returned ${ok}; session ${sessionId} kept`);
      }
    } catch (err: any) {
      // Summarize failed — rotate this worker session. A fresh session is
      // cheaper than keeping an ever-growing history.
      console.warn(`[MemoryWorker] ${this.label} summarize failed, rotating: ${err.message}`);
      await this.dispose();
      throw err; // caller sees the prompt-like failure; next prompt creates a new session
    }
  }

  /**
   * Run one extraction/reflection prompt. Returns the assistant text reply.
   * Bounded by promptTimeoutMs (default 120s) so a hung LLM call can never
   * lock the whole pipeline (the action-level guard is skip-once semantics).
   * Any failure invalidates the cached session and rethrows.
   */
  async prompt(message: string, system?: string, model?: { providerID: string; modelID: string }): Promise<string> {
    const sessionId = await this.ensureSession();
    await this.maybeCompact(sessionId, model);

    const timeoutMs = this.opts.promptTimeoutMs ?? 120_000;
    try {
      const result = await Promise.race([
        this.client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text', text: message }],
            ...(system ? { system } : {}),
            ...(model ? { model } : {}),
          },
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`${this.label}: prompt timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
          timer.unref?.(); // never keep the process alive just for the timeout
        }),
      ]);
      const data = result?.data ?? result;
      const text =
        (Array.isArray(data?.parts)
          ? data.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n')
          : '') || '';
      this.promptCount++;
      this.lastPromptAt = Date.now();
      return text;
    } catch (err) {
      this.sessionId = null;
      throw err;
    }
  }

  async dispose(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.client.session.delete({ path: { id: this.sessionId } });
      } catch {
        // ignore
      }
      this.promptCount = 0;
      this.lastPromptAt = 0;
      this.sessionId = null;
    }
  }
}
