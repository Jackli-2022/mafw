# B4 MCP 全局配置写入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Config → 扩展 → MCP 卡提供图形化添加/删除全局 MCP 服务器，持久写入 `opencode.jsonc`，带 preview/备份/回滚/乐观锁。

**Architecture:** 契约能力增强——`mcpConfigApi` + `RuntimeMcpConfigChannel`；持久化（JSONC 编辑/备份/原子写/etag）全部在 opencode 适配器；gateway 只做能力门 + 透传门面；desktop 消费中立 DTO。

**Tech Stack:** TypeScript、SolidJS、Electron、Node、`jsonc-parser@3`、Jest（gateway）、node --test + test-shim（desktop）。

**Spec:** `docs/superpowers/specs/2026-10-28-b4-mcp-config-write-design.md`

## Global Constraints

- v1 仅全局配置 `~/.config/opencode/opencode.jsonc`（项目级 v1.1）。
- gateway `src/`（排除 `runtime/`）不得出现 opencode 专有字符串：`opencode.jsonc`、`/api/experimental`、`opencode mcp`。
- 写前必须备份 `<file>.bak-mafw-<ts>`；原子写（同目录 tmp + rename）；解析失败绝不写。
- preview/apply/remove/restore 一律带 `token`（文件内容 sha256），不匹配 → 409。
- diff/日志/响应中密钥掩码 `••••`（headers / environment / token / key / secret / password）。
- 未暴露字段（headers/env/oauth/disabled/timeout）覆盖时保留；type 变更需 `replace: true`。
- 测试只用临时 HOME 副本 fixture，不碰真实全局配置。
- 提交信息中文，测试数记录进 AGENTS.md；不 push。

## Review Focus

- 同名覆盖时 headers/env 被静默丢弃（用户丢凭据）→ 字段级合并测试。
- dry-run 与 commit 之间文件被改动（写错内容）→ token 409 测试。
- 非法 JSONC / 注释丢失（整文件被重排）→ 注释保真测试。
- remove 文件失败却运行时已删（状态分裂）→ 顺序测试。
- 恢复把整文件回滚（抹掉其他后来修改）→ 仅 `mcp.servers` 子树测试。

---

### Task 1: 契约能力位 + 通道类型

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/tests/unit/runtime/contract.test.ts`

**Interfaces:**
- Produces: `RuntimeCapabilities.mcpConfigApi?: boolean`
- Produces: `RuntimeMcpServerConfigInput` / `RuntimeMcpConfigPreview` / `RuntimeMcpConfigResult` / `RuntimeMcpConfigChannel`
- Produces: `RuntimeClient.mcp?: RuntimeMcpChannel & { config?: RuntimeMcpConfigChannel }`

- [ ] **Step 1: 写失败测试**：`contract.test.ts` 断言 `fullCapabilities().mcpConfigApi === true`、`minimalCapabilities().mcpConfigApi === false`。
- [ ] **Step 2: 跑测试确认失败**：`npx jest tests/unit/runtime/contract.test.ts` → 属性 undefined。
- [ ] **Step 3: 实现**：按 spec §4.2 加类型；capabilities 基线加 `mcpConfigApi: true/false`；`RuntimeClient.mcp` 改为交叉类型。
- [ ] **Step 4: 跑测试确认通过**（8+ 例）。
- [ ] **Step 5: Commit**：`feat(runtime): mcpConfigApi contract types`。

---

### Task 2: JSONC 编辑纯函数

**Files:**
- Create: `gateway/src/runtime/mcp-jsonc.ts`
- Test: `gateway/tests/unit/runtime/mcp-jsonc.test.ts`

**Interfaces:**
- Produces: `parseConfig(text): { ok: true; servers: Record<string, any> } | { ok: false; error: { line: number; column: number; message: string } }`
- Produces: `editServer(text, input: { name; type; url?; command?; overwrite?; replace? }): { ok: true; text: string; preserved: string[] } | { ok: false; code: 'exists'|'type_mismatch'|'invalid'; message: string }`
- Produces: `removeServerEntry(text, name): { ok: true; text: string } | { ok: false; code: 'not_found'|'invalid'; message: string }`
- Produces: `restoreServersSubtree(currentText, backupText): { ok: true; text: string } | { ok: false; code: 'invalid'; message: string }`
- Produces: `maskSecrets(value): any`、`renderDiff(before, after): string`

- [ ] **Step 1: 写失败测试**（fixture 含注释 + headers/env）：
  - 新增 remote：注释保留、键存在、缩进不变
  - 覆盖同名：headers/env/oauth/disabled 保留（`preserved` 含 `headers.Authorization`）
  - type 变更无 `replace` → `type_mismatch`；有 `replace` → 整体替换
  - 删除：只删该键；不存在 → `not_found`
  - 非法 JSONC → `invalid` 且不改文本
  - `restoreServersSubtree`：当前文件其他键（如 `model`）保持现值
  - `maskSecrets`：headers/env/token 值变 `••••`
- [ ] **Step 2: 跑测试确认失败**（模块不存在）。
- [ ] **Step 3: 用 `jsonc-parser` 的 `parseTree` / `modify` / `applyEdits` 实现**；`preserved` 从原对象与提交字段差集计算；`renderDiff` 简单 LCS 行 diff。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**：`feat(runtime): jsonc edit helpers for mcp config`。

---

### Task 3: opencode 适配器持久化通道

**Files:**
- Create: `gateway/src/runtime/opencode-mcp-config.ts`
- Modify: `gateway/src/runtime/opencode-runtime.ts`
- Test: `gateway/tests/unit/runtime/opencode-mcp-config.test.ts`

**Interfaces:**
- Produces: `createOpencodeMcpConfigChannel(deps): RuntimeMcpConfigChannel`
- Deps: `configPath(): string`、`readFile(p): string`、`writeFileAtomic(p, text): void`、`backup(p): string`、`applyRuntime(name, config): Promise<boolean>`、`removeRuntime(name): Promise<boolean>`、`now?(): number`
- `preview(input)` → `{token(sha256), target, diff, backup?, preserved?, warnings?}`（不写盘）
- `apply({token, confirm:true, ...input})` → `{applied, runtimeApplied, backup?, error?}`；token 不匹配抛 `{code:'etag_mismatch'}`
- `remove(name, {token, confirm:true})` → 先文件后运行时
- `restore({token, backupPath?, confirm:true})` → 只回滚 `mcp.servers` 子树

- [ ] **Step 1: 写失败测试**：用临时目录 fixture；覆盖 preview 不写盘/token 稳定、apply 备份+写入+token 409、remove 顺序（文件写失败 → runtime 未调用）、restore 仅子树、密钥掩码。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**（备份命名 `.bak-mafw-<ts>`；原子写 tmp+rename；错误对象带 `code`）。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: opencode-runtime.ts 接线**：`rt.mcp = { ...createOpencodeMcpChannel(...), config: createOpencodeMcpConfigChannel({ configPath: ~/.config/opencode/opencode.jsonc, ... applyRuntime: PUT experimental, removeRuntime: DELETE experimental }) }`。
- [ ] **Step 6: Commit**：`feat(runtime): opencode mcp config persistence channel`。

---

### Task 4: gateway 门面路由

**Files:**
- Create: `gateway/src/routes/mcp-config.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Test: `gateway/tests/unit/mcp-config-route.test.ts`

**Interfaces:**
- `handleMcpConfig(req,res,url,deps)`，deps：`supported: boolean`、`preview/apply/remove/restore` 直通
- 路由：`POST /api/mcp/config/preview`、`POST /api/mcp/config/apply`、`DELETE /api/mcp/config/servers/:name`、`POST /api/mcp/config/restore`
- 错误码映射：`etag_mismatch`→409；`exists|type_mismatch|invalid|too_large`→400；`not_found`→404；其余 500

- [ ] **Step 1: 写失败测试**：能力门 503、四条路由透传、错误码映射、非匹配 false。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现路由 + index 接线 + catalog 登记 4 条**。
- [ ] **Step 4: `npm run emit:openapi` + 跑 route 测试 + api-contract 测试**。
- [ ] **Step 5: Commit**：`feat(gateway): mcp config write facade`。

---

### Task 5: SDK + preload

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`、`client.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`、`mafw-types.ts`

**Interfaces:**
- `mcp.previewServer(opts)` / `mcp.applyServer(opts)` / `mcp.removeServer(name, opts)` / `mcp.restoreConfig(opts)`
- preload 同名方法（invoke ns `"mcp"`，method `previewServer` 等需 SDK 方法同名）

- [ ] **Step 1: 改 SDK client/types，`npm run build` + `npm test`（契约 test 只差 voice 既有红）**。
- [ ] **Step 2: preload 同步**。
- [ ] **Step 3: Commit**（与 Task 4 合并或独立）。

---

### Task 6: desktop 表单纯逻辑

**Files:**
- Create: `packages/desktop/src/renderer/mafw/mcp-config-form.ts`
- Test: `packages/desktop/src/renderer/mafw/mcp-config-form.test.ts`

**Interfaces:**
- `validateMcpServerForm(form): {ok: true; input: McpServerConfigInput} | {ok: false; errors: string[]}`
- 规则：name `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`；remote url http(s)；local command 非空数组

- [ ] **Step 1: 写失败测试**（合法/非法 name/url/command、trim）。
- [ ] **Step 2: 实现 + 过测试**。
- [ ] **Step 3: Commit**。

---

### Task 7: desktop UI（对话框 + 预览 + 删除 + 能力门）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/McpServerDialog.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`、`mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（传 `runtimeCaps`，已有）

- [ ] **Step 1: 对话框**：名称/类型/URL/命令+参数 → 校验 → preview（目标、备份、diff、保留字段、警告）→ 确认 apply；toast 结果（applied/runtimeApplied）。
- [ ] **Step 2: MCP 卡**：卡头「添加服务器」（仅 `runtimeCaps.mcpConfigApi===true`）；每行「删除」（仅 `source` 存在时）；删除确认。
- [ ] **Step 3: 刷新逻辑**：写/删后 `loadMcp()`。
- [ ] **Step 4: typecheck + desktop tests + build**。
- [ ] **Step 5: Commit**。

---

### Task 8: 全量门禁 + 临时 HOME GUI 冒烟 + 文档

**Files:**
- Modify: `AGENTS.md`（B4 记录）
- Temp: `C:/Users/15524/AppData/Local/Temp/mafw-b4-smoke/...`（fixture HOME + opencode.jsonc 副本）

- [ ] **Step 1: gateway 全量**：`npx jest --runInBand --forceExit --silent`（期望除并行 voice 外全绿）。
- [ ] **Step 2: desktop 全量**：`tsgo -p` + `npm test` + `electron-vite build`。
- [ ] **Step 3: 临时 HOME GUI 冒烟**：fixture 注释/headers → 添加 → preview → 确认 → 注释与 headers 保留、备份存在；删除；restore 只回 `mcp.servers`。
- [ ] **Step 4: 部署 gateway dist + 重启 daemon；dev app 冒烟（真实全局只读展示，不执行写入）**。
- [ ] **Step 5: AGENTS.md 记录测试数；提交（不 push）**。

## Self-Review

- Spec §4.2 契约类型 → Task 1；§4.4 适配器 → Task 2/3；§4.3 门面 → Task 4；§4.5 UI → Task 6/7；§5 安全 → Task 3 测试 + Task 8 冒烟；§6 测试计划 → 各任务 + Task 8。
- 偏差：去掉 `GET /api/mcp/config`（UI 用既有 `mcp.servers()` 展示），写操作 4 条路由；spec §4.3 的 5 条相应减为 4 条。
- 类型一致性：`RuntimeMcpConfigPreview.token` / `RuntimeMcpConfigResult.runtimeApplied` 在 Task 1 定义、Task 3/4/5/7 复用。
