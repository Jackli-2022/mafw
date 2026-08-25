# Usage Provider 插件系统设计

**日期**: 2026-08-25
**状态**: 已批准

## 目标

把用量统计的 provider 适配器（ExternalAdapter）从 gateway 源码中解耦为**用户可插拔的 JS 插件**：需要新 provider 时，往插件目录丢一个 `.js` 文件即可，不用改 gateway 代码、不用发版。

## 关键决策（已确认）

| 决策点 | 结论 |
|--------|------|
| 插件形式 | **JS 文件插件**（CJS，`module.exports`），非 npm 包、非声明式 JSON |
| 内置适配器 | **保留在 gateway 源码**（8 个：opencode-go、zhipu、kimi×2、commandcode、deepseek、openrouter、siliconflow），插件同名可覆盖内置 |
| 加载时机 | **热加载**：fs.watch 插件目录，300ms 防抖，require cache 清理 |
| 前端显示 | **零改动**：UsageDock 已动态渲染 providers 数组，新 provider 自动出现 |
| 前端补充 | 配置面板新增「插件」管理区（状态列表 + 打开目录 + 手动重载） |

## 架构

```
~/.mafw/usage-plugins/
  README.md               ← 插件编写说明（首次启动自动生成）
  example.js.disabled     ← 模板（首次启动自动生成）
  my-provider.js          ← 用户插件

gateway/src/usage/
  plugin-loader.ts        ← 新增：扫描/加载/热重载/状态记录
  external-adapters.ts    ← 不变：8 个内置适配器
  usage-poller.ts         ← 改动：adapters = [...plugins, ...builtins]，插件同名优先

HTTP API:
  GET  /api/usage/plugins         ← 新增：插件状态列表
  POST /api/usage/plugins/reload  ← 新增：手动重载（兜底）

Desktop:
  UsageDock 配置面板        ← 新增「平台插件」区
  preload/mafw-api          ← 新增 usagePlugins / usagePluginsReload / openUsagePluginsDir
```

## 插件 API

一个文件一个 provider，CJS 模块：

```js
// ~/.mafw/usage-plugins/example.js
module.exports = {
  name: "my-provider",        // provider 名；与内置同名则覆盖内置实现
  plan: "My Plan",            // 显示名
  async fetch(ctx) {
    const key = ctx.apiKey("my-provider");   // 读 opencode auth.json
    if (!key) return null;                   // null = 隐藏，回退本地轨迹统计
    const res = await ctx.fetch("https://api.example.com/usage", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    return {
      name: "my-provider",
      plan: "My Plan",
      windows: [{
        window: "5h",              // "5h" | "7d" | "month" | "balance"
        used: 5.6,
        limit: 14,
        unit: "$",                 // "$" | "pct" | "count"
        pct: 40,
        resetAt: Date.parse(data.reset),  // 可选
        remaining: 8.4,                   // 可选（余额显示）
      }],
    };
  },
};
```

### PluginContext（ctx）

| 方法 | 说明 |
|------|------|
| `ctx.apiKey(name)` | 读 `~/.local/share/opencode/auth.json` 里该 provider 的 key，无则 null |
| `ctx.cookie(name)` | 读 `usage.cookies[name]`（config.yaml），无则 null |
| `ctx.fetch(url, opts)` | 内置 10s `AbortSignal.timeout` 的 fetch 包装 |
| `ctx.pluginConfig(name)` | 读 `usage.pluginConfig[name]`（config.yaml 手写，可选） |
| `ctx.log` | gateway logger（log.info/warn/error） |

### 契约

- 返回 `null` → provider 隐藏，poller 自动回退本地轨迹统计（现有行为）
- 抛异常 → loader 捕获记日志，**不影响其他插件和内置适配器**
- `severity` 由 poller 统一按 `max(windows[].pct)` 计算，插件不用返回
- 返回值结构校验：缺 `name`/`windows` 或非数组 → 视为加载错误

## 热加载

- `fs.watch('~/.mafw/usage-plugins/')`，事件后 **300ms 防抖**重扫目录
- 加载用 `require()`（gateway 编译为 CJS），重载前 `delete require.cache[require.resolve(file)]`
- **fail-open**：插件语法错误/fetch 抛错 → 记日志 + 保留该 name 的上一个好版本；全新插件加载失败则不注册
- 目录不存在时自动创建，并写入 `README.md`（插件 API 说明）+ `example.js.disabled`（模板）
- `.disabled` / 非 `.js` 后缀文件跳过

### 加载状态记录

loader 维护 `Map<fileName, {name?, status: 'ok'|'error', error?, overridden: boolean}>`：

- `overridden: true` = 插件 name 与内置适配器同名，已覆盖内置
- 经 `GET /api/usage/plugins` 暴露给前端

## 配置集成

- `usage.cookies.<name>`：已有，插件经 `ctx.cookie()` 读取，Desktop 配置编辑器已支持任意 cookie 名
- `usage.pluginConfig.<name>`：新增可选配置段（手写 config.yaml），插件经 `ctx.pluginConfig()` 读取；**不做 UI**（YAGNI）

## HTTP API

```
GET /api/usage/plugins
→ { plugins: [{ file, name?, status, error?, overridden }] }

POST /api/usage/plugins/reload
→ { ok: true, plugins: [...] }   // 重扫目录后返回最新状态
```

## Desktop 前端（UsageDock 配置面板新增「平台插件」区）

```
平台插件
  ✅ my-provider.js    (my-provider)
  ❌ glm-custom.js     语法错误: Unexpected token ...
  ✅ kimi.js           覆盖内置: kimi
  [📂 打开插件目录] [🔄 重新加载]
```

- 插件状态列表：随 usage 轮询顺带刷新（不新增定时器）
- **打开插件目录**：desktop 新增 IPC → `shell.openPath(pluginsDir)`（Windows 弹资源管理器）
- **重新加载**：调 `POST /api/usage/plugins/reload`（watch 未触发时的兜底）
- cookie 编辑区已通用，无需改动

## 错误处理

| 场景 | 行为 |
|------|------|
| 插件语法错误 | 记日志 + status='error' + 保留旧版本（如有） |
| fetch 抛异常 | poller 现有 catch 兜底，记日志，该 provider 本轮缺失（lastGood 保留） |
| 返回结构非法 | 视为加载错误，status='error' 注明原因 |
| 目录被删 | watch 报错记日志，loader 停止 watch，下次 poll 用现有插件 |
| 两个插件同名 | 按文件名字典序，先加载的生效，后加载的记 warn + status='error'（duplicate） |

## 测试

- **plugin-loader 单测**（临时目录隔离）：
  - 扫描加载正常插件
  - 同名插件覆盖内置适配器
  - 语法错误插件 fail-open（不崩、status=error）
  - `.disabled` 文件跳过
  - 重载：删除 require cache 后新代码生效
- **端到端**：临时目录放 example 插件 → poller.poll() → providers 含插件结果

## 范围外（YAGNI）

- ❌ npm 包形式插件
- ❌ ESM 插件（gateway 是 CJS，插件统一 CJS）
- ❌ 沙箱隔离（本机可信场景，与 python kernel 一致）
- ❌ 插件市场 / 安装命令
- ❌ 声明式 JSON 适配器
- ❌ pluginConfig 的 UI 编辑器
- ❌ 前端 provider 显示逻辑改动（已动态化）
