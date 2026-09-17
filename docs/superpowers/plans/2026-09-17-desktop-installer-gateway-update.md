# Desktop 安装包安装时更新全局 Gateway — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows NSIS 安装器在安装阶段检测全局 `@jack200714/mafw` CLI 版本，落后于安装包内置 gateway 版本时先停旧 daemon 再 `npm install -g` 更新（全路径 fail-open）。

**Architecture:** NSIS `customInstall` 宏经 nsExec 调打包进 `resources/gateway-update/` 的零依赖 CJS 脚本；脚本内拆纯函数（版本比较/决策/PID 守卫）+ 注入副作用（fs/exec），bun:test 单测。规格：`docs/superpowers/specs/2026-09-17-desktop-installer-gateway-update-design.md`。

**Tech Stack:** Node CJS 脚本、electron-builder NSIS（LogicLib/nsExec）、bun:test。

## Global Constraints

- 永不降级：仅当全局版本 < 内置版本才更新（spec §3 修正②）
- 全路径 fail-open：任何失败 exit 0，绝不阻塞安装（spec §5）
- 停 daemon 必须在 `npm install -g` 之前（Windows `better-sqlite3.node` 文件锁，spec §3 修正①）
- npm 超时 120s；脚本整体自限 ~150s（spec §7）
- PID 守卫：`tasklist` 校验目标镜像为 `node.exe`，防 PID 复用误杀（spec §5）
- PID 文件路径 `~/.config/mafw/gateway.pid`（`bin/mafw.js:11` 同源）
- 包名 `@jack200714/mafw`；win32 下 npm 以 `npm.cmd` 调用
- 每步日志逐行输出（NSIS nsExec 捕获进安装详情）
- 测试运行器：bun:test（desktop 既有约定，见 `src/main/mafw-pid-file.test.ts`）
- 版本真相源：内置 = `resources/gateway/package.json`（stage-gateway.ts 已写，勿改 stage 脚本）

---

### Task 1: 版本比较与决策纯函数

**Files:**
- Create: `packages/desktop/gateway-update/update-global-gateway.js`
- Create: `packages/desktop/gateway-update/update-global-gateway.test.ts`

**Interfaces:**
- Consumes: 无（零依赖 CJS）
- Produces（后续 Task 复用的精确签名）:
  - `readPkgVersion(fsMod, pkgPath: string): string | null`
  - `compareVersions(a: string, b: string): number`（<0 a<b；0 相等；>0 a>b）
  - `decide(bundled: string | null, global: string | null): 'skip' | 'update'`

- [ ] **Step 1: Write the failing test**

创建 `packages/desktop/gateway-update/update-global-gateway.test.ts`：

```typescript
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareVersions, decide, readPkgVersion } from "./update-global-gateway"

describe("compareVersions", () => {
  test("orders major/minor/patch", () => {
    expect(compareVersions("4.10.1", "4.9.9")).toBeGreaterThan(0)
    expect(compareVersions("4.10.0", "4.10.1")).toBeLessThan(0)
    expect(compareVersions("4.10.1", "4.10.1")).toBe(0)
  })
  test("missing segments equal zero", () => {
    expect(compareVersions("4.10", "4.10.0")).toBe(0)
  })
  test("non-numeric suffix does not crash", () => {
    expect(compareVersions("4.10.1-beta", "4.10.1")).toBe(0)
  })
})

describe("decide", () => {
  test("update only when global < bundled (never downgrade)", () => {
    expect(decide("4.10.1", "4.9.0")).toBe("update")
    expect(decide("4.10.1", "4.10.1")).toBe("skip")
    expect(decide("4.10.1", "4.11.0")).toBe("skip")
  })
  test("missing versions skip", () => {
    expect(decide(null, "4.9.0")).toBe("skip")
    expect(decide("4.10.1", null)).toBe("skip")
    expect(decide(null, null)).toBe("skip")
  })
})

describe("readPkgVersion", () => {
  test("reads version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pkg = join(dir, "package.json")
    writeFileSync(pkg, JSON.stringify({ name: "x", version: "4.10.1" }))
    expect(readPkgVersion(require("node:fs"), pkg)).toBe("4.10.1")
  })
  test("null on missing file or bad json or empty version", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    expect(readPkgVersion(require("node:fs"), join(dir, "absent.json"))).toBeNull()
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{oops")
    expect(readPkgVersion(require("node:fs"), bad)).toBeNull()
    const empty = join(dir, "empty.json")
    writeFileSync(empty, JSON.stringify({ name: "x" }))
    expect(readPkgVersion(require("node:fs"), empty)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: FAIL（模块不存在，Cannot find module）

- [ ] **Step 3: Write minimal implementation**

创建 `packages/desktop/gateway-update/update-global-gateway.js`：

```javascript
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const NPM_PACKAGE = "@jack200714/mafw"
const NPM_TIMEOUT_MS = 120000
const IS_WIN = process.platform === "win32"
const NPM_BIN = IS_WIN ? "npm.cmd" : "npm"

function readPkgVersion(fsMod, pkgPath) {
  try {
    const pkg = JSON.parse(fsMod.readFileSync(pkgPath, "utf-8"))
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function decide(bundled, global) {
  if (!bundled || !global) return "skip"
  return compareVersions(global, bundled) < 0 ? "update" : "skip"
}

module.exports = { NPM_PACKAGE, NPM_BIN, readPkgVersion, compareVersions, decide }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/gateway-update/
git commit -m "feat(desktop): gateway-update version compare + decision pure functions"
```

---

### Task 2: PID 守卫与停止 daemon 原语

**Files:**
- Modify: `packages/desktop/gateway-update/update-global-gateway.js`（追加函数与导出）
- Modify: `packages/desktop/gateway-update/update-global-gateway.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的导出（同文件追加）
- Produces:
  - `readPidFile(fsMod, pidPath: string): string | null`（仅纯数字 PID）
  - `pidImageName(exec, pid: string): string | null`（tasklist CSV 解析）
  - `shouldKill(imageName: string | null): boolean`（仅 `node.exe`）
  - `stopGatewayDaemon(deps): 'stopped' | 'not-running'`（deps: `{fs, pidFilePath, pidImageName, exec, sleep}`）

- [ ] **Step 1: Write the failing test**

在 `update-global-gateway.test.ts` 追加：

```typescript
import { readPidFile, shouldKill, stopGatewayDaemon } from "./update-global-gateway"

describe("readPidFile", () => {
  test("numeric pid only", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pidPath = join(dir, "gateway.pid")
    writeFileSync(pidPath, "4242\n")
    expect(readPidFile(require("node:fs"), pidPath)).toBe("4242")
    writeFileSync(pidPath, "not-a-pid")
    expect(readPidFile(require("node:fs"), pidPath)).toBeNull()
    expect(readPidFile(require("node:fs"), join(dir, "absent.pid"))).toBeNull()
  })
})

describe("shouldKill", () => {
  test("only node.exe image", () => {
    expect(shouldKill("node.exe")).toBe(true)
    expect(shouldKill("msedge.exe")).toBe(false)
    expect(shouldKill(null)).toBe(false)
  })
})

describe("stopGatewayDaemon", () => {
  function fakeDeps(pidContent, imageName, calls) {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pidPath = join(dir, "gateway.pid")
    if (pidContent !== null) writeFileSync(pidPath, pidContent)
    return {
      deps: {
        fs: require("node:fs"),
        pidFilePath: pidPath,
        pidImageName: (pid) => {
          calls.push(["image", pid])
          return imageName
        },
        exec: (cmd, args) => {
          calls.push([cmd, args])
          return ""
        },
        sleep: (ms) => calls.push(["sleep", ms]),
      },
      pidPath,
    }
  }

  test("kills when pid alive and image is node.exe", () => {
    const calls = []
    const { deps } = fakeDeps("4242", "node.exe", calls)
    expect(stopGatewayDaemon(deps)).toBe("stopped")
    expect(calls.some(([cmd]) => cmd === "taskkill")).toBe(true)
  })

  test("skips when image is not node.exe (pid reuse guard)", () => {
    const calls = []
    const { deps } = fakeDeps("4242", "msedge.exe", calls)
    expect(stopGatewayDaemon(deps)).toBe("not-running")
    expect(calls.some(([cmd]) => cmd === "taskkill")).toBe(false)
  })

  test("skips when pid file missing or dead process", () => {
    const calls = []
    const { deps } = fakeDeps(null, null, calls)
    expect(stopGatewayDaemon(deps)).toBe("not-running")
    const calls2 = []
    const { deps: deps2 } = fakeDeps("4242", null, calls2)
    expect(stopGatewayDaemon(deps2)).toBe("not-running")
    expect(calls2.some(([cmd]) => cmd === "taskkill")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: FAIL（readPidFile is not a function / undefined export）

- [ ] **Step 3: Write minimal implementation**

在 `update-global-gateway.js` 的 `module.exports` 之前追加：

```javascript
function readPidFile(fsMod, pidPath) {
  try {
    const raw = fsMod.readFileSync(pidPath, "utf-8").trim()
    return /^\d+$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

function pidImageName(exec, pid) {
  try {
    const out = exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 10000)
    const first = String(out).split(/\r?\n/).find((line) => line.trim().startsWith('"'))
    if (!first) return null
    return first.split('","')[0].replace(/^"/, "").toLowerCase() || null
  } catch {
    return null
  }
}

function shouldKill(imageName) {
  return imageName === "node.exe"
}

function stopGatewayDaemon(deps) {
  const pid = readPidFile(deps.fs, deps.pidFilePath)
  if (!pid) return "not-running"
  const image = deps.pidImageName(pid)
  if (!shouldKill(image)) return "not-running"
  try {
    deps.exec("taskkill", ["/F", "/T", "/PID", pid], 15000)
  } catch {
    return "not-running"
  }
  deps.sleep(1000)
  return "stopped"
}
```

`module.exports` 改为：

```javascript
module.exports = {
  NPM_PACKAGE,
  NPM_BIN,
  readPkgVersion,
  compareVersions,
  decide,
  readPidFile,
  pidImageName,
  shouldKill,
  stopGatewayDaemon,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: PASS（12 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/gateway-update/
git commit -m "feat(desktop): gateway-update pid guard + daemon stop primitive"
```

---

### Task 3: runUpdate 主流程编排

**Files:**
- Modify: `packages/desktop/gateway-update/update-global-gateway.js`（追加 defaultDeps + runUpdate + CLI 入口）
- Modify: `packages/desktop/gateway-update/update-global-gateway.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1/2 全部导出
- Produces: `runUpdate(deps): number`（恒 0；deps 形状见 defaultDeps）；CLI 入口 `require.main === module` 时执行

- [ ] **Step 1: Write the failing test**

在 `update-global-gateway.test.ts` 追加：

```typescript
import { runUpdate } from "./update-global-gateway"

describe("runUpdate", () => {
  const realFs = require("node:fs")
  function fixture(over = {}) {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-run-"))
    const bundledPkgPath = join(dir, "bundled", "gateway", "package.json")
    realFs.mkdirSync(join(dir, "bundled", "gateway"), { recursive: true })
    realFs.writeFileSync(bundledPkgPath, JSON.stringify({ version: "4.10.1" }))
    const pidPath = join(dir, "gateway.pid")
    const logs = []
    const deps = {
      fs: realFs,
      bundledPkgPath,
      pidFilePath: pidPath,
      exec: (cmd, args) => {
        if (cmd === "npm.cmd" && args[0] === "config") return "C:\\fake-prefix\n"
        logs.push([cmd, args])
        return ""
      },
      pidImageName: () => "node.exe",
      sleep: () => {},
      log: (line) => logs.push(line),
      ...over,
    }
    return { deps, logs, dir, pidPath }
  }

  test("skips when npm unusable", () => {
    const { deps, logs } = fixture({ exec: () => { throw new Error("spawn ENOENT") } })
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("skip: npm not usable"))).toBe(true)
  })

  test("skips when global package missing", () => {
    const { deps, logs } = fixture()
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("not installed globally"))).toBe(true)
  })

  test("skips when global >= bundled (never downgrade)", () => {
    const { deps, logs, dir } = fixture()
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.10.1" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("skip: global"))).toBe(true)
    expect(logs.some(([cmd, args]) => cmd === "npm.cmd" && args?.[0] === "install")).toBe(false)
  })

  test("stops daemon then installs when global < bundled", () => {
    const { deps, logs, dir, pidPath } = fixture()
    realFs.writeFileSync(pidPath, "4242")
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.9.0" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some(([cmd, args]) => cmd === "taskkill" && args.includes("4242"))).toBe(true)
    expect(logs.some(([cmd, args]) => cmd === "npm.cmd" && args[0] === "install" && args[2] === "@jack200714/mafw@4.10.1")).toBe(true)
  })

  test("npm failure leaves manual-fix log, exit 0", () => {
    const { deps, logs, dir } = fixture({
      exec: (cmd, args) => {
        if (cmd === "npm.cmd" && args[0] === "config") return "C:\\fake-prefix\n"
        if (cmd === "npm.cmd" && args[0] === "install") throw new Error("ETIMEDOUT")
        return ""
      },
    })
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.9.0" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("manual fix: npm install -g @jack200714/mafw@4.10.1"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: FAIL（runUpdate is not a function）

- [ ] **Step 3: Write minimal implementation**

在 `update-global-gateway.js` 的 `module.exports` 之前追加：

```javascript
function runUpdate(deps) {
  const log = deps.log
  const bundled = readPkgVersion(deps.fs, deps.bundledPkgPath)
  if (!bundled) {
    log("skip: bundled gateway version unreadable")
    return 0
  }

  let prefix
  try {
    prefix = String(deps.exec(NPM_BIN, ["config", "get", "prefix"], 15000)).trim()
  } catch (err) {
    log(`skip: npm not usable (${String(err.message).split("\n")[0]})`)
    return 0
  }
  if (!prefix) {
    log("skip: npm prefix empty")
    return 0
  }

  const globalPkgPath = path.join(prefix, "node_modules", ...NPM_PACKAGE.split("/"), "package.json")
  const global = readPkgVersion(deps.fs, globalPkgPath)
  if (!global) {
    log(`skip: ${NPM_PACKAGE} not installed globally — desktop will use bundled gateway`)
    return 0
  }

  if (decide(bundled, global) === "skip") {
    log(`skip: global ${global} >= bundled ${bundled}`)
    return 0
  }

  log(`gateway update: global ${global} < bundled ${bundled}`)
  log(`daemon: ${stopGatewayDaemon(deps)}`)

  try {
    deps.exec(NPM_BIN, ["install", "-g", `${NPM_PACKAGE}@${bundled}`], NPM_TIMEOUT_MS)
    log(`ok: ${NPM_PACKAGE}@${bundled} installed globally; daemon stays stopped until next desktop launch`)
  } catch (err) {
    log(`fail: npm install -g failed (${String(err.message).split("\n")[0]})`)
    log(`manual fix: npm install -g ${NPM_PACKAGE}@${bundled}`)
  }
  return 0
}

function defaultDeps() {
  const run = (cmd, args, timeoutMs) =>
    execFileSync(cmd, args, { timeout: timeoutMs, encoding: "utf-8", windowsHide: true })
  return {
    fs,
    bundledPkgPath: path.join(__dirname, "..", "gateway", "package.json"),
    pidFilePath: path.join(os.homedir(), ".config", "mafw", "gateway.pid"),
    exec: run,
    pidImageName: (pid) => pidImageName(run, pid),
    sleep: (ms) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    },
    log: (line) => console.log(`[gateway-update] ${line}`),
  }
}

if (require.main === module) {
  try {
    process.exit(runUpdate(defaultDeps()))
  } catch (err) {
    console.log(`[gateway-update] fail: unexpected (${err.message})`)
    process.exit(0)
  }
}
```

`module.exports` 改为：

```javascript
module.exports = {
  NPM_PACKAGE,
  NPM_BIN,
  readPkgVersion,
  compareVersions,
  decide,
  readPidFile,
  pidImageName,
  shouldKill,
  stopGatewayDaemon,
  runUpdate,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop; bun test gateway-update/update-global-gateway.test.ts`
Expected: PASS（17 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/gateway-update/
git commit -m "feat(desktop): gateway-update orchestration (stop daemon -> npm install -g, fail-open)"
```

---

### Task 4: NSIS 钩子与 electron-builder 接线

**Files:**
- Create: `packages/desktop/resources/installer.nsh`
- Modify: `packages/desktop/electron-builder.config.ts`（extraResources 追加 + nsis.include）

**Interfaces:**
- Consumes: Task 3 的脚本（安装后在 `<INSTALLDIR>\resources\gateway-update\update-global-gateway.js`）
- Produces: 安装器在 customInstall 阶段执行更新脚本；`resources/gateway-update/` 随 extraResources 落盘

- [ ] **Step 1: Create `packages/desktop/resources/installer.nsh`**

```nsh
!macro customInstall
  ; Best-effort global gateway update (see docs/superpowers/specs/2026-09-17-desktop-installer-gateway-update-design.md).
  ; The script is fail-open: every failure path exits 0 and never blocks installation.
  nsExec::ExecToStack 'node --version'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog 'node "$INSTDIR\resources\gateway-update\update-global-gateway.js"'
    Pop $0
  ${EndIf}
!macroend
```

- [ ] **Step 2: Modify `packages/desktop/electron-builder.config.ts`**

`extraResources` 数组（`gateway-bundle/node_modules/` 条目之后）追加：

```typescript
  // Installer-time global gateway update script (NSIS customInstall runs it
  // via node). Test file stays out of the shipped payload.
  {
    from: "gateway-update/",
    to: "gateway-update/",
    filter: ["update-global-gateway.js"],
  },
```

`nsis` 块追加 `include`（`packageDir` 变量文件顶部已存在）：

```typescript
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    include: path.join(packageDir, "resources", "installer.nsh"),
  },
```

- [ ] **Step 3: Verify config loads**

Run: `cd packages/desktop; bun -e "const c = (await import('./electron-builder.config.ts')).default; if (!c.extraResources.some(e => e.to === 'gateway-update/')) throw new Error('gateway-update entry missing'); if (!c.nsis.include.endsWith('installer.nsh')) throw new Error('nsis.include missing'); console.log('config ok')"`
Expected: `config ok`

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/resources/installer.nsh packages/desktop/electron-builder.config.ts
git commit -m "feat(desktop): NSIS customInstall hook wiring for installer-time gateway update"
```

---

### Task 5: 打包冒烟与手动矩阵

**Files:**
- 无新文件（验证任务）

**Interfaces:**
- Consumes: Task 1-4 全部产物

- [ ] **Step 1: Build + stage + package（Windows）**

```bash
npm run build
cd packages/desktop
bun ./scripts/stage-gateway.ts
npx electron-builder --win --config electron-builder.config.ts
```

Expected: `dist/mafw-desktop-win32-x64.exe` 生成，无 NSIS 报错（nsExec/LogicLib 语法错误会在此暴露）。

- [ ] **Step 2: 本机手动矩阵（安装器在开发机上直接跑）**

1. 全局落后 + daemon 运行中（当前开发机即此状态的前提被本会话更新破坏，可先 `npm install -g @jack200714/mafw@4.9.9` 造旧）→ 安装详情里出现 `[gateway-update]` 行：先 `daemon: stopped` 后 `ok: ... installed globally`；装完 `mafw version` 显示新版、daemon 已停
2. 全局 = bundled → `[gateway-update] skip: global ...`，daemon 不受影响
3. 未装全局 CLI 的干净机器（或临时改 prefix）→ `skip: ... not installed globally`
4. 断网 → 安装完成，日志含 `manual fix: npm install -g @jack200714/mafw@<version>`

- [ ] **Step 3: 记录结果并汇报**

向用户汇报：新增测试数（Task 1-3 合计 21）、全量通过数、冒烟矩阵通过项。

- [ ] **Step 4: Commit（如有安装器微调）**

```bash
git add -A packages/desktop
git commit -m "chore(desktop): installer gateway-update smoke fixes"
```
