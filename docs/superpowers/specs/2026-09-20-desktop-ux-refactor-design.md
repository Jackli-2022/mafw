# Desktop 使用逻辑重构设计（结构 + 交互双轨）

- 日期：2026-09-20
- 状态：已获用户分节确认（结构拆分 / 四切片 / 布局与测试策略）
- 路线：方案 A —— 绞杀者模式 · 垂直切片交付
- 范围：packages/desktop 为主，gateway 配套，TUI 对齐

## 0. 背景与依据

业界调研（Codex / opencode / Zed / Pi / DSH Desktop）收敛出的交互范式：

1. **审批**：两维正交（能做什么 × 何时问）→ 包装为 3 档人话预设；弹窗 once/always/reject，always 沉淀为最小前缀规则；fail-closed（Codex / Zed / opencode / DSH）
2. **plan/build 双模式**：先只读规划、满意后一键切执行，权限随模式走（opencode）
3. **worktree 是并行的一等隔离单元**（Codex 指挥中心、Zed thread+worktree），并行 ≠ 多开聊天 tab
4. **diff 审阅**：hunk 级 keep/revert（Zed Review Changes、Codex /diff）
5. **会话是树**：分支即导航（Pi JSONL 树、opencode 子会话树）——本轮不纳入，仅记录

MAFW desktop 现状约束：

- `MafwShell.tsx` 2805 行单函数（57+ signal）、`ChatPane.tsx` 2339 行；全部 renderer 文件 `// @ts-nocheck`
- 路由形同虚设；轮询与 SSE 双轨；shell↔pane 回调注册表隐式契约
- desktop 无 test script、不在 CI
- 已有可复用资产：`session-events.ts` 规划器模式（纯函数 + 类型穷尽）、`session-store.ts` 模块单例、bun test 惯例、`session_diff` 数据、`agentConfigApi`、permissionReply 三值签名

## 1. 总体路线：绞杀者 + 垂直切片

不推倒重来。第一阶段在现有 shell 内抽取带类型的独立模块（零行为变更）；之后按用户旅程痛感排序做四个垂直切片，每片含 desktop 交互 + gateway 配套，独立可交付、可回退。

切片顺序：审批 → diff 审阅 → plan/build → worktree。

## 2. 阶段一：结构拆分（地基）

### 2.1 SSE 分发器（`renderer/mafw/sse/dispatcher.ts`）

- MafwShell 内 ~350 行 if-else 事件处理迁出
- 推广规划器模式：每种事件 → 纯函数 `planXxxEvent(event, ctx) → Action[]`（patch / invalidate / toast / 卡片 upsert …）
- `assertShellEventCoverage` 类型穷尽守卫推广到全部事件类型
- Shell 只剩"执行 Action"的薄层

### 2.2 SessionWorkspace store（`renderer/mafw/workspace/session-workspace.ts`）

- 收敛：tabs、分屏树、消息 store、乐观发送、busy 排队、回调注册表
- 形态：模块单例（参照 `session-store.ts` 既有模式）
- ChatPane 的 40+ props 收敛为一个 `workspace` 对象 + 少量回调

### 2.3 Shell 瘦身

- MafwShell 只保留：布局壳（Rail / TabStrip / RightDock / 内容区）、连接状态、主题
- 页面切换保持信号驱动（不引入真路由，YAGNI）

### 2.4 纪律

- 顺序 ① → ② → ③，每步独立可回退
- 每抽一个模块：摘该模块的 `ts-nocheck` + 补 bun test
- **抽取前先在旧代码上补行为钉扎测试**（characterization test），防隐性行为丢失（乐观发送、媒体管线、SSE 边界均无测试兜底）
- 此阶段零行为变更

## 3. 切片 1：审批三档 + 规则沉淀

### Gateway

- 权限模型升级为两维正交：`scope`（read-only / workspace-write / full-access）× `ask`（何时问）
- 对外三档预设：**Read Only**（只读，一切变更要问）/ **Auto**（工作区内自由，出界问）/ **Full Access**（全放开）
- 规则存储 `~/.mafw/permission-rules.json`：`{tool, pattern, action}`；选 always 时按工具建议的最小前缀落规则（如 `git status*`，opencode 语义）
- `permissionReply` 的 always 分支顺带写规则
- 审批请求不复制工具参数，以 callId 引用已展示的工具卡（DSH 语义，防漂移）
- 无 answerer / answerer 异常 → fail-closed 拒绝

### Desktop

- composer 审批 toggle 改为三档 SelectV2
- PermissionCard 加「总是允许此工具 / 总是允许此前缀」按钮
- Config 页 Approvals 区块展示规则列表、可删除

### TUI 对齐

- permission overlay 加 always 选项说明；`/permissions` 命令切三档

## 4. 切片 2：diff 审阅闭环

- Gateway：`POST /api/sessions/:id/diff/revert`（body = 选中 hunk 范围 → 对 workspace 反向 apply；opencode 走 git；fail-open）
- Desktop：会话工具条加「Review changes」（对标 Zed `ctrl-shift-r`）→ 多文件 diff 视图，逐 hunk 保留/回退；入口同时挂 SessionTurn actions
- TUI：`/diff` 保持只读 + `/revert` 整消息级；hunk 交互后续再评

## 5. 切片 3：plan/build 模式引导

- Desktop：composer 加模式切换（plan ⇄ build，Tab 键循环，对标 opencode）；plan 模式走 runtime plan agent（只读权限）；切 build 时带入 plan 摘要
- WelcomeHome 与新会话空态引导「先描述需求，让 agent 出方案」
- 能力门：pi runtime 无 plan agent → 该模式在 pi 下隐藏（能力契约检测，不崩）
- TUI：加 `/plan` `/build` 命令切换模式（与 desktop composer 切换同语义）

## 6. 切片 4：worktree 并行隔离（最重，最后做）

- Gateway：session 创建支持 `worktree: true` → `git worktree add`；会话项携带 worktree 归属；归档清理联动
- Desktop：Rail 会话按 worktree 分组 + 徽标；「从当前会话开并行任务」一键起 worktree 会话；分屏 pane 标注 worktree
- TUI：`/sessions` picker 显示 worktree 归属
- 风险：依赖 runtime 目录绑定能力 → 能力门检测，opencode 先行，pi 隐藏

## 7. 目标布局（终态）

保留三栏骨架，四处内容重组：

1. **Composer 状态栏**：模型 / token / 成本 / 审批档位 / plan-build 模式常驻（pi 底栏语义；UsageDock 保留做明细）
2. **Rail 会话列表**：按 worktree 分组 + 徽标；Manager 卡置顶不变
3. **WelcomeHome 强化为意图入口**：项目 chips + 「先规划」引导卡 + 待办概览
4. **TabStrip 不变**（六 tab，避免迁移成本）

不做指挥中心式多 agent 网格（YAGNI）。

## 8. 测试与验证策略

| 层 | 策略 |
|---|---|
| 抽取的纯逻辑模块 | bun test，抽取时同步补 |
| 交互切片的纯逻辑（预设映射 / 前缀建议 / hunk 选择） | 收敛为纯函数 + bun test |
| Gateway 新增路由/模型 | jest |
| Desktop 整体 | 新增 `test` script 挂 bun test，加入 `.github/workflows/ci.yml`（补缺口） |
| 每切片验收 | 手动冒烟清单（审批流 / diff 审阅 / 模式切换 / 并行会话） |

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 隐性行为丢失（无测试兜底） | 绞杀者逐块抽取 + 行为钉扎测试先行 |
| ts-nocheck 摘除连锁报错 | 按模块摘，不一次全开 |
| worktree 依赖 runtime 目录绑定 | 能力门，opencode 先行，pi 隐藏 |
| gateway API 变更影响 TUI/plugin | 新端点纯增量，不改既有契约；permissionReply 三值签名已稳定 |

## 10. 明确不纳入（YAGNI）

- 会话树/分支可视化（Pi 树模型）——本轮仅记录
- 指挥中心式多 agent 网格布局
- hunk 级 diff 的 TUI 交互版
- i18n 接线（死代码，另行决策）
- 真路由替换信号切换
