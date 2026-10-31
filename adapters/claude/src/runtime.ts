/**
 * claude runtime —— AgentRuntime 最小实现（SDK 注入 seam，零 gateway 依赖）。
 *
 * raw-event-first（spec 2026-10-31 §4.1）：promptAsync 期间 SDKMessage 原样推入
 * 事件总线；翻译由 gateway 的 applyEventMappings 执行（模块导出 eventSource/
 * eventMappings/transformEvent）。turn.started 合成 / 终态复位由 runtime-kit 的
 * createTurnTracker 在总线入口完成；本地失败（无原生终态事件）直接推 canonical
 * turn.failed（恒等行放行）。
 *
 * 能力声明唯一来源在 index.ts（module.exports.capabilities）；本实例不再声明。
 */
import {
  createEventBus,
  createSessionRegistry,
  createTurnTracker,
} from '../../../packages/runtime-kit/src/index.ts';
import { isClaudeTerminal, isClaudeTurnStart } from './events.ts';
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

interface QueueItem {
  parts: any[];
  message?: string;
}
interface SessionExtra {
  directory: string;
  firstPrompt: boolean;
}

let seq = 0;
function newSessionId(): string {
  seq++;
  return `cls_${Date.now().toString(36)}_${seq}`;
}

export function createClaudeRuntime(deps: ClaudeRuntimeDeps): any {
  const { sdk } = deps;
  const sessions = createSessionRegistry<QueueItem, SessionExtra>(() => ({ directory: '', firstPrompt: true }));
  const bus = createEventBus<any>();
  // 总线入口 tap：原生事件先过 tracker（合成 turn.started / 终态复位），再进总线。
  const tracker = createTurnTracker<any>({
    push: (value) => bus.push(value),
    sessionIdOf: (raw) => raw?.session_id ?? raw?.sessionID,
    isTurnStart: isClaudeTurnStart,
    isTerminal: isClaudeTerminal,
    makeTurnStarted: (sessionID) => ({
      payload: { type: 'turn.started', properties: { sessionID } },
      sessionID,
    }),
  });

  function failEvent(sid: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // 本地失败没有原生 result 事件：复位 tracker 状态，下一回合仍能合成 turn.started。
    tracker.reset(sid);
    bus.push({ payload: { type: 'turn.failed', properties: { sessionID: sid, error: message } }, sessionID: sid });
  }

  async function spawn(sid: string, parts: any[], message?: string): Promise<void> {
    const state = sessions.getOrCreate(sid, '');
    sessions.begin(sid);
    const text = message ?? parts.filter((p: any) => p?.type === 'text').map((p: any) => p?.text ?? '').join('\n');
    const options: Record<string, any> = {
      cwd: state.directory,
      sessionId: sid,
      ...(toolServerRef.server ? { mcpServers: { mafw: toolServerRef.server } } : {}),
    };
    if (!state.firstPrompt) options.resume = sid;
    state.firstPrompt = false;
    try {
      const query = await sdk.query({ prompt: text, options });
      sessions.attach(sid, { interrupt: () => query.interrupt() });
      for await (const msg of query) {
        const sid0 = msg?.session_id ?? sid;
        tracker.push({ ...msg, session_id: sid0 }); // raw：gateway 执行器翻译
      }
    } catch (err) {
      failEvent(sid, err);
    } finally {
      sessions.attach(sid, null);
      const next = sessions.finish(sid);
      // flush 队首（一次一条——队首完成后自然续发）
      if (next) void spawn(sid, next.parts, next.message);
    }
  }

  // ---- 工具 stash（factory 惰性；入口决定 mcpServers 承载） ----
  const toolServerRef: { server: any } = { server: null };
  const toolFactory: { fn: ((sessionId: string) => any[]) | null } = { fn: null };

  const rt: any = {
    name: 'claude',
    external: true,
    resolveEventEntry: undefined,
    getBaseUrl: () => `http://127.0.0.1:${deps.gatewayPort ?? 3000}`,
    session: {
      async create(opts: { directory: string }) {
        const id = newSessionId();
        sessions.getOrCreate(id, opts.directory).directory = opts.directory;
        return { id };
      },
      async promptAsync(opts: any) {
        const state = sessions.getOrCreate(opts.sessionID, opts.directory ?? 'C:/tmp');
        if (opts.directory) state.directory = opts.directory;
        if (state.busy) {
          sessions.enqueue(opts.sessionID, { parts: opts.parts ?? [], message: opts.message });
          return;
        }
        void spawn(opts.sessionID, opts.parts ?? [], opts.message);
      },
      async prompt(opts: any) {
        // 最小实现：与 promptAsync 同径（无逐条等待聚合——契约允许简化）
        const state = sessions.getOrCreate(opts.sessionID, opts.directory ?? 'C:/tmp');
        if (opts.directory) state.directory = opts.directory;
        if (state.busy) {
          sessions.enqueue(opts.sessionID, { parts: opts.parts ?? [], message: opts.message });
          return { parts: [] };
        }
        void spawn(opts.sessionID, opts.parts ?? [], opts.message);
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
        sessions.get(opts.sessionID)?.controller?.interrupt();
        sessions.clearQueue(opts.sessionID);
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
