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
import type { RuntimeLifecycle } from '@mafw/runtime-contract';
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

export interface ClaudeBackgroundTask {
  id: string;
  sessionID: string;
  kind: string;
  title?: string;
  lifecycle: RuntimeLifecycle;
  time?: { created?: number; updated?: number; completed?: number };
}

type ClaudeTaskOutcome = 'completed' | 'failed' | 'cancelled';

interface ClaudeTaskRecord {
  id: string;
  kind: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  epoch: string;
  /** The task is part of the SDK's live level or was explicitly backgrounded. */
  backgrounded: boolean;
  inLevel: boolean;
  ambient: boolean;
  paused: boolean;
  edgeActiveAt?: number;
  runID?: string;
  terminal?: { outcome: ClaudeTaskOutcome; at: number };
}

interface ClaudeTaskSession {
  epoch: string;
  levelSeen: boolean;
  lastLevelAt?: number;
  live: Set<string>;
  tasks: Map<string, ClaudeTaskRecord>;
}

let taskEpochSeq = 0;
function newTaskEpoch(): string {
  taskEpochSeq++;
  return `claude-${Date.now().toString(36)}-${taskEpochSeq}`;
}

/**
 * Claude managed-task registry.
 *
 * `background_tasks_changed` is a REPLACE level signal (the full live set);
 * `task_started` / `task_updated` / `task_notification` are edges. A task that
 * leaves the level without a terminal edge is `unknown`, never `active` — the
 * same rule the canonical lifecycle applies to legacy child rows.
 */
function createClaudeTaskRegistry(now: () => number) {
  const sessions = new Map<string, ClaudeTaskSession>();

  function stateOf(sessionID: string): ClaudeTaskSession {
    let state = sessions.get(sessionID);
    if (!state) {
      state = { epoch: newTaskEpoch(), levelSeen: false, live: new Set(), tasks: new Map() };
      sessions.set(sessionID, state);
    }
    return state;
  }

  function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  function upsert(
    state: ClaudeTaskSession,
    id: string,
    patch: { kind?: string; title?: string; runID?: string },
  ): { task: ClaudeTaskRecord; newRun: boolean } | null {
    const at = now();
    const runID = text(patch.runID);
    const current = state.tasks.get(id);
    if (!current) {
      const task: ClaudeTaskRecord = {
        id,
        kind: patch.kind ?? 'task',
        title: patch.title,
        createdAt: at,
        updatedAt: at,
        revision: 1,
        epoch: state.epoch,
        backgrounded: false,
        inLevel: false,
        ambient: false,
        paused: false,
        runID,
      };
      state.tasks.set(id, task);
      trim(state);
      return { task, newRun: false };
    }

    // Run ids sort chronologically as plain strings; a frame naming an older
    // run is late and must not roll the task back.
    if (runID && current.runID && runID < current.runID) return null;
    const newRun = !!(runID && current.runID && runID !== current.runID);
    if (newRun) {
      current.terminal = undefined;
      current.paused = false;
      current.edgeActiveAt = undefined;
    }
    if (runID) current.runID = runID;
    if (patch.kind) current.kind = patch.kind;
    if (patch.title) current.title = patch.title;
    current.updatedAt = at;
    current.revision++;
    current.epoch = state.epoch;
    return { task: current, newRun };
  }

  function trim(state: ClaudeTaskSession): void {
    if (state.tasks.size <= 200) return;
    let oldest: ClaudeTaskRecord | undefined;
    for (const task of state.tasks.values()) {
      if (!oldest || task.updatedAt < oldest.updatedAt) oldest = task;
    }
    if (oldest) state.tasks.delete(oldest.id);
  }

  function observeLevel(state: ClaudeTaskSession, message: any): void {
    state.levelSeen = true;
    state.lastLevelAt = now();
    state.live.clear();
    const tasks = Array.isArray(message?.tasks) ? message.tasks : [];
    for (const raw of tasks) {
      const id = text(raw?.task_id);
      if (!id) continue;
      const ambient = raw?.ambient === true;
      const current = state.tasks.get(id);
      if (current) current.ambient = ambient;
      if (ambient) continue;
      state.live.add(id);
      const entry = upsert(state, id, {
        kind: text(raw?.task_type),
        title: text(raw?.description),
        runID: text(raw?.run_id),
      });
      if (!entry) continue;
      entry.task.backgrounded = true;
      entry.task.inLevel = true;
      entry.task.ambient = false;
    }
    for (const task of state.tasks.values()) {
      if (!state.live.has(task.id)) task.inLevel = false;
    }
  }

  function observeEdge(state: ClaudeTaskSession, message: any): void {
    const id = text(message?.task_id);
    if (!id) return;
    const subtype = message?.subtype;
    const patch = message?.patch ?? {};
    const entry = upsert(state, id, {
      kind: text(message?.task_type),
      title: text(message?.description) ?? text(message?.summary),
      runID: text(message?.run_id),
    });
    if (!entry) return;
    const task = entry.task;

    if (subtype === 'task_started') {
      task.edgeActiveAt = now();
      task.paused = false;
      if (message?.is_backgrounded === true) task.backgrounded = true;
      if (!task.terminal) task.inLevel = task.inLevel || task.backgrounded;
      return;
    }

    if (subtype === 'task_notification') {
      const status = message?.status;
      const outcome: ClaudeTaskOutcome = status === 'failed'
        ? 'failed'
        : status === 'stopped' ? 'cancelled' : 'completed';
      task.backgrounded = true;
      task.terminal = { outcome, at: now() };
      task.paused = false;
      return;
    }

    if (subtype !== 'task_updated') return;
    if (patch?.is_backgrounded === true) task.backgrounded = true;
    const status = patch?.status;
    if (status === 'paused') {
      if (task.terminal) return;
      task.paused = true;
      task.edgeActiveAt = now();
      return;
    }
    if (status === 'completed' || status === 'failed' || status === 'killed') {
      const outcome: ClaudeTaskOutcome = status === 'completed'
        ? 'completed'
        : status === 'killed' ? 'cancelled' : 'failed';
      task.terminal = {
        outcome,
        at: Number.isFinite(patch?.end_time) ? Number(patch.end_time) : now(),
      };
      task.paused = false;
      return;
    }
    if (status === 'pending' || status === 'running') {
      if (task.terminal) return;
      task.paused = false;
      task.edgeActiveAt = now();
      task.backgrounded = task.backgrounded || message?.is_backgrounded === true;
      task.inLevel = task.inLevel || task.backgrounded;
    }
  }

  function observe(sessionID: string, message: any): void {
    if (!sessionID || message?.type !== 'system') return;
    const state = stateOf(sessionID);
    if (message.subtype === 'background_tasks_changed') {
      observeLevel(state, message);
      return;
    }
    if (
      message.subtype === 'task_started'
      || message.subtype === 'task_updated'
      || message.subtype === 'task_notification'
    ) {
      observeEdge(state, message);
    }
  }

  function beginProcess(sessionID: string): void {
    const state = sessions.get(sessionID);
    if (!state) return;
    state.epoch = newTaskEpoch();
    state.live.clear();
    state.lastLevelAt = now();
    for (const task of state.tasks.values()) {
      task.inLevel = false;
      if (!task.terminal) {
        task.paused = false;
        task.edgeActiveAt = undefined;
        task.epoch = state.epoch;
      }
    }
  }

  function lifecycleOf(state: ClaudeTaskSession, task: ClaudeTaskRecord): RuntimeLifecycle {
    const observedAt = now();
    const base = {
      observedAt,
      lastActivityAt: task.updatedAt,
      revision: task.revision,
      epoch: task.epoch,
      authority: 'runtime' as const,
    };
    if (task.terminal) {
      return {
        phase: 'settled',
        outcome: task.terminal.outcome,
        terminalAt: task.terminal.at,
        ...base,
      };
    }
    // A level snapshot is authoritative for membership. An edge newer than the
    // latest snapshot may not have propagated yet; older edges cannot keep a
    // vanished task alive.
    const omittedFromLevel = state.levelSeen
      && !task.inLevel
      && !(task.edgeActiveAt != null && task.edgeActiveAt > (state.lastLevelAt ?? 0));
    if (omittedFromLevel) {
      return { phase: 'unknown', reason: 'missing-from-background-level', ...base };
    }
    if (task.paused) {
      return { phase: 'waiting', waitingOn: ['input'], ...base };
    }
    if (task.inLevel || task.edgeActiveAt != null) {
      return { phase: 'active', ...base };
    }
    return { phase: 'unknown', reason: 'no-terminal-evidence', ...base };
  }

  function clear(sessionID: string): void {
    sessions.delete(sessionID);
  }

  function list(sessionID: string): ClaudeBackgroundTask[] {
    const state = sessions.get(sessionID);
    if (!state) return [];
    return [...state.tasks.values()]
      .filter((task) => task.backgrounded && !task.ambient)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .map((task) => {
        const terminalAt = task.terminal?.at;
        return {
          id: task.id,
          sessionID,
          kind: task.kind,
          ...(task.title ? { title: task.title } : {}),
          lifecycle: lifecycleOf(state, task),
          time: {
            created: task.createdAt,
            updated: task.updatedAt,
            ...(terminalAt !== undefined ? { completed: terminalAt } : {}),
          },
        };
      });
  }

  return { observe, beginProcess, list, clear };
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
  const backgroundTasks = createClaudeTaskRegistry(deps.now ?? Date.now);

  function failEvent(sid: string, error: unknown, rawSid?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    // 本地失败没有原生 result 事件：复位 tracker 状态（gateway id 与 raw session_id
    // 可能不同——两个键都复位，否则下一回合不合成 turn.started，UI 永远 busy）。
    tracker.reset(sid);
    if (rawSid && rawSid !== sid) tracker.reset(rawSid);
    bus.push({ payload: { type: 'turn.failed', properties: { sessionID: sid, error: message } }, sessionID: sid });
  }

  async function spawn(sid: string, parts: any[], message?: string): Promise<void> {
    const state = sessions.getOrCreate(sid, '');
    sessions.begin(sid);
    // A new query is a new CLI process: the SDK level is per-process and emits
    // nothing at startup, so previous live membership cannot be trusted.
    backgroundTasks.beginProcess(sid);
    const text = message ?? parts.filter((p: any) => p?.type === 'text').map((p: any) => p?.text ?? '').join('\n');
    const options: Record<string, any> = {
      cwd: state.directory,
      sessionId: sid,
      ...(toolServerRef.server ? { mcpServers: { mafw: toolServerRef.server } } : {}),
    };
    if (!state.firstPrompt) options.resume = sid;
    state.firstPrompt = false;
    let rawSid: string | undefined;
    try {
      const query = await sdk.query({ prompt: text, options });
      sessions.attach(sid, { interrupt: () => query.interrupt() });
      for await (const msg of query) {
        const sid0 = msg?.session_id ?? sid;
        rawSid = msg?.session_id;
        try {
          // Task snapshots are queried by the gateway session id; SDK frames
          // may carry a raw session_id, but ownership follows the adapter id.
          backgroundTasks.observe(sid, msg);
        } catch {
          // fail-open: task bookkeeping must never break the turn stream
        }
        tracker.push({ ...msg, session_id: sid0 }); // raw：gateway 执行器翻译
      }
    } catch (err) {
      failEvent(sid, err, rawSid);
    } finally {
      // 会话可能在回合中被删除——不要复活注册表条目
      if (sessions.get(sid)) {
        sessions.attach(sid, null);
        const next = sessions.finish(sid);
        // flush 队首（一次一条——队首完成后自然续发）
        if (next) void spawn(sid, next.parts, next.message);
      }
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
        backgroundTasks.clear(opts.sessionID);
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
      async summarize() { return null; },
    },
    background: {
      async tasks(opts: { sessionID: string; cursor?: string; limit?: number }) {
        return backgroundTasks.list(opts.sessionID);
      },
    },
    async backgroundTasks(opts: { sessionID: string }) {
      return backgroundTasks.list(opts.sessionID);
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
