# 写时路由（Write-Time Routing）：turn_pipeline 脑式重构 S1

> 日期：2026-09-24 · 状态：设计待审
> 范围：把「巩固」从 post-write 旁路监听改为**写时路由门**（non-write / create / update），治 21.5% 近似重复
> 依据：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（系统巩固=最大架构缺口）、Dual-Layer `2608.22215`（写时路由剪 68% 冗余且保留 98% QA EM）、Memora `2602.03315`（UPDATE 机制）、本次全库实测 21.5% 碎片
> 相关：`2026-09-23-memory-dual-system-restructure-design.md`（伞形）、`2026-09-23-consolidation-replay-design.md`

## 1. 背景与诊断

### 1.1 实测症状（决定性证据）
全库 near-dup 扫描（3497 条，嵌入随机投影 1024→96，已归一）：

| 相似度 | 对数 |
|---|---|
| cos ≥ 0.95 | 75 |
| 0.90–0.95 | 167 |
| 0.85–0.90 | 483 |

**253 个多条目簇，卷入 753 条 = 21.5% 的库是近似重复。** 最大簇：runtime 能力契约 23 条、**TDD 偏好 21 条**、发布事实 19 条、工作流偏好 18 条、gateway 部署链 15 条。

### 1.2 根因：append-not-integrate
- turn_pipeline 的 worker 经 `mafw_add_memory` **追加**新条目（`add-memory.ts:98`）；
- reflection 直接 `store.write(unit)` **追加**（`reflection.ts:300`）；
- agent 直写同样追加。
- 三者都**不在写入前判断"这条是否已存在"** → 同义改写各写一条。

**脑对照**：大脑不是 append，是 **replay → integrate**（回放采样 → 与既有图式交错 → 输出 gist 整合，源保留）。append 是反脑的。21.5% 碎片正是 append 的直接症状。

### 1.3 现状机制为何失效
`ConsolidationService`（`gateway/src/memory/consolidation-service.ts`）已实现 Memora 式 cos≥0.8 召回 + LLM 判 UPDATE/CREATE，且**已接线**为 post-write 监听（`index.ts:1941`）。但：

| 问题 | 证据 | 影响 |
|---|---|---|
| **under-firing** | `GET /api/memory/stats` → `judged:4, updates:0, updateRatio:0` | 几乎没判过，21.5% 无人拦 |
| **索引分叉** | `index.ts:1212` 用**独立** `new HarmonicUnitFileStore(mafwDir)`，非共享 `memoryService.harmonicIndex` | UPDATE 写入 stale 索引实例，共享索引/检索看不到 |
| **stats 不持久** | `initEmbeddingServices` 可重入（热切换），重建即 `stats` 归零（`consolidation-service.ts:85`） | 观测失真 |
| **无 non-write** | `consolidate()` 永远先写再判（`harmonic-file-store.write` 已发生） | 冗余条目先落盘，事后才合并 |
| **纯 cosine 合并已被证伪** | 伞形 spec §3.4：cos 0.995 却是不同实体，LLM 判 create | 不能用确定性阈值替代判官 |

### 1.4 对标
- **Dual-Layer** `2608.22215`（CLS）：写时 **cost-aware 路由** non-write / write-new / write-update（小→大模型级联），剪 **68% 冗余**、升级 <50% 输入、保留 **98% QA EM**。
- **Memora** `2602.03315`：余弦 ≥ γ → LLM 判 **CREATE/UPDATE**，UPDATE 合入一条；消融 UPDATE 为正增益。
- 两者共同点：**在写入前路由**，而非事后清理。

## 2. 目标 / 非目标

**目标**
1. 写时路由：近似重复 → **UPDATE 整合**；近似精确重复 → **non-write（不落盘）**。
2. 修复 ConsolidationService 的 under-firing / 索引分叉 / stats 失真。
3. 可观测：`updateRatio`（健康区间 16–22%）+ 新增 `skipped`。

**非目标**
- 不做参数化写回（Dual-Layer 终局，MAFW 无微调基建）。
- 不改检索路径（守 100ms 边界 recall）。
- 不改 OKF 存储格式。
- 不做回放优先采样 / 交错扩展（S2）、编码门控（S3）、模式分离 guard（S4）、再巩固（S5）。
- **不修存量**（753 条历史重复）：S1 只防增量，存量清理为独立切片。

## 3. 设计

### 3.1 三态路由
新增纯函数/服务 `routeWrite(unit, deps) → RoutingOutcome`：

```ts
type RoutingOutcome =
  | { action: 'skip';   targetId: string }   // non-write：冗余不落盘，targetId 为既有权威条目
  | { action: 'create' }                     // 新条目
  | { action: 'update'; targetId: string }   // 整合进既有
```

> `skip` 与 `update` 都回传 `targetId`，使调用方（MCP handler / HTTP / reflection）能返回一个**有效指针**（既有权威条目 id）而非空——对 `mafw_add_memory` 的 agent 调用者尤其重要。

判定：
1. 取 unit 向量（缺则按需嵌入；嵌入不可用 → `create`）。
2. `searchByCosine(vector, k+1)` 取候选，排除自身与 superseded。
3. 令 `top = 最高 cos`（及其 id `topId`）：
   - `top ≥ θ_dup`（默认 **0.95**）→ `skip`（non-write，冗余不落盘，回传 `topId`）。
   - `θ_cand ≤ top < θ_dup`（默认 **0.80**）→ 调 LLM 判官 → `create` 或 `update(targetId)`。
   - `top < θ_cand` → `create`（**不调 LLM**，快路径）。
4. **fail-open**：任何错误/超时/判官不可达 → `create`（绝不阻塞或丢写）。

阈值来源：`config.memory.embedding.minCosine`（现有 0.8）+ 新增 `dupCosine`（0.95）。

### 3.2 落点（覆盖全部自动化写入者）
统一 `routeWrite`，在**写入前**调用：

| 写入者 | 现状 | 改造 |
|---|---|---|
| `mafw_add_memory`（MCP，覆盖 turn_pipeline worker + agent 直写） | `add-memory.ts:98` 直接 `store.write` | 先 `routeWrite`：`skip` → 不写，返回 `{success:true, id:targetId, deduped:true}`；`update` → 写 merged + supersede target，返回 `{success:true, id:mergedId, updated:targetId}`；`create` → 原样写 |
| HTTP `POST /api/memory/add` | `index.ts:6039` 区域 | 同上 |
| reflection `reflectSession` | `reflection.ts:300` 直接 `store.write` | 同上（skip/update/create 三分支） |

> turn_pipeline 本身无需改：其 worker 经 `mafw_add_memory`，被第一行覆盖。

### 3.3 修复 under-firing
1. **共享索引**：`ConsolidationService.store` 改用共享 `memoryService.harmonicIndex` 支撑的 store（或把 `routeWrite` 直接挂在共享 index 上），消除索引分叉。
2. **stats 持久化**：把 `{judged, updates, creates, skipped}` 落 `gateway.db` kv（或 `PipelineHeartbeat` counts），跨 service 重建不归零。
3. **minCosine 校准**：用实测 21.5% 数据回归，确认 0.8 召回能命中已知重复簇（抽样验证）。
4. **判官可用性**：确认 completion 通道解析 `gateway` provider 成功（现 stats judged=4 说明大概率未真正进入判官分支）。

### 3.4 UPDATE 语义（复用现有）
`mergeIntoNewer`（`consolidation-service.ts:177`）已定义：新内容在前 + 旧内容在后（`\n---\n[Updated ts] ...`）、锚点去重合并（cap 8）、`merged_from` 追加、energy `min(1, +0.15)`、`markSuperseded(target)`、删旧向量。S1 沿用，仅把触发从"事后"改到"事前"，并确保 `store` 用共享索引。

### 3.5 可观测
`GET /api/memory/stats` 的 `consolidation` 增 `skipped`；`updateRatio` 保留。健康判据：`updateRatio ∈ [0.16, 0.22]`（Memora sweet spot），`skipped > 0` 表示 non-write 生效。

## 4. 测试与验收

- **单测** `route-write.test.ts`：三分支（skip / create / update）+ fail-open（嵌入失败/判官失败/超时）+ 无候选不调 LLM + superseded 候选排除。
- **单测** 阈值边界：cos=0.949 → 判官路径；cos=0.951 → skip。
- **集成**：连续写两条近似重复（cos 0.9）→ 第二条 `update`；写两条近乎相同（cos 0.97）→ 第二条 `skip`（库中不新增）；写两条不同实体（cos 0.85 但 identity 不同）→ `create`（不误合并）。
- **回归**：现有 consolidation / add-memory / reflection 测试全绿。
- **验收**：构造一批已知重复写入，`skipped + updates` 显著 > 0；`updateRatio` 落入健康区间。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 过度合并（不同实体） | identity 判定走 LLM 判官（纯 cosine 已证伪）；θ_dup 取高（0.95） |
| 写路径延迟 | 快路径：无候选（cos<θ_cand）不调 LLM；仅命中候选才判 |
| 判官不可达 → 退化为 append | fail-open 为 create（不阻塞），但心跳 `consolidation` 会暴露 stalled |
| 存量 753 条仍重复 | 明确非目标；独立切片做存量合并扫描 |
| `skip` 误杀重要更新 | θ_dup 高 + skip 仅在同主题高相似；写入返回体标注 skipped 供审计 |

## 6. 涉及文件

- 新增：`gateway/src/memory/route-write.ts`（三态路由，deps 注入可单测）
- 修改：`gateway/src/memory/consolidation-service.ts`（抽 `routeWrite` 复用；共享 store；stats 落库）、`gateway/src/mcp/handlers/add-memory.ts`（写前路由）、`gateway/src/index.ts`（HTTP add 路由 + wiring + stats）、`gateway/src/recall/reflection.ts`（写前路由）、`gateway/src/config.ts`（`memory.embedding.dupCosine`）
- 测试：`gateway/tests/unit/memory/route-write.test.ts` + 既有 add-memory/reflection/consolidation 回归

## 7. 分解说明

本 spec 是脑式重构的 **S1（写时路由）**，独立可交付。后续切片 S2（回放采样 + 簇级交错）、S3（编码门控）、S4（模式分离 guard）、S5（再巩固）各自单独出 spec/plan。
