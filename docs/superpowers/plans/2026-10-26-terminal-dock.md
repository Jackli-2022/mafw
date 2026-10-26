# Terminal Dock（内嵌终端，不共享）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** desktop 右 dock 新增「终端」tab——跟随目录的 persistent 用户终端（serve 托管 PTY），不共享给 agent。

**Architecture:** gateway **零改动**（2026-10-26 live 实证：兜底反代已注入 serve Basic，`/api/pty` 全链路经 :3000 可用）。desktop main 新建 terminal-bridge（每目录一条 WS，fanout 到订阅窗口）；renderer 新增 TerminalDock（xterm.js）。

**Tech Stack:** Electron main（Node ≥22 全局 WebSocket/fetch）、@xterm/xterm + @xterm/addon-fit、SolidJS、@mafw/ui v2 组件。

**Spec:** `docs/superpowers/specs/2026-10-26-terminal-dock-design.md`

## Global Constraints

- TDD：每任务先写失败测试再实现；每任务一 commit；提交信息沿用仓库风格（`feat(desktop): ...`）。
- desktop 测试命令（`packages/desktop` 下）：`npm test`；单文件：`node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`；typecheck `npx tsgo -b`；构建 `npx electron-vite build`。
- 纯逻辑模块与 src 同目录 `.test.ts`（desktop AGENTS.md）；Electron import 只允许出现在 glue 文件。
- renderer 只经 `window.api`（`src/preload`）调能力；main 的 IPC 注册链根在 `src/main/ipc.ts`（`registerMafwIpcHandlers` 在 `mafw-ipc.ts`）。
- UI 禁裸 `<button>`/`<input>`/裸 `title`：用 ButtonV2/LoaderV2/TooltipV2（AGENTS.md §5.10）。
- Wire 契约（2026-10-26 live 实证，serve 2.1.0，全部经 gateway :3000 兜底反代）：create `POST /api/pty?directory=<dir>` body `{command, cwd, title, size{cols,rows}}`（响应信封 `{location, data}`）；token `POST /api/pty/{id}/connect-token?directory=<dir>` 头 `x-opencode-ticket: 1`（`{ticket, expires_in:60}`）；WS `ws://<serve>/api/pty/{id}/connect?ticket=<t>`（入站=原始文本即 stdin；出站=原始文本 + `0x00`+JSON `{cursor}` meta 帧）；resize `PUT /api/pty/{id}?directory=` body `{size{cols,rows}}`；delete `DELETE /api/pty/{id}?directory=`（204，再 GET 404）。
- **Enter = `\r`**（xterm 默认输出即 `\r`，**禁止翻译成 `\n`**——上游 PR #23794 review 实证 PowerShell PSReadLine 把裸 `\n` 当续行）。
- serve 重启杀全部 PTY（「终端已随服务重启关闭」语义，spec §3）。
- 仅 opencode runtime + `capabilities.persistentPty===true` 启用；pi/其他 → 降级提示。

## Review Focus

1. **WS 二进制帧形态**：Electron main 的全局 WebSocket 默认把二进制帧给 `Blob`——必须 `binaryType="arraybuffer"` 并按首字节 `0x00` 判 meta 帧；把文本帧当 Buffer 处理会静默丢输出。→ Task 1 `parseMetaFrame` 测试钉扎。
2. **serve 重启后 PTY 全灭**：attach/list 收到 404 必须落 `gone` 态（「重新打开」），不得无限 reconnect。→ Task 2 ops 测试 + Task 4 view 测试。
3. **dock tab 切换组件保持挂载**（MafwShell `display:contents/none` 惯例）：xterm 实例不随隐藏销毁；重新显示时 fit 一次。→ Task 4 实现要求（不藏就销毁会违背 persistent 语义）。
4. **ticket 一次性 + 60s TTL**：每次 attach 现取现用，禁止缓存复用 ticket。→ Task 2 测试钉扎（attach 内先取 token 再开 WS）。
5. **输入透传**：renderer→main→WS 全链不许改字节（尤其 `\r`）。→ Task 1 input 恒等测试。

---

### Task 1: xterm 依赖 + terminal-core 纯模块

**Files:**
- Modify: `packages/desktop/package.json`（dependencies 加 `@xterm/xterm`、`@xterm/addon-fit`，最新兼容对）
- Create: `packages/desktop/src/main/terminal/terminal-core.ts`
- Test: `packages/desktop/src/main/terminal/terminal-core.test.ts`

**Interfaces:**
- Produces（Task 2/3 消费）：
  - `unwrapData(json: any): any`（`json.data ?? json`）
  - `pickActivePty(list: any[]): { id: string } | null`（滤 `status==="running"`，取数组末位）
  - `parseMetaFrame(data: ArrayBuffer | string): { cursor: number } | null`（ArrayBuffer 且首字节 0x00 → JSON.parse 剩余；否则 null）
  - `type ConnState = "idle" | "probing" | "live" | "closed" | "gone" | "unavailable"`
  - `nextConnState(s: ConnState, ev: "attachOk" | "wsClosed" | "ptyGone" | "probeFail" | "retry"): ConnState`
  - `encodeInput(data: string): string`（恒等透传；注释钉 `\r` 契约）

- [ ] **Step 1: 装依赖**

Run: `cd packages/desktop && npm install @xterm/xterm @xterm/addon-fit`
Expected: package.json dependencies 出现两个包；`npm test` 现存用例不受影响。

- [ ] **Step 2: 写失败测试** `terminal-core.test.ts`

```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { unwrapData, pickActivePty, parseMetaFrame, nextConnState, encodeInput } from "./terminal-core"

describe("terminal-core", () => {
  test("unwrapData 解 {location,data} 信封，裸对象原样", () => {
    assert.equal(unwrapData({ location: {}, data: { id: "p1" } }).id, "p1")
    assert.equal(unwrapData({ id: "p2" }).id, "p2")
  })
  test("pickActivePty 取最后一个 running；全死返回 null", () => {
    const l = [{ id: "a", status: "exited" }, { id: "b", status: "running" }, { id: "c", status: "running" }]
    assert.equal(pickActivePty(l)?.id, "c")
    assert.equal(pickActivePty([{ id: "a", status: "exited" }]), null)
    assert.equal(pickActivePty([]), null)
  })
  test("parseMetaFrame：0x00 前缀二进制 → cursor；文本/普通二进制 → null", () => {
    const payload = new TextEncoder().encode('\0{"cursor":1234}')
    assert.deepEqual(parseMetaFrame(payload.buffer), { cursor: 1234 })
    assert.equal(parseMetaFrame("hello"), null)
    assert.equal(parseMetaFrame(new TextEncoder().encode("plain").buffer), null)
  })
  test("nextConnState：attachOk→live；wsClosed→closed；ptyGone→gone；probeFail→unavailable；retry 从 closed/gone 回 probing", () => {
    assert.equal(nextConnState("probing", "attachOk"), "live")
    assert.equal(nextConnState("live", "wsClosed"), "closed")
    assert.equal(nextConnState("live", "ptyGone"), "gone")
    assert.equal(nextConnState("probing", "probeFail"), "unavailable")
    assert.equal(nextConnState("closed", "retry"), "probing")
    assert.equal(nextConnState("gone", "retry"), "probing")
  })
  test("encodeInput 恒等透传（\\r 不改 \\n）", () => {
    assert.equal(encodeInput("echo hi\r"), "echo hi\r")
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/terminal/terminal-core.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 terminal-core.ts**

按上面签名逐个实现（纯函数，无 Electron/Node-only import，20 行内）。

- [ ] **Step 5: 跑测试确认通过 + 全量不破**

Run: 单文件命令 PASS；`npm test` 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/package.json packages/desktop/package-lock.json packages/desktop/src/main/terminal/
git commit -m "feat(desktop): terminal-core pure module + xterm deps"
```

---

### Task 2: terminal-bridge（main 进程，deps 注入可测）

**Files:**
- Create: `packages/desktop/src/main/terminal/terminal-bridge.ts`
- Test: `packages/desktop/src/main/terminal/terminal-bridge.test.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`（`registerMafwIpcHandlers` 内加一行 `installTerminalBridge(ipcMain, { gatewayPort: getGatewayPort })`）

**Interfaces:**
- Consumes: Task 1 的 `unwrapData/pickActivePty/parseMetaFrame/nextConnState`；`getGatewayPort`（`../mafw-sidecar`）。
- Produces（Task 3 preload 消费）IPC 通道：
  - `mafw-terminal-probe` → `{ available: boolean, serveUrl?: string, reason?: string }`
  - `mafw-terminal-attach` `{ directory: string }` → `{ ptyId: string }`（目录无活终端则创建：默认 `cmd.exe`/`powershell.exe` 由 serve 决定——body 不传 command，只传 `cwd/title/size`）
  - `mafw-terminal-input` `{ directory, data: string }`、`mafw-terminal-resize` `{ directory, cols, rows }`、`mafw-terminal-kill` `{ directory }`
  - main→renderer 推送通道 `mafw-terminal-event`：`{ directory, type: "data" | "closed" | "gone", data?: string }`
- 核心形态：`createTerminalOps(deps)`（deps: `{ gatewayBase(): string, fetchImpl?, wsFactory? }`）——每目录一条 WS + `subscribers: Set<WebContents>` fanout；`installTerminalBridge(ipcMain, deps)` 只是 `ipcMain.handle` 薄注册。
- 内部规则：attach 流程 = list→pickActivePty→（无则 create）→ **现取 connect-token**（头 `x-opencode-ticket: 1`）→ wsFactory 开 WS（`binaryType="arraybuffer"`）；WS message：meta 帧更新 cursor，文本帧 fanout `data`；WS close → fanout `closed`；attach/list 404 → fanout `gone` + 清注册表。detach 不做显式通道（组件常挂载），kill 才 DELETE。

- [ ] **Step 1: 写失败测试** `terminal-bridge.test.ts`（fake fetch + fake ws，不碰 Electron）

```ts
// FakeFetch：路由表 (method,url正则)→响应；FakeWS：onmessage/onopen/onclose + send 记录 + close() 触发 onclose
// 断言点：
// 1. probe()：/api/info 返回 capabilities.persistentPty:true → {available:true, serveUrl:"http://127.0.0.1:4096"}；false/缺 → available:false
// 2. attach 目录无终端 → 先 POST /api/pty 创建（body 含 cwd，不含 command）→ 再 POST connect-token（头 x-opencode-ticket:"1"）→ 再开 WS（url 含 ticket= 且 origin = serveUrl 的 ws 形态）
// 3. attach 目录已有 running → 不创建，直接 token+WS（fetch 调用序列断言）
// 4. token 每次 attach 现取（连 attach 两次 → connect-token 被调两次）
// 5. WS 文本帧 → 该目录两个 subscriber 都收到 {type:"data"}；0x00 meta 帧不 fanout、只更新 cursor
// 6. WS onclose → fanout {type:"closed"}；list/attach 收到 404 → fanout {type:"gone"}
// 7. input/resize/kill → 分别走 ws.send(data 原样) / PUT size / DELETE
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 `createTerminalOps` + `installTerminalBridge`**

注册表 `Map<directory, { ptyId, ws, cursor, subscribers }>`；Electron 侧 `wsFactory` 默认用全局 `WebSocket`（Electron 42 的 Node ≥22 自带）；所有 HTTP 走 `gatewayBase()` = `http://127.0.0.1:${getGatewayPort()}`。

- [ ] **Step 4: 跑测试确认通过 + `npx tsgo -b` rc=0**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal/ packages/desktop/src/main/mafw-ipc.ts
git commit -m "feat(desktop): terminal bridge in main (per-directory WS, gateway-proxied pty ops)"
```

---

### Task 3: preload 命名空间 + 外部终端出口

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`（mafw 命名空间内加 `terminal`）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（镜像类型）
- Modify: `packages/desktop/src/main/terminal/terminal-core.ts`（加 `externalTerminalCommand(dir, platform)` 纯函数）
- Test: `packages/desktop/src/main/terminal/terminal-core.test.ts`（补该函数用例）
- Modify: `packages/desktop/src/main/terminal/terminal-bridge.ts`（`mafw-terminal-open-external` handler）

**Interfaces:**
- Produces（Task 4 renderer 消费）`window.api.mafw.terminal`：
  - `probe(): Promise<{available: boolean, serveUrl?: string, reason?: string}>`
  - `attach(directory: string): Promise<{ptyId: string}>`
  - `input(directory: string, data: string): Promise<void>`
  - `resize(directory: string, cols: number, rows: number): Promise<void>`
  - `kill(directory: string): Promise<void>`
  - `onEvent(cb: (ev: {directory: string, type: "data"|"closed"|"gone", data?: string}) => void): () => void`（返回退订函数；`ipcRenderer.on`/`removeListener` 先例见 mafw-api.ts 的 `mafw-gateway-health`）
  - `openExternal(directory: string): Promise<void>`
- `externalTerminalCommand(dir, platform)`：win32 → `{cmd: "wt.exe", args: ["-d", dir]}`（fallback `{cmd: "cmd.exe", args: ["/c", "start", "cmd"], cwd: dir}`）；darwin → `open -a Terminal <dir>`；linux → `x-terminal-emulator`（builder 微调）。

- [ ] **Step 1: 写失败测试**（terminal-core.test.ts 追加 `externalTerminalCommand` win32/darwin/linux 三例）

- [ ] **Step 2: 跑确认失败 → 实现纯函数 → 跑确认通过**

- [ ] **Step 3: 实现 preload `terminal` 命名空间 + mafw-types.ts 镜像 + bridge 的 open-external handler（`child_process.spawn` detached + `windowsHide:true`，失败回退 cmd start）**

- [ ] **Step 4: `npx tsgo -b` rc=0 + `npm test` 全绿**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/preload/ packages/desktop/src/main/terminal/
git commit -m "feat(desktop): terminal preload namespace + external terminal fallback"
```

---

### Task 4: renderer TerminalDock + dock 接线

**Files:**
- Create: `packages/desktop/src/renderer/mafw/terminal/terminal-view.ts`（纯 view model）
- Test: `packages/desktop/src/renderer/mafw/terminal/terminal-view.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/TerminalDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/dock-tab.ts`（DOCK_TABS 加 `"terminal"`）
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`（browser 之后加 `<TabsV2.Trigger value="terminal">&gt;_ 终端</TabsV2.Trigger>`）
- Modify: `packages/desktop/src/renderer/mafw/dock-width.ts`（WORKBENCH_TABS 加 `"terminal"`）+ 其测试
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（browser div 块之后加 terminal 块：`<div style={{ display: rightDockTab() === "terminal" ? "contents" : "none" }}><TerminalDock directory={benchRoot()} /></div>`）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-terminal-*` 样式，token 用 mafw 变量）

**Interfaces:**
- Consumes: Task 3 的 `window.api.mafw.terminal.*`；`benchRoot()`（MafwShell 既有 accessor，EditorDock 同款目录来源）。
- Produces：
  - `type ViewState = { kind: ConnState, banner?: string }`；`viewFor(s: ConnState): ViewState`（closed→「终端已断开」+重新连接；gone→「终端已随服务重启关闭」+重新打开；unavailable→「当前环境不支持内嵌终端」+打开外部终端；probing→LoaderV2）
  - `TerminalDock(props: { directory: string | null })`

- TerminalDock 行为要求（spec §3/§8）：
  - mount/directory 变化 → probe → attach；xterm + FitAddon 挂载；`term.onData(d => terminal.input(directory, d))`；`terminal.onEvent` 中本目录事件：`data`→`term.write(data)`，`closed/gone`→置 ViewState
  - **attach 前 `term.reset()`**（serve 会自动 replay 缓冲，重置防重影）
  - ResizeObserver → `fit()` → `terminal.resize(directory, cols, rows)`；tab 从隐藏变显示时 fit 一次（组件常挂载，不随隐藏销毁）
  - 「结束终端」按钮（ButtonV2 ghost，右上）→ 两步确认（先武装再执行，B3 checkpoint 先例）→ `terminal.kill(directory)`
  - banner 按钮：重新连接（closed）= retry→attach；重新打开（gone）= kill 语义免了，直接 attach（create 分支）；打开外部终端（unavailable）= `openExternal(directory)`
  - `directory` 为 null（无活动会话）→ 空态文案「打开一个会话后此处可用终端」

- [ ] **Step 1: 写失败测试** `terminal-view.test.ts`（`viewFor` 六态映射 + banner 文案钉扎）

- [ ] **Step 2: 跑确认失败 → 实现 terminal-view.ts → 跑确认通过**

- [ ] **Step 3: 实现 TerminalDock.tsx + 接线四处（dock-tab/RightDock/dock-width/MafwShell）+ CSS**

- [ ] **Step 4: `npm test` 全绿 + `npx tsgo -b` rc=0 + `npx electron-vite build` 成功**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/ packages/desktop/src/main/terminal/
git commit -m "feat(desktop): TerminalDock — directory-scoped persistent terminal in right dock"
```

---

### Task 5: 收尾门禁 + 文档

**Files:**
- Modify: `AGENTS.md`（§5.5 Workbench 条目：terminal 以「不共享用户终端」形态交付，T1 共享 HOLD 由本 spec descope，解冻路径指向 spec §7）

- [ ] **Step 1: 全量门禁**

Run: `cd packages/desktop && npm test`（全绿，记录通过数）；`npx tsgo -b`（rc=0）；`npx electron-vite build`（成功）。
gateway 零改动，不跑 gateway 套件（本批无 gateway 代码）。

- [ ] **Step 2: AGENTS.md §5.5 补一段交付记录**（模式沿用既有条目：commit 列表 + 测试数 + 能力门 + persistent 边界）

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: record terminal dock delivery (non-shared user terminal; T1 sharing stays held)"
```

- [ ] **Step 4: GUI 冒烟（人工，列出待办）**——dev app 重启后逐项过：①dock 开「终端」tab 起真 shell（跑 `echo`/`git status`）②起常驻进程（如 dev server）→ close-to-tray → 重开窗口 → 终端活着、scrollback 接回 ③同目录切会话终端不变、切项目换终端 ④断网/重启 serve → 「已随服务重启关闭」→ 重新打开 ⑤「结束终端」两步确认后 DELETE 生效

## Self-Review 记录

- **Spec 覆盖**：§3 形态（Task 4）/§4 链路（Task 1-3）/§5 能力门（Task 2 probe + Task 4 view）/§6 Goals（Task 4 + Task 5 冒烟）/§8 验收 1-5（Task 5 冒烟清单）、6（probe/view 测试）、7（Task 5 全绿）——无缺口。
- **类型一致**：ConnState/ViewState/window.api.mafw.terminal 签名在 Task 1/3/4 间一致；IPC 通道名 Task 2 产、Task 3 消费一致。
- **比例**：5 任务对应 spec 11 节，代码块仅测试断言与接口签名。
