# Usage 插件：蓝区统一网关 credit 配额 + ctx.usage 通用扩展

- 日期：2026-09-15
- 状态：已确认（用户 2026-09-15 批准设计）
- 范围：gateway usage 插件体系 + 桌面 QuotaDock tooltip

## 背景

用户在 opencode.jsonc 配置了自建网关 provider（providerID `gateway`，显示名「蓝区统一网关」，火山 APIG 托管，baseURL `https://st8tp3ajl0df3n8b8l8qu.apigateway-cn-beijing.volceapi.com/v1`）。配额模型：**credit 总量 + 每天/每周/每月用量上限**（单位均为 credit），**每个模型有独立的百万 token credit 价格**（`/v1/models` 响应每模型带 `credit` 字段，如 glm-5.3-flash 0.22、Kimi K3 4.51）。

探测结论（2026-09-15）：网关**没有**公开的配额/用量查询端点（`/quota`、`/billing/*`、`/credits`、`/account`、`/stats` 等十余个候选全部 404），唯一可用数据是 `/v1/models` 的 per-model credit 价格表。因此采用**本地计算**：限额用户手配，消耗由本地 trajectory 记录 × per-model credit 价格算出。

已知坑（memory mem_qycu8b / mem_wt1xsw）：身份权威是 providerID `gateway` 而非中文显示名；trajectory 中 gateway 模型 $ 成本为 0（model-prices 不覆盖），不能用 $ 路径推导。

## 设计决策

| 决策点 | 结论 |
|---|---|
| 数据来源 | 本地计算（用户确认）：限额手配 + trajectory 聚合 + /v1/models 价格表 |
| 限额语义 | `usage.pluginConfig.gateway: { credit, day, week, month }`，单位 credit，用户手配 |
| 窗口语义 | 滚动窗口，与 `aggregateProvider` 一致（cutoff = now − 24h/7d/30d，resetAt = 窗口内最早 turn + 窗口时长） |
| credit 窗口 | `balance` 窗口承载：全历史消耗 / credit 总限额 |
| per-model 展示 | credit 窗口 tooltip 明细（`detailLines`），不加独立 UI 列表（用户确认） |
| 插件形态 | builtin `gateway.js`（name = `gateway`，providerID 权威身份），用户插件同名可覆盖 |
| ctx 扩展 | **`ctx.usage` 升级为一等通用插件 API**（用户明确要求：用户插件必须能做到） |

## 改动清单

### 1. `gateway/src/usage/plugin-context.ts` — ctx.usage 通用能力

- `PluginContext` 增加 `usage?: { modelStats(opts?: { sinceMs?: number; provider?: string }): ModelUsageRow[] }`
- `createPluginContext(name, credentials, usageStats?)` 第三参可选注入（`TrajectoryStore.getModelUsageStats` 薄封装：sinceMs → epoch 秒换算，provider 过滤）；未注入时 fail-open 返回空数组
- `makeAdapter(mod, file, usageStats?)` 透传
- 导出正式接口签名，写进 README（`~/.mafw/usage-plugins/README.md` 的 README_CONTENT 模板）ctx 方法清单与示例

### 2. `gateway/src/usage/builtin-plugins/gateway.js` — 蓝区网关插件

```
fetch(ctx):
  1. key = ctx.apiKey('gateway'); 无 key → null
  2. cfg = ctx.pluginConfig('gateway') → { credit, day, week, month }（number，>0 生效）
  3. baseURL = cfg.baseURL || 默认网关地址（pluginConfig 可覆盖）
  4. 拉 GET {baseURL}/models（Bearer key，模块级缓存 5min）→ Map<model, credit价格/1M tok>
  5. stats = ctx.usage.modelStats({ provider: 'gateway' }) 按 4 个 sinceMs 切窗
  6. 每窗口：Σ(模型 tokens 总计 × credit价 / 1e6) = 消耗 credits
  7. 输出 windows：
     - balance: used=全历史消耗, limit=cfg.credit, unit='credit', remaining, detailLines（分模型明细 "model: 12.3M tok · 2.7 credits"，按消耗降序取 top 8，其余聚合 "其他"）
     - day/7d/month: used/limit/pct/resetAt（滚动窗语义），limit ≤0 或未配则跳过该窗口
  8. 全空 → null
```

- `type: 'token-plan'`、`plan: '蓝区统一网关'`
- `configSchema`：credit/day/week/month 四个 number 字段（桌面 Config 页自动出表单）+ baseURL string 字段
- tokens 计数口径：input+output+reasoning+cache.read+cache.write（与 UsageDock 一致）

### 3. `gateway/src/usage/types.ts` — 类型扩展

- `WindowType` 加 `'day'`；`UsageWindow.unit` 加 `'credit'`；`UsageWindow` 加可选 `detailLines?: string[]`
- UI 本来就走 generic 渲染分支，仅类型补全

### 4. `gateway/src/usage/usage-poller.ts` — budget 折叠守卫

现状：插件 provider 若 `budgets[name] > 0`，poller 把插件全部窗口**替换**成单 budget balance 窗口（会静默吞掉 day/7d/month 窗口）。
改动：仅当插件结果窗口**全部为 `balance`** 时才应用 budget 折叠；含其他窗口类型时跳过一次 warn 日志并透传原窗口。

### 5. `packages/desktop/.../QuotaDock.tsx` — tooltip detailLines

- tooltip 组装处：`w.detailLines` 存在时逐行追加（`\n` 拼接）
- 无其他渲染改动

### 6. 接线（gateway/src/index.ts ~1915）

- `PluginLoaderOptions` 增加 `usageStats?`；`scan()` 内 `makeAdapter(mod, file, usageStats)` 透传
- 构造处：`new PluginLoader(pluginsDir, [], { builtinPluginsDir, disabledPlugins, usageStats: makeUsageStats(trajStore) })`（trajStore 已在作用域；薄封装 sinceMs→epoch 秒 + provider 过滤）

## 错误处理

- /v1/models 拉取失败：用上次缓存；无缓存 → per-model 价格缺失 → 该模型消耗按 0 计并记 warn（不阻塞窗口输出）
- trajectory 无 gateway 记录：消耗 0，窗口仍输出（0%）
- cfg 全未配 → 返回 null（不显示卡片）
- apiKey 缺失 → null

## 测试（TDD）

1. plugin-context：usage 注入透传 + 缺省 fail-open
2. gateway.js：mock ctx（fetch 返回 models 价格表、usage.modelStats 返回分模型 tokens）→ 断言 4 窗口数值/pct/resetAt/detailLines
3. usage-poller：budget 折叠守卫回归（纯 balance 折叠 / 含 day 透传）
4. configSchema：四字段校验通过（现有 usage-plugin-schema 测试模式）
5. builtin-discovery：gateway 出现在 builtin 列表

## 明确不做（YAGNI）

- 用 credit 价格修 model-prices 的 $0.00 成本显示（credit ≠ $，语义不同，另案）
- per-model 独立 UI 列表 / 展开组件
- 网关真实配额端点对接（不存在）
