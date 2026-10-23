# Workbench 二期 wire 实证（Task 0，Go/No-Go）

> 日期：2026-10-22/23 · 环境：opencode **2.1.0**（`/api/info` → `capabilities.persistentPty: true`，pid 18284）+ MAFW gateway :3000（`serveRunning: true`）
> 方法：直连 4096（Basic auth，密码取自 gateway 日志 `server password` 行）+ v2.1.0 源码钉扎（GitHub `dev` 分支）+ live WS 探测

## 0. 结论（Go/No-Go）

**NO-GO**：persistent PTY 是**用户终端**基础设施（TUI/GUI 用户侧创建、attach、读写），**agent 的 shell 工具不落会话 PTY**——`packages/core/src/tool/plugin/shell.ts` 零 pty 引用，核心工具表无 terminal 工具，TUI `session-terminals` 仅在用户点「New terminal」时 `persistentPty.create`；anomalyco/opencode#23449（agent 使用集成终端）仍是 roadmap。

按 spec §3.3 拍板结果：**T1（terminal）整块 hold，不上假共享**；B1（浏览器）+ A1（批注草稿）照常交付。本文件同时作为未来 T1 解冻时的 wire 契约基线。

## 1. 鉴权与 connect-token

- serve 要求 `Authorization: Basic base64("opencode:<password>")`；密码来自 serve 启动输出 `server password <pwd>`（gateway 已解析并写日志）。
- **connect-token 的 403 根因**：除鉴权外还要求
  - 请求头 **`x-opencode-ticket: 1`**（防跨站铸票的 CORS 预检触发器）
  - Origin 允许：无 Origin（Node 客户端）放行；`http://localhost:*` / `http://127.0.0.1:*` / `oc://renderer` / tauri / `*.opencode.ai` 放行（`server/src/cors.ts`）
  - 实测：不带该头 → `403 {"_tag":"ForbiddenError","message":"Invalid PTY connect token request"}`；带上 → 200 `{ticket, expires_in: 60}`
- ticket 一次性、60s TTL，绑定 `{target, directory, workspaceID}`（`core/src/pty/ticket.ts`），WS upgrade 时 consume。

## 2. `pty` 组（通用，location-scoped）

- 响应信封：`{location:{directory}, data}`；`POST /api/pty` body `{command, args, cwd, title, size{cols,rows}}`（`Pty.CreateInput`；cwd 缺省 = location 目录）
- 实测：`POST /api/pty`（powershell.exe）→ 200 + `{id: pty_…, status:"running", pid}`；`PUT /{id}` resize 200；`DELETE /{id}` 204；再 GET 404
- **WS 协议（`core/src/pty/protocol.ts`）**：
  - 出站：**原始 UTF-8 文本块**（stdout 字节）；唯一控制帧 = `0x00` + UTF-8 JSON `{"cursor":<absolute offset>}`（replay 后发送）
  - 入站：**原始文本 = stdin**（无 JSON 信封）；无效 UTF-8 丢弃
  - replay 分块 ≤64KB；close 4404 = session not found / exited
  - 实测帧：`[bin 13]`（meta frame）→ 终端初始化转义序列 → `PS C:\…> ` → 输入回显

## 3. `persistentPty` 组（session 绑定）

- `GET /api/experimental/session/{sid}/terminal` → **数组** `{data: PersistentPty.Info[]}`（注意：非单对象）
- `POST` 同路由 body `PersistentPty.CreateInput {command?, args, cwd?, title, env, size?}`；**实测不传 cwd 时终端落在 serve 的默认根（C:\），必须显式传会话目录**
- `PersistentPty.Info` = `{id, title, command, args[], cwd, status, pid, sessionID, foregroundProcess, size{cols,rows}, output{head,tail}}`（`output` 为绝对字节偏移游标）
- `GET .../terminal/read?lines=` → `ReadResult | null`：只读窥探「最近被控制的终端」；**未被 attach 过时返回 null**（实测新终端 read = null）
- `GET .../persistent-pty/{id}/snapshot` → `{info, text, checkpoint(base64), cursor{x,y}}`（权威屏幕快照，用于重连/跨端恢复）
- `POST .../connect-token`（同样要 `x-opencode-ticket: 1`）→ `{ticket, expires_in}`
- `GET .../persistent-pty/{id}/connect` 查询参数（官方客户端 `client/src/solid/pty.ts` 实证）：
  `ticket`、`cursor`（起始字节偏移，默认 0）、`attachment_id`（缺省随机 UUID）、`takeover=true|false`、`input_protocol=1`（帧化输入）、`role=controller|observer`
- **WS 帧（`server/src/handlers/persistent-pty.ts`）**：
  - 首帧 JSON `{"type":"attached", attachmentID, inputProtocol, info, role, generation, replay:{requestedOffset,availableOffset,endOffset,truncated}}`
  - replay 原始文本 → `{"type":"replay_complete", endOffset}` → `{"type":"controller_changed",…}` / `{"type":"title_changed",…}` / `resized`（含 base64 checkpoint）
  - 实时输出 = 原始文本帧（`event.type === "output"` 直接下发 data）
  - **帧化输入**（`input_protocol=1`）：二进制 `[type u8][cols u16 BE][rows u16 BE][payload…]`；type 0 = 控制/ resize（payload 空），type 1 = 输入（payload = 键盘字节）
  - 非帧化输入：文本帧即 stdin（**无法 resize**——cols/rows 取 attachment.info.size）
- 生命周期：`shutdown`（全部）/ `handoff`（跨实例移交，`{directory, instanceID, ticket, expiresAt}`）/ `DELETE` 单终端；close 4404 = terminal unavailable
- 实测：create → list（1 条）→ snapshot（`info/text/checkpoint/cursor` 全在）→ connect-token → WS：`attached` → replay → `replay_complete` → `controller_changed` → 实时输出；删除 204

## 4. gateway 反代面

- 无鉴权头经 :3000 访问 `/api/pty`、`/api/info` → **401**（反代仍不注入 Basic，与 P0-3 实证一致）
- 带 `Authorization` 头经 :3000 → 200（链路通，缺的只是服务端注入）
- 若 T1 解冻：gateway 需（a）`/health` 暴露 `serveUrl`；（b）反代对 runtime 路由注入 Basic（密码 gateway 已持有）——两项均未实施（spec 拍板的 gateway 改动点）

## 5. 对 spec / plan 的修正（如 T1 解冻）

1. `terminal.getForSession` 返回**数组**而非单对象；「活动终端」= 取最近一条 running（或 `terminal/read` 的 ptyID）。
2. 创建终端必须显式传 `cwd` = 会话 directory。
3. 重连 cursor 用 `snapshot.info.output.tail`（避免 replay 全量）；attach 用 `input_protocol=1` 才有 resize。
4. `takeover=true` 用于重连抢控制权；observer 可做只读观看（未来）。
5. `read` 在无人 attach 过时为 null——不能用作「终端存在」的判据；用 list。

## 6. 环境备注

- 本次探测的 Basic 密码取自 gateway 日志（`server password` 行），不入库；探测脚本在 `.superpowers/probe/`（git-ignored）。
- 探测会话已清理（terminal DELETE 204 + session DELETE 204）。
