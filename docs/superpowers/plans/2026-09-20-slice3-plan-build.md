# 切片 3：plan/build 模式引导 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** composer 一键 plan⇄build 模式切换（Tab 循环 + 按钮循环，权限随 opencode plan agent 走）；agentSel 升级 per-session；WelcomeHome「先规划」引导卡；TUI /plan /build /agent；能力门按 agents 列表内容判定（pi 空列表自动隐藏）。

**Architecture:** gateway **零改动**（`SessionPromptOpts.agent` 全链路已通，opencode 内置 plan/build primary agent 天然在 `/api/agents` 列表；pi 列表恒空 → 内容判定即能力门）。desktop 把 `agentSel` 全局单值升级为 `agentPicks: Record<sid, name>`（对齐 modelPicks 模式），三态循环「默认→plan→build→默认」本质是 agentPicks 写入/清除。TUI 照抄 modelSelection 模式加 agentSelection。

**Tech Stack:** desktop SolidJS（bun test 回归 + build）/ TUI（node --test）。gateway/SDK 零改动。

**Spec:** `docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md` §5（切片 3）。

## Global Constraints

- 能力门唯一依据：`primaryAgents` 列表是否含 `plan`/`build`（pi 的 providerConfigApi=true 但列表恒空，**不得**用 capability flag）
- manager 会话锁语义不破坏：lockedManager 时不显示 plan/build 切换（沿用 AgentPicker 锁定模式）
- plan/build 切换不发 gateway 请求（纯前端 agentPicks 写入，随下一次 prompt 生效）
- 每任务独立 commit；desktop `bun test` + build、TUI `npm run test:tui` 各自全绿

---

### Task 1: desktop agentSel → per-session agentPicks

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
  - `agentSel` 信号（:1687）→ `agentPicks` createStore `Record<string, string>`（sid → agent name）；`applyAgentSwitch(a, sid)` 写 picks；`resetChatWorkspace` 清空
  - 发送链不改（ChatPane 仍收一个解析后的 AgentEntry）——新增 `sessionAgent(sid)` accessor：`agentPicks[sid]` → 查 primaryAgents 得 AgentEntry → null
  - 下发给每个 ChatPane 的 `agentSel={sessionAgent(leaf.sid)}`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（props 类型不变——仍是 AgentEntry | null）
- [ ] `bun test` 全绿（无回归）+ `npx electron-vite build` 过
- [ ] Commit: `refactor(desktop): per-session agentPicks (agentSel global single → Record<sid,name>)`

### Task 2: composer plan/build 三态循环 + 能力门

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
  - composer 工具条加模式按钮（⇄ 旁）：三态循环「默认 → plan → build → 默认」——点击写 `props.onPlanBuildToggle(next)`；仅当 `primaryAgents` 含 plan 或 build 且非 manager 锁时渲染
  - 按钮文案：`◇ 默认` / `◇ plan` / `◇ build`；Tooltip 说明当前模式语义（plan=只读规划、build=执行）
  - **Tab 键循环**：composer textarea keydown——无 picker 打开且无补全激活时，Tab → preventDefault + 调同一 onPlanBuildToggle 循环（有补全时保持现有补全行为）
  - 修 agent pill 假渲染：pill 加 `Show when={primaryAgents().length > 0 || isManager}` 门（探查报告差距 2）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`onPlanBuildToggle(sid, next)` 实现：next='默认' → 删 picks；否则 applyAgentSwitch(查表 AgentEntry, sid)）
- Modify: `packages/desktop/src/renderer/mafw/components/pickers/AgentPicker.tsx`（plan/build 条目加视觉徽标「只读规划」/「执行」——description 已有则不加）
- [ ] build + bun test 全绿
- [ ] Commit: `feat(desktop): plan/build mode cycle (Tab + button) with list-content capability gate`

### Task 3: WelcomeHome 引导卡

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`（`mafw-welcome-actions` 行加「先规划，再让 agent 执行」按钮——`Show when={props.hasPlanAgent}`；点击调 `props.onStartWithPlan?.()`）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`onStartWithPlan`：`void createSession().then(sid => sid && applyAgentSwitch(planEntry, sid))`；`hasPlanAgent={primaryAgents().some(a => a.name === 'plan')}`；渲染点 :2283-2294 传参）
- [ ] build 过 + bun test 全绿
- [ ] Commit: `feat(desktop): WelcomeHome plan-first guidance card`

### Task 4: TUI /plan /build /agent

**Files:**
- Modify: `packages/tui/src/store/chat-store.ts`（`SessionApi.promptAsync` body 类型加 `agent?: string`；新增 `getAgent?(): string | undefined` dep，deliver 时并入 body——仿 getModel :42-43、:162-165）
- Modify: `packages/tui/src/ui/app.ts`（模块级 `agentSelection`；`/plan` `/build` 立即命令设 selection + 状态栏 hint；`/agent` → `client.agents.list()` 过滤 primary + 「默认」项 → ClickableSelectList picker（仿 /model :241-275）；chat-store 构造处传 `getAgent: () => agentSelection`）
- Modify: `packages/tui/src/ui/command-registry.ts` + `slash-commands.ts`（三命令注册：/plan、/build、/agent，category '模型' 或新 '模式'；immediate: true）
- Modify: `packages/tui/src/ui/status-bar.ts`（agent 标签槽位：`agentLabel?: string`，有值显示 `◇plan` 等）
- Tests: `packages/tui/tests/chat-store.test.ts` 补 getAgent 并入 body 断言；command-registry/slash 测试若断言命令总数则同步
- [ ] `npm run test:tui` 全绿
- [ ] Commit: `feat(tui): /plan /build /agent mode commands + agent in prompt body + status label`

### Task 5: AGENTS.md + 全量验证

- [ ] AGENTS.md：§5.5 或 composer 相关处补 plan/build 引导段（agentPicks per-session、Tab 循环、内容判定能力门、TUI 命令）
- [ ] 全量：desktop bun + build、TUI、SDK、gateway（应零改动全绿）
- [ ] 手动冒烟：composer 点模式按钮/按 Tab 循环 → 发消息 → opencode 会话按 plan agent 只读执行；切 build 恢复；pi runtime 下按钮隐藏；WelcomeHome 引导卡开新会话自动带 plan
- [ ] Commit: `docs: plan/build mode guidance (slice 3)`

## 明确不做（本切片）

- pi 的 `translateAgents()` 桥接 `piAgentConfig.list()`（让 pi 也列 agents）——后续独立小改造
- plan 摘要带入 build（依赖 opencode 原生 session 上下文，无额外动作；显式摘要注入留待需要时）
- agentPicks localStorage 持久化（对齐 modelPicks 内存语义）
- SessionTurn actions 加 plan/build 入口（SessionTurn 已有「审阅改动」入口，避免按钮堆叠）

## Self-Review 记录

- Spec §5 覆盖：composer 模式切换+Tab（Task 2）、权限随 plan agent（agent 字段既有链路）、WelcomeHome 引导（Task 3）、能力门 pi 隐藏（列表内容判定）、TUI 命令（Task 4）
- 类型一致：`onPlanBuildToggle(sid, next: '默认'|'plan'|'build')` 两端一致；TUI `agentSelection: string | undefined`
- 行号锚基于 2026-09-20 探查报告，executor 以内容定位
