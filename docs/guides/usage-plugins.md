# Usage Provider 插件

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## Usage Provider Plugin System

### 架构概述

所有 8 个内置适配器已重构为 JS 插件（commit c2faeef4），采用双目录加载机制：
- **内置插件**：`dist/usage/builtin-plugins/`（随包分发）
- **用户插件**：`~/.mafw/usage-plugins/`（用户同名文件覆盖内置）

Gateway 仅提供 PluginLoader + ctx + UsagePoller；UI 保持通用。

### 插件类型

| 类型 | 适配器 | 窗口类型 |
|------|--------|----------|
| `api` | deepseek, kimi, openrouter, siliconflow-cn | balance（余额/限额）|
| `token-plan` | opencode-go, zhipuai-coding-plan, kimi-for-coding, commandcode | 5h / 7d / month |

**内置插件 `gateway`（蓝区统一网关）**：credit 总量 + day/7d/month 滚动窗口；限额经 Config 页插件参数表单手配（`usage.pluginConfig.gateway: { credit, day, week, month, baseURL? }`），消耗 = 本地 trajectory tokens × `GET {baseURL}/models` 的 per-model credit 价格（5min 缓存）。注意：`usage.budgets.gateway > 0` 仅在插件结果为纯 balance 窗口时才折叠（含 day/7d/month 窗口时跳过并 warn）。

### 插件接口

```javascript
module.exports = {
  name: 'my-provider',
  type: 'api' | 'token-plan',
  plan: 'Plan Name',
  async fetch(ctx) {
    // ctx.apiKey(name) - 读取 auth.json 中的 provider key
    // ctx.cookie(name) - 读取 config.usage.cookies[name]
    // ctx.pluginConfig(name) - 读取 config.usage.pluginConfig[name]
    // ctx.usage.modelStats({ sinceMs?, provider? }) - 本地 trajectory 分模型 token 统计（滚动窗；缺省返回 []）
    // ctx.fetch(url, opts) - 带 10s 超时的 fetch
    // ctx.pluginConfig(name) - 读取 config.usage.pluginConfig[name]
    // ctx.log - gateway logger
    return {
      name: 'my-provider',
      type: 'api',
      plan: 'Plan Name',
      windows: [{ window: 'balance', used, limit, unit: '$', pct }],
    };
  },
};
```

### 特定适配器实现细节

#### KimiCodingPlanAdapter（kimi-for-coding）

**Bug 修复**（commit 69bfebf6）：
- 旧实现：所有 limit items 硬编码 `window:'5h'`
- 新实现：映射 `window.duration`（分钟）→ 窗口类型
  ```javascript
  const durationToWindow = { 300: '5h', 10080: '7d', 43200: 'month' };
  ```
- 回退：未匹配的 duration 默认 `'5h'`
- 月度窗口：当 `limits[]` 中无月度限制时，从 `root.usage.{limit,used}` 添加月度窗口

#### CommandCodeAdapter（commandcode）

**API 结构**（https://api.commandcode.ai/internal/billing/credits）：
- `body.windowLimits`（顶层，非 `body.credits.windowLimits`）：`fiveHour`/`weekly` 含 `cap`+`used`+`resetAt`
- `body.credits.monthlyCredits`：月度剩余（无硬性上限）

**月度窗口实现**：
```javascript
windows.push({
  window: 'month',
  used: monthlyCredits,
  limit: 0,      // 无硬性上限
  unit: '$',
  pct: 0,        // 显示为无限样式
});
```

### 配置

```yaml
usage:
  disabledPlugins: []  # 禁用的插件名称列表
  cookies: {}          # session cookies（如 commandcode）
  pluginConfig: {}     # 插件自定义配置
```
