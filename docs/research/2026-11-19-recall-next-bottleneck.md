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
