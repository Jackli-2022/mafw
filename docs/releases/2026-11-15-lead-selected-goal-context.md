# 2026-11-15 · Lead 选择 Goal 来源上下文

- **版本**：`v5.1.0`（交互行为修订，不升版本号）
- **提交**：`7c11bffb`
- **范围**：gateway `mafw_create_goal` / Lead identity；desktop Chat（移除 inline BoundaryCard）
- **前置**：`docs/releases/2026-11-15-chat-review-and-boundary-cards.md`（P3 + P4）

## 问题

P4 把话题边界做成了 Lead chat 里的 `BoundaryCard`，让用户回答“这算不算新话题”。这跟
“Lead 只做一件事：把意图变成一个 Goal”冲突：

- Lead 的 prompt 已经写了 context allocation 是它的职责；
- 但 Lead 没有选择 handoff 上下文的出口，只能由 gateway 自动取 latest topic；
- 于是规则引擎在判断、用户在点卡片，角色全部错位。

## 现状

- `mafw_create_goal` 新增 `contextSummary`：
  - Lead 用它传“这个 Goal 的来源上下文”（已确认事实 / 约束 / 未决问题）；
  - gateway 用它生成 `sourceRef.snapshot`（`capturedAt` 自动补），并跳过自动 current-topic handoff；
  - 不传时保持原行为：Lead 会话 + `handoff: current-topic` 自动快照。
- Lead identity 增加 Context selection 段：
  - 创建 Goal 时先判断来源范围；
  - 只带相关对话，不复制无关话题；
  - 不要把“换话题”变成用户要回答的问题。
- desktop 移除 inline `BoundaryCard`：
  - 删除 `BoundaryCard.tsx` / `chat/boundary-card.ts` 及测试；
  - ChatPane 不再渲染 boundary card；
  - MafwShell 移除 Lead 会话进入 / 消息发送后的边界刷新与 1.5s trailing refresh；
  - `LeadBoundaryService` 与 `TopicIndexPanel` 保留：话题边界只在「话题」面板 / 后台可见。
- `GoalCreatedCard` 的来源提示从「已带当前话题快照」改为「已带来源上下文」，覆盖自动快照与
  Lead 自选摘要两种情况。

## 测试与门禁

- gateway 全量：**7670 passed / 2 skipped / 7672 total**（949 suites）
- gateway 定向：**21 / 21** pass
  - `create-goal-direct` 10（新增 contextSummary → sourceRef 用例）
  - `session-visibility` 11（新增 Lead prompt contextSummary 契约）
- desktop 全量：**3871 / 3871** pass（736 suites）
  - 删除 6 个 boundary card 用例
- `cd gateway && npx tsc --noEmit -p tsconfig.json`：rc=0
- `cd packages/desktop && npx electron-vite build`：rc=0
- `npx tsgo --noEmit -p tsconfig.json`：仍被并行 plugin 改动阻断
  （`PluginPackagesSection.tsx` 两个重复 key）；本次变更涉及文件无类型错误。
- 未 push、未合并远端。

## 边界

- `contextSummary` 是 Lead 写的文本，不是逐字 transcript；需要逐字证据时仍可传 `sourceRef`
  或使用 `handoff: current-topic`。
- Lead 仍可能选错来源；`GoalCreatedCard` 显示「已带来源上下文」，`lead-handoff.md` /
  `sourceRef` 可审计，用户打回或新 revision 时纠正。
- 话题边界仍由后台规则服务产生，但不再向 Chat 弹卡片；需要时可从「话题」面板查看。
