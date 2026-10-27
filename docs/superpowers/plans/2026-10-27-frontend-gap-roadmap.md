# 前端差距补齐 Roadmap（2026-10-27）

> 依据：`docs/research/2026-10-27-frontend-gap-analysis.md`（六产品逐项调研）+ 桌面端「宣称 vs 实际接线」审计（W0 回填）。
> 范围：P0–P2 全覆盖 + 一致性修复批（W0）。
> 交付惯例：每批 TDD 先行；每批汇报「新增测试数 + 全量通过数」；每批独立 spec/plan；push 需用户明确指示。
> 硬约束：执行沙箱只约束 agent 子进程，**绝不影响用户本机桌面**（文件/进程/网络/窗口）。

## Wave 总览

| Wave | 内容 | 优先级 | 规模 | 前置 |
|---|---|---|---|---|
| W0 | 一致性修复批（宣称有但没接上/接错的） | 先行 | 待审计 | 审计报告 |
| W1 | Plan 审阅工作流 | P0 | 中 | 无 |
| W2 | 执行沙箱（独立立项，spec 先行） | P0 | 大 | 用户批准安全边界 |
| W3 | 会话导出/分享 + 自定义快捷键 | P1 | 小 | 无 |
| W4 | MCP / Skills / Hooks 管理 UI | P1 | 中 | W3 |
| W5 | Steer + 选区引用 chip | P1 | 中 | 无 |
| W6 | 多面板分屏（编辑器/浏览器/终端可拖拽 split） | P1 | 大 | W1（布局稳定后） |
| W7 | P2 批：会话树 / PR 状态 / 插件市场 / FIX-DISCUSS / diff 内联编辑 | P2 | 中 | 按需 |
| W8 | P3 批：远程接管 / prompt suggestions / 主题编辑器 | P3 | — | 按需 |

## W1 Plan 审阅工作流（P0，价值 5 / 成本 3）

**目标**：plan 节点产出的计划成为一等审阅对象——可批注、可批准、可驳回并继续规划。

**已定决策（2026-10-27 用户拍板）**：
- **批准门默认自动、可选人工**：goal 新增配置 `planReview: auto|manual`，默认 auto（NodeDriver plan→execute 自动推进现状不变，面板只是可视化 + 可中途干预）；manual 时 plan 完成进入待批准状态，批准/驳回驱动 routing。存量在飞 goal 不受影响。
- **面板位置：goal 泳道下钻**——从 `GoalDetailOverlay` 泳道 plan 节点点开计划文档（goal 上下文天然带 loop/审批语义），不动 2026-10-26 刚冻结的两级 dock IA。

**内容**：
- plan agent 产出 Markdown 计划文档（落 `.mafw/plans/<goalId>-loop<N>.md`，与现有 waves.json 并存）。
- 计划文档用现有 Markdown 预览 + 批注锚点体系渲染（行锚/引文锚，Enter 直发 / Ctrl+Enter 攒草稿）。
- 动作条：**批准**（→ execute）/ **驳回并反馈**（批注打包回 plan 节点继续规划）/ **忽略**（仅 manual 模式显示前两者；auto 模式面板只读 + 批注可发）。
- 参考：Claude VS Code 计划 Markdown 行内批注（v2.1.70+）、DSH plan review（批准/拒绝/忽略）。
- 切入点：`EditorDock.tsx` 批注体系、`annotation-anchor.ts`、`GoalDetailOverlay.tsx`（goal 泳道已有 plan 节点）、gateway `core/goal/` driver（state v3 增 planReview 字段 + routing 门）。
- 验收：计划文档渲染 + 行批注直发/草稿 + manual 模式三动作驱动 goal 状态机 + auto 模式零行为变化回归；desktop/gateway 全量测试 + GUI 冒烟。

## W2 执行沙箱（P0，价值 5 / 成本 5，独立立项）

**目标**：agent 子进程（bash 工具等）在可选「隔离模式」下运行于受限沙箱，文件/网络/进程不越出授权工作区，不触碰用户桌面。

- 默认仍是审批三档；隔离模式为显式开关（Config 页）。
- Windows 首选：Job Object + 受限 token / AppContainer 隔离子进程（不动用户桌面）；WSL/VM 仅用户显式选择。
- 失败回退审批模式并明示。
- 参考：Codex Read Only/Auto/Full、Claude sandbox、DSH permission preset（sandbox mode + approval policy）。
- **spec 需用户批准安全边界后再写 plan。**

## W3 会话分享 + 自定义快捷键（P1，小）

- **分享**：桌面导出**已存在**（命令面板「导出当前会话为 Markdown」+ SessionStrip 右键 + main save dialog，`export-markdown.ts`）——本批只补「复制到剪贴板」与入口可见性，不做云端链接。
- **快捷键**：配置页快捷键节（录制/冲突检查/恢复默认），持久化 `~/.mafw/keybindings.json`；先覆盖 app 级快捷键（Ctrl+`、Ctrl+O、Ctrl+B 系），composer readline 保持固定。
- 参考：DSH ui-shortcuts（录制/冲突/恢复默认/搜索）、Codex Keybindings。

## W4 MCP / Skills / Hooks 管理 UI（P1，中）

- Config 或独立「扩展」页：MCP server 列表（opencode 配置读取）+ 启停 + OAuth 状态；Skills 列表 + 启停；Hooks 列表（只读起步）。
- gateway 侧需要只读 API（列 MCP/skills/hooks 现状），写操作先只做启停。
- 参考：Claude `/mcp` `/skills` `/hooks` + Desktop 连接器；Kimi MCP 面板。

## W5 Steer + 选区引用 chip（P1，中）

- **Steer**：运行中 Enter = 注入当前 turn（区别于 Ctrl+Enter 排队）。
  - **runtime 现实（builder check 纠正，我的决定）**：pi 有原生 steer（`streamingBehavior:'steer'`，工具调用间隙注入）；opencode v2 TUI 有原生 steer，但经 gateway serve `promptAsync` 的 busy 语义是**下一回合取**，不是中途注入——需先实证 opencode serve 是否暴露 steer 通道。
  - 方案：新增能力位 `steerApi`；pi 走原生；opencode 实证后优先原生，不支持则回退「下回合开头送达」+ composer 文案明说（不做 UX 谎言）。
- **队列语义收敛（我的决定）**：三套队列统一为——Enter=steer（当前 turn）；Ctrl+Enter=gateway 队列 inbox（服务端，Batch 5 已有 UI）；本地 turn-queue 仅作 gateway 队列不可用时的降级，不再新增第四条路径。
- **引用 chip**：现有批注锚点体系加第二动作「引用到输入框」（不发送，进 composer 草稿区 chip）；与「批注直发」并存。
- 参考：opencode Quote 工具条、DSH 原生划词 Quote、Claude 排队/steer。

## W6 多面板分屏（P1，大）

- 编辑器/浏览器/终端主区可拖拽 split（先左右双栏，再考虑弹出窗口）；布局档位体系保留为默认。
- 参考：opencode side/split/bottom、DSH dockkit、Claude pane 弹出。

## W7 P2 批（按需拆批）

会话树可视化（Pi `/tree` 式）/ PR 状态与 PR 内 review / 插件市场（Discover/索引源）/ 批注意图 FIX·DISCUSS / diff 内联 AI 编辑。

## W8 P3 批（按需）

远程/移动接管 / prompt suggestions / 主题编辑器与 i18n。

## W0 一致性修复批（审计结果，2026-10-27 审计 20 项：14 ✅ / 3 🟡 / 1 ❌ / 1 ⚠️）

> 审计方法：逐条核对 AGENTS.md §5.5 宣称与 `packages/desktop/src/` 实际接线（子代理 explore 报告）。好消息：**inputbar 导航、subagent 跳转、background task 等你点名的全部已接线**（证据见下）；真正要修的是 4 个接线债 + 1 个文档债。

| # | 问题 | 现状证据 | 修法 | 规模 |
|---|---|---|---|---|
| W0-1 | `session.checkpoint` 事件桌面零消费：overlay 打开期间 gateway 自动落的新检查点不实时出现，需关重开 | `session-events.ts:111/202` 显式 ignore；`ChatPane.tsx:1622` 仅打开时拉取 | 事件到达时若 overlay 开着 → invalidate serverCheckpoints 重拉 | 小 |
| W0-2 | fork/revert 按钮无 `sessionBranchApi` 能力门：pi 下照渲染，失败只剩 toast | `ChatPane.tsx:462-501`；session-ui `message-part.tsx:1309/1423` 无 caps 条件 | MafwShell 按 caps 决定是否向 SessionTurn 传 fork/revert actions（对齐 unrevert 的 `revertUndoApi` 门） | 小 |
| W0-3 | DiffReviewPanel「评论」实为 per-hunk 粒度，session-ui `line-comment.tsx` 组件从未接线 | `DiffReviewPanel.tsx:216-266` per-hunk「评论」按钮 | **已定（builder check 后拍板）**：接线真行级评论，复用批注锚点体系，与 W1 计划批注共用基础设施 | 中 |
| W0-4 | 文档债：桌面已有完整会话导出（命令面板 + SessionStrip 右键 + save dialog），AGENTS.md §5.5 未记录 | `export-markdown.ts`；`MafwShell.tsx:417/435/1903` | 补记 AGENTS.md（本批顺带） | 极小 |
| W0-5 | steer 语义落差：busy 发送走本地 turn-queue（回合结束才发），gateway `delivery:'steer'` 能力桌面从未消费 | `use-send-message.ts:117-130` | **不是 bug**，转入 W5 正式立项（G3 steer） | —（归 W5） |

**审计顺带确认已接线（无需修）**：composer readline 全键 + IME/picker 避让 + 历史持久化；subagent 跳转（task 卡 + 执行视图子代理面板真实数据）；background 三态探测 + 60s 重探 + SSE 重连 reset；queue inbox 全链；RunState 暂停四路由；G1/G2 capture 链路；预览批注 marks 翻转；终端能力门 + Ctrl+`；浏览器权限/导航；左 rail 六钮；执行五面板全真实数据；主题/托盘/审批三档。

**审计发现的正确降级（保持）**：checkpoint overlay 按 caps 出 pi 提示；终端 pi 出 banner 非死按钮；plan/build pill pi 下隐藏；pi `session.updated` 空壳忽略防风暴。
