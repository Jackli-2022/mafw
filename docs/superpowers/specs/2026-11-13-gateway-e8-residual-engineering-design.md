# Gateway E8 剩余工程 Debt 收口：设计（2026-11-13）

> 目标：清掉 E1–E7 中属于“工程债”的剩余 deferred；产品级/大规模项单列保留。

## 范围

1. **Timer inventory**：把 kernel/boot 仍在本地的长驻 interval 迁入 `TimerService`：
   - `pod:event-prune`（24h）、`pod:event-wake`（60s）
   - `heartbeat:sweep`（30m）、`queue:sweep`（60s）、`session:sweep`（60s）
   - `serve:watchdog`、`discovery:heartbeat`
   - 保持原 unref/清理语义；`stop()` 的 `timers.disposeAll()` 收口。
2. **Desktop preload 死参数**：`event.url(sessionID?)` → `event.url()`；IPC handler 不再接收参数。
3. **核心读接口 response schema**（6 个）：`session.get`、`session.messages`、`decisions.list`、`attention.list`、`memory.stats`、`pods.list`（按实际 op id）。只加 OpenAPI 元数据，不改 wire；新增 schema 后跑 SDK tsc/contract。
4. **E5b 两个恢复残留**：
   - 同实例 `reset` 且新 head 低于游标：允许游标降到 head（显式 reset 优先于单调前进）。
   - busy / 后台 greeting 竞态：busy greeting 排队一次延后恢复，而不是整段生命周期不恢复（后台主动断连仍忽略）。
5. **删 `authorizeWsUpgrade`**（无生产调用方，deprecated）或保留仅测试；优先删除 + 测试迁移。

## 非目标（继续保留）

- ~300 ops 的 response schema（只做 6 个核心读）。
- `pod.updated` 记录级 payload、attention decision 投影、mobile work tab 增量渲染。
- OS keychain / 进程签名、MCP human 工具。
- 插件/manager 会话配额副作用、强制版本协商。

## 设计

### E8-1 Timer
`TimerService` 注入 boot/kernel；替换 `setInterval` 为 `timers.every(name, ms, fn, {unref:true})`。`stop()` 已 `timers.disposeAll()`。测试：fake timers + dispose 后无回调；timer stats 含新名称。

### E8-2 Preload
- `mafw-types.ts` `EventApi.url(): Promise<string>`。
- `mafw-api.ts` `url: () => invoke("event","url")`。
- main IPC handler `event/url` 忽略/删除参数；测试更新。

### E8-3 Schemas
- `routes/schemas/read-models.ts` 或新 `sessions.ts`：TypeBox for
  - Session detail（复用 SessionSchema）、message flat DTO、
  - DecisionList/Record、AttentionList/Item、MemoryStats、PodList/PodDetail（按实际 handler 形状）。
- catalog 对应 RouteDef `response`；emit:openapi + merge-contract；SDK tsc/contract。
- 只加元数据，不改 handler。

### E8-4 E5b
- mobile `EventRecoveryService`：reset 分支允许 `_cursor = headSeq`（低于旧值也写）；`observe` 的 monotonic 改为“reset 显式覆盖”。
- RecoveryCoordinator：busy greeting 置 pending；在途 recover 完成后立即重跑一次（最多一次）；后台 intentional disconnect 仍忽略。
- 测试。

### E8-5 `authorizeWsUpgrade`
- grep 确认无生产调用；删除函数与测试，或迁移测试到 `resolvePrincipal`。保留 `AuthorizeWs` 类型清理。

## 门禁

gateway tsc/full（env-red）、SDK tsc/full/contract、desktop full/tsgo、mobile targeted/analyze、analyzer 0、kernel-split 7/7。
