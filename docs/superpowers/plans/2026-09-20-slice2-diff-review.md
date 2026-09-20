# 切片 2：diff 审阅闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话改动可审阅：gateway 暴露 session diff 与逐 hunk 回退端点（复用 opencode v2 `session.diff`/`vcs.diff`/`vcs.apply` 原语）；desktop 「Review changes」面板逐 hunk 保留/回退；SSE `session.diff` 实时填充 `session_diff`；TUI 保持只读不变。

**Architecture:** gateway 为唯一新增面——runtime 契约加 `diffApi` 能力（opencode 独有，pi 缺席即能力门）；hunk 反向 patch 为纯函数（客户端传原 patch + 选中 hunk 下标，gateway invert 后 `vcs.apply`，无状态）；desktop 轻量 `DiffReviewPanel`（不复用 SessionReviewV2 全家桶，YAGNI）。事件面：`session.diff` 补矩阵条目 + desktop dispatcher handler。

**Tech Stack:** gateway（jest，simple-git 已有）/ @mafw/sdk（bun test）/ desktop（bun:test）。TUI 本切片零改动。

**Spec:** `docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md` §4（切片 2）。

## Global Constraints

- hunk 纯函数两端解耦：gateway 有完整 invert（jest）；desktop 只有展示用 `splitHunks`（bun test）；不共享代码避免跨包耦合
- `vcs.apply` 前置校验 patch 非空且 hunkIndices 全部命中，非法 → 400；apply 失败 → 502 + 原始错误消息（不静默）
- 能力门：runtime 缺 `diffApi` → diff 两端点 503（与 session-branch 同模板）
- 路由注册顺序：`/api/sessions/:id/diff*` 具体路径在 `/api/sessions/:id` 通配之前
- pi 不实现（无 vcs 原语）——能力缺席即降级，不崩
- 每任务独立 commit；gateway `npm test`、desktop `bun test`、SDK `bun test` 各自全绿

---

### Task 1: gateway hunk-patch 纯函数

**Files:**
- Create: `gateway/src/core/diff/hunk-patch.ts`
- Create: `gateway/tests/unit/diff/hunk-patch.test.ts`

**Interfaces:**
- Produces:
  - `splitPatch(patch: string): { header: string[]; hunks: Array<{ header: string; lines: string[] }> }`
  - `invertHunks(patch: string, hunkIndices: number[]): string | null`——header + 选中 hunk 的反转（`@@ -a,b +c,d` → `@@ -c,d +a,b`；`+`↔`-`、context 不动、`\` 行保留；计数显式重算）
  - `buildRevertPatch(patches: Array<{ patch: string; hunkIndices: number[] }>): string | null`——多文件合并（每文件 `diff --git` 段独立反转），任一文件无命中 hunk 返回 null
- [ ] TDD：测试覆盖 → 普通修改反转 / 计数重算（含 `,b` 省略形式）/ 多 hunk 选择子集 / `@@` 无 section 尾注 / `\ No newline` 保留 / 空选择 → null / 下标越界 → null
- [ ] `cd gateway && npx jest tests/unit/diff/hunk-patch.test.ts` 红 → 实现 → 绿
- [ ] Commit: `feat(diff): hunk parse/invert pure functions (server-side reverse patch)`

### Task 2: runtime 契约 diffApi + opencode 透传

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`RuntimeCapabilities.diffApi?: boolean`——Tier 2 opencode true / minimal false；`RuntimeClient.session` 可选方法：`diff?(opts: { sessionID: string; messageID?: string }): Promise<Array<{ file?: string; patch?: string; additions?: number; deletions?: number; status?: string }>>`；`vcs?: { diff?(opts?: { mode?: 'git' | 'branch' }): Promise<any[]>; apply?(opts: { patch: string }): Promise<void> }`）
- Modify: `gateway/src/opencode-adapter.ts`（session.diff → `client.session.diff({sessionID, messageID?})` unwrap；vcs.diff → `client.vcs.diff`；vcs.apply → `client.vcs.apply`；capabilities 加 `diffApi: true`）
- Modify: `gateway/tests/unit/runtime/contract.test.ts`（fullCapabilities 含 diffApi true / minimal false 断言）
- pi：不实现（无 vcs 原语）——零改动，方法缺席即能力门
- [ ] jest 红（capabilities 断言）→ 实现 → 绿；`npm run build` 过
- [ ] Commit: `feat(runtime): diffApi capability + opencode session.diff/vcs.diff/vcs.apply passthrough`

### Task 3: gateway diff 端点

**Files:**
- Create: `gateway/src/routes/session-diff.ts`（deps 注入可单测：`{ runtime }`）
  - `GET /api/sessions/:id/diff?messageID=` → `runtime.session.diff` → `{ files: [...] }`；能力门 503
  - `POST /api/sessions/:id/diff/revert` body `{ patches: [{ file, patch, hunkIndices }] }` → 校验（数组非空、每项 patch 非空、hunkIndices 非空且 ≤ 总 hunk 数）→ `buildRevertPatch` → `runtime.session.vcs.apply({patch})` → `{ reverted: n }`；非法 400、apply 抛错 502、能力门 503
- Modify: `gateway/src/index.ts`（两路由接线，注册在 `/api/sessions/:id` 通配之前；与 session-branch 同位置风格）
- Modify: `gateway/src/routes/route-catalog.ts`（`sessions.diff` GET、`sessions.revertDiff` POST）→ `npm run emit:openapi` + `(sdk) npm run gen:api`
- Create: `gateway/tests/unit/diff/routes-session-diff.test.ts`（mock runtime：diff 列表透传 / revert 校验 400 矩阵 / apply 抛错 502 / 无能力 503）
- [ ] jest 红 → 实现 → 绿；gateway `npm test` 全绿 + build 过
- [ ] Commit: `feat(gateway): session diff endpoints (GET diff + POST hunk revert via vcs.apply)`

### Task 4: SDK

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`（`session` 命名空间：`diff(sessionID, messageID?)` → GET；`revertDiff(sessionID, patches)` → POST；DTO `FileDiffInfo`）
- Modify: `packages/gateway-sdk/src/types.ts`（`FileDiffInfo { file?: string; patch?: string; additions?: number; deletions?: number; status?: string }` + SessionNamespace 方法签名）
- Modify: `packages/gateway-sdk/src/client.test.ts`（wire 测试：GET 带 query / POST body）
- [ ] `cd packages/gateway-sdk && bun test` 全绿
- [ ] Commit: `feat(sdk): session.diff + session.revertDiff`

### Task 5: desktop 审阅面板 + SSE 实时 diff

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/diff-hunks.ts`（纯函数：`splitHunks(patch): Array<{ header: string; lines: string[]; oldCount: number; newCount: number }>`、`hunkStats`；bun test）
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/diff.ts`（`handleDiffEvent: SidHandler`——`event.type === 'session.diff'` → `deps.diff.setSessionDiff(sid, event.properties?.diff ?? event.diff ?? [])`；永不消费返回 false？——session.diff 是终态事件，返回 true 消费；测试）
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（`DiffDeps` + `setSessionDiff` + EXTRA_HANDLERS 注册 + `session.diff` 加入 `TAIL_ACCOUNTED`？——注意 `isTailAccountedAtShell` 的 TAIL_ACCOUNTED_TYPES 需加 `session.diff`，session-events.ts 同步）
- Modify: `packages/session-ui/src/components/message-part.tsx`（`UserActions` 加可选 `diffReview?: () => void`；fork/revert 按钮旁渲染「Review」入口）+ `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（actions 注入：打开面板）
- Create: `packages/desktop/src/renderer/mafw/components/DiffReviewPanel.tsx`（弹层/侧板：文件列表 + 逐 hunk checkbox + diff 行着色 + 「回退选中」→ `sessions.revertDiff` → 刷新；数据源 props.diffs（优先 SSE session_diff，空则拉 `sessions.diff(sid)`））
- Modify: `MafwShell.tsx`（面板开闭 signal + 工具条入口按钮 + `diffDeps` 接线）
- Tests: `diff-hunks.test.ts`、`sse/handlers/diff.test.ts`、dispatcher.test.ts 补 diff stub
- [ ] desktop `bun test` 全绿 + `npx electron-vite build` 过
- [ ] Commit: `feat(desktop): diff review panel (hunk keep/revert) + live session.diff wiring`

### Task 6: AGENTS.md + 全量验证

- [ ] AGENTS.md：§5.19 契约清单加 `diffApi` 行 + §5.5 或新小节记 desktop 审阅面板与 SSE handler
- [ ] 全量：gateway jest / desktop bun / TUI / SDK / gateway build 全绿
- [ ] 手动冒烟：让 agent 改一个文件 → 工具条 Review changes → 面板出 hunk → 勾选回退 → 文件内容回滚 → 刷新 diff 清空对应 hunk
- [ ] Commit: `docs: diff review slice (slice 2)`

## 明确不做（本切片）

- SessionReviewV2 全家桶接入（sidebar/file-preview/worker pool）——轻量面板先交付闭环
- TUI hunk 交互（spec 明确后续再评；TUI 零改动）
- pi runtime diff 能力（无 vcs 原语，能力门降级）
- hunk 级行内评论（session-review 有设施，后续 wave）

## Self-Review 记录

- Spec §4 覆盖：gateway 两端点（Task 3）、desktop 面板+双入口（Task 5：工具条 + SessionTurn actions）、TUI 只读（零改动）、fail 语义（能力门 503/校验 400/apply 502）
- 类型一致：`FileDiffInfo` Task 4 定义与 Task 3 路由返回对齐；`hunkIndices` 语义两端一致（0-based，对 splitPatch().hunks 下标）
- 已知边界：新增/删除整文件的 hunk 反转在 git apply 侧行为依赖 fuzz，冒烟验证；`vcs.apply` 在 opencode 的确切语义（worktree cwd）以 adapter 透传为准，实测校准
