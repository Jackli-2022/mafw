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

## 测试

新增测试 **26 个**，覆盖 Topic State、HTTP route、recall 头部、原生工具、MCP handler、canonical/fallback prompt。

- Gateway 本功能 + recall/MCP/API contract + 架构 ledger + human-boundary 定向：**383/383 passed**
- runtime-core：**50/50 passed**
- root native/fallback tool + prompt：**5/5 passed**
- 定向合计：**438/438 passed**
- `gateway` 全量：**1029 suites / 8192 tests；8184 passed，2 skipped，6 failed**
  - 6 个失败集中在 3 个非本功能 suite：`search-t1-layer`（full-run 5s timeout）、`plugin-standard-command`、`instance-ownership`。
  - 三个 suite 单独运行 **3 suites / 58 tests 全绿**，判断为 full-run 下的超时/并发 git 分支干扰。
- 类型门禁：`gateway tsc --noEmit -p tsconfig.json` 与根 `tsc --noEmit` 均通过。

## 范围外 / 后续

- 本版只新增主题控制面与头部，不宣称“相关门控已完成”；旧 recall 候选仍按原逻辑显示。
- 后续：Matter 实体、主题参与 Query Frame、严格 active/scope/relevance/provenance 门控、事实 reconcile/retract。
- 无新表示学习、无 LLM 进入 100ms 热路径、无 raw T1 改写。
