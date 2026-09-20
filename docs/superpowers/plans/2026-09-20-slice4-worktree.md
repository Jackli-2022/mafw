# 切片 4：worktree 并行隔离 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话可带独立 git worktree 创建（agent 在隔离副本工作，互不踩踏）；session↔worktree 映射 + 删除联动清理；desktop「并行任务」入口 + Rail/ChatPane 徽标；TUI picker 标注；pi 能力门隐藏。

**Architecture:** gateway 新增 `SessionWorktreeManager`（`git worktree add <project>-wt-<slug> -b mafw/<slug>`，平铺命名与 goal worktree 约定一致）；映射存 gateway.db kv `session-worktree/<sid>`（serve 端 session 无 metadata，徽标判定走 `s.directory` 与映射读取两层）；`POST /api/session` body 加 `worktree?: boolean | string`；`DELETE /api/sessions/:id` 联动清理（fail-open）。能力位 `worktreeApi`（opencode true / pi false）。desktop 徽标判定 = `s.directory` 非项目主目录（前缀匹配）。

**Tech Stack:** gateway（jest，真实 tmp git 仓）/ SDK（bun test）/ desktop（bun test + build）/ TUI（node --test）。

**Spec:** `docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md` §6（切片 4）。

## Global Constraints

- worktree 命名：`<projectBasename>-wt-<slug>`，平铺于项目同级目录（与 goal `<proj>-goal-<id>` 约定一致）；slug 冲突自动 `-2`/`-3` 递增
- 分支命名 `mafw/<slug>`；worktree 已存在则复用（幂等，同 GoalWorktreeManager.prepare 语义）
- 清理 fail-open：session 删除时的 worktree remove/branch delete 失败只 warn，不阻塞删除
- **复用 GoalWorktreeManager 时强制 parallel 路径**（其非并行模式会切走主仓分支，与本切片目标相悖——故新建独立轻量 manager，不复用 prepare）
- pi runtime：无 worktreeApi 能力位 → desktop 入口隐藏；TUI 徽标为只读展示不做门
- 每任务独立 commit；gateway jest / SDK bun / desktop bun+build / TUI node --test 各自全绿

---

### Task 1: gateway SessionWorktreeManager

**Files:**
- Create: `gateway/src/core/engine/session-worktree-manager.ts`
- Create: `gateway/tests/unit/worktree/session-worktree-manager.test.ts`

**Interfaces:**
- Produces:
  - `class SessionWorktreeManager`（构造 `projectDir: string`）
    - `create(slug?: string): Promise<{ worktreeDir: string; branch: string }>`——slug 缺省 `wt-<YYYYMMDD-HHmmss>`；目标目录已存在 → 复用（返回既有路径）；目录被非 worktree 占用 → 抛错；分支 `mafw/<slug>` 已存在 → 复用不新建（`git worktree add <dir> <branch>` 对已检出的分支报错 → 捕获后改为 `git worktree add <dir>` detached? **否**——直接查 `worktree list` 找到该分支的既有 worktree 返回）
    - `remove(worktreeDir: string, branch?: string): Promise<void>`——`git worktree remove --force` + `branch -D`（branch 可选）
    - `list(): Promise<Array<{ path: string; branch: string }>>`——过滤仅本 manager 命名约定的条目（`-wt-` 中缀 + `mafw/` 分支）
- 测试用**真实 tmp git 仓**（`git init` + 一次 initial commit——worktree add 需要至少一个 commit）覆盖：创建/幂等复用/冲突 slug 递增/remove/list 过滤
- [ ] jest 红 → 实现 → 绿（`cd gateway && npx jest tests/unit/worktree/`）
- [ ] Commit: `feat(worktree): SessionWorktreeManager (create/reuse/remove/list)`

### Task 2: gateway 创建编排 + 删除联动 + 能力位

**Files:**
- Modify: `gateway/src/index.ts`
  - `POST /api/session`（:4428-4440 内联路由）：body 加 `worktree?: boolean | string`——true 时：`projectDir = path.resolve(body.directory ?? '.')`；`new SessionWorktreeManager(projectDir).create(typeof body.worktree === 'string' ? body.worktree : undefined)` → `sdkSession.create(worktreeDir, metadata)` → kvSet `session-worktree/<sid>` = `{ dir, branch, projectDir }` → 返回 `{ session, worktree: { dir, branch } }`；创建失败 500 带原因
  - `session.delete` 消费链：`routes/session-mutations.ts` 的 delete handler 成功后 → 读 kv `session-worktree/<id>` → best-effort `remove()` + kvDel（fail-open warn）。deps 加 `getGatewayDb`/`worktreeCleanup` 闭包（沿 session-mutations 既有 deps 注入模式，executor 现场对齐）
- Modify: `gateway/src/runtime/contract.ts`（`RuntimeCapabilities.worktreeApi?: boolean`；fullCapabilities true / minimalCapabilities false）+ `gateway/tests/unit/runtime/contract.test.ts`、`opencode-runtime.test.ts` 断言同步
- pi：不声明（PI_CAPABILITIES 不加）→ 隐藏
- [ ] jest 红（capabilities + 路由集成测试：`tests/unit/worktree/routes-session-create.test.ts` mock sdkSession + tmp git 仓覆盖 worktree 创建/复用/删除联动清理）→ 实现 → gateway `npm test` 全绿 + build 过
- [ ] Commit: `feat(gateway): worktree session creation + delete-linked cleanup + worktreeApi capability`

### Task 3: SDK

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`（`session.create` body 加 `worktree?: boolean | string`，返回类型 `{ session: Session; worktree?: { dir: string; branch: string } }`）
- Modify: `packages/gateway-sdk/src/types.ts`（SessionNamespace.create 签名同步）
- Modify: `packages/gateway-sdk/src/client.test.ts`（wire：worktree 参数透传 body）
- [ ] `bun test` 全绿
- [ ] Commit: `feat(sdk): session.create worktree option`

### Task 4: desktop 入口 + 徽标

**Files:**
- Modify: `packages/desktop/src/preload/mafw-types.ts`（sessions.create 类型加 worktree；返回含 worktree 可选）
- Create: `packages/desktop/src/renderer/mafw/components/worktree-label.ts`（纯函数：`isWorktreeSession(directory: string | undefined, projectDir: string | null): boolean`——directory 存在且非空且 projectDir 非空且 directory !== projectDir 且 directory.startsWith(projectDir 同盘符判定放宽为不区分大小写前缀比较失败时退化为 basename 不同)；`worktreeBadge(directory): string`——取 basename 剥 `-wt-` 前段；bun test 覆盖）
- Modify: `packages/desktop/src/renderer/mafw/components/Rail.tsx`（会话行 title 旁：`isWorktreeSession(s.directory, projectID())` → `⎇ <badge>` 徽标 + TooltipV2 完整路径）
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（titlebar token badge 旁：同判定 + 徽标；composer 工具条加「⎇ 并行」按钮——`Show when={props.worktreeEnabled && !props.isManager}`，点击 `props.onCreateWorktreeSession?.()`）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
  - runtime 能力缓存：`const [rtCaps, setRtCaps] = createSignal<Record<string, boolean>>({})`，gw ready 时 `window.api.mafw.runtime` 命名空间读 `GET /api/runtime`（SDK `runtime` 命名空间，executor 现场确认方法名；缺方法则经 fetch 直读）→ setRtCaps；`worktreeEnabled = () => !!rtCaps().worktreeApi`
  - `onCreateWorktreeSession(sid)`：`sessions.create({ directory: <当前项目主目录>, worktree: true })` → openSessionTab(newSid) + toast（显示 worktree dir）；数据源 directory 取 Rail 同源（`currentProject()?.worktree`），无项目 → toast 提示
  - 下发 `worktreeEnabled`/`onCreateWorktreeSession` 给 ChatPane；`worktreeBadge` 数据经 session info `directory` 已在 store
- Tests: `worktree-label.test.ts`；dispatcher/session-events 不涉及
- [ ] desktop `bun test` 全绿 + build 过
- [ ] Commit: `feat(desktop): parallel worktree session entry + rail/pane badges (capability-gated)`

### Task 5: TUI picker 标注

**Files:**
- Modify: `packages/tui/src/ui/app.ts`（`showSessionPicker` 行构造：session 对象 `directory` 与项目目录不同 → label 追加 dim ` ⎇<basename>`）
- [ ] `npm run test:tui` 全绿（picker 无直接测试则回归绿即可）
- [ ] Commit: `feat(tui): worktree badge in sessions picker`

### Task 6: AGENTS.md + 全量验证

- [ ] AGENTS.md：§5.19 能力清单加 `worktreeApi` 行 + 新小节「worktree 并行会话（2026-09-20，切片 4）」：命名约定、kv 映射、删除联动、孤儿风险边界（merge 冲突/goal 链路不覆盖）、记忆写入不随 directory 分离（HarmonicUnitFileStore 固定 `~/.mafw`，worktree 内记忆融合仅 goal 链路）
- [ ] 全量：gateway jest / desktop bun+build / TUI / SDK 全绿
- [ ] 手动冒烟：ChatPane「⎇ 并行」→ 新会话 tab 出现且 Rail 行带 `⎇` 徽标 → 在两会话各让 agent 改同一文件互不干扰 → 删除 worktree 会话 → 项目同级目录 worktree 目录消失、分支删除
- [ ] Commit: `docs: worktree parallel sessions (slice 4)`

## 明确不做（本切片）

- Rail 按 worktree 分组重排（徽标 + tooltip 先行，分组与日期分组冲突留后续）
- worktree 会话的记忆融合（HarmonicUnitFileStore 固定 `~/.mafw`，session 维度融合机制留待需要时设计）
- goal worktree 链路改造（prepare 非并行切分支问题另行记录）
- TUI worktree 会话创建入口

## Self-Review 记录

- Spec §6 覆盖：session 创建带 worktree（Task 2）、映射+归档清理（Task 2 删除联动；goal 归档链路不动）、Rail 徽标/pane 标注（Task 4）、「从当前会话开并行任务」入口（Task 4 ChatPane）、TUI 归属显示（Task 5）、能力门 pi 隐藏（Task 2 worktreeApi + Task 4 门）
- 风险对齐探查报告：metadata 通道断裂 → kv 映射；孤儿 worktree → 删除联动 + list/prune 既有工具兜底；GoalWorktreeManager.prepare 陷阱 → 不复用 prepare
- 行号锚基于 2026-09-20 探查报告，executor 以内容定位
