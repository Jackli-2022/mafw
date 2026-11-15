# 2026-11-15 · Agent-native Chat 意图

- **版本**：`v5.1.0`（交互行为修订，不升版本号）
- **提交**：`3210334f`（主变更）、`a44715a3`（live 状态守卫 / `goals.stop`）、`2ad06925`（撤销前二次校验 stage）、`9fc8750e`（解包 MCP 结果 / 缓存 live 状态）
- **范围**：desktop Chat composer 与工具卡；gateway / SDK / 运行时契约零改动
- **前置**：`docs/superpowers/plans/2026-11-15-agent-native-chat-intent.md`（方案 D）

## 问题

composer 上方的「讨论 / 提议 / 委托 / 解决」四模式，与 Lead 已经具备的能力重复：

- Lead 的系统提示明确要求：用户表达工作意图时直接调用 `mafw_create_goal`，不要先问
  「这要不要变成工作」。
- `mafw_create_goal` 默认 `handoff: "current-topic"`，网关自动把当前话题做成快照写进
  `sourceRef`，Goal 进入 `discussing`，不启动 NodeDriver。
- 旧的「委托」按钮走 `pod.createGoal({ source: "desktop" })`，没有 `createdBy` / `sourceRef`，
  实际拿到的 Goal 信息更少；它不是快捷方式，而是降级路径。
- 评审项「已解决」、验收、合并仍是 human-only；它们需要的是卡片上的显式确认，而不是一个
  常驻模式。

## 现状

- **一个发送面**：删除 `ChatModeBar`、`composer-mode.ts`、`composerMode` 状态和
  `[[mode:propose]]` synthetic part；`QueuedTurn` 不再携带 `chatMode`。
- **Lead 直接建 Goal**：`mafw_create_goal` 的 `tech_lead` 结果渲染为 `GoalCreatedCard`
  （打开 Tech Lead 讨论 / 两步确认撤销）；legacy / running / error 结果不进入动作卡
  （error part 仍由通用 `ToolErrorCard` 处理）。卡片不以创建时的快照判断状态：mount 时向
  `podStore` 取 live stage，只有 `active + discussing` 才显示撤销；撤销走带 404/409 守卫的
  `goals.stop`，不使用无守卫的 `goals.control ABORT`。
- **Episode 归位**：「标记 Episode」从 composer 行移到 transcript header，仍以当前最后一条
  turn 为起点；Episode 的 localStorage 分组模型不变。
- **自由讨论交接保留**：`onHandoffToLead` 仍在 header，只在可交接会话显示。
- **解决入口**：评审 lens 仍可从左栏「改动」面进入；inline `ReviewItemCard` 是下一阶段。
- **New Goal composer**：仍从「工作」面打开；不再由 Chat 的委托模式预填。

## 行为变化

| 之前 | 现在 |
|---|---|
| 停在「委托」时按回车会打开 Goal composer | 任何消息都直接发送；Lead 自行判断是否建 Goal |
| 「提议」注入 `[[mode:propose]]` | 直接说“先给我两个方案，不要动手” |
| 「解决」把右工作台切到评审 lens | 评审入口在左栏「改动」；后续在 Tech Lead 回复里出卡片 |
| 「标记 Episode」在 composer 行 | 在 transcript header |
| 模式状态可能粘住下一次发送 | 无模式状态 |

## 测试与门禁

- desktop 全量：**3865 / 3865** pass（736 suites）
- 新增：`agent-native-chat-wiring` 3、`goal-created-card-wiring` 3、
  `goal-created-model` 8；`use-send-message` 的 4 个模式用例替换为 1 个“旧调用方不能注入
  mode directive”回归用例
- 删除：`composer-mode` 5、`chat-mode-bar-wiring` 4、`chat-mode-delegate-wiring` 3、
  `chat-mode-resolve-wiring` 2
- `npx tsgo --noEmit -p tsconfig.json`：rc=0
- `npx electron-vite build`：rc=0

## 下一阶段

- `ReviewItemCard`：Tech Lead 回复内联评审项 + human-only「确认解决」。
- `HandoffCard`：自由讨论检测到工作意图时，由 agent 提议交接，人点「交给 Lead」。
- `BoundaryCard`：接 `topic.boundary.proposed`，替换手动 Episode 标记。
- overlay 的完整 focus trap 仍是独立事项。

未 push、未合并远端。
