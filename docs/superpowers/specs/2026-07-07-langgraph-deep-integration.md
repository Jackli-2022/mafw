# LangGraph 深度集成 — 设计规格

## 目标

将 Gateway 从"全能调度器"降级为"轻量级事件路由器 + 文件同步器"，利用 LangGraph 的 `interrupt`、`RetryPolicy`、声明式 `StateGraph` 砍掉 Gateway 中手写的等待/超时/路由代码。

## 架构变化

```
当前: Gateway 手写 ~500 行调度胶水（WAIT_PHASE_COMPLETE + 30s 轮询 + setTimeout 超时
       + dispatchSession switch + routeNextStep + convertToLangGraphState）

目标: Gateway ~200 行（仅 HTTP + 文件同步 + SDK 工具）
       └─ 所有路由/等待/超时下沉到 LangGraph
```

## Section 1：文件 Checkpointer

`BaseCheckpointSaver` 子类，存储路径 `.opencode/mafw/checkpoints/{thread_id}/`。

```typescript
interface CheckpointFile {
  checkpoint: {
    thread_id: string;
    node_id: string;
    ts: string;
    state: Record<string, any>;  // 仅存元数据（round, phase, verdict）
  };
  metadata: {
    step: number;
    retries: number;
    lastError?: string;
  };
}
```

文件结构：
```
.opencode/mafw/checkpoints/{goalId}/
  ├── step_0000001.json
  ├── step_0000002.json
  └── metadata.json
```

## Section 2：interrupt 替换 WAIT_PHASE_COMPLETE

每个 Agent 节点模式：

```typescript
async function planAgent(state, config) {
  const { projectDir, goalId } = state;
  const session = await createSession(SDK, projectDir);
  await sendPrompt(SDK, session.id, `/skill mafw-plan ${goalId}`);
  syncToFile(state, { phase: 'PLANNING' });
  
  // 挂起等待 Plugin 完成
  const event = interrupt('awaiting_plan');
  
  // 恢复后继续
  syncToFile(state, { phase: 'PLANNING_COMPLETE' });
  return { wavePlanPath: path.join(mafwDir, 'waves.json') };
}

// executeAgent, reviewAgent 同理
```

Gateway 事件处理：

```typescript
onEvent(goalId, event):
  const cp = new FileCheckpointer(findMafwDir(goalId));
  const graph = buildExecutionGraph();
  await graph.resume(goalId, Command.RESUME({ event }), {
    configurable: { thread_id: goalId }, checkpointer: cp,
  });
  syncFromCheckpoint(goalId, cp);
```

兜底：`resumeStaleThreads()` 在 backupPolling 中运行，检查 checkpoint 目录中存在但 activeGoals 中没有对应 `graph.invoke` 的 thread，直接 `resume`。

## Section 3：RetryPolicy 替代 startSessionMonitor

节点级配置：

```typescript
const planAgent = node(planFn, {
  retry: {
    maxAttempts: 2,
    initialInterval: 1000,
    backoffFactor: 2,
    maxInterval: 5000,
    retryOn: (e) => e.message.includes('timeout'),
  },
  timeout: 10 * 60 * 1000,
});
```

- `startSessionMonitor`（~30 行）删除
- 超时 → LangGraph TimeoutError → RetryPolicy 重试 → 耗尽 → checkpoint 记录 lastError → 条件边路由 archive_fail

## Section 4：StateGraph 扁平化

```typescript
const workflow = new StateGraph(LoopState)
  .addNode('plan', planAgent)
  .addNode('execute', executeAgent)
  .addNode('review', reviewAgent)
  .addNode('archive_success', archiveSuccessNode)
  .addNode('archive_fail', archiveFailNode)

  .addEdge('__start__', 'plan')
  .addEdge('plan', 'execute')
  .addEdge('execute', 'review')
  .addConditionalEdges('review', routeAfterReview, {
    plan: 'plan',           // 回退重试
    archive_success: 'archive_success',
    archive_fail: 'archive_fail',
  })
  .addEdge('archive_success', END)
  .addEdge('archive_fail', END);
```

节点内的 `createSession/sendPrompt/destroySession` 使用共享工具函数，Gateway 不再直接调用这些操作。

## 删除的代码

| 方法 | 行数 | 原因 |
|------|------|------|
| `startSessionMonitor` | ~30 | → RetryPolicy |
| `WAIT_PHASE_COMPLETE` 分支 | ~10 | → interrupt |
| `advanceStateMachines` | ~15 | → onEvent |
| `advanceSingleGoal` | ~10 | → onEvent |
| `dispatchSession` | ~50 | → StateGraph |
| `routeNextStep` | ~45 | → StateGraph |
| `convertToLangGraphState` | ~15 | 不再需要 |

## 保留的代码

| 方法 | 原因 |
|------|------|
| `createSession/sendPrompt/destroySession` | SDK 工具 |
| `patchState/archiveGoal` | 状态操作 |
| `syncToDashboard` | SSE Dashboard 兼容 |
| `recoverState` | 启动时恢复 activeGoals |
| `startBackupPolling` | 兜底 + resumeStaleThreads |
| HTTP API endpoints | /register, /control, /health, /api/events, SSE |

## 依赖变更

- `package.json`：无需新增（`@langchain/langgraph` 已有）
- 新增文件：`src/langgraph/checkpointer.ts`（FileCheckpointer，~80 行）
- 修改文件：`gateway/src/index.ts`（~200 行替换 ~500 行）
