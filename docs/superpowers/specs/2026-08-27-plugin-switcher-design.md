# Runtime / Media 插件切换器设计规格

## 概述

在 gateway 后端提供插件切换端点，在桌面 Config 页提供配套 UI，让用户以语义化方式切换 **Agent Runtime 插件**（opencode / pi / 用户 runtime-plugins）与 **Media 引擎插件**（默认 pi / 用户 media-plugins），取代目前手改 `config.yaml` 裸字段的低效体验。

---

## 实现变更说明（执行期偏差决定）

> 以下记录 2026-08-27 实际实现与本规格设计的偏差。所有变更均经用户批准。

| # | 设计规格（原） | 实际实现（新） | 偏差原因 |
|---|---|---|---|
| **D1** | Runtime 切换需重启 gateway（二次确认 → `window.api.mafw.gateway.restart()`） | **进程内热切换**：持久化 → `createRuntime()` 重建 → 接线 client/consumers → `resubscribeEvents()` 重订阅事件流（AbortController 取消旧订阅）→ dispose 旧 runtime | 省去 sidecar 重启开销（~3-5s），响应即时生效 |
| **D2** | `POST /api/runtime/switch` 返回 `{ success, restartRequired: true, target, envOverride }` | 返回 `{ success, active: { name, capabilities }, envOverride }` — **无 `restartRequired`、无 `target`** | 热切换后无需重启，`restartRequired` 字段失去语义；`active` 直接反映新 runtime |
| **D3** | `POST /api/media/switch` 未知引擎 **fail-open**：静默回退默认 pi，不 400 | 未知引擎返回 **400**：`{ error: "Media engine 'xxx' not found", available }` | fail-open 导致用户无法感知配置错误；改为 fail-closed 让 UI 明确提示 |
| **D4** | `POST /api/media/switch` 返回 `{ success, restartRequired: false, resolved: {...} }` | 返回 `{ success, media: { engine, image, video, audio } }` — **无 `restartRequired`、`resolved`→`media`** | 移除无意义的 `restartRequired`；字段名与 config schema 保持一致 |
| **D5** | media/switch body: `{ engine?, image?, video?, audio? }` — 模态字段为 string | body: `{ engine?, image?: { engine? }, video?: { engine? }, audio?: { engine? } }` — 模态字段为 **嵌套对象** | 与 config.yaml `media.image.engine` 嵌套结构对齐，避免 flat→nested 映射歧义 |
| **D6** | 无 `POST /api/runtime/reload` 端点 | **新增** `POST /api/runtime/reload` — 重新扫描插件文件目录，不切换 runtime | 便于热更新插件列表（开发场景）而不触发 runtime 切换 |
| **D7** | 配置持久化复用 `PUT /api/config` 内联路径（读 `config.raw` → 合并 → 整对象写入） | 调用 `Config.persistOverrides()` 独立方法（`config.ts:461`，deepMerge + 整对象写 config.yaml） | 提取为可测试单元，避免 switch handler 重复 config.raw 读写逻辑 |
| **D8** | 桌面 Config 页 Runtime 切换流程：二次确认 → `gateway.restart()` → 监听 ready | Runtime 下拉 + `confirm()` 二次确认 + **无重启流程**；envOverride 显示警告条 | 热切换消除了重启步骤 |
| **D9** | `POST /api/runtime/switch` 持久化路径：读 `config.raw` → 合并 `runtime.plugin` → 整对象写 | 走 `deps.persist()` → `config.persistOverrides({ runtime: { plugin } })` | 与 D7 一致，统一 persist 入口 |

**偏差分类统计**：
- **设计修正**（D3）：1 项 — fail-open → fail-closed（安全性）
- **架构升级**（D1, D6, D8）：3 项 — 重启 → 热切换（性能 + UX）
- **接口简化**（D2, D4, D5）：3 项 — 移除冗余字段、对齐嵌套结构
- **重构提取**（D7, D9）：2 项 — config 持久化收敛为独立方法

> **后续规范更新**：本规格正文保留原设计供追溯；以下「目标」「架构」「组件设计」「验收标准」章节中的旧设计已用 ~~删除线~~ 标注，实际以本节及 AGENTS.md §5.19 为准。

---

## 目标

- gateway 新增两个切换端点：`POST /api/runtime/switch`、`POST /api/media/switch`
- 桌面 Config 页新增「插件」卡片：Runtime 下拉 + Media 每模态下拉
- ~~Runtime 切换需重启 gateway（二次确认后自动重启）；~~ **Runtime 切换热生效**（进程内重建 + 事件流重订阅）
- Media 切换热生效（无需重启）
- ~~保留现有 fail-open：未知/失败的插件不阻塞，回退内置实现~~ **fail-closed**：未知插件返回 400，由 UI 提示用户

## 关键现状（设计依据）

| 项 | 现状 | 生效方式 |
|---|---|---|
| Runtime 选择 | `config.runtime.plugin` / `MAFW_RUNTIME_PLUGIN`，启动时 `createRuntime()` 一次性创建（index.ts:822） | **必须重启 gateway** |
| Media 引擎 | `media.engine` / `media.{kind}.engine`，`resolvePrompt` 每次请求读 config（media-service.ts:168） | **热生效** |
| Media 插件加载 | `POST /api/media/plugins/reload` 热重载插件文件 | 热生效 |
| 配置持久化 | `PUT /api/config` 写 config.yaml + `config.reload()` | 热重载 |
| 运行信息 | `GET /api/runtime`（active + 插件状态）、`GET /api/media/plugins` | 只读 |
| 桌面重启 | `window.api.mafw.gateway.restart()` → main 进程 `stopGateway()+startGateway()`（mafw-ipc.ts:80） | sidecar 重启 |

> 注：`config.reload()` 只把 `server`/`paths` 标为 restart-required；`runtime.plugin` 改动虽热载入 config 对象，但 runtime 实例不重建，故切换仍需重启。

## 架构

```
Config 页（桌面）
  ├─ GET /api/runtime          → 可用 runtime 列表 + active（下拉选项）
  ├─ GET /api/media/plugins    → 可用 media 引擎 + 状态（下拉选项）
  │
  ├─ 选 Runtime ──▶ POST /api/runtime/switch ──▶ 二次确认框（confirm()）
  │        └── 确认 ──▶ 进程内热切换（createRuntime + resubscribeEvents）──▶ 响应即时生效
  └─ 选 Media  ──▶ POST /api/media/switch ──▶ 热生效（无重启）

gateway 进程
  ├─ runtime/switch  → 校验 runtimeLoader.get(name) → persistOverrides() 持久化 → createRuntime() 重建 → resubscribeEvents() 重订阅 → 返回 active（无 restartRequired）
  │       └─ env MAFW_RUNTIME_PLUGIN 优先级高于 config.yaml（文档限制，不阻断）
  ├─ runtime/reload  → 重新扫描插件目录（不切换 runtime）
  └─ media/switch    → 校验引擎 → persistOverrides() 持久化 → mediaPluginLoader.reload() → 返回 media（无 restartRequired）
          └─ 未知引擎 **fail-closed**，返回 400
```

## 组件设计

### 1. 后端端点（gateway/src/index.ts 路由区）

**`POST /api/runtime/switch`**（实际实现：`gateway/src/routes/runtime-switch.ts`）

```typescript
// Body: { plugin: string }   // "pi" | "opencode" | 用户插件名 | ""（回退默认 opencode）
const plugin = (body.plugin ?? '').trim();
if (plugin && plugin !== 'opencode') {
  const found = deps.loader?.get(plugin);   // 校验插件存在
  if (!found) { 400: { error: `runtime plugin '${plugin}' not found`, available: [...] } }
}
// 持久化：Config.persistOverrides({ runtime: { plugin } })
// 进程内热切换：
//   1. deps.createRuntime() — 重建 runtime 实例
//   2. deps.onSwitched(rt, prev) — 接线 client/caps/name + resubscribeEvents()
// 返回 { success: true, active: { name, capabilities }, envOverride }
// （无 restartRequired — 热切换即时生效）
```

- **热切换**（~~不自动重启~~）：进程内重建 + 事件流重订阅，响应即时生效
- `opencode` 与空串等价（内置默认，`createRuntime` 回退路径），不需要 loader 校验
- **env 优先级注意**：`MAFW_RUNTIME_PLUGIN` 环境变量优先级高于 config.yaml——若用户设置了该环境变量，持久化的 `runtime.plugin` 不会生效。端点检测到 env 存在时返回 `envOverride: true`，UI 据此显示警告条「MAFW_RUNTIME_PLUGIN 环境变量将覆盖此设置」；不阻断切换

**新增 `POST /api/runtime/reload`**（原规格无此端点）

```typescript
// 无 body，重新扫描插件目录
// 返回 { plugins: PluginState[] }
```

- 便于开发场景热更新插件列表而不触发 runtime 切换
- 若 pluginLoader 不可用返回 503

**`POST /api/media/switch`**（实际实现：`gateway/src/routes/media-switch.ts`）

```typescript
// Body: { engine?, image?: { engine? }, video?: { engine? }, audio?: { engine? } }   // 嵌套对象，与 config.yaml 结构对齐
// 校验引擎：validateEngine() — pi 内置，其余须在 availableEngines() 列表中
// 未知引擎 → 400 { error, available }（**fail-closed**）
// 持久化：Config.persistOverrides({ media: mediaUpdate })
// 热加载：mediaPluginLoader.reload()
// 返回 { success: true, media: { engine, image, video, audio } }（无 restartRequired）
```

- **fail-closed**（~~fail-open~~）：未知引擎返回 400 + available 列表，让 UI 明确提示用户
- body 采用**嵌套对象** `{ image?: { engine? } }`（~~flat `{ image?: string }`~~），与 config.yaml `media.image.engine` 结构对齐
- 响应字段 `media`（~~`resolved`~~），无 `restartRequired`

### 2. SDK / preload 层

**gateway-sdk `MafwClient`**（opencode-dev/packages/gateway-sdk/src/client.ts）新增：

```typescript
runtime: {
  get: () => this.request<any>('/api/runtime'),
  switch: async (plugin: string) => { /* POST /api/runtime/switch */ },
  reload: async () => { /* POST /api/runtime/reload — 新增 */ },
},
media: {
  plugins: () => this.request<any>('/api/media/plugins'),
  switch: async (opts: { engine?: string; image?: { engine?: string }; video?: { engine?: string }; audio?: { engine?: string } }) => { /* POST /api/media/switch */ },
},
```

**桌面 preload**（opencode-dev/packages/desktop/src/preload/mafw-api.ts + mafw-types.ts）：

```typescript
runtime: { get: () => invoke("runtime", "get"), switch: (plugin) => invoke("runtime", "switch", plugin), reload: () => invoke("runtime", "reload") },
media: { plugins: () => invoke("media", "plugins"), switch: (opts) => invoke("media", "switch", opts) },
```

（`media` 命名空间已存在 `createTask` 等方法，直接扩展。）

### 3. 前端 UI（桌面 Config 页，新增「插件 Plugins」卡片）

位于 Gateway 运维段与 opencode 配置段之间。

**Runtime 段**
- 下拉列出可用 runtime：`opencode`（默认，标注） + `pi`（内置） + 用户 runtime-plugins（`GET /api/runtime` 中 `status === 'ok'` 的插件）
- 当前 `active.name` 高亮/置顶
- 选择非当前项 → `POST /api/runtime/switch` → 弹确认框「切换 runtime 将立即生效，确定？」→ 确认 → **进程内热切换**（~~无需 gateway.restart()~~）→ toast「已切换到 {name}」
- 若响应 `envOverride: true`，显示警告条「MAFW_RUNTIME_PLUGIN 环境变量将覆盖此设置」

**Media 段**
- 每模态一行：默认 / image / video / audio，各自下拉
- 选项来自 `GET /api/media/plugins`（含内置 pi），显示状态（ok/error）
- 选择 → `POST /api/media/switch`（只提交变更的字段，嵌套结构 `{ image?: { engine } }`）→ toast「已生效」（无需重启）
- 未知引擎返回 400，UI 提示「引擎不存在，请选择其他引擎」（~~非静默回退~~）

### 4. 测试策略

- **后端单测**（tests/unit/gateway/，沿用现有 server handler 测试模式）：
  - runtime/switch：插件存在放行、不存在 400、opencode/空串放行、持久化调用、返回 restartRequired
  - media/switch：partial 更新只改传入字段、触发 reload、返回 restartRequired: false
- **前端**：Config 页 `@ts-nocheck`，手动验证 + 现有模式（无独立单测框架）

## 验收标准

1. `POST /api/runtime/switch { plugin: 'pi' }` 后 `GET /api/runtime` 显示 active=pi（**即时生效，无需重启**）
2. 切换未知插件返回 400，gateway 不重启、配置不变
3. 桌面 Config 页 Runtime 下拉列出 opencode/pi/用户插件，active 高亮
4. Runtime 切换弹二次确认框，确认后 **进程内热切换**（~~gateway 自动重启~~）
5. `POST /api/media/switch { video: { engine: 'qwen-vl' } }` 后 video 模态走新引擎，热生效无需重启
6. Media 下拉显示各引擎状态，切换后 toast「已生效」
7. 未配置 runtime.plugin 时回退 opencode 的行为不变
8. switch 端点持久化 config.yaml 时通过 `Config.persistOverrides()` 整对象合并写入，不丢失其他配置节
9. 设置 `MAFW_RUNTIME_PLUGIN` 环境变量后，config.yaml 中的 `runtime.plugin` 不生效（文档限制）
10. `POST /api/media/switch { image: { engine: 'unknown-engine' } }` 返回 **400**（~~非静默回退~~），error 含 available 列表
11. 设置 `MAFW_RUNTIME_PLUGIN` 时切换返回 `envOverride: true`，UI 显示警告条
12. `POST /api/runtime/reload` 重新扫描插件目录，返回更新后的 plugins 列表

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| ~~切换 runtime 后 gateway 重启失败~~ | 热切换失败时 `createRuntime()` 抛异常，端点返回 500，旧 runtime 保持不变 |
| ~~重启导致进行中的会话中断~~ | 进程内热切换不中断 HTTP 连接；事件流重订阅期间的 SSE 事件通过 AbortController 取消旧订阅后重订阅 |
| 并发写 config.yaml | switch 端点通过 `Config.persistOverrides()` 原子写入，无额外风险 |
| 未知 runtime 插件误配置 | 端点先 `runtimeLoader.get` 校验，未知返回 400，不落盘 |
| 持久化 config.yaml 丢失其他配置节 | `persistOverrides()` 读 config.raw → deepMerge → 整对象写入（非子段覆写） |
| `MAFW_RUNTIME_PLUGIN` env 覆盖 config | 文档记录限制，端点不阻断；UI 提示该场景 |
| ~~未知 media 引擎静默回退~~ | **fail-closed**：未知引擎返回 400 + available 列表，UI 明确提示 |
| resubscribeEvents 期间事件丢失 | AbortController 取消旧订阅后立即重订阅，窗口期极短（~ms 级） |

## 后续扩展

- Media 插件热加载与 Runtime 插件在 UI 上区分「立即生效」提示（两者均已热切换）
- Web Dashboard 复用同一对端点
- `POST /api/runtime/reload` 扩展为支持指定目录扫描（开发场景）
