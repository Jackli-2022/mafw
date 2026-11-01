# Runtime Isolation & Experience Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 gateway 进程内建立强制 Runtime Ingress/Facade，并让 checkpoint、steer、background、MCP 四个场景改投版本化 Experience Contract，切断原生事件与前端 runtime 特判。

**Architecture:** RawRuntime 只存在于 adapter 与 Runtime Ingress；组合根负责翻译、归一和包装，业务核心只接收 RuntimeFacade/RuntimeAccess。ExperienceProjector 将原生能力与 MAFW fallback 后的语义投影为 Action Descriptor，desktop 通过 SDK/preload 消费，不再读取裸 capabilities。

**Tech Stack:** TypeScript、Node.js、Jest（gateway）、bun:test/node --test（desktop/SDK）、SolidJS、现有 runtime event mapper、OpenAPI/JSON contract emitters。

**Spec:** `docs/superpowers/specs/2026-11-02-runtime-isolation-experience-contract-design.md`

## Global Constraints

- 插件继续运行在 gateway 进程内；不创建 Runtime Host 进程，不做多 runtime 并存。
- RawRuntime、原生事件、runtime SDK 类型不得越过 Runtime Ingress；未匹配/非法事件 fail-closed。
- 翻译执行器由 gateway 提供；本地受信插件的过程式翻译只在 Ingress/quarantine 执行。
- dsh 不在本批实现；它只是后续普通 adapter，不获得任何专用分支。
- 本批不做 session-ui 全量类型中立化，不做 TUI/SDK 全量 Experience 迁移；只迁移首批场景必需的 SDK 类型。
- 前端业务组件不得通过 `runtimeName`、`active.name`、裸 runtime capabilities 决定行为；Diagnostics/Admin 页面保留显式例外。
- 原生优先、可靠 fallback、显式降级；不得为了体验一致伪造能力语义。
- 现有 desktop/TUI/SDK 至少保留一个迁移周期；opencode/pi/claude 现役插件不得回归。
- 全程 TDD：每个行为先写失败测试，再实现；每任务独立提交到 main，沿用仓库现有约定。
- PowerShell 下不得用整文件正则重写含中文源码；使用精确 edit，避免编码损坏。

## Review Focus

1. 未匹配事件、翻译异常和重订阅叠加包装：任何情况下原生事件都不得绕过 facade，且重订阅不得双发。→ Task 1 的入口与 rewire 测试。
2. 历史归一失败或返回混合形状：facade 不得把原生历史 fail-open 给核心。→ Task 2 的 strict-history 测试。
3. 同一动作在不同 runtime 下语义不同：steer 边界、revert 文件/undo 必须由 adapter 语义声明表达，不得靠名称判断。→ Task 3/5/6 的语义测试。
4. 动态 checkpoint 在 busy、无文件状态、不可逆 patch 下：按钮必须显式降级且原因稳定，不能出现可点击后失败。→ Task 5 的逐 checkpoint 动作测试。
5. runtime 热切换与旧 client：Experience 缓存必须失效，旧 SDK 仍兼容；加载中不能被当成不支持。→ Task 4 的 store/version 测试与 Task 9 的全量回归。

---

### Task 1: Runtime Ingress 与 Canonical RuntimeFacade

**Files:**
- Create: `gateway/src/runtime/runtime-facade.ts`
- Modify: `gateway/src/index.ts:1310-1362,1684-1797,1880-1898`
- Test: `gateway/tests/unit/runtime/runtime-facade.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const RUNTIME_FACADE: unique symbol
  export interface RuntimeFacade extends AgentRuntime {
    readonly [RUNTIME_FACADE]: true
    rewireEvents(): Promise<string>
  }
  export async function createRuntimeFacade(
    raw: AgentRuntime,
    opts: {
      entry: EventMappingEntry
      isCanonical: (type: string) => boolean
      hooks?: TranslationHooks & { onNoMappings?: () => void }
    },
  ): Promise<RuntimeFacade>
  ```
- `RuntimeFacade` 不暴露 `__mafwRawGlobalEvent`、`__mafwEventWiring`、`__mafwActiveEntry`、`resolveEventEntry` 或 RawRuntime 原型。
- Consumes: 现有 `wrapDialectEventStream`、`wrapRuntimeIdentity`。

- [ ] **Step 1: 写失败测试**

覆盖：原生 `mystery` 被 drop；合法 `turn.completed` 到达 facade；facade 无 raw wiring 字段/原型；`rewireEvents()` 后同一事件不双发。

```ts
expect(seen.map((e) => e.payload.type)).toEqual(['turn.completed'])
expect((facade as any).__mafwRawGlobalEvent).toBeUndefined()
expect((facade as any).resolveEventEntry).toBeUndefined()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-facade.test.ts`
Expected: FAIL，`createRuntimeFacade` 不存在。

- [ ] **Step 3: 实现 facade 与组合根接线**

`createRuntimeFacade` 先在闭包内对 RawRuntime 调用 `wrapDialectEventStream`，再仅复制/绑定契约公开面。`rewireEvents()` 在闭包内重接线，不向调用者暴露 RawRuntime。激活与 direct fallback 都在 `wrapRuntimeIdentity` 后返回 facade；`this.runtime` 改为 `RuntimeFacade | null`，订阅改调 `rewireEvents()`，不再读取 `__mafwRawGlobalEvent`。

- [ ] **Step 4: 运行目标与现役 runtime 测试**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-facade.test.ts tests/unit/runtime/event-stream-wiring.test.ts tests/unit/runtime/claude-adapter-acceptance.test.ts`
Expected: 全部 PASS；未翻译事件到核心/广播均为 0。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/runtime-facade.ts gateway/src/index.ts gateway/tests/unit/runtime/runtime-facade.test.ts
git commit -m "feat(runtime): isolate raw runtimes behind canonical facade"
```

### Task 2: Facade 历史出口 Fail-Closed

**Files:**
- Modify: `gateway/src/runtime/runtime-facade.ts`
- Modify: `gateway/src/runtime/normalize-messages.ts`
- Test: `gateway/tests/unit/runtime/runtime-facade-history.test.ts`
- Test: `gateway/tests/unit/runtime/normalize-messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeFacadeHistory(
    runtime: AgentRuntime,
    rawData: unknown,
    onViolation?: (reason: string) => void,
  ): MafwMessage[]
  ```
- facade 的 `session.messages()` 始终返回 `{ data: MafwMessage[], nextCursor? }`；不合法成员被丢弃并记录，不返回原生成员。
- 既有 `applyNormalizeMessages` 的 legacy 行为保留给兼容 shim，不直接供 facade 使用。

- [ ] **Step 1: 写失败测试**

覆盖：flat 原样通过；旧 `{info,parts}` 二次翻译通过；混合数组只保留合法项；非数组、翻译抛错、全部非法均返回 `[]` 且调用 `onViolation`，绝不回退 raw。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-facade-history.test.ts`
Expected: FAIL，当前 facade 没有 strict-history。

- [ ] **Step 3: 实现 strict-history 并接入 facade**

复用现有声明式 `normalizeMessages` 与 legacy second-chance，但 facade 专用出口只过滤 `isMafwMessage` 项。不得复用当前“失败回退 rawData”的分支。

- [ ] **Step 4: 运行目标与历史回归**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-facade-history.test.ts tests/unit/runtime/normalize-messages.test.ts tests/unit/runtime/pi-message-normalize.test.ts`
Expected: PASS；旧兼容路径测试不因 shim 保留而变化。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/runtime-facade.ts gateway/src/runtime/normalize-messages.ts gateway/tests/unit/runtime/runtime-facade-history.test.ts gateway/tests/unit/runtime/normalize-messages.test.ts
git commit -m "feat(runtime): make facade history normalization fail closed"
```

### Task 3: RuntimeAccess 统一 Surface 与语义门

**Files:**
- Create: `gateway/src/runtime/runtime-access.ts`
- Modify: `gateway/src/runtime/contract.ts`（`AgentRuntime.semantics?`）
- Modify: `gateway/src/runtime/runtime-facade.ts`（暴露 `access`）
- Modify: `gateway/src/runtime/contract-manifest-types.ts`（surface 语义元数据）
- Modify: `gateway/src/runtime/contract-surfaces-core.ts`（steer/revert 语义键）
- Modify: `gateway/src/index.ts`（`capGuard` 与 facade access）
- Modify: `gateway/src/routes/mcp.ts`
- Modify: `gateway/src/routes/mcp-config.ts`
- Modify: `gateway/src/routes/session-branch.ts`
- Modify: `gateway/src/routes/session-checkpoints.ts`
- Modify: `gateway/src/routes/session-run.ts`
- Test: `gateway/tests/unit/runtime/runtime-access.test.ts`
- Test: `gateway/tests/unit/runtime/runtime-access-routes.test.ts`
- Generated: `packages/gateway-sdk/contract/runtime-contract.json`（由 emit 更新，不手改）

**Interfaces:**
- Produces:
  ```ts
  export class RuntimeAccess {
    constructor(rt: AgentRuntime, manifest?: RuntimeContractManifest)
    can(surfaceId: string): boolean
    requireSurface(surfaceId: string): void
    semantics<T = Record<string, unknown>>(surfaceId: string): T
  }
  export class RuntimeSurfaceError extends Error {
    code: 'runtime.surface.unavailable'
    surface: string
  }
  export interface AgentRuntime { readonly semantics?: Record<string, Record<string, unknown>> }
  export interface RuntimeFacade extends AgentRuntime {
    readonly access: RuntimeAccess
  }
  ```
- `can`：gated capability 关闭即 false；presence surface 必须通过 `probePasses`；非 presence surface 以激活后的 effective capability 为准。
- 错误消息包含 surface，不包含 runtime 名称。

- [ ] **Step 1: 写失败测试**

覆盖：capability=false；声明 true 但 probe 方法缺失；presence 通过；attested/conformance 以 effective cap 为准；未知 surface 抛错；`requireSurface` 的中性错误；adapter semantics 合并读取。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-access.test.ts tests/unit/runtime/runtime-access-routes.test.ts`
Expected: FAIL，`RuntimeAccess` 不存在。

- [ ] **Step 3: 实现并替换首批能力门**

facade 暴露 `access: RuntimeAccess`。`capGuard`、MCP、branch、checkpoint、run 路由改走 `can/requireSurface`，不再各自解释 `supported` 或 capability 布尔值。路由仍返回原有 HTTP 状态，避免 client 破坏。surface 元数据补充 `prompt.delivery.steer.boundary = after-turn|tool|unspecified`、`branch.revert.files/undo`、`mcp.manage.authCommandTemplate` 的键与允许值，并运行 `npm run emit:runtime-contract` 更新 Driver JSON。

- [ ] **Step 4: 运行目标与相关路由回归**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-access*.test.ts tests/unit/routes/session-checkpoints.test.ts tests/unit/routes/session-run.test.ts tests/unit/mcp-route.test.ts tests/unit/mcp-config-route.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/runtime-access.ts gateway/src/runtime/contract.ts gateway/src/runtime/runtime-facade.ts gateway/src/runtime/contract-manifest-types.ts gateway/src/runtime/contract-surfaces-core.ts gateway/src/index.ts gateway/src/routes gateway/tests/unit/runtime packages/gateway-sdk/contract/runtime-contract.json
git commit -m "feat(runtime): centralize surface access and semantics"
```

### Task 4: Experience Contract、Projector、SDK 与前端 Store

**Files:**
- Create: `gateway/src/experience/experience-contract.ts`
- Create: `gateway/src/experience/experience-projector.ts`
- Create: `gateway/src/routes/experience-actions.ts`
- Create: `gateway/scripts/emit-experience-contract.ts`
- Create: `packages/gateway-sdk/src/experience-contract.ts`
- Create: `packages/gateway-sdk/contract/experience-contract.json`（生成，不手改）
- Create: `packages/desktop/src/renderer/mafw/experience-store.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/wave1-handlers.ts`
- Modify: `gateway/package.json`（登记 `emit:experience-contract`）
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Test: `gateway/tests/unit/experience/experience-contract.test.ts`
- Test: `gateway/tests/unit/experience/experience-actions-route.test.ts`
- Test: `packages/gateway-sdk/src/experience.test.ts`
- Test: `packages/desktop/src/renderer/mafw/experience-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EXPERIENCE_VERSION = '2026.11.0'
  export type ExperienceActionId =
    | 'checkpoint.restore' | 'prompt.steer' | 'session.background'
    | 'mcp.manage' | 'mcp.config.write'
  export type ActionUnavailableReason =
    | 'unsupported' | 'busy' | 'missing-data' | 'non-invertible-patch' | 'unsafe'
  export interface ActionDescriptor {
    enabled: boolean
    reason?: ActionUnavailableReason
    warningKey?: string
    semantics?: Record<string, unknown>
  }
  export function projectExperienceActions(
    access: RuntimeAccess,
    ctx: { sessionID?: string; busy?: boolean },
  ): Record<ExperienceActionId, ActionDescriptor>
  ```
- HTTP：`GET /api/experience/actions?sessionID=<id>` → `{ experienceVersion, sessionID?, actions }`。
- SDK/preload：`experience.actions(sessionID?)`；store 区分 `loading/ready/error`，runtime_switched/SSE 重连必须失效。

- [ ] **Step 1: 写失败测试**

契约测试固定五个 action id、version、reason 枚举和 JSON 导出；route 返回全部动作；SDK 路径正确；store 测试 loading 不等于 unsupported、切换后重拉、旧响应不能覆盖新 runtime；旧 gateway 返回 404 时进入明确的 `unavailable` 兼容态，首批组件使用各自的中性安全降级而不崩溃。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/experience`
Run: `npm test -w @mafw/sdk -- --test-name-pattern=experience`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=experience-store`
Expected: FAIL，Experience 模块尚不存在。

- [ ] **Step 3: 实现契约、projector、route、SDK 与 store**

首批 projector 对未实现切片返回 `enabled:false, reason:'unsupported'`，后续任务逐一切换为真实语义。route-catalog 登记后运行 `npm run emit:openapi`；Experience JSON 由 `emit-experience-contract.ts` 生成，禁止手改生成物。

- [ ] **Step 4: 运行目标测试与类型检查**

Run: `cd gateway && npx jest --runInBand tests/unit/experience && npx tsc --noEmit -p tsconfig.json`
Run: `npm test -w @mafw/sdk && npm run build -w @mafw/sdk`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=experience`
Expected: PASS；JSON 新鲜度测试通过。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/experience gateway/src/routes gateway/scripts/emit-experience-contract.ts packages/gateway-sdk packages/desktop/src/preload packages/desktop/src/renderer/mafw/experience-store*
git commit -m "feat(experience): add versioned action contract and client store"
```

### Task 5: Checkpoint 改投 Experience Action Descriptor

**Files:**
- Create: `gateway/src/core/checkpoint/checkpoint-actions.ts`
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `gateway/src/routes/session-checkpoints.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Create: `packages/desktop/src/renderer/mafw/components/experience-copy.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `gateway/tests/unit/checkpoint/checkpoint-actions.test.ts`
- Test: `gateway/tests/unit/routes/session-checkpoints.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/experience-copy.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function projectCheckpointActions(
    checkpoint: CheckpointActionInput,
    ctx: { access: RuntimeAccess; busy: boolean; targets: CheckpointActionInput[] },
  ): {
    restoreConversation: ActionDescriptor
    restoreFiles: ActionDescriptor
    restoreBoth: ActionDescriptor
  }
  export interface CheckpointActionInput {
    id: string
    anchorMessageID?: string
    messageID?: string
    snapshotTree?: string | null
    filesKnown?: boolean
    files?: Array<{ patch?: string }>
  }
  ```
- `SessionCheckpoint.actions?` 为 additive 字段；旧 gateway 无该字段时 frontend 使用中性只读降级，不再用 runtimeName 推导。
- 稳定 warningKey：`restore-conversation-only-no-undo`、`restore-conversation-files-no-undo`、`restore-conversation-files-undoable`。

- [ ] **Step 1: 写失败测试**

覆盖：busy；无 snapshotTree/filesKnown；全部 patch 可逆；新增/删除文件或 0 hunk 的不可逆 patch；conversation-only/files/both；undo 语义；列表响应携带 actions；前端 warningKey→i18n，无 runtimeName。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/checkpoint/checkpoint-actions.test.ts tests/unit/routes/session-checkpoints.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern="checkpoint|experience-copy"`
Expected: FAIL，当前由前端 runtimeName/caps 推导。

- [ ] **Step 3: 实现后端动作投影并迁移前端**

把 `canRewindCode/isInvertiblePatch` 所需判断移入 gateway 纯函数。checkpoint list 返回 additive `actions`。overlay 只读动作状态与 warningKey；`revertWarning` 改为 warningKey 映射或删除，保留通用兼容降级。

- [ ] **Step 4: 运行目标与 desktop 回归**

Run: `cd gateway && npx jest --runInBand tests/unit/checkpoint tests/unit/routes/session-checkpoints.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern="checkpoint|experience-copy"`
Expected: PASS；不存在 `revertWarning(runtimeName, ...)` 调用。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/checkpoint gateway/src/experience gateway/src/routes/session-checkpoints.ts gateway/tests/unit/checkpoint gateway/tests/unit/routes/session-checkpoints.test.ts packages/gateway-sdk/src/types.ts packages/desktop/src/renderer/mafw/components
git commit -m "feat(experience): project checkpoint restore actions"
```

### Task 6: Steer 语义进入 Experience Contract

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（若 Task 3 已加 semantics 则仅使用）
- Modify: `gateway/src/runtime/opencode-runtime.ts`
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `gateway/tests/unit/experience/steer-actions.test.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`

**Interfaces:**
- Adapter semantics：
  ```ts
  'prompt.delivery.steer': { boundary: 'after-turn' | 'tool' }
  ```
- Experience：`actions['prompt.steer'] = { enabled, semantics: { boundary, queue: true } }`。
- `decideBusyDelivery` 改收 `steer: { enabled: boolean }`，不再收 `steerApi` 或 runtimeName。

- [ ] **Step 1: 写失败测试**

opencode 投影 `after-turn`、pi 投影 `tool`；未声明时为 `unspecified`，不得编造边界。前端 enabled 才走 steer；禁用走 local queue；媒体仍走 local queue；提示只按 boundary 生成。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/experience/steer-actions.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=use-send-message`
Expected: FAIL，当前为 `steerApi` 布尔值与 runtime 注释。

- [ ] **Step 3: 声明 adapter 语义并迁移前端**

只在 adapter 填 semantics；projector 不识别 runtime 名称。ChatPane/MafwShell 改传 Experience action，移除该场景的 `runtimeCaps.steerApi` 消费。

- [ ] **Step 4: 运行目标与发送链路回归**

Run: `cd gateway && npx jest --runInBand tests/unit/experience/steer-actions.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern="use-send-message|experience"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime gateway/src/experience gateway/tests/unit/experience/steer-actions.test.ts packages/desktop/src/renderer/mafw/chat packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(experience): describe steer delivery semantics"
```

### Task 7: Background 动词中性化并接入 Experience

**Files:**
- Create: `gateway/src/routes/session-background.ts`
- Modify: `gateway/src/runtime/contract.ts`（`session.background?`）
- Modify: `gateway/src/runtime/contract-surfaces-core.ts`（`session.background` presence surface）
- Modify: `gateway/src/runtime/opencode-adapter.ts`
- Modify: `gateway/src/index.ts`（中性路由先于 legacy proxy）
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `packages/desktop/src/renderer/mafw/background-capability.ts`
- Test: `gateway/tests/unit/runtime/session-background.test.ts`
- Test: `gateway/tests/unit/experience/background-actions.test.ts`
- Test: `packages/desktop/src/renderer/mafw/background-capability.test.ts`

**Interfaces:**
- Driver：`session.background?(opts: { sessionID: string }): Promise<void>`。
- Experience：`actions['session.background'] = { enabled, reason?: 'unsupported' }`。
- 保持现有 `POST /api/session/:id/background` URL 与 SDK 调用不变。

- [ ] **Step 1: 写失败测试**

opencode adapter 调用原生 background；无该方法时中性 503，错误不含 runtime 名；Experience 仅按 surface presence 判可用；frontend probe 不再读取 `active.name`，loading 不冒充 unavailable。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/session-background.test.ts tests/unit/experience/background-actions.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=background-capability`
Expected: FAIL，当前依赖 runtime 名和透传代理。

- [ ] **Step 3: 实现中性动词与 action probe**

中性路由先于 legacy proxy 处理同 URL；pi 等无实现自然 503。`createRuntimeProbe` 改为 `createActionProbe(() => experience.actions())`，REST shells probe 保持不变。新增 surface 后运行 `npm run emit:runtime-contract` 更新 Driver JSON。

- [ ] **Step 4: 运行目标与 background 回归**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/session-background.test.ts tests/unit/experience/background-actions.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern="background|experience"`
Run: `npm test -w @mafw/sdk -- --test-name-pattern=background`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/session-background.ts gateway/src/runtime gateway/src/index.ts gateway/src/experience gateway/tests/unit/runtime/session-background.test.ts gateway/tests/unit/experience/background-actions.test.ts packages/desktop/src/renderer/mafw/background-capability* packages/gateway-sdk/contract/runtime-contract.json
git commit -m "feat(experience): neutralize session background capability"
```

### Task 8: MCP 管理动作与认证提示去 Runtime 特判

**Files:**
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `gateway/src/runtime/opencode-runtime.ts`（补充 `mcp.manage` semantics）
- Create: `packages/desktop/src/renderer/mafw/pages/mcp-experience.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Test: `gateway/tests/unit/experience/mcp-actions.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pages/mcp-experience.test.ts`

**Interfaces:**
- `mcp.manage` 由 `mcp.list/connect/disconnect` 全部可用决定。
- `mcp.config.write` 由 `mcp.config.preview/apply/remove/restore` 全部可用决定。
- 可选 semantics：`authCommandTemplate?: string`，如 adapter 返回 `opencode mcp auth {name}`；Experience 只传模板，前端不硬编码 runtime 命令。

- [ ] **Step 1: 写失败测试**

覆盖：list 缺 connect 时 manage=false；config 四个面齐全才 write=true；auth 模板 `{name}` 被替换；无模板时不显示认证命令；Config 不再以 `runtimeCaps.mcpApi/mcpConfigApi` 判断。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/experience/mcp-actions.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=mcp-experience`
Expected: FAIL。

- [ ] **Step 3: 实现 MCP 投影与 Config 迁移**

Config 的 MCP 卡只读 Experience actions；插件中心/Runtime 诊断卡继续走 Diagnostics/Admin Contract，不受影响。OAuth 命令来自 adapter 可选语义，无模板则隐藏，不写 opencode 名称分支。

- [ ] **Step 4: 运行目标与 MCP/Config 回归**

Run: `cd gateway && npx jest --runInBand tests/unit/experience/mcp-actions.test.ts tests/unit/mcp-route.test.ts tests/unit/mcp-config-route.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern="mcp|experience"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/experience gateway/src/runtime/opencode-runtime.ts gateway/tests/unit/experience/mcp-actions.test.ts packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/renderer/mafw/pages/mcp-experience*
git commit -m "feat(experience): project MCP management actions"
```

### Task 9: 架构禁令、文档与全量验收

**Files:**
- Create: `gateway/tests/unit/runtime/architecture-boundaries.test.ts`
- Create: `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts`
- Modify: `docs/guides/runtime-plugin-authoring.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-11-02-runtime-isolation-experience-contract-design.md`（仅记录实现偏差，如有）

**Interfaces:**
- gateway 禁令覆盖首批业务 routes/core：无 RawRuntime、具体 runtime SDK import、runtime 名称分支。
- desktop 禁令覆盖首批四个场景：无 `runtimeName`、`active.name`、裸 `runtimeCaps` 和 runtime SDK import。
- composition root 与 Diagnostics/Admin 白名单必须显式列出，不能全局豁免。

- [ ] **Step 1: 先写会捕获旁路的架构测试**

加入一个人工 raw bypass fixture 和一个 runtimeName 前端 fixture，证明扫描会失败；再对当前树运行，列出所有需清理点并修到绿。禁止只断言 helper 存在。

- [ ] **Step 2: 运行架构测试确认其有效性**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/architecture-boundaries.test.ts`
Run: `npm test -w @mafw/desktop -- --test-name-pattern=experience-boundaries`
Expected: fixture 触发 FAIL；清理后生产代码 PASS。

- [ ] **Step 3: 更新文档**

记录 Runtime Ingress/Facade、Driver vs Experience、Diagnostics/Admin 例外、四个已迁移场景、后续 dsh/session-ui/TUI/SDK 工作；AGENTS 写实际新增测试数与全量通过数。

- [ ] **Step 4: 全量门禁**

Run: `cd gateway && npx jest --runInBand --forceExit && npx tsc --noEmit -p tsconfig.json && npm run build`
Run: `npm test -w @mafw/sdk && npm run build -w @mafw/sdk`
Run: `npm run test:desktop && npm run test:kit`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Run: `cd adapters/claude && npm test && npm run build`
Expected: 全绿；另外运行四个 Experience 场景的契约 golden，确认 runtime 切换后动作缓存失效。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/runtime/architecture-boundaries.test.ts packages/desktop/src/renderer/mafw/experience-boundaries.test.ts docs/guides/runtime-plugin-authoring.md AGENTS.md docs/superpowers/specs/2026-11-02-runtime-isolation-experience-contract-design.md
git commit -m "test: enforce runtime isolation and experience boundaries"
```
