# Todo / 任务清单：业界实现调研与 MAFW 落地方案

日期：2026-10-23
状态：调研完成，待实现（hydration 切片）
关联：opencode 2.1.0 适配（`/todo` 路由被移除，只有 `todo.updated` 事件）

## 1. 问题

opencode 2.1.0 移除了 `GET /session/{id}/todo`，只保留 `todo.updated` SSE 事件
（`{sessionID, todos}`）。MAFW 网关的 `/api/sessions/:id/todo` 因此只能返回空数组，
**打开旧会话时任务面板没有初始数据**；实时更新（事件 → `plan.updated`）已经修好。
本调研回答：业界如何存/取/渲染 todo，MAFW 应该采用哪种 hydration 策略。

## 2. 本地事实（opencode 2.1.0）

| 事实 | 证据 |
|---|---|
| Todo 形状：`{content, status: pending\|in_progress\|completed\|cancelled, priority: high\|medium\|low}` | SDK `Todo` 类型；实测历史 part |
| 只有 `todo.updated` 事件，**没有读取路由** | 2.1.0 OpenAPI（119 paths）无 `/todo` |
| todo 是**会话内内存态**，不落独立存储；跨压缩/会话会丢 | opencode issue #18071（closed as not planned）、#5934 |
| 但 **todowrite 的完整入参保存在会话历史消息里** | `session_message` 中 `type:"tool", name:"todowrite", state.input.todos`（本机 DB 抽查 5 个会话有） |
| `todowrite` 是权限键 / 工具名（v1/v2 同名） | SDK types `todowrite?: PermissionActionConfig` |

关键结论：**历史消息本身就是 todo 的持久化载体**。即使 serve 重启、todo 内存态丢失，
最后一条 `todowrite` 工具调用的 `state.input.todos` 仍然完整可读。

## 3. 业界实现

### 3.1 Claude Code（Anthropic）

- 旧模型：`TodoWrite`（整表写入）。新版本（v2.1.268+）默认提供
  `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` 四件套（`CLAUDE_CODE_ENABLE_TASKS=0` 可退回 TodoWrite）。
- 状态生命周期：`pending → in_progress → completed`，删除用 `TaskUpdate {status:"deleted"}`。
- **没有独立的 todo REST API**：官方 Agent SDK 文档明确说，客户端从**消息流里的
  `tool_use` / `tool_result` 块**自行维护任务表（示例 `TaskTracker` 就是按 tool id 归并
  create/update，渲染 `completed/total` 与当前 in-progress 项）。
- 适用门槛：3+ 步、用户给了任务清单、长操作；简单单步任务不建表。

来源：<https://code.claude.com/docs/en/agent-sdk/todo-tracking>

### 3.2 OpenAI Codex CLI

- 工具：`update_plan({ explanation?, plan: [{ step, status: pending|in_progress|completed }] })`。
- **最多一个 in_progress**；harness 负责渲染，模型被要求不要复述整张表。
- 计划只用于非平凡/多阶段任务；执行中允许整体重写并附 explanation。
- 已知问题：checklist 可能在工作完成后仍显示旧状态（openai/codex #21327），
  即"UI 状态与真实完成度不同步"。

来源：Codex CLI system prompt（update_plan 工具定义与 Planning 段）

### 3.3 Gemini CLI

- 工具：`write_todos({ todos: [{description, status}] })`，**整表替换**。
- 状态：`pending / in_progress / completed / cancelled / blocked`；**只有一个 in_progress**。
- 会话级作用域；UI 显示在输入框上方，`Ctrl+T` 展开完整列表。

来源：<https://geminicli.com/docs/tools/todos/>

### 3.4 Qwen Code

- 工具：`todo_write({ todos: [{ id, content, status }] })`，默认关闭，需配置开启。
- **持久化到 `~/.qwen/todos/` 的按会话文件**（少数真正落盘的实现）。
- 状态：pending / in_progress / completed；会话隔离；3+ 步才用。

来源：<https://qwenlm.github.io/qwen-code-docs/en/developers/tools/todo-write/>

### 3.5 Cursor

- Plan Mode + agent 维护的 TODO 列表（计划可编辑、逐项执行）；公开资料以产品行为为主，
  未暴露稳定的 todo 读取 API。模式上属于"计划与执行分离"的一类。

来源：Cursor agent best practices、Plan Mode 文档/社区

### 3.6 opencode（本家）

- `todowrite` 工具；TUI 在 `experimental.todo: true` 时展示会话/侧栏任务列表。
- 内存态、按会话；跨压缩或新会话丢失（#18071）。
- 社区反馈的 UX 陷阱：**整表重写会把仍未完成的相关项从列表里"藏掉"**（#18071 评论），
  建议 append/merge 语义或默认保留未完成项。

## 4. 横向对比

| 维度 | Claude Code | Codex | Gemini CLI | Qwen Code | opencode |
|---|---|---|---|---|---|
| 工具形态 | TodoWrite / Task* | update_plan | write_todos | todo_write | todowrite |
| 写入语义 | 整表 / 逐项更新 | 整表 + explanation | 整表 | 整表 | 整表 |
| 状态词 | pending/in_progress/completed(+deleted) | pending/in_progress/completed | +cancelled/blocked | pending/in_progress/completed | +cancelled |
| 单 in_progress | 是（隐含） | 是（硬约束） | 是 | 未强制 | 未强制 |
| 持久化 | 会话 transcript（tool_use） | 会话 transcript | 会话内存 | 按会话文件落盘 | 会话内存 |
| 客户端读取 | **从消息流重建** | harness 内部渲染 | 会话状态 | 文件 | 事件/内存 |
| 独立读取 API | 无（客户端自行跟踪） | 无公开 | 无 | 文件 | 2.x 曾有 `/todo`，2.1 移除 |

**三条行业共识：**

1. **Todo 状态是"工具调用流"的衍生物，不是独立资源。** 主流实现都不把 todo 当
   一等 REST 资源；客户端从 tool_use/tool_result 或事件流重建。
2. **状态词高度收敛**：pending / in_progress / completed（+ cancelled/blocked），
   in_progress 通常只允许一个。
3. **持久化普遍薄弱**：多数是会话内存/transcript；只有 Qwen 明确落盘。opencode 的
   持久化请求被关闭（not planned），说明不应等待上游。

## 5. MAFW 落地方案

### 5.1 推荐：历史回放 hydration（主路径）

`adapter.session.todo(sessionID)` 改为：

1. `GET /api/session/{id}/message?limit=100&order=desc`（必要时按 cursor 翻页，最多 N 页）；
2. 从消息 `content[]` 中找最后一条 `type:"tool"` 且
   `name/tool ∈ {todowrite, todo_write, TodoWrite}` 的 part；
3. 返回 `state.input.todos`（无则 `[]`）。

理由：

- **与业界一致**：Claude Code 官方就是"客户端从消息流里的 tool_use 重建"；
- **天然持久**：历史在 `opencode.db`，重启/压缩/换网关进程都不丢；
- **零上游依赖**：不等待 opencode 恢复 `/todo` 路由；
- **不新增契约**：继续走现有 `GET /api/sessions/:id/todo`，桌面无需改。

注意：

- 只认 `state.input.todos`（入参是模型写下的完整表），不要用 output 文本解析；
- 工具名大小写/下划线变体做归一（`todowrite` / `todo_write` / `TodoWrite`）；
- 分页上限设一个硬帽（如 3 页 × 100 条），找不到就返回 `[]`，避免长会话每开一次扫全库；
- 可加 per-session 短 TTL 缓存，`plan.updated` 事件到达时失效。

### 5.2 实时：事件映射（已完成）

`todo.updated → plan.updated`（properties.todos 透传），桌面 `dock.ts` 直接消费。
与 hydration 配合：打开会话先回放历史，之后由事件增量覆盖。

### 5.3 UI 约定（借鉴业界，暂不强制）

- 状态词归一：`pending / in_progress / completed / cancelled(blocked)`；
- 只高亮一个 in_progress（即便模型写了多个）；
- 显示 `completed/total` 进度与当前项；
- 整表重写可能"藏掉"未完成项（opencode #18071 评论）——桌面可保留"上一版未完成项"
  的 diff 提示，或至少在列表骤减时不做惊跳动画（后续 UX 切片）。

### 5.4 明确不做

- **不自建 todo 持久化存储**：历史已经持久，另起一份会产生双账本和一致性问题；
- **不新增 `/api/todos` 资源面**：业界没有这个模式，且会与 runtime 事件竞争；
- **不做跨会话/项目级 backlog**：那是产品级功能（Qwen 的 `~/.qwen/todos`），与
  "agent 当前任务计划"是两类东西，另立项再议。

## 6. 实现切片（建议）

1. `opencode-adapter.ts`：`todo()` 历史回放 + 工具名归一 + 分页硬帽（TDD：fixture part、翻页、无 todo）；
2. 网关 `/api/sessions/:id/todo` 不变（自动受益）；
3. 桌面无需改（`todos` 面板已消费该路由；实时走 `plan.updated`）；
4. 真机验收：打开一个历史会话（含 todowrite），任务面板应立即显示；再跑一轮 todo 工具，实时更新。

## 7. 参考

- Claude Code — Track todos: <https://code.claude.com/docs/en/agent-sdk/todo-tracking>
- Codex CLI system prompt（update_plan）: <https://zerotwo.ai/prompts/system-prompts/openai/openai-codex-cli>
- Gemini CLI — Todo tool: <https://geminicli.com/docs/tools/todos/>
- Qwen Code — todo_write: <https://qwenlm.github.io/qwen-code-docs/en/developers/tools/todo-write/>
- opencode #18071（todo 持久化，closed as not planned）: <https://github.com/anomalyco/opencode/issues/18071>
- opencode #5934（compaction 后 todo 丢失）: <https://github.com/anomalyco/opencode/issues/5934>
- openai/codex #21327（checklist 过期）: <https://github.com/openai/codex/issues/21327>
