# Desktop 受管 Gateway 与联动发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Desktop 默认运行与自身同发布单元交付的 gateway，离线可安装、升级不抢版、更新等待进程退出、失败可隔离，并保留受控回滚基础。

**Architecture:** 保留 Electron 与 TypeScript gateway。P0 引入发布身份、版本/Experience 握手、受管实例登记和 Desktop 版本来源策略；P1 把安装资源中的 gateway 校验后复制到用户数据目录的版本目录，使用 current/previous/quarantine 指针原子切换。全局 npm `mafw` 只保留为显式 external 来源。

**Tech Stack:** Electron main/preload/renderer、TypeScript、Node 22+、electron-updater、electron-builder/NSIS、better-sqlite3/ZeroMQ Electron ABI、Node test runner、Jest、tsx。

**Spec:** `docs/superpowers/specs/2026-11-09-desktop-gateway-managed-runtime-design.md`

## Global Constraints

- Packaged Desktop 默认 `GatewaySourcePreference = "managed"`；external 必须用户显式选择。
- managed gateway 固定 `MAFW_SERVER_API_PORT=3000`，不得继承 shell 中的端口/takeover 覆盖。
- managed gateway 不写 `~/.config/mafw/gateway.pid`；实例登记在 `~/.mafw/runtime/desktop-gateway/<channel>/<instanceId>.json`。
- managed 要求 `gatewayVersion` 与发布单元完全相等；external 要求在最低版本之上且 `schemaEpoch` 相等。
- 运行中的受管实例比 Desktop 更新时禁止静默降级；`autoUpdater.allowDowngrade=false`。
- failed payload 必须先隔离，不得每次启动自动重试；`schemaEpoch` 变化时不得自动回滚数据。
- managed 模式下 `pending-restart.json` 只能让进程退出并由 Desktop supervisor 重启，禁止 detached takeover。
- 安装/升级 gateway 不执行 npm、不依赖网络、不依赖系统 Node。
- Linux 只有 AppImage 承诺应用内自动更新；deb/rpm 交给包管理器。
- Windows 签名证书状态按“暂无”处理；启用签名验证但不得把未签名自动安装宣称为已验收。
- Node 开发/安装基线统一为 `>=22`；保留 `gateway/package.json` 的全部 `optionalDependencies`。
- 保留用户现有 `~/.mafw` 数据、全局 npm 包和显式 external 配置，不自动卸载或删除。
- 每个任务先 RED 再 GREEN；只暂存本任务文件；提交信息使用任务给出的类型/范围。

## Review Focus

1. **未登记或旧版本进程占用 3000**：默认 managed 不得静默收养命令行、dev 或旧 Desktop 启动的 gateway；认不出所有权时进入可见 conflict，而不是假装 ready。
2. **Desktop 正常退出、立即更新或手工安装时 gateway 仍持有文件**：安装前必须等待受管 child 退出且端口失效；不能在 child 仍运行时替换资源。
3. **同一坏 payload 反复启动/回滚**：坏版本写 quarantine 后停止自动重试，只有新 payloadHash 或人工重试才清除。
4. **降级与 schema 变化**：运行中的新版、Desktop 回退或 `schemaEpoch` 不一致时不能自动覆盖或回滚，避免旧代码读新数据。
5. **旧 external 与未签名更新**：旧无版本 gateway 只能本次 override；无签名的 Windows 更新可以下载但安装必须失败/保持 gated，不能假报成功。

---

### Task 1: Gateway 发布身份、健康握手与受管重启语义

**Files:**
- Create: `gateway/release-policy.json`
- Create: `gateway/src/release-info.ts`
- Create: `gateway/scripts/write-release-manifest.mjs`
- Create: `gateway/tests/unit/release-info.test.ts`
- Create: `gateway/tests/unit/release-supervised-restart.test.ts`
- Modify: `gateway/package.json` (`build` script)
- Modify: `gateway/src/index.ts` (live `/health` at ~6880; runtime identity initialization)
- Modify: `gateway/src/self-update.ts` (token execution branch)
- Modify: `gateway/tests/unit/self-update.test.ts` only if existing helper signatures move

**Interfaces:**
- Produces:
```ts
export interface GatewayReleaseMetadata {
  productVersion: string
  gatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
}
export interface GatewayRuntimeIdentity {
  instanceId: string
  distribution: "desktop-managed" | "standalone"
  channel: string
}
export function composeGatewayReleaseMetadata(input: {
  productVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
}): GatewayReleaseMetadata
export function parseGatewayReleaseMetadata(value: unknown): GatewayReleaseMetadata
export function loadGatewayReleaseMetadata(distDir: string): GatewayReleaseMetadata
export function createGatewayRuntimeIdentity(
  env: Record<string, string | undefined>,
  newUuid: () => string,
): GatewayRuntimeIdentity
export function gatewayHealthFields(
  metadata: GatewayReleaseMetadata,
  identity: GatewayRuntimeIdentity,
): Record<string, unknown>
export const MANAGED_RESTART_EXIT_CODE = 75
export async function executePendingRestart(input: {
  managed: boolean
  build(): { ok: boolean; skipped?: boolean }
  writeRestartInfo(): void
  spawnTakeoverChild(): unknown | null
  sleep(ms: number): Promise<void>
  stop(): Promise<void>
  exit(code: number): never
}): Promise<void>
```
- `release-policy.json` is `{ "schemaEpoch": 1 }`.
- Build script reads root `package.json`, compiled `dist/experience/experience-contract.js`, and `release-policy.json`; writes `gateway/dist/release.json`.
- Managed token execution writes restart info, awaits `stop()`, exits `75`; it never calls `spawnTakeoverChild()` or `build()`.

- [ ] **Step 1: Write the failing release metadata tests**

Test names and assertions:
- `composeGatewayReleaseMetadata uses the product version for gatewayVersion` → product/gateway both `5.2.0`, Experience values passed through, schemaEpoch `1`.
- `parseGatewayReleaseMetadata rejects missing or non-positive schemaEpoch` → throws for absent fields and `0`.
- `createGatewayRuntimeIdentity marks only the managed env` → managed env yields `{distribution:"desktop-managed", channel:"beta", instanceId:"uuid-1"}`; absent env yields standalone/channel `standalone` and still calls the UUID factory once.
- `gatewayHealthFields exposes only additive identity fields` → exact keys/values include versions, schemaEpoch, channel, instanceId and distribution.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx jest tests/unit/release-info.test.ts --runInBand`
Expected: FAIL because `release-info.ts` does not exist.

- [ ] **Step 3: Implement release metadata and build stamp**

Implement the four functions in `gateway/src/release-info.ts`. `loadGatewayReleaseMetadata(distDir)` parses `<distDir>/release.json`; a missing/invalid file throws an error naming the file. The script writes JSON with a trailing newline and fails when any version is blank or schemaEpoch is not a positive integer.

Update `gateway/package.json` build to:

```text
tsc && node scripts/write-release-manifest.mjs && node -e "<existing dashboard/builtin copy>"
```

- [ ] **Step 4: Wire `/health` identity**

At scheduler initialization create release metadata from `__dirname` and runtime identity from `process.env`. In the live `/health` response at the earlier handler, spread `gatewayHealthFields(metadata, identity)` after the existing fields. Do not add paths, tokens or secrets.

- [ ] **Step 5: Write the failing supervised-restart test**

Test names:
- `managed restart exits for supervisor without spawning a takeover child`
- `source checkout restart keeps build plus takeover behavior`

Assertions for managed: build/spawn are not called, restart info is written, `stop` resolved before exit, exit code `75`.
Assertions for non-managed: build called once, spawn called once, alive confirmation retained, exit `0`.

- [ ] **Step 6: Run RED then extract and implement `executePendingRestart`**

Run: `npx jest tests/unit/release-supervised-restart.test.ts --runInBand`
Expected: FAIL on missing export.

Extract the accept branch of `startTokenWatcher` into `executePendingRestart`; pass `managed: process.env.MAFW_DESKTOP_MANAGED === "1"` from the watcher. Keep token removal, restart-info recording and caller notification outside the helper where existing behavior requires them.

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npx jest tests/unit/release-info.test.ts tests/unit/release-supervised-restart.test.ts tests/unit/self-update.test.ts --runInBand`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add gateway/release-policy.json gateway/src/release-info.ts gateway/scripts/write-release-manifest.mjs gateway/tests/unit/release-info.test.ts gateway/tests/unit/release-supervised-restart.test.ts gateway/package.json gateway/src/index.ts gateway/src/self-update.ts gateway/tests/unit/self-update.test.ts
git commit -m "feat(gateway): advertise release identity and supervised restarts"
```

---

### Task 2: Desktop 握手与来源决策纯逻辑

**Files:**
- Create: `packages/desktop/src/main/gateway-instance-record.ts`
- Create: `packages/desktop/src/main/gateway-instance-record.test.ts`
- Create: `packages/desktop/src/main/gateway-handshake.ts`
- Create: `packages/desktop/src/main/gateway-handshake.test.ts`
- Rewrite: `packages/desktop/src/main/mafw-gateway-plan.ts`
- Rewrite: `packages/desktop/src/main/mafw-gateway-plan.test.ts`

**Interfaces:**
- Consumes: `CliProbe` from `./mafw-cli-probe`; Task 1 release field names.
- Produces:
```ts
export type GatewaySourcePreference = "managed" | "external"
export interface GatewayReleaseExpectation {
  gatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
  channel: string
}
export interface GatewayHealthSnapshot {
  status?: string
  gatewayVersion?: string
  experienceVersion?: string
  minimumClientExperienceVersion?: string
  schemaEpoch?: number
  channel?: string
  instanceId?: string
  distribution?: string
}
export interface GatewayInstanceRecord {
  instanceId: string
  pid: number
  channel: string
  gatewayVersion: string
  schemaEpoch: number
  startedAt: string
  nonce: string
}
export type GatewayHandshakeResult =
  | { ok: true; exactVersion: boolean }
  | { ok: false; reason: "legacy-unversioned" | "older-than-required" | "newer-than-desktop" | "schema-mismatch" | "channel-mismatch" | "experience-incompatible" | "instance-mismatch" }
export function parseGatewayInstanceRecord(value: unknown): GatewayInstanceRecord | null
export function negotiateGateway(input: {
  mode: "managed" | "external"
  health: GatewayHealthSnapshot
  expected: GatewayReleaseExpectation
  expectedInstanceId?: string | null
}): GatewayHandshakeResult
export type GatewayStartPlan =
  | { mode: "managed"; entry: string; action: "spawn" | "adopt"; instanceId?: string }
  | { mode: "external"; transport: "url" | "cli"; url: string | null; warning: "legacy-unverified" | null }
  | { mode: "conflict"; reason: "external-unregistered" | "managed-newer" | "channel-mismatch" | "schema-mismatch" | "port-conflict" | "legacy-external-unverified"; detail: string }
  | { mode: "failed"; reason: string }
export function planGatewayStart(input: {
  packaged: boolean
  preference: GatewaySourcePreference
  expected: GatewayReleaseExpectation
  bundledEntry: string | null
  managedEntry: string | null
  externalCli: CliProbe
  running:
    | { kind: "none" }
    | { kind: "gateway"; health: GatewayHealthSnapshot; managedInstance: GatewayInstanceRecord | null }
    | { kind: "port-conflict" }
  legacyExternalOverride: boolean
}): GatewayStartPlan
```

- [ ] **Step 1: Write failing handshake tests**

Tests:
- managed exact version/schema/channel/instance → `{ok:true, exactVersion:true}`.
- managed older → `older-than-required`; newer → `newer-than-desktop`.
- managed version matches but record instance differs → `instance-mismatch`.
- external newer with same schema and compatible Experience → `{ok:true, exactVersion:false}`.
- external legacy response without version fields → `legacy-unversioned`.
- external Experience versions incompatible → `experience-incompatible`.

- [ ] **Step 2: Run RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-handshake.test.ts`
Expected: FAIL module not found.

- [ ] **Step 3: Implement numeric semver compare and negotiation**

Compare dot-separated numeric components; treat missing/invalid versions as legacy. For managed apply exact version, schema, channel and instance checks in that order. For external apply minimum version (expected gatewayVersion), equal schema, Experience compatibility and no instance requirement.

- [ ] **Step 4: Write failing source-plan tests**

Cases:
- packaged managed + no running + bundled → managed spawn from bundle.
- managed + matching registered instance → managed adopt with instanceId.
- managed + unregistered compatible running gateway → `external-unregistered`.
- managed + registered older instance → managed spawn replacement.
- managed + registered newer instance → `managed-newer`.
- managed + port-conflict → conflict.
- external + unversioned running gateway without override → `legacy-external-unverified`.
- same with `legacyExternalOverride:true` → external URL plus `warning:"legacy-unverified"`.
- dev managed with `managedEntry` → managed spawn; packaged managed with no entries → failed.
- external with no URL and CLI available → external CLI.

- [ ] **Step 5: Run RED, implement, run GREEN**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/mafw-gateway-plan.test.ts src/main/gateway-handshake.test.ts`
Expected before implementation: FAIL; after: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/gateway-instance-record.ts packages/desktop/src/main/gateway-instance-record.test.ts packages/desktop/src/main/gateway-handshake.ts packages/desktop/src/main/gateway-handshake.test.ts packages/desktop/src/main/mafw-gateway-plan.ts packages/desktop/src/main/mafw-gateway-plan.test.ts
git commit -m "feat(desktop): decide gateway source and version compatibility"
```

---

### Task 3: 受管实例登记、来源偏好与 supervisor 接线

**Files:**
- Create: `packages/desktop/src/main/gateway-instance-registry.ts`
- Create: `packages/desktop/src/main/gateway-instance-registry.test.ts`
- Create: `packages/desktop/src/main/gateway-source-preference.ts`
- Create: `packages/desktop/src/main/gateway-source-preference.test.ts`
- Modify: `packages/desktop/src/main/mafw-sidecar.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/gateway-sdk/src/types.ts` (`GatewayStatus`)
- Modify: `packages/desktop/src/preload/mafw-types.ts`, `packages/desktop/src/preload/index.ts` if new gateway methods are added
- Create: `packages/desktop/tests/managed-gateway-supervisor-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 `/health` fields; Task 2 `planGatewayStart`, `negotiateGateway`, record/expectation types.
- Produces:
```ts
export function gatewayInstanceRegistryRoot(homeDir?: string): string
export function gatewayInstanceRecordPath(root: string, channel: string, instanceId: string): string
export async function readGatewayInstanceRecords(root: string, channel: string): Promise<GatewayInstanceRecord[]>
export async function writeGatewayInstanceRecord(root: string, record: GatewayInstanceRecord): Promise<void>
export async function removeGatewayInstanceRecord(root: string, record: Pick<GatewayInstanceRecord, "channel" | "instanceId">): Promise<void>
export function readGatewaySourcePreference(store: { get(key: string): unknown }): GatewaySourcePreference
export function writeGatewaySourcePreference(store: { set(key: string, value: unknown): void }, value: GatewaySourcePreference): void
export function allowLegacyExternalOnce(): void
export function consumeLegacyExternalOnce(): boolean
```
- `GatewayStatus` adds `source`, `expectedVersion`, `actualVersion`, `instanceId`, `schemaEpoch`, `distribution`, and optional `quarantine: { version: string; payloadManifestSha256: string; error: string; failedAt: string } | null`.
- Preference store uses `electron-store("mafw.gateway")`; invalid/missing values read as `"managed"`.
- Managed spawn passes exactly:
```ts
ELECTRON_RUN_AS_NODE=1
MAFW_DESKTOP_MANAGED=1
MAFW_DESKTOP_CHANNEL=<channel>
MAFW_DESKTOP_INSTANCE_ID=<uuid>
MAFW_SERVER_API_PORT=3000
```
and explicitly removes/overrides `MAFW_TAKEOVER`, `MAFW_GATEWAY_PORT` and inherited `MAFW_SERVER_API_PORT`.

- [ ] **Step 1: Write failing registry tests**

Use a temp directory. Assert path under `runtime/desktop-gateway/<channel>`, atomic write creates one readable record, malformed JSON/record ignored, remove is idempotent, records with missing fields are rejected.

- [ ] **Step 2: Run RED then implement registry**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-instance-registry.test.ts`
Expected before: FAIL missing module; after: PASS.

- [ ] **Step 3: Write failing preference tests and one-time override**

Assert missing/invalid preference falls back managed, write round-trips `managed|external`, legacy override is consumed exactly once.

- [ ] **Step 4: Integrate supervisor**

Replace the adopt→CLI→bundle ladder with `probe running → read registered instance → planGatewayStart`. Keep `GatewayStatus` listeners and health monitor compatibility. Add `"conflict"` to `GatewayState`.

Requirements pinned by `managed-gateway-supervisor-wiring.test.ts`:
- managed entry resolves packaged `resources/gateway/dist/index.js` or dev `resolveGatewayEntry()`.
- spawn env pins port/managed identity and contains no CLI PID write.
- managed adopt is only for a matching registered instance; unregistered running gateway becomes conflict.
- stop awaits child exit and `waitForGatewayDown`, then removes the record.
- restart never re-adopts the same child; it stops first and respawns.
- conflict status carries actual/expected versions and instanceId when available.

- [ ] **Step 5: Add IPC and status fields**

Add `gateway-source-preference-get`/`gateway-source-preference-set` (preload `gateway.getSourcePreference/setSourcePreference`), `gateway-legacy-external-once`, and `gateway-retry-managed` with `{ force?: boolean }`. The retry IPC forwards force to the managed lifecycle once Task 10 wires it; before Task 10 it behaves as a normal restart. Extend SDK `GatewayStatus` additively; update preload typings.

- [ ] **Step 6: Run focused and related tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-instance-registry.test.ts src/main/gateway-source-preference.test.ts src/main/mafw-gateway-plan.test.ts src/main/gateway-handshake.test.ts tests/managed-gateway-supervisor-wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/gateway-instance-registry.ts packages/desktop/src/main/gateway-instance-registry.test.ts packages/desktop/src/main/gateway-source-preference.ts packages/desktop/src/main/gateway-source-preference.test.ts packages/desktop/src/main/mafw-sidecar.ts packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/main/ipc.ts packages/gateway-sdk/src/types.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/index.ts packages/desktop/tests/managed-gateway-supervisor-wiring.test.ts
git commit -m "feat(desktop): supervise a registered managed gateway"
```

---

### Task 4: 退出协调与更新前等待 gateway 退出

**Files:**
- Create: `packages/desktop/src/main/quit-coordinator.ts`
- Create: `packages/desktop/src/main/quit-coordinator.test.ts`
- Modify: `packages/desktop/src/main/index.ts` (relaunch, before/will-quit, signals, updater setup)
- Modify: `packages/desktop/src/main/updater.ts` (only the stop callback wiring if required)
- Modify: `packages/desktop/src/main/updater-controller.test.ts` if install sequencing changes
- Modify: `packages/desktop/tests/managed-gateway-supervisor-wiring.test.ts`

**Interfaces:**
- Produces:
```ts
export function createQuitCoordinator(input: {
  stopGateway(): Promise<void>
  getUpdateReady(): boolean
  installUpdate(): Promise<void>
  quit(): void
  onError?(error: unknown): void
}): {
  requestQuit(): Promise<void>
  isQuitting(): boolean
}
```
- Ready update path calls `installUpdate()` exactly once; the updater controller owns its existing stop-then-`quitAndInstall` sequence.
- Non-update path awaits `stopGateway()` then calls `quit()`.
- Concurrent requests share one promise. An update install failure calls `onError`, records no successful quit and leaves the app running.

- [ ] **Step 1: Write failing coordinator tests**

Tests:
- normal quit awaits stop then quit in order.
- ready update calls install, not the non-update quit path.
- concurrent requests produce one stop/install sequence.
- install rejection calls onError and `isQuitting()` stays false.

- [ ] **Step 2: Run RED, implement, run GREEN**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/quit-coordinator.test.ts`
Expected before: missing module; after: PASS.

- [ ] **Step 3: Wire Electron quit**

In `index.ts`:
- create coordinator after `updater`.
- `before-quit` sets app quitting, and unless the allow-quit latch is set, `preventDefault()` then `void coordinator.requestQuit()`.
- coordinator `quit()` sets the latch then `app.quit()`.
- relay and SIGINT/SIGTERM paths await `stopGateway()` and WSL sidecar stop before `app.exit(0)`.
- pass `stopGateway` (not `stopSidecars`) to `setupAutoUpdater`.
- remove/ignore the sidecar's fire-and-forget quit hook so only the coordinator owns managed shutdown.

- [ ] **Step 4: Pin wiring with source tests and rerun updater tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/quit-coordinator.test.ts src/main/updater-controller.test.ts tests/managed-gateway-supervisor-wiring.test.ts`
Expected: PASS; wiring test asserts `preventDefault`, real `stopGateway`, and no updater-owned `stopSidecars`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/quit-coordinator.ts packages/desktop/src/main/quit-coordinator.test.ts packages/desktop/src/main/index.ts packages/desktop/src/main/updater.ts packages/desktop/src/main/updater-controller.test.ts packages/desktop/tests/managed-gateway-supervisor-wiring.test.ts
git commit -m "fix(desktop): wait for gateway exit before quitting or updating"
```

---

### Task 5: 更新策略、签名门与桌面更新提示

**Files:**
- Create: `packages/desktop/src/main/updater-policy.ts`
- Create: `packages/desktop/src/main/updater-policy.test.ts`
- Create: `packages/desktop/src/renderer/mafw/updater-banner-model.ts`
- Create: `packages/desktop/src/renderer/mafw/updater-banner-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/UpdaterBanner.tsx`
- Create: `packages/desktop/tests/updater-wiring.test.ts`
- Modify: `packages/desktop/src/main/constants.ts`
- Modify: `packages/desktop/src/main/updater.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/electron-builder.config.ts`
- Modify: `packages/desktop/electron-builder.config.test.ts`

**Interfaces:**
- Produces:
```ts
export type UpdateChannel = "latest" | "beta"
export type UpdateSupport =
  | { enabled: true; channel: UpdateChannel }
  | { enabled: false; reason: "dev" | "not-packaged" | "linux-package" }
export function resolveUpdateSupport(input: {
  packaged: boolean
  channel: "dev" | "beta" | "prod"
  platform: NodeJS.Platform
  appImagePath: string | null
}): UpdateSupport
export function updaterBannerModel(state: UpdaterState): {
  visible: boolean
  title: string | null
  detail: string | null
  action: "install" | null
}
```
- Banner visible only `ready`; downloading/error stay quiet except Config diagnostics. Action text is “重启以更新”.
- Linux packaged non-AppImage returns disabled `linux-package`.
- Electron builder uses `verifyUpdateCodeSignature: true`; no signing claim is made by tests or UI.

- [ ] **Step 1: Write failing policy tests**

Cases: dev disabled; non-packaged disabled; prod channel latest; beta channel beta; win/mac packaged enabled; linux only `appImagePath` enabled.

- [ ] **Step 2: Implement policy and update constants/updater**

`constants.ts` exports `UPDATE_SUPPORT = resolveUpdateSupport({ packaged: app.isPackaged, channel: CHANNEL, platform: process.platform, appImagePath: process.env.APPIMAGE ?? null })`; `UPDATER_ENABLED` may become a deprecated alias or be removed with all imports updated.
In `updater.ts`: channel from `UPDATE_SUPPORT`, `allowDowngrade=false`, `allowPrerelease=false`, `autoDownload=false`, stock `autoInstallOnAppQuit=false`.

- [ ] **Step 3: Set signature verification and test builder config**

Change `win.verifyUpdateCodeSignature` to `true`. Add config test asserting signature verification is enabled and that no test pretends an unsigned release is acceptable.

- [ ] **Step 4: Write failing banner model and wiring tests**

Model tests: idle/checking/downloading/error invisible; ready visible with version in detail; install action only ready.
Wiring test asserts MafwShell mounts `UpdaterBanner`, model receives `window.api.updater.subscribe` state, install calls `window.api.updater.install()`, failure uses toast, and no raw `<button>` is introduced.

- [ ] **Step 5: Implement component and integrate**

Use `ButtonV2`; render a top non-modal strip only when visible, with install and dismiss-for-this-version actions. Do not add an always-on update center in this task.

- [ ] **Step 6: Run focused tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/updater-policy.test.ts src/renderer/mafw/updater-banner-model.test.ts tests/updater-wiring.test.ts electron-builder.config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/updater-policy.ts packages/desktop/src/main/updater-policy.test.ts packages/desktop/src/renderer/mafw/updater-banner-model.ts packages/desktop/src/renderer/mafw/updater-banner-model.test.ts packages/desktop/src/renderer/mafw/components/UpdaterBanner.tsx packages/desktop/tests/updater-wiring.test.ts packages/desktop/src/main/constants.ts packages/desktop/src/main/updater.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/electron-builder.config.ts packages/desktop/electron-builder.config.test.ts
git commit -m "feat(desktop): surface ready updates and gate install support"
```

---

### Task 6: Gateway 诊断与来源切换 UI

**Files:**
- Create: `packages/desktop/src/renderer/mafw/gateway-config-model.ts`
- Create: `packages/desktop/src/renderer/mafw/gateway-config-model.test.ts`
- Create: `packages/desktop/tests/gateway-config-wiring.test.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`, `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`, `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `packages/desktop/src/renderer/i18n/en.ts` (new labels; other locales fallback)

**Interfaces:**
- Consumes: Task 3 status/preference APIs and Task 5 updater API.
- Produces:
```ts
export interface GatewayConfigView {
  sourceLabel: string
  versionLabel: string
  compatibility: "ok" | "conflict" | "unknown"
  canRestart: boolean
  canRetryQuarantined: boolean
  canUseManaged: boolean
  canUseExternal: boolean
  canUseExternalOnce: boolean
}
export function gatewayConfigView(status: GatewayStatus | null): GatewayConfigView
export function gatewayConflictGuidance(status: GatewayStatus): string | null
```
- Preload exposes `gateway.getSourcePreference`, `gateway.setSourcePreference`, `gateway.useExternalOnce`, `gateway.retryManaged({ force })`, and existing start/restart/info. Remove/retire the UI-only `gateway.update()` token path.
- Config shows actual vs expected version, source, instanceId (short), schemaEpoch, quarantine error and conflict guidance.
- Buttons: restart managed gateway, retry quarantined version, switch to managed, switch to external, “仅本次使用未验证外部 gateway”, install ready Desktop update when applicable.
- No label claims a restart downloads a new build.

- [ ] **Step 1: Write failing model tests**

Cases: managed ready vs expected → ok; managed older/newer → conflict; external compatible → ok; null/legacy → unknown; conflict enables managed switch; quarantined status enables force retry but not plain restart; legacy external enables one-time override only.

- [ ] **Step 2: Run RED, implement model, run GREEN**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/gateway-config-model.test.ts`
Expected before: missing module; after: PASS.

- [ ] **Step 3: Finish main/preload IPC**

Implement preference set (persisted), external-once (memory only), managed retry (normal restart). Make `gateway.update` unavailable to renderer and ensure no code writes a pending token for Desktop restart. Keep CLI token behavior untouched.

- [ ] **Step 4: Update Config and pin wiring**

Replace the “更新 Gateway（自更新）” confirm/button with the new diagnostics/actions. Source test asserts no `buildUpdateToken`/`gateway.update()` in Config/main IPC, status fields are rendered, and breach of external switch requires explicit click (no auto fallback).

- [ ] **Step 5: Run focused tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/gateway-config-model.test.ts tests/gateway-config-wiring.test.ts tests/managed-gateway-supervisor-wiring.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/gateway-config-model.ts packages/desktop/src/renderer/mafw/gateway-config-model.test.ts packages/desktop/tests/gateway-config-wiring.test.ts packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/main/ipc.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/index.ts packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/renderer/i18n/en.ts
git commit -m "feat(desktop): show gateway ownership and switch sources explicitly"
```

---

### Task 7: 删除 NSIS npm 更新并依赖安装器退出保护

**Files:**
- Delete: `packages/desktop/gateway-update/update-global-gateway.cjs`
- Delete: `packages/desktop/gateway-update/update-global-gateway.test.ts`
- Delete: `packages/desktop/resources/installer.nsh` if no custom macro remains
- Modify: `packages/desktop/electron-builder.config.ts` (remove `gateway-update` extraResource and empty NSIS include)
- Modify: `packages/desktop/electron-builder.resources.test.ts`
- Modify: `packages/desktop/package.json` (remove `gateway-update/*.test.ts` glob)
- Create: `packages/desktop/tests/installer-health.test.ts`
- Modify: `docs/superpowers/specs/2026-09-17-desktop-installer-gateway-update-design.md` (superseded banner)

**Interfaces:**
- Consumes: electron-builder's built-in `CHECK_APP_RUNNING`; it notices the installed executable and waits, then closes/force-kills processes under the install directory before file replacement.
- Produces: no installer-time Node/npm/network requirement.

- [ ] **Step 1: Write the failing installer tests**

Assertions:
- builder `extraResources` does not contain `gateway-update/`.
- `nsis.include` is absent when no custom macro remains.
- installer source tree contains no `npm install -g`, `update-global-gateway`, or `node --version` hooks.
- package test glob does not reference the removed directory.

- [ ] **Step 2: Run RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/installer-health.test.ts electron-builder.resources.test.ts`
Expected: FAIL on current `gateway-update` resource.

- [ ] **Step 3: Delete obsolete updater and update builder**

Remove files/resources/glob. Leave electron-builder's built-in running-app protection in place; do not add a custom PID/taskkill script.

- [ ] **Step 4: Mark old spec superseded and run tests**

Add a top note linking the new spec and noting that global npm is no longer a Desktop update target.

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/installer-health.test.ts electron-builder.resources.test.ts electron-builder.config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/gateway-update packages/desktop/resources/installer.nsh packages/desktop/electron-builder.config.ts packages/desktop/electron-builder.resources.test.ts packages/desktop/package.json packages/desktop/tests/installer-health.test.ts docs/superpowers/specs/2026-09-17-desktop-installer-gateway-update-design.md
git commit -m "fix(desktop): stop updating gateway through the installer npm hook"
```

---

### Task 8: 共享 gateway 资产清单与锁文件打包

**Files:**
- Create: `scripts/gateway-package-assets.mjs`
- Create: `packages/desktop/tests/gateway-staging.test.ts`
- Modify: `packages/desktop/scripts/stage-gateway.ts`
- Modify: `gateway/scripts/deploy-local.mjs`
- Modify: `package.json` (`engines.node` to `>=22`)
- Modify: `package-lock.json` via `npm install --package-lock-only --ignore-scripts` after the engines change
- Modify: `packages/desktop/package.json` (explicit `stage:gateway` script with `tsx`)

**Interfaces:**
- Produces:
```js
export const GATEWAY_ASSET_PROFILES = {
  desktop: ["dist", "voice_sidecars", "skills", "scripts"],
  global: ["dist", "bin", "voice_sidecars", "skills", "scripts"],
}
export function gatewayAssetPlan(input: {
  repoRoot: string
  gatewayRoot: string
  profile: "desktop" | "global"
}): Array<{ from: string; to: string }>
```
- Desktop mapping targets are relative to bundle root: `dist/`, `voice_sidecars/`, `skills/`, `scripts/setup-pykernel.mjs`, `scripts/office/`.
- Stage copies `gateway/package.json` and `gateway/package-lock.json` verbatim, then runs `npm ci --omit=dev --no-audit --no-fund --loglevel=error`; it does not synthesize a dependency-only manifest.
- `optionalDependencies` remain in the manifest and installed tree.
- Deploy-local consumes the global asset plan for dist/CLI/skills/scripts/voice, then keeps its developer-only missing-dependency sync.

- [ ] **Step 1: Write failing asset-plan tests**

Assert desktop plan contains all five required destinations, global adds `bin/mafw.js`, all paths are within repo/gateway roots, and no profile includes `node_modules`.

Add staging source tests: `npm ci` used; package-lock copied; no synthesized `dependencies:` object; optional dependency name remains in package manifest; root engines is Node 22+.

- [ ] **Step 2: Run RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/gateway-staging.test.ts`
Expected: FAIL missing module/old staging behavior.

- [ ] **Step 3: Implement shared plan and refactor staging**

Copy assets from the shared plan. Copy package+lock, run npm ci, stage plugin contract, rebuild Electron native modules, then write any manifests added by Task 9. Fail with an explicit missing asset error; no silent skips except optional native directories explicitly listed by the plan.

- [ ] **Step 4: Refactor deploy-local and check exact parity**

Use the global plan for the non-node_modules assets. Keep its existing missing-dependency behavior and plugin-contract assertion. Add a test/snapshot that every desktop non-node_modules asset exists in the global plan too.

- [ ] **Step 5: Run focused tests and a dry staging smoke**

Run:
- `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/gateway-staging.test.ts`
- `cd gateway && npx jest tests/unit/release-info.test.ts --runInBand`
- after root build, `npm run stage:gateway` in `packages/desktop`

Expected: tests PASS; staging completes; `gateway-bundle/package-lock.json`, root skills and Office scripts exist.

- [ ] **Step 6: Commit**

```bash
git add scripts/gateway-package-assets.mjs packages/desktop/tests/gateway-staging.test.ts packages/desktop/scripts/stage-gateway.ts gateway/scripts/deploy-local.mjs package.json package-lock.json packages/desktop/package.json
git commit -m "build(gateway): stage one lockfile-based asset set"
```
(Do not stage generated `gateway-bundle` content; only a checked-in ignore file if needed.)

---

### Task 9: Payload 清单、版本目录安装与失败隔离纯逻辑

**Files:**
- Create: `packages/desktop/src/main/gateway-release-manifest.ts`
- Create: `packages/desktop/src/main/gateway-release-manifest.test.ts`
- Create: `packages/desktop/src/main/gateway-payload-installer.ts`
- Create: `packages/desktop/src/main/gateway-payload-installer.test.ts`
- Create: `packages/desktop/src/main/gateway-managed-store.ts`
- Create: `packages/desktop/src/main/gateway-managed-store.test.ts`
- Modify: `packages/desktop/scripts/stage-gateway.ts` (manifest production after install/rebuild)

**Interfaces:**
- Produces:
```ts
export interface GatewayReleaseManifest {
  schemaVersion: 1
  productVersion: string
  gatewayVersion: string
  desktopMinimumGatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
  payloadManifestSha256: string
}
export interface GatewayPayloadFile { path: string; size: number; sha256: string }
export interface GatewayPayloadManifest { schemaVersion: 1; files: GatewayPayloadFile[] }
export function parseGatewayReleaseManifest(value: unknown): GatewayReleaseManifest
export function parseGatewayPayloadManifest(value: unknown): GatewayPayloadManifest
export async function createGatewayPayloadManifest(root: string, deps: {
  walk(rel: string): Promise<string[]>
  read(rel: string): Promise<Buffer>
  stat(rel: string): Promise<{ size: number }>
  sha256(data: Buffer): string
}): Promise<{ manifest: GatewayPayloadManifest; digest: string }>
export async function verifyGatewayPayload(root: string, manifest: GatewayPayloadManifest, deps: VerifyDeps): Promise<void>
export function gatewayPayloadId(gatewayVersion: string, payloadManifestSha256: string): string
export async function installGatewayPayload(input: {
  sourceRoot: string
  versionsRoot: string
  release: GatewayReleaseManifest
  payload: GatewayPayloadManifest
  deps: InstallDeps
}): Promise<{ status: "reused" | "installed"; versionDir: string; entry: string }>
export type ManagedPointer = {
  version: string
  payloadManifestSha256: string
  versionDir: string
  installedAt: string
}
export function readCurrentPointer(root: string): ManagedPointer | null
export function writeCurrentPointer(root: string, pointer: ManagedPointer): Promise<void>
export function readPreviousPointer(root: string): ManagedPointer | null
export function moveCurrentToPrevious(root: string): Promise<void>
export type QuarantineRecord = {
  version: string
  payloadManifestSha256: string
  error: string
  failedAt: string
}
export function readQuarantine(root: string): QuarantineRecord | null
export function writeQuarantine(root: string, record: QuarantineRecord): Promise<void>
export function clearQuarantine(root: string): Promise<void>
```
- Payload manifest covers runtime files only and excludes `release-manifest.json`, `payload-manifest.json` and `.install-complete.json`, avoiding a digest cycle.
- `gatewayPayloadId` returns `<gatewayVersion>-<payloadManifestSha256.slice(0,12)>`. Install writes to `staging/<random>`, verifies every file, writes `.install-complete.json`, then renames to `versions/<payloadId>`.
- Existing complete payload with matching release+manifest digest is reused. A changed digest gets a different directory and never overwrites a running payload.
- Any hash/parse/write failure rejects without touching current/previous pointers.

- [ ] **Step 1: Write failing manifest tests**

Assertions: valid round-trip; missing fields/negative schema rejected; `createGatewayPayloadManifest` sorts paths, includes size/hash, excludes the two manifests and completion marker; digest changes when one file changes.

- [ ] **Step 2: Run RED then implement manifest functions**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-release-manifest.test.ts`
Expected: missing module → PASS after implementation.

- [ ] **Step 3: Write failing installer tests with temp fixtures**

Cases:
- fresh install copies all files and writes completion marker.
- same digest/version reused without rewriting.
- corrupt file rejects and leaves current pointer unchanged.
- staging leftovers cleaned on failure.
- version directory does not appear as complete before verification.
- `.bin` symlink/executable mode test on POSIX, regular file test on Windows.

- [ ] **Step 4: Implement installer and run GREEN**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-payload-installer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing pointer/quarantine tests**

Cases: atomic current write; previous pointer retains last good; same version+hash quarantine blocks auto retry; new hash can proceed; explicit clear removes record; malformed pointers read null.

- [ ] **Step 6: Implement managed store and produce manifests in staging**

After npm ci/native rebuild, create payload manifest; write `payload-manifest.json`; write release manifest with digest. Build script must fail if `release.json` and Experience versions disagree.

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-release-manifest.test.ts src/main/gateway-payload-installer.test.ts src/main/gateway-managed-store.test.ts tests/gateway-staging.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/gateway-release-manifest.ts packages/desktop/src/main/gateway-release-manifest.test.ts packages/desktop/src/main/gateway-payload-installer.ts packages/desktop/src/main/gateway-payload-installer.test.ts packages/desktop/src/main/gateway-managed-store.ts packages/desktop/src/main/gateway-managed-store.test.ts packages/desktop/scripts/stage-gateway.ts
git commit -m "feat(desktop): verify and install versioned gateway payloads"
```

---

### Task 10: 版本化 payload 生命周期、隔离回滚与 packaged smoke

**Files:**
- Create: `packages/desktop/src/main/gateway-managed-lifecycle.ts`
- Create: `packages/desktop/src/main/gateway-managed-lifecycle.test.ts`
- Create: `packages/desktop/scripts/packaged-gateway-smoke.mjs`
- Create: `packages/desktop/tests/packaged-gateway-smoke.test.ts`
- Modify: `packages/desktop/src/main/mafw-sidecar.ts`
- Modify: `packages/desktop/src/main/index.ts` (resolve managed root after userData)
- Modify: `packages/desktop/src/main/mafw-ipc.ts` (diagnostics reads)
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `packages/desktop/package.json` (smoke script)

**Interfaces:**
- Consumes: Task 9 manifests/installer/store; Task 3 supervisor.
- Produces:
```ts
export type ManagedLifecycleResult =
  | { kind: "start"; entry: string; versionDir: string; version: string }
  | { kind: "quarantined"; version: string; error: string }
  | { kind: "blocked"; reason: "schema-mismatch"; expectedSchemaEpoch: number; actualSchemaEpoch: number }
  | { kind: "failed"; reason: string }
export async function prepareManagedGateway(input: {
  resourcesRoot: string
  managedRoot: string
  expected: GatewayReleaseExpectation
  canReplaceRunning: boolean
  forceRetry: boolean
  deps: PrepareDeps
}): Promise<ManagedLifecycleResult>
export async function recordManagedStartFailure(input: {
  managedRoot: string
  release: GatewayReleaseManifest
  error: string
  previousAvailable: boolean
  schemaChanged: boolean
  deps: FailureDeps
}): Promise<{ restartPointer: ManagedPointer | null; blocked: boolean }>
```
- `prepareManagedGateway` reuses current, installs from bundled resources when missing, or returns quarantine if same version+hash already failed.
- If a running managed instance must be replaced, supervisor stops it only after the new payload is staged/verified; if schemaEpoch differs and the new payload cannot start, no automatic rollback.
- On failure with same schema and previous available: current becomes previous and supervisor starts it. Quarantine records failed version/hash. With schema change: return blocked and no gateway start.
- Startup verification at every launch is completion marker + manifest digest + entry/native file existence; full per-file hash only install/explicit repair.

- [ ] **Step 1: Write failing lifecycle tests**

Cases:
- no current pointer + valid resource → stages, installs, starts new.
- valid current release+digest → starts without reinstall.
- current version/hash quarantined → `quarantined`, no install/start.
- install failure → no current pointer mutation.
- same schema start failure with previous → points back and starts previous.
- schema change start failure → `blocked`, no previous start.
- new payload hash for a quarantined version proceeds after explicit retry.

- [ ] **Step 2: Run RED, implement lifecycle, run GREEN**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-managed-lifecycle.test.ts`
Expected before: missing module; after: PASS.

- [ ] **Step 3: Integrate with supervisor**

Resolve managed root from `app.getPath("userData")/gateway`. Before spawn:
- prepare lifecycle;
- if blocked/quarantined, set conflict/failed with diagnostics, expose the quarantine record on `GatewayStatus`, and start no gateway;
- if new payload requires replacement of a running managed child, stage first, stop child, switch pointer, spawn;
- after spawn readiness failure, call `recordManagedStartFailure` and either spawn previous (same schema) or expose blocked.
- clear quarantine only when `forceRetry:true` comes from the explicit Config action, or when the expected payload digest differs from the quarantined digest.

- [ ] **Step 4: Write packaged smoke script tests**

Tests assert script:
- finds packaged executable and `resources/gateway/dist/index.js`;
- uses a temp HOME/userData and random free port, pins `MAFW_SERVER_API_PORT`;
- waits for `/health`, asserts `gatewayVersion`, `experienceVersion`, `schemaEpoch`, `instanceId`, `distribution:"desktop-managed"`;
- requires no external npm/Node;
- kills the child and fails on leftover process/port.

- [ ] **Step 5: Implement smoke and wire CI**

Add `smoke:packaged-gateway` to desktop scripts. CI runs after package per OS with `xvfb-run` only if required; use `ELECTRON_RUN_AS_NODE` so no UI is created. Fail release build if smoke fails. Upload any `release-manifest.json` diagnostics alongside existing artifacts.

- [ ] **Step 6: Run focused tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/gateway-managed-lifecycle.test.ts src/main/gateway-payload-installer.test.ts src/main/gateway-managed-store.test.ts tests/packaged-gateway-smoke.test.ts tests/managed-gateway-supervisor-wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/gateway-managed-lifecycle.ts packages/desktop/src/main/gateway-managed-lifecycle.test.ts packages/desktop/scripts/packaged-gateway-smoke.mjs packages/desktop/tests/packaged-gateway-smoke.test.ts packages/desktop/src/main/mafw-sidecar.ts packages/desktop/src/main/index.ts packages/desktop/src/main/mafw-ipc.ts .github/workflows/desktop-release.yml packages/desktop/package.json
git commit -m "feat(desktop): run managed gateway from verified versioned payloads"
```

---

### Task 11: 发布文档、全量门禁与真机验收

**Files:**
- Modify: `AGENTS.md` (Desktop packaging/update section; mark old NSIS behavior superseded)
- Modify: `packages/desktop/README.md`
- Modify: `gateway/scripts/deploy-local.mjs` header help if commands changed
- Fix only regressions surfaced by gates

**Interfaces:**
- No new product interfaces. Verifies all tasks together.

- [ ] **Step 1: Update operator/developer docs**

Document:
- managed vs external source, how to switch, one-time legacy external;
- managed restart token exit code 75 and Desktop supervisor;
- version directory/current/previous/quarantine paths;
- Linux AppImage-only auto update;
- Windows signing gate and release prerequisite;
- packaged smoke command and expected health fields;
- old NSIS npm updater is retired.

- [ ] **Step 2: Run gateway gates**

Run in `gateway`:
- `npx tsc --noEmit -p tsconfig.json`
- `npm test -- --runInBand --forceExit`

Expected: tsc rc=0; all suites pass. Record suite/test counts.

- [ ] **Step 3: Run desktop and package gates**

Run:
- `npm test` in `packages/desktop`
- `npx tsgo --noEmit -p tsconfig.json`
- `npx electron-vite build`
- after root build: `npm run stage:gateway`
- `npm run smoke:packaged-gateway -- --payload-only` (or the script's documented local mode)

Expected: all rc=0; smoke asserts health identity and native modules.

- [ ] **Step 4: Run SDK/TUI/root gates**

Run:
- `npm test` in `packages/gateway-sdk`
- `npm test` in `packages/tui`
- `npm run build` at repo root

Expected: all rc=0 except the known TUI skip; record exact counts.

- [ ] **Step 5: Manual acceptance matrix**

Record evidence for:
1. Fresh package/no Node/no npm/offline starts managed gateway.
2. Old running external gateway + managed default shows conflict, does not kill it.
3. Managed old instance from shared record is stopped and replaced after new payload verification.
4. Unversioned external can only run after explicit one-time warning; restart returns managed.
5. Normal quit waits for gateway exit; updater ready installs on quit and restarts to new version.
6. Corrupt payload hash keeps old version; failed new version is quarantined and not retried every launch.
7. `schemaEpoch` change failure shows blocking recovery and does not start old code.
8. Windows unsigned update remains gated with an honest error; Linux deb/rpm show no in-app install action; AppImage does.
9. Config displays source/expected/actual/instanceId and has accurate buttons.
10. Existing `~/.mafw` data, global npm package and external config remain intact.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md packages/desktop/README.md gateway/scripts/deploy-local.mjs
git commit -m "docs: document managed gateway packaging and recovery"
```

---

## Execution Notes

- If a task reveals that an interface from an earlier task is insufficient, update the earlier task and its tests in the same commit rather than silently diverging.
- Do not combine P0 and P1 tasks: P0 must be independently shippable and testable before versioned payloads become the default.
- Before claiming Windows update success, distinguish code coverage from signed artifact acceptance. Without a certificate, the honest result is “code complete, production auto-install gated”.
- Unrelated mobile/pod parallel changes on `main` are not part of this plan and must not be staged.
