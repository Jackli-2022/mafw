# Gateway 内核重构：统一会话注册表 / 进程表（Phase C）

日期：2026-11-09
状态：已实施（2026-11-10，分支 feat/gateway-kernel-session-registry；实现注记见 §9）
前置：Phase A（`concurrency/` 提供原语）；Runtime Driver Spec Phase 3 完成后更顺畅（opencode/pi session 逻辑已移入 adapter）
关联设计：
- `2026-11-09-gateway-kernel-concurrency-design.md`（Phase A）
- `2026-11-09-neutral-runtime-driver-architecture-design.md`（驱动层）

## 1. 意图与为什么

Gateway 有 **六个分散的会话注册表**管理不同角色的 session 生命周期。"这个 sessionID 现在归谁管、何时销毁"要跨 5 个文件才能回答。

**OS 原则**：一个进程表（process table）回答"PID → 归属 / 状态 / 资源"；单一 GC 责任。

## 2. 现状盘点（六个注册表）

| 注册表 | 位置 | 管什么 | 问题 |
|---|---|---|---|
| `PiSessionRegistry` | `runtime/pi/pi-session.ts` | pi 的 sessions/directories/approvalBridges/pendingMedia 六张 Map | `lastUsed` 被 touch 但没有驱逐消费方 |
| `internalSessionRoles` | `index.ts` L2354-2364 | 内存 Map + kv 双写；worker/media/lead/btw 标记 | ✅ 有 kv 持久化 |
| `LeadSessionRegistry` | `runtime/` | active-runtime slot + Pod coordination + 活性探测 | 独立实现 |
| `PodSessionSupervisor` | `core/pod/pod-session-supervisor.ts` | `(pod, member, goal, revision, kind)` 作用域租约 + generation | **最成熟**（唯一索引兜底 / 单飞 / 冲突归因） |
| `SessionWorkerPool` | `recall/session-worker-pool.ts` | maxSessions=64 驱逐 + TtlMap 24h | ✅ 有驱逐 |
| `workerOriginMap` | `runtime/worker-origin.ts` | worker session → 源 session 映射 | 独立 Map |

已知泄漏面：
- `eventTaps`（index.ts L628）：conformance 临时观察者，无 TTL
- `probeScopes`（index.ts L661）：探针范围绑定，无 TTL
- `translationErrors/Drops` 计数 Map：无界增长（仅计数不膨胀内容，风险低）

## 3. 目标

创建 `gateway/src/session/` 模块，把六个注册表收编为 **一个统一进程表 + 六个视图**：

```
gateway/src/session/
├── registry.ts          # 统一进程表：sessionID → 归属/状态/资源/TTL
├── scope.ts             # 作用域 key：(project | goal:revision | probe | worker | lead)
├── lease.ts             # 租约生命周期（创建/复用/退休/generation）
├── sweeper.ts           # 统一 TTL 回收（替代各自 sweep）
└── views/               # 现有注册表变成视图
    ├── pi-view.ts
    ├── internal-roles-view.ts
    ├── lead-view.ts
    ├── pod-view.ts
    ├── worker-pool-view.ts
    └── origin-view.ts
```

## 4. 非目标

- 不改变任何注册表的**外部行为**——迁移是行为等价的
- 不合并 PodSessionSupervisor 的作用域语义（它最成熟，作为参考模型）
- 不做跨进程 session 管理（Runtime Driver Spec 管进程边界）
- 不拆 index.ts（Phase D）

## 5. 设计

### 5.1 进程表数据模型

```ts
interface SessionRecord {
  sessionID: string;
  /** 谁拥有这个会话（角色/作用域）。 */
  scope: SessionScope;
  /** 当前状态。 */
  status: 'active' | 'idle' | 'ended';
  /** runtime 名（诊断面）。 */
  runtimeName?: string;
  /** 租约世代（重建 +1）。 */
  generation: number;
  /** 最近活跃时间。 */
  lastActiveAt: number;
  /** TTL 过期时间（null = 不过期）。 */
  expiresAt: number | null;
  /** 附加数据（原注册表各自的 Map value）。 */
  metadata: Record<string, unknown>;
}

interface SessionScope {
  kind: 'project' | 'goal' | 'probe' | 'worker' | 'lead' | 'internal';
  projectId?: string;
  goalId?: string;
  revision?: number;
  podId?: string;
  memberId?: string;
  role?: string;
}
```

### 5.2 统一查询

```ts
class SessionRegistry {
  /** 按 sessionID 查（单一查询入口）。 */
  lookup(sessionID: string): SessionRecord | null;
  /** 按作用域查（返回该作用域全部活跃 session）。 */
  byScope(scope: Partial<SessionScope>): SessionRecord[];
  /** 注册/更新。 */
  register(input: { sessionID: string; scope: SessionScope; metadata?: Record<string, unknown>; ttlMs?: number }): void;
  /** 注销。 */
  unregister(sessionID: string): boolean;
  /** 触碰活跃时间。 */
  touch(sessionID: string): void;
  /** 统一扫描回收。 */
  sweep(): number; // 回收数
}
```

### 5.3 现有注册表变成视图

每个现有注册表改为消费 `SessionRegistry`：

| 原注册表 | 迁移方式 |
|---|---|
| `PiSessionRegistry` | 其六张 Map 的内容存入 `metadata`；`byScope({kind:'worker'})` 查询替代直接 Map 读 |
| `internalSessionRoles` | `register({scope:{kind:'internal', role:'worker'}})`；kv 双写保持 |
| `LeadSessionRegistry` | `register({scope:{kind:'lead'}})`；活性探测逻辑保留在 Lead 层，Registry 只管记账 |
| `PodSessionSupervisor` | **不合并核心逻辑**（它的唯一索引兜底 / 单飞 / 冲突归因太成熟）；只把 lease 信息同步到 Registry 作为视图 |
| `SessionWorkerPool` | 驱逐消费 `Registry.sweep()` 的结果 |
| `workerOriginMap` | `metadata.originSessionID` |

### 5.4 补 TTL

| Map | TTL |
|---|---|
| `eventTaps` | 5min（conformance 临时观察者） |
| `probeScopes` | = probe timeout（driver 已有） |

### 5.5 统一 sweeper

现有分散的 TTL 扫描统一为一个入口：

| 现有 sweep | 位置 | 统一后 |
|---|---|---|
| `SessionWorkerPool` TtlMap 24h | `session-worker-pool.ts` | `Registry.sweep()` |
| `MemoryWorker` compactIdleMs 8h | `memory-worker.ts` | `Registry.sweep()`（onEvict 回调触发 compact） |
| `sweepBusyAndQueue` 15min 假 busy | `index.ts` L3307-3328 | `Registry.sweep()` 前置检查 |
| `PodSessionSupervisor` lease 检查 | `pod-session-supervisor.ts` | 保持自有逻辑，Registry 只观察 |

## 6. 测试策略（TDD）

- **单一活跃租约**：任何 sessionID 在 Registry 中只有一条记录
- **TTL 过期**：set → 过期 → lookup 返回 ended / sweep 回收 + onEvict
- **generation 递增**：ensure 复用存活 → isAlive=false → retire → ensure 重建 → generation+1
- **作用域查询**：`byScope({kind:'goal', goalId:'x'})` 返回该 goal 全部会话
- **kv 双写**：internal role 注册后 kv `internal-session` 可读；重启后可恢复
- **sweep 一次触发**：不在多个注册表重复 sweep

## 7. 验收标准

- [ ] `session/registry.ts` 存在且导出 `SessionRegistry`
- [ ] `eventTaps` / `probeScopes` 有 TTL
- [ ] `index.ts` 内不再有裸 `Map<string, ...Session...>` / `Map<string, ...session...>`
- [ ] 六个注册表通过视图消费 Registry（PodSessionSupervisor 只做观察同步）
- [ ] 统一 sweeper 替代各自 TTL 扫描
- [ ] `lookup(sessionID)` 单一查询可用
- [ ] 全量测试绿
- [ ] CI 守卫：`grep -r "new Map.*[Ss]ession" gateway/src/ --include="*.ts"` 只命中 `session/`

## 8. 留给 builder 的决定

- `metadata` 的类型安全（泛型 vs `Record<string, unknown>`）
- kv 持久化范围（internalSessionRoles 已有；其他是否也需要）
- PodSessionSupervisor 的观察同步频率（实时 vs 定期）

## 9. 实现注记（2026-11-10，Phase C 落地时的裁决）

- **PiSessionRegistry 排除**：§2 盘点把它列在 `runtime/pi/pi-session.ts`，但 neutral
  runtime driver 工作已把 pi 会话迁入 `adapters/pi/src/pi-session.ts`（网关外）。
  网关进程表只覆盖网关自有状态；耦合适配器内部状态会逆着驱动层架构走。
- **eventTaps / probeScopes TTL**：Phase A 已用 TtlMap 完成，验收项 2 预先满足。
- **metadata 类型**：`Record<string, unknown>`（§8 选项 A），视图在边界自校验。
- **kv 持久化**：仅 internalSessionRoles 的既有双写保留；其他视图原本就是内存态。
- **pool 的关键修正（builder ruling，推翻 §5.3 表格原文的该行）**：pair 缓存**留在
  TtlMap**——它以**源会话**（用户会话）为键，迁入注册表会把用户会话错标
  `kind:'worker'`。改为 **worker 会话本身**（w-* sid）在 onSessionCreated 注册
  （role+origin+TTL），随 pair touch/逐出/overflow/disposeAll 同步注销；
  「驱逐消费 Registry.sweep()」由 per-record onEvict + 60s 统一 sweeper 达成。
- **统一 sweeper**：index.ts 60s `sessionRegistry.sweep()`；`sweepBusyAndQueue` 与
  memory-worker `compactIdleMs` 不并入（活跃簿记/策略检查，非进程表状态）。
- **CI 守卫偏差**：§7 的字面 repo-wide `new Map.*[Ss]ession` grep 会命中合法留下的
  活跃簿记（busySessions、recallCalledBySession）与 driver mutex；实际守卫按
  「已迁移文件不得回潮裸 Map」钉扎（regression-guard.test.ts）。
- **世代语义**：active 上重注册=原地更新（scope 可被新 owner 接管、metadata 合并）；
  ended/回收后重注册 `generation+1`（`retiredGenerations` 10k FIFO stash，跨 sweep
  保持 §6 的「retire → 重建 → +1」）；首次注册 generation=1。
