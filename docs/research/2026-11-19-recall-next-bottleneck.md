# 2026-11-19 · 实时召回下一瓶颈调查

## 结论

当前主要瓶颈已经从“单次检索太慢”变成：

1. **fallback 仍由 search 主导**，其他阶段几乎可以忽略；
2. **snapshot 构建与 index scan 没有真正避开边界请求**，会在同一轮用户输入后并发启动；
3. **分段指标还没有读出口**，`graph/expansion` 仍是占位；
4. **snapshot 生命周期仍只在 user_input 触发**，assistant 回答后不刷新。

最近的实测样本里，`search` 单阶段 p50/p95 约 **133/199ms**，而 noteBoard p95 只有 3ms、goal 0ms、neighbours p95 17ms。也就是说，剩余延迟几乎全部在 search 里。

## 1. 当前分布

最近一次重启后的 83 条 live 请求：

| 阶段 | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| search | 133ms | 199ms | 2171ms | 2171ms |
| noteBoard | 2ms | 3ms | 5ms | 5ms |
| goal | 0ms | 0ms | 1ms | 1ms |
| neighbours | 14ms | 17ms | 98ms | 98ms |

结论：

- **search 占总耗时约 90% 以上**；
- 其他阶段已经不是主要矛盾；
- p99 的 2171ms 明显是异常尖峰，不是常规成本。

## 2. 尖峰根因：后台工作没有避开边界请求

同一时间窗内有一次极端样本：

```text
03:45:39  snapshot skipped (stale, containment=0.09, queryTokens=472)
03:45:41  fallback search = 2171ms
03:45:50  IndexScan ok: 10683ms
03:45:57  LlamaReranker ready
03:45:57  snapshot built (15602ms, 3 ids)
```

这说明：

1. 用户输入触发了 index scan prefetch；
2. snapshot build 也在同一轮启动；
3. 边界 fallback search 与这两者并发；
4. 最终 search 被拖到 2.1s。

代码层面有两个结构性原因：

### 2.1 `defer-to-idle` 不知道 HTTP 请求在跑

`scheduler.ts` 的判断是：

```ts
if (t.descriptor.strategy === 'defer-to-idle' && this.foregroundInFlight > 0) return false;
```

但边界 recall 的 HTTP handler **没有**作为 foreground task 提交给 scheduler，也不会增加 `foregroundInFlight`。

因此 snapshot build 虽然标了 `defer-to-idle`，但边界请求进行中时它仍可能启动。

### 2.2 index scan prefetch 是 fire-and-forget

`obs.ts` 里直接：

```ts
deps.getScanService()?.prefetch(sessionID, content.slice(0, 500));
```

`IndexScanService.prefetch()` 内部是：

```ts
void this.scan(query).then(...)
```

它没有进 scheduler，也没有 foreground/idle 保护。

结果是：用户输入后，index scan、snapshot build、边界 fallback search 可能同时竞争 CPU / GPU / SQLite / 事件循环。

## 3. Snapshot 生命周期仍是旧的

当前只在 `source === 'user_input'` 时调度 snapshot refresh：

```ts
if (source === 'user_input') {
  deps.getScanService()?.prefetch(...);
  deps.scheduleSnapshotRefresh(sessionID);
}
```

assistant 回答完成后不会刷新。

后果：

- snapshot 查询缺少刚完成的 assistant 内容；
- TTL 从用户输入时刻开始老化；
- 下一轮追问更容易 topic-shift 或 stale。

最近窗口内 snapshot 决策：

- stale：2
- topic-shift：1
- served：0

样本很小，但方向与之前一致。

## 4. 观测缺口

### 4.1 指标没有读出口

`recall-metrics.ts` 只有内存聚合，没有暴露：

- debug endpoint；
- 日志定期输出；
- stats 页面字段。

现在要知道 p95，只能靠手工解析 debug log。

### 4.2 `graph` / `expansion` 还是占位

接口里有这两个 key，但 route 没有打点。

当前无法回答：

- graph LRU 是否真的命中；
- secondary expansion 还花多少；
- dense 是否被计入 search。

### 4.3 `clientAborted` 偏乐观

现在是响应结束时的点检查：

```ts
clientAborted: Boolean(res.destroyed || req.destroyed)
```

如果 abort 发生在同步尾段，可能仍被计为 visible。

## 5. 下一刀建议

按优先级：

### P0：把边界请求纳入 foreground 语义

目标：让 `defer-to-idle` 真正避开边界请求。

可行做法：

1. 在 recall route 开始/结束时维护一个 foreground 计数；
2. 或把 route handler 包成 scheduler foreground task；
3. 至少让 snapshot build / index scan 在边界请求进行中不启动。

验收：

- 边界请求期间 snapshot build 不启动；
- 2.1s 尖峰消失；
- fallback p99 回到 <300ms。

### P1：把 index scan prefetch 交给 scheduler

目标：用户输入后不要立即启动 10s 级 scan。

建议：

- 以 background / defer-to-idle 提交；
- 与 snapshot build 共享互斥或顺序执行；
- 超时后 fail-open。

### P2：补 metrics 读出口

建议新增只读 debug endpoint：

```text
GET /api/recall/metrics
```

返回：

- 各 stage p50/p95/p99；
- route/snapshotDecision/clientAborted 计数；
- 当前窗口大小。

### P3：assistant_reply 后刷新 snapshot

这是提高命中率的下一步，但应在后台隔离修好后再做，否则会加重并发竞争。

## 6. 不建议现在做

- 继续调 100ms 截止；
- 继续优化单个 stage，而没有先修后台并发；
- 直接把 snapshot TTL 拉长；
- 在没有 session-shaped 评测时调 containment 阈值。

## 7. 判定

当前最像的根因是：

> **边界请求没有 foreground 保护，后台 snapshot build / index scan 可以在同一轮启动并拖慢 fallback。**

这比继续压缩 BM25 / graph 更重要。

## 8. 14:05 复测：短查询已接近目标，真实 session 仍有独立高基线

复测环境：HEAD `194a8d9ac`（recall 目标路径自 `9c8d9a367` 后无变更），Gateway v5.1.0 / PID 51884，当前进程从 05:51:55Z 开始。共享工作树有其他会话的 adapter 改动，本次未触碰。

### 固定 40 条（无 sessionID，只代表 live fallback）

连续两轮质量完全一致：AUTO 17/30，exact 10/10，current-state 6/10，implicit 1/10，false injection 0/10，stale 0，entrypoint agreement 25/30；REST hit@1 63.3%、hit@3 73.3%、MRR 0.672。

| 两轮合并 80 次请求 | p50 | p95 | max |
|---|---:|---:|---:|
| REST | 20ms | 24ms | 28ms |
| AUTO | 80ms | 114ms | 220ms |

AUTO 两轮分别为 83/118ms、79/110ms（p50/p95）。按 100ms 简单划线，62/80 在该预算内；这不是插件真实 visible rate，因为 runner 没有客户端 abort。当前 focused 回归为 77 suites / 606 tests 全通过。

Artifacts：`personal-recall-current-2026-11-19-r1.json`、`personal-recall-current-2026-11-19-r2.json`（Temp/opencode）。

### 真实 session（当前进程）

14 次 session fallback：`search` p50/p95/max = **317/699/699ms**，近似阶段总和 p50/p95 = **333/714ms**，14/14 超过 100ms。与之对照，同一进程 80 次固定集 `search` p50/p95 = 77/109ms。

部署 snapshot 当前轮质量门后，观察到 17 次 snapshot 决策：stale 10、topic-shift 7、**served 0、current-query-filter 0**。样本仍小，且不含未打日志的 no-snapshot；但足以说明当前 snapshot 没有实际降低这些请求的延迟，也还没有真实 serve 样本证明线上 precision。

### 对前述根因判断的修正

后台竞争仍有明确尖峰证据，不能取消 foreground/scheduler 隔离；但它**不足以解释真实 session 的整体高基线**：当前窗口没有 scan/snapshot 完成事件邻近时仍出现 160–580ms，且部分请求合并 `bm25=6 scan=8 expanded=8 union=14`。因此下一步必须同时测量：

1. session 长查询与 expansion 的稳定成本；
2. scan snapshot 合并及图扩展成本；
3. 后台任务造成的尾部尖峰。

现有 `search` 聚合计时无法继续拆分这三者；在补充分段观测前，不应再把所有 session 慢请求归因于后台竞争，也不应通过放宽 containment/FOK 来提高 snapshot serve 率。

## 9. 前台隔离部署后的真实样本（08:32）

`a485cb1d1` 部署后，metrics endpoint 工作正常，但聚合值被 80 次固定集请求主导，必须与真实 session 分开解释。固定集完成后的 8 次真实请求中：

- 7 次 live fallback：debug search p50/p95/max = **270/716/716ms**，近似总耗时 p50/p95 = **285/738ms**，7/7 超过 100ms；
- 1 次 snapshot serve：近似总耗时 **4ms**；观察到的 serve 率为 1/8（小样本）；
- 日志可见 fallback → IndexScan → snapshot build 的顺序，未再看到三者同时运行，说明新调度/互斥按设计生效；
- 但 fallback 在无并发构建时仍达到 716ms，再次证明稳定成本不是后台竞争所能解释的。

质量上出现一个新的真实负样本：当前 query 为“现在记忆系统质量和效率”，08:32:08 当前会话记录为 `snapshot served ... filtered=true`，但展示的是 2026-11-11 的交付流程/子代理分工记忆（`q15k2p`、`7lsgaw`），而不是当前召回质量、指标或性能结论。它们可能因“质量/系统”等词面重叠通过支持校验，却不具备当前问题的 answerability。

因此：

1. 固定 40 条 false injection=0/10 仍只代表负例控制，不能覆盖真实 session 的语义误展示；
2. 当前轮 lexical gate 能过滤零词面支持，但不能证明“候选足以回答当前 query”；
3. 下一质量切片应优先做 answerability/support verifier 与当前任务 working set，而不是提高 snapshot serve 率；
4. 下一性能切片应使用新 `graph/expansion/scan/fok/total` 指标定位稳定成本，前台隔离只解决新后台启动这一类竞争。
