# Gateway E2 恢复闭环：设计（2026-11-11）

> 来源：58 项清单中的 **B1/B2/B4 + C2**（恢复缺口）与 **B3 的降级裁决**。E1 已修 SSE 卫生/游标基础设施之外的一切旁支；E2 只做"重连后状态可恢复"这一件事。

## 1. 意图

当前不对称：网关已提供 journal 语义（`event_log` 单调 seq、`?since`/`Last-Event-ID`、`truncated` 信号、20k 保留），但**三个客户端全部忽略它**——每次重连 = 全量重拉，重启后活跃聊天可能永久"忙"。E2 把"游标恢复"从网关能力变成客户端协议：

1. 网关 greetings 携带身份/纪元（instanceId、schemaEpoch）并在游标超前时给出显式 `reset`；
2. SDK（TUI 用）与 desktop 持久化 seq，重连带 `?since`，按 `truncated/reset` 决定全量重同步；
3. desktop 重连后补拉活跃会话消息/状态（B2）；
4. WS 正式**降级**为 live-only 通道（B3 的廉价分支）：greeting 带 headSeq，文档写明重连必须 REST 兜底，不做回放；
5. `eventStore.append` 失败从"静默 null"变为可观测（限频日志 + stats 计数，C2）。

## 2. 非目标

- WS 总线化（cursor+replay）——正式放弃，只做降级文档 + headSeq。
- mobile 游标（Dart 客户端独立改造，后续波次）。
- event_log 作为恢复源/消费者幂等（C1，属 E5 大项）。
- 定时器注册表（归 E4 资源台账）。

## 3. 逐项设计

### E2-1 网关 greeting 纪元 + 显式 reset（B4）
- `sse-attach.ts` greeting 增加 `instanceId`、`schemaEpoch`（来自 `releaseMetadata`/`runtimeIdentity`，接 deps）；当 `since > headSeq`（DB 重置/旧纪元）→ greeting 加 `reset: true`（现状：静默为 0 条回放）。
- `truncated` 语义保持；`reset` 与 `truncated` 互斥优先。
- 验收：单测——since≤head → 正常回放；since>head → `reset:true` 且不回放；greeting 含 instanceId/schemaEpoch。

### E2-2 SDK 游标恢复（B1，TUI 生效）
- `packages/gateway-sdk/src/sse.ts`：`subscribe` 选项扩展 `cursor?: { get(): number | null; set(seq: number): void }`；连接 URL 带 `since`（Legacy Last-Event-ID 由 EventSource 语义保留）；解析 greeting：`headSeq/firstReplayedSeq/truncated/instanceId/schemaEpoch/reset`，通过回调 `onReplayInfo(info)` 暴露；每帧 `id` 写回 cursor。
- 验收：SDK 单测——带 cursor 时 URL 含 since；收到 id 帧后 set 被调；greeting truncated/reset 触发回调；无 cursor 时行为不变。

### E2-3 desktop 游标 + 重连重同步（B1+B2）
- `sse/sse-connection.ts`：seq 持久化（localStorage `mafw-sse-seq`）+ instanceId/schemaEpoch 记录；重连 URL 加 `since`；greeting 判定：
  - `reset` 或 `instanceId` 变化 → 清 seq + 全量重同步（现 onOpen 逻辑）+ 重拉活跃会话消息/状态；
  - `truncated` → 同样全量重同步；
  - 正常 → 不重拉列表（游标已覆盖）。
- 重连后补拉：活跃 session 若存在 → `loadSessionHistory` 强制刷新（消息桶非空也刷）+ session status 从 REST 对账。
- 验收：desktop 单测——since 透传；truncated 触发全量路径；正常回放不触发 invalidate；重连后强制刷活跃会话。

### E2-4 WS 降级 + headSeq（B3 降级分支）
- `ws-upgrade.ts` 的 `connected` 帧加 `headSeq`（EventHub 提供）；`docs/architecture/gateway.md` 明确：WS 不回放，重连必须按 SSE 游标或 REST 快照兜底；mobile 的"重连即全量"路径保持。
- 验收：单测——connected 含 headSeq；文档行存在（source-scan 守卫可选）。

### E2-5 event append 失败可观测（C2）
- `event-store.ts` append catch 返回 null 前：限频 `log.error('[Events] append failed…')`；EventHub/EventStore 暴露失败计数，`/api/stats` 增 `eventAppendFailures`。
- 验收：单测——append 抛错时计数 +1、限频日志一次；stats 反映计数；恢复正常后计数保留到进程重启。

### E2-6 收口
- 文档（gateway.md 现状段 + `docs/releases/2026-11-11-gateway-e2-recovery.md`）；门禁：gateway tsc+全量、SDK 测试、desktop 全量、TUI 全量；已知环境红记录。

## 4. 测试策略

TDD 铁律；网关/SDK/desktop 各自 runner；每项一个 commit（`E2-n` 标签）。跨包游标语义用"同一 fixture"（since/truncated/reset 三态）在 SDK 与 desktop 各自钉一遍。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 客户端盲目信任 replay → 重复事件双应用 | 桌面事件处理器已幂等（消息按 ID 合并）；测试覆盖 same-frame replay（`packages/desktop/tests/sse-cursor.test.ts` 的 seq 去重用例：同 seq 只分发一次、更大 seq 继续、无 seq 的 part.delta 恒应用） |
| `reset` 误触发全量风暴 | 仅 instanceId 变化或 since>head 时触发；truncated 单独路径 |
| SDK 变更影响 TUI | 游标为可选参数；TUI 显式启用后单独验 |
| WS 降级造成"以为有回放" | connected 带 headSeq + 文档 + mobile 现行为不变 |
