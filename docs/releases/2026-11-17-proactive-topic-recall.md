# 2026-11-17 · Proactive Topic Recall

- **分支**：`main`
- **设计**：`docs/superpowers/specs/2026-11-17-personal-memory-first-principles-design.md`
- **计划**：`docs/superpowers/plans/2026-11-17-proactive-topic-recall.md`
- **提交**：`4f59871`（Topic State）→ `f4defb3`（recall 头部）→ `a3c03b1`（工具）→ `f1d954f`（并发 package 编码修复）→ 本文档提交

## 交付

1. **per-session Topic State**
   - kv scope `session-topic`；新会话未设置；同 session 跨 gateway 重启保留。
   - `POST /api/recall/topic` / operation `recall.topicSet`；支持 `expectedRevision` 乐观并发（冲突 409）。
   - gateway 从 `currentTurn(sessionID)` 附加真实 `sourceTraceId`，Agent 不能伪造。

2. **每轮 recall 头部**
   - 旧 `<recall>` 本体上方增加 `<topic-recall>`：
     - `主题：<topic>`
     - `相关记忆：见下方 | 无`
   - 未设置主题时明确 `主题：未设置` 并提示 `mafw_topic_set`。
   - 本版**未改** BM25/dense/FOK/快照/邻居算法；严格相关门控仍是后续切片。

3. **`mafw_topic_set`**
   - OpenCode 原生工具自动携带 `ctx.sessionID`。
   - gateway MCP 工具显式要求 `sessionID`；工具注解为非只读、非破坏。
   - 可设置/继续/纠偏/关闭主题；不写长期事实，不替代 episode 边界。

4. **Proactive prompt**
   - canonical：`packages/runtime-core/src/host-adapter.ts`。
   - OpenCode fallback：`src/hooks/memory-guide.ts`。
   - 主 Agent：未设置主题时主动设置；主题偏移先核实再纠偏；`相关记忆：无` 不用无关内容补位；子代理不得调用主题工具。

## Review 修复 pass

- TUI 注入过滤加入 `<topic-recall>`，并用真实 `topic-recall + recall` payload 固定回归。
- Topic State 域层统一限制 topic 200 / summary 1000 / list item 200 / list 32，校验 `active` boolean 与 `expectedRevision` 非负整数；HTTP/MCP/原生入口共享该约束。
- header 的 `相关记忆` 只由可靠 recall 本体决定；note-board/goal 快照和 FOK `no-memory` 不再被误报为相关记忆。
- 增加旧 recall 本体逐字相等断言、主题包裹字符转义和 HTTP `active` 类型测试。
- 修正文档中的工具数量与新增测试计数。

## 测试

新增测试 **29 个**，覆盖 Topic State、HTTP route、recall 头部、原生工具、MCP handler、canonical/fallback prompt，以及 review 修复的主题边界/TUI 真实 payload。

- Gateway 本功能 + recall/MCP/API contract + 架构 ledger + human-boundary 定向：**386/386 passed**
- runtime-core：**50/50 passed**
- root native/fallback tool + prompt：**5/5 passed**
- TUI chat-store 真实注入 payload：**30/30 passed**
- 定向合计：**471/471 passed**
- `gateway` 全量（review 修复后最终重跑）：**1029 suites / 8195 tests；8193 passed，2 skipped，0 failed**。
- 类型门禁：`gateway tsc --noEmit -p tsconfig.json` 与根 `tsc --noEmit` 均通过。
- TUI 定向 `node --test tests/chat-store.test.ts`：30/30。完整 TUI typecheck 仍受本机未安装 `@earendil-works/pi-tui` 依赖阻塞，与本切片无关。

## 范围外 / 后续

- 本版只新增主题控制面与头部，不宣称“相关门控已完成”；旧 recall 候选仍按原逻辑显示。
- 后续：Matter 实体、主题参与 Query Frame、严格 active/scope/relevance/provenance 门控、事实 reconcile/retract。
- 无新表示学习、无 LLM 进入 100ms 热路径、无 raw T1 改写。
