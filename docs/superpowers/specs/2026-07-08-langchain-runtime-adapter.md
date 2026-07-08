# RuntimeAdapter: 双运行时架构设计

> 让 MAFW 核心可以在 OpenCode SDK 和 LangChain/LangGraph 两种运行时上独立运行。
> 核心不变，运行时可切换。

---

## 1. 背景与目标

### 现状
- MAFW 的 HookManager、Memory 组件、Skill Entry 硬耦合在 OpenCode SDK 的事件模型上
- `plugin.ts` 直接桥接 OpenCode 的 `hooks`/`event`/`experimental` 三种事件源
- LangGraph 仅作 Gateway 编排，不参与 Hook 事件

### 目标
- 定义 `RuntimeAdapter` 接口层，将 MAFW 核心与运行时解耦
- OpenCodeAdapter：存量迁移，零行为变化
- LangChainAdapter：新运行时，Skill Entry 直接在进程内调用
- 两种模式共享同一套 `state.json` + `checkpoints/`，Dashboard 零改动

---

## 2. 架构总览

```
                         MAFW Core (不变)
               HookManager / HarmonicIndex / ParametricStore
               CognitiveGraph / CostEstimator / ReviewScheduler
                           │
                   ┌───────▼───────┐
                   │ RuntimeAdapter │  ← 接口层
                   └───┬───────┬───┘
                       │       │
            ┌──────────▼──┐ ┌──▼──────────────┐
            │ OpenCode    │ │ LangChain       │
            │ Adapter     │ │ Adapter         │
            │ (事件桥接)    │ │ (CallbackHandler│
            │ EventBuffer │ │ + Checkpointer) │
            └─────────────┘ └─────────────────┘
                  │                   │
           OpenCode SDK        LangGraph + 内存 Skill
           (子进程隔离)         (进程内直接调用)
                  │                   │
            state.json 写入    state.json 写入
            (Gateway 调度)    (Checkpointer 统一写)
```

### 核心原则

1. **Single Writer Principle** — `state.json` 仅由 `MafwFileCheckpointer.put()` 写入，Skill Entry 只写业务工件（waves/receipts/reviews）
2. **EventBuffer** — Adapter 在 `bind(hookManager)` 前缓存事件，bind 后按序重放
3. **Run Tree 追踪** — LangChain 的 `runId/parentRunId` 树映射到 MAFW 的 session/tool/llm 层级
4. **互不感知** — HookManager 不知道运行时是谁，Adapter 不依赖 MAFW 内部实现

---

## 3. RuntimeAdapter 接口定义

```typescript
// src/runtime/RuntimeAdapter.ts

interface RuntimeAdapter {
  // — 生命周期绑定 —
  bind(hookManager: HookManager): void;

  // — 统一能力执行入口 —
  executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: Record<string, any>;
    args?: any;
  }): Promise<any>;
}
```

### EventBuffer 基类（Adapter 公共实现）

```typescript
abstract class BaseRuntimeAdapter implements RuntimeAdapter {
  protected hookManager: HookManager | null = null;
  private eventBuffer: Array<{ event: string; ctx: any }> = [];

  bind(hookManager: HookManager): void {
    this.hookManager = hookManager;
    while (this.eventBuffer.length) {
      const { event, ctx } = this.eventBuffer.shift()!;
      hookManager.execute(event, ctx);
    }
  }

  protected dispatch(event: string, ctx: any): void {
    if (this.hookManager) {
      this.hookManager.execute(event, ctx);
    } else {
      this.eventBuffer.push({ event, ctx });
    }
  }

  protected async dispatchAsync(event: string, ctx: any): Promise<any> {
    if (this.hookManager) {
      await this.hookManager.execute(event, ctx);
    }
    return ctx; // 允许 HookManager 修改 ctx（适用于 chat.message 等可修改场景）
  }

  abstract executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any>;
}
```

---

## 4. OpenCodeAdapter 详细设计

### 事件映射

| OpenCode 桥接点 | Adapter 入口 | HookManager 事件 | 备注 |
|---|---|---|---|
| `hooks['session.end']` | `onSessionEnd(ctx)` | `session.end` | |
| `hooks['tool.execute.before']` | `onToolBefore(ctx)` | `tool.execute.before` | |
| `hooks['tool.execute.after']` | `onToolAfter(ctx, result)` | `tool.execute.after` | |
| `hooks['chat.message']` | `onChatMessage(ctx)` | `user.prompt.submit` | 异步 + 返回修改后内容 |
| `event({type:'session.created'})` | `onRuntimeEvent(event)` | `session.start` | 含 sessionMap 缓存 |
| `experimental.text.complete` | `onTextComplete(ctx, result)` | `llm.call.after` | |
| `experimental.session.compacting` | `onSessionCompacting(ctx, snapshot)` | `session.compacting` | |
| `experimental.chat.messages.transform` | **保留在 plugin.ts 薄壳层** | — | 纯 OpenCode 特有逻辑 |

### OpenCodeAdapter 核心逻辑

```typescript
class OpenCodeAdapter extends BaseRuntimeAdapter {
  constructor(private options: {
    directory: string;
    opencodeClient?: any;
  }) { super(); }

  // — sessionMap：防止 session.created 事件延迟导致 projectDir 丢失 —
  private sessionMap = new Map<string, string>();

  onRuntimeEvent(event: { type: string; info?: any; sessionID?: string }): void {
    if (event.type === 'session.created') {
      const sessionId = event.info?.id || event.sessionID;
      if (sessionId && this.options.directory) {
        this.sessionMap.set(sessionId, this.options.directory);
      }
      this.dispatch('session.start', {
        sessionId,
        projectDir: this.options.directory,
      });
      return;
    }
    // 非 session.created 事件：从 sessionMap 获取 projectDir
    const sessionId = event.sessionID || event.info?.sessionID;
    const projectDir = sessionId
      ? this.sessionMap.get(sessionId) || this.options.directory
      : this.options.directory;
    this.dispatch(`runtime.${event.type}`, { ...event, sessionId, projectDir });
  }

  async onChatMessage(ctx: { sessionID: string; message?: any; parts?: any[] }): Promise<{ message: any; parts: any[] }> {
    const modifiedCtx = await this.dispatchAsync('user.prompt.submit', {
      sessionID: ctx.sessionID,
      message: ctx.message,
      parts: ctx.parts || [],
    });
    return {
      message: modifiedCtx.message,
      parts: modifiedCtx.parts || [],
    };
  }

  async executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any> {
    const runtimeCtx = {
      ...params.context,
      goalId: params.goalId,
      projectDir: this.options.directory,
    };
    if (params.type === 'skill') {
      return this.options.opencodeClient?.runSkill(params.name, runtimeCtx);
    }
    throw new Error(`OpenCodeAdapter: unsupported capability type ${params.type}`);
  }
}
```

### 迁移后的 plugin.ts（薄壳）

```typescript
const adapter = new OpenCodeAdapter({ directory, opencodeClient });

return {
  hooks: {
    'session.end': (ctx: any) => adapter.onSessionEnd(ctx),
    'tool.execute.before': (ctx: any) => adapter.onToolBefore(ctx),
    'tool.execute.after': (ctx: any, r: any) => adapter.onToolAfter(ctx, r),
    'chat.message': (ctx: any) => adapter.onChatMessage(ctx),
  },
  event: async ({ event }: any) => adapter.onRuntimeEvent(event),
  'experimental.text.complete': (ctx: any, r: any) => adapter.onTextComplete(ctx, r),
  'experimental.session.compacting': (ctx: any, s: any) => adapter.onSessionCompacting(ctx, s),
  'experimental.chat.messages.transform': async (input: any, output: any) => {
    // 纯 OpenCode 特有逻辑，保留不动
  },
  // command / config / tool 不变
};
```

---

## 5. LangChainAdapter 详细设计

### 5a. MafwCallbackHandler — 事件入站

```
LangChain Callback Tree               MAFW Hook
─────────────────────                 ──────────
graph.invoke()                        session.start
  ├─ plan node (chain)
  │   └─ LLM call                     llm.call.before/after
  ├─ execute node (chain)
  │   └─ Tool: read_file              tool.execute.before/after
  └─ review node (chain)
      └─ ...
graph.invoke() end                    session.end
```

#### Run Tree 追踪

- 根 chain（`parentRunId === undefined`）= session
- 子 chain/LM/Tool = 该 session 内的操作
- `sessionId` 从父 chain 继承，不依赖全局变量（支持并发）

```typescript
class MafwCallbackHandler extends BaseRuntimeAdapter {
  name = 'MafwCallbackHandler';

  private runTree = new Map<string, {
    type: string;
    sessionId: string;
    parentRunId?: string;
  }>();
  private resumedThreads = new Set<string>();

  async onChainStart(
    runId: string,
    parentRunId: string | undefined,
    tags?: string[],
    metadata?: any,
    config?: any,
  ): Promise<void> {
    const threadId = config?.configurable?.thread_id;
    const isResume = config?.resumeValue !== undefined
      || this.resumedThreads.has(threadId);

    let sessionId: string;
    if (!parentRunId) {
      sessionId = `lc_${runId}`;
      if (!isResume) {
        this.dispatch('session.start', { sessionId });
      }
      this.resumedThreads.add(threadId);
    } else {
      sessionId = this.runTree.get(parentRunId)?.sessionId || `lc_${runId}`;
    }

    this.runTree.set(runId, { type: 'chain', sessionId, parentRunId });

    // 检测 interrupt resume
    if (config?.resumeValue !== undefined) {
      this.dispatch('session.handoff', {
        sessionId,
        type: 'resume',
        resumeValue: config.resumeValue,
      });
    }
  }

  async onChainEnd(output: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    if (!meta) return;

    // 检测 interrupt pause
    if (output?.interrupt) {
      this.dispatch('session.handoff', {
        sessionId: meta.sessionId,
        type: 'pause',
        interruptInfo: output.interrupt,
      });
      return;
    }

    // 仅根 chain 触发 session.end
    if (!meta.parentRunId) {
      this.dispatch('session.end', { sessionId: meta.sessionId });
    }
    this.runTree.delete(runId);
  }

  async onLLMStart(
    serialized: any,
    prompts: string[],
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('llm.call.before', {
      sessionId: parent?.sessionId || 'unknown',
      model: serialized?.name,
      prompts,
      runId,
    });
    this.runTree.set(runId, { type: 'llm', sessionId: parent?.sessionId || '' });
  }

  async onLLMEnd(response: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('llm.call.after', {
      sessionId: meta?.sessionId || 'unknown',
      runId,
      generations: response?.generations,
    });
  }

  async onToolStart(
    serialized: any,
    input: string,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('tool.execute.before', {
      tool: serialized?.name,
      input,
      runId,
      sessionId: parent?.sessionId || 'unknown',
    });
    this.runTree.set(runId, { type: 'tool', sessionId: parent?.sessionId || '' });
  }

  async onToolEnd(output: string, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('tool.execute.after', {
      runId,
      sessionId: meta?.sessionId || 'unknown',
      output,
    });
  }

  async onRetrieverStart(
    serialized: any,
    query: string,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('memory.recall', {
      query,
      sessionId: parent?.sessionId || 'unknown',
      runId,
    });
  }

  async onRetrieverEnd(response: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('memory.recall', {
      ...meta,
      response,
      completed: true,
    });
  }

  // — 出站：executeCapability —
  private toolRegistry: Record<string, StructuredTool> = {};

  registerMafwTool(name: string, tool: StructuredTool): void {
    this.toolRegistry[name] = tool;
  }

  async executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any> {
    if (params.type === 'skill') {
      // 直接调用 MAFW skill entry（内存中）
      try {
        const entryPath = path.join(params.context.projectDir || '.', 'src', 'skills', params.name, 'entry.ts');
        const { default: skillEntry } = await import(entryPath);
        const runtimeCtx = {
          ...params.context,
          goalId: params.goalId,
          projectDir: params.context.projectDir,
        };
        return await skillEntry(runtimeCtx);
      } catch (err: any) {
        throw new Error(`LangChainAdapter: failed to execute skill "${params.name}": ${err.message}`);
      }
    }
    if (params.type === 'tool') {
      const tool = this.toolRegistry[params.name];
      if (!tool) throw new Error(`LangChainAdapter: unknown tool "${params.name}"`);
      return tool.invoke(params.args);
    }
    throw new Error(`LangChainAdapter: unsupported capability type ${params.type}`);
  }
}
```

### 5b. MafwFileCheckpointer — 状态持久化

核心约束：
- 底层写 `state/{goalId}.json`（Dashboard 兼容）
- 同时写 `checkpoints/langgraph/{goalId}/step_{N}.json`（LangGraph 恢复用）
- `set` 是 `state.json` 的唯一写入者（Single Writer Principle）

```typescript
class MafwFileCheckpointer extends BaseCheckpointSaver {
  private baseDir: string;

  constructor(config: { baseDir: string }) {
    super();
    this.baseDir = config.baseDir;
  }

  async get(config: any): Promise<Checkpoint | undefined> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return this.stateToCheckpoint(state);
  }

  async put(config: any, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<void> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;

    // 写 state.json（Dashboard 兼容，唯一写入者）
    const stateData = this.checkpointToState(checkpoint, metadata);
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));

    // 写 checkpoint 文件（LangGraph 恢复用）
    const cpDir = path.join(this.baseDir, 'checkpoints', 'langgraph', goalId);
    if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });
    const cpPath = path.join(cpDir, `step_${metadata?.step || 0}.json`);
    fs.writeFileSync(cpPath, JSON.stringify({ checkpoint, metadata }));
  }

  async getTuple(config: any): Promise<CheckpointTuple | undefined> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const checkpoint = this.stateToCheckpoint(state);
    return {
      checkpoint,
      metadata: { source: 'mafw_file', step: state.loop || 0 },
      config: { configurable: { thread_id: goalId, goalId } },
    };
  }

  async *list(config: any): AsyncGenerator<CheckpointTuple> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;

    const cpDir = path.join(this.baseDir, 'checkpoints', 'langgraph', goalId);
    if (!fs.existsSync(cpDir)) return;

    const files = fs.readdirSync(cpDir)
      .filter(f => f.startsWith('step_') && f.endsWith('.json'))
      .sort((a, b) => {
        const stepA = parseInt(a.split('_')[1]);
        const stepB = parseInt(b.split('_')[1]);
        return stepB - stepA;
      });

    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(cpDir, file), 'utf-8'));
      yield {
        checkpoint: data.checkpoint,
        metadata: data.metadata,
        config: { configurable: { thread_id: goalId, goalId } },
      };
    }
  }

  // — 格式转换 —
  private stateToCheckpoint(state: any): Checkpoint {
    return {
      id: `mafw_${state.goalId}_loop${state.loop}`,
      ts: new Date(state.updatedAt).toISOString(),
      version: 1,
      channelValues: {
        goalId: state.goalId,
        phase: state.phase,
        loop: state.loop,
        nextAction: state.nextAction,
        currentWave: state.currentWave,
        totalWaves: state.totalWaves,
      },
    };
  }

  private checkpointToState(checkpoint: Checkpoint, metadata: CheckpointMetadata): any {
    const cv = checkpoint.channelValues || {};
    return {
      version: '2',
      goalId: cv.goalId,
      loop: cv.loop || 0,
      phase: cv.phase || 'PENDING',
      nextAction: cv.nextAction || null,
      currentWave: cv.currentWave || 0,
      totalWaves: cv.totalWaves || null,
      artifacts: {},
      sessions: {},
      updatedAt: checkpoint.ts || new Date().toISOString(),
    };
  }
}
```

### 5c. LangGraph 节点适配（以 plan 为例）

Skill Entry 只写业务工件，不写 `state.json`：

```typescript
// runtime/langchain-nodes/plan.node.ts
async function planNodeWithAdapter(
  state: LoopState,
  runtime: RuntimeAdapter,
): Promise<Partial<LoopState>> {
  const result = await runtime.executeCapability({
    type: 'skill',
    name: 'mafw-plan',
    goalId: state.goalId,
    context: {
      goalId: state.goalId,
      projectDir: state.projectDir,
      state: { ...state, phase: 'PLANNING' },
    },
  });

  return {
    phase: 'EXECUTING',
    wavePlanPath: result.artifacts.wavesPath,
    nextAction: 'CREATE_EXECUTE_SESSION',
  };
}
```

---

## 6. MAFW Loop 在 LangChain 上的完整流程

```
1. MafwScheduler 初始化 + LangChainAdapter
   adapter = new LangChainAdapter()
   adapter.bind(hookManager)

2. Goal 创建
   executeCapability({ type: 'skill', name: 'mafw-goal', ... })
   → 写 state/{goalId}.json (via Checkpointer)
   → write waves/ / receipts/ / reviews/ 业务工件

3. graph.invoke() 触发根 chain
   onChainStart(runId=A) → dispatch('session.start')

4. Plan Node (子 chain)
   executeCapability({ type: 'skill', name: 'mafw-plan', ... })
   → 写 waves/{goalId}.json
   → 返回 artifacts → 节点更新 LoopState
   → Checkpointer.put() → 写 state.json

5. Execute Node × Wave (子 chain)
   executeCapability({ type: 'skill', name: 'mafw-execute', ... })
   → 写 receipts/
   → Checkpointer.put() → 写 state.json

6. Review Node (子 chain)
   executeCapability({ type: 'skill', name: 'mafw-review', ... })
   → 写 reviews/{goalId}.md
   → Checkpointer.put() → 写 state.json

7a. PASS → onChainEnd(runId=A) → dispatch('session.end')
7b. FAIL → Archive Node

8. Autoresume
   resumedThreads 检测 → 跳过重复 session.start
   list() 遍历 checkpoints/ → 从最新步恢复
```

---

## 7. 迁移策略

| 阶段 | 内容 | 兼容性 |
|---|---|---|
| Phase 1 | 创建 `src/runtime/` + 接口 + EventBuffer 基类 | ✅ 纯新增 |
| Phase 2 | OpenCodeAdapter 实现 + plugin.ts 委托 | ✅ 行为等价 |
| Phase 3 | LangChainAdapter 实现 + MafwFileCheckpointer | ✅ 不影响 OpenCode |
| Phase 4 | LangChain 节点适配（plan/execute/review node） | ✅ 新文件 |
| Phase 5 | 运行时选择入口（RUNTIME 环境变量） | ✅ Gateway 选择适配器 |

---

## 8. 测试策略

| 测试类型 | 覆盖范围 |
|---|---|
| 单元测试 | EventBuffer 事件缓存/重放 |
| 单元测试 | OpenCodeAdapter 每种事件 → HookManager 调用 |
| 单元测试 | MafwCallbackHandler 每个 Callback → HookManager 事件 |
| 单元测试 | MafwFileCheckpointer state↔checkpoint 格式转换 |
| 单元测试 | runTree 并发隔离（多 thread_id 同时执行） |
| 集成测试 | 完整 LangGraph loop 通过 LangChainAdapter 执行 |
| 回归测试 | plugin.ts 迁移后与现有 OpenCode 行为一致 |
