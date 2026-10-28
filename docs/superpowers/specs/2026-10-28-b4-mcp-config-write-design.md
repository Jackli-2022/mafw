# B4：MCP 图形化增删（全局配置写入）设计 · rev2（契约化）

- 日期：2026-10-28（rev2：按「契约能力增强」重写分层）
- 状态：**待用户批准**（批准前不实现、不写任何用户配置）
- 前置：B3/B3.2（扩展页 + `RuntimeMcpChannel` 契约化）、B3.1（运行时连接/断开）
- 相关：`docs/research/2026-10-28-mcp-skills-management-research.md`

## 0. 分层原则（rev2 的核心）

MCP / Skills 是 **runtime 能力**，不是 gateway 能力。gateway 只依赖契约：

```
desktop  ──▶  gateway HTTP 门面（runtime-neutral）
                    │  capabilities.mcpApi / mcpConfigApi
                    ▼
             RuntimeClient.mcp（契约）
                    │
      ┌─────────────┴─────────────┐
 opencode 适配器                pi 适配器
 (v2 HTTP / CLI / JSONC 写入)   (不实现 → 能力位 false → 503/隐藏)
```

**判定标准**：gateway 代码里不允许出现 `opencode`、`/api/experimental`、`opencode.jsonc`、
CLI 二进制解析、Windows shim 细节——这些都只能出现在 `gateway/src/runtime/` 的适配器实现里。
本 rev2 之前 B3/B3.1 违反此原则，已在 B3.2 修复（见 AGENTS.md）。

## 1. 意图

B3 已能查看 MCP 配置与状态、运行时连接/断开，但**增删仍要手改 `opencode.jsonc`**。
B4 在 Config → 扩展 → MCP 卡里提供图形化添加/删除，并且：

- 写入必须**持久**（重启 serve 后仍在）；
- 写用户全局配置前**备份 + 明确确认**；
- 失败可回滚，不破坏其他配置项（注释、格式化、未暴露字段）。

## 2. 关键实证（决定方案）

### 2.1 `PUT /api/experimental/mcp/:server` 是纯运行时，不落盘

隔离实验（第二个 serve + 临时 HOME/XDG，不碰用户配置）：

| 步骤 | 结果 |
|---|---|
| `GET /api/mcp` baseline | `{"location":{...},"data":[]}` |
| `PUT /api/experimental/mcp/:server` body `{"config":{"type":"remote","url":"..."}}` | **204** |
| PUT 后 `GET /api/mcp` | 出现服务器（failed 状态） |
| 重启 serve 后 `GET /api/mcp` | `data: []`（**消失**） |
| 临时 HOME/项目/XDG 目录 | **没有生成任何 `.json/.jsonc`** |

→ 持久化必须由 **opencode 适配器** 写配置文件；运行时 API 只用于「写完后立即生效」。

### 2.2 官方写入渠道（已探测，v1 不采用）

| 渠道 | 结论 |
|---|---|
| `opencode mcp add <name> [--url/--header/--env] [--global]` | 存在且支持全局/项目；但**无 remove 子命令**、无备份、JSONC 保注释未知 |
| `PATCH /api/opencode-config` | gateway 转 `runtime.config.update()` = **运行时合并**，不保证写盘/保注释 |

→ 持久化在适配器内用「JSONC 保注释编辑 + 备份 + 原子写」实现。

### 2.3 其他事实

- 全局配置真实路径：`~/.config/opencode/opencode.jsonc`（由 **opencode 适配器** 解析，gateway 不知道）。
- 现有自接线范式：`src/utils/self-wiring.ts` 使用 `<file>.bak-mafw-<ts>` 备份，B4 沿用命名。
- 仓库未安装 `jsonc-parser`；由适配器引入（gateway 依赖，MIT）。

## 3. 目标 / 非目标 / 反目标

**目标（v1）**

1. 图形化**添加/覆盖**全局 MCP 服务器（remote：url；local：command + args）。
2. 图形化**删除**全局配置中的服务器。
3. 写入前 **preview（diff）**，提交需二次确认；每次写入前自动备份。
4. 写入保持 JSONC 注释与格式；其他配置键零改动；**未暴露字段默认保留**。
5. 写后尽力立即生效（运行时 add/connect），失败时明确「已持久化但未生效」。
6. 支持**恢复上次备份的 `mcp.servers` 子树**（只回滚 MCP，不覆盖其他配置）。
7. gateway 代码零 opencode 知识；pi/其他 runtime 能力位 false → UI 隐藏 / 503。
8. 全程不把配置内容（尤其 apiKey/headers）打进日志。

**非目标（v1 不做）**

- 项目级配置写入（用户已拍板：v1 仅全局；项目级 v1.1，需先解决多配置文档归属）。
- OAuth 认证（serve 2.1 无 HTTP 认证路由；继续提示在 opencode `/mcps` 登录）。
- 编辑 MCP 之外的任何配置键。
- `headers` / `environment` / `timeout` 等字段的**编辑**（v1 只读并保留）。
- 删除时级联清理 OAuth 凭据。
- 依赖 `opencode mcp add` / `PATCH /api/opencode-config` 作为写盘通道。

**反目标（即使能跑也算失败）**

- gateway 源码出现 opencode 专有路径/文件名/CLI 细节。
- 解析失败仍写文件；或写入丢失注释/格式化、覆盖相邻配置键。
- 写全局配置却没有备份、或没有明确确认。
- 把含密钥的配置内容写进日志/遥测/diff。
- 覆盖时静默丢弃未暴露字段（headers/env/oauth/disabled 等）。
- renderer 传任意路径读写文件（路径必须由适配器固定）。

## 4. 契约增强（本批要新增）

### 4.1 能力位

```ts
export interface RuntimeCapabilities {
  // ...既有
  mcpApi?: boolean;        // 列表/状态 + 连接/断开（B3.2 已实现）
  mcpConfigApi?: boolean;  // 持久化增删/预览/恢复（B4 新增）
}
```

### 4.2 通道

```ts
export interface RuntimeMcpServerConfigInput {
  name: string;
  type: 'remote' | 'local';
  url?: string;            // remote
  command?: string[];      // local
  overwrite?: boolean;     // 同名覆盖
  replace?: boolean;       // type 变更时显式替换
}

export interface RuntimeMcpConfigPreview {
  token: string;           // 内容哈希/乐观锁令牌（适配器生成）
  target: string;          // 展示给用户的目标文件（绝对路径）
  diff: string;            // 统一 diff（密钥已掩码）
  backup?: string;         // 预计备份名（新建文件时 null）
  preserved?: string[];    // 覆盖时保留的未暴露字段
  warnings?: string[];
}

export interface RuntimeMcpConfigChannel {
  preview(input: RuntimeMcpServerConfigInput): Promise<RuntimeMcpConfigPreview>;
  apply(input: RuntimeMcpServerConfigInput & { token: string; confirm: true }): Promise<{
    applied: boolean;          // 配置已持久化
    runtimeApplied: boolean;   // 运行时立即生效
    backup?: string;
    error?: string;
  }>;
  remove(name: string, opts: { token: string; confirm: true }): Promise<{
    applied: boolean; runtimeApplied: boolean; backup?: string; error?: string;
  }>;
  restore(opts: { token: string; confirm: true }): Promise<{
    applied: boolean; runtimeApplied: boolean; backup?: string; error?: string;
  }>;
}
```

`RuntimeClient.mcp` 扩展为 `RuntimeMcpChannel & { config?: RuntimeMcpConfigChannel }`（可选子能力）。

### 4.3 gateway 门面（薄）

| 路由 | 行为 |
|---|---|
| `GET /api/mcp/config` | `mcpConfigApi` 能力门 → `runtime.mcp.config?.preview` 所需的当前配置（只读；密钥掩码） |
| `POST /api/mcp/config/preview` | `preview(input)` 透传 |
| `POST /api/mcp/config/apply` | `apply(input)` 透传（token/confirm 门） |
| `DELETE /api/mcp/config/servers/:name` | `remove(name, opts)` 透传 |
| `POST /api/mcp/config/restore` | `restore(opts)` 透传 |

gateway 不做：路径解析、JSONC 解析、备份、原子写、diff 生成——全部适配器负责。
能力缺失 → 503 `{error:'runtime does not support MCP config write'}`。

### 4.4 opencode 适配器实现（内部）

- 目标文件：`~/.config/opencode/opencode.jsonc`（仅此一个；v1 不接项目级）。
- 校验：name 正则、remote url、local command、type 变更需 `replace`、文件大小 ≤512KB。
- JSONC：`jsonc-parser` 的 `parseTree` / `modify` / `applyEdits`（保留注释与缩进）。
- 覆盖：**字段级合并**，保留 headers/env/oauth/disabled 等未暴露字段。
- 备份：`<file>.bak-mafw-<ts>`；原子写：同目录 tmp + rename；失败保持原文件。
- 令牌：文件内容 sha256；`apply/remove/restore` 必须回传，不匹配 → 409。
- 运行时：`apply` 后 PUT（尽力）；`remove` 先文件后 DELETE（尽力）；失败 `runtimeApplied:false`。
- 恢复：只从备份提取 `mcp.servers` 子树写回（外科式），回滚前再备份当前文件。
- 日志：只记 name/文件名/备份名/结果，不记配置内容；diff/响应中敏感值掩码。

### 4.5 Desktop UI

- 卡头「添加服务器」→ 对话框（名称/类型/URL 或命令+参数）→ preview（目标文件、备份名、diff、保留字段、type 变更警告）→ 确认写入。
- 行内：连接/断开（已有）+「删除」（仅当该行来自配置文件；运行时-only 行不显示）。
- `runtimeCaps.mcpConfigApi !== true` → 隐藏写入口，显示只读提示。
- 写/删后刷新 `mcp.servers()` 与 config 视图。

preload/SDK 方法（中立命名）：

- `mcp.config()` / `mcp.previewServer(opts)` / `mcp.applyServer(opts)` / `mcp.removeServer(name, opts)` / `mcp.restoreConfig(opts)`

## 5. 安全与审批

- 所有写操作都有 confirm 门；preview 必显目标绝对路径 + 备份名。
- **首次真实写全局配置由你本人触发的 GUI 冒烟执行**；实现期所有测试只用「临时 HOME 副本文件」，不碰真实全局配置。
- 写盘失败保持原文件；备份失败中止；恢复只动 `mcp.servers` 子树。

## 6. 测试计划

**gateway（门面层）**

- 能力门：`mcpConfigApi=false` → 503；路由透传参数/响应；错误映射。
- 架构护栏：`gateway/src`（排除 `runtime/`）不得出现 opencode 专有字符串（`opencode.jsonc`、`/api/experimental`、`opencode mcp`）——静态测试。

**opencode 适配器（纯逻辑优先）**

- JSONC 编辑：新增/字段级覆盖/删除；注释与缩进保留；`mcp`/`servers` 缺失创建；非法 JSONC 拒绝；type 变更无 replace → 400；不触碰相邻键；大文件拒绝。
- 管线：preview 不写盘；apply token 不匹配 409；备份内容=原文；原子写失败原文件不变；remove 先文件后运行时；restore 只改 mcp.servers。
- 密钥：diff 中 headers/env/apiKey 值掩码；日志不含配置内容。

**desktop**

- 表单校验、preview → 确认 → 成功/失败 toast、覆盖保留提示、type 变更勾选、删除确认、runtime-only 行无删除、能力位隐藏。

**GUI 冒烟（临时 HOME 副本）**

- fixture（含注释 + headers 服务器）→ 添加 → preview → 确认 → 注释仍在、备份存在、运行时出现（failed 可接受）→ 删除 → 键消失 → restore → 回到初始 `mcp.servers`。

## 7. 交付顺序（批准后）

1. 契约：`mcpConfigApi` + `RuntimeMcpConfigChannel` 类型 + capabilities 基线/测试。
2. opencode 适配器：JSONC 编辑纯函数 + preview/apply/remove/restore + 测试（TDD）。
3. gateway 门面路由 + 能力门 + 架构护栏测试。
4. SDK/preload：5 个方法 + 契约（route-catalog → emit → build）。
5. desktop：对话框 + preview + 删除 + 能力位。
6. 全量门禁 + 临时 HOME GUI 冒烟。
7. AGENTS.md 记录 + 提交（不 push）。

## 8. 已拍板 / 我的默认（可推翻）

**你已拍板**

- v1 写入范围：**仅全局**（项目级 v1.1）。
- 分层：**契约能力增强**（runtime 能力位 + 通道），非解耦逻辑下沉适配器。

**我的默认（builder check 的其余项，可推翻）**

1. 覆盖 = 字段级合并，保留未暴露字段；type 变更需显式 `replace`。
2. 删除 = 先文件后运行时；文件失败则运行时不动。
3. 恢复 = 外科式（只回滚 `mcp.servers` 子树）。
4. preview 返回 `token`，apply/remove/restore 必带，不匹配 409。
5. 行按 `(name, source)` 标识；运行时-only 行不可删。
6. v1 字段仅 name/type/url/command+args；headers/env 只读保留（v1.1 再开编辑）。
