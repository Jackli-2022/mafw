/**
 * claude runtime —— AgentRuntime 最小实现（SDK 注入 seam，零 gateway 依赖）。
 *
 * 架构（spec §3.3 claude 节）：
 *  - session 注册表 Map<sid, {busy, queue, controller?}>（PiSessionRegistry 同款语义）
 *  - 进程内事件总线（PiEventStream 同款 fan-out）：promptAsync spawn query，
 *    SDKMessage 流逐条 push（附 session_id）——方言翻译在 loader wrap 层生效
 *  - busy 排队：query 进行中的 promptAsync 入队，result/失败后 flush 队首
 *  - spawn 失败 → push turn.failed（显式错误文本，不炸 gateway）
 *  - tools.registerTools：factory stash；prompt 时经 options.mcpServers 透传
 *    （入口 index.ts 决定具体承载形态——SDK in-process MCP server）
 */
import { translateClaudeEvent } from './events.ts';
import { normalizeClaudeHistory } from './history.ts';

export interface ClaudeQueryLike extends AsyncIterable<any> {
  interrupt(): void;
}
export interface ClaudeSdk {
  query(args: { prompt: string; options?: any }): Promise<ClaudeQueryLike> | ClaudeQueryLike;
  listSessions(): Promise<any[]>;
  getSessionMessages(sessionId: string): Promise<any[]>;
}
export interface ClaudeRuntimeDeps {
  sdk: ClaudeSdk;
  gatewayPort?: number;
  now?: () => number;
}

interface SessionState {
  directory: string;
  busy: boolean;
  queue: Array<{ parts: any[]; message?: string }>;
  controller: { interrupt(): void } | null;
  firstPrompt: boolean;
}

let seq = 0;
function newSessionId(): string {
  seq++;
  return `cls_${Date.now().toString(36)}_${seq}`;
}

export function createClaudeRuntime(deps: ClaudeRuntimeDeps): any {
  const { sdk } = deps;
  const sessions = new Map<string, SessionState>();

  // ---- 事件总线（PiEventStream 同款） ----
  const listeners = new Set<(evt: any) => void>();
  const bus = {
    push(event: any): void {
      for (const l of listeners) l(event);
    },
    async event() {
      const queue: any[] = [];
      const waiters: Array<(v: any) => void> = [];
      const listener = (evt: any) => {
        const w = waiters.shift();
        if (w) w(evt); else queue.push(evt);
      };
      listeners.add(listener);
      const stream = {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (queue.length) return { value: queue.shift(), done: false };
              return new Promise((resolve) => waiters.push((v) => resolve({ value: v, done: false })));
            },
            return: async () => { listeners.delete(listener); return { done: true, value: undefined }; },
          };
        },
      };
      return { stream };
    },
  };

  function stateFor(sid: string, directory: string): SessionState {
    let s = sessions.get(sid);
    if (!s) {
      s = { directory, busy: false, queue: [], controller: null, firstPrompt: true };
      sessions.set(sid, s);
    }
    return s;
  }

  function failEvent(sid: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    bus.push({ payload: { type: 'turn.failed', properties: { sessionID: sid, error: message } }, sessionID: sid });
  }

  async function spawn(sid: string, s: SessionState, parts: any[], message?: string): Promise<void> {
    s.busy = true;
    const text = message ?? parts.filter((p: any) => p?.type === 'text').map((p: any) => p?.text ?? '').join('\n');
    const options: Record<string, any> = { cwd: s.directory, sessionId: sid, ...(toolServerRef.server ? { mcpServers: { mafw: toolServerRef.server } } : {}) };
    if (!s.firstPrompt) options.resume = sid;
    s.firstPrompt = false;
    try {
      const query = await sdk.query({ prompt: text, options });
      s.controller = { interrupt: () => query.interrupt() };
      for await (const msg of query) {
        // 方言翻译即刻执行（bus 推 canonical 事件）；session_id 兜底注入
        const sid0 = msg?.session_id ?? sid;
        for (const ev of translateClaudeEvent({ ...msg, session_id: sid0 }, sid0)) bus.push(ev);
      }
    } catch (err) {
      failEvent(sid, err);
    } finally {
      s.controller = null;
      s.busy = false;
      // flush 队首（一次一条——队首完成后自然续发）
      const next = s.queue.shift();
      if (next) void spawn(sid, s, next.parts, next.message);
    }
  }

  // ---- 工具 stash（factory 惰性；入口决定 mcpServers 承载） ----
  const toolServerRef: { server: any } = { server: null };
  const toolFactory: { fn: ((sessionId: string) => any[]) | null } = { fn: null };

  const rt: any = {
    name: 'claude',
    external: true,
    capabilities: {
      sessionApi: true,
      promptWhileBusy: true,
      eventStream: true,
      nativeApprovals: false,
      providerConfigApi: false,
      perLlmCallTransform: false,
      sessionStorageApi: true,
      agentConfigApi: false,
      agentProcessApi: false,
      completionApi: false,
      sessionBranchApi: false,
      turnBudgetApi: false,
      questionApi: false,
      diffApi: false,
      worktreeApi: true,
    },
    resolveEventEntry: undefined,
    getBaseUrl: () => `http://127.0.0.1:${deps.gatewayPort ?? 3000}`,
    session: {
      async create(opts: { directory: string }) {
        const id = newSessionId();
        stateFor(id, opts.directory);
        return { id };
      },
      async promptAsync(opts: any) {
        const s = stateFor(opts.sessionID, opts.directory ?? 'C:/tmp');
        if (s.busy) {
          s.queue.push({ parts: opts.parts ?? [], message: opts.message });
          return;
        }
        void spawn(opts.sessionID, s, opts.parts ?? [], opts.message);
      },
      async prompt(opts: any) {
        // 最小实现：与 promptAsync 同径（无逐条等待聚合——契约允许简化）
        void 0;
        const s = stateFor(opts.sessionID, 'C:/tmp');
        if (s.busy) {
          s.queue.push({ parts: opts.parts ?? [], message: opts.message });
          return { parts: [] };
        }
        void spawn(opts.sessionID, s, opts.parts ?? [], opts.message);
        return { parts: [] };
      },
      async messages(opts: { sessionID: string }) {
        const raw = await sdk.getSessionMessages(opts.sessionID);
        return { data: normalizeClaudeHistory(raw) };
      },
      normalizeMessages: normalizeClaudeHistory,
      async get(opts: { sessionID: string }) {
        const raw = await sdk.getSessionMessages(opts.sessionID);
        return { id: opts.sessionID, messages: normalizeClaudeHistory(raw) };
      },
      async delete(opts: { sessionID: string }) {
        sessions.delete(opts.sessionID);
      },
      async abort(opts: { sessionID: string }) {
        const s = sessions.get(opts.sessionID);
        s?.controller?.interrupt();
        if (s) s.queue.length = 0;
      },
      async list() {
        const raw = await sdk.listSessions();
        return (Array.isArray(raw) ? raw : []).map((x: any) => ({
          id: x?.id ?? x?.sessionId,
          projectID: 'claude',
          directory: x?.cwd ?? '',
          title: x?.title ?? x?.name ?? 'claude session',
          time: { created: x?.createdAt ? Date.parse(String(x.createdAt)) : 0, updated: x?.updatedAt ? Date.parse(String(x.updatedAt)) : 0 },
        }));
      },
      async todo() { return []; },
      async children() { return []; },
      async summarize() { return null; },
    },
    global: { event: () => bus.event() },
    provider: { async list() { return { all: [], connected: [], default: {} }; } },
    app: { async agents() { return []; } },
    config: { async get() { return {}; }, async update() { return {}; } },
    tools: {
      async registerTools(factory: (sessionId: string) => any[]) {
        toolFactory.fn = factory;
        // 最小承载：factory 立即试调用一次以探测工具集，包装为类 MCP server 对象
        // （入口 index.ts 若有 SDK 原生 createSdkMcpServer 可替换此承载）
        const stub = (sid: string) => (toolFactory.fn ?? (() => []))(sid);
        const registrations = stub('probe');
        toolServerRef.server = {
          __mafwStub: true,
          registrations,
          callTool: async (name: string, params: any) => {
            const regs = stub('mcp');
            const found = regs.find((r: any) => r.name === name);
            if (!found) return { text: `unknown tool ${name}`, isError: true };
            return found.execute(params);
          },
        };
      },
      nativeTools: () => [
        { name: 'Read', toolClass: 'readonly' },
        { name: 'Grep', toolClass: 'search' },
        { name: 'Glob', toolClass: 'search' },
        { name: 'Edit', toolClass: 'file-edit' },
        { name: 'Write', toolClass: 'file-edit' },
        { name: 'Bash', toolClass: 'shell' },
      ],
    },
    async healthCheck() { return true; },
  };
  return rt;
}
