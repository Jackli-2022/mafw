# Gateway E9 交互补齐：设计（2026-11-13）

> 目标：清 E6 之后剩余的三个交互 deferred：mobile work tab 对 pod/run 事件不响应、attention 无 decision 投影、pod.updated payload 过薄。

## 1. E9-1 Mobile work tab 事件保真

现状 bug：`pod.updated` / `pod.event` / `run.updated` 是顶层 flat 广播（`{type, properties}`），但 `kMafwFlatEventTypes` 未收录它们，`MafwEvent.fromJson` 把 `data` 置空；`kWorkRefreshFlatEventTypes` 也没有它们。结果：mobile work tab 收不到这些刷新信号；`MafwEvent.goalId` 只读 flat `data.goalId`，也读不到 `properties.goalId`。

修法：
- `kMafwFlatEventTypes` 加入 `pod.updated`、`pod.event`、`run.updated`（它们是已注册的顶层广播）。
- `kWorkRefreshFlatEventTypes` 加入同三项。
- `MafwEvent.goalId` fallback：`properties['goalId']` → `data['goalId']`（对 canonical/flat 都适用）；`podId` 同理可选。
- `WorkRefreshBus` 已按 `goalId` 局部 patch；修复后 `pod.updated {goalId}` 能命中。
- 测试：flat 类型解析、shouldRefreshWork、goalId 提取、WorkTab 局部 patch。

## 2. E9-2 Attention decision 投影

现状：`/api/attention` 只从 Goal 事实 + review items 生成；draft decision 记录不在 person-first 列表（desktop 决定板另行 merge records）。

修法：
- `core/lead/attention.ts`：新增 `AttentionKind='decision'`（priority 85），`DecisionAttentionInput { id, goalId, revision, title, detail?, action }`；`appendDecisionAttention(items, decisions)` 只投影 `status==='draft'` 的记录，`action {type:'open_decision', goalId, itemId: record.id}`，coalesceKey `decision:<recordId>`。
- `routes/attention.ts` 增加 `decisions?(projectDir)`，route 组合；kernel/api-routes 注入 `decisionRecords.list(dir)`。
- SDK `AttentionKind` 加 `'decision'`；desktop `decision-model`：
  - `attentionKind` decision → `'other'`（或 `'direction'`；选择 `'other'`，避免虚构 record.kind）；
  - `decisionActionForAttention` decision → `{kind:'record', recordId:item.action.itemId}`；
  - `buildDecisionBoard` 按 record id 去重：attention 中已投影的 decision 不再从 records 重复生成。
- 测试：gateway append/route；SDK tsc/contract；desktop board 去重/action。

## 3. E9-3 Pod.updated 轻量 payload

现状：`pod.updated` 多为 `{podId, kind}`；desktop `podStore.ingest` 对当前 Pod 直接全量 `refresh()`。

修法（additive）：
- goal/revision/result 事件已带 `goalId`；统一在 event properties 加 `goalId?`、`revision?`（已知处）。
- `PodService/TaskService/MessageService` 的 notify 签名扩展可选 `goalId`；任务/消息有 goalId 时携带。
- desktop `podStore.ingest`：若 `kind==='review'` 已 bump；若 `kind==='task'|'message'` 且 event 带 `goalId`，只刷新/标记该 goal 的 reviewRevision；无 goalId 仍全量 refresh。
- 不引入完整 PodDetail payload（事件体积/一致性风险）。
- 测试：payload additive、desktop 有 goalId 不 full refresh。

## 4. 非目标

- 不做 mobile attention UI 新页；只保证 SDK/DTO 不破。
- 不做 296 schema / OS keychain / MCP human tools。
- 不改 pod detail wire shape。

## 5. 门禁

gateway tsc/full（env-red）、SDK tsc/full/contract、desktop full/tsgo、mobile targeted/analyze、analyzer 0、kernel-split 7/7。
