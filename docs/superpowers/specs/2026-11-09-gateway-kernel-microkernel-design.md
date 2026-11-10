# Gateway 内核重构：微内核拆分 index.ts（Phase D）

日期：2026-11-09
状态：待批准
前置：Phase A（concurrency/）+ Phase B（scheduler/）+ Phase C（session/）+ Runtime Driver Spec Phase 4
关联设计：
- `2026-11-09-gateway-kernel-concurrency-design.md`（Phase A）
- `2026-11-09-gateway-kernel-scheduler-design.md`（Phase B）
- `2026-11-09-gateway-kernel-session-registry-design.md`（Phase C）
- `2026-11-09-neutral-runtime-driver-architecture-design.md`（驱动层）

## 1. 意图与为什么

`index.ts` 是 **9769 行的组合根 + HTTP 路由器 + 事件分派器 + 调度闸门 + 服务容器**。它同时做五件事：

1. 组合根：构建/注入 ~100 个私有字段
2. HTTP 路由器：128 个分支 if 链（73 个正则 + 55 个精确匹配）
3. 事件分派器：`handleOpencodeEvent` 200+ 行顺序敏感 if 链
4. 调度闸门：`snapshotBuildInFlight` / `managerSessionInflight` / `ttsInflight` 等
5. 服务容器：直接持有全部服务实例

**OS 原则**：内核只做调度/中断/内存/IPC；组合根 < 1000 行；路由是声明式注册；事件消费是表驱动。

## 2. 现状

- 9769 行（Runtime Driver Spec 完成后预估 ~7500 行）
- 128 分支 if 链（legacy 路由，与 RouteRegistry 并存）
- `handleOpencodeEvent` 消费顺序是隐式拓扑（只存在于注释）
- 启动序列、路由注册、服务构建、事件分派全部内联

## 3. 目标

把 `index.ts` 拆为 **6 个模块，总计 < 1500 行**：

| 模块 | 目标行数 | 职责 |
|---|---|---|
| `index.ts` | < 100 | 入口：import kernel + kernel.start() |
| `boot.ts` | ~200 | 启动序列（探针/迁移/恢复/规则装配） |
| `kernel.ts` | ~400 | 组合根：构建/注入各子系统 |
| `http-router.ts` | ~300 | HTTP 服务器 + CORS + auth + registry dispatch |
| `event-dispatch.ts` | ~200 | handleOpencodeEvent 表驱动化 |
| `subsystems/` | ~300 | 按域组织的初始化模块（memory/goal/recall/sessions/monitoring） |

## 4. 非目标

- 不改变任何 HTTP 路由的外部行为（路径/方法/响应形状）
- 不改变任何事件的消费顺序（表驱动化但不重排）
- 不改变启动顺序的语义
- 不新增路由（只迁移已有的）

## 5. 设计

### 5.1 目标文件结构

```
gateway/src/
├── index.ts             # < 100 行：import kernel; kernel.start()
├── boot.ts              # ~200 行：启动序列
├── kernel.ts            # ~400 行：组合根
├── http-router.ts       # ~300 行：HTTP 入口
├── event-dispatch.ts    # ~200 行：事件消费表
├── subsystems/          # 按域组织
│   ├── memory.ts        # Memory + Cost + MCP + Automation
│   ├── goal.ts          # NodeDriver + Pod + Goal
│   ├── recall.ts        # Recall + Snapshots + Worker pool
│   ├── sessions.ts      # Session registry + internal roles
│   ├── monitoring.ts    # Health + heartbeat + presence
│   └── api-routes.ts    # 路由注册（RouteRegistry 条目）
├── concurrency/         # Phase A 产物
├── scheduler/           # Phase B 产物
├── session/             # Phase C 产物
├── routes/              # 已有（全部走 RouteRegistry）
├── runtime/             # Runtime Driver Spec 产物（只剩中性契约）
└── ...
```

### 5.2 路由迁移（128 分支 → RouteRegistry 清零）

迁移策略：
1. 把 index.ts 内所有 `req.url?.match` 块识别并分类
2. 每个块创建对应的 `routes/*.ts` 文件（很多已有，只是没注册到 RouteRegistry）
3. 注册 operationId + handler 到 RouteRegistry
4. `http-router.ts` 只做 auth → registry → 404
5. legacy if 链逐段删除

AGENTS §6.5 的正则锚定教训写进 lint 规则：
```yaml
# 不允许 req.url?.match 不带 (?:\?|$) 锚定
```

### 5.3 事件分派表驱动化

现状：`handleOpencodeEvent` 200+ 行顺序敏感 if 链，消费顺序只在注释里。

改法：
1. 在 `EVENT_FLOW_MATRIX` 增加 "gateway 消费优先级" 列
2. 每行声明：事件类型 → 处理函数 → 消费顺序号
3. `event-dispatch.ts` 按拓扑排序执行
4. 把 "approval 先于 internal drop" / "goal_node 先于 sid 分发" 从注释变成可断言的拓扑

```ts
// event-dispatch.ts
const DISPATCH_TABLE: Array<{
  event: string;
  order: number; // 拓扑层
  handler: (event: MafwEvent, ctx: KernelContext) => void;
}> = [
  { event: 'permission.asked', order: 0, handler: handleApproval },
  { event: 'session.created', order: 1, handler: handleSessionCreated },
  { event: 'turn.completed', order: 5, handler: handleTurnCompleted },
  { event: 'goal_node', order: 2, handler: handleGoalNode },
  // ...
];
```

### 5.4 eventBus 与 EventStore 统一

现状：进程内 eventBus（EventEmitter，fire-and-forget）与持久 EventStore（SQLite seq）是两套通道。

改法：
- eventBus 事件统一走 EventStore 序列化（同 seq 空间）
- 消灭双通道——所有事件消费者从 EventStore 回放或订阅 SSE

### 5.5 启动序列

```ts
// boot.ts
async function boot(config: GatewayConfig): Promise<Kernel> {
  // 1. 日志
  installFileLogging();
  // 2. 数据库迁移（版本号驱动）
  await migrateDatabase();
  // 3. 数据目录迁移（幂等）
  await migrateDataDirs();
  // 4. 组合根
  const kernel = new Kernel(config);
  // 5. 服务启动（按依赖拓扑排序）
  await kernel.startServices();
  // 6. HTTP 服务器
  await kernel.startHttp();
  // 7. 恢复（Goal / RunState / Registry / event_log）
  await kernel.recover();
  // 8. 自动化规则
  kernel.startAutomation();
  return kernel;
}
```

依赖检查：每个 step 声明前置条件，启动时验证（当前是隐式的）。

## 6. 测试策略（TDD）

### 架构守卫测试扩展

1. `index.ts` < 1000 行
2. `gateway/src` 无 `req.url?.match`（路由纪律）
3. `EVENT_FLOW_MATRIX` 消费顺序拓扑可断言
4. 启动序列有依赖检查

### 行为等价测试

- 全部 HTTP 路由 golden 对照（迁移前后响应形状一致）
- 全部事件消费 golden 对照（迁移前后分派行为一致）
- 启动序列 golden（迁移前后服务可用性一致）

### 已有测试

- 现有 4798+ 测试是安全网
- 架构守卫测试（`architecture-boundaries.test.ts`）扩展覆盖新模块

## 7. 验收标准

- [ ] `index.ts` < 1000 行
- [ ] `boot.ts` / `kernel.ts` / `http-router.ts` / `event-dispatch.ts` / `subsystems/` 存在
- [ ] 所有路由走 RouteRegistry（legacy if 链清零）
- [ ] `handleOpencodeEvent` 是表驱动
- [ ] eventBus 与 EventStore 统一 seq 空间
- [ ] 启动序列有显式依赖检查
- [ ] 全量测试绿
- [ ] CI 守卫：
  - `index.ts` 行数 < 1000
  - `gateway/src` 无裸 `req.url?.match`
  - `EVENT_FLOW_MATRIX` 拓扑排序可断言

## 8. 留给 builder 的决定

- subsystems 的划分粒度（5 个 vs 更多）
- 路由迁移的优先顺序（建议从 dashboard 兜底开始——它们在最底部，删除不影响其他路由）
- eventBus 统一到 EventStore 后，同步消费者的迁移窗口
