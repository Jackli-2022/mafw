# Desktop 终端 Surface + SSH 远端会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右工作台终端从底部 280px 条升为 `文件 / 浏览器 / 终端` L2 surface，并在其中提供 Xshell 式的多会话 SSH 终端（保存主机/密码、跳板机、主机指纹、自动重连）。

**Architecture:** 本地终端继续走 serve persistent PTY（现有 xterm/WS 基础设施）；SSH 走 desktop main 的 `ssh2` 客户端。main 新增统一 `TerminalHub`（local + ssh 会话注册表、ring buffer、状态事件），renderer 用 `TerminalSurface`/`TerminalView` 承载会话 tab、主机抽屉和对话框。工作台删除底部终端条，Ctrl+` 改为 surface 级开合。

**Tech Stack:** Electron 42、SolidJS、`@xterm/xterm@6` + `addon-fit`、`ssh2`（Node）、Electron `safeStorage`、node:test + `@mafw/test-shim`、`@mafw/ui/v2` 组件。

**Spec:** `docs/superpowers/specs/2026-10-29-terminal-surface-ssh-design.md`

## Global Constraints

- TDD：每个 Task 先写失败测试，再实现；每个 Task 一个 commit，提交信息沿用 `feat(desktop): ...` / `fix(desktop): ...`。
- desktop 测试：`cd packages/desktop && npm test`；单文件：`node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`。
- 类型门禁：`cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`（rc=0）。
- 构建门禁：`cd packages/desktop && npx electron-vite build`（rc=0）。
- renderer 只能经 `window.api` 调能力；不得 import `node:*`、`ssh2`、`electron`。
- UI 禁裸 `<button>`/`<input>`/裸 `title`；用 `ButtonV2`/`TextInputV2`/`SwitchV2`/`SelectV2`/`TooltipV2`/`LoaderV2`/`ToastV2`；禁 emoji 图标。
- **已保存秘密**永不出 main 进程：renderer 只能拿 `hasPassword`/`hasPassphrase` 布尔值；密码/口令只在用户输入的表单/OTP 对话框中以瞬时值存在；不写 localStorage、不进日志/崩溃报告。
- 主机指纹必须 TOFU：首次确认、之后校验、变化阻断；不存在「跳过校验」。
- SSH 会话只在终端 surface 首次可见时建立；不得在聊天界面后台连接/弹窗。
- 本地 PTY 只在本地 tab 激活且终端 surface 可见时 attach/创建；隐藏时不得后台起 shell。
- `ssh2` 连接超时分层：TCP/握手 30s 无进展取消；指纹 60s、OTP 120s 人工预算；`readyTimeout: 120_000`。
- 工作台面顺序固定：`文件 / 浏览器 / 终端`；默认 surface 仍是 `文件`。
- 本批不做：端口转发 UI、分屏、`~/.ssh/config` 导入、SFTP、远端文件树、会话日志。

## Review Focus

1. **自动重连遇到主机指纹变化**：必须停止自动重连并红色阻断，不能自动接受或无限重试。→ Task 5 测试。
2. **人工输入超过 30s**：指纹/OTP 不能因 `readyTimeout`/握手计时被掐断。→ Task 4 + Task 5 测试。
3. **终端 surface 隐藏时切目录**：只更新目标目录，不得后台创建本地 PTY。→ Task 8 + Task 12 测试。
4. **safeStorage 不可用/解密失败**：禁用保存密码、回退到输入密码，不得崩溃或写明文。→ Task 3 + Task 9 测试。
5. **同一主机多个会话/恢复重复 tab**：会话身份不能合并，抽屉计数与聚焦最近 tab 正确。→ Task 8 + Task 12 测试。

---

### Task 1: 工作台 terminal surface 状态 + Ctrl+` surface 开合

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`

**Interfaces:**
- Produces:
  - `type WorkbenchSurface = "code" | "browser" | "terminal"`
  - `WORKBENCH_SURFACES` 顺序 `文件 / 浏览器 / 终端`
  - `type TerminalSurfaceHotkeyState = { dockOpen: boolean; view: WorkbenchView; surface: WorkbenchSurface; previousSurface: "code" | "browser" }`
  - `terminalSurfaceHotkeyAction(s): { openDock: boolean; view: WorkbenchView; surface: WorkbenchSurface }`
- 保留 `terminalStripVisible` / `terminalHotkeyAction` 到 Task 13（当前 WorkbenchShell 还在用），标 `@deprecated`。

- [ ] **Step 1: 写失败测试**

```ts
// workbench-views.test.ts 追加
import { terminalSurfaceHotkeyAction } from "./workbench-views"

test("terminal surface id exists before it is added to the visible L2 list", () => {
  // Task 13 才把 terminal 加进 WORKBENCH_SURFACES；Task 1 先让持久化/快捷键认识这个 id。
  assert.equal(normalizeWorkbenchSurface("terminal"), "terminal")
})

test("legacy terminal tab maps to terminal surface", () => {
  const s = workbenchStateFromStorage((key) => key === "mafw-right-dock-tab" ? "terminal" : null)
  assert.equal(s.surface, "terminal")
  const t = workbenchStateFromStorage((key) => key === "mafw-workbench-tab" ? "terminal" : null)
  assert.equal(t.surface, "terminal")
})

test("terminalSurfaceHotkeyAction opens/toggles terminal surface", () => {
  assert.deepEqual(
    terminalSurfaceHotkeyAction({ dockOpen: false, view: "workbench", surface: "code", previousSurface: "code" }),
    { openDock: true, view: "workbench", surface: "terminal" },
  )
  assert.deepEqual(
    terminalSurfaceHotkeyAction({ dockOpen: true, view: "execution", surface: "code", previousSurface: "browser" }),
    { openDock: true, view: "workbench", surface: "terminal" },
  )
  assert.deepEqual(
    terminalSurfaceHotkeyAction({ dockOpen: true, view: "workbench", surface: "terminal", previousSurface: "browser" }),
    { openDock: true, view: "workbench", surface: "browser" },
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts`
Expected: FAIL（`terminalSurfaceHotkeyAction` 不存在 / labels 不含终端）

- [ ] **Step 3: 实现**

- `WorkbenchSurface` 加 `"terminal"`；**Task 1 暂不把 terminal 加进 `WORKBENCH_SURFACES`**（避免中间 commit 出现点不动的 tab），`SURFACE_IDS` 显式并入 `"terminal"`，让 `normalize`/持久化认识它。
- Task 13 再把 `{ id: "terminal", label: "终端" }` 加进 `WORKBENCH_SURFACES`。
- `legacySurface` 接受 `"terminal"`；`LEGACY_TABS.terminal.surface = "terminal"`。
- 新增 `terminalSurfaceHotkeyAction`：非工作台视图/dock 关闭/非终端 surface → `{openDock:true, view:"workbench", surface:"terminal"}`；当前 terminal → `{openDock:true, view:"workbench", surface:s.previousSurface}`。
- 旧 `terminalHotkeyAction` 保留并注释 `@deprecated`。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-views.ts packages/desktop/src/renderer/mafw/workbench-views.test.ts
git commit -m "feat(desktop): add terminal workbench surface state"
```

---

### Task 2: 共享会话/主机类型 + 主机校验 + renderer tab 模型

**Files:**
- Create: `packages/desktop/src/shared/terminal-session.ts`
- Create: `packages/desktop/src/shared/ssh-host.ts`
- Create: `packages/desktop/src/shared/ssh-host.test.ts`
- Create: `packages/desktop/src/renderer/mafw/terminal/terminal-model.ts`
- Create: `packages/desktop/src/renderer/mafw/terminal/terminal-model.test.ts`
- Modify: `packages/desktop/src/main/terminal/terminal-core.ts`（`dirKey` 移到 shared 后 re-export）

**Interfaces:**
- Produces:
  - `TerminalSessionKind/Status/Info`（含 `connectedAt?`）、`TerminalEvent`、`TerminalProbe`（见 spec §5.1/§7.2）
  - `HostKeyRequest`、`PromptRequest`（spec §7.2 的 hostkey/prompt 事件载荷，供 main/renderer 共用）
  - `SshAuthMethod`, `SshHostProfile`, `SshHostProfileInput`, `SshSecretInput`, `KnownHostEntry`
  - `sshHostKey(host: string, port: number): string`
  - `validateSshHostProfile(input, opts: { hosts: Pick<SshHostProfile, "id" | "jumpHostId">[] }): { ok: true; value: SshHostProfileInput } | { ok: false; errors: string[] }`
  - `dirKey(dir: string, platform?: string): string`
  - `localSessionId(directory: string, platform?: string): string` → `local:<dirKey>`
  - `tabTitle(session: TerminalSessionInfo): string`
  - `statusTone(session): "ok" | "warn" | "bad" | "idle"`
  - `statusLabel(session): string`
  - `reconnectLabel(session): string | null`
  - `nextActiveAfterClose(tabs, activeId, closingId): string | null`
  - `persistedTabs(tabs, activeId): PersistedTerminal`
  - `applyTerminalEvent(state: { sessions: TerminalSessionInfo[] }, ev: TerminalEvent): { sessions: TerminalSessionInfo[] }`

- [ ] **Step 1: 写失败测试**

```ts
// ssh-host.test.ts
const base = { name: "prod", group: "生产", host: "10.0.0.12", port: 22, username: "deploy", auth: "password", autoReconnect: true, keepaliveSeconds: 15 } as const

test("rejects empty host / bad port / empty user", () => {
  assert.equal(validateSshHostProfile({ ...base, host: "" }, { hosts: [] }).ok, false)
  assert.equal(validateSshHostProfile({ ...base, port: 0 }, { hosts: [] }).ok, false)
  assert.equal(validateSshHostProfile({ ...base, port: 70000 }, { hosts: [] }).ok, false)
  assert.equal(validateSshHostProfile({ ...base, username: " " }, { hosts: [] }).ok, false)
})

test("rejects self jump and jump-host-with-own-jump", () => {
  const hosts = [{ id: "a", jumpHostId: null }, { id: "b", jumpHostId: "a" }]
  assert.equal(validateSshHostProfile({ ...base, id: "a", jumpHostId: "a" }, { hosts }).ok, false)
  assert.equal(validateSshHostProfile({ ...base, jumpHostId: "b" }, { hosts }).ok, false)
})

test("sshHostKey normalizes port", () => {
  assert.equal(sshHostKey("10.0.0.12", 22), "10.0.0.12:22")
})
```

```ts
// terminal-model.test.ts
test("local session id + title + status", () => {
  const id = localSessionId("C:\\Work\\App", "win32")
  assert.equal(id, "local:c:/work/app")
  const s = { id, kind: "local", title: "本地 · App", directory: "C:\\Work\\App", status: "connected" } as const
  assert.equal(tabTitle(s), "本地 · App")
  assert.equal(statusTone(s), "ok")
  assert.equal(statusLabel({ ...s, status: "reconnecting", reconnectAttempt: 2 }), "重连中 2/5")
  assert.equal(reconnectLabel({ ...s, status: "reconnecting", reconnectInMs: 3000, reconnectAttempt: 2 }), "3 秒后重试（2/5）")
})

test("applyTerminalEvent updates status without dropping identity", () => {
  const s = { id: "ssh:1", kind: "ssh", title: "prod-01", hostId: "h1", status: "connecting" } as const
  const next = applyTerminalEvent({ sessions: [s] }, { type: "status", sessionId: "ssh:1", status: "connected" })
  assert.equal(next.sessions[0].status, "connected")
  assert.equal(next.sessions[0].hostId, "h1")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/shared/ssh-host.test.ts src/renderer/mafw/terminal/terminal-model.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `shared/terminal-session.ts`：类型 + `dirKey` + `localSessionId` + `terminalSessionStatusFromConn`（可选）。
- `shared/ssh-host.ts`：类型 + `sshHostKey` + 校验（name/host/user 非空、无空白/控制字符；port 1-65535；auth 枚举；key auth 必须有 `privateKeyPath`；jumpHostId 必须存在、非自身、jump host 本身无 jumpHostId）。
- `main/terminal/terminal-core.ts`：删除本地 `dirKey` 实现，改为 `export { dirKey } from "../../shared/terminal-session"`。
- `terminal-model.ts`：纯函数；`statusLabel` 映射：connecting=连接中、connected=已连接、reconnecting=`重连中 n/5`、disconnected=已断开、error=连接失败、closed=已关闭。
- `applyTerminalEvent` 对 `status` 合并 `reconnectAttempt/reconnectInMs/connectedAt/error`；`data`/`hostkey`/`prompt` 原样返回。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/shared/ssh-host.test.ts src/renderer/mafw/terminal/terminal-model.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared packages/desktop/src/renderer/mafw/terminal/terminal-model.ts packages/desktop/src/renderer/mafw/terminal/terminal-model.test.ts packages/desktop/src/main/terminal/terminal-core.ts
git commit -m "feat(desktop): shared terminal session and ssh host model"
```

---

### Task 3: 安全持久化（主机 / 秘密 / known_hosts / 指纹 / 脱敏）

**Files:**
- Create: `packages/desktop/src/main/terminal/json-file.ts`
- Create: `packages/desktop/src/main/terminal/ssh-host-store.ts` + `.test.ts`
- Create: `packages/desktop/src/main/terminal/terminal-secrets.ts` + `.test.ts`
- Create: `packages/desktop/src/main/terminal/known-hosts-store.ts` + `.test.ts`
- Create: `packages/desktop/src/main/terminal/fingerprint.ts` + `.test.ts`
- Create: `packages/desktop/src/main/terminal/redact.ts` + `.test.ts`

**Interfaces:**
- `readJsonFile<T>(filePath: string, fallback: T): T`；`writeJsonFileAtomic(filePath: string, value: unknown): void`
- `createSshHostStore({ filePath, fs?, now?, id? }): { list(); get(id); save(input, hosts); remove(id) }`
- `createTerminalSecrets({ filePath, safeStorage, fs? }): { available(); has(hostId); get(hostId); set(hostId, input); remove(hostId) }`
- `createKnownHostsStore({ filePath, fs?, now? }): { list(); get(host, port); put(entry); replace(entry); remove(host, port) }`
- `fingerprintOf(key: Buffer): string`（`SHA256:` + base64）
- `redactSshConfig(input: unknown): unknown`；`redactError(err: unknown): { message: string; code?: string }`

- [ ] **Step 1: 写失败测试**

```ts
// terminal-secrets.test.ts
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from("enc:" + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
}
test("encrypts at rest and never returns plaintext in file", () => {
  const dir = mkdtempSync(join(tmpdir(), "mafw-sec-"))
  const store = createTerminalSecrets({ filePath: join(dir, "secrets.json"), safeStorage: safe })
  store.set("h1", { password: "p@ss" })
  assert.equal(store.get("h1").password, "p@ss")
  assert.ok(!readFileSync(join(dir, "secrets.json"), "utf8").includes("p@ss"))
})

test("unavailable safeStorage disables save", () => {
  const store = createTerminalSecrets({ filePath: join(tmpdir(), "x.json"), safeStorage: { ...safe, isEncryptionAvailable: () => false } })
  assert.equal(store.available(), false)
})
```

```ts
// fingerprint.test.ts
test("SHA256 fingerprint format", () => {
  assert.equal(fingerprintOf(Buffer.from("abc")), "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=")
})
```

```ts
// known-hosts-store.test.ts
test("put/get/replace by host:port", () => {
  const store = createKnownHostsStore({ filePath: join(mkdtempSync(join(tmpdir(), "kh-")), "kh.json") })
  store.put({ host: "10.0.0.12", port: 22, keyType: "ssh-ed25519", publicKey: "AAA", fingerprint: "SHA256:x", addedAt: 1, lastSeenAt: 1 })
  assert.equal(store.get("10.0.0.12", 22)?.publicKey, "AAA")
  store.replace({ ...store.get("10.0.0.12", 22)!, publicKey: "BBB" })
  assert.equal(store.get("10.0.0.12", 22)?.publicKey, "BBB")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-secrets.test.ts src/main/terminal/fingerprint.test.ts src/main/terminal/known-hosts-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `json-file.ts`：`readFileSync` + JSON.parse，失败返回 fallback；写入 `filePath + ".tmp"` 后 `renameSync`。
- `ssh-host-store.ts`：`{ version: 1, hosts: [...] }`；`save` 调 `validateSshHostProfile`，新 id 用 `crypto.randomUUID()`；`list` 按 group/name 排序；坏文件返回 `[]`。
- `terminal-secrets.ts`：`{ version: 1, entries: { [hostId]: { password?: base64, passphrase?: base64 } } }`；`set` 用 `safeStorage.encryptString` 后 base64；`get` 解密失败返回 `{}`；`available` 透传 safeStorage。
- `known-hosts-store.ts`：`{ version: 1, entries: Record<string, KnownHostEntry> }`，key=`host:port`；`put` 设置 addedAt/lastSeenAt；`replace` 保留 addedAt、更新 lastSeenAt。
- `fingerprint.ts`：`createHash("sha256").update(key).digest("base64")`。
- `redact.ts`：递归克隆，key 匹配 `/password|passphrase|privateKey/i` 时替换为 `[REDACTED]`；`redactError` 只取 message/code。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-secrets.test.ts src/main/terminal/fingerprint.test.ts src/main/terminal/known-hosts-store.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/json-file.ts packages/desktop/src/main/terminal/ssh-host-store* packages/desktop/src/main/terminal/terminal-secrets* packages/desktop/src/main/terminal/known-hosts-store* packages/desktop/src/main/terminal/fingerprint* packages/desktop/src/main/terminal/redact*
git commit -m "feat(desktop): terminal host and ssh secret persistence"
```

---

### Task 4: ssh2 依赖 + 连接配置 + 主机指纹校验 + 重连策略

**Files:**
- Modify: `packages/desktop/package.json`（dependencies `ssh2`，devDependencies `@types/ssh2`）
- Create: `packages/desktop/src/main/terminal/ssh-connect.ts` + `.test.ts`
- Create: `packages/desktop/src/main/terminal/reconnect-policy.ts` + `.test.ts`

**Interfaces:**
- `HostKeyDecision = "trust" | "trust-and-save" | "replace" | "reject"`
- `HostKeyResponder = (req: HostKeyRequest) => Promise<HostKeyDecision>`
- `SshRuntimeSecret = { password?: string; passphrase?: string; privateKey?: string | Buffer }`
- `buildSshConnectConfig({ profile, secret, hostVerifier, sock?, agent? }): ConnectConfig`（`secret: SshRuntimeSecret`）
- `createHostVerifier({ sessionId, host, port, knownHosts, request, timeoutMs?, now?, keyTypeOf? }): (key: Buffer, verify: (ok: boolean) => void) => void`
- `reconnectDelay(attempt: number): number | null`（1/2/4/8/16s，attempt > 5 → null）
- `canAutoReconnect({ profile, hasPassword, hasPassphrase, hasKey, agentAvailable }): boolean`

- [ ] **Step 1: 写失败测试**

> 测试文件里定义 `base`（合法 profile）、`entry`（KnownHostEntry fixture）、`saved` 数组、`tick()`（`await Promise.resolve()`）等 helper；下面的用例只钉断言。

```ts
test("config carries auth/keepalive/timeouts", () => {
  const profile = { ...base, keepaliveSeconds: 15 }
  const cfg = buildSshConnectConfig({ profile, secret: { password: "x" }, hostVerifier: () => {} })
  assert.equal(cfg.host, "10.0.0.12")
  assert.equal(cfg.port, 22)
  assert.equal(cfg.username, "deploy")
  assert.equal(cfg.password, "x")
  assert.equal(cfg.readyTimeout, 120_000)
  assert.equal(cfg.keepaliveInterval, 15_000)
  assert.equal(cfg.keepaliveCountMax, 3)
  assert.equal(cfg.tryKeyboard, true)
  const keyCfg = buildSshConnectConfig({ profile: { ...base, auth: "key", privateKeyPath: "C:\\keys\\id" }, secret: { privateKey: "PEM", passphrase: "p" }, hostVerifier: () => {} })
  assert.equal(keyCfg.privateKey, "PEM")
  assert.equal(keyCfg.passphrase, "p")
  const agentCfg = buildSshConnectConfig({ profile: { ...base, auth: "agent" }, secret: {}, hostVerifier: () => {}, agent: "\\\\.\\pipe\\openssh-ssh-agent" })
  assert.equal(agentCfg.agent, "\\\\.\\pipe\\openssh-ssh-agent")
})

test("host verifier: new key asks and saves", async () => {
  const put = (e: KnownHostEntry) => saved.push(e)
  const verifier = createHostVerifier({
    sessionId: "ssh:1", host: "10.0.0.12", port: 22,
    knownHosts: { get: () => null, put, replace: () => {} },
    request: async () => "trust-and-save",
    keyTypeOf: () => "ssh-ed25519",
  })
  let ok = false
  verifier(Buffer.from("key"), (v) => { ok = v })
  await tick()
  assert.equal(ok, true)
  assert.equal(saved[0].fingerprint.startsWith("SHA256:"), true)
})

test("host verifier: changed key blocks", async () => {
  const verifier = createHostVerifier({
    sessionId: "ssh:1", host: "10.0.0.12", port: 22,
    knownHosts: { get: () => ({ ...entry, publicKey: "old" }), put: () => {}, replace: () => {} },
    request: async () => "reject",
    keyTypeOf: () => "ssh-ed25519",
  })
  let ok = true
  verifier(Buffer.from("new-key"), (v) => { ok = v })
  await tick()
  assert.equal(ok, false)
})

test("reconnect delays and auto-reconnect eligibility", () => {
  assert.deepEqual([1,2,3,4,5].map(reconnectDelay), [1000,2000,4000,8000,16000])
  assert.equal(reconnectDelay(6), null)
  assert.equal(canAutoReconnect({ profile: base, hasPassword: true, hasPassphrase: false, hasKey: false, agentAvailable: false }), true)
  assert.equal(canAutoReconnect({ profile: { ...base, autoReconnect: false }, hasPassword: true, hasPassphrase: false, hasKey: false, agentAvailable: false }), false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-connect.test.ts src/main/terminal/reconnect-policy.test.ts`
Expected: FAIL（模块不存在 / ssh2 未安装）

- [ ] **Step 3: 实现**

- `package.json` 加 `"ssh2": "^1.17.0"`；devDeps 加 `"@types/ssh2": "^1.15.0"`；`npm install`。
- `buildSshConnectConfig`：
  - `host/port/username`；按 auth 放 `password` / `privateKey`+`passphrase` / `agent`。
  - `readyTimeout: 120_000`；`keepaliveInterval: keepaliveSeconds * 1000`；`keepaliveCountMax: 3`；`tryKeyboard: true`；`sock` 透传。
  - 不把 `password` 等写入日志。
- `createHostVerifier`：
  - `keyTypeOf(key)` 默认 `utils.parseKey(key)?.type ?? "unknown"`。
  - `fingerprint = fingerprintOf(key)`。
  - 无记录 → `request({kind:"new"})`；match → `verify(true)`；changed → `request({kind:"changed", oldFingerprint})`。
  - 决策 `trust`/`trust-and-save`/`replace` → `verify(true)`；`reject` → `verify(false)`；`trust-and-save`/`replace` 写 store。
  - 60s 超时 → `verify(false)`；`request` 抛错 → `verify(false)`。
- `reconnect-policy.ts` 按 spec。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-connect.test.ts src/main/terminal/reconnect-policy.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/package-lock.json packages/desktop/src/main/terminal/ssh-connect* packages/desktop/src/main/terminal/reconnect-policy*
git commit -m "feat(desktop): ssh2 connect config, host key verification, reconnect policy"
```

---

### Task 5: SSH 会话生命周期 + 测试连接

**Files:**
- Create: `packages/desktop/src/main/terminal/ssh-session.ts` + `.test.ts`

**Interfaces:**
- `SshClientLike`：`EventEmitter` + `connect(cfg)` / `shell(opts, cb)` / `end()`
- `SshStreamLike`：`EventEmitter` + `write(data)` / `setWindow(rows, cols, h, w)`
- `createSshSession(opts: { id, profile, secret, jump? }, deps): SshSession`
- `SshSession`：`info()`, `connect()`, `attach(sub, key)`, `detach(key)`, `input(data)`, `resize(cols, rows)`, `reconnect()`, `close()`, `dispose()`
- `testSshConnection(opts, deps): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: 写失败测试**

> 测试文件里定义 `makeSession()` helper：FakeClient/FakeStream（EventEmitter）+ fake timers + fake prompt/hostkey responder，返回 `{ session, client, stream, events, timers, deps }`。下面的用例只钉契约。

```ts
test("ready -> shell -> connected; data fanout; input/resize", async () => {
  const { session, client, stream, events } = makeSession()
  session.connect()
  client.emit("ready")
  assert.equal(stream.shellOpts.term, "xterm-256color")
  assert.equal(session.info().status, "connected")
  const got: string[] = []
  session.attach((ev) => { if (ev.type === "data") got.push(ev.data) }, "v1")
  stream.emit("data", "hello")
  assert.deepEqual(got, ["hello"])
  session.input("ls\r")
  assert.equal(stream.written.at(-1), "ls\r")
  session.resize(100, 40)
  assert.deepEqual(stream.windows.at(-1), [40, 100, 0, 0])
  assert.equal(events.some((e) => e.type === "status" && e.status === "connected"), true)
})

test("close -> auto reconnect; 5 attempts then stop; user close cancels", async () => {
  const { session, client, timers } = makeSession({ autoReconnect: true, hasPassword: true })
  session.connect()
  client.emit("ready")
  client.emit("close")
  assert.equal(session.info().status, "reconnecting")
  timers.runNext()
  // ... repeat 5 times, assert no 6th timer
  session.close()
  assert.equal(timers.pending(), 0)
})

test("keyboard-interactive prompt is forwarded and answered", async () => {
  const { session, client, prompts } = makeSession()
  session.connect()
  let finish: (answers: string[]) => void = () => {}
  client.emit("keyboard-interactive", "OTP", "", "en", [{ prompt: "Code", echo: false }], (a: string[]) => { finish = a })
  prompts.resolve(["123456"])
  await tick()
  assert.deepEqual(finish, ["123456"])
})

test("testSshConnection resolves on ready without opening shell", async () => {
  const { deps, client } = makeSession()
  const p = testSshConnection({ id: "test", profile: base, secret: {} }, deps)
  client.emit("ready")
  assert.deepEqual(await p, { ok: true })
  assert.equal(client.shellCalls, 0)
})

test("auto reconnect pauses when host key needs human confirmation", async () => {
  const { session, client, timers, pendingHostKey } = makeSession({ autoReconnect: true, hasPassword: true })
  session.connect()
  client.emit("ready")
  client.emit("close")
  pendingHostKey.resolve("reject")
  timers.runNext()
  // hostVerifier 进入 pending 时停止自动重连：不得再排下一次 timer
  assert.equal(timers.pending(), 0)
  assert.equal(session.info().status, "disconnected")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-session.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- 状态机：`connecting → connected → disconnected/error`；`reconnecting` 带 `reconnectAttempt/reconnectInMs`；`close()` → `closed`；进入 connected 时设 `connectedAt = now()`，离开时清空。
- `connect()`：`buildSshConnectConfig` + `client.connect`；`ready` → `shell`；`shell` cb → stream + connected；`error`/`close` → 状态 + 自动重连。
- ring buffer 200k，按整行裁剪；`attach` 时重放。
- `input` 恒等透传（`\r` 不改写）；`resize` 调 `setWindow(rows, cols, 0, 0)`。
- 自动重连：`canAutoReconnect` 为真才调度；`reconnectDelay`；5 次后 `disconnected`；用户 `close` 取消 timer。status 事件带 `connectedAt`（connected 时）与 `reconnectAttempt/reconnectInMs`（reconnecting 时）。
- 遇到 `hostkey`/`prompt` 时停止自动重连（由 `request` 的 pending 状态判断；实现为 `autoRetryPaused`）。
- `close()/dispose()` 取消 pending hostkey/prompt：调用 pending 的 reject/取消（hostkey→false，prompt→`null`），清 timer，防 promise 泄漏。
- `keyboard-interactive`：发 `prompt` 事件，120s 超时 `finish([])`。
- `testSshConnection`：同 config/hostVerifier，`ready` 即 resolve，不 shell；30s 超时。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-session.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/ssh-session*
git commit -m "feat(desktop): ssh session lifecycle and reconnect"
```

---

### Task 6: 跳板机（一层 ProxyJump）

**Files:**
- Create: `packages/desktop/src/main/terminal/ssh-jump.ts` + `.test.ts`
- Modify: `packages/desktop/src/main/terminal/ssh-session.ts` + `.test.ts`

**Interfaces:**
- `createJumpSock({ sessionId, target, jump, knownHosts, requestHostKey, createClient }): Promise<{ sock; close(): void }>`
- `SshSessionOptions.jump?: { profile: SshHostProfile; secret: SshSecret }`

- [ ] **Step 1: 写失败测试**

```ts
test("connects bastion then forwards to target", async () => {
  const jumpClient = new FakeClient()
  const out = new FakeStream()
  jumpClient.forwardOut = (_src, _sport, dstHost, dstPort, cb) => { calls.push([dstHost, dstPort]); cb(null, out) }
  const res = await createJumpSock({ ..., createClient: () => jumpClient })
  jumpClient.emit("ready")
  await tick()
  assert.deepEqual(calls, [["10.0.0.12", 22]])
  assert.equal(res.sock, out)
})

test("bastion failure rejects and does not connect target", async () => { ... })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-jump.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- 用 `buildSshConnectConfig` 连接 bastion（同样的 hostVerifier/known_hosts）。
- `ready` → `forwardOut("127.0.0.1", 0, target.host, target.port)`；成功 resolve `{sock, close}`。
- 失败/关闭 → reject 并 `end()`。
- `ssh-session.connect()`：有 `jump` 时先 `createJumpSock`，把 `sock` 传给目标 config；`close()/dispose()` 时 `jump.close()`。
- 校验层已禁止 jump host 自身有 jump（Task 2），这里不做链式。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/ssh-jump.test.ts src/main/terminal/ssh-session.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/ssh-jump* packages/desktop/src/main/terminal/ssh-session*
git commit -m "feat(desktop): one-hop ssh jump host"
```

---

### Task 7: 本地终端适配器（从 terminal-bridge 抽出）

**Files:**
- Create: `packages/desktop/src/main/terminal/local-terminal.ts` + `.test.ts`
- Modify: `packages/desktop/src/main/terminal/terminal-bridge.ts`（暂时保留旧入口，内部委托 local-terminal）
- Move tests: `packages/desktop/src/main/terminal/terminal-bridge.test.ts` → `local-terminal.test.ts`（保留 attach/token/WS/replay/gone/input/resize/kill 用例）

**Interfaces:**
- `createLocalTerminalOps({ gatewayBase, fetchImpl?, wsFactory?, log? }): LocalTerminalOps`
- `LocalTerminalOps`：
  - `probe(): Promise<{ available: boolean; serveUrl?: string; reason?: string }>`
  - `attach(directory, sessionId, sub, key, opts?): Promise<{ ok: true; ptyId; replayed } | { ok: false; reason }>`
  - `detach(directory, key)`
  - `input(directory, data)`
  - `resize(directory, cols, rows)`
  - `kill(directory)`
- 事件：`{ type:"data", sessionId, data }` / `{ type:"status", sessionId, status:"connected"|"disconnected"|"error", error? }`

- [ ] **Step 1: 写失败测试**

把现有 `terminal-bridge.test.ts` 的断言迁移，改为新签名：
```ts
const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
const events: TerminalEvent[] = []
await ops.attach(D, "local:c:/work/app", (ev) => events.push(ev), "v1")
assert.equal(fetches[0].url, `${GW}/api/pty?directory=${enc(D)}`)
assert.equal(fetches[1].headers["x-opencode-ticket"], "1")
assert.equal(ws.url.includes("ticket="), true)
```
保留：已有 PTY 不重建、token 每次现取、文本帧 fanout、meta 帧只更新 cursor、close→disconnected、404→gone、input/resize/kill。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/local-terminal.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- 把 `createTerminalOps` 的目录逻辑移到 `local-terminal.ts`；保留 `lastPtyByDir`、`pickActivePty`、`parseMetaFrame`、`encodeInput`。
- `attach` 多一个 `sessionId` 参数，事件带 `sessionId`；状态映射：`attachOk→connected`、`wsClosed→disconnected`、`ptyGone→disconnected`（error 文案「终端已随服务重启关闭」）、`probeFail→error`。
- 旧 `terminal-bridge.ts` 暂时 re-export/wrap，保持当前 UI 编译；Task 9 替换为 service。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/local-terminal.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/local-terminal* packages/desktop/src/main/terminal/terminal-bridge.ts packages/desktop/src/main/terminal/terminal-bridge.test.ts
git commit -m "refactor(desktop): extract local terminal adapter"
```

---

### Task 8: TerminalHub（local + ssh 统一会话注册表）

**Files:**
- Create: `packages/desktop/src/main/terminal/terminal-hub.ts` + `.test.ts`

**Interfaces:**
- `createTerminalHub(deps): TerminalHub`
- `TerminalHubDeps`：`local: LocalTerminalOps`、`profiles: () => SshHostProfile[]`、`secretFor(hostId)`、`createSshSession(opts)`、`onEvent(ev)`、`id?()`
- `TerminalHub`：
  - `list(): TerminalSessionInfo[]`
  - `attachLocal(directory): Promise<TerminalSessionInfo>`
  - `createSsh({ id?, hostId }): Promise<TerminalSessionInfo>`（创建并连接）
  - `restoreSsh({ id, hostId }): TerminalSessionInfo`（创建但不连接）
  - `connect(sessionId): Promise<void>`
  - `attach(sessionId, sub, key): Promise<{ ok; replayed }>`
  - `detach(sessionId, key)`
  - `input(sessionId, data)`
  - `resize(sessionId, cols, rows)`
  - `close(sessionId)`
  - `kill(sessionId)`
  - `reconnect(sessionId)`
  - `dispose()`

- [ ] **Step 1: 写失败测试**

```ts
test("local attach returns local:<dirKey> and forwards data", async () => {
  const local = fakeLocal()
  const hub = createTerminalHub({ ...deps, local })
  const info = await hub.attachLocal("C:\\Work\\App")
  assert.equal(info.id, "local:c:/work/app")
  const got: TerminalEvent[] = []
  await hub.attach(info.id, (ev) => got.push(ev), "v1")
  local.emit({ type: "data", sessionId: info.id, data: "hi" })
  assert.deepEqual(got.filter((e) => e.type === "data"), [{ type: "data", sessionId: info.id, data: "hi" }])
})

test("multiple ssh sessions to same host stay distinct", async () => {
  const hub = createTerminalHub(deps)
  const a = await hub.createSsh({ hostId: "h1" })
  const b = await hub.createSsh({ hostId: "h1" })
  assert.notEqual(a.id, b.id)
  assert.equal(hub.list().filter((s) => s.hostId === "h1").length, 2)
})

test("restoreSsh is disconnected until connect()", async () => {
  const hub = createTerminalHub(deps)
  const info = hub.restoreSsh({ id: "ssh:r1", hostId: "h1" })
  assert.equal(info.status, "disconnected")
  await hub.connect(info.id)
  assert.equal(hub.list().find((s) => s.id === info.id)?.status, "connecting")
})

test("close local detaches but does not kill; kill removes", async () => {
  const hub = createTerminalHub(deps)
  const info = await hub.attachLocal(D)
  await hub.close(info.id)
  assert.equal(local.killCalls, 0)
  await hub.attachLocal(D)
  await hub.kill("local:c:/work/app")
  assert.equal(local.killCalls, 1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-hub.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- 内部 `Map<string, HubSession>`；local info 由 `attachLocal` 生成；SSH info 由 `sshSession.info()`。local 进入 connected 时同样写 `connectedAt`。
- `onEvent` 统一转发给 hub 的订阅者 + 外部 `deps.onEvent`。
- local `attach` 时传 hub 生成的 subscriber；hub 做 fanout；`detach` 删除 key。local status `connected` 事件补 `connectedAt = deps.now?.() ?? Date.now()`。
- `close` local：detach 所有 key，调用 `local.detach`，移除 info（PTY 保留）；SSH：`session.close()`，移除 info。
- `kill` local：`local.kill` + 移除；SSH：同 close。
- `restoreSsh` 不连接；`connect` 调 `session.connect()`。
- `dispose` 关闭所有 SSH，detach local。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-hub.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/terminal-hub*
git commit -m "feat(desktop): unified terminal hub for local and ssh sessions"
```

---

### Task 9: 终端服务 + IPC + preload

**Files:**
- Create: `packages/desktop/src/main/terminal/terminal-service.ts` + `.test.ts`
- Modify: `packages/desktop/src/main/terminal/terminal-bridge.ts`（改为 `installTerminalBridge` 委托 service）
- Modify: `packages/desktop/src/main/mafw-ipc.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- `createTerminalService({ dataDir, local, createSshSession, safeStorage, openExternal, log }): TerminalService`
- `TerminalService`：`hub`, `hosts: { list, save, remove, test }`, `respondHostKey`, `respondPrompt`, `dispose`
- Preload `window.api.mafw.terminal`：见 spec §7.3（`sessions.*`、`hosts.*`、`hostkey.respond`、`prompt.respond`、`openExternal`、`onEvent`）
- IPC 通道：见 spec §7.1。

- [ ] **Step 1: 写失败测试**

```ts
test("hosts.list returns hasPassword without secret", async () => {
  const svc = makeService()
  const saved = await svc.hosts.save({ ...base, auth: "password" }, { password: "x" })
  const list = await svc.hosts.list()
  assert.equal(list[0].hasPassword, true)
  assert.equal("password" in list[0], false)
})

test("hosts.save validates and persists; remove clears secret", async () => {
  const svc = makeService()
  await assert.rejects(() => svc.hosts.save({ ...base, host: "" }, {}))
  const saved = await svc.hosts.save({ ...base }, { password: "x" })
  await svc.hosts.remove(saved.id)
  assert.deepEqual(await svc.hosts.list(), [])
  assert.equal(secrets.get(saved.id).password, undefined)
})

test("hosts.save rejects secret when safeStorage is unavailable", async () => {
  const svc = makeService({ safeStorageAvailable: false })
  await assert.rejects(() => svc.hosts.save({ ...base }, { password: "x" }), /凭据存储不可用/)
})

test("IPC handler map exposes new channels", () => {
  const handlers = installFake()
  for (const ch of ["mafw-terminal-list","mafw-terminal-local-attach","mafw-terminal-ssh-create","mafw-terminal-hosts-list","mafw-terminal-hostkey-respond"]) {
    assert.equal(typeof handlers[ch], "function", ch)
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-service.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `terminal-service.ts`：组合 `createSshHostStore` / `createTerminalSecrets` / `createKnownHostsStore` / `createTerminalHub`；`hosts.list` 用 `hasPassword/hasPassphrase` 装饰；`hosts.save` 校验 + 存 profile + secret；`hosts.remove` 同时删 secret；`hosts.test` 用 `testSshConnection`（hostkey 事件带 `sessionId: "test:<uuid>"`）。
- `runtimeSecretFor(profile)`：合并 secrets store 的 password/passphrase；`auth=key` 时在主进程 `readFile` 读取 `privateKeyPath` 作为 `privateKey`；读文件失败返回可读错误，不把路径内容发 renderer。
- secret 编辑语义：`hosts.save` 未传 secret = 保留现有；`clearPassword`/`clearPassphrase` 显式清除；auth 改为 key/agent 不自动清密码（UI 不再使用，但用户可手动清除）。
- `terminal-bridge.ts`：`installTerminalBridge(ipcMain, deps)` 创建 service，注册所有通道；`mafw-terminal-event` 广播到所有 live window（v1 单主窗口；hosts.test 的临时会话也能收到 hostkey/prompt）。
- `mafw-ipc.ts`：传入 `dataDir: join(app.getPath("userData"), "terminal")`、`safeStorage`、`openExternalTerminal`、`log`。
- `preload/mafw-api.ts`：替换 terminal 命名空间；`onEvent` 复用 `mafw-terminal-event` relay。
- `preload/mafw-types.ts`：镜像 `TerminalSessionInfo`/`SshHostProfile`/`TerminalEvent`/`TerminalProbe`。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-service.test.ts && npm test && npx tsgo --noEmit -p tsconfig.json`
Expected: PASS / rc=0

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/terminal-service* packages/desktop/src/main/terminal/terminal-bridge.ts packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): terminal service ipc and preload api"
```

---

### Task 10: TerminalView（xterm 实例）+ 会话状态视图 + 右键菜单

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/terminal/terminal-view.ts` + `.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/context-menu/builders/terminal.ts` + `.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/context-menu/labels.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/context-menu-wiring.test.ts`（terminal 断言从 `TerminalDock.tsx` 改到 `TerminalView.tsx`）
- Create: `packages/desktop/tests/terminal-view-wiring.test.ts`

**Interfaces:**
- `sessionView(s: TerminalSessionInfo): TerminalView`（新状态映射）
- `buildTerminalMenu({ hasSelection, canClose, canKill, isLocal }): MenuModel`
- `TerminalView(props: { session; active; visible; onRequestClose; onRequestKill; onOpenExternal })`

- [ ] **Step 1: 写失败测试**

```ts
test("sessionView maps ssh statuses", () => {
  assert.equal(sessionView({ ...s, status: "connecting" }).busy, true)
  assert.equal(sessionView({ ...s, status: "connected" }).banner, undefined)
  assert.equal(sessionView({ ...s, status: "reconnecting", reconnectAttempt: 2, reconnectInMs: 3000 }).banner, "连接已断开，3 秒后重试（2/5）")
  assert.equal(sessionView({ ...s, status: "error", error: "auth failed" }).banner, "auth failed")
})

test("terminal menu keeps close and adds local-only kill", () => {
  const local = buildTerminalMenu({ hasSelection: false, canClose: true, canKill: true, isLocal: true })
  assert.equal(local.items.some((i) => i.id === "terminal.close"), true)
  assert.equal(local.items.some((i) => i.id === "terminal.kill"), true)
  const ssh = buildTerminalMenu({ hasSelection: false, canClose: true, canKill: false, isLocal: false })
  assert.equal(ssh.items.some((i) => i.id === "terminal.kill"), false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/terminal-view.test.ts src/renderer/mafw/context-menu/builders/terminal.test.ts`
Expected: FAIL（`sessionView`/`terminal.kill` 不存在）

- [ ] **Step 3: 实现**

- `terminal-view.ts` 加 `sessionView`；保留旧 `viewFor` 给本地降级/兼容。
- `TerminalView.tsx`：xterm + FitAddon + `createResizeScheduler`；`visible && active` 时 `attach`，否则 `detach`；`onEvent` 过滤 `session.id`；`term.onData` → `sessions.input`；主题用 `buildTerminalTheme`；右键 `menuController.request(buildTerminalMenu, ...)`；`terminal.kill` 调 `onRequestKill`；`terminal.close` 调 `onRequestClose`。
- `buildTerminalMenu` 加 `canKill/isLocal`；`labels.ts` 加 `kill: "结束终端"`；`close` 文案保持「关闭终端」；`openExternal` 只在本地会话显示（SSH 会话没有本地目录）。
- `TerminalView` 不 import node/ssh2；只用 `window.api.mafw.terminal`。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/terminal-view.test.ts src/renderer/mafw/context-menu/builders/terminal.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/terminal/terminal-view* packages/desktop/src/renderer/mafw/components/TerminalView.tsx packages/desktop/src/renderer/mafw/components/context-menu-wiring.test.ts packages/desktop/src/renderer/mafw/context-menu packages/desktop/tests/terminal-view-wiring.test.ts
git commit -m "feat(desktop): terminal view with xterm and session status menu"
```

---

### Task 11: 主机抽屉 + SSH 主机表单 + 指纹/OTP 对话框 + 状态条

**Files:**
- Create: `packages/desktop/src/renderer/mafw/terminal/host-drawer-model.ts` + `.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalHostDrawer.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/SshHostDialog.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/HostKeyDialog.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalPromptDialog.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalStatusBar.tsx`
- Create: `packages/desktop/tests/terminal-host-ui-wiring.test.ts`

**Interfaces:**
- `groupHosts(hosts, sessions, query): Array<{ group: string; hosts: Array<{ host: SshHostProfile; status: "connected"|"reconnecting"|"disconnected"; sessionCount: number }> }>`
- `TerminalHostDrawer(props: { open; hosts; sessions; onClose; onConnect(hostId); onNew(); onEdit(host); onRemove(hostId); onNewSession(hostId) })`
- `SshHostDialog(props: { open; initial?; hosts; onCancel; onSave(input, secret); onTest(input, secret) })`
- `HostKeyDialog(props: { request; onRespond(action) })`
- `TerminalPromptDialog(props: { request; onRespond(answers) })`
- `TerminalStatusBar(props: { session })`

- [ ] **Step 1: 写失败测试**

```ts
test("groupHosts groups, filters and counts sessions", () => {
  const hosts = [
    { ...base, id: "h1", group: "生产", name: "prod-01" },
    { ...base, id: "h2", group: "生产", name: "prod-02" },
    { ...base, id: "h3", group: "测试", name: "db-02" },
  ]
  const sessions = [
    { id: "ssh:1", kind: "ssh", hostId: "h1", title: "prod-01", status: "connected" },
    { id: "ssh:2", kind: "ssh", hostId: "h1", title: "prod-01", status: "reconnecting" },
  ] as any
  const out = groupHosts(hosts as any, sessions, "")
  assert.equal(out[0].group, "生产")
  assert.equal(out[0].hosts.find((h) => h.host.id === "h1")!.sessionCount, 2)
  assert.equal(out[0].hosts.find((h) => h.host.id === "h1")!.status, "connected")
  assert.equal(groupHosts(hosts as any, sessions, "db").length, 1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/host-drawer-model.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `host-drawer-model.ts`：按 group 聚合、search（name/host/user 大小写不敏感）、状态优先级 connected > reconnecting > disconnected、sessionCount。
- 组件全部 props-driven；`SshHostDialog` 用 `validateSshHostProfile`；密码/口令字段只在本地状态；`SwitchV2` 控制保存/自动重连；删除主机/关闭连接走二次确认。
- `HostKeyDialog` 默认焦点在「取消」；`changed` 用红色危险样式；`TerminalPromptDialog` 按 prompt 渲染 `TextInputV2`，`echo=false` 用密码类型。
- 所有图标用 `Icon`/`lucide`，禁 emoji；按钮/输入用 v2 组件。
- `TerminalStatusBar` 显示 `会话名 · 地址 · 状态/时长 · UTF-8 · cols×rows`；connected 时每 1s 刷新时长（`connectedAt`），卸载清 interval；窄宽由 CSS 隐藏右侧。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/host-drawer-model.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/terminal/host-drawer-model* packages/desktop/src/renderer/mafw/components/TerminalHostDrawer.tsx packages/desktop/src/renderer/mafw/components/SshHostDialog.tsx packages/desktop/src/renderer/mafw/components/HostKeyDialog.tsx packages/desktop/src/renderer/mafw/components/TerminalPromptDialog.tsx packages/desktop/src/renderer/mafw/components/TerminalStatusBar.tsx packages/desktop/tests/terminal-host-ui-wiring.test.ts
git commit -m "feat(desktop): terminal host drawer and ssh dialogs"
```

---

### Task 12: TerminalSurface + terminal store（会话 tab / 本地跟随 / 恢复 / 抽屉集成）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/terminal/terminal-store.ts` + `.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalSurface.tsx`
- Create: `packages/desktop/tests/terminal-surface-wiring.test.ts`

**Interfaces:**
- `createTerminalStore(deps: { api; storage; localDirectory: () => string | null; now?; id? }): TerminalStore`
- `TerminalStore`：`sessions()`, `activeId()`, `hosts()`, `drawerOpen()`, `hostDialog()`, `hostKey()`, `prompt()`, `init()`, `setVisible(v)`, `setActive(id)`, `ensureLocal(dir)`, `openLocal()`, `openSsh(hostId)`, `closeTab(id)`, `killLocal(id)`, `reconnect(id)`, `saveHost`, `removeHost`, `testHost`, `setDrawerOpen`, `openHostDialog`, `respondHostKey`, `respondPrompt`, `handleEvent`
- `TerminalSurface(props: { directory: string | null; active: boolean })`，`active` = **终端 surface 真正可见**（dock 打开 + 工作台视图 + surface=terminal），不是仅“选中 terminal”。

- [ ] **Step 1: 写失败测试**

```ts
test("restored ssh tabs stay disconnected until visible", async () => {
  const api = fakeApi({ sessions: [] })
  const store = createTerminalStore({ api, storage: memStorage({ "mafw-terminal-tabs-v1": JSON.stringify({ activeId: "ssh:r1", tabs: [{ id: "ssh:r1", kind: "ssh", hostId: "h1" }] }) }), localDirectory: () => "C:\\Work\\App" })
  await store.init()
  assert.equal(store.sessions().find((s) => s.id === "ssh:r1")?.status, "disconnected")
  assert.equal(api.restoreCalls, 1)
  assert.equal(api.connectCalls, 0)
  store.setVisible(true)
  await tick()
  assert.equal(api.connectCalls, 1)
})

test("hidden directory change does not attach local pty", async () => {
  const api = fakeApi()
  const store = createTerminalStore({ api, storage: memStorage(), localDirectory: () => "C:\\A" })
  await store.init()
  store.setVisible(false)
  store.ensureLocal("C:\\B")
  assert.equal(api.attachLocalCalls, 0)
  assert.equal(store.sessions().find((s) => s.kind === "local")?.directory, "C:\\B")
  store.setVisible(true)
  await tick()
  assert.equal(api.attachLocalCalls, 1)
})

test("closing local tab stays closed until openLocal", async () => {
  const api = fakeApi()
  const store = createTerminalStore({ api, storage: memStorage(), localDirectory: () => "C:\\A" })
  await store.init()
  const local = store.sessions().find((s) => s.kind === "local")!
  await store.closeTab(local.id)
  store.ensureLocal("C:\\A")
  assert.equal(store.sessions().some((s) => s.kind === "local"), false)
  store.openLocal()
  assert.equal(store.sessions().some((s) => s.kind === "local"), true)
})

test("same host two tabs persists both", async () => {
  const api = fakeApi()
  const store = createTerminalStore({ api, storage: memStorage(), localDirectory: () => "C:\\A" })
  await store.init()
  await store.openSsh("h1")
  await store.openSsh("h1")
  assert.equal(store.sessions().filter((s) => s.kind === "ssh").length, 2)
  const saved = JSON.parse(memStorage.dump()["mafw-terminal-tabs-v1"])
  assert.equal(saved.tabs.filter((t: any) => t.kind === "ssh").length, 2)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/terminal-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- store 是工厂；生产导出单例 `terminalStore`（依赖 `window.api.mafw.terminal`、`localStorage`、`benchRoot` 由 surface 传入）。
- `init`：`api.sessions.list()` + 读 `mafw-terminal-tabs-v1`；live 会话优先，persisted 中缺失的才 `restore`，不得重复；**无 persisted 状态时**加一个本地 tab；不连接 SSH。
- `setVisible(true)`：对 `status === "disconnected"` 且 autoReconnect/有凭据的 SSH 调 `connect`；本地 tab 调 `attachLocal`。
- `ensureLocal(dir)`：只更新**已存在**的本地 tab directory/title；若用户已关闭本地 tab，不自动重建。仅在 `visible && (activeId 为空或指向本地 tab)` 时 `attachLocal`（本地 tab 激活 + surface 可见，两个条件同时满足）。
- `openLocal()`：显式重开本地 tab（`+` 菜单/空态），attach 当前目录；清掉“用户已关闭”的隐式状态。
- `handleEvent`：status 用 `applyTerminalEvent`；hostkey/prompt 设置信号并排队；data 忽略（TerminalView 自己订阅）。
- `closeTab`：本地 `api.sessions.close`（detach）+ 移除；SSH `close` + 移除；更新 active；persist。
- `killLocal`：`api.sessions.kill` + 移除。
- `TerminalSurface`：session tab bar（`For`）、`TerminalView`、`TerminalHostDrawer`、`SshHostDialog`、`HostKeyDialog`、`TerminalPromptDialog`、`TerminalStatusBar`；`createEffect` 调 `setVisible(props.active)` 和 `ensureLocal(props.directory)`；`+` 菜单（`DropdownMenu`）含「本地终端 / 新建 SSH 连接 / 主机列表」；Esc 关闭抽屉/对话框。
- 空态：无会话时用 `DockEmpty` + 「新建 SSH 连接」「打开本地终端」；本地能力不可用时本地 tab 显示降级 banner + 外部终端按钮。
- tab 溢出：`⋯` 菜单列出全部会话（点击激活）；tab 条支持横向滚动。
- tab 键盘：ArrowLeft/Right/Home/End 切换，roving tabindex（沿用工作台 tab 模式）。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/terminal/terminal-store.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/terminal/terminal-store* packages/desktop/src/renderer/mafw/components/TerminalSurface.tsx packages/desktop/tests/terminal-surface-wiring.test.ts
git commit -m "feat(desktop): terminal surface with session tabs and host management"
```

---

### Task 13: 工作台接线（L2 终端、删除底条、Ctrl+`、CSS）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Delete: `packages/desktop/src/renderer/mafw/components/TerminalDock.tsx`
- Modify tests: `tests/workbench-shell-wiring.test.ts`, `tests/workbench-shell-css.test.ts`, `tests/terminal-scoping.test.ts`, `tests/rw-active-fill.test.ts`, `tests/design-contract.test.ts`, `tests/workbench-wiring.test.ts`, `src/renderer/mafw/workbench-views.test.ts`

**Interfaces:**
- `WorkbenchShell` props 删除 `terminalOpen` / `onToggleTerminal`；不再渲染底部 `.mafw-rw-terminal`。
- `WorkbenchCodeView` 增加 `TerminalSurface` pane（常挂载，`display: contents/none`）。
- `MafwShell` 删除 `workbenchTerminalOpen` / `toggleWorkbenchTerminal` / `mafw-workbench-terminal`；新增 `previousSurface` signal；Ctrl+` 用 `terminalSurfaceHotkeyAction`。
- `WorkbenchShell` L2 使用 updated `WORKBENCH_SURFACES`；终端 icon `terminal`。

- [ ] **Step 1: 写失败测试**

```ts
// workbench-views.test.ts
test("terminal is now the third visible L2 surface", () => {
  assert.deepEqual(WORKBENCH_SURFACES.map((s) => s.label), ["文件", "浏览器", "终端"])
  assert.equal(nextWorkbenchSurface("browser", "ArrowRight"), "terminal")
  assert.equal(nextWorkbenchSurface("terminal", "ArrowRight"), null)
})

// workbench-shell-wiring.test.ts
test("workbench renders TerminalSurface and no bottom TerminalDock", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  const code = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
  assert.doesNotMatch(shell, /TerminalDock/)
  assert.doesNotMatch(shell, /mafw-rw-terminal/)
  assert.match(code, /TerminalSurface/)
})

// terminal-scoping.test.ts（改写）
test("Ctrl+` uses surface state, not bottom strip", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /terminalSurfaceHotkeyAction/)
  assert.doesNotMatch(src, /mafw-workbench-terminal/)
  assert.doesNotMatch(src, /workbenchTerminalOpen/)
})

// workbench-shell-css.test.ts
test("bottom strip css is gone; terminal surface css exists", () => {
  assert.doesNotMatch(css, /\.mafw-rw-terminal\b/)
  assert.match(css, /\.mafw-terminal-surface\b/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-shell-wiring.test.ts tests/terminal-scoping.test.ts tests/workbench-shell-css.test.ts`
Expected: FAIL（仍引用 TerminalDock/底条）

- [ ] **Step 3: 实现**

- `WorkbenchShell`：删除底条 JSX、`terminalOpen`/`onToggleTerminal` props、L1 终端开关；`WORKBENCH_SURFACES` 加入 `{ id: "terminal", label: "终端" }`，L2 自动显示终端。
- `WorkbenchCodeView`：新增 `active: boolean`（工作台 pane 可见）prop；在 browser pane 后加 `<div class="mafw-rw-code-pane" style={{ display: props.surface === "terminal" ? "contents" : "none" }}><TerminalSurface directory={props.sessionDirectory} active={props.active && props.surface === "terminal"} /></div>`；文件树只在 code surface 渲染。`WorkbenchShell` 传 `active={props.open && props.view === "workbench"}`。
- `MafwShell`：
  - 删除 terminalOpen signal/localStorage/toggle。
  - 加 `previousSurface` signal（默认 `"code"`）；`applyWorkbenchSurface` 切到 terminal 前记录当前非 terminal surface。
  - Ctrl+` capture handler 调 `terminalSurfaceHotkeyAction`，然后 `setRightDockOpen(true)`、`applyWorkbenchView("workbench")`、`applyWorkbenchSurface(action.surface)`。
- `mafw.css`：新增 `.mafw-terminal-surface`（flex column, height 100%）、session bar、host drawer overlay、status bar、dialog 样式；删除 `.mafw-rw-terminal`/`.mafw-rw-terminal-toggle` 规则；`@container (max-width:599px)` 隐藏状态条右侧、tab 标题截断；`max-width:480px` 状态条隐藏、SSH 表单单列。
- 删除 `TerminalDock.tsx`；删除 `workbench-views.ts` 的旧 `terminalStripVisible`/`terminalHotkeyAction` 及对应测试；把 `terminal-view` 的旧 `viewFor`/`planAttach` 保留给本地降级路径。
- 更新所有字符串契约测试。

- [ ] **Step 4: 跑测试确认通过 + 全量 + 类型 + 构建**

Run: `cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build`
Expected: PASS / rc=0 / rc=0

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/desktop/tests
git commit -m "feat(desktop): move terminal to workbench l2 surface"
```

---

### Task 14: 打包依赖 + 全量验证 + GUI 冒烟 + 文档

**Files:**
- Modify: `packages/desktop/electron-builder.config.ts`（仅当 `ssh2` 需要 asarUnpack/extraResources；纯 JS 通常不需要）
- Modify: `AGENTS.md`（§5.5 新增 terminal surface/SSH 记录）
- Modify: `docs/superpowers/specs/2026-10-29-terminal-surface-ssh-design.md`（状态改「已交付」+ 实现 commit）
- Test: `packages/desktop/tests/terminal-packaging.test.ts`（断言 `package.json` dependencies 含 `ssh2`；构建产物含 `ssh2` 入口）

**Interfaces:**
- 无新代码接口；验证 `ssh2` 在 packaged app 可加载。

- [ ] **Step 1: 写失败测试**

```ts
test("ssh2 is a production dependency", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  assert.equal(typeof pkg.dependencies.ssh2, "string")
})
```

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/terminal-packaging.test.ts`
Expected: PASS（Task 4 已加依赖）；若失败，补 package.json。

- [ ] **Step 3: 全量门禁**

Run:
```bash
cd packages/desktop
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: 全部 rc=0。

- [ ] **Step 4: GUI 冒烟（手动）**

启动 `npm run dev`，逐项检查：

1. L2 `文件 / 浏览器 / 终端`；终端全高；底部条不存在。
2. 新建密码主机 → 指纹确认 → 连接；保存密码后重连无提示。
3. 新建密钥主机 → 口令保存/不保存两条路径。
4. 本地 + 2 个 SSH tab；切换保 scrollback；关闭本地 tab 后 `＋`→「本地终端」可重放；「结束终端」重开是新 shell。
5. 指纹变化 → 红色阻断、取消不连接、替换后 known_hosts 更新。
6. 跳板机连接目标；bastion 失败错误归因。
7. 断网/杀 sshd → 自动重连 1/2/4/8/16s，5 次后停；手动重连恢复。
8. 切换 worktree/项目：本地 tab 跟随；SSH tab 不变；终端隐藏时切目录不后台起 shell。
9. Ctrl+` 从文件切终端、再按回文件；dock 关闭时打开并进终端。
10. 重启 desktop：tab 恢复；终端 surface 首次可见才连接；有保存凭据的自动连接。
11. 日志/localStorage 无密码明文；secrets 文件为密文。

- [ ] **Step 5: 更新文档 + Commit**

- `AGENTS.md` §5.5 增加一段：终端 surface + SSH 会话、关键文件、测试计数、commit。
- spec 状态改为「已交付」，附实现 commit。
- 汇报：新增测试数量、全量通过数、typecheck/build rc、GUI 冒烟结果。

```bash
git add packages/desktop/tests/terminal-packaging.test.ts packages/desktop/electron-builder.config.ts AGENTS.md docs/superpowers/specs/2026-10-29-terminal-surface-ssh-design.md
git commit -m "docs(desktop): terminal surface and ssh session delivery notes"
```

---

## Self-Review Notes

- **Spec coverage:** §2 决策 → Task 1/12/13；§4 UI → Task 10-13；§5 会话模型 → Task 2/7/8/12；§6 SSH → Task 3-6；§7 IPC → Task 9；§8 schema → Task 2/3；§9 接线 → Task 13；§10 验收 → Task 14。
- **Review Focus tests:** 自动重连遇指纹变化（Task 5）、人工输入超 30s（Task 4/5）、隐藏切目录（Task 8/12）、safeStorage 失败（Task 3/9）、同主机多会话（Task 8/12）。
- **Type consistency:** `TerminalSessionInfo`/`SshHostProfile`/`TerminalEvent` 在 Task 2 定义，后续任务复用；`localSessionId`/`dirKey` 单源 shared；`sessionView`/`buildTerminalMenu` 在 Task 10 扩展。
- **Known sequencing:** Task 7 暂时保留旧 `terminal-bridge` 入口，Task 9 替换；Task 1 暂时保留旧 `terminalStripVisible`，Task 13 删除。中间任务必须保持 `npm test` 绿。
