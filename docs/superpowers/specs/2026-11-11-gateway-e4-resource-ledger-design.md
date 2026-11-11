# Gateway E4 资源台账：设计（2026-11-11）

> 来源：58 项清单中的资源台账 8 项。目标：让常驻 gateway 的资源从"OS 兜底"变成"可观测、可强制、可降级"的账本。E1–E3 修已证实的错误；E4 是预防性硬化，不依赖任何已发生的线上事故。

## 1. 意图

Gateway 是长期运行的守护进程，但当前：

- 没有磁盘水位感知（`statfs` 全仓 0 处），数据根写满后只会看到零散写失败；
- 没有连接表/连接上限（`http.createServer` 裸启，SSE/WS 集合无界）；
- SSE/WS 广播不看背压（`res.write` 返回值被忽略，`ws.send` 不看 `bufferedAmount`），慢客户端可让广播缓冲无限涨；
- 长驻 `setInterval` 散落在 15 个文件里，无统一台账/关闭；
- 每个会话可无上限拉起一个 Python 内核进程，无台账；
- 项目/网关会话记录无配额；
- 没有堆指标，也没有资源压力下的降级；
- 只有一个很薄的 `/api/stats`（4 个计数器 + token 汇总）。

E4 给这些资源一个单一入口：`ResourceGovernor` 采样 + 各 provider 记账 + `/api/kernel/stats` 出口 + 压力降级。所有上限制裁都是**显式、可配置、可观测**的，正常路径的响应形状不变（新增拒绝路径除外）。

## 2. 非目标

- 不做 E5 的身份/交互模型（per-client principal、event_log 作为恢复源、desktop 单点扇出、mobile 增量消费）。
- 不改 runtime 契约、不改 SDK 主客户端语义、不新增 SDK-facing op。
- 不做全量 timer 迁移：只迁 kernel 自有的长驻 interval（WS 心跳/设备清理、SSE keepalive、Python sweep、governor 采样）；短命 retry/sleep/超时不动，插件/外围 loader 的 interval 留给后续波次。
- 不在 Windows 上强行统计精确 FD 数；连接数 + `process.getActiveResourcesInfo()` handle 计数是跨平台口径，Linux 的 `/proc/self/fd` 仅作增强、不作为门禁。
- 不重构 dashboard legacy 分发器；`/api/stats` 原样保留，新面只走 `/api/kernel/stats`。

## 3. 架构

```
kernel
 ├─ TimerService (core/timer-service.ts)          ← 命名定时器、stats、disposeAll
 ├─ ResourceGovernor (resources/governor.ts)      ← 采样 disk/heap + 压力状态机
 │    ├─ sampleDisk (resources/disk.ts)
 │    └─ sampleHeap (resources/heap.ts)
 ├─ ConnectionTable (resources/connections.ts)    ← HTTP/SSE/WS/voice/terminal 计数 + 上限
 ├─ ProcessLedger (resources/process-ledger.ts)   ← python/llamacpp/serve 台账 + python 并发帽
 ├─ QuotaService (resources/quotas.ts)            ← projects/sessions 配额
 ├─ SseBoundedWriter (resources/outbound-buffer.ts) ← SSE 背压队列
 └─ GET /api/kernel/stats (routes/kernel-stats.ts) ← 聚合出口
```

命名整理：`gateway/src/resources/sdk-session.ts` 与资源台账无关，移到 `gateway/src/runtime/sdk-session.ts`；`resources/` 专用于台账。

依赖方向：provider 不 import kernel；kernel 组装并注入 live config getter。所有上限/阈值从 `config.resources` 实时读取（hot reload 生效），组件不缓存配置对象。

## 4. 逐项设计

### E4-1 TimerService 注册表

`core/timer-service.ts`：

```ts
interface TimerHandle { readonly name: string; clear(): void; }
class TimerService {
  every(name, ms, fn, opts?: { unref?: boolean }): TimerHandle;
  after(name, ms, fn, opts?: { unref?: boolean }): TimerHandle;
  clear(handle: TimerHandle): void;
  clearByPrefix(prefix: string): number;
  disposeAll(): void;
  stats(): { active: number; byName: Record<string, number> };
}
```

- 名称唯一；重复 `every` 同名抛错（防两个子系统互相覆盖）。
- 默认 `unref: true`；`clear` 幂等。
- 迁移 kernel 自有长驻 interval：
  - `http/ws-upgrade.ts`：`ws:ping`（30s）、`ws:device-cleanup`（60s）；
  - `events/sse-attach.ts`：`sse:ping:<connectionId>`（15s），连接关闭即 clear；
  - `python/kernel-service.ts` `SessionKernels`：`python:sweep`（5min）。
- `dispose()`/`disposeAll()` 必须清空本组 handle；测试用 fake timers 断言无残留。

### E4-2 磁盘 statfs + 低水位降级

`resources/disk.ts`：`sampleDisk(path, statfsFn)` → `{ totalBytes, freeBytes, state: 'ok'|'warn'|'critical'|'unknown', error? }`。

- 采样 `config.resolvePath()`（`~/.mafw` 数据根），异步 `fs.statfs`；失败 → `unknown`，**不降级**（fail-open）。
  `error` 只放机器码（有 `err.code` 用 `err.code`，否则 `'statfs_failed'`），**不得转发原始 message**
  （带数据根路径，会经 `/api/kernel/stats` 泄露）。
- 默认阈值：warn **2 GiB** 可用、critical **512 MiB** 可用；每 **30s** 采样一次，启动时立即采一次。
- 带回滞：critical 需回到 `critical × 1.5`（768 MiB）才降级为 warn；warn 需回到 `warn × 1.1`（2.2 GiB）才回 ok；ok→warn→critical 按阈值立即升级。
- critical 动作：
  - 后台/空闲 scheduler 任务拒绝（见 E4-3，统一走 `governor.isDegraded()`）；
  - event_log 在进入 critical 的边沿执行一次激进裁剪（保留 `max(100, floor(retention*0.1))` 行）；
  - `POST /api/memory/add` 返回既有 200 形状 `{ success:false, error:'disk space critical', code:'disk_low' }`，不写盘；
  - `POST /api/memory/embeddings/backfill` 返回 503 `{ error, code:'disk_low' }`；
  - media artifact 磁盘写失败已有内存回退，不额外拦截。
- 前台 chat / health / SSE 直播永不因磁盘压力被拒。

### E4-3 堆指标 + 降级

`resources/heap.ts`：`sampleHeap(memoryUsage(), heapLimit())` → `{ heapUsed, heapTotal, rss, external, arrayBuffers, heapLimit, ratio, state }`。

- 默认 warn ratio **0.75**、critical **0.9**；回滞 0.05（critical 回到 <0.85 才 warn，warn 回到 <0.70 才 ok）。
- 采样与磁盘共用 `governor:sample` 定时器。
- critical 动作：scheduler 的非 foreground 任务拒绝（`budgetChecker` 返回 `{ok:false, reason:'resource pressure'}`），foreground 永远放行；恢复后自动重新接纳。
- 不在 E4 里强制 GC；不阻断 `memory.add`（堆压力不等于写盘危险）。

### E4-4 连接表 + 上限

`resources/connections.ts`：

- `ConnectionTable` 统计 `httpOpen`（server `connection` 事件的 socket 数）与逻辑连接 `sse/ws/voice/terminal`。
- `tryAcquire(kind)` 返回 lease 或 null；`lease.release()` 幂等；`refused` 按 kind 计数。
- 限额：HTTP **256**（同时设 `server.maxConnections` 硬帽）、SSE **64**、WS **64**、voice **16**、terminal **16**；`0` = 不限。
- SSE 超限：`503 { error:'too many sse connections', code:'connection_limit' }`，不建立流。
- WS/voice/terminal 超限：upgrade 阶段直接回 503（不升级）；已建立的连接在 close/error 时 release。
- FD：`process.getActiveResourcesInfo()` 按类型计数进 stats；Linux 额外读 `/proc/self/fd` 目录数（读失败静默）。**不设硬 FD 上限**（Windows 不可移植）。

### E4-5 有界出站缓冲

`resources/outbound-buffer.ts`：

- `SseBoundedWriter`：包装 `ServerResponse.write`。
  - `res.write(frame)` 返回 false → 进入 paused；后续帧入队；
  - 收到 `drain` → 按序 flush，直到再次 false 或队空；
  - 队列超过 `sseMaxFrames`（默认 256）或 `sseMaxBytes`（默认 1 MiB）→ `res.destroy()`，标记 overflow，清空队列；
  - `dispose()` 移除 `drain` listener；计数 `{ queuedFrames, queuedBytes, overflows }`。
- WS：广播前检查 `ws.bufferedAmount > wsMaxBufferedBytes`（默认 1 MiB）→ `terminate()` + 从 `wsClients` 删除，计数 `wsDropped`。
- 语义：断开慢客户端是安全的——SSE 客户端用 `since`/Last-Event-ID 重连回放；WS 是 live-only，重连后走 REST 快照（E2 已裁决）。
- 迁移 SSE 的 `writeFrame` 到 writer；EventHub 的 `sseClients` value 仍是 `(frame, seq) => void` 闭包，不改变广播接口。

### E4-6 子进程台账 + 并发帽

`resources/process-ledger.ts`：

```ts
type ProcessKind = 'python' | 'llamacpp' | 'serve';
interface ProcessEntry { id; kind; pid?; sessionId?; label?; startedAt; }
class ProcessLedger {
  register(entry): ProcessHandle;   // handle.release() 幂等
  count(kind?): number;
  list(): ProcessEntry[];
  snapshot(): { total; byKind; entries };
  disposeAll(): void;               // 调 close 钩子
}
```

- Python：`SessionKernels` 注入 ledger + `maxKernels`（默认 4）。
  - 新建内核前若已达上限：先驱逐 `lastUsed` 超过 10 分钟的空闲内核；仍满 → 抛 `QuotaExceededError('python_kernels', limit, current)`，`POST /api/python/execute` 映射 429。
  - 台账条目是**会话作用域的逻辑槽位**（`kind:'python'` + `sessionId` + `owned:true`），不代表"此刻有活 pid"：
    内核进程崩溃/退出后条目仍保留到下一次 `sweep`（TTL 1h）或 `disposeAll`，期间 `pid` 可能缺省
    （`KernelManager.getPid()` 未启动/已退出时为 `undefined`）。客户端不得把条目数当作子进程数。
  - `disposeAll` 释放全部并清 `python:sweep`（E4-1 命名 timer）。
- LlamaCpp：spawn 时 register（`pid` 可取，`owned:true`），exit/stop 时 release；不设并发帽（单例）。
- Runtime serve：adapter 拥有进程，E4 只在 gateway 侧记录逻辑条目（`serve`，最多 1 条），不假装能 kill 它；
  条目 `owned:false`，**只在 `serveInstance` 真的存在时**登记（能力存在 ≠ 进程存在，见 §4.8 `serve` 与
  `processes.entries[].owned` 的口径区分）。`serve.running` 就是 `!!serveInstance`（不额外探测进程存活）。
- `disposeAll` 在 kernel shutdown 调用（先 `serveLedger.release()`），确保测试不留子进程。

### E4-7 项目/会话配额

`resources/quotas.ts`：

```ts
class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';
  constructor(readonly resource: string, readonly limit: number, readonly current: number)
}
class QuotaService {
  assert(resource: QuotaResource, current: number): void; // 0 = unlimited
  snapshot(currents): { [resource]: { current, limit } };
}
```

- `projects`（默认 128）：在 kernel 的 `registerProject` API 入口检查；已存在同目录的重复注册放行。超限抛错，transport `/register` 捕获 → 429 `{ error, code:'quota_exceeded', resource:'projects', limit, current }`；文件系统 watcher 的自动注册超限只 log + skip。
- `sessions`（默认 1000）与 `sessionRecordsPerProject`（默认 200）：在 `SdkSessionResource.create` / `registerExternal` 检查（按 `projectID || directory` 分组）；超限抛错，`handleSessionCreate` 映射 429。内部调用（manager/lead 会话）失败按现有 catch 语义降级为 log。
- `activeGoals` 不进 E4 配额（goal 启动路径是异步队列，强行 429 会改变 pod 语义；留给 E5 身份/编排波次）。
- 所有配额 `0` = 不限；默认值偏高，只提供机制与可观测，不激进阻断。

### E4-8 `/api/kernel/stats`

新 catalog op `kernel.stats`（`NON_SDK_ROUTES`，`tags:['internal']`，带 response schema），handler `routes/kernel-stats.ts` 挂到 `attachAllRoutes`，满足 E3 可达性守卫。

响应形状（additive；缺省 provider 时字段为空而不是报错）：

```jsonc
{
  "timestamp": "2026-11-11T...",
  "uptimeSec": 1234,
  "pressure": { "disk": "ok|warn|critical|unknown", "heap": "ok|warn|critical", "degraded": [] },
  "disk": { "totalBytes": 0, "freeBytes": 0, "state": "ok", "error": null },
  // heap 可空：采样器还没有第一个样本时是 null（不是零值对象）。
  "heap": { "heapUsed": 0, "heapTotal": 0, "rss": 0, "external": 0, "arrayBuffers": 0, "heapLimit": 0, "ratio": 0, "state": "ok" }, // | null
  "connections": { "httpOpen": 0, "sse": 0, "ws": 0, "voice": 0, "terminal": 0, "limits": {}, "refused": {} },
  // buffers 是 BufferCounters.snapshot() 的**平铺**口径（E4-5 单一记账源）。
  // 未来新增计数只许加键，客户端必须忽略未知键（additionalProperties: true）。
  "buffers": {
    "sseOverflows": 0, "sseDropped": 0, "sseWriteErrors": 0,
    "sseQueuedFrames": 0, "sseQueuedBytes": 0, "wsDropped": 0
  },
  "timers": { "active": 0, "byName": {} },
  "processes": { "total": 0, "byKind": {}, "entries": [] },
  // 三键必填（schema required）；缺键的 provider 由 builder 补齐。
  "quotas": {
    "projects": { "current": 0, "limit": 128 },
    "sessions": { "current": 0, "limit": 1000 },
    "sessionRecordsPerProject": { "current": 0, "limit": 200 }
  },
  "handles": { "total": 0, "byType": {}, "fdCount": 0 }, // fdCount 仅 Linux 采样，其余平台缺键
  "scheduler": { "queued": 0, "running": 0, "byPriority": {} },
  "events": { "headSeq": 0, "appendFailures": 0 },
  "serve": { "running": false, "owned": true }
}
```

- `buffers` 曾在本节画成嵌套 `{ sse: { queuedFrames, ... } }` 示意；实现以 `BufferCounters.snapshot()` 的
  平铺口径为准（该聚合在 E4-5 已定稿，嵌套形状会丢掉 `sseWriteErrors`）。这是 wire 现状，不再回退。
- `limit` / `limits.*` 的 **0（含负数）= 不限**，不是"配额为 0"；`limit` 只输出有限整数
  （有限正值向下取整，与 `limitOf` 的执行值一致；`Infinity`/`NaN` 在 JSON 里会变 `null`，出口统一归一化为 0）。
- `handles.fdCount` 只在 Linux 读 `/proc/self/fd` 时出现（schema Optional，读失败静默）；
  Windows/macOS 客户端不得假设该键存在。
- `serve.owned` 与 `processes.entries[].owned` 是两个口径：
  - `serve.owned` 回答"gateway 是否亲手 spawn 了 runtime serve 进程"（`serveOwned`）：
    gateway 受管启动 / 重启时为 `true`（示例 `true` 即受管启动），external / adopted serve 为 `false`；
    `running` 表示此刻是否存在 serve 实例（`!!serveInstance`，不额外探测进程存活）；
  - `processes.entries[].owned` 回答"台账条目对应的进程是否由 gateway 托管关闭"（python/llamacpp 为
    `true`，serve 逻辑条目为 `false`）。两者不得互相推导。
- `processes.byKind.serve` 只在 serve 实例存在时出现（能力-only 不登记）。
- 不返回数据根路径、文件内容、FCM token 等敏感信息；process `entries` 仅 `{kind,pid?,sessionId?,startedAt,owned?}`。
- 鉴权沿用现有 token/loopback 规则（internal 路由，不新增认证面）。

## 5. 配置

`GatewayConfig` 新增 `resources`（deep merge，缺省自动补全；hot reload 生效）：

```yaml
resources:
  sampleIntervalMs: 30000
  disk:
    warnFreeBytes: 2147483648      # 2 GiB
    criticalFreeBytes: 536870912   # 512 MiB
  heap:
    warnRatio: 0.75
    criticalRatio: 0.9
  limits:
    httpConnections: 256
    sseClients: 64
    wsClients: 64
    voiceClients: 16
    terminalClients: 16
    pythonKernels: 4
    projects: 128
    sessions: 1000
    sessionRecordsPerProject: 200
  buffers:
    sseMaxFrames: 256
    sseMaxBytes: 1048576
    wsMaxBufferedBytes: 1048576
```

- 数值 `<= 0` 的配额/连接上限视为不限；比例 clamp 到 `(0,1)`。
- 不新增专用环境变量；沿用现有 `MAFW_<SECTION>_<KEY>` 覆盖机制。配置热更新由现有 `config.reload()` 路径覆盖。

## 6. 降级矩阵

| 压力 | 前台 chat/health | 后台 scheduler | memory.add | event_log | 连接/缓冲 |
|---|---|---|---|---|---|
| disk warn | 正常 | 正常 | 正常 | 正常摊销裁剪 | 正常 |
| disk critical | 正常 | 拒绝非 foreground | 200 `{success:false, code:'disk_low'}` | 边沿裁剪到 10% | 正常 |
| heap warn | 正常 | 正常 | 正常 | 正常 | 正常 |
| heap critical | 正常 | 拒绝非 foreground | 正常 | 正常 | 正常 |

恢复：压力状态按回滞回到 ok 后自动恢复接纳；不在恢复时补跑被拒任务。

## 7. 测试策略

TDD；每个 provider 是纯函数/可注入时钟与系统调用，单测不依赖真实磁盘/内存压力：

- TimerService：fake timers、同名冲突、clear/disposeAll、stats。
- disk/heap：注入 statfs/memoryUsage/heapLimit，覆盖阈值、回滞、unknown fail-open。
- connections：lease 幂等、按 kind 限额、0=不限、refused 计数。
- buffer：fake `res.write` 返回 false + `drain`、overflow destroy、字节/帧双上限。
- process ledger：register/release/幂等、python 上限驱逐 idle、仍满抛 QuotaExceededError。
- quotas：projects/sessions 边界、0=不限、429 映射。
- kernel stats：路由形状、catalog 可达性守卫、schema 产物、无 provider 时 fail-open。
- 集成：transport `/register` 429、`handleSessionCreate` 429、python execute 429、SSE 超限 503、slow-client 断开、scheduler 降级。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 上限默认值误伤现有用户 | 默认值偏高；配额 0=不限；连接/缓冲上限可配置；拒绝路径带明确 code |
| 断开慢 SSE 客户端导致丢事件 | 客户端已用 `since`/Last-Event-ID 重连回放（E2）；断开是安全动作 |
| `server.maxConnections` 影响 WS/移动端 | 默认 256 远高于实际；WS/SSE 另有独立软帽；可配置 |
| 磁盘 critical 误判导致不写记忆 | 仅 `<=512MiB` 触发；statfs 失败 fail-open；只拦重型写，不拦前台 |
| TimerService 迁移引入关闭顺序问题 | 只迁 4 个 kernel 自有 interval；dispose 幂等；保留各自原有 unref 语义 |
| 进程台账记录不准 | Python 用真实 spawn/exit 钩子；serve 标注 `owned:false`；stats 只作观测 |
| 新增 stats 端点泄露信息 | 只返回计数/比率/pid，不返回路径与内容；沿用 internal 鉴权 |

## 9. 兼容性

- 正常路径响应不变；新增拒绝路径：SSE/WS 连接上限（503/upgrade 拒绝）、项目/会话配额（429）、python 并发帽（429）、磁盘 critical 的 memory.add（既有 200 形状 + `code`）。
- `/api/stats` 保持不变；`/api/kernel/stats` 是新面。
- SDK 不需要改动；`kernel.stats` 标 internal、非 SDK-facing。
- 无数据库 schema 变更；event_log 只新增裁剪方法，不改表。
