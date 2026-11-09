# Gateway 内核重构：统一并发原语（Phase A）

日期：2026-11-09
状态：待批准
前置：无（可与 Runtime Driver Spec 并行）
关联设计：
- `2026-11-09-neutral-runtime-driver-architecture-design.md`（驱动层，另一 agent 推进）
- `docs/research/` 底层审计报告（子代理产出，本 spec 的事实源）

## 1. 意图与为什么

Gateway 有 **7+ 种手写并发原语**做同一件事——"同一 key 不并发"——但语义分裂为五种：skip / merge / reject / drop / queue。每种原语本身正确，但缺乏统一抽象，导致：

1. 新人无从知道该用哪种（只存在于各文件头部注释）；
2. `snapshotBuildInFlight` 用 drop 代替调度优先级，是静默降级；
3. 同一抽象 12 处手写实现，修改一处语义时其他处不跟随。

**OS 原则**：内核提供少量正交同步原语（spinlock / semaphore / rwlock），驱动不自己实现锁。

## 2. 现状盘点（7+ 种手写原语）

| 原语 | 位置 | 语义 | 问题 |
|---|---|---|---|
| `runExclusive` single-flight | `recall/session-worker-pool.ts` L103-112 | 同 key 合并到同一 promise | 正确 |
| `WriteQueue` 串行队列 | `memory/write-queue.ts` | FIFO 排队 | 正确 |
| `PipelineGuard` per-key + watchdog | `recall/pipeline-guard.ts` L32-58 | 在飞 skip + 30min 强制释放 | 正确 |
| `managerSessionInflight` | `index.ts` L9910-9977 | per-project single-flight + joiners | 正确 |
| `singleFlight` | `core/instructions/instruction-sync-service.ts` L103-138 | per-session | 正确 |
| `snapshotBuildInFlight` 布尔互斥 | `index.ts` L2979-3010 | 在飞 **丢弃** | **drop 语义** |
| `pendingSuspend` Set | `core/run/run-coordinator.ts` L46-49 | 409 拒绝 | 正确 |
| `dispatchSeq/activitySeq` 水位 | `core/goal/driver.ts` | 陈旧 idle 不收账 | 正确 |
| `TtlMap` | `recall/ttl-map.ts` | 惰性过期 + sweep + onEvict | 正确 |
| `renameWithRetry` | `core/utils/atomic-write.ts` | Windows EPERM 重试 | 正确 |
| `ttsInflight` Map | `index.ts` L697 | per-session AbortController 集 | 正确 |
| `probeScopes` Map | `index.ts` L661 | 探针范围绑定 | **无 TTL** |
| `registryWriteQueue` promise 链 | `index.ts` L592 | 注册表写串行化 | 正确 |

## 3. 目标

创建 `gateway/src/concurrency/` 模块，提供 **三个正交原语 + 一个资源回收工具**：

```ts
// singleflight.ts —— 同 key 合并
export function singleflight<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T>;

// mutex-queue.ts —— 同 key FIFO 排队
export class MutexQueue<T> {
  run<R>(key: string, fn: () => Promise<R>): Promise<R>;
}

// guard.ts —— 同 key 互斥 + timeout 强制释放
export function guard<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; onTimeout?: 'release' | 'error' },
): Promise<T>;

// ttl-map.ts —— 统一资源回收
export class TtlMap<K, V> {
  constructor(opts: { ttlMs: number; sweepIntervalMs?: number; onEvict?: (key: K, value: V) => void });
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  sweep(): void;
}
```

## 4. 非目标

- 不改变任何现有原语的**外部行为**——迁移是行为等价的
- 不引入 async-lock / p-limit 等外部依赖
- 不重构 scheduler（Phase B）
- 不拆 index.ts（Phase D）

## 5. 迁移清单

### 5.1 迁入 `singleflight.ts`

| 现有 | 迁移后 |
|---|---|
| `runExclusive` | `singleflight(\`${session}:${kind}\`, fn)` |
| `managerSessionInflight` | `singleflight(\`manager:${projectDir}\`, fn)` |
| `instructionSync singleFlight` | `singleflight(\`instructions:${sessionID}\`, fn)` |

### 5.2 迁入 `mutex-queue.ts`

| 现有 | 迁移后 |
|---|---|
| `WriteQueue` | `mutexQueue.run(\`write:${dir}\`, fn)` |
| `registryWriteQueue` | `mutexQueue.run(\`registry\`, fn)` |

### 5.3 迁入 `guard.ts`

| 现有 | 迁移后 |
|---|---|
| `PipelineGuard` | `guard(key, fn, { timeoutMs: 30min, onTimeout: 'release' })` |
| `snapshotBuildInFlight` | `guard(key, fn, { onTimeout: 'release' })`——**语义从 drop 改为排队** |
| `pendingSuspend` | `guard(key, fn, { onTimeout: 'error' })` |
| `ttsInflight` | `guard(key, fn, { onTimeout: 'error' })` |

### 5.4 迁入 `watermark.ts`（新原语）

| 现有 | 迁移后 |
|---|---|
| `dispatchSeq/activitySeq` | `watermark.record(key)` / `watermark.isStale(key, at)` |

### 5.5 迁入 `ttl-map.ts`

从 `recall/ttl-map.ts` 迁移为通用模块，消费方 import 路径改为 `concurrency/ttl-map`。

### 5.6 补 TTL

| Map | 现状 | 改法 |
|---|---|---|
| `eventTaps`（index.ts L628） | 无界 | 加 TTL 5min |
| `probeScopes`（index.ts L661） | 无界 | 加 TTL（= probe timeout） |

## 6. 测试策略（TDD）

每个原语一个测试文件：

- `singleflight.test.ts`：同 key 并发只执行一次 / 不同 key 并行 / 后来者拿到同一结果 / 执行失败后续者可重试
- `mutex-queue.test.ts`：FIFO 顺序 / 不同 key 并行 / 队列长度 / 异常后续者可入队
- `guard.test.ts`：timeout 强制释放 / timeout error / 正常完成不触发
- `watermark.test.ts`：记录 → 过期 → isStale = true / 陈旧帧被拒
- `ttl-map.test.ts`：set → 过期 → get = undefined / sweep / onEvict / 容量帽

行为等价测试：迁移前录制原实现的输出（golden），迁移后逐 case 对照。

## 7. 验收标准

- [ ] `concurrency/` 模块存在且导出 5 个原语
- [ ] `index.ts` 内不再有手写 inflight Map / boolean 互斥 / promise 链
- [ ] `recall/ttl-map.ts` 迁入 `concurrency/`，旧路径 re-export（一个清理周期）
- [ ] `eventTaps` / `probeScopes` 有 TTL
- [ ] `snapshotBuildInFlight` 语义从 drop 变为排队（有行为测试钉住）
- [ ] 全量测试绿
- [ ] CI 守卫：`grep -r "new Map.*inflight\|new Set.*inflight\|new Map.*Inflight" gateway/src/` 只命中 `concurrency/`

## 8. 留给 builder 的决定

- `singleflight` 的缓存失败条目是否要 TTL（当前 `managerSessionInflight` 的行为是失败后清 inflight 让后续重试）
- `watermark` 的过期策略（绝对时间戳 vs 计数器水位）
- `guard` 的 timeout 默认值
