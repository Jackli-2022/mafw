# 新记忆配置面如何体现到 Desktop 侧：现状盘点与分级建议（2026-09-29）

> 背景：A/B 计划（ACT-R 结算、stale-verify 调度、FOK 校准、交错回放、goal 奖励、hit-proxy）新增了一批配置/参数。
> 本文盘点 desktop Config 页现状，回答三个问题：**哪些已经有路可达？哪些根本没进配置？哪些值得上 UI？**

## 0. TL;DR

1. **所有进了 config.yaml 的键已有可达路径**——Config 页第 9 个 section「MAFW 原始配置」就是 `GET/PUT /api/config` 的 UI（按段折叠 + 字段编辑 + 保存热 reload）。新键若只加 yaml，零 desktop 工作即"高级用户可改"。
2. **今天的参数大半是代码硬编码默认值**（ACT-R k/cap、21 天复习窗、goal +0.08、replayK=5、48h 排除窗、TTL 10min）——先决定哪些值得提升为 config 键，再谈 UI。
3. **建议只把 4 个"用户可感知"开关上 UI**（放 Memory section 新增「检索行为」卡）：FOK 门、快照、邻居呈现、reranker 引擎；其余留 yaml/硬编码。
4. **观测 > 控制**：desktop 侧真正缺的不是开关而是**可见性**——FOK 标本数/命中率、consolidation 判定分布、事件流计数应进 `/api/memory/stats`，让用户看到记忆系统在工作。

## 1. 现状盘点：Desktop 配置的三层暴露面

### 1.1 Config 页结构（`packages/desktop/src/renderer/mafw/pages/Config.tsx`，9 section）

| section | 内容 | 数据通道 |
|---|---|---|
| gateway | 进程管理/重启/日志 | — |
| desktop | 托盘偏好 | IPC |
| plugins | runtime/media/usage 引擎 hub | `GET /api/plugins` |
| models | worker 模型 + 媒体模型 | `/api/model-config`（专用） |
| **memory** | **仅嵌入引擎**（provider/engine/gpu） | `/api/memory/embedding-config`（专用，热切换） |
| usage | 用量/预算/cookies | `/api/usage*` |
| approvals | 审批白名单 | `/api/approvals/rules` |
| opencode | 原生配置编辑 | `/api/opencode-config` |
| **mafw** | **原始 config.yaml 编辑器**（段折叠+字段文本框） | `GET/PUT /api/config`（通用，整文件） |

### 1.2 通用通道的语义（`index.ts:3848-3877`）

- `GET /api/config` → `config.raw`（全量生效配置）
- `PUT /api/config` → **整文件替换**（写 data-root config.yaml）→ `config.reload()` 热生效；`server/paths` 段返回 `restartRequired`
- SDK `config.get/set` 做了合并（get 全量 → set 段级 merge → PUT 整体）——desktop 新卡片可直接复用，**不需要新 gateway 路由**
- 热生效矩阵：`search.*` 键全部 per-request 读（fok/snapshot/temporalNeighbors/reranker）→ 改完即时生效；`recall.workerModel` 下一次 worker prompt 生效；turnCompress 参数每次 cron 新建 pipeline → 下小时生效

### 1.3 专用卡片模式（embedding-config 范式）

`routes/embedding-config.ts`：deps 注入可单测、POST 校验枚举、**热重建 runtime**、SDK 命名空间 + Config 页卡片。
专用路由的价值 = 校验 + available 列表 + 触发副作用；**没有副作用的配置用通用通道即可**。

## 2. 今天新增配置面 × 三层分类

| 参数 | 位置 | 现状 | 建议 |
|---|---|---|---|
| FOK 门 `search.fok {enabled, probLow, probHigh}` | config.yaml | ✅ yaml 已有 / ❌ 无 UI | **上 UI**（校准后用户最想调的拒答行为） |
| 快照 `search.snapshot.enabled` | config.yaml | ✅ yaml / ❌ 无 UI | **上 UI**（SwitchV2 一键，用户可感知的边界注入模式） |
| 邻居呈现 `search.temporalNeighbors.presentation` | config.yaml | ✅ yaml / ❌ 无 UI | **上 UI**（SwitchV2） |
| reranker 引擎 `search.reranker {off/heuristic/llamacpp}` | config.yaml | ✅ yaml / ❌ 无 UI | **上 UI**（SelectV2，与嵌入引擎并列——质量 vs 资源的总开关） |
| replayK=5 / replayMaxChars=1500 | `index.ts getTurnPipeline` 硬编码 | ❌ 无 yaml | 提 config 键（`recall.replayK` 等），**不做 UI**（低频调） |
| stale-verify 调度（minReviewIntervalDays=21 / topK=10 / minAgeDays=14） | 函数默认值硬编码 | ❌ 无 yaml | 提 config 键（`recall.review.*`），不做 UI（运维参数） |
| ACT-R 参数（k=0.03 / cap=0.02 / exposure 5/0.3） | `retrieval-bonus.ts` 硬编码 | ❌ | **留硬编码**（学术参数、有明确推导依据，暴露只会引诱乱调） |
| goal 奖励 +0.08 | `goal-reward.ts` 硬编码 | ❌ | 留硬编码（同上，量级有文献依据） |
| hit-proxy TTL 10min | `fok-samples.ts` 默认 | ❌ | 留硬编码 |
| 回放排除窗 48h | `turn-pipeline.ts` 默认 | ❌ | 留硬编码 |
| consolidation `minCosine` 0.8 | `config.memory.embedding.minCosine` | ✅ yaml / ❌ 无 UI | 留 yaml（审计 H3 已否决调它的必要性） |

**判定原则**：用户可感知 + 常调 + 有解释空间 → UI；学术/运维参数调一次定终身 → yaml 或硬编码。硬编码≠不可改——调研依据写进了代码注释，改它应该是"升级"而不是"配置"。

## 3. 建议方案

### 3.1 P1：Memory section 增「检索行为」卡（纯 desktop + SDK，零 gateway 改动）

```
记忆系统（现有嵌入引擎卡）
└─ 检索行为（新卡）
   ├─ FOK 记忆置信门   [SwitchV2] enabled
   │    拒答阈值 probLow [TextInputV2 数字]  注入阈值 probHigh
   │    hint: 由 scripts/fok-calibrate --log 校准产出
   ├─ 预取快照         [SwitchV2] enabled（hint: 边界注入走 3ms 预计算路径）
   ├─ 时间邻居呈现     [SwitchV2] presentation（hint: ↳ 相邻记忆 + 优先最近版本）
   └─ 重排引擎         [SelectV2] off / heuristic / llamacpp（hint: 质量↔资源）
```

- 数据通道：`window.api.mafw.config.get()/set()`（SDK 已有，段级 merge + PUT 整体 + 热 reload）——**无需新路由**
- 校验在 UI 层（probLow < probHigh ∈ (0,1]，非法禁用保存）
- UI 组件守 §5.10 约定（SwitchV2/SelectV2/TextInputV2/TooltipV2）
- SDK 类型：`SearchBehaviorConfig`（可选，config namespace 已是 Record）

### 3.2 P2：观测面板（比开关更有价值）

`/api/memory/stats` 现有：`{embedding, consolidation, routing, reconsolidation, pipelines, coactivation, abstractionLevels}`——**consolidation 判定分布与 pipelines（decay bonused / turnCompress replayed）已在**。缺：

| 观测 | 来源 | 加法 |
|---|---|---|
| FOK 标注样本数/命中率 | `fok-samples.jsonl` 行数 + join | stats 增 `fok {injections, redemptions, samples, hitRate}`（读文件计数，10s 缓存） |
| 检索事件流 | `RetrievalEventBuffer`（内存单例） | stats 增 `retrievalEvents {pending, needTracked}`（暴露 buffer 计数） |
| 回放覆盖 | turnCompress counts（已含 replayed，**待部署 fb451413**） | 已就绪，desktop 侧展示即可 |

Memory section 底部加一个只读统计行（15s 轮询，与 Approvals 同节奏）。

### 3.3 不做（明确出界）

- ACT-R/goal-reward/replay 排除窗/TTL 上 UI——学术参数暴露 = 引诱乱调
- 新专用配置路由——无副作用的配置走通用 `/api/config` 足够（embedding-config 需要专用是因为它触发 runtime 重建）
- stale-verify/consolidation 调度 UI——周频运维，yaml 足够

## 4. 实现路径（若立项）

1. **P1 卡片**：Config.tsx Memory section 扩展 + config-nav desc 更新（"嵌入引擎与检索行为"）——desktop 侧独立可交付，`bun test` 纯逻辑（draft 校验函数抽 `config-nav.ts` 同级纯模块）
2. **P2 观测**：gateway `/api/memory/stats` 增字段（fok-samples 计数带缓存）→ SDK types → Memory 统计行
3. 均无迁移、无重启要求（search.* 热 reload 已验证）

## 5. 参考

- `packages/desktop/src/renderer/mafw/pages/{Config.tsx, config-nav.ts}`
- `gateway/src/index.ts:3848`（/api/config GET/PUT）、`routes/{embedding-config,model-config}.ts`（专用卡范式）
- AGENTS §5.10（UI 组件约定）、§Runtime 热切换（reload/restartRequired 语义）
