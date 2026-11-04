# Inputbar / Rail / Attention 重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 §5.27 架构上落地三件：网关双向 switchAgent 门、composer 收敛为会话配置单菜单（含 Thinking 管道）、rail 视觉精修。

**Architecture:** `session-switch` 路由加双向 gate（coordinator 身份 + coordination 绑定）；`SessionConfigService.get` 增 `thinkingLevelSupported` 并经 `session.config` SSE 进入桌面；composer 用「会话配置 pill + popover」替换 agent pill / plan-build pill / `/` `@` 按钮；rail 只重描字形与去虚线，布局零变化。

**Tech Stack:** gateway = TypeScript + jest；desktop = SolidJS + Electron + node --test（`--conditions=browser`）；ui = `@mafw/ui` v1 icon 集（SVG path 字符串）。

**Spec:** `docs/superpowers/specs/2026-11-04-inputbar-rail-attention-redesign-design.md`

**Out of scope（已移交）:** attention 通知链 / 托盘 presence / p0 跨项目——以 `docs/superpowers/specs/2026-11-04-pod-event-layer-ambient-attention-design.md` 为权威设计，由该批次实现（2026-11-04 用户裁决「以他们为准」）。本计划**不产生**任何 `pod.updated {kind:'attention'}` 广播、toast、OS 通知或托盘改动。

## Global Constraints

- 键位零变化：Tab（plan/build 循环）、`/`、`@`、Ctrl+Enter（排队）、↑↓（历史）、Ctrl+B、Ctrl+Alt+B、Ctrl+P、Ctrl+K 全部保持（UI 收按钮不砍功能）。
- 不动 rail 宽度/分组/布局（46px 保持）；不做 rail 0px；不做 topstrip 徽标迁移；**不碰托盘**（presence 归 pod-event 批次）。
- 不改审批模式入口（🛡 独立保留，安全域不混入会话菜单）。
- 不改 result 通知链（`handlePodResultEvent` 保持现状；其退役归 pod-event 批次）。
- UI 一律 `ButtonV2`/`TooltipV2`/`ToastV2`；ButtonV2 classList 多 token 陷阱 → 状态样式用 `aria-*` 选择器（desktop AGENTS）。
- desktop 测试：`npm test`（全量）；单文件：`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test <file>`。
- gateway 单套件：`npx jest <path> --runInBand`（gateway 下）。
- 类型门禁：desktop `npx tsgo --noEmit -p tsconfig.json`；gateway `npx tsc --noEmit -p tsconfig.json`；desktop 构建 `npx electron-vite build`。SDK 类型变更后先 `cd packages/gateway-sdk && npm run build`。
- 事件词汇单源：`session.config` 从 `IGNORED_AT_SHELL` 移出时必须保留 `assertShellEventCoverage` 的 case 覆盖。
- TDD 先行；逐任务提交；测试基线 desktop **2810/2810（617 suites）**（以当前工作树实际为准）。

## Review Focus

1. **coordination 会话切离 lead**：必须 403；`lead-archived`（已解绑）会话必须仍可改 build——Task 1 断言。
2. **thinking 不支持 / 事件串会话**：runtime 无 `setThinkingLevel` 时 GET 返回 `thinkingLevelSupported:false`、菜单行禁用、点击不 400；`session.config` 事件必须按事件 sid 写入，不污染当前会话——Task 2/3 断言。
3. **删 pill 不砍键**：plan/build pill 删除后 Tab 仍三态循环、会话菜单 Agent 行可回「默认」（鼠标可达）——Task 5 断言。
4. **窄窗可达性**：≤520 `＋` 并入 `⋯` 后附件/截屏/引用仍可达、发送恒显、无溢出——Task 5 断言。
5. **字形重描不得静默回退**：`bubble-5`/`magnifying-glass`/`sticky-note`/`team-three` 重描后 icon 名不变、渲染无 `plus` 回退——Task 6 断言。

---

### Task 1: 网关 switchAgent 双向门

**Files:**
- Modify: `gateway/src/routes/session-switch.ts`（`SessionSwitchDeps` ~L18；`handleSessionSwitch` ~L74）
- Modify: `gateway/src/routes/wave1-handlers.ts`（`Wave1Gateway` ~L58；两处 `handleSessionSwitch` 调用 ~L199/L205）
- Modify: `gateway/src/index.ts`（新增两个公开方法，供 Wave1Gateway 接口）
- Test: `gateway/tests/unit/routes/session-switch.test.ts`（扩展）

**Interfaces:**
- Consumes: `resolveIdentityAlias(name)`（`runtime/identity-registry.ts:62`，`manager→lead`）；`LeadSessionRegistry.findBySessionId(sid)`（`core/manager/lead-session-registry.ts:82`）；`IdentityRegistry.get(name)`（index.ts L3907 用法）。
- Produces:
  - `SessionSwitchDeps.isCoordinationSession?: (sid: string) => boolean`
  - `SessionSwitchDeps.isRegistryIdentity?: (name: string) => boolean`
  - 规则：`target = resolveIdentityAlias(body.agent.trim())`；① `bound && target !== 'lead'` → 403；② `!bound && target === 'lead'` → 403；③ `isRegistryIdentity(target) && target !== 'lead' && target !== 'mafw-create'` → 403。错误文案：`'coordinator sessions are managed by the pod'` / `'identity is managed by the pod'`（中性，无 runtime 名）。

- [ ] **Step 1: 失败测试（扩展既有文件）**

```ts
// 既有回归：非 bound + 'build' → 200
// 新增：非 bound + 'lead' → 403 且 runtime.switchAgent 未调用
// 新增：bound + 'build' → 403
// 新增：bound + 'lead' → 200
// 新增：'mfaw-tech-lead' → 403；'mafw-create' → 200
// 新增：bound=false（模拟 lead-archived 已解绑）+ 'build' → 200
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/routes/session-switch.test.ts --runInBand`
Expected: 新增用例 FAIL（当前裸透传）

- [ ] **Step 3: 实现 gate**

在 `handleSessionSwitch` 的 `applySessionSwitch` 调用之前加 agent-kind 分支校验（model 分支不动）。

- [ ] **Step 4: 接线 wave1 + index**

`Wave1Gateway` 增两个可选方法；`session.switchAgent` 调用处传 `isCoordinationSession: (sid) => gw.isCoordinationSession?.(sid) ?? false, isRegistryIdentity: (n) => gw.isRegistryIdentity?.(n) ?? false`。index.ts 加公开方法：

```ts
isCoordinationSession(sid: string): boolean { return !!this.leadSessionRegistry?.findBySessionId(sid); }
isRegistryIdentity(name: string): boolean { return !!this.identityRegistry?.get(name); }
```

- [ ] **Step 5: 运行通过 + 全 route 套件**

Run: `cd gateway && npx jest tests/unit/routes --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/session-switch.ts gateway/src/routes/wave1-handlers.ts gateway/src/index.ts gateway/tests/unit/routes/session-switch.test.ts
git commit -m "feat(gateway): block switching to/from coordinator identities via session switch"
```

---

### Task 2: `thinkingLevelSupported`（gateway + SDK 类型）

**Files:**
- Modify: `gateway/src/core/session-config.ts`（`SessionConfigState` ~L6；`get()` ~L51）
- Modify: `packages/gateway-sdk/src/types.ts`（`SessionConfigState` ~L319）
- Test: `gateway/tests/unit/core/session-config.test.ts`（扩展）

**Interfaces:**
- Produces: `SessionConfigState.thinkingLevelSupported: boolean`（gateway）与 `thinkingLevelSupported?: boolean`（SDK，additive）。`get()` 中 `thinkingLevelSupported: typeof this.deps.setThinkingLevel === 'function'`。

- [ ] **Step 1: 失败测试**

```ts
// 有 setThinkingLevel dep → result.thinkingLevelSupported === true
// 无该 dep → false（且 set('thought_level') 仍 400，既有行为不变）
```

- [ ] **Step 2: 运行确认失败**：`cd gateway && npx jest tests/unit/core/session-config.test.ts --runInBand`

- [ ] **Step 3: 实现 + SDK 类型；重建 SDK**

`cd packages/gateway-sdk && npm run build`

- [ ] **Step 4: 运行通过**

Run: `cd gateway && npx jest tests/unit/core/session-config.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/session-config.ts packages/gateway-sdk/src/types.ts gateway/tests/unit/core/session-config.test.ts
git commit -m "feat(gateway): expose thinkingLevelSupported in session config"
```

---

### Task 3: 桌面 session.config 消费 + thinking 状态管道

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts`（`FlowCardDeps` ~L9；`permission_mode` 分支 ~L90 旁）
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`（`IGNORED_AT_SHELL` ~L106；`assertShellEventCoverage` ~L211）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`sseDeps.flowCards` ~L1157；store 声明区）
- Test: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.test.ts`（扩展）

**Interfaces:**
- Consumes: `session.config` 事件形状 `{ type:'session.config', sessionID, properties:{ sessionID, config: SessionConfigState, category } }`（gateway index.ts L3937-3943 实证）；preload `sessions.config(sid)` / `sessions.setConfig(sid, {category:'thought_level', value})`（mafw-api.ts L102 已有）。
- Produces:
  - `FlowCardDeps.onSessionConfig(sid: string, config: SessionConfigStateLike, category: string): void`
  - MafwShell：`sessionConfigs` store（`Record<string, SessionConfigState>`）+ `thinkingLevelOf(sid)` / `thinkingSupportedOf(sid)` 访问器

- [ ] **Step 1: 失败测试——flow-cards 分支**

```ts
// handleFlowCardEvent({type:'session.config', sessionID:'s1', properties:{sessionID:'s1', config:{thinkingLevel:'high'}, category:'thought_level'}}, 's1', deps)
// → deps.onSessionConfig 收到 ('s1', {thinkingLevel:'high'}, 'thought_level')
// 事件 sid 优先 properties.sessionID（子会话分发的健壮性）
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/sse/handlers/flow-cards.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现分支 + 移出 IGNORED_AT_SHELL**

flow-cards.ts 加分支并 `return true`；session-events.ts 从 `IGNORED_AT_SHELL` 移除 `"session.config"`（`assertShellEventCoverage` 保持 case 覆盖——移入 handled 组注释即可）。`sseDeps.flowCards.onSessionConfig: (sid, config) => setSessionConfigs(sid, config)`。

- [ ] **Step 4: shell 拉取 + 写入**

```ts
// 打开会话时拉取（fail-open）：
createEffect(() => {
  const sid = activeSessionId(); if (!sid) return
  window.api.mafw.sessions.config(sid)
    .then((state) => setSessionConfigs(sid, state))
    .catch(() => { /* fail-open：菜单的 Thinking 行按不支持处理 */ })
})
// 设置档位（乐观 + 回滚）：
const applyThinking = (sid: string, level: ThinkingLevel) => {
  const prev = sessionConfigs[sid]
  setSessionConfigs(sid, { ...(prev ?? {}), thinkingLevel: level } as any)
  window.api.mafw.sessions.setConfig(sid, { category: 'thought_level', value: level })
    .then((state) => setSessionConfigs(sid, state))
    .catch(() => { setSessionConfigs(sid, prev as any); showToastV2({ description: '切换思考档位失败', duration: 2000 }) })
}
```

- [ ] **Step 5: 运行通过**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/sse/handlers/flow-cards.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts packages/desktop/src/renderer/mafw/session-events.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.test.ts
git commit -m "feat(desktop): consume session.config events and track thinking level"
```

---

### Task 4: 会话配置菜单（纯模型 + popover 组件）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/session-config-menu-model.ts`
- Create: `packages/desktop/src/renderer/mafw/components/pickers/SessionConfigMenu.tsx`
- Test: `packages/desktop/src/renderer/mafw/session-config-menu-model.test.ts`

**Interfaces:**
- Produces（纯模型）:

```ts
export const THINKING_LEVELS: ThinkingLevel[]                      // ['off','minimal','low','medium','high','xhigh','max']
export const AGENT_SWITCH_OPTIONS: Array<{ id: 'default' | 'plan' | 'build'; label: string }>
export function agentBadge(agent: string | null | undefined): string | null   // build/null → null；mafw-create → 'create'；manager → 'lead'；其余原样
export function thinkingBadge(level: ThinkingLevel | null | undefined): string | null   // null → null；否则 `⚡ ${level}`
```

- Produces（组件，镜像 `ModelPicker` 的 `trigger`/open/onClose 形态）:

```tsx
export interface SessionConfigMenuProps {
  open: boolean
  trigger: HTMLElement | null
  agentName: string | null                    // 解析后的 agent（agentPicks/session.agent）
  agentLocked: boolean                        // Lead 会话锁定
  agentOptions: Array<{ id: string; label: string }>   // 默认/plan/build（plan 不可用时由调用方剔除）
  thinkingLevel: ThinkingLevel | null
  thinkingSupported: boolean
  onAgentSelect: (id: 'default' | 'plan' | 'build') => void
  onOpenModelPicker: () => void
  onThinkingSelect: (level: ThinkingLevel) => void
  onClose: () => void
}
```

- [ ] **Step 1: 失败测试——纯模型**

```ts
// agentBadge: null→null；'build'→null；'plan'→'plan'；'lead'→'lead'；'manager'→'lead'；'mafw-create'→'create'；'custom'→'custom'
// thinkingBadge: null→null；'high'→'⚡ high'
// AGENT_SWITCH_OPTIONS 恰含 default/plan/build 三项（默认可达——Q6）
```

- [ ] **Step 2: 运行确认失败**：单文件命令同 Task 3

- [ ] **Step 3: 实现纯模型**

- [ ] **Step 4: 实现组件**（本步无单测——组件只做布局；行为由 Task 5 的接线钉扎覆盖）

要点：pill 之外的 popover；行结构 Agent（点击展开 默认/plan/build 内联列表，`aria-expanded`）/ 模型（点击 `onOpenModelPicker`）/ Thinking（支持时展开档位列表并标 `aria-current`；不支持时禁用行显示 `—`）；Esc/点外关闭与 ModelPicker 同行为；**不使用多 token classList**，状态用 `aria-*`。

- [ ] **Step 5: 运行通过 + Commit**

```bash
git add packages/desktop/src/renderer/mafw/session-config-menu-model.ts packages/desktop/src/renderer/mafw/session-config-menu-model.test.ts packages/desktop/src/renderer/mafw/components/pickers/SessionConfigMenu.tsx
git commit -m "feat(desktop): add session config menu model and popover"
```

---

### Task 5: ChatPane composer 收敛 + 接线 + 契约测试

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（ChatPane 调用处 ~L2641-2699）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（工具条/降级档 ~L1493-1521）
- Modify: `packages/desktop/tests/design-contract.test.ts`（~L1013-1033）
- Modify: `packages/desktop/src/renderer/mafw/agent-identity.test.ts`（~L46-54）
- Modify: `packages/desktop/tests/lead-coordinator-wiring.test.ts`（~L27、~L52）
- Test: `packages/desktop/tests/composer-session-menu-wiring.test.ts`（新建钉扎）

**Interfaces:**
- Consumes: Task 4 的 `SessionConfigMenu`/`agentBadge`/`thinkingBadge`/`THINKING_LEVELS`；Task 3 的 thinking 访问器。
- Produces:
  - ChatPane 新 props：`thinkingLevel: () => ThinkingLevel | null`；`thinkingSupported: () => boolean`；`onThinkingSelect: (level: ThinkingLevel) => void`
  - ChatPane 移除 props：`onApplyAgentSwitch`（switch/mention picker 不再由 ChatPane 触发切换）
  - 保留：`agentSel`（发送链绑定）、`primaryAgents`（@ 提及 + Tab 能力门）、`onPlanBuildToggle`（Tab 循环）、`ModelPicker` 整体

**具体删除/新增（按内容锚点定位，行号会漂移）：**
1. 删 `<Show when={planBuildGate()}>…mafw-mode-pill…</Show>`（plan/build pill）；`planBuildGate/planBuildState/cyclePlanBuild/PLAN_BUILD_*` 与 Tab 分支保留。
2. 删 agent pill `<Show when={(props.primaryAgents() || []).length > 0 || isLead()}>…mafw-composer-agent-pill…</Show>` 与 `agentSelName`。
3. 删 `附件` 按钮、`截屏批注` 按钮、`命令` 按钮、`引用 Agent` 按钮、`keyhint` 浮层；`pickerOpen` 联合类型加 `"session-config"`、删 `"agent-switch"`。
4. 新增 `＋` 按钮 + popover（附件 / 截屏批注 / 引用 Agent 三项，复用原 onClick 逻辑）；`＋` 菜单状态 `attachOpen`。
5. `⋯` 更多按钮常显（CSS 去 `display:none`）；菜单项改为：审阅改动 / 语音播报 / 暂停回合；≤520 时追加 附件/截屏批注/引用 Agent（`＋` 隐藏）。
6. `模型 pill` 改会话配置触发器：`class="mafw-model-pill mafw-composer-session-pill"`，内容 = `agentBadge` + `thinkingBadge` 小徽标 + 模型名；点击 `setPickerOpen("session-config")`；`ref` 记录 `trigger` 供 popover 锚定。
7. 渲染 `<SessionConfigMenu …/>`：模型行 → `setPickerOpen("model")`（ModelPicker 继续用 `props.modelGroups/currentKey/onModelSelect`）；Agent 行 → 映射到既有 `onPlanBuildToggle`（'default'/'plan'/'build' 同键——避免新通道）；Thinking 行 → `props.onThinkingSelect`。
8. AgentPicker 用法改 mention-only：删 `mode`、`anchor`、`lockedLead`、`currentName` props（组件本身保留 switch 能力不做删除，仅不再传 switch 模式——减少破坏面）。
9. 占位符改 `输入消息…（/ 命令 · @ 引用）`。
10. 降级档：≤620 隐藏 `.mafw-context-pill`、`.mafw-model-name { max-width: 96px }`；≤520 隐藏 `＋`、`.mafw-model-name { max-width: 72px }`；删除旧 ≤420 档与 agent-pill 档。

**MafwShell 侧：**
- 传 `thinkingLevel={() => activeSessionId() ? (sessionConfigs[activeSessionId()!]?.thinkingLevel ?? null) : null}`、`thinkingSupported`、`onThinkingSelect={(level) => applyThinking(activeSessionId()!, level)}`。
- 删 `onApplyAgentSwitch={applyAgentSwitch}`（函数保留给 Creator/plan 入口）。
- `onPlanBuildToggle` 不动。

- [ ] **Step 1: 失败测试——契约更新（先写新断言）**

```ts
// tests/composer-session-menu-wiring.test.ts
// ChatPane 含 "SessionConfigMenu"、"mafw-composer-session-pill"、"＋"（attach）、"输入消息…（/ 命令 · @ 引用）"
// ChatPane 不含 "mafw-composer-agent-pill"、"切换 Agent"（more menu 项）
// ChatPane 仍含 planBuildGate/isAgentKey(a, "plan") 与 Tab 分支（键盘不砍）
// lead-coordinator: ChatPane 含 "agentLocked={isLead()}"（Agent 行锁定迁移）
```

同步改 `design-contract.test.ts`：more-menu 标签清单改为 `["审阅改动","语音播报"]`（+暂停可选）；分档断言改为 ≤620 `.mafw-context-pill{display:none}`、≤520 `.mafw-composer-attach{display:none}`；`agent-identity.test.ts` 删 `currentName={agentKey(props.agentSel())}` 与 AgentPicker `currentName` 钉扎（保留其余）；`lead-coordinator-wiring.test.ts` 删 `lockedLead={isLead()}` 与锁定过滤测试，改钉 `agentLocked={isLead()}`。

- [ ] **Step 2: 运行确认失败**：`npm test`（packages/desktop）中相关文件 FAIL

- [ ] **Step 3: 实施 ChatPane 删除/新增（按上面 10 条）**

- [ ] **Step 4: CSS 收口**

`mafw.css`：删 `.mafw-composer-agent-pill` 规则；`.mafw-composer-more { display: none }` 删除（常显）；新增 `.mafw-composer-attach` 与 `.mafw-composer-session-badge` 样式（14px 高、accent tint、font-size 10px）；分档按新规则重写。

- [ ] **Step 5: 运行相关测试通过**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/composer-session-menu-wiring.test.ts tests/design-contract.test.ts src/renderer/mafw/agent-identity.test.ts tests/lead-coordinator-wiring.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts packages/desktop/src/renderer/mafw/agent-identity.test.ts packages/desktop/tests/lead-coordinator-wiring.test.ts packages/desktop/tests/composer-session-menu-wiring.test.ts
git commit -m "feat(desktop): converge composer into session config menu"
```

---

### Task 6: Rail 视觉精修（字形重描 + 实心＋ + 间距）

**Files:**
- Modify: `packages/ui/src/components/icon.tsx`（`icons` 表 ~L3；viewBox 逻辑 ~L125）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-icon-rail` ~L3090、`.mafw-icon-rail-icon` ~L3103、`.new-action` ~L3130）
- Modify: `packages/desktop/tests/icon-rail-css.test.ts`

**Interfaces:**
- 字形约束（设计 §3.3'）：`bubble-5` / `magnifying-glass` / `sticky-note` / `team-three` 四枚按 1.2-1.3px 线宽重描；`magnifying-glass` 保持 16×16 viewBox，其余 20×20；保持 `stroke="currentColor"`，端点/连接风格统一。
- CSS：`.mafw-icon-rail { gap: 8px; padding: 10px 0; }`；`.new-action` 去 `border: 1px dashed …`，改实心 tint（`background: color-mix(in srgb, var(--accent) 14%, transparent)`，保留 accent 图标色）。

- [ ] **Step 1: 失败测试——CSS 契约**

```ts
// icon-rail-css.test.ts 更新：
// "轨宽 46px" 不变；新增 gap: 8px / padding: 10px 0 断言
// "顶部新建动作为虚线描边样式" → 反转为：不含 "dashed"，含 accent tint background
// 34px 命中区/box-sizing/激活 1a 填充块/徽标/静音点 全部保留
```

- [ ] **Step 2: 运行确认失败**：`node … --test tests/icon-rail-css.test.ts`

- [ ] **Step 3: 实施 CSS + 字形重描**

字形路径由实施者按上述约束重画（参考同文件内线性图标风格；不引入新 viewBox 尺寸）。重画后跑 `icon-rail-wiring.test.ts` / `icon-rail-pod-wiring.test.ts` 确认 icon 名未变。

- [ ] **Step 4: 运行通过**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/icon-rail-css.test.ts tests/icon-rail-wiring.test.ts tests/icon-rail-pod-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/icon.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/icon-rail-css.test.ts
git commit -m "style(rail): redraw destination glyphs, solid new-action and looser spacing"
```

---

### Task 7: 终审验证

**Files:** 无新增（只跑门禁 + 冒烟）

- [ ] **Step 1: 全量测试**

```bash
cd gateway && npx jest --runInBand --forceExit        # gateway 全量（历史 zeromq 句柄需 forceExit）
cd packages/desktop && npm test                        # desktop 全量（预期 ≥2810 + 本批新增）
cd packages/gateway-sdk && npm test                    # SDK 契约
```

- [ ] **Step 2: 类型/构建门禁**

```bash
cd gateway && npx tsc --noEmit -p tsconfig.json
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```

- [ ] **Step 3: GUI 冒烟（dev app）**

清单：① 会话菜单三态（默认只显示模型名 / plan 徽标 / ⚡thinking 徽标）；② Agent 行 默认/plan/build 切换与 Lead 锁定；③ Thinking 行设置后生效、不支持 runtime 显示禁用态；④ composer 窄窗两档（620/520）不溢出、发送恒显、≤520 附件/截屏/引用经 ⋯ 可达；⑤ rail 视觉对照截图（旧/新）；⑥ switchAgent 403（手动 curl 非 coordination 会话切 lead / coordination 切离 lead）。

- [ ] **Step 4: 更新 AGENTS.md 批次记录 + Commit**

记录：本批提交范围、测试计数（新增数 + 全量通过数）、spec/plan 路径、已知边界（attention 通知链移交 pod-event-layer 批次）。
