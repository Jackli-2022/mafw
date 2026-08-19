# MAFW 记忆检索体验优化计划（链路修复 → 提示结构化 → 两段式精排）

> 状态：已规划，待执行
> 范围：谐波记忆检索链路生产修复 + L1/L2 分层优化
> 触发：LongMemEval Phase 2 后（L1 BM25 R@10=0.949 / R@1=0.586，L2=0.583）暴露检索-生成鸿沟；深入排查发现 5 个生产链路缺陷（写→搜断裂、BM25 未上生产、salience 空转等）
> 前置：`docs/plans/2026-08-17-harmonic-memory-deviation-correction.md`（Phase 0-3 已完成）

## 1. 目标

分层解耦优化：**先修链路（让系统言行一致），再让检索器"排得对"（R@1），再让 LLM"读得出"（QA accuracy）**。

1. **Phase R 链路修复**：修复 5 个生产缺陷——agent 经 MCP 写的记忆在 gateway 重启前召回不到、BM25 只存在于 benchmark、salience 加权空转、score 被丢弃、memoryType 过滤顺序错误
2. **Phase Q 提示结构化**：检索结果带时间戳/类型/置信度进 prompt（advisor 的 quick win）
3. **Phase S 两段式精排**：BM25 top-50 召回 → 精排（启发式默认 + 本地 cross-encoder 可选）→ 自适应截断
4. **Phase M 语义层**：knowledge-update 降级不删、reflection 偏好结构化、multi-session 实体线索

## 2. 现状与决策回顾

### 2.1 关键数据（已核实，`evaluation/longmemeval/results/`）

| 层 | 指标 | 值 | 来源 |
|---|---|---|---|
| L1 bm25 session | R@1 / R@10 / NDCG@10 | **0.586 / 0.949 / 0.882** | `2026-08-17T15-30-14-589Z/l1-summary.json` |
| L1 per-type R@10 | user/assistant/knowledge-update=1.0；multi-session 0.91；temporal 0.91；preference 0.875 | 同上 |
| L2（bm25 + mimo-v2.5 直连） | overall **0.583**；user/assistant 0.875；temporal/knowledge-update 0.500；**multi-session/preference 0.375** | `2026-08-17T13-33-41-344Z/l2-summary.json` |
| BM25 检索延迟 | 1000 entries 1.5–3.5ms/query | `results/report.md:90` |

**检索-生成鸿沟**：R@10 0.949 → QA 0.583，正确答案在 top-10 但 LLM 读不出；R@1 仅 0.586 指向精排缺失。

### 2.2 新发现的生产链路缺陷（代码证据，explore 代理核实）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| D1 | **写→搜链路断裂**：MCP `handleAddMemory` 每次 `new HarmonicUnitFileStore(mafwDir)`（自建索引实例），写盘后共享 `memoryService.harmonicIndex` 不知情；而 `/api/recall/context`、step-inject、MCP `mafw_search_hybrid` 全走共享实例 | `gateway/src/mcp/handlers/add-memory.ts:43-45`；对照 `/api/memory/add` 传共享实例 `gateway/src/index.ts:3898` | **agent 写的记忆重启前召回不到**，memory-guide 教的"写入→检索"循环在当前进程内断裂 |
| D2 | **BM25 从未上生产**：所有生产路径默认 `retriever:'token'` | `recall-context.ts:20`（`index.search(query, topK)` 无 options）；`search-hybrid.ts:9` 默认 token | 已验证 2 倍提升的检索器只在 benchmark 用 |
| D3 | **salience 加权空转**：`HarmonicIndexEntry` 结构无 salience 字段，`addEntry` 不复制；`(entry as any).salience ?? 1` 恒为 1；能量衰减 pass 同样读不到 | `harmonic-index.ts:45-56`、`harmonic-types.ts:22-38`、`automation-engine.ts:61` | Phase 3.4 的排序加权与 decay 的 salience 调节全是 no-op |
| D4 | **score 被丢弃**：`search()` 只返回裸 entry 数组 | `harmonic-index.ts:112-116, 174-177` | 精排/自适应截断/置信度展示全部无输入 |
| D5 | **memoryType 过滤在 topK slice 之后**：过滤完结果可能远少于 topK | `search-hybrid.ts:12-15` | MCP 搜索结果数不符合预期 |

### 2.3 对转述优化分析（advisor）的修正

| advisor 主张 | 核实结论 |
|---|---|
| cross-encoder 精排（ms-marco MiniLM <10ms/对） | 方向对，但 `@xenova/transformers` **不在** gateway dependencies（legacy `core/compression/vector-index.ts` 引用它但已是死代码）→ 新依赖 + 首次模型下载 ~23MB，需 fallback 设计 |
| "session 摘要层"需新建 | **不必从零建**：turnCompress（小时级 per-session worker 写 episodic）+ reflection（每日 Hermes 蒸馏 → semantic/procedural）已是雏形 → Phase M 强化现有管线而非新建 |
| knowledge-update 加 superseded 软失效 | 确认无此机制：MinHash 合并是**硬删除 + `a + ' | ' + b` 拼接**（`minhash-merger.ts:66-82`，`dedupMerge` 并未真去重），全仓库 grep 无 `superseded` |
| 结构化元数据拼进 query | benchmark ingest 已有 `[date]` 前缀 + `lmesid:` marker（`ingest.ts:92-96`）；生产 HarmonicUnit 有 `created_at/type/source_session_id` 但注入渲染不展示（`inject-format.ts:85-93` 只有 id+text+energy） |

### 2.4 已确认决策（用户答复）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 优先级 | **先修链路（Phase R），再做优化（Q→S→M）** | 体验问题比 benchmark 数字更痛；修复后评测才反映真实系统 |
| 精排方案 | **启发式（默认，零依赖）+ 本地 cross-encoder（可选，`search.reranker='cross-encoder'`）** | 用户选"1和3"；接口抽象让两者可插拔 |
| L3 端到端评测 | **本期不做** | 先收窄 L1/L2 gap |
| 向量双路召回 | **本期不做** | CE 精排先覆盖语义漂移收益，不够再议 |
| mimo-v2.5 SFT/DPO | **本期不做** | 算力成本 |

---

## 3. 分阶段实施计划

### Phase R — 链路修复（0.5–1 天）

> 原则：每个修复配一个失败→通过的回归测试（TDD）。

#### Task R1：统一写路径索引实例（D1）

- **测试先行** `tests/unit/mcp/add-memory-shared-index.test.ts`（新）：
  构造共享 `MemoryService` → 经 `handleAddMemory(args, { memory })` 写入 → 断言 `memory.harmonicIndex.search(content关键词)` **立即**命中（当前实现会失败）
- **修改** `gateway/src/mcp/handlers/add-memory.ts:43-45`：
  ```typescript
  // 旧：const store = new HarmonicUnitFileStore(mafwDir);
  // 新：与 /api/memory/add（index.ts:3898）同模式——共享索引实例
  const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
  const sharedIndex = (memory as any)?.harmonicIndex;
  const store = sharedIndex ? new HarmonicUnitFileStore(mafwDir, sharedIndex) : new HarmonicUnitFileStore(mafwDir);
  ```
  （先读 `harmonic-file-store.ts` 构造函数确认第二参数签名与 `index.ts:3898` 一致；MCP context 无 memory 时降级现状行为，不崩）
- **验证**：新测试通过 + `npx jest tests/unit/mcp tests/unit/memory --silent` 全绿

#### Task R2：生产默认 BM25（D2）

- **修改** `gateway/src/config.ts`：`search.defaultRetriever: 'bm25'`（env `MAFW_SEARCH_RETRIEVER` 覆盖，类型 `'token'|'bm25'`）
- **透传**：
  - `gateway/src/recall/recall-context.ts:20` → `index.search(query, topK, { retriever: config.search.defaultRetriever })`（recall-context 是纯函数，把 retriever 作为参数传入，调用方 `index.ts` 读 config）
  - `gateway/src/mcp/handlers/search-hybrid.ts:9` 默认值改读 config
  - `gateway/src/recall/step-inject.ts` 搜索调用点同步
- **测试**：更新 `tests/unit/recall/recall-context.test.ts`（如存在）断言 options 透传；`harmonic-index.test.ts` 已有 bm25 用例兜底
- **冒烟**：起 gateway，对真实 `~/.mafw` 库各跑一次 token/bm25 `mafw_search_hybrid`，确认排序合理、无异常

#### Task R3：salience 入索引（D3）

- **修改**：
  - `gateway/src/core/memory/harmonic-types.ts:22-38` `HarmonicIndexEntry` 加 `salience?: number`
  - `gateway/src/core/memory/harmonic-index.ts:45-56` `addEntry` 复制 `salience`（来源 unit.salience）
  - `gateway/src/memory/harmonic-file-store.ts:56-68` entry 字面量加 `salience: unit.salience`
- **兼容**：旧索引文件条目无 salience → 排序处 `?? 1` 已防御（Phase 3.4），免迁移
- **测试**：`harmonic-index.test.ts` 加用例——两条同分记忆，高 salience 排前；`t1-to-t2-compressor.test.ts` 等现有测试不受影响

#### Task R4：searchScored 返回分数（D4）

- **修改** `gateway/src/core/memory/harmonic-index.ts`：
  ```typescript
  export interface ScoredEntry { entry: HarmonicIndexEntry; score: number }
  searchScored(query: string, topK = 20, options: SearchOptions = {}): ScoredEntry[] {
    // token/bm25 两路的打分+排序逻辑收敛到这里（现有 search 内部逻辑上移）
  }
  search(query, topK, options): HarmonicIndexEntry[] {
    return this.searchScored(query, topK, options).map(s => s.entry);  // 签名兼容
  }
  ```
- **测试**：`searchScored` 返回分数降序、score>0；`search` 行为不变（现有 14 用例全绿）

#### Task R5：memoryType 过滤移到 slice 前（D5）

- **修改** `gateway/src/mcp/handlers/search-hybrid.ts:12-15`：把过滤逻辑下沉为 search 前的 predicate（对全量打分结果过滤后再取 topK），或放大内部取数（topK×3）再过滤再 slice——取前者（依赖 R4 后对 scored 列表过滤）
- **测试**：构造 25 条记忆（20 条 semantic + 5 条 episodic），`memoryType=episodic, topK=10` → 返回 5 条而非 ≤10 随机

#### Phase R 验收

1. `npx tsc --noEmit -p gateway/tsconfig.json` 零错
2. `npx jest tests/unit/harmonic-index.test.ts tests/unit/harmonic-e2e.test.ts tests/unit/memory tests/unit/mcp tests/unit/recall tests/unit/dashboard --silent` 全绿
3. L1 baseline 回归：`npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25` → R@10 应保持 ~0.949（salience 入索引后 ingest 不写 salience → `?? 1` 无影响）
4. 手动冒烟：gateway 起 → MCP `mafw_add_memory` → `/api/recall/context` 立即可见

---

### Phase Q — 提示结构化（0.5 天）

#### Task Q1：生产注入加时间/类型元数据

- **修改** `gateway/src/recall/inject-format.ts`：
  - `MemoryUnit` 接口（`:1-7`）加 `type?: string; created_at?: string`
  - `formatRecallContext`（`:85-93`）行格式：
    ```
    - #mem-<id前6位> [YYYY-MM-DD] [<type>] "<primary_abstraction||memory_value>" (E:<energy.toFixed(1)>)
    ```
    （字段缺失时省略对应段，保持向后兼容）
- **修改** `gateway/src/recall/recall-context.ts:21-28` 映射带上 `type/created_at`
- **测试**：`tests/unit/recall/inject-format.test.ts`（存在则更新）断言新格式；无日期字段的旧调用不崩

#### Task Q2：L2 reader 上下文增强 + 排序 ablation

- **修改** `evaluation/longmemeval/src/l2-qa.ts`：
  - `--order date|rank`（默认 `date` 保持现状）：`rank` 时跳过 `sortByDatePrefix`（`:50-57`），保留检索排序
  - contexts 行格式：`${i+1}. [Session#<lmesid尾4位>] ${c}`（marker 已在 `top_contexts` 文本里则跳过）
- **验证**：同一 bm25 l1-run 分别 `--order date` / `--order rank` 跑 L2，对比 overall 与 temporal/knowledge-update 分项

#### Task Q3：置信度进 prompt（依赖 R4）

- **修改** `evaluation/longmemeval/src/l1-retrieval.ts`：`searchScored` 取分，l1-run.jsonl 每行加 `top_scores: number[]`（types.ts 同步）
- **修改** `l2-qa.ts`：`top1_score < 阈值`（先验取 bm25 分布 P25，跑一批后校准）或 top1/top10 落差 >10× 时，reader system 注入：`Note: retrieval confidence is LOW. If the memories do not contain the answer, say "I don't know".`
- **验证**：abstention 题（`_abs` 后缀）单独统计准确率变化

#### Phase Q 验收

L2 在 bm25 run 复跑：`overall ≥0.65`，`multi-session ≥0.50`，`preference ≥0.50`；report.md 追加对比。

---

### Phase S — 两段式精排（2–3 天）

#### Task S1：Reranker 接口与管线

- **新建** `gateway/src/core/memory/reranker.ts`：
  ```typescript
  export interface Reranker {
    name: string;
    rerank(query: string, candidates: ScoredEntry[], topK: number): Promise<ScoredEntry[]> | ScoredEntry[];
  }
  export interface RerankOptions {
    reranker?: 'off' | 'heuristic' | 'cross-encoder';  // config.search.reranker，默认 'heuristic'
    recallK?: number;    // 召回放大倍数对应条数，默认 50
    cutoffRatio?: number; // 自适应截断：score < top1×ratio 丢弃，默认 0.3；0=不截断
  }
  ```
- **接入** `harmonic-index.ts`：`searchScored(query, topK, { ...options, rerank })`——先按 retriever 召回 `recallK` 条 → reranker 重排 → 截断 → 取 topK。`rerank:'off'` 时行为与现状完全一致（L1 baseline 回归用）

#### Task S2：HeuristicReranker（默认，零依赖）

- **公式**：`final = 0.6×norm(bm25) + 0.2×recency + 0.1×energy + 0.1×salience`
  - `norm(bm25)`：min-max 归一化到 [0,1]（单批次内）
  - `recency`：`exp(-daysSince(created_at)/30)`（30 天半衰）
  - 权重走 `config.search.rerankWeights`，可调
- **测试**：构造固定 fixture（新/旧、高/低 energy、高/低 salience 组合），断言排序期望

#### Task S3：CrossEncoderReranker（可选）

- **依赖**：`@xenova/transformers`（gateway package.json 新增）；模型 `Xenova/ms-marco-MiniLM-L-6-v2`（~23MB）
- **设计**：
  - 懒加载单例；模型缓存 `~/.mafw/models/`（`XENOVA_CACHE_DIR` 或 transformers env 指定）
  - 只对召回 top-N（默认 50，延迟超预算收紧到 20）逐对打分，与 bm25 分加权融合（`0.5×norm(ce) + 0.5×norm(bm25)`，权重可配）
  - 下载/加载失败 → warn + fallback HeuristicReranker（不阻塞检索）
  - CJS/ESM：参照 `pi-adapter.ts` 的 `new Function('spec','return import(spec)')` 动态导入模式
- **压测**：`tests/unit/memory/reranker-perf.test.ts`（或脚本）1000 entries 召回 50 对，记录 p95；预算 ≤100ms

#### Task S4：L1 评测接入

- **修改** `evaluation/longmemeval/src/l1-retrieval.ts`：`--reranker off|heuristic|cross-encoder`（默认 `off` 保持 benchmark 可复现）；l1-run.jsonl 落 `top_scores`
- **跑批矩阵**：`token×off`（baseline 回归）/ `bm25×off` / `bm25×heuristic` / `bm25×cross-encoder`，report.md 追加对比表

#### Phase S 验收

| 指标 | 门槛 |
|---|---|
| L1 session R@1 | heuristic ≥0.70；CE ≥0.75 |
| L1 session R@10 | ≥0.95（不回退） |
| CE 精排延迟 | p95 ≤100ms（50 对） |
| 现有测试 | 全绿 |

---

### Phase M — 语义层（视 Q/S 结果裁剪，2–3 天）

#### Task M1：knowledge-update 降级不删

- **修改** `gateway/src/core/memory/minhash-merger.ts:66-82`：
  - 旧条目**不 deleteSync**，改为 `superseded_by: newId` + `energy × 0.5`（`HarmonicUnit`/`HarmonicIndexEntry` 加可选 `superseded_by`）
  - 合并产物（新条目）`memory_value` 保留新旧拼接 + 头部标注 `[更新于 <newDate>，替代 <oldDate> 的记录]`
  - 检索排序：`superseded_by` 非空的条目 score ×0.5（harmonic-index 排序处）
- **防递归**：`merged_from`/`superseded_by` 任一存在则跳过合并检查（现有 merged_from 防护扩展）
- **测试**：合并后旧条目仍在但降权；检索同主题时新版本排前

#### Task M2：reflection 偏好结构化

- **修改** `gateway/src/recall/reflection.ts` reflect worker 的 prompt 模板：偏好类产出要求格式 `偏好：<维度>=<值>（依据：...）`，cue_anchors 必须含维度词与实体词
- **验证**：用历史 episodic 样本跑 reflect，检查产出 cue_anchors 质量；L2 preference 分项复测

#### Task M3：multi-session 实体线索

- **修改** `gateway/src/recall/turn-pipeline.ts` worker 系统提示：cue_anchors 要求携带主题实体（人/事/物专名）
- **修改** `gateway/src/recall/recall-context.ts`：查询扩展——从当前 query 提取实体词（大写词/专名/中文名词段）以 OR 语义补充召回（先启发式，不接 NER 依赖）
- **验证**：L2 multi-session 分项复测

#### Task M4：评测闭环

- L2 判错样本导出 hard negatives（question × 高分错误记忆 pair）→ `results/<ts>/hard-negatives.jsonl`，供 reranker 权重调参/CE 评估
- 扩大验证集：`--sample 20`（120 题）跑 L1+L2 确认小样本结论稳健

#### Phase M 验收

L2：`multi-session ≥0.55`、`preference ≥0.55`、`knowledge-update ≥0.65`；overall 目标 ≥0.70。

---

## 4. 本期不做

- L3 端到端 replay（`/api/eval/chat/completions` 逐轮 replay haystack）
- 向量双路召回（BM25+dense RRF）
- mimo-v2.5 SFT/DPO
- legacy `core/mcp/tools.ts` / `core/plugin.ts` 清理（保持 TODO 标注）
- `top_associations` 联想预取（维持未实现标注）

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| CE 模型首次下载 ~23MB，离线环境失败 | 懒加载 + 自动 fallback heuristic，不留硬依赖；模型缓存 `~/.mafw/models/` |
| `@xenova/transformers` 是 ESM/CJS 混合包，gateway 编译 CJS | 参照 `pi-adapter.ts` 动态 import 模式 |
| 索引 entry 结构变更（salience/superseded_by） | 全部可选字段 + 缺失容忍，旧 `~/.mafw` 索引免迁移 |
| R1 依赖 MCP context 注入 MemoryService | context 无 memory 时降级现状行为；MCP-only 模式 `initServices()` 也初始化 Memory |
| BM25 上生产改变既有排序行为 | R@10 全类型 ≥0.875 的 benchmark 证据 + config 可切回 token |
| Phase S 权重拍脑袋 | S2 权重全部 config 化，M4 hard negatives 供调参依据 |

## 6. 预计改动文件

| 文件 | Phase |
|---|---|
| `gateway/src/mcp/handlers/add-memory.ts` | R1 |
| `gateway/src/mcp/handlers/search-hybrid.ts` | R2, R5 |
| `gateway/src/core/memory/harmonic-types.ts` | R3, M1 |
| `gateway/src/core/memory/harmonic-index.ts` | R3, R4, S1, M1 |
| `gateway/src/memory/harmonic-file-store.ts` | R3 |
| `gateway/src/config.ts` | R2, S1 |
| `gateway/src/recall/recall-context.ts` | R2, Q1, M3 |
| `gateway/src/recall/inject-format.ts` | Q1 |
| `gateway/src/recall/step-inject.ts` | R2 |
| `gateway/src/core/memory/reranker.ts`（新） | S1–S3 |
| `gateway/src/core/memory/minhash-merger.ts` | M1 |
| `gateway/src/recall/reflection.ts` | M2 |
| `gateway/src/recall/turn-pipeline.ts` | M3 |
| `evaluation/longmemeval/src/l1-retrieval.ts` | Q3, S4 |
| `evaluation/longmemeval/src/l2-qa.ts` | Q2, Q3 |
| `evaluation/longmemeval/src/types.ts` | Q3 |
| `tests/unit/mcp/add-memory-shared-index.test.ts`（新）等 | R/S/M |
| `AGENTS.md` §3.2/§5.11/§7 | 每 Phase 收尾同步 |

## 7. 执行与验证节奏

```
Phase R（修链路）→ tsc + 单测 + L1 回归 + 手动冒烟
Phase Q（提示）  → L2 复跑对比（overall/multi-session/preference）
Phase S（精排）  → L1 跑批矩阵（4 组合）+ CE 压测
Phase M（语义）  → L2 分项复测 + 120 题扩样
每 Phase 收尾 → report.md 追加 + AGENTS.md 同步
```
