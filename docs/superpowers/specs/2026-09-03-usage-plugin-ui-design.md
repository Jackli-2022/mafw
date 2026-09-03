# Usage 插件工作台设计（Config → Usage 页重构）

- 日期：2026-09-03
- 状态：已评审通过（对话式设计，用户逐项确认）
- 范围：desktop Config Usage 页重构 + gateway usage 插件管理端点 + 模板系统

## 背景与问题

现状 Config → Usage 页是四块扁平卡片：限额（limits）、预算（budgets）、Cookies、插件状态。
问题：

1. 配置与 provider 脱节——按自由文本 key 编辑，看不出哪个 provider 在用哪个配置；
2. 插件配置（`usage.pluginConfig`）没有任何 UI，只能手改 config.yaml；
3. 新建插件没有入口——用户要自己写文件丢进 `~/.mafw/usage-plugins/`；
4. 本地统计 provider（无插件、用量来自 trajectory DB，如 xiaomi/gateway）与插件 provider 在 UI 上是两套逻辑。

## 目标

- provider 一卡片制：所有 provider（JS 插件 + 本地统计）统一成卡片，配置全部收进卡片详情（右侧抽屉）
- 模板化新建：内置 4 种模板，向导收集参数后自动生成插件文件
- 自定义插件：内置代码编辑器直接读写 `.js`，保存后依赖现有 watcher（300ms debounce）热加载
- 旧四块扁平卡片移除，`config.yaml` usage 段 schema 不变（零迁移）

## 决策记录

| 决策点 | 选择 | 备选 |
|---|---|---|
| 扁平配置（限额/预算/Cookie）去向 | 全部收进卡片/抽屉；本地统计 provider 自动生成卡片 | 保留外部兜底 / 部分收进 |
| 插件参数配置载体 | configSchema 表单（模板插件）+ 代码编辑器（自定义） | 仅代码编辑器 / 仅表单 |
| 模板 | 余额型、套餐窗口型、克隆 builtin、空白 | 仅两模板 / 仅代码骨架 |
| 页面骨架 | 卡片网格 + 右侧抽屉（视觉伴侣 mockup 选定 A） | 列表内联展开 / 主从双栏 |
| 管理架构 | Gateway 端点制（创建/源码/配置/测试均走 HTTP） | desktop 直操文件 / 声明式 JSON 插件 |

## 1. 信息架构（Config → Usage 页）

卡片来源合并两路：

- **JS 插件**：用户目录 `~/.mafw/usage-plugins/*.js` + builtin 8 个（含覆盖/禁用状态），数据来自 `GET /api/usage/plugins`
- **本地统计 provider**：trajectory DB 有用量记录、或 limits/budgets 里配过 key 的 provider，自动生成"本地统计"卡片

卡片内容：显示名（复用 providerID→display name 映射，`modelGroups`）、类型徽章（`插件·balance` / `插件·token-plan` / `本地统计`）、状态（✓ 运行中 / 错误红点 / 已禁用 / 覆盖 builtin）、最新窗口摘要（复用 `GET /api/usage` 的 provider windows：预算 %、tokens、余额）。底部 `＋ 新建插件` → 模板向导。点卡片 → 右侧抽屉。

旧四块扁平卡片（限额/预算/Cookie/插件状态）全部移除。

## 2. 抽屉详情

- **头部**：显示名 + providerID + 徽章 + 状态
- **通用配置**（本地统计卡也有）：预算 `usage.budgets[providerID]`、限额窗口 `usage.limits[providerID]`（5h/7d/month）、Cookie `usage.cookies[name]`——经现有 `config.get/set usage` 保存，保存后派发 `mafw:usage-config-saved` 事件刷新右 dock
- **插件专属**：
  - 参数表单：插件声明 `configSchema` 时按 schema 渲染，值存 `usage.pluginConfig[name]`
  - 代码编辑器：读/写 `.js` 源码（builtin 只读展示），保存 → `PUT source` → watcher 自动热加载；scan 错误回显在抽屉顶部错误条
- **操作行**：测试运行（`POST test`，显示返回 JSON 或错误）、启用/禁用开关（`usage.disabledPlugins`）、重载（`POST reload`）、删除（仅用户文件；builtin 卡显示"覆盖中"+ 一键还原 = 删除用户覆盖文件）

## 3. 模板系统

gateway `src/usage/templates/`，每模板导出 `render(values) → string`（文件内容）+ `schema`（向导字段）：

| 模板 | 用途 | 向导字段 |
|---|---|---|
| `balance-api` | 余额型 API（balance 窗口） | name、显示名、认证方式（authKey 选 provider / cookie 名 / 自定义 header 存 pluginConfig）、endpoint URL、used/limit/remaining 的 JSON 点路径 |
| `token-plan` | 套餐窗口型（5h/7d/month） | name、endpoint、认证方式、窗口列表（窗口类型 + used/limit 路径）、resetAt 路径（可选） |
| `clone-builtin` | 克隆 builtin | 源插件（8 选 1）+ 新 name |
| `blank` | 空骨架 | name |

流程：向导收集 values → `POST /api/usage/plugins` → gateway 校验并写 `~/.mafw/usage-plugins/<name>.js` → PluginLoader watcher 自动加载 → 卡片出现。

生成物自带 `configSchema` 声明，后续改参数走抽屉表单（`usage.pluginConfig[name]`），不碰代码。认证三通道复用现有 ctx 能力：`ctx.apiKey`（auth.json）、`ctx.cookie`、自定义 header 存 `pluginConfig` 由模板代码读取。

## 4. Gateway API

均挂现有 apiToken/鉴权中间件，JSON body：

- `GET /api/usage/plugins`（已有，扩展响应）：每项增加 `configSchema`、`config`（pluginConfig 值）、`origin: user|builtin|override`、`disabled`
- `POST /api/usage/plugins` — `{ template, values }` 或 `{ name, source }`；校验 name ∈ `[a-z0-9-]`、无重名、路径限定 usage-plugins 目录（防穿越）；写入后返回加载状态
- `GET /api/usage/plugins/:name/source` — 返回源码文本（builtin 403 只读）
- `PUT /api/usage/plugins/:name/source` — 覆写用户文件；不做写前语法检查（写入后 scan 失败会以 error state 回显，插件目录写入失败不影响运行中的 gateway）
- `DELETE /api/usage/plugins/:name` — 删用户文件（builtin 禁止；override 场景删除即还原 builtin）
- `POST /api/usage/plugins/:name/test` — 复用 `makeAdapter().fetch()` 跑一次，返回 `{ ok, result?, error? }`，不写入任何状态
- `POST /api/usage/plugins/reload`（已有）

预算/限额/cookie 继续走现有 `GET/PUT /api/config/usage`，无新端点。

## 5. 数据模型与兼容

- `config.yaml` usage 段 schema 完全不变：`limits / budgets / cookies / pluginConfig / disabledPlugins`
- `PluginLoader` 透传 `mod.configSchema`；校验为 `{ key, label, type: number|string|boolean|select, options? }[]`，非法值忽略（fail-open）
- 旧配置键值直接被新 UI 读写，无迁移

## 6. 错误处理

- 插件 scan 失败：卡片错误红点 + 抽屉顶部错误条（现有 `PluginState.error`）
- 测试运行失败：显示 err.message，不污染 poller 状态
- 源码保存后语法错误：scan 置 error state，抽屉回显；上一版可从编辑器历史/外部重试（不做版本快照）
- 文件写入失败（权限/磁盘）：toast + 编辑器内容保留
- 删除 override 用户插件：确认框提示"将还原为内置插件"

## 7. 测试

- gateway 单测：模板 render（4 模板 × 典型 values 快照）、create/source/delete 端点（tmp 目录注入 deps）、name 白名单与路径穿越防护、test-run（mock ctx）、configSchema 透传与非法 schema 忽略
- desktop：抽屉表单按 schema 渲染、保存流（config set 调用）、卡片合并逻辑（插件 + 本地统计去重）——用包内现有测试设施（plan 阶段确认 runner）

## 8. 非目标

- 插件市场 / 在线安装
- dashboard / 移动端复用（端点已为其铺路，UI 后续再说）
- 密钥管理新机制（复用 auth.json + cookies + pluginConfig）
- 源码版本快照 / 撤销历史
