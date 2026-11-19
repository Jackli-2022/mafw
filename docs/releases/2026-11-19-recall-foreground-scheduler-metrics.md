# 2026-11-19 · Recall 前台隔离、scan 调度与分段指标

## 交付标识

- Gateway：**v5.1.0**
- 基线：**`87bc47305`**
- 代码提交：**`a485cb1d1`**（本地 main，未 push）
- 运行验证：Gateway v5.1.0，PID 48960，instance `1e7b00b7-018a-4c8a-97bf-952d4e5d0e8a`，health `ok`
- 实施与 review 子代理：`gateway/volcengine/deepseek-v4.1-flash`
- 计划：`docs/superpowers/plans/2026-11-19-recall-foreground-scheduler-metrics.md`

## 1. 实现

### 边界前台保护

`Scheduler.enterForeground(): () => void` 让 HTTP `/api/recall/context` 复用 scheduler 的真实 `foregroundInFlight`。release 幂等、支持嵌套，并在统一 finally 中释放；getter/acquire/release 异常均 fail-open。

该保护只阻止新的 `defer-to-idle` 工作启动，**不抢占已经运行的后台任务**，也不承诺消除所有尖峰。

### Index scan 调度

`ScanHttpDeps.schedulePrefetch` 可选注入；生产环境由 kernel 提交为 background + defer-to-idle，与 snapshot build 共用全局 `snapshot` mutex。未注入时保留旧 direct prefetch。

调度同步 throw/rejection 会记录带 sessionID 的日志并跳过可选 scan，不在前台补跑。scan 与 snapshot 的跨 session 串行是有意代价，会推迟 R8 构建。

### 有界 completion 等待

runtime `CompletionChannel.complete` 现在由 `withTimeout` 限制在 `recall.scanTimeoutMs` 内；超时进入既有 fail-open/cooldown，正常释放 scheduler mutex，不再回退 direct HTTP 造成二倍持锁。期限内 rejection 保留旧 direct 回退；late settle/reject 被消费，不写旧 snapshot、不产生 unhandled rejection。

### 指标出口

新增 `GET /api/recall/metrics`，返回有界 ring 的新鲜副本和 request/snapshotDecision/clientAborted 计数。

新增/接线：

- `dense`：boundary dense compute + deadline wait（默认 `boundaryDense=false`，因此可为 0 样本）
- `graph`：首轮 `fetchScored`（BM25 + base graph，dense 开启时也含 RRF 融合）
- `expansion`：`expandQuery`，不含后续结果映射
- `scan`：非空 scan snapshot 的 `mergeScanResults`
- 外层 `search` 仍是整个 `searchRecallMemories`，不等于子阶段之和

Route catalog、OpenAPI、SDK 生成物及 architecture/api-contract 台账均已同步。

## 2. 测试与审查

- **新增测试：36 个**（13 + 7 + 10 + 6）
- 每个生产任务均有真实 RED→GREEN；最终锁释放测试也通过临时回退验证 RED
- 父会话 focused：**176 suites / 1806 tests，1806 passed**
- 父会话全量：**1065 suites；8616 passed / 7 failed / 2 skipped**
- 剩余 4 个失败 suite：
  - `runtime/validate-shape`
  - `runtime/architecture-boundaries`
  - `runtime/prompt-budget-wiring`
  - `architecture/legacy-route-inventory`
- 这些失败对应共享 main 其他会话的 `sessionChildrenApi`、prompt 调用形状和既有 `/health`/`isLocal` 源码 pin；本切片新增的 route/schema/error/api-contract 台账全部通过
- Gateway `npx tsc --noEmit -p tsconfig.json`：exit 0
- `npm run build`：成功
- 每任务独立 review + 跨任务 final review + fix 后 scoped re-review：最终 Ready to merge Yes

## 3. 部署后固定 40 条

两轮质量完全一致：

| 指标 | 结果 |
|---|---:|
| AUTO hit | 17/30 |
| exact / current-state / implicit | 10/10 / 6/10 / 1/10 |
| false injection | 0/10 |
| stale injection | 0 |
| agreement | 25/30 |

延迟：

| 轮次 | REST p50/p95 | AUTO p50/p95 |
|---|---:|---:|
| r1（冷/重启窗口） | 31/46ms | 134/191ms |
| r2 | 31/39ms | 136/194ms |

Artifacts：Temp/opencode 下 `personal-recall-foreground-metrics-r1.json`、`personal-recall-foreground-metrics-r2.json`。

**不宣称延迟改善。** 本轮与此前安静窗口的 80/114ms 不可直接比较；前台隔离主要防止新后台启动，不能降低已经在运行的 search/FOK 成本。

## 4. 第一个真实指标样本

80 次固定集请求加 1 次真实 session 请求后，metrics 可读；81 个请求均为 fallback，snapshotDecision 含 stale=1。stage p50/p95：

- search：86/142ms
- graph：81/129ms
- expansion：0/44ms
- FOK：25/34ms
- neighbors：13/17ms
- total：135/193ms
- dense/scan：0 样本（分别因为默认 disabled、无 session scan merge）

`visibleRate=1` 来自服务端点检查，且 runner 不执行 100ms abort，不能解释为真实客户端 visible rate。

## 5. 残留与下一步

1. 收集真实 session 在 scan/snapshot 排队时的前后对照，验证尖峰是否减少；当前没有足够生产样本。
2. search 稳定成本仍需继续拆分；当前证据指向 graph-aware first pass、FOK 和长查询 expansion。
3. 持续前台流量会推迟 snapshot/scan；需后续增加 deferral 深度/等待时长观测。
4. `clientAborted` 仍是偏乐观点检查；不能当作精确可见率。
5. 全量 suite 的 7 个外部失败需由对应 runtime/transport 改动所有者处理。
6. 代码、计划与架构文档已提交为 `a485cb1d1`；未 push。
