# Kernel v2 Phase 0/1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `gateway/src/kernel-v2/` 的并行内核骨架，完成 manifest/plane/diagnostics/version 契约，port S1 registry，并把 TTS/usage 以只读 shadow 方式接到独立 v2 进程；v1 行为零变化。

**Architecture:** 路线 B 的第一段。Phase 0/1 只做进程内 `kernel-v2` 模块 + 独立 v2 入口/端口/数据副本；不接 live gateway，不碰 `~/.mafw`。shadow compare 只覆盖只读面（health / tts voices / usage），writes 留到后续 phase。

**Tech Stack:** TypeScript / Node、Jest（gateway）、`@mafw/plugin-contract`、现有 `TtsEngine` / `ExternalAdapter` 类型、`http` 内置模块。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

## Progress（2026-11-12）

- Phase 0 完成：Task 0.1–0.6。
- Phase 1 完成：Task 1.1–1.6。
- 定向门禁：kernel-v2 + architecture + shadow **72 tests / 72 pass**；plugin-contract **38 / 38**。
- gateway 全量：**6693 / 6693**，连续两次 clean（Phase 1 收尾）。
- typecheck：`npx tsc --noEmit -p tsconfig.json` 通过。
- 已知既存 flake：Phase 0 全量 run 2 出现过一次 `instance-ownership` 时序失败（`takeover waits for the old owner to release`），单文件重跑通过；后续 run 3/4 连续 clean。未归因于 kernel-v2。
- 交付记录：`docs/releases/2026-11-12-capability-kernel-phase1.md`。

## Global Constraints

- Phase 0/1 不修改 v1 `gateway/src/kernel.ts`、`boot.ts`、`http/transport.ts`、`tts/registry.ts`、`usage/plugin-loader.ts`。
- 所有 v2 代码在 `gateway/src/kernel-v2/`；v2 不 import v1 组合根或单例，只 import 契约/纯类型。
- 不引入 Cordis、不换 Solid/Electron/SQLite/Monaco。
- 所有生产代码先写失败测试；每个 task 结束提交。
- 所有 provider 有 load/validate/resolve/activate/drain/dispose、health、diagnostics、last-known-good。
- 不接 live gateway；独立 v2 入口必须使用 `MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`，缺失则拒绝启动。
- 不写 live `~/.mafw`；writes 不在 Phase 1。
- 全量门禁：每个 phase gate 前在 canonical build 上连续 2 次 clean full-suite。
- 任何实现与 spec 冲突时，以 spec 为准并先改 spec。

## Review Focus

- **坏 provider 不拖垮 boot**：load/activate 抛错/超时 → safe mode/degraded，不阻塞事件循环。
- **scope 不泄漏**：session → project → global 解析；其他 project/session 不可见；tie-break 确定。
- **替换不改变语义**：v2 TTS/usage 只读输出与 v1 golden 一致；不改 v1 HTTP/DTO。
- **dispose 完整**：timer/listener/PTY/watcher/subprocess 在 stop/替换时释放；LIFO、失败隔离。
- **shadow 不碰 live 数据**：v2 只读副本；缺失 env 拒绝启动；rollback = 停 v2。
- **契约 additive**：现有 `validateClientDescriptor` 行为不变；新 plane 校验不破坏已安装包。

---

## Task 0.1：冻结核心不变量与 conformance inventory

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`（已修订；本 task 只做评审签核）
- Modify: `docs/architecture/gateway.md`、`docs/architecture/desktop.md`（加 kernel-v2 指针，不改行为）
- Create: `docs/research/2026-11-12-kernel-v2-invariant-map.md`

**Interfaces:**
- Consumes: spec §0/§2.1/§3/§4.8。
- Produces: invariant → 现有测试/守卫/conformance kit 的映射表。

- [ ] 在 `docs/research/2026-11-12-kernel-v2-invariant-map.md` 建表：不变量、现有测试/守卫、缺口、owner。
- [ ] 覆盖 runtime 四条、memory 四条、Goal/Pod 三条、webview apiToken、desktop preload/sandbox。
- [ ] 在 `docs/architecture/gateway.md` 加一句 kernel-v2 当前状态（不接 live，Phase 0/1 只读 shadow）。
- [ ] 在 spec 末尾加评审签核：日期、participants、未决项（应为空或列出）。
- [ ] Commit：`docs: freeze kernel-v2 invariants and conformance inventory`

**Gate**：每个核心不变量有 owner、现有守卫或补测任务；无代码行为变化。

---

## Task 0.2：Manifest 纯校验 + 架构守卫

**Files:**
- Create: `gateway/src/kernel-v2/manifest.ts`
- Create: `gateway/tests/unit/kernel-v2/manifest.test.ts`
- Create: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`

**Interfaces:**
- Produces:
```ts
export type CapabilityPlane = "gateway" | "desktop-ui" | "desktop-web" | "desktop-main"
export type ProviderKind = "core" | "trusted" | "untrusted"
export type ProviderActivation = "startup" | "lazy" | "on-demand"

export interface CapabilityProviderRef {
  capability: string
  version: number
}

export interface CapabilityIntegrity {
  algorithm: "sha256"
  files: Record<string, string>
}

export interface CapabilityManifest {
  id: string
  version: string
  apiVersion: number
  kind: ProviderKind
  provides: CapabilityProviderRef[]
  requires?: string[]
  wants?: string[]
  activation?: ProviderActivation
  permissions?: string[]
  configSchema?: unknown
  integrity?: CapabilityIntegrity
  planes?: CapabilityPlane[]
}

export interface ManifestValidationOptions {
  firstPartyAllowlist?: ReadonlySet<string>
}

export type ManifestValidation =
  | { ok: true; value: CapabilityManifest }
  | { ok: false; errors: string[] }

export function validateCapabilityManifest(
  input: unknown,
  options?: ManifestValidationOptions,
): ManifestValidation
```
- Consumes: spec §4.1。

- [ ] **Write failing test** `manifest.test.ts`:
  - accepts a minimal gateway provider manifest
  - rejects invalid id / version / apiVersion
  - rejects unknown kind / activation / plane
  - `core` requires first-party allowlist
  - `untrusted` shape is accepted (runtime rejects later)
  - validates `provides` / `requires` / `wants`
  - validates `integrity` shape
  - rejects unknown fields
  - rejects duplicate `provides.capability`
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/manifest.test.ts`
  - Expected: FAIL `Cannot find module '../../../src/kernel-v2/manifest'`.
- [ ] **Implement** `manifest.ts` with pure validation; no registration/activation/boot wiring.
  - id pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$`; version non-empty ≤64; apiVersion positive integer.
  - `kind === "core"` requires `options.firstPartyAllowlist?.has(id)`.
  - unknown top-level keys rejected.
- [ ] **Run** same command; Expected: PASS.
- [ ] **Write failing boundary test** `kernel-v2-boundaries.test.ts`:
  - scans all `.ts` under `gateway/src/kernel-v2` (excluding tests)
  - forbids imports: `../kernel`, `../boot`, `../http/transport`, `../tts/registry`, `../usage/plugin-loader`, `../plugins/package-host`
  - allows: `../tts/types`, `../usage/types`, `@mafw/runtime-contract`, `@mafw/plugin-contract`
  - asserts `gateway/src/kernel.ts` and `gateway/src/boot.ts` do not import `./kernel-v2`
- [ ] **Run** `npx jest --runInBand tests/unit/architecture/kernel-v2-boundaries.test.ts`
  - Expected: FAIL until the guard is written; then PASS.
- [ ] Commit：`feat(kernel-v2): add manifest validation and boundary guards`

**Gate G0.2**：manifest 校验通过；守卫可运行；零运行时行为变化。

---

## Task 0.3：路线 B 隔离与 cutover runbook

**Files:**
- Create: `docs/guides/kernel-v2-cutover.md`
- Modify: spec §6（已写；本 task 只把 runbook 落成 ops 文档）

**Interfaces:**
- Consumes: spec §6.1–§6.5。
- Produces: 可执行的 v2 启动/数据副本/shadow/rollback 清单。

- [ ] 写 runbook 章节：
  - 拓扑：Phase 0/1 进程内模块；Phase 1.5 独立 `MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`。
  - 数据副本：复制 `~/.mafw` → temp dir；v2 只读写副本；writes 不在 Phase 1。
  - shadow 对象：HTTP normalized JSON、TTS byte compare、events golden sequence、usage record/replay。
  - cutover：fixes-only → session drain → snapshot → schema forward/backward → shadow → ingress switch → rollback。
  - v1 退役：所有 routes/subsystems 由 v2 服务；rollback drill 通过；v1 只读 N 天。
- [ ] 在 runbook 加“禁止事项”：flag-day、live 数据双写、未 shadow 就 cutover。
- [ ] Commit：`docs: add kernel-v2 cutover runbook`

**Gate G0.3**：runbook 覆盖拓扑、shadow、cutover、rollback、v1 退役；不碰现役数据。

---

## Task 0.4：Plugin plane 契约（additive）

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`
- Modify: `packages/plugin-contract/src/validate.ts`
- Modify: `packages/plugin-contract/src/validate.test.ts`
- Verify: `packages/plugin-contract/src/index.ts`（无新文件则无需改）

**Interfaces:**
- Produces:
```ts
export type PluginPlane = "gateway" | "desktop-ui" | "desktop-web" | "desktop-main"

export interface PluginGatewayContributes {
  actions?: string[]
  events?: string[]
  http?: boolean
}

export interface PluginDesktopUiContributes {
  panels?: unknown[]
  toolCards?: unknown[]
  configPages?: unknown[]
  messageWindows?: unknown[]
}

export interface PluginDesktopWebContributes {
  webSurfaces?: unknown[]
}

export interface PluginDesktopMainContributes {
  legacy?: true
}

export interface PluginManifestContributes {
  gateway?: PluginGatewayContributes
  desktop?: {
    ui?: PluginDesktopUiContributes
    web?: PluginDesktopWebContributes
    main?: PluginDesktopMainContributes
  }
}

export function validatePluginManifestContributes(
  value: unknown,
): { ok: true; value: PluginManifestContributes } | { ok: false; error: string }
```
- **Phase 0 does not add `menuItems`/`composerActions` to the client descriptor.** Those are Phase 4 additive slots; Phase 0 only freezes the plane container and existing slots.
- Consumes: spec §4.6。

- [ ] **Write failing tests** in `validate.test.ts`:
  - accepts `{ gateway: { actions: ["a"], events: ["plugin:p:e"], http: true } }`
  - accepts `{ desktop: { ui: { panels: [] }, web: { webSurfaces: [] } } }`
  - accepts desktop-only and gateway-only
  - rejects unknown top-level key
  - rejects unknown `desktop` key
  - rejects non-object `desktop.ui`
  - rejects `desktop.main` without `legacy: true`
  - existing `validateClientDescriptor` fixture still passes unchanged
- [ ] **Run** `npm run test:plugin-contract`
  - Expected: FAIL with missing `validatePluginManifestContributes`.
- [ ] **Implement** types + pure shape validator; deep slot validation stays in `validateClientDescriptor`/Phase 4.
- [ ] **Run** `npm run test:plugin-contract`; Expected: PASS.
- [ ] **Run** `npx tsc --noEmit -p tsconfig.json` in `packages/plugin-contract`; Expected: PASS.
- [ ] Commit：`feat(plugin-contract): add gateway and desktop plane declarations`

**Gate G0.4**：plane 容器可校验；现有 client descriptor 不变；零 loader 行为变化。

---

## Task 0.5：Port S1 spike 到 kernel-v2

**Files:**
- Create: `gateway/src/kernel-v2/capability-registry.ts`
- Create: `gateway/tests/unit/kernel-v2/capability-registry.test.ts`
- Create: `gateway/src/kernel-v2/providers/tts-registry.ts`
- Create: `gateway/tests/unit/kernel-v2/tts-registry-capability.test.ts`

**Interfaces:**
- Consumes: `spike/capability-registry-tts` @ `5a248271`。
- Produces: ported `CapabilityRegistry<T>` + `TtsEngineRegistry` adapter in kernel-v2.

- [ ] 取文件（只读源，不覆盖 v1）：
```bash
git show 5a248271:gateway/src/core/capability-registry.ts > gateway/src/kernel-v2/capability-registry.ts
git show 5a248271:gateway/tests/unit/core/capability-registry.test.ts > gateway/tests/unit/kernel-v2/capability-registry.test.ts
git show 5a248271:gateway/src/tts/registry.ts > gateway/src/kernel-v2/providers/tts-registry.ts
git show 5a248271:gateway/tests/unit/tts-registry-capability.test.ts > gateway/tests/unit/kernel-v2/tts-registry-capability.test.ts
```
- [ ] 调整 import：
  - `providers/tts-registry.ts` → `../capability-registry`, `../../core/utils/logger`, `../../tts/types`
  - tests → `../../../src/kernel-v2/...`
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/capability-registry.test.ts tests/unit/kernel-v2/tts-registry-capability.test.ts`
  - Expected: 20 tests PASS after import fixes.
- [ ] **Run** `npx jest --runInBand tests/unit/tts-registry.test.ts`（v1 30 tests）
  - Expected: PASS unchanged.
- [ ] 在 `gateway/src/kernel-v2/README.md` 记录 port 差异（tier 兼容层、文件名）。
- [ ] Commit：`feat(kernel-v2): port capability registry spike`

**Gate G0.5**：S1 产物在 kernel-v2 可运行；v1 文件零改动；20 个测试通过。

---

## Task 0.6：Diagnostics / versioning / performance 契约

**Files:**
- Create: `gateway/src/kernel-v2/diagnostics.ts`
- Create: `gateway/src/kernel-v2/capability-version.ts`
- Create: `gateway/tests/unit/kernel-v2/diagnostics.test.ts`
- Create: `gateway/tests/unit/kernel-v2/capability-version.test.ts`

**Interfaces:**
- Produces:
```ts
export type KernelPlane = "gateway" | "desktop-ui" | "desktop-web" | "desktop-main"
export type KernelProviderState = "loaded" | "active" | "degraded" | "failed" | "disposed"

export interface KernelDiagnostic {
  providerId: string
  capability: string
  version: string
  plane: KernelPlane
  state: KernelProviderState
  reason?: string
  revision: string
  lastKnownGood?: string
  at: string
}

export function createKernelDiagnostic(
  input: Omit<KernelDiagnostic, "at"> & { at?: string },
): KernelDiagnostic

export interface CapabilityVersion {
  major: number
  minor: number
}

export function parseCapabilityVersion(value: string): CapabilityVersion | null
export function isCapabilityCompatible(host: CapabilityVersion, provider: CapabilityVersion): boolean
export function allowsCapabilityCoexistence(
  host: CapabilityVersion,
  provider: CapabilityVersion,
  explicit: boolean,
): boolean
```
- Consumes: spec §4.9/§4.10/§4.11。

- [ ] **Write failing tests**:
  - diagnostic has all fields, `at` default ISO, no secret/Host code
  - `parseCapabilityVersion("1.2")` → `{ major:1, minor:2 }`; invalid → null
  - same major compatible; different major incompatible
  - coexistence only with `explicit: true`
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/diagnostics.test.ts tests/unit/kernel-v2/capability-version.test.ts`
  - Expected: FAIL modules missing.
- [ ] **Implement** pure types/factories/validators; no wiring.
- [ ] **Run** same; Expected: PASS.
- [ ] 把 performance contract 映射为 Task 1.1 的 cache/100ms 预算测试注释（不新增代码）。
- [ ] Commit：`feat(kernel-v2): add diagnostics and capability version contracts`

**Gate G0.6**：诊断/版本字段冻结；零运行时行为变化。

---

## Task 1.1：生产级 CapabilityRegistry

**Files:**
- Modify: `gateway/src/kernel-v2/capability-registry.ts`
- Modify: `gateway/tests/unit/kernel-v2/capability-registry.test.ts`

**Interfaces:**
- Produces:
```ts
export type CapabilityScope =
  | { kind: "global" }
  | { kind: "project"; id: string }
  | { kind: "session"; id: string }

export type CapabilityHealth = "healthy" | "degraded" | "failed"

export interface CapabilityEntry<T> {
  id: string
  value: T
  dispose?: () => void | Promise<void>
  priority?: number
  health?: () => CapabilityHealth
}

export class CapabilityRegistry<T> {
  register(tier: CapabilityTier, entry: CapabilityEntry<T>, scope?: CapabilityScope): () => void
  replaceTier(tier: CapabilityTier, entries: readonly CapabilityEntry<T>[], scope?: CapabilityScope): void
  resolve(id?: string, scope?: CapabilityScope): T
  get(id: string, scope?: CapabilityScope): T | undefined
  list(scope?: CapabilityScope): Array<{ id: string; value: T; tier: CapabilityTier; scope: CapabilityScope }>
  diagnostics(): KernelDiagnostic[]
  dispose(): Promise<KernelDiagnostic[]>
}
```
- Resolution: session → project → global; within scope higher tier wins; then priority desc; then registration order; then id.
- Keep the spike API (`register(tier, entry)`, `replaceTier`) so Task 0.5's TTS registry/tests keep working; scope/priority/health are additive.
- Resolution cache: `resolve()` results cached per `(scope, id)`; cache invalidated on register/replaceTier/dispose.
- Consumes: Task 0.5 ported registry; Task 0.6 diagnostics.

- [ ] **Write failing tests**:
  - global default resolves
  - project overrides global; session overrides project
  - no cross-project/session leak
  - priority wins within scope; tie-break registration order
  - health failed → last-known-good or fallback
  - diagnostics record provider id/state/reason
  - resolve cache invalidates on register
  - spike API remains source-compatible (`register(tier, entry)`, `replaceTier`)
  - dispose LIFO/idempotent
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/capability-registry.test.ts`
  - Expected: FAIL on new scope/health tests.
- [ ] **Implement** scope/priority/cache/health/diagnostics additively.
- [ ] **Run** same; Expected: PASS（含 Task 0.5 的 13 个测试）。
- [ ] Commit：`feat(kernel-v2): add scoped capability registry`

**Gate 1.1**：scope/priority/health/cache 测试通过；100ms recall 路径不在 registry 做解析（本 phase 无 recall 接线）。

---

## Task 1.2：Provider lifecycle

**Files:**
- Create: `gateway/src/kernel-v2/provider-lifecycle.ts`
- Create: `gateway/tests/unit/kernel-v2/provider-lifecycle.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProviderLifecycleState =
  | "loaded" | "valid" | "resolved" | "active" | "degraded" | "draining" | "disposed" | "failed"

export interface ProviderHandle {
  id: string
  load(): Promise<void>
  activate(): Promise<void>
  deactivate(): Promise<void>
  health(): Promise<CapabilityHealth>
  dispose(): Promise<void>
}

export interface LifecycleResult {
  active: string[]
  degraded: string[]
  failed: string[]
  safeMode: boolean
}

export class ProviderLifecycle {
  constructor(options: { required: string[]; untrustedSupported: boolean })
  start(handles: ProviderHandle[]): Promise<LifecycleResult>
  stop(): Promise<KernelDiagnostic[]>
}
```
- `load` throw = fail-soft; `activate` timeout = failed; required failed → safeMode.
- untrusted + `untrustedSupported: false` → fail-closed reject.

- [ ] **Write failing tests**:
  - dependency order respected
  - cycle fails activation with named reason
  - load throw is fail-soft
  - activate timeout → failed
  - deactivate failure isolated
  - required failed → safeMode true
  - optional failed → degraded
  - untrusted without worker → failed, no in-process fallback
  - stop LIFO/idempotent
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/provider-lifecycle.test.ts`
  - Expected: FAIL module missing.
- [ ] **Implement** state machine; no boot wiring.
- [ ] **Run** same; Expected: PASS.
- [ ] Commit：`feat(kernel-v2): add provider lifecycle`

**Gate 1.2**：load/activate/drain/dispose 语义通过；safe mode/degraded/untrusted 拒绝明确。

---

## Task 1.3：TTS provider adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/tts.ts`
- Create: `gateway/tests/unit/kernel-v2/tts-provider.test.ts`
- Verify: `gateway/tests/unit/tts-registry.test.ts`（v1 30 tests）

**Interfaces:**
- Produces:
```ts
export interface TtsCapability {
  resolve(id?: string, scope?: CapabilityScope): TtsEngine
  list(scope?: CapabilityScope): Array<{ id: string; profile: TtsProfile; tier: CapabilityTier }>
}

export function createTtsCapability(registry: CapabilityRegistry<TtsEngine>): TtsCapability
```
- Consumes: `gateway/src/tts/types.ts`（纯类型）。

- [ ] **Write failing tests**:
  - default mimo
  - package > legacy > builtin
  - unknown id fallback + diagnostics
  - health failed → fallback
  - dispose doesn't touch v1 registry
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/tts-provider.test.ts`
  - Expected: FAIL module missing.
- [ ] **Implement** adapter around `CapabilityRegistry<TtsEngine>`.
- [ ] **Run** same + `tests/unit/tts-registry.test.ts`; Expected: PASS both.
- [ ] Commit：`feat(kernel-v2): add tts provider adapter`

**Gate 1.3**：v2 TTS adapter 行为与 v1 30 tests 一致；v1 零改动。

---

## Task 1.4：Usage provider adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/usage.ts`
- Create: `gateway/tests/unit/kernel-v2/usage-provider.test.ts`
- Verify: `gateway/tests/unit/usage/plugin-loader.test.ts`（v1 行为不变）

**Interfaces:**
- Produces:
```ts
export interface UsageCapability {
  adapters(scope?: CapabilityScope): ExternalAdapter[]
}

export function createUsageCapability(registry: CapabilityRegistry<ExternalAdapter>): UsageCapability
```
- Consumes: `gateway/src/usage/types.ts`（纯类型）。

- [ ] **Write failing tests**:
  - package > legacy > builtin resolution for usage
  - missing id fallback
  - provider removal doesn't throw
  - record/replay fixture returns normalized rows
  - diagnostics visible
- [ ] **Run** `npx jest --runInBand tests/unit/kernel-v2/usage-provider.test.ts`
  - Expected: FAIL module missing.
- [ ] **Implement** adapter; no live fetch in tests.
- [ ] **Run** same + `tests/unit/usage/plugin-loader.test.ts`; Expected: PASS.
- [ ] Commit：`feat(kernel-v2): add usage provider adapter`

**Gate 1.4**：v2 usage adapter 行为与 v1 一致；v1 零改动。

---

## Task 1.5：独立 v2 入口 + 只读 shadow

**Files:**
- Create: `gateway/src/kernel-v2/main.ts`
- Create: `gateway/src/kernel-v2/facade.ts`
- Create: `scripts/kernel-v2-shadow.mjs`
- Create: `gateway/tests/integration/kernel-v2-shadow.test.ts`

**Interfaces:**
- `main.ts` env:
  - `MAFW_KERNEL_V2_PORT`（required）
  - `MAFW_KERNEL_V2_DATA_DIR`（required）
  - 任一缺失 → exit code 2，不启动；不读 live `~/.mafw`。
- `facade.ts`:
```ts
export interface KernelV2Deps {
  tts: TtsCapability
  usage: UsageCapability
  diagnostics(): KernelDiagnostic[]
}
export function createKernelV2Server(deps: KernelV2Deps): http.Server
```
Routes: `GET /health`, `GET /api/tts/voices`, `GET /api/usage`（只读，normalized JSON）。

- [ ] **Write failing tests**:
  - `main` rejects missing env (test helper, no real process)
  - server `/health` returns `{ status: "ok", kernel: "v2", providers: [...] }`
  - `/api/tts/voices` matches v1 golden normalized JSON
  - `/api/usage` matches v1 golden normalized JSON
  - no live network: usage fixture only
  - server uses provided `dataDir`, not `~/.mafw`
- [ ] **Run** `npx jest --runInBand tests/integration/kernel-v2-shadow.test.ts`
  - Expected: FAIL modules missing.
- [ ] **Implement** facade + main + shadow script.
- [ ] **Run** same; Expected: PASS.
- [ ] 手动 rollback 演练：启动 v2，停 v2，确认 v1 仍可访问（记录在 release note）。
- [ ] Commit：`feat(kernel-v2): add isolated read-only shadow entrypoint`

**Gate 1.5**：独立 v2 只读 shadow 通过；v1 无变化；rollback 演练通过。

---

## Task 1.6：架构守卫 + 文档 + 全量门禁

**Files:**
- Modify: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`
- Modify: `docs/architecture/gateway.md`
- Create: `docs/releases/2026-11-12-capability-kernel-phase1.md`

- [ ] 守卫：v2 不 import v1 组合根/单例；v1 不 import v2；provider 不 import kernel。
- [ ] 记录 provider 清单、fallback、diagnostics、shadow 结果、rollback 演练。
- [ ] 运行：
```bash
cd gateway
npx jest --runInBand --forceExit
npx tsc --noEmit -p tsconfig.json
```
  连续 2 次 clean baseline；任何既存红灯单独列出，不混入本 phase。
- [ ] Commit：`docs: record kernel-v2 phase 0/1 delivery`

**Gate G1**：kernel-v2 模块 + 独立 v2 只读 shadow 通过；v1 全量绿；无 v1 HTTP/DTO 变化；rollback = 不启动 v2。

---

## Execution Handoff

Phase 0/1 共 12 个 task。建议 subagent-driven：

- Task 0.2/0.4/0.5/0.6 是契约/纯逻辑，适合独立实现 + 独立 review。
- Task 1.1/1.2 有接口依赖，先完成 0.5/0.6。
- Task 1.3/1.4 依赖 1.1/1.2；Task 1.5 依赖 1.3/1.4。

推荐顺序：

```text
0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6
→ 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
```

每个 task 完成后独立提交；Gate 1.5 后才允许进入 Phase 2。
