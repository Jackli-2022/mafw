# B4：MCP 图形化增删（全局配置写入）设计

- 日期：2026-10-28
- 状态：**待用户批准**（批准前不实现、不写任何用户配置）
- 前置：B3（扩展页只读 + CLI 状态）、B3.1（运行时连接/断开）
- 相关：`docs/research/2026-10-28-mcp-skills-management-research.md`

## 1. 意图

B3/B3.1 已能查看 MCP 配置、看状态、运行时连接/断开，但**增删仍要手改 `opencode.jsonc`**。B4 在 Config → 扩展 → MCP 卡里提供**图形化添加/删除**，并且：

- 写入必须**持久**（重启 serve 后仍在）；
- 写用户全局配置前**备份 + 明确确认**；
- 失败可回滚，不破坏其他配置项（注释、格式化、未暴露字段）。

## 2. 关键实证（决定方案）

### 2.1 `PUT /api/experimental/mcp/:server` 是纯运行时，不落盘

隔离实验（第二个 serve + 临时 HOME/XDG，不碰用户配置）：

| 步骤 | 结果 |
|---|---|
| `GET /api/mcp` baseline | `{"location":{...},"data":[]}` |
| `PUT /api/experimental/mcp/mafw-b4-probe` body `{"config":{"type":"remote","url":"http://127.0.0.1:1/mcp"}}` | **204** |
| PUT 后 `GET /api/mcp` | 出现 `{"name":"mafw-b4-probe","status":{"status":"failed",...}}` |
| 重启 serve 后 `GET /api/mcp` | `data: []`（**消失**） |
| 临时 HOME/项目/XDG 目录 | **没有生成任何 `.json/.jsonc`** |

→ 持久化只能由 gateway 写配置文件；运行时 API 只用于「写完后立即生效」。

### 2.2 官方写入渠道（已探测，v1 不采用）

| 渠道 | 结论 |
|---|---|
| `opencode mcp add <name> [--url/--header/--env] [--global]` | 存在且支持全局/项目；但**无 remove 子命令**、无备份、JSONC 保注释未知 |
| `PATCH /api/opencode-config` | gateway 转 `runtime.config.update()` = **运行时合并**，不保证写盘/保注释 |

→ 采用自建「JSONC 保注释编辑 + 备份 + 原子写」。

### 2.3 其他事实

- 全局配置真实路径：`C:\Users\15524\.config\opencode\opencode.jsonc`（`GET /api/opencode-config` document 层）；含 `mcp.servers.mafw`，也含 `providers.*.settings.apiKey` 等敏感字段。
- 现有自接线范式：`src/utils/self-wiring.ts` 使用 `<file>.bak-mafw-<ts>` 备份，B4 沿用同一命名。
- 仓库未安装 `jsonc-parser`（VS Code 的 JSONC 编辑器，`modify()`/`applyEdits()` 保留注释与格式）。

## 3. 目标 / 非目标 / 反目标

**目标（v1）**

1. 图形化**添加/覆盖**全局 MCP 服务器（remote：url；local：command + args）。
2. 图形化**删除**全局配置中的服务器。
3. 写入前 **dry-run 预览 diff**（含将被保留/丢弃的字段），提交需二次确认；每次写入前自动备份。
4. 写入保持 JSONC 注释与格式；其他配置键零改动；**未暴露字段默认保留**。
5. 写后尽力立即生效（运行时 PUT），失败时明确「已持久化但未生效」。
6. 支持**恢复上次备份的 `mcp.servers` 子树**（只回滚 MCP，不覆盖其他配置）。
7. 全程不把配置内容（尤其 apiKey/headers）打进日志。

**非目标（v1 不做）**

- 项目级配置写入（用户已拍板：v1 仅全局；项目级 v1.1，需先解决多配置文档归属）。
- OAuth 认证（serve 2.1 无 HTTP 认证路由；继续提示在 opencode `/mcps` 登录）。
- 编辑 MCP 之外的任何配置键。
- `headers` / `environment` / `timeout` 等字段的**编辑**（v1 只读并保留）。
- 删除时级联清理 OAuth 凭据。
- 依赖 `opencode mcp add` / `PATCH /api/opencode-config` 作为写盘通道。

**反目标（即使能跑也算失败）**

- 解析失败仍写文件；或写入丢失注释/格式化、覆盖相邻配置键。
- 写全局配置却没有备份、或没有明确确认。
- 把含密钥的配置内容写进日志/遥测/diff。
- 覆盖时静默丢弃未暴露字段（headers/env/oauth/disabled 等）。
- renderer 传任意路径读写文件（路径必须服务端固定）。

## 4. 设计

### 4.1 目标文件（服务端固定，单一）

| scope | 路径 |
|---|---|
| v1 | `~/.config/opencode/opencode.jsonc`（仅此一个） |

- 客户端不传路径；路径由 gateway 固定拼出。
- 文件必须存在（缺失报错，不擅自创建全局配置）。
- 大小上限 512KB；超过拒绝编辑。

### 4.2 JSONC 保注释编辑

引入 `jsonc-parser`（gateway 依赖，MIT）：

- 读取：`parseTree` 校验语法；有错 → 拒绝写入并返回 `{line, column, message}`。
- 新增/覆盖（字段级合并）：若 `mcp.servers.<name>` 已存在，**只修改本次提交的字段**（`type` + `url` 或 `command`+`args`），其余字段原样保留；`type` 发生变化（remote↔local）时需显式 `replace: true`（否则 400 + 提示冲突字段）。
- 删除：`modify(text, ['mcp','servers',name], undefined)`。
- `mcp`/`servers` 不存在时按路径创建（保留既有注释与缩进）。
- 不改动其余键；不重排；缩进沿用文件现有探测（缺省 2 空格）。

### 4.3 写入管线（两阶段 + 乐观锁）

**阶段一：dry-run（不落盘）** `POST /api/mcp/config/servers?dryRun=1`

```jsonc
{ "name": "sentry", "config": { "type": "remote", "url": "https://..." } }
```

返回：

```jsonc
{
  "ok": true,
  "target": "C:/Users/.../.config/opencode/opencode.jsonc",
  "etag": "sha256:<hash>",            // 文件当前内容哈希，commit 必须回传
  "backup": "...opencode.jsonc.bak-mafw-<ts>",  // 预告值（commit 实际生成）
  "diff": "--- before\n+++ after\n@@ ...",
  "existing": true,                    // 同名服务器已存在
  "preserved": ["headers.Authorization", "environment"],  // 覆盖时保留的字段
  "wouldReplaceType": false,
  "runtime": { "wouldApply": true }
}
```

**阶段二：提交** 同路由 `?dryRun=0`，body 必须带 `confirm: true` + `etag`（缺 → 400/409）。

管线：

1. 重新读文件；`etag` 不匹配 → **409**（UI 重新 dry-run）。
2. 备份：同目录 `<file>.bak-mafw-<ts>`；失败 → 中止。
3. 原子写：同目录临时文件 + rename；失败 → 保持原文件（备份仍在）。
4. 运行时应用（尽力）：`PUT /api/experimental/mcp/:server`（add/upsert + 立即连接）；失败不回收文件，返回 `applied:false` + `runtimeError`。
5. 返回：`{ok, target, backup, applied, runtimeError?}`。

**删除**：`DELETE /api/mcp/config/servers/:name`（body/query 带 `etag`）
顺序：**先改文件**（备份+原子写），成功后再运行时 `DELETE /api/experimental/mcp/:server`（尽力）；文件失败 → 运行时不动。返回同上。

**恢复**：`POST /api/mcp/config/restore` body `{backupPath}`
- `backupPath` 必须是 `~/.config/opencode/` 下、文件名匹配 `opencode.jsonc.bak-mafw-*`（防任意路径）。
- 只从备份中提取 `mcp.servers` 子树，写回当前文件（**外科式回滚**，不回滚其他键的后续修改）。
- 回滚前把当前文件再备份一次；同样原子写。

### 4.4 校验

| 项 | 规则 |
|---|---|
| name | `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`；重复且无 `overwrite:true` → 409（dry-run 提示） |
| remote | `url` 必须 `http(s)://`；`oauth` 可选 boolean |
| local | `command` 非空字符串数组（首项非空）；不接受 shell 字符串 |
| type 变更 | 已存在且 type 改变时需 `replace:true`；否则 400 |
| 解析 | `parseTree` 有 error → 400 + 位置 |
| 大小 | ≤ 512KB |
| etag | dry-run 返回；commit/delete 必带，不匹配 409 |

### 4.5 密钥与日志

- `mcp.servers` 的 `headers.*` / `environment.*` / `*token*` / `*key*` 值：UI 与 diff 一律掩码为 `••••`；写路径不读取这些值。
- 服务端日志仅记录：name、target 文件名、是否成功、备份文件名、applied；**不记录配置内容**。

### 4.6 Desktop UI（Config → 扩展 → MCP 卡）

- 卡头「添加服务器」→ `McpServerDialog`：
  - 名称、类型（remote/local）、URL 或 命令+参数。
  - 下一步 → dry-run：显示目标文件、备份名、diff、`preserved` 字段与 type 变更警告。
  - 「确认写入」→ commit（带 etag）；`applied:false` 时提示「已持久化，重启 agent 后生效」。
  - 同名覆盖：显示「将覆盖 <name>」+ 保留字段列表；type 变更需勾选「替换类型」。
- 每行按钮：保留「连接/断开」；**仅当该服务器来自全局配置文件时**显示「删除」（确认弹窗）。运行时-only 行不显示删除。
- `needs_auth` 仍显示「复制认证命令」。
- 写/删后刷新 `mcp.servers()` 与配置列表。

新增 preload/SDK 方法：

- `mcp.config()` → `{path, exists, servers, parseError?}`
- `mcp.saveServer(opts)` → `{dryRun, confirm?, etag?, overwrite?, replace?, name, config}`
- `mcp.removeServer(name, opts)` → `{etag, confirm}`
- `mcp.restoreBackup(backupPath)`

全部登记进 `route-catalog.ts` → `emit:openapi` → SDK build。

## 5. 安全与审批

- 所有写操作都有 confirm 门；dry-run 必显目标绝对路径 + 备份名。
- **首次真实写全局配置由你本人触发的 GUI 冒烟执行**；实现期所有测试只用「临时 HOME 副本文件」（copied fixture），不碰真实全局配置。
- 写盘失败自动保持原文件；备份失败中止；恢复只动 `mcp.servers` 子树。

## 6. 测试计划

**gateway**

- `jsonc-edit` 纯函数：新增/覆盖（字段级合并保留 headers/env/oauth/disabled）/删除；注释与缩进保留；`mcp`/`servers` 缺失创建；非法 JSONC 拒绝；同名无 overwrite → 409；type 变更无 replace → 400；不触碰相邻键；大文件拒绝。
- 路由：dry-run 不写盘（mtime/hash 不变）；commit 无 confirm / etag 不匹配 → 400/409；备份内容 = 原文；写入失败原文件不变；backupPath 非白名单 → 400；日志不含密钥（捕获 logger）。
- 运行时失败：文件已写、`applied:false`；删除文件失败 → 运行时未动。
- 恢复：只改 `mcp.servers`，其他键保持当前值。

**desktop**

- 表单校验（name/url/command）；dry-run → 确认 → 成功/失败 toast；覆盖保留字段提示；type 变更需勾选；删除确认；runtime-only 行无删除按钮。

**GUI 冒烟（临时 HOME 副本）**

- fixture `opencode.jsonc`（含注释 + mafw + 一个带 headers 的服务器）→ 添加 remote → diff → 确认 → 文件出现键、注释仍在、备份存在、运行时出现（failed 可接受）→ 删除 → 键消失、其他键不变 → 恢复备份 → 回到初始 `mcp.servers`。

## 7. 交付顺序（批准后）

1. gateway：`jsonc-edit` 纯函数 + 测试（TDD）。
2. gateway：config 路由（dry-run/commit/delete/restore）+ 备份/原子写/etag + 测试。
3. SDK/preload：4 个方法 + 契约（route-catalog → emit → build）。
4. desktop：MCP 卡按钮 + 对话框 + diff 预览 + 覆盖/替换提示 + 删除。
5. 全量门禁 + 临时 HOME GUI 冒烟。
6. AGENTS.md 记录 + 提交（不 push）。

## 8. 已拍板 / 我的默认（可推翻）

**你已拍板**

- v1 写入范围：**仅全局**（项目级 v1.1）。

**我的默认（builder check 的其余 7 项裁决，可推翻）**

1. 覆盖时**字段级合并**，保留未暴露字段；type 变更需显式 `replace`。
2. 删除**先文件后运行时**；文件失败则运行时不动。
3. 恢复是**外科式**（只回滚 `mcp.servers` 子树），不做整文件回滚。
4. dry-run 返回 `etag`，commit/delete 必须回传，不匹配 409。
5. 行以 `(name, source)` 标识；运行时-only 行不可删除。
6. 新文件无备份 → `backup:null`（v1 全局文件必须已存在，实际不会出现）。
7. v1 字段仅 name/type/url/command+args；headers/env 只读保留（v1.1 再开编辑）。
