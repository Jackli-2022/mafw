# Runtime / Media 插件切换器设计规格

## 概述

在 gateway 后端提供插件切换端点，在桌面 Config 页提供配套 UI，让用户以语义化方式切换 **Agent Runtime 插件**（opencode / pi / 用户 runtime-plugins）与 **Media 引擎插件**（默认 pi / 用户 media-plugins），取代目前手改 `config.yaml` 裸字段的低效体验。

## 目标

- gateway 新增两个切换端点：`POST /api/runtime/switch`、`POST /api/media/switch`
- 桌面 Config 页新增「插件」卡片：Runtime 下拉 + Media 每模态下拉
- Runtime 切换需重启 gateway（二次确认后自动重启）；Media 切换热生效（无需重启）
- 保留现有 fail-open：未知/失败的插件不阻塞，回退内置实现

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
  ├─ 选 Runtime ──▶ POST /api/runtime/switch ──▶ 二次确认框
  │        └── 确认 ──▶ window.api.mafw.gateway.restart() ──▶ gateway-state 刷新
  └─ 选 Media  ──▶ POST /api/media/switch ──▶ 热生效（无重启）

gateway 进程
  ├─ runtime/switch  → 校验 runtimeLoader.get(name) → 合并写入 config.raw（整对象）→ 返回 restartRequired
  │       └─ env MAFW_RUNTIME_PLUGIN 优先级高于 config.yaml（文档限制，不阻断）
  └─ media/switch    → 合并写入 media 配置（整对象）→ mediaPluginLoader.reload() → 返回 resolved
          └─ 未知引擎 fail-open，不校验 400
```

## 组件设计

### 1. 后端端点（gateway/src/index.ts 路由区）

**`POST /api/runtime/switch`**

```typescript
// Body: { plugin: string }   // "pi" | "opencode" | 用户插件名 | ""（回退默认 opencode）
const plugin = (body.plugin ?? '').trim();
if (plugin && plugin !== 'opencode') {
  const found = this.runtimeLoader?.get(plugin);   // 校验插件存在
  if (!found) { 400: { error: `runtime plugin '${plugin}' not found` } }
}
// 持久化 config.yaml：读 config.raw → 合并 runtime.plugin → 整对象写入
// （复用 PUT /api/config 的写入路径；务必合并而非只写子段，否则清掉其他配置节）
// 返回 { success: true, restartRequired: true, target: plugin || 'opencode',
//        envOverride: !!process.env.MAFW_RUNTIME_PLUGIN }
// （target 为已写入的配置目标；当前 active 仍为旧 runtime，需重启后生效）
```

- **不自动重启**：重启由前端协调，避免与桌面 sidecar 的 `stopGateway/startGateway` 生命周期管理冲突
- `opencode` 与空串等价（内置默认，`createRuntime` 回退路径），不需要 loader 校验
- **env 优先级注意**：`MAFW_RUNTIME_PLUGIN` 环境变量优先级高于 config.yaml——若用户设置了该环境变量，持久化的 `runtime.plugin` 重启后不会生效。端点检测到 env 存在时返回 `envOverride: true`，UI 据此显示警告条「MAFW_RUNTIME_PLUGIN 环境变量将覆盖此设置」；不阻断切换

**`POST /api/media/switch`**

```typescript
// Body: { engine?, image?, video?, audio? }   // partial，undefined 保留原值
// 持久化 media.engine / media.{kind}.engine（读 config.raw → 合并 → 整对象写入）
// await this.mediaPluginLoader.reload()   // 热加载插件文件
// 返回 { success: true, restartRequired: false, resolved: { engine, image, video, audio } }
```

- **校验不对称（有意为之）**：未知 media 引擎不校验——与 fail-open 哲学一致，未知引擎持久化后静默回退默认 pi（`resolvePrompt` 的 `?? cfg.engine ?? 'pi'` 兜底）。返回 `resolved`（实际生效的每模态引擎名）供 UI 提示，不做 400 拒绝

### 2. SDK / preload 层

**gateway-sdk `MafwClient`**（opencode-dev/packages/gateway-sdk/src/client.ts）新增：

```typescript
runtime: {
  get: () => this.request<any>('/api/runtime'),
  switch: async (plugin: string) => { /* POST /api/runtime/switch */ },
},
media: {
  plugins: () => this.request<any>('/api/media/plugins'),
  switch: async (opts: { engine?: string; image?: string; video?: string; audio?: string }) => { /* POST /api/media/switch */ },
},
```

**桌面 preload**（opencode-dev/packages/desktop/src/preload/mafw-api.ts + mafw-types.ts）：

```typescript
runtime: { get: () => invoke("runtime", "get"), switch: (plugin) => invoke("runtime", "switch", plugin) },
media: { plugins: () => invoke("media", "plugins"), switch: (opts) => invoke("media", "switch", opts) },
```

（`media` 命名空间已存在 `createTask` 等方法，直接扩展。）

### 3. 前端 UI（桌面 Config 页，新增「插件 Plugins」卡片）

位于 Gateway 运维段与 opencode 配置段之间。

**Runtime 段**
- 下拉列出可用 runtime：`opencode`（默认，标注） + `pi`（内置） + 用户 runtime-plugins（`GET /api/runtime` 中 `status === 'ok'` 的插件）
- 当前 `active.name` 高亮/置顶
- 选择非当前项 → `POST /api/runtime/switch` → 弹确认框「切换 runtime 将重启 Gateway，确定？」→ 确认 → `window.api.mafw.gateway.restart()` → 监听 `gateway.onStateChange` 恢复 ready 后重新拉取 runtime 状态 + toast「已切换到 {name}」
- 若响应 `envOverride: true`，显示警告条「MAFW_RUNTIME_PLUGIN 环境变量将覆盖此设置」

**Media 段**
- 每模态一行：默认 / image / video / audio，各自下拉
- 选项来自 `GET /api/media/plugins`（含内置 pi），显示状态（ok/error）
- 选择 → `POST /api/media/switch`（只提交变更的字段）→ toast「已生效」（无需重启）；若 `resolved` 与所选不一致（引擎缺失回退 pi），提示「{engine} 不存在，已回退默认引擎」

### 4. 测试策略

- **后端单测**（tests/unit/gateway/，沿用现有 server handler 测试模式）：
  - runtime/switch：插件存在放行、不存在 400、opencode/空串放行、持久化调用、返回 restartRequired
  - media/switch：partial 更新只改传入字段、触发 reload、返回 restartRequired: false
- **前端**：Config 页 `@ts-nocheck`，手动验证 + 现有模式（无独立单测框架）

## 验收标准

1. `POST /api/runtime/switch { plugin: 'pi' }` 后 `GET /api/runtime` 显示 active=pi（重启后）
2. 切换未知插件返回 400，gateway 不重启、配置不变
3. 桌面 Config 页 Runtime 下拉列出 opencode/pi/用户插件，active 高亮
4. Runtime 切换弹二次确认框，确认后 gateway 自动重启并刷新
5. `POST /api/media/switch { video: 'qwen-vl' }` 后 video 模态走新引擎，热生效无需重启
6. Media 下拉显示各引擎状态，切换后 toast「已生效」
7. 未配置 runtime.plugin 时回退 opencode 的行为不变
8. switch 端点持久化 config.yaml 时必须整对象合并写入，不丢失其他配置节
9. 设置 `MAFW_RUNTIME_PLUGIN` 环境变量后，config.yaml 中的 `runtime.plugin` 不生效（文档限制）
10. `POST /api/media/switch { image: 'unknown-engine' }` 不返回 400，返回 `resolved.image` 显示实际回退引擎名
11. 设置 `MAFW_RUNTIME_PLUGIN` 时切换返回 `envOverride: true`，UI 显示警告条

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 切换 runtime 后 gateway 重启失败 | 复用现有 sidecar 重启机制 + 健康轮询；UI 显示 Reconnecting/失败状态 |
| 重启导致进行中的会话中断 | 明确文案「切换 runtime 将重启 Gateway」；与现有 Restart 按钮行为一致 |
| 并发写 config.yaml | switch 端点复用 PUT /api/config 的原子写入路径，无额外风险 |
| 未知 runtime 插件误配置 | 端点先 `runtimeLoader.get` 校验，未知返回 400，不落盘 |
| 持久化 config.yaml 丢失其他配置节 | 端点读 config.raw → 合并目标字段 → 整对象写入（非子段覆写） |
| `MAFW_RUNTIME_PLUGIN` env 覆盖 config | 文档记录限制，端点不阻断；UI 提示该场景 |
| 未知 media 引擎静默回退 | fail-open 哲学，返回 `resolved` 让 UI 显示实际生效引擎，不 400 |

## 后续扩展

- Media 插件热加载与 Runtime 插件（刻意无热加载）在 UI 上区分「立即生效」/「需重启」提示
- Web Dashboard 复用同一对端点
