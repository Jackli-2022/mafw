# 回合内元数据/审批呈现位置调研（2026-09-28）

> 目的：确定「过程元数据（thinking/tool 摘要）」与「审批卡」在 SessionTurn 内如何呈现与融入。
> 方法：子代理网络调研（官方文档优先）+ 本地 `@mafw/session-ui` 结构考察。

## 一、同类产品做法（六家）

| 产品 | 过程元数据位置 | 审批位置 | 折叠 |
|---|---|---|---|
| Codex | **内联按发生序**：`Thought for 7s` → `Viewed 2 files` → `Edited hero.tsx +16 -6`…最后正文 | 回合内可见的批准条目（具体内联位置未明文） | 摘要行常驻 |
| Claude | **内联**：工具调用默认折成一行摘要（`Called slack 3 times`），`Ctrl+O`/View mode（Normal/Thinking/Verbose）控制展开 | **内联**在触发它的工具调用处；`Allow once / Always allow / Deny` | 默认折叠，全局一键展开 |
| Cursor | 内联在 agent 流中 | Run Modes 决定；拦截时在流程内出 approval prompt | 未找到 |
| Zed | 内联 + "正在用哪个工具"指示 | **内联**在触发它的工具卡片菜单：Allow once / Deny once / Always for tool/pattern | 默认 confirm |
| opencode | 内联；`/details` 切换工具细节，`/thinking` 切换思考 | **内联提示**：once / always / reject | 默认折叠 |
| Kimi Code | 内联工具输出卡；`Ctrl-O` 全局切换折叠 | 流程内 approval panel；Approve for session | 默认折叠，长输出自动折叠 |

## 二、跨产品收敛结论

1. **元数据内联在「发生处」，按时间序，不是回合末尾聚合**；聚合只发生在"同一工具的连续行"（`Read 3 files`）
2. **默认折叠成一行摘要 + 一个全局展开开关**（Claude `Ctrl+O`/view-mode、Kimi/opencode `Ctrl+O`/`/details`）；三档 verbosity（Normal/Thinking/Verbose）最清晰
3. **审批内联在触发它的工具调用处**（Zed/opencode/Claude/Kimi 一致），固定三选项，且**决策留痕在转录里**（Auto-approved 标记 / 规则落盘）
4. **动作区与元数据分层**：反馈/回滚放回合边缘（Zed thumbs 在回复末尾、Restore Checkpoint 在消息顶部），元数据与正文同列但更弱色/更小字号

## 三、本地 SessionTurn 结构考察（`@mafw/session-ui`）

- 组件根 `[data-component="session-turn"]` 被 mafw 约束为**居中阅读列**（`max-width: var(--msg-col-width); margin-inline: auto`）
- 内部：`session-turn-content` → `session-turn-message-container` →（assistant parts / thinking / diffs），随后 `{props.children}`（**turn 末插槽，仍在居中列内**）
- **正文/工具卡/children 共用同一左缘**（`text-part`、`assistant-content`、`tool-part-wrapper` 均无左内边距）→ 放入 children 天然对齐，无需额外 CSS
- 已有挂载点：
  - `renderAfterPart(part, message)`：在指定 part 之后追加内容（当前用于把提问卡内联到工具卡后）——**可做"内联在发生处"**
  - `assistantActions`：per-part 动作注入
  - `{props.children}`：turn 末尾整块（当前放汇总行）

## 四、结论与选项

- 现状（汇总行放 children）**结构上已融入**（同列同左缘、位于 turn 内、turn 末）
- 与行业相比，唯一差异是**位置**：行业把过程/审批放"发生处"，我们把过程与审批聚合到 turn 末
- 若要更贴行业：① 用 `renderAfterPart` 把工具行摘要内联到发生处；② 审批内联在触发工具卡后；③ 加一个"展开全部细节"的全局开关（沿 SessionTurn children 或 ChatPane 级状态）

## 五、待选方案

- **A. 现状（turn 末聚合）**：工具折叠一行 + 审批汇总一行，均在 children
- **B. 行业对齐（内联发生处）**：过程行内联到对应工具卡后；审批内联触发处；全局展开开关
- **C. 混合**：审批聚合在 turn 末（保留"所有批准一行"偏好）+ 过程元数据内联发生处 + 全局展开开关
