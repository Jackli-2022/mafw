# MCP / Skills 管理面调研（2026-10-28）

> 目的：为 W4（MCP / Skills / Hooks 管理 UI）定范围。方法：官方文档 + 本机运行面实测（gateway:3000 / opencode 2.1.0 serve / @opencode-ai/sdk 1.18.30 gen 类型）+ 代码盘点。
> 结论先行：**MCP 可以做到零配置写入的管理 UI（运行时 API + 配置文档只读）；Skills 管理数据源已存在，详情可读，但"禁用"需要配置写入（v1 可后置）。Hooks 不适用（opencode v2 无用户钩子概念）。**

## 1. MCP

### 1.1 配置面（文件 + 文档 API）

- 配置在 `opencode.jsonc` 的 `mcp.servers`（global `~/.config/opencode/opencode.jsonc` 或项目级），字段：`type: local|remote`、`command[]`/`url`、`headers`、`oauth`（client_id/secret/scope/callback_port/redirect_uri）、`disabled`、`codemode`、`timeout`、`protocol`。
- **opencode v2 原生命令**：`opencode mcp add <name> [--global] (--url … | -- cmd…)`、`mcp list`、`mcp auth [name]`、`mcp logout <name>`；**无 remove 命令**（文档明说删除 = 删配置条目）。
- **运行时 UI**：TUI `/mcps` 可 connect / disconnect / authenticate；**disconnect 不改配置**（仅运行时状态）。
- **本机已有配置读取 API（实测）**：`GET /api/opencode-config`（gateway 既有路由，代理 opencode `config.get()`）返回**配置文档层数组**：
  ```json
  [{ "type": "document", "path": "C:\\Users\\15524\\.config\\opencode\\opencode.jsonc",
     "info": { "mcp": { "servers": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "oauth": false, "disabled": false } } }, ... } }]
  ```
  → MCP 列表、类型、url/command、disabled、来源文件路径**零成本可得**。
- 写入面：`PATCH /api/opencode-config`（gateway 既有，调 `config.update()`）——**是否持久化回 JSONC 未验证**（不拿用户配置做实验；需专项 probe + 备份）。

### 1.2 运行时 API（关键发现，零写入即可做管理）

@opencode-ai/sdk 1.18.30 gen 类型确认 serve 暴露：

| 端点 | 语义 |
|---|---|
| `GET /mcp?directory=` | 全量状态：`connected` / `disabled` / `failed` / `needs_auth` / `needs_client_registration` |
| `POST /mcp` `{name, config}` | 动态添加（**持久性未验证**，若仅内存级则重启丢失） |
| `POST /mcp/{name}/connect` | 运行时连接 |
| `POST /mcp/{name}/disconnect` | 运行时断开（不改配置） |
| `POST /mcp/{name}/auth…` | OAuth start / callback / authenticate / remove |

**注意路由占用**：gateway 自身在 `/mcp` 上提供 MAFW MCP 服务器（每 agent 都连它），serve 的 `/mcp` 被 gateway 遮蔽——MAFW 需新增 `/api/mcp/*` 命名空间，内部用 `serveAuthHeaders()` + `injectServeAuth` 反代（既有机制，`/api/pty` 同款）。

### 1.3 CLI 实测

`opencode mcp list` → `✓ mafw  connected`（本机 1 个服务器）。CLI 是 218MB 单文件 exe，spawn 可用但慢于 API；**add/auth/logout 可作为「写配置」的官方安全通道**，remove 仍须改配置。

### 1.4 v1 可交付范围（零配置写入）

- 列表：名字 / 类型（local/remote）/ 来源（global/项目文件路径）/ `disabled` 标记
- 运行时状态徽标：connected / disabled / failed / needs_auth（GET /api/mcp/status）
- 操作：连接 / 断开 / OAuth 认证（needs_auth 时）
- 详情：url / command / 来源路径展示；「复制命令」帮助手动编辑

**v2（需配置写入能力）**：添加（CLI `opencode mcp add --global` 或 jsonc 写）、删除、编辑字段、启用/禁用（`disabled` 字段）。

## 2. Skills

### 2.1 数据源（已有，实测）

- `GET /skill?directory=<dir>`（gateway 既有路由，来自 T2-5 discovery）返回：
  ```json
  { "skills": [{ "id": "typesafe-ai", "name": "typesafe-ai", "description": "…", "slash": false,
                 "scope": "user|project", "location": "C:\\Users\\15524\\.config\\opencode\\skills\\typesafe-ai\\SKILL.md",
                 "contentLength": 9438 }] }
  ```
  → 列表、来源（user/project）、绝对路径、大小全部可得；**详情 = 读 location 文件**（或 discovery 详情端点 `/api/sessions/:id/discovery/skills/:key`）。
- 发现源：`~/.config/opencode/skills`、`~/.claude/skills`、`~/.agents/skills`、项目 `.opencode/skills`、`.claude/skills`、`.agents/skills` + config `skills` 数组（目录/HTTP catalog）。
- **无 serve API**（gen 类型零 skill 端点）；没有"启停"开关。

### 2.2 禁用语义（三种，强度不同）

| 机制 | 效果 | 代价 |
|---|---|---|
| config `permissions`: `{action:'skill', resource:'<id>', effect:'deny'}` | **正规禁用**：模型看不到 + 拒绝加载（可 per-agent） | 写配置（JSONC） |
| SKILL.md frontmatter `metadata.opencode/autoinvoke: false` 或 `disable-model-invocation: true` | 只从模型列表隐藏，仍可按 ID 显式加载 | 改用户技能文件（侵入性） |
| 移动/归档目录 | 彻底消失 | 改目录结构，最侵入 |

### 2.3 v1 可交付范围（零写入）

- 列表（现成）+ 来源徽标 + 搜索（复用现有 fuzzy 纯函数）
- 详情面板：读 `location` 的 SKILL.md 内容（Markdown 预览，复用文件预览管线）
- 操作：打开所在目录（main `showItemInFolder`，既有 tray/外部打开同款 IPC）

**v2（需配置写入）**：permissions deny 启停（全局或 per-agent）、新建技能模板（写 SKILL.md 到 `~/.config/opencode/skills/<id>/`）、删除/归档。

## 3. Hooks

- opencode v2 配置文档**无用户 hooks 概念**（config 无 hooks 键；无 serve hooks API）。竞品中 Claude/Codex 有 hooks，Kimi 有 `config.toml [[hooks]]`，opencode 没有。
- MAFW 侧 hooks 是 gateway 插件层（renders/transform 注入），不是用户配置面。
- **结论：W4 的 Hooks 部分 descope**（可留一行说明 + 链到插件中心），不做假 UI。

## 4. 竞品对照（管理面）

| | MCP 管理 | Skills 管理 |
|---|---|---|
| Claude Code | `/mcp` 列表 + OAuth + Desktop 连接器 | `/skills` 列表 + 安装/编辑（插件可含 skills） |
| Codex | `/mcp` 列表（IDE 只读状态） | `$skill` + skills UI + 团队共享 |
| Kimi Code | `/mcp`、`/mcp-config`、VS Code 一键安装（Playwright/Context7/GitHub） | `/skill:<name>` + Desktop 可让 Agent 生成 Skill |
| opencode v2 | `mcp add/list/auth/logout` + `/mcps` 运行时；配置手编 | 目录发现 + config `skills` 数组 + permissions |
| **MAFW（建议 v1）** | **列表+状态+连接/断开+OAuth+来源，添加/删除留 v2** | **列表+详情+来源+打开目录，启停留 v2** |

## 5. 待验证 probe（进入 v2 前必做）

1. `PATCH /api/opencode-config` 是否持久化到文件、是否会丢 JSONC 注释（在**备份 + 测试文件**上验证，绝不先碰用户主配置）。
2. `POST /mcp`（动态添加）重启 serve 后是否保留（判定是内存级还是写入配置）。
3. `opencode mcp add --global` 对 JSONC 的写入质量（注释/顺序/格式保留）。
4. skills 详情读取路径：`/skill` 的 location 直接 file-read vs discovery detail 端点（后者已存在，优先复用）。

## 6. 建议路线

```
W4a MCP 管理 v1（零写入）：gateway /api/mcp/* 反代（status/connect/disconnect/auth）+ Config「扩展」页 MCP 卡
W4b Skills 管理 v1（零写入）：列表 + 详情（Markdown 预览）+ 来源徽标 + 打开目录
W4c 配置写入能力立项：jsonc 保注释写 + 备份/回滚/校验 → 解锁 MCP add/remove + Skills 禁用
```

预估：W4a 中（新路由 + UI 卡），W4b 小-中（列表已有，详情复用 Markdown 预览），W4c 单独 spec（安全边界同 W2 沙箱思路：只动用户显式选择的目标文件，备份先行）。
