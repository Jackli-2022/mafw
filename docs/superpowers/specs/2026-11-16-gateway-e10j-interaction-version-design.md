# Gateway E10j 交互与版本协商补齐：设计（2026-11-16）

> E10 契约三层已闭合。本波补齐剩余可执行缺口：TUI triage 真实字段、SDK/desktop/TUI 自动 schema epoch 协商。
> mobile work-tab 的“任务/消息级 patch”明确 won't do（见 §3）；`tts.speakStream` 是 SSE（已按流式排除）。

## 1. TUI triage 对齐真实 wire

现状：`packages/tui/src/ui/triage-tab.ts` 仍渲染 `t.severity` / `t.reason` / `t.goalId`；
SDK `TriageItem` 已在上游改为真实磁盘形状
（`{ id, automationId, discoveredAt, source, summary, proposedGoal?, state, userAction, deadline, llmSuggestions?, updatedAt? }`）。

修法（与 desktop `triage-model.ts` 同构）：
- 新增纯函数 `packages/tui/src/ui/triage-view-model.ts`：
  `triageView(t: TriageItem): { title, meta, badge, tone }`
  - title: `proposedGoal.title` → `summary.title`（string）→ `id`
  - meta: `source` + `discoveredAt`（非法日期静默省略）+ `deadline`（可选）
  - badge: `state` 三态（待确认/已确认/已拒绝）+ `llmSuggestions` 最高 priority 后缀
- `triage-tab.ts` 改用该函数，删除 phantom 字段；不再自造 severity 颜色。
- 测试：`packages/tui/tests/triage-view-model.test.ts`（纯函数，不 import `pi-tui`）。
- TUI 整包仍 env-red（`@earendil-works/pi-tui` 未安装），本波不强行装依赖；记录 `npm run test:tui` 仍红。

## 2. 自动 schema epoch 协商

现状：transport 已实现 `X-MAFW-Schema-Epoch`：
- 响应头携带 gateway epoch；
- 请求头携带且不匹配 → 409 `schema_epoch_mismatch`；未携带 → 放行。

修法：
- SDK `MafwClientOptions.schemaEpoch?: number | 'auto'`。
  - 数字：请求头恒带该值。
  - `'auto'`：首次响应读取 `X-MAFW-Schema-Epoch` 并缓存；之后请求自动携带；
    收到 409 + `schema_epoch_mismatch` 时用该响应的 epoch 刷新并**重试一次**。
  - 未配置：保持现状（不发送）。
- desktop `createGatewayClient` 与 TUI `createTuiClient` 使用 `schemaEpoch: 'auto'`。
- 测试（SDK client.test.ts，fake fetch）：首请求无头 → 响应后缓存 → 次请求带头；
  409 刷新重试一次；数字模式恒带；未配置不带。
- 效果：desktop/TUI 与 gateway 升级后自动重新协商，不再静默使用旧契约。

## 3. 明确 won't do

- **mobile work-tab 任务/消息级增量 patch**：work overview 只有整页快照接口，没有单 task/message 的
  “按 goal 取增量”端点；为局部 patch 新增端点属于新 API 设计。当前 `goalId` 局部 patch + 15s 全量兜底已满足一致性。
- **`tts.speakStream` 响应 schema**：wire 是 `text/event-stream`（PCM16 chunk 事件），不是 JSON；继续排除。
- **500/502/408/415 显式状态**：与 `default` 同形，列为 description 噪声，不逐 op 展开。

## 4. 批次

| 批次 | 内容 |
|---|---|
| J1 | TUI triage view-model + tab 改造 + 测试 |
| J2 | SDK `schemaEpoch` + desktop/TUI opt-in + 测试 |
| J3 | 收口：docs/release + 全量门禁 + 合并 + 部署 |

## 5. 门禁

J1：TUI 纯函数测试 + `tsc --noEmit`（若依赖缺失则记录）；desktop 不受影响。
J2：SDK tsc/full/contract；desktop full/tsgo；TUI 纯函数测试。
收口：gateway 全量（9 env-red）、SDK 226、desktop 全量、mobile targeted/analyze、kernel-split 7/7。
