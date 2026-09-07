# 用量页 Token 统计与分模型统计（ccusage 风格）

日期：2026-09-07
状态：已批准（待实现）

## 背景与目标

UsageDock（桌面右栏 usage tab）目前只有会话/项目/记忆三个维度的 token 统计，缺少业界（ccusage / Claude Code `/usage`）标准的**时间窗口统计 + 分模型明细**。

实测数据（用户本机，重度使用 ~1170 turns/天）：

- `trajectory_turns` 8 活跃天 8.8 MB → 年化 ~230 MB，SQLite 无压力
- 全表 `GROUP BY provider, model` 实测 13ms；加 `created_at` 索引后一年规模仍为毫秒级
- 结论：**不需要每日聚合快照表**，trajectory_turns 全量保留 + 查询时现算即可

目标：

1. UsageDock 的「Token 统计」区块内新增分模型统计表，带时间窗口切换（今日/7天/30天/全部）
2. 成本列用模型价目表估算（复活 `model-prices.ts`）
3. 配额窗口（ProviderSection）从 usage tab 拆出，成为 RightDock 独立 `quota` tab

非目标：按天时间序列表格（ccusage daily report）、SSE 实时推送、trajectory_events 表的增长治理（年化 ~500MB，另行处理）。

## 数据层

**配置**：`gateway/src/config.ts` 新增 `trajectory.retentionDays`（默认 `365`；`0` = 永久保留；负数/非数回退默认）。

**trajectory-store.ts**：

- prune 逻辑从硬编码 14 天改读 `trajectory.retentionDays`（`0` 时跳过 turns 的 prune；goal_sessions 豁免规则保留；`trajectory_events` 的 prune 不在本次范围内，保持现状）
- 新增索引：`CREATE INDEX IF NOT EXISTS idx_traj_turn_created ON trajectory_turns(created_at);`
- 新增聚合方法：

```ts
interface ModelUsageRow {
  provider: string;
  model: string;
  turns: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

getModelUsageStats(sinceEpochSec: number | null): ModelUsageRow[]
// sinceEpochSec = null → 全部时间；否则 WHERE created_at >= since
// GROUP BY provider, model；tokens 各字段用 CAST(json_extract(tokens,'$.x') AS INTEGER) 求和
```

无新表、无双写、无回填。

## 成本估算

复活 `gateway/src/usage/model-prices.ts`（现为零 import 死代码）：聚合后对每个 `ModelUsageRow` 调 `calculateCost(model, tokens)` 得到 `estimatedCost`（JS 层计算，每次聚合仅几行，零开销）。

- 价格表命中与否由路由层用 `getModelPrice(model) === null` 判断：未命中 → `estimatedCost = null`（UI 显示 `—`）；命中 → 用 `calculateCost` 的结果（可能 legitimately 为 0）
- `getModelUsageStats` 返回的行由调用方（路由层）附加 `estimatedCost`，store 层不依赖价格表

## API

扩展现有 `GET /api/usage?sessionID=&projectID=`（`gateway/src/index.ts:4281`）响应，新增 `modelStats` 字段：

```ts
modelStats: {
  windows: {
    today: ModelUsageRowWithCost[];   // 本地时区零点起算
    '7d': ModelUsageRowWithCost[];    // 滚动 7 天
    '30d': ModelUsageRowWithCost[];   // 滚动 30 天
    all: ModelUsageRowWithCost[];     // 全部（since = null）
  }
}
// ModelUsageRowWithCost = ModelUsageRow & { estimatedCost: number | null }
```

- 四个窗口一次返回（行数极少），前端切换窗口不重请求
- 「今日」按**本地时区零点**起算（符合用户直觉）
- 复用现有端点与 15s 轮询，不加新端点、不加 SSE
- fail-open：聚合异常时 `modelStats.windows` 各窗口返回空数组，不影响响应其他字段
- `@mafw/sdk` 的 `sessions.usage()` DTO 同步补 `modelStats` 类型

## UI

### UsageDock（usage tab）：合并的「Token 统计」区块

现有三行（当前会话/当前项目/记忆系统，含 byRole 展开）保留原样，下方追加分模型区，同一可展开区块内：

```
▼ Token 统计
  当前会话     12.3k tokens   $0.02
  当前项目     456k tokens    $0.83
  记忆系统     89k  tokens    $0.15   ▸ byRole
  ─────────────────────────────
  按模型   (今日 | 7天 | 30天 | 全部)
  mimo-v2.5      ▓▓▓▓▓▓▓░░  45%   320k   $0.12
  qwen3.7-max    ▓▓▓▓░░░░░  30%   210k   $0.08
  gpt-4o         ▓▓░░░░░░░  15%   105k   —
```

- 每行：模型名 + 占比条 + token 百分比 + token 总量 + 估算成本
- hover（TooltipV2，`openDelay: 300`）显示五类 token 明细（input/output/reasoning/cacheRead/cacheWrite）与模型全名（含 provider 前缀）
- 模型名显示去掉 provider 前缀（`alibaba-cn/qwen3.7-max` → `qwen3.7-max`）
- 窗口切换 chip 为纯前端状态，默认「7天」
- 空态：显示「暂无用量数据」
- 遵守 §5.10 组件约定（TooltipV2 等，无裸 `<button>`/`title`）

### QuotaDock（新 quota tab）：配额窗口迁出

- 现 UsageDock 的 ProviderSection 配额区块整体搬到新组件 `QuotaDock.tsx`
- 保留「配置」按钮（dispatch `mafw:open-config` detail='usage' 跳 Config 页）
- `RightDock` tab 类型扩为 `"tasks" | "trajectory" | "usage" | "quota"`；localStorage 持久化逻辑不变
- `UsagePill`（Rail 底部，显示最紧张配额窗口）点击从开 usage tab 改为开 **quota** tab
- UsageDock 与 QuotaDock 各自 15s 轮询同一 `GET /api/usage` 端点（与现状模式一致）

## 错误处理

- `modelStats` 聚合异常 → 空 windows（fail-open）
- `retentionDays` 非法值 → 回退 365
- 价格表未命中 → `estimatedCost: null` → UI `—`

## 测试

- 单测 `getModelUsageStats`：窗口过滤、GROUP BY、缺 tokens 字段的 turn（内存 sqlite）
- 单测 `calculateCost`：已知模型 / `provider/model` 前缀归一化 / 未知模型返回 0；路由层对 `getModelPrice` 未命中的模型映射 `estimatedCost` 为 `null`
- 路由单测：`/api/usage` 响应含 `modelStats`、聚合异常 fail-open
- 保留期配置：prune 读取 `retentionDays` 的单测

## 文档

更新 `AGENTS.md`：trajectory 保留策略（14 天 → `trajectory.retentionDays` 默认 365）、`/api/usage` 响应新增 `modelStats`、RightDock 新 quota tab。
