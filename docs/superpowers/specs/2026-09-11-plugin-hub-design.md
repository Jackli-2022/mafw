# 插件中心（Plugin Hub）设计

日期：2026-09-11
状态：已与用户对齐（来源=仅本地文件；覆盖四类插件；统一 enable/disable；架构=方案 C）

## 1. 背景与动机

MAFW 有四套互相独立的插件系统，但**没有任何 UI 安装/管理入口**——安装全靠手动往
`~/.mafw/*-plugins/` 丢 `.js` 文件。纯桌面用户（无全局 CLI、不碰终端）完全没有
可行的插件安装路径；四类插件分散在 Config 页不同卡片里，状态不可见、无法管理。

Hermes Agent 调研（2026-09-11，源码实证）验证了可行架构：gateway 拥有统一插件管理
API（JSON-RPC `plugins.manage`：list/toggle/install/update），desktop 与 TUI 都是
薄客户端。MAFW 的四类插件均为**单文件 CJS .js**（无需 Hermes 的 git clone/SHA pin/
双半安装重流程），且四类都有热重载（可免 Hermes 的 gateway 重启）。

本设计同时履行 2026-09-09 UI 工具卡插件系统 YAGI 清单第 ① 项（桌面 Config 页插件
管理卡）。

## 2. 目标 / 非目标

**目标**
- 桌面 Config 页插件中心：四类插件的列表、状态、安装（本地文件）、启用/禁用、删除
- gateway 统一 REST API，desktop / 未来 TUI 薄客户端复用
- 禁用机制对四个加载器**零改动**（标记文件约定）

**非目标（v1 明确不做）**
- URL / Git 仓库安装、SHA pin、catalog 信任模型（Hermes 模式，v2 再议）
- TUI plugins tab（API 就绪后可随时加）
- 插件间依赖、流式渲染、Widget 词汇扩展（沿用 UI 插件 YAGI ②③④）
- 插件签名/沙箱（与现状一致：本机可信场景）

## 3. 架构

```
Desktop（Config 页） / TUI（未来）
        │ window.api.mafw.plugins.* → SDK → HTTP
        ▼
Gateway PluginsHub（新：gateway/src/plugins/hub.ts + routes/plugins.ts）
  GET  /api/plugins                 聚合四类
  POST /api/plugins/install         {type, filename, contentBase64, overwrite?}
  POST /api/plugins/enable          {type, filename}
  POST /api/plugins/disable         {type, filename}
  POST /api/plugins/delete          {type, filename}
        │ 文件操作 + 内部触发重载（不 self-HTTP）
        ▼
~/.mafw/runtime-plugins/   → RuntimePluginLoader 重扫（/api/runtime/reload 同源）
~/.mafw/media-plugins/     → MediaPluginLoader.reload()
~/.mafw/usage-plugins/     → usage PluginLoader.reload()
~/.mafw/ui-plugins/        → 不触发（Electron main fs.watch 自动热重载）
```

- Electron main **零改动**：ui-plugins 加载器已有 fs.watch 热重载（`ui-plugins.ts:139-145`）。
- usage 既有向导端点（`/api/usage/plugins/create|source|test|delete|reload`）原样保留，
  hub 是聚合门面，不重复不破坏。
- 攻击面论证：本机任意用户级进程本就可直接写 `~/.mafw/*-plugins/`，HTTP 端点无提权；
  先例 `POST /api/usage/plugins/create` 已在写可执行插件源码。

## 4. 数据模型

### 目录与加载器现状（已逐一核实）

| 类型 | 目录 | 加载器 | 热重载 | 备注 |
|---|---|---|---|---|
| runtime | `~/.mafw/runtime-plugins/` | `RuntimePluginLoader`（`gateway/src/runtime/loader.ts`） | 无自动，重扫走 `POST /api/runtime/reload` | 能力合并，单激活 |
| media | `~/.mafw/media-plugins/` | `MediaPluginLoader` | `reload()` + 每模态路由 | 目录已用 `example.js.disabled` 示例——**标记约定现成** |
| usage | `~/.mafw/usage-plugins/` | `PluginLoader` | `reload()` + builtin override | 另有 config `usage.disabledPlugins` |
| ui | `~/.mafw/ui-plugins/`（env `MAFW_UI_PLUGINS_DIR` 覆盖） | desktop main `ui-plugins.ts` | fs.watch | gateway 侧只读扫描 |

### 插件条目（GET /api/plugins 返回）

```jsonc
{
  "plugins": [{
    "type": "runtime|media|usage|ui",
    "name": "foo",              // 去掉 .js / .js.disabled 后缀
    "file": "foo.js",
    "status": "enabled | disabled | error | config-disabled",
    "error": "...",             // 仅 error 态，来自各 loader getState()
    "size": 1234,
    "mtime": "2026-09-11T..."
  }]
}
```

> `error` 态仅来自三个 gateway 侧 loader（runtime/media/usage）的 getState()；
> ui 条目只会有 enabled/disabled（其加载错误仅存在于 desktop 日志，gateway 侧不感知）。

### 禁用语义（标记文件）

- 禁用 = `foo.js` 改名 `foo.js.disabled`；启用 = 改回。
- 四个加载器都只扫 `*.js`（已核实四处 `endsWith('.js')`），禁用文件**天然跳过，加载器零改动**。
- media 插件禁用后其声明的模态自动回退默认 pi 引擎（`MediaService.resolvePrompt` 路由
  不再命中该文件）。
- `status=config-disabled` 仅 usage：命中 config `usage.disabledPlugins`（兼容只读展示；
  hub 的 enable/disable 只操作标记文件，不动 config）。
- 特例：禁用**当前激活**的 runtime 插件不会卸载已运行实例（切换走 Runtime 下拉），
  hub 对该条目显示提示文案。
- 重名去重：`foo.js` 与 `foo.js.disabled` 并存时，enabled 优先并列出警告字段。

### 安全约束

- type 枚举四类；filename 白名单 `^[A-Za-z0-9._-]+\.js$`；
  `path.resolve(dir, filename)` 必须仍在 dir 内（防穿越）；大小上限 2MB；
  contentBase64 解码后非空。
- install 重名（含 `.disabled` 变体）返回 409，除非 `overwrite: true`。

## 5. Gateway 实现

- 新模块 `gateway/src/plugins/hub.ts`：纯文件操作 + 校验 + 重载路由，deps 注入
  （dirs、loaders、fs 可注入）可单测。
- 新路由 `gateway/src/routes/plugins.ts`：HTTP 解包 + deps 装配（与
  `routes/runtime-switch.ts` 同模式），`index.ts` 薄接线；**注册位置必须在前缀
  `/api/plugins` 与既有 usage 路由不冲突**（usage 路由为 `/api/usage/plugins/...`，
  无重叠）。
- 重载路由：install/enable/disable/delete 成功后按 type 内部调用对应 loader
  （runtime 重扫用 runtime/reload 端点同源逻辑；ui 不调用）。
- runtime 特例：重扫后当前激活 runtime 不变；能力集变化由既有 switch 流程感知。

## 6. 前端 UI（Config → Plugins 升级为插件中心）

- 保留现有导航位（`plugins` nav），从「切换 Runtime 与媒体分析引擎」扩为四类分组卡片：
  - 每条目卡：名称、状态徽标（启用/禁用/错误/config）、`SwitchV2` 启用开关、
    删除按钮（`confirm()` 二次确认）、大小/时间、错误详情折叠
  - 顶部「安装插件」→ 对话框（Dialog）：类型下拉（默认 runtime）→ 文件选择器
    （accept `.js`）→ 显示文件名/大小 → **风险提示（安装即执行任意本地代码）** →
    安装 → `ToastV2` + 刷新列表
  - 现有 Runtime 单选切换、Media 每模态引擎下拉**保留原位**（激活控制与启用/安装正交）
- 组件约定：`ButtonV2` / `SwitchV2` / `Dialog` / `ToastV2`，禁裸 `<button>`（§5.10）

## 7. SDK / IPC 接线

- `@mafw/sdk`（packages/gateway-sdk）新增 `plugins` 命名空间：
  `list() / install() / enable() / disable() / delete()`，DTO 类型同步。
- preload `window.api.mafw.plugins.*` + `mafw-ipc.ts` 透传（同 runtime/media 模式）。

## 8. 错误处理

- loader getState 报 error 的条目：列表标 `error` + 错误详情，不阻塞其他条目
- install 写入失败 / 校验失败：400/409 带原因，不产生半写状态（先写 `.tmp` 再 rename）
- 目录不存在：hub 与 loader 一致 fail-open（自动创建目录）
- gateway 只读扫 ui 目录遇到 env 覆盖不一致（desktop 与 gateway 进程 env 不同）：
  按各自 fallback 显示，文档标注已知限制

## 9. 测试计划（TDD）

- gateway：hub 纯逻辑单测（校验/穿越防护/改名/install 覆盖语义/重载路由，temp 目录注入）
  + 路由 deps 注入测试（沿用 routes/*.ts 测试模式）
- desktop：列表聚合/状态映射/重名去重纯函数测试；bun test 全量回归
- 手工冒烟：安装坏插件（fail-open，列表 error 不崩）→ disable 后对应功能回退
  （media 模态回退 pi）→ 删除后 fs.watch 热重载生效

## 10. 实施顺序建议

1. gateway hub 模块 + 路由（TDD）
2. SDK plugins 命名空间 + preload/IPC
3. Config 页插件中心 UI
4. 全量测试 + 打包冒烟
