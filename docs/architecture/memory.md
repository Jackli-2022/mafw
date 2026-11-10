# MAFW 记忆系统

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## 谐波记忆系统

### 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';  // 字段名是 type（非 memory_type）
  primary_abstraction: string;    // 6-8 词核心摘要（实际各写路径放全文/摘要不等）
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // 参与排序（**入口**计算：judgeSalience/importanceToSalience，write() 不算；检索 ×energy×salience，缺失按 1）
  abstraction_level?: number;     // 0=T1, 1=T2, 2=T3/T4, 3=L5；写路径统一映射（episodic→1，semantic/procedural→2，global→3）
  review_count?: number;          // A1：stale-verify 调度状态（验证后 stampReview 盖章；21 天排除窗 + 无记录优先）
  last_reviewed?: string;         // A1：同上
  merged_from?: string[];         // 合并来源 id（consolidation UPDATE / route-write update / 跨 worktree 融合填充；MinHash 写路径合并已退役）
  distinct_from?: string[];       // S4 模式分离：与这些相似条目**刻意保持区分**（route-write separate 分支写入；consolidation 候选池尊重，双向禁止合并）
  superseded_by?: string;         // soft-supersede：指向取代本条的新 id（披露注入排除；检索命中改写为其 supersede 链头）
  pinned?: boolean;               // 披露层：每轮注入 <user-profile>（superseded 后失效）；与 type 正交
  sticky_until?: string;          // 便签板：每轮注入 <note-board> 直到该 ISO 日期（板级过期，记忆本体保留；坏日期 fail-open 在板）
  created_at: string;
  updated_at: string;
}
```

> 存量合体清理：`cd gateway; npx ts-node scripts/unmerge-blobs.ts`（dry-run 默认，`--apply` 执行并自动备份；需先 `mafw stop`；索引 filePath 相对 `~/.mafw` 解析）

> 注：`goal_id` 为历史兼容字段，当前写路径不填充。
> `top_associations` 已删（2026-09-29）：预存静态联想链接被新证据反对（SYNTHESIS arXiv:2601.02744 主张 relevance 来自动态激活；query-blind 链接是噪音源 arXiv:2606.30133），未来多跳走 query-aware 动态激活——见 docs/research/2026-09-29-memory-gap-abc-survey.md §A2。
> **MinHash 写路径合并已退役（V2 ①a，2026-10-12）**：`HarmonicUnitFileStore.write()` 不再做合并检查（`skipMerge` 为 deprecated no-op），`MinHashMerger.merge()` 无消费者；`MinHashMerger` 仅剩跨 worktree 融合复用其 `generateSignature/similarity`。去重改为三层：**写时 exact-hash（仅 HTTP）/ 读时近重折叠（cos≥0.92 或 token-Jaccard≥0.8）/ 巩固层语义合并**（consolidation + route-write）。
> **soft supersede** 现由 `markSuperseded()` 承担（consolidation UPDATE / route-write update / grace / reconsolidate / worktree 融合）：相似旧条目标记 `superseded_by` 并降低 energy（×0.5），不物理删除，便于 knowledge-update 场景保留历史版本。检索出口由 `resolveSupersededHeads()`（`harmonic-index.ts`，`searchScored` 末尾单点）**强制撤销**：命中 superseded 条目改写到其 supersede 链头（保分数、按链头去重取最高分），悬空/成环/超深（默认 5）链直接丢弃——仅靠排序惩罚不够，被撤销事实仍会返回并压过替代项（arXiv:2609.08258）。

### 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → 加载 .harmonic_index.json（无视 memory_type 与层级）
     → 按 energy × 检索得分排序
     → 按需从 tier 文件加载完整 memory_value
```
三种检索器（`gateway/src/core/memory/harmonic-index.ts`）：
- **bm25（默认）**：query 分词做 BM25（k1=1.2, b=0.75）× energy × salience，tokenize 为小写单词（len≥2）+ CJK unigram；查询时现算，不持久化索引文件
- **hybrid**：bm25 + dense embedding 经 RRF(k=60) 融合（`searchScored` 的 `denseScores` 选项；异步嵌入由调用方完成，searchScored 保持同步）；embedding 走 `memory.embedding` 配置（local ONNX Qwen3-Embedding-0.6B / dashscope compatible-mode，默认 off）
- **token**：子串计数 × energy × salience，可通过 `mafw_search_hybrid` 的 `retriever:'token'` 或 `/api/memory/search?retriever=token` 显式回退

**显式时间锚定**（`gateway/src/recall/time-anchor.ts`）：查询含时间表达（昨天/last week/N月/recent 等）时，created_at 落入对应窗口的条目 ×1.5 软提升（不硬过滤，E.4 陷阱）；`options.now` 供评测传 question_date。

LongMemEval 基准（session 粒度 R@10）：token 0.474 → **bm25 0.949**（6/6 类提升；1000 entries 搜索 ~2-3ms）。`searchScored()` 同时返回原始分数，供下游精排、截断与置信度展示使用。heuristic reranker 在 session 粒度经 realistic-energy 消融证实零增益（rerankWeights 全部信号在候选集内无区分度）。

Index scan 传输（`recall/index-scan.ts`）优先走 runtime 契约的 `completion.complete()`（`completionApi` 能力，thunk 现读热切换安全），缺能力/失败时回退直连 HTTP（`runtime/completion-http.ts` 共享实现，`cacheable` 块映射 DashScope `cache_control: ephemeral`）。

### 压缩

`HarmonicUnitFileStore.write()` 输出 `HarmonicUnit` 并自动：
1. `cue_anchors` 兜底（空则 `extractAnchors(primary_abstraction)`）+ **标识符收割**（`harvestIdentifierCues`，预算 `harvestMaxCues`=8）——**salience 不在此计算**，由入口（HTTP/MCP）算好传入
2. 写入对应 tier 文件（`concepts/{semantic|episodic|procedural|global|knowledge}/`，OKF frontmatter 白名单见 `okf-writer.ts`）
3. 更新 `.harmonic_index.json`（index v2）
4. 锚点图/共激活图 upsert + `[[link]]` 边
5. 触发静态 `onMemoryWritten` 监听器（dense 嵌入索引 + consolidation 入队 + GLiNER 实体收割[默认关]）

> 去重三层（写路径无合并）：**L1 写时 exact-hash**（`dedup-guard.ts`，SHA1 LRU，仅 HTTP `/api/memory/add`）；**L2 读时近重折叠**（`searchScored`，cos≥0.92 或 token-Jaccard≥0.8）；**L3 巩固层语义合并**（consolidation + route-write，见 §3.5）。`merged_from` 的 2000 字符合并截断随 MinHash 退役一并消失（HTTP content 另有 4000 上限）。

> 注：`HybridCompressor`（会话压缩管线）只挂在 deprecated legacy 插件路径，当前 gateway 运行时写路径是 `/api/memory/add` + MCP handler + turnCompress worker，均经 `HarmonicUnitFileStore.write()`。

### Dense 混合检索与语义合并（P1/P2，opt-in）

`memory.embedding.provider`（默认 `off`；`local` = ONNX Qwen3-Embedding-0.6B / `dashscope` = text-embedding-v4 compatible-mode）：

- **EmbeddingRuntime**（`gateway/src/memory/embedding-runtime.ts`）：进程单例（provider + `MemoryVectorStore` + `EmbeddingIndexer`）。向量文件 `~/.mafw/memory/vectors-<model>.json`（按 provider.name 打标签，GGUF 与 ONNX 嵌入不共享）；写路径 fire-and-forget 嵌入（2s 防抖批量 flush，失败丢弃不阻塞）
- **本地引擎双实现**（`memory.embedding.engine`）：`onnx`（transformers.js 进程内，`threads` 线程帽默认 2）/ `llamacpp`（`llamacpp-provider.ts`：llama-server sidecar 子进程，官方二进制自动下载含 ghfast.top 镜像回退，`gpu: cpu|vulkan|cuda` 变体切换、GPU 变体自动 `-ngl 99`）。**llama-server embedding 必备旗标**（踩坑实证）：`-fa on`（否则非因果注意力物化 L² 矩阵，ctx4096 时 RSS 3GB）、`-np 1 --no-warmup`（否则 np=auto 多槽 KV + warmup 全量缓冲 → 2.8GB）、`-cram 0`（prompt cache 对 embedding 任务只写不读涨到 8GB 上限，llama.cpp #26293）、`-c/-b/-ub ≥ 文本 token 上限`（超长输入 HTTP 400 被静默丢弃会拖垮 dense 通道，provider 有 400→截断重试兜底）
- **检索**：`computeDenseScores(query)` → `searchScored({denseScores})` → RRF 融合；`mafw_search_hybrid` 的 `retriever:'hybrid'` 与 `/api/memory/search?retriever=hybrid` 已接线；boundary recall 同步路径**不**嵌查询（100ms 契约）
- **ConsolidationService**（`gateway/src/memory/consolidation-service.ts`）：写入后 cosine≥0.8 候选召回 → worker 模型 LLM 判 UPDATE/CREATE（Memora 式）；UPDATE 合入新条目 + soft-supersede 旧条目 + 删除旧向量；裁判不可达时 skip（fail-open）；`GET /api/memory/stats` 暴露 update ratio。**候选池过滤（2026-09-29 审计 H4 + S4）**：判官前剔除 superseded 与孤儿候选（向量在但 unit 不可读）——合并进死条目会复活它；**`distinct_from` 双向尊重**（unit 标记的候选、候选标记 unit 的，都禁止合并——模式分离是刻意决定）；**判定对审计日志** `~/.mafw/logs/consolidation-pairs.jsonl`（每次判官调用一行：new/候选/cosine/verdict）——update ratio 0% 的根因审计见 `docs/research/2026-09-29-consolidation-audit.md`（H2 判官偏置待 pair 数据终判，16-22% 健康带对个人库可能需重定义）
- **laya 三值分流门（D3，2026-10-09）**：级联升级为三值——p≥tauHigh→UPDATE、全部候选 p≤tauLow→直接 CREATE（跳过 LLM；CREATE 本就是判官 fail-open 行为）、中间带→转 LLM。`tauLow` 默认 0=关闭；开闸需 `gateway/scripts/calibrate-laya.ts` 对 pairs jsonl 提议（≥50 scored + ≥5 update 对 + create/update 带不重叠 + 0.3 上限）并经用户批准；tauHigh 保持 0.99（separate 失明带永不自动 UPDATE）。审计 `decidedBy:'laya-low'`，stats 增 `layaCreated`。首跑真实数据（187 对）：8 条 create 落 0.9-1.0（失明确证）+ 仅 3 条 update → 正确返回无安全线

### 能量衰减

- 基础衰减率 **0.005/天**（`EnergySystem.decayRatePerDay`，salience 越高衰减越慢——`HarmonicIndexEntry` 携带 `salience`，衰减 pass 读取）
- 默认自动化规则 `memory-decay`（每日 UTC 3:30，`recall/pipeline-rules.ts` 供给）：**增量衰减**——按 entry `last_decay_at`（缺失回退 `created_at`）计算流逝天数做纯时间衰减（无事件加成）；`last_decay_at` 仅在实际写入衰减时盖章（低于 0.005 写入阈值时天数继续累积，防低 salience 条目饥饿）
- **检索访问结算（ACT-R 式，2026-09-29）**：recall 路由 / 快照 serve / `mafw_search_hybrid` 三个生产出口把命中（id + 概率 + 时间戳）记入 `RetrievalEventBuffer`（内存环形缓冲 + 7 天 need 索引，`core/memory/retrieval-events.ts`，fail-open；eval 不经这些出口天然隔离）；每日衰减 pass **同一趟** drain 并按 `actrBonus()`（`B=ln(1+Σ(Δt+24h)^-0.5·w)`，`core/memory/retrieval-bonus.ts`）结算——k=0.03 均衡点使"一次新鲜检索 ≈ 一天衰减"，cap 0.02，重复曝光折扣防 rich-get-richer；bonus 先于衰减应用并 clamp 1.0。线性 `+0.02` 直写已删（无界/正反馈，access-bonus.ts 移除）
- **goal 奖励调制（B4，2026-09-29）**：`archiveGoal(verdict=PASS)` → goal_sessions 关联且未 superseded 的记忆 energy +0.08（clamp 1.0；**不对称：失败不降权**，防错误归因）——`core/manager/goal-reward.ts`，fail-open
- 事件加成（`useful_feedback` +0.1 等）由 `EnergySystem.calculateEnergy` 提供，只作用于 **L3 参数化 `ParametricStore`**（`core/memory/store.ts`），**不作用于谐波单位**，也不在衰减 pass 中混用；谐波单位的检索加成走 ACT-R（上一条）、goal 奖励走上一条
- index v1→v2 一次性迁移：全部 entry 盖 `last_decay_at`=迁移时刻、**不补扣历史衰减**（旧实现按 `created_at` 每次运行重复扣全龄衰减，累计 r·n(n+1)/2 平方损失，历史已过度衰减故豁免）；迁移由 `HarmonicIndexManager.migrateDecayBaseline()` 执行

### 管线心跳（Pipeline Heartbeat）

背景管线**默认静默失败**——ledger 只记 `AUTOMATION_TRIGGERED`（规则触发了），不记是否跑成/产出多少；2026-09 的衰减冻结与判官空转正是这类（日志只有 Scheduled/重复 Migrated，无"实际生效"信号）。

- `recall/pipeline-heartbeat.ts`：`PipelineHeartbeat`（kv 持久化 + 纯逻辑可测）——每个管线出口 `record(name, { ok, counts?, error? })`，`snapshot()` 计算 `stale`（距上次成功 > 2× 预期间隔；从未跑过不判 stale 防启动误报），`sweep()` 每 episode 只告警一次（成功即清）
- 接线：`memory:decay`（automation-engine action，经 `AutomationEngine.setHeartbeat`）、`memory:turnCompress`/`memory:reflect`/`memory:review`（index.ts 管线闭包，`failed>0` 记 ok:false）、`consolidation`（`ConsolidationService.onJudge` 回调，仅判官真正被调用时记录）
- 落 `gateway.db` kv_store scope `pipeline-heartbeat`；`GET /api/memory/stats` 增 `pipelines` 字段（`lastRunAt`/`lastSuccessAt`/`lastCounts`/`ok`/`stale`）；index.ts 每 30min `sweep()` 告警（arXiv:2609.05510「没有枚举失败模式可以静默通过」）
- **日预算帽（2026-10-09）**：`recall.pipelineBudgetUsdPerDay`（默认 0=无限）——`PipelineBudget`（`recall/pipeline-budget.ts`，fail-open）按 UTC 日聚合 `TrajectoryStore.getWorkerSpendSince`（worker_role 非空的 turns cost 求和）门控五个 LLM 管线：extract/reflect/review/index-scan/consolidation 判官；超限 deny + 每管线每日 warn 一次；laya 级联（本地零成本）与 decay/回放等非 LLM 路径不受门控。

### 后台记忆召回（Background Recall）

系统概述 — **边界 recall + 回合末 recall** 两个机制：

```
opencode server 进程                    Gateway 进程
┌─────────────────────────────┐        ┌──────────────────────┐
│ Plugin (两个 hook)          │        │ HarmonicIndexManager │
│                             │        │                      │
│ experimental.chat.messages  │        │ GET /api/recall/     │
│  .transform                 │ HTTP──▶│ context?query=...    │
│  → 边界 recall 触发         │◀───────│ → search → format    │
│  → 注入指针块到 messages 尾部│        │ → {pointers}          │
│                             │        │                      │
│ experimental.chat.system    │        │ (无独立通道：全部记忆  │
│  .transform                 │        │  都在谐波系统中)      │
│  → 注入 <memory-guide> 到   │        │                      │
│    system 前缀（OptMem 式）  │        │                      │
└─────────────────────────────┘        └──────────────────────┘
```

实际的 recall/观察机制由两部分组成（插件观察捕获 + 边界注入）：

| 环节 | 时机 | 实现 |
|------|------|------|
| ① 观察捕获 | 用户消息 / 工具执行后 / text.complete / reasoning.ended / tool.failed | 插件 hooks（`src/plugin.ts`）→ `POST /api/obs/capture` 写 t1_observations |
| ② 边界 recall | **每次 LLM 调用前**（messages.transform 在 agentic 循环内；增量游标使同 turn 后续 step 近似幂等；增量 <50 字符时拼入上一条 assistant 尾文本做短增量回退） | 插件调 `GET /api/recall/context` → `<recall>` 指针块 |
| ④ 聚合压缩 | cron 每小时（turn-compress 规则） | turnCompress pipeline → per-session worker → `mafw_add_memory` |

> 旧 ③ 步进注入（step-inject：step-finish 后 daemon 把高价值记忆 `promptAsync` 回会话触发自治续跑）已于 2026-09-19 删除：实测产出几乎全是"已确认，无需行动"（一次全上下文回放换一句废话），且依赖 runtime 事件流——会话不跑在托管 serve 上时整条链断供。其唯一独占的检索信号（以 assistant 尾文本为 query）已由 ② 的短增量回退覆盖。

**职责分工：** Plugin = 两个 transform 注射口。Daemon = gateway 事件流订阅（轨迹采集 / compaction flush / BudgetGuard 等）。
聚合压缩/反思 worker 的 LLM 模型由 `config.recall.workerModel` 固定（代码默认 `alibaba-cn/qwen3.7-max`，Config 页可改），per-message 传入；已存在的 worker session 下一次 prompt 即生效，无需重建。
- 为复用前缀缓存、降低 token 成本，worker session 在 idle 达到 `config.recall.workerCompactIdleMs`（默认 8h）后，下一次 prompt 会先调 opencode 的 `session.summarize` 做 compaction；summarize 失败则直接 dispose 轮换（下次 prompt 重建新会话）。
- xiaomi provider 可在 opencode 配置里开 `options.setCacheKey: true`，让请求带上 `promptCacheKey` 以便命中缓存（对端点是否生效取决于小米 API）。

### 边界 recall 性能契约与预取快照（R8，2026-09-28）

边界 recall（`/api/recall/context`，插件每轮 LLM 调用前注入 `<recall>`）有 **100ms 硬契约**（插件侧 abort，fail-open）。**实测曾长期 240ms → 契约被违反 → abort → fail-open → 每轮自动记忆注入静默失效**。三个叠加根因与修复：

| 根因 | 实测 | 修复 |
|---|---|---|
| BM25 每次查询对全库重新分词 | 3753 条 ≈53ms/趟 | `tokenCache`（按 id 缓存 tokens，searchable text 校验失效；`bm25RawScored`） |
| BM25 打分对每个查询词扫描全文档词 | 单趟 ~18ms 温 | `tokenCache` 改存词频表（`tf`/`len`）→ 单趟 ~10ms、五趟扩展路径 37→21ms |
| 查询扩展 10 实体 + 4 子查询 = 14 趟全库 BM25 | 并发下 256–297ms | `search.expansionMaxSearches`（默认 4） |
| 后台快照构建并发（dense 嵌入 + 两次 reranker）饿死边界路径 | — | `snapshotBuildInFlight` 串行 + `LlamaCppReranker.rerankDetailed`（一次打分同时出重排与概率） |

修复后：**服务端检索 74–77ms（契约内）**，快照路径 **3ms**。
- **边界路径没有 dense 的空间**（实测开启后 72–86ms → 100–107ms，护栏在 +25ms 触发且无 dense 收益）→ `search.boundaryDense` 默认 false 保留实验开关；R2 经 R8 快照（后台）进入边界路径
- 失败排查：`/api/recall/context` 的 snapshot 决策日志带 `containment=` 与查询长度；短指令（"继续"/"可以"）与内容窗口天然零重叠，此时走实时路径是正确的

**R8 预取快照**（`search.snapshot`，默认 off→生产已开）：`/api/obs/capture` 的 `user_input` 触发每会话防抖（2s）后台构建——滚动窗口查询（4 轮/600 字符，最后一轮只含 session 词汇 ~36%）→ hybrid（R2 dense RRF）+ R3 rerank + R5 FOK + R6 邻居 → 渲染块存 kv（scope `recall-snapshot`）；边界路径命中即服务（TTL 10min + **包含度**≥0.25 判定话题未漂移），否则回落实时 BM25。
- **话题判定必须用包含度（overlap/min 侧）而非 Jaccard**：Jaccard 对"600 字符窗口 vs 15 token 追问"有长度偏置，实测 158/246 次快照被误跳过
- 定位延迟用 `/api/recall/context` 的 `[Recall] timing` debug 日志（search/noteBoard/goal/neighbours 分段）

### 读路径脑对齐切片（R1–R8）交付状态

| 切片 | 层 | 状态 | 关键实测 |
|---|---|---|---|
| R3 验证层（Qwen3-Reranker GGUF） | 排序 | ✅ | R@1 +0.09 |
| R2 dense 融合 | 召回 | ✅（快照内） | 回合粒度 R@1 +4~7pt / R@10 +6~8pt |
| R2+R3 叠加 | 排序 | ✅ | 120q R@1 0.673 / NDCG@1 0.917（最优） |
| R6 邻居**呈现**（↳ 行 + 最近版本指令） | 注入 | ✅ 每轮 | L2 +8.3pt |
| R6 邻居**检索层** | 排序 | ❌ 默认 off | 两粒度全零（LongMemEval 真值粒度错配） |
| R5 FOK 三区门 | 门控 | ✅（快照内 + 显式检索出口返回 `fok`） | 拒答 0.867→0.967；特征必须用 reranker 概率（AUROC 0.782）而非 bm25 分数比（0.582）；行为"声明不撤回"；概率阈值与分数阈值是两套（误用会把一切判成 no-memory） |
| R7 标识符双索引 | 分词 | ✅ | 空格形 hit@10 38%→90% |
| 写端标识符收割（cue_anchors） | 写路径 | ✅ + 迁移脚本 + 提示词根因修复 | 冻结样本 hit@50 70%→98%；月度缺口基线（52–58%）供提示词修复前后对照 |
| R1 LLM 改写 / R4 近因 | — | ❌ 不作默认 | 伤 temporal / 净负 |

**方法论（写死）**：先问测量面——加候选类看回合粒度 R@k，重排类看 R@1/NDCG，呈现类只能看 L2，门控类看 AUROC，写端保真看冻结样本 + 可复现对照。**样本漂移会伪造结论**（缺口集合随状态移动）；**一次性备份会被后续迁移覆盖**，A/B 的 before 必须从当前状态派生。
- 探针：`evaluation/mafw-identifier-probe.js`（R7）、`mafw-fidelity-probe.js` / `mafw-fidelity-ab.js`（写端保真）、`gateway/scripts/harvest-cue-anchors.ts`（迁移，dry-run 默认）

### 注入点收敛

所有注入路径统一使用 `gateway/src/recall/inject-format.ts` 的 `formatRecallContext()` 渲染：

| 路径 | 注入物 | 格式 |
|------|--------|------|
| `experimental.chat.messages.transform` | pointer 块（`<recall>`） | 尾部，per-turn |
| `experimental.chat.system.transform` | 记忆操作引导（`<memory-guide>`，OptMem 式） | 前部，常驻 |
| `withMemoryInjection()` | deltas + facts + recall | 全量，每次 promptAsync |
| `/api/chat/enriched` | deltas + facts + recall | 全量，首次会话创建 |

pointer 块与全量内容块分别收敛在 `inject-format.ts` 的 `formatRecallContext()` / `renderMemoryBlocks()`。

### 主动记忆引导（OptMem 式）

**无独立于谐波记忆的通道**。所有记忆（含用户约束/偏好）都存谐波系统；`<memory-guide>` 常驻 system，让 agent **主动操作**记忆系统（参考 [OptMem](https://github.com/VictorTaelin/OptMem)）：

```
<memory-guide>

#### Pinned 披露层（2026-08-28）

`pinned` 是 HarmonicUnit 一等标志（与 type 正交）：pinned 且未 superseded 的记忆经
`GET /api/recall/pinned` 渲染为 `<user-profile>` 块，由插件 system.transform 每轮注入
（`<memory-guide>` 之后，半稳定内容靠后保前缀缓存；fail-open 150ms 超时）。预算
20 条/2000 字符，按 energy×salience 截断（salience 缺失按 1），溢出记
`[Recall] pinned overflow` 日志。知识更新：`mafw_add_memory { supersedes: 旧id }` 显式取代
（复用 `markSuperseded()` soft-supersede 链，新条目 energy 继承 max(0.8, 旧条目) 且 pinned 不继承）；
纠错正门 `mafw_pin_memory`。渲染收敛在 `inject-format.ts:formatPinnedProfile()`，
路由逻辑在 `routes/pinned-recall.ts`（deps 注入可单测）。
不加独立 update/delete 工具（业界实践：记忆变异属后台管线——下期 turnCompress 矛盾检测）。

#### Sticky 便签板（2026-09-07）

`sticky_until` 是 HarmonicUnit 一等字段（ISO 日期；OKF frontmatter 白名单需显式携带，index entry 为板成员资格权威来源、渲染时回退）：未过期且未 superseded 的记忆经
`/api/recall/context` 尾部渲染为 `<note-board>` 块（`routes/note-board.ts`，deps 注入可单测；
渲染 `inject-format.ts:formatNoteBoard()`），解决"用户说'记下来'但只有 BM25 词面匹配才能想起"
的缺口——检索条件化之外的有保质期保证送达层。语义对齐业界调研（mem0 expiration/
Graphiti invalidation）：**板级过期 ≠ 记忆删除**，到期仅下架，本体照常可被 BM25 检索；
坏日期 fail-open 留在板上并排最后；排序按到期近者优先（紧急提醒前置）。预算 10 条/1600 字符（单条 240 截断；`NOTE_BOARD_BUDGET` 单一来源，端点 503/降级兜底经 `emptyNoteBoardBudget()` 复用，勿硬编码），
溢出记 `[Recall] note-board overflow` 日志。写入：`mafw_add_memory { sticky: true, stickyDays? }`
（默认 7 天）；管理：`mafw_pin_memory { id, sticky, stickyDays? }` 上板/续期/下架。
`mafw_get_memory` 补齐指针兑现：按全 id 或 `<recall>` 尾 6 位取全文，superseded 自动沿链附最新版；
HTTP 等价 `GET /api/memory/get?id=`。业界三层映射：pinned=Letta core blocks（永久可见）、
sticky=OptMem wake（近期可见）、BM25=archival（按需检索）。桌面呈现：`GET /api/memory/sticky`
（结构化 entries+budget，fail-open）→ SDK `memory.listSticky/setSticky` → 右侧 Dock「📝 便签」tab
（NotesDock：倒计时 ≤1 天红色高亮、续期/下架/删除、预算徽标、15s 轮询）。

#### Agent-priors 常驻先验块 + Skill 物化通道（W1/W2 + D1b，2026-10-08）

抽象层到 runtime 的 push 通道（此前 L5 公理纯 MCP pull、reflection insight 只有 BM25 或然命中）。调研：`docs/research/2026-10-08-abstraction-runtime-wiring.md`；路线图：`2026-10-08-brain-like-roadmap.md`。

- **W1 `<agent-priors>`**：`GET /api/recall/priors`（`routes/agent-priors.ts`，deps 注入可单测）聚合 L5 公理/启发式 + L2 失败模式谱（`cat:failure`/`cat:correction` 锚点，need×energy×salience 排序），经 `formatAgentPriors()`（预算 800 字符）渲染；插件 `src/hooks/agent-priors.ts` 在 `system.transform` 注入（memory-guide/user-profile 之后，fail-open 150ms）。**先决**：reflection 的 insight category 现落 `cat:` 锚点（`buildInsightUnit`，此前映射到 type 后即弃）。
- **W2 skill 物化**（md↔md 通道，零 LLM）：`memory/skill-promotion.ts` 的 `evaluatePromotion` 五闸门 G1 热度(need7d)/G2 一致映射(步骤式 vs 条件分支)/G3 验证过(`verified:` 锚点)/G4 稳定性(近 7 天未修订)/G5 列表膨胀(maxSkills) + `renderSkillMd`（OKF→SKILL.md，name=`ms-<id尾6>`，description=摘要+触发词）→ 周管线 `memory:skillPromotion`（周日 05:00 UTC）扫描 procedural 记忆，合格者写 `~/.mafw/skill-staging/<name>/SKILL.md` + triage 草稿（`summary.skillDraft`）→ 人审（`POST /api/triage/:id/confirm` 的 skillDraft 分支调 `skill-install.ts`）→ 拷入 `~/.config/opencode/skills/` + 源记忆改写为指针（`已物化为 skill:<name>` + `skill:<name>` 锚点）。判据依据：Schneider&Shiffrin 一致映射、JIT 热点编译、Voyager 自验证、AWM 复用频率。
- **D1b**：reflection 成功蒸馏后对源 episodes 按 factor（默认 0.3）降能（`demoteSourceEpisodes`）——Fuzzy-Trace：细节先淡、要点存活；降能非 supersede（多 gist 共享 episode，1:1 链会过度重定向）。
- **L1/L2/A4（自我认知反馈闭环）**：`orchestration/capability-ledger.ts` 的 `buildCapabilityLedger`（goal_outcomes 聚合：PASS 率/均轮数/均成本/thumbs/failure_kind 分布）+ `buildFailureTaxonomy`（`cat:failure`/`cat:correction` 蒸馏产物按 primary_abstraction 聚类），经 `GET /api/agent/capabilities`（`routes/capability.ts`，deps 注入）暴露；**A4 选择压力回流**：reflection prompt 追加 `selectionFeedbackBlock`（本会话既有 insights 的 7 天 need 命中，未被检索的提示合并/删除；`needFor` 注入 `getReflectPipeline`）。已知缺口：goal 无任务类型维度（L1 只到 verdict/failure_kind 粒度）。

**工具语义类别层（2026-10-13）**：`runtime/tool-classes.ts` 并集单表（工具名 → `TOOL_CLASS`：readonly/search/file-edit/shell/subagent/web/plan/other，大小写不敏感——opencode/pi 小写名 + Claude PascalCase + codex 条目类型名统一解析；spec `docs/superpowers/specs/2026-10-13-tool-class-layer-design.md`，调研 `docs/research/2026-10-13-tool-identity-layer-research.md`）。消费方：审批 `isReadOnlyTool`（read-only 档放行 = readonly+search，修 opencode `list` 漏登）；identity `resolveToolCategory`（per-runtime 双表收敛为单表查询，修 pi `find` 漏登致 manager 误 auto-deny）；`commandTextOf`/facet `toolCommand` 多 key 候选链（command→cmd→script，防新 runtime 换 key 失明）；curator 白名单并集（read/grep/glob/list/ls/find）；handleRuntimeEvent（`runtime/event-dispatch.ts` 表驱动链）单点 enrich `part.toolClass`（additive 可选字段，desktop/TUI 渲染迁移留后续）。

### 数据目录与统一数据库

**MAFW 数据根固定为 `os.homedir()/.mafw`**（`config.resolvePath()`，与启动 cwd / MAFW_PROJECT_DIR 完全解耦；`paths.mafwDir` 配置覆盖失效）。启动时自动迁移 gateway 包目录旁的旧数据（`gateway/src/recall/data-dir-migrate.ts`，幂等，删除旧位置）——注意迁移源是 `<gateway包>/../.mafw`，**不是** project-relative `.mafw`；插件侧仍会在项目目录重建 `.mafw/`（日志与请求文件等）。

**统一数据库 `~/.mafw/memory/gateway.db`**（`GatewayDatabase`，`gateway/src/memory/gateway-db.ts`）：
- `t1_observations`：回合观察（插件经 `/api/obs/capture` 写入，turnID 网关分配，UNIQUE 去重；**入库前经 `redactSecrets()` 脱敏**（`gateway/src/recall/redact.ts`，sk-/ghp_/Bearer/JWT/key=value 等格式 → `[REDACTED]`），下游 turnCompress/worker prompt/archive 只读脱敏内容——存量历史行不回溯）
- `t1_turns`：持久化逻辑回合身份（T1 identity，2026-11-10）——`trace_id` PK、`session_id`+`turn_seq` UNIQUE；`turn_seq` 单调且**不重用**（跨 `t1_turns`/active/archive 取 max）；`encoding_salience` 记录编码期 salience 抬升；`archived_at` 记录归档时间；`legacy_ambiguous` 标记重复 legacy 复合键（>1 个 `user_input` 或横跨 active+archive）。`t1_observations` 与 `t1_archive` 各带永久 `trace_id`/`observation_key`——归档不改变身份，legacy 行回读 NULL 直到构造期幂等 `migrateT1Identity()` backfill
- `t1_retrieval_events`：T1 verbatim 观察向的检索事件（2026-11-10，Phase 2A）——`trace_id`/`kind=search|recall|redeem`/`score`/`created_at`；**只观测，不参与 energy 或排序**。`GatewayDatabase.t1RetrievalStats({since})` 按 Unix 秒聚合；`pruneT1RetrievalEvents({before})` 按保留期删除，由每日 `memory:decay` 以 `config.recall.t1Recall.retentionDays`（默认 90 天，0/负数关闭）触发，删除量进 heartbeat `prunedT1`
- `t1_fts`：T1 词面索引（2026-11-10，Phase 2B）——FTS5 `trigram` tokenizer + `content/trace_id/observation_key/session_id/turn_id/source`；**可重建派生数据**，写入 `append()` 同步、`archiveTurn()` 不动（内容不变）、`deleteTurn()`/`deleteSession()` 按 `observation_key` 删除；表空且源表有行时构造期 `rebuildT1Fts()` 一次重建，也可手动重建（先清空，幂等）。trigram 要求查询 token ≥3 字符
- `t1_vectors`：T1 二进制向量（2026-11-10，Phase 2B）——`key` PK / `dims` / `model` / `vector`（little-endian `Float32` BLOB）/ `updated_at`；`SqliteT1VectorStore` 按行更新，避免 JSON 全量重写。首次构造且当前 model 无行时从 `memory/vectors-t1-<tag>.json` 导入并把 JSON 改名为 `.migrated-<ISO>`（不删除）；`config.memory.embedding.t1VectorStore='json'` 可回滚到旧 JSON 后端
- `t1_trace_state`：T1 trace 的有界激活状态（2026-11-10，Phase 3B）——`trace_id` PK / `activation`（0–1）/ `retrieval_count` / `last_retrieved_at` / `last_replayed_at` / `activation_updated_at`。检索事件每命中一次 `+0.1`（封顶 1），记忆兑换按 `source_trace_ids` 传播 `+0.05`（单次权重上限 0.2），每日 `memory:decay` 按半衰期（默认 14 天，`config.recall.t1Recall.activationHalfLifeDays`）指数衰减，heartbeat 记录 `t1ActivationDecayed`。**本阶段只写状态，不参与排序/energy/snapshot**
- `kv_store`：易失关键小状态——
  - `manager-session`（key=projectDir，**per-project manager session**，替代旧 manager-session.json）
  - `reflect-cursor`（key=sessionID，反思增量游标）
  - `registry/snapshot`（注册表快照，权威仍在 `scheduler/registered-projects.json`）
- 旧 t1.db / manager-session.json / recall-reflect-cursor.json 启动时自动回填并入库后删除（`gateway/src/recall/gateway-db-migrate.ts`，幂等）
- `GET /api/manager/session` 返回全部项目的 manager session 列表（`?projectDir=` 过滤单条）
- `POST /api/manager/session/rotate`（`{projectDir, reason?}`，`routes/manager-rotate.ts`）：**开新话题**——旧 session metadata 降级 `role: 'manager-archived'`（去 pinned/exempt，回归普通生命周期，自动出现在桌面历史列表），强创建新 session 替换 kv 并重跑身份注入；与 `ensureManagerSession` 经 `managerSessionInflight` 互斥。MCP `mafw_new_topic` 已退役；HTTP/SDK rotate 仅内部兼容

**T1 verbatim 检索（2026-11-10，Phase 2A）**：

- `mafw_search_hybrid` / `GET /api/memory/search` 支持 `layer=gist|t1|both`；**省略 layer 时仍只搜 Harmonic**，旧结果形状不变。T1 结果带 `traceId`/`sessionId`/`turnId`/`cosine`/`excerpt`/`sources`/`score`，默认 gist 不产生 `t1Results`。
- `createGatewayT1Search`（`recall/t1-search.ts`）是 gateway 共享入口：dense 通道惰性读取 embedding runtime（热切换不残留旧 provider），archive 优先、active 回退；词面通道查 `t1_fts`。两路用 RRF 融合（`1/(60+rank)`，`fuseT1Hits`），同 trace 去重并优先保留词面 excerpt；单路失败/关闭时另一路照常返回，dense provider off 时仍有词面结果。`config.recall.t1Recall.lexical=false` 可关闭词面通道。
- T1 自动回填：每日 `memory:decay` 在 Harmonic 回填后调用 `backfillT1Vectors`，archive 优先分页扫描，跳过已有 key，单次默认最多 200 条（`config.recall.t1Recall.t1BackfillLimit`，0/负数关闭）；heartbeat 记录 `t1BackfillIndexed`/`t1BackfillMissing`/`t1BackfillFailed`，`/api/memory/stats` 的 `t1.coverage` 暴露覆盖率。
- T1 二进制向量：`SqliteT1VectorStore` 把向量存为 `gateway.db` 的 `t1_vectors` Float32 BLOB（按行 flush，无全量 JSON 重写）；无 DB 句柄的测试/评测环境自动回退 JSON store。首次迁移导入 `vectors-t1-<tag>.json` 后改名保留备份。
- 精确 provenance（2026-11-10，Phase 3A）：Harmonic 单元新增可选 `source_trace_ids`（OKF frontmatter + index entry）。抽取 transcript 每行前缀 `[trace:<traceId>]`，curator 通过 `mafw_add_memory.sourceTraceIds` 回传支持该记忆的精确 trace；处理器用 `t1_turns` 校验（存在、去重、`t1:` 前缀兼容、最多 20 个），未知 id 直接丢弃且不影响写入。MCP 与 HTTP `/api/memory/add` 行为一致；merge/update 时 incoming 与 target 的 trace 取并集（上限 20）。
- 精确 provenance 读取：`mafw_get_memory` 优先解析 `source_trace_ids`（最多 5 条）返回 `source.traces[{traceId,sessionId,turnId,archived,excerpt}]`；解析不到时回退旧 C0 `source.evidence`。`/api/memory/stats` 的 `t1.provenance` 暴露 `{memories,withExact,coverage}`。
- 3A **不改变** energy、排序、activation 或 recall 注入；`source_trace_ids` 仅作为可审计来源与后续 activation 的精确边。
- T1 activation 状态（3B）：`t1_retrieval_events` 的 `search/recall/redeem` 同时更新 `t1_trace_state`（每次 +0.1，封顶 1）；`mafw_get_memory` 成功解析精确来源时向源 trace 传播 +0.05（单次上限 0.2）；每日 `memory:decay` 指数衰减（默认半衰期 14 天）。`/api/memory/stats` 的 `t1.activation` 暴露 `{traces,mean,max}`。**3B 仍不读取 activation 排序**——排序消费留到有 A/B 数据的下一阶段。
- 有界 activation 排序（3C）：`config.recall.t1Recall.activationRanking='off'|'shadow'|'on'`（默认 `shadow`）。只有 RRF 分数 ≥ `activationRankBand`（默认 0.6）× 最高分的命中才可被激活提升，提升幅度 ≤ `activationRankWeight`（默认 0.1，硬上限 0.2）；activation 不能新增命中或救回带外结果。`shadow` 只计算并计数、不改顺序；`on` 才生效。`/api/memory/stats` 的 `t1.activationRanking` 暴露 `{mode,evaluations,wouldReorder,applied}` 供 A/B 决策。
- T1 只读指针：`mafw_get_memory("t1:<traceId>")` 走 `readTrace()` 返回 active+archive 完整回合与 `archived`/`legacyAmbiguous`；旧 `t1:<sessionTail>:<turnId>` 继续兼容，并回退查 active 行。
- R8 快照把 T1 当独立通道：Harmonic 零命中但 T1 命中时可生成 T1-only 快照（`T1_POINTER_HEADER` + `[t1|<traceId>]` 行）；`decideSnapshotUse` 接受 `ids=[]` 但 `t1Hits` 非空。快照 serve 记录 `recall` 事件；直接搜索记录 `search`；指针兑换记录 `redeem`。
- `/api/memory/stats` 的 `t1` 字段暴露向量数、active/archive 行数、覆盖率与 7 天检索事件统计。
- SDK `MafwClient.memory.searchLayered({ query, layer? })` 返回 `{ layer, results, t1Results }`；`memory.search()` 保持旧签名且不发送 `layer`。
- 本阶段**不做** T1 activation/energy、provenance 传播、原文重放或 skill 行为变更。

**Manager 常驻目标感知（2026-09-03）**：
- **每轮 goal 快照**：`GET /api/recall/context` 识别活跃 manager session（kv sessionId 比对）后在 recall 块尾部追加 `<goal-snapshot>`（`core/manager/goal-snapshot.ts` 确定性聚合，≤10 条/500 字符，compaction 免疫）；非 manager session 不受影响。**按名引用渲染**（2026-09-15，wayfinder 约定）：`标题 (goalId) [phase=…]`——标题在前、id 在括号里，不用裸 id 刷屏
- **Charter 决策地图五段约定**（2026-09-15，借鉴 mattpocock wayfinder，`skills/manager-identity.ts` 系统提示）：Destination / Plan / Decisions so far（决策索引：一行 gist + 记忆 id，不复制详情）/ Not yet specified（fog，已知的未知，frontier 推进后毕业）/ Out of scope（排除项）；决策本体用 `mafw_add_memory`（semantic，cueAnchors 带 goalId）记录，charter 与 state 只存指针——记忆可跨会话检索，state 只是索引
- **里程碑推送**：`core/manager/milestone-push.ts` 挂 `eventBus("phase_transition")`（PLANNING_COMPLETE/REVIEWING_COMPLETE/ASKING_USER）+ `archiveGoal()`（completed/failed/cancelled），per-project 合并队列（5s），持久化去重键 `milestone-notified/{goalId}:{phase}:{stateVersion}`，`promptAsync(noReply: true)` 硬免回复（消息落历史不触发 LLM；pi runtime busy 分支会丢 noReply 语义——已知限制）
- **/btw 支线问答**：用户直发指令（桌面 `/btw` slash 命令 / 插件 `/btw` command → `/api/mafw-commands/run`），spawn 一次性 session（registerInternal 'btw'，不回流 T1），prompt 一次拿回答即删；`btw` 为用户指令驱动（UI-driven, not LLM-driven），刻意不暴露 MCP 工具给 agent
- **/waitwhat 重述**（2026-09-15，借鉴 mattpocock wait-what）：用户发"没听懂"→ gateway 取当前会话最后一条 assistant 文本，promptAsync 回同一会话要求"简明语言（STE100 风格）+ CONTEXT.md 术语重述，不新增内容"（`routes/waitwhat-command.ts`，deps 注入可单测；回答经 SSE 三端同见）；接线：桌面 ChatPane mafw 命令组 + 插件 `waitwhat` command + TUI `/waitwhat`（immediate）
- 旧三条 `manager-report-*` 自动化规则已退役（wake 链路读已删除的 legacy 文件 + 事件无人 emit，整链死代码），`ensureManagerRules` 启动时清理规则文件

**聚合压缩（memory:turnCompress，每小时）**：每活跃 session 将本小时所有完成回合合并为一份 batch transcript，交给该 session 的**持久 worker 会话**，由 agent **自主调用 `mafw_add_memory`** 记录值得长期记忆的条目（类型按内容自选）。处理过的回合**一律归档**（t1_archive，空/失败不重试——原始观察保留供未来重提取）。内部 worker 会话经 `/api/obs/capture` 的会话白名单过滤——**输出永不回流 T1**（防递归）。**交错回放（B1 二期，2026-09-29）**：worker prompt 除新回合外注入跨会话 prior knowledge——BM25 召回候选池后按 `need × gain × 1/energy` 重排（need = RetrievalEventBuffer 的 7 天命中数，`replayPriorityForMemory`），被选条目盖 `last_replayed` 戳（48h 排除窗防 primacy bias，池全排除时回填防空）；回放条目只作 reconcile 对照证据不重写原文（防 domain shortcut）；`TurnPipelineResult.replayed` 计入 heartbeat 观测。

#### 环境探测式记忆维护（Environment-Probing Curation，2026-09-14，arXiv:2609.11060）

post-task curator 只看轨迹会记下错误答案/过度泛化/过期知识（"回顾性证据边界"）。落地为四点（A/B/C/D）：

- **A. curator 只读探测面**：`memory-curator` agent 工具白名单在三个记忆工具之外放开 `read/grep/glob/ls`（`skills/memory-curator-agent.ts`）；**edit/bash/webfetch 仍 deny**——2026-08-31 transcript 执行事故的硬防线（mutation 禁止）不变，只读工具不破坏该不变量。`HARD_BOUNDARIES` 改写为"只读验证允许、任何写/执行绝对禁止"。`TOOL_EXTRACTION_SYSTEM` 加 propose–probe–commit 段：项目相关 procedural/semantic 记忆写入前先探测验证（每条候选 ≤3 次 probe）；transcript 与环境矛盾时以环境为准并 supersedes；只记可复用过程不记实例答案。另有**指针优于全文**（内容已被 repo artifact 承载时记"路径+一句话 gist"，文件是真相源记忆是索引）与 **next-time 路标**（procedural 记忆结尾带"→ next time: 用哪个 skill/工具"）两条约定（2026-09-15，借鉴 mattpocock handoff）。
- **B. stale 刷新（memory:review 每周日 UTC 4:00）**：`StaleVerifyPipeline`（`recall/stale-verify.ts`）取 top-10 energy×salience 的 procedural/semantic 记忆（>14 天、未 superseded），交 `stale-verify` worker 用只读工具重验，失真走 supersedes 链。**语义升级**：index.ts `registerMemoryPipelineActions` 覆盖了 automation-engine 模块级的 memory:review 桩（原只打印 ReviewScheduler 队列，review_count 无消费者）；规则由 `pipeline-rules.ts` 供给。能量衰减管"淡忘"，本管线管"内容有效性"。
- **C. 验证置信度约定**：探测验证过的记忆 cue_anchors 带 `verified:YYYY-MM-DD` 锚点（prompt 约定，不动 schema），检索时可区分"环境验证过"vs"trajectory-only"。
- **D. 成败信号喂给 curator**：`TurnPipelineOptions.gradeFor` —— `GatewayDatabase.getOutcomeForSession()`（goal_sessions ⋈ goal_outcomes 取最近 archived）拼入 worker prompt；prompt 明确"passing grade 不证明中间假设正确，失败轨迹的经验须先验证"。

限制：bash 不开（opencode 权限 per-tool，无法过滤只读命令），"命令还能不能跑"类验证不在覆盖范围；plan B（gateway 侧确定性路径探测）记录在案未实施。

### api/recall/context endpoint

```
GET /api/recall/context?sessionID=xxx&query=xxx
Response: { pointers: string|null }
```

- v0：同步 HarmonicIndexManager.search(query, 3) → formatRecallContext()
- fail-open：超时/错误返回 `{ pointers: null }`，不阻塞 LLM 流程
- 未来：daemon 预计算好注入载荷，endpoint 读快照 ~1ms

### 脑启发记忆演化第二批（2026-10-09）

计划：`docs/superpowers/plans/2026-10-09-remaining-roadmap-all.md`（D3 独立计划见 `2026-10-09-d3-laya-three-way-gate.md`）。全部后台管线统一形态：纯函数核心 + cron 接线 + `PipelineBudget` 门控 + heartbeat 记录 + observe-first。

- **D2 检索即重写**：`recall/reconsolidate-pipeline.ts`（`selectNewerRelated` 纯函数 + `ReconsolidatePipeline.runOnce`）——被检索进入 24h labile 窗口（`recall/reconsolidation.ts` 已 mark）的记忆，每日 `memory:reconsolidate`（cron `30 4 * * *`）用更新的同 cue 记忆对照，worker 判 keep/rewrite；rewrite 经 supersedes 链写新条目。每 id 每趟 consume 一次（无重试风暴）；budget 门。
- **D4a 做梦预取**：`recall/dream-prefetch.ts`（`selectDreamSessions`/`parseDreamQueries`）+ 每晚 `memory:dream`（cron `0 2 * * *`）对近 24h 活跃会话生成 ≤3 条"下次可能问"，存 kv `dream-queries`；`/api/obs/capture` 的 user_input 分支一次性消费 → `scanService.prefetch` 预建快照。
- **A2 草稿-验证并行**：turnCompress prompt 放开 ≤1 条 `tentative` 锚草稿（`capTentativeEnergy` 在 `/api/memory/add` 写前封顶 energy 0.35）；reflection（`collectTentative`/`applyTentativeVerdicts`）每日提升（去 tentative + energy 0.7 + `verified:` 锚）或否决（energy 0.05 + `rejected` 锚）。快系统产草稿、慢系统验证。
- **A1 阶梯补顶**：`memory/axiom-distill.ts`（`selectAxiomSources`/`parseAxiomCandidates`）+ 周 `memory:axiomDistill`（cron `0 6 * * 0`）把高 need semantic insights 蒸馏为公理候选 → triage 草稿（`summary.axiomDraft`）→ confirm 分支逐条经 `L5Store.addHeuristic` 提交（不建 goal）。
- **L3 知识边界**：FOK 样本（`recall/fok-samples.ts`）inj 形加 `topic`（= top-1 记忆首个 cue_anchor；快照构建后经 `appendFokEvent` 落 `fok-samples.jsonl`）；`fitFokThresholdsByTopic`（`recall/fok-gate.ts`）按主题拟合、样本不足/不可分则并入 global，消费 `byTopic[topic] ?? global`。
- **P1.5 审批决策判定**：`core/approval/decision-log.ts` 落 `~/.mafw/logs/approval-decisions.jsonl`（`eval`/`reply` 两形，按 requestId join）——`hook.ts` 记 verdict，两处 reply 路由记 human 回复。**模型选型后置**（当前 laya 为冲突专用 checkpoint，命令破坏性分类 off-label）。
- **G2 写相路由冗余门（2026-10-09）**：route-write 中间带插 laya redundant 问题（`askPair` 双问题同调用）——pRedundant≥tauRedundantHigh → 沉底（energy 0.05 + `redundant:<id>` 锚，可 BM25 捞回）+ 覆盖条目 actrBonus 强化（重复=Hebbian 加强旧痕迹），跳过 LLM judge；consolidation 对 `redundant:` 锚条目 skip（`redundant-sink`）。observe-first：tauRedundantHigh 默认 1.0，校准 `proposeTauRedundantHigh`（保守方向：阈值以上不许有 update verdict）+ 用户批准开闸。spec `docs/superpowers/specs/2026-10-09-laya-write-routing-design.md`。
- **G5/G3 蒸馏安全（2026-10-09，`64f24164`）**：REFLECT_SYSTEM 加「防过度泛化（scope 限定观察语境）+ 保语气证据等级」约束，TENTATIVE_SYSTEM 保 tentative 措辞，AXIOM_SYSTEM 禁扩 scope——OEP/SAVOR 与 Manufactured Confidence 的写侧修复，零 schema 变更。
- **G1 权威标签（2026-10-09，`2bf5ea6f`）**：`HarmonicUnit.authority`（`user|agent|tool|pipeline`，缺省=legacy 按 pipeline 最低处理；AuthMem-Bench 权威坍缩修复）。写路径：HTTP/MCP add 接受+校验（默认 agent）、reflection 固定 pipeline、merge 权威只升不降（`higherAuthority`）。消费面：`<agent-priors>` 徽标 + pipeline ×0.7 软惩罚、pinned 非 user 加 `[待确认]`、skill 物化 G6 闸门（pipeline 无 verified 不物化）、axiom 草稿带 `authorityFloor`。spec `docs/superpowers/specs/2026-10-09-g1-authority-preservation-design.md`。
- **G4 检索仲裁（MARTA，2026-10-09，`1ad3b2cb`）**：`recall/parametric-arbiter.ts` 纯函数——实体包含度（60s 缓存）+ 自指正则 + FOK zone → 三态；v1 **annotate-only 永不硬跳**（注入块头部加提示），observe-first 落 `~/.mafw/logs/arbiter-samples.jsonl`；`search.arbiter` 默认 on。spec `docs/superpowers/specs/2026-10-09-g4-retrieval-arbiter-design.md`。
- **D5 PPR 增强 + CATD（2026-10-09）**：检索层 `searchScored` 的 association PPR（`graph/diffusion.ts`）增 **Hebbian need 调制**（`diffusion.needModulation` 默认 on——转移权重 ×(1+ln(1+need7d))，被检索过的通路更易再走）+ **Macro-Hub 抑制**（`diffusion.hubFloor` 默认 50——入边 ÷(1+ln(deg/floor))，hub 是通路非终点）。能量衰减增 **CATD**（`abstraction-level.ts:catdDecayRate` + `AnchorGraphStore.weightedDegree`；`decay.catd` 默认 on，β=0.5——承重条目半衰期随拓扑负载延长，孤立条目不变）。spec `docs/superpowers/specs/2026-10-09-d5-ppr-catd-design.md`（测量门 LongMemEval multi-session 0.375→≥0.55 待跑）。
- **D4b 反事实模拟（2026-10-09）**：goal 增 **taskType 维度**（`TASK_TYPES` 七值枚举；创建时声明（`mafw_create_goal`/`mafw_set_goal` 参数）→ plan 节点 `waves.taskType` 回写**优先**（规划者判断更准，`completeNode` 校验回写 state v3）；`goal_outcomes` 加 `task_type` 列（幂等 ALTER，legacy NULL → other 池））。L1 账本增 `byTaskType` 聚合 + `ledgerForTaskType`（同类型 ≥3 样本才分桶，小样本退全局防外推）。plan prompt 注入 **`counterfactualBlock` pre-mortem**（同类任务失败率/最常见 failure_kind/平均损失 + L2 踩坑对照 + 每 wave `riskNote` 要求——要求本身不依赖历史数据）。`DriverDeps.capabilityPrior` 签名改 `(goalId)`，新增 `counterfactualPrior`。spec `docs/superpowers/specs/2026-10-09-d4b-counterfactual-design.md`。
- **A5 抽象写回 schema（2026-10-09）**：`HarmonicUnit.distilled_by`（gist 指针数组，**非 supersede**——成员保留可检索，多 gist 共享成员；与 D1b 降能同趟共存）。写入：reflection 蒸馏成功 → `HarmonicUnitFileStore.stampDistilled(episodeIds, gistId)`（**直写 OKF 镜像 setSticky 模式，不走 store.write 防 MinHash 自合并**；追加去重 cap 3，fail-open）。读出：边界 recall 指针行尾 `↳ gist 已蒸馏：<id 尾 6>` 提示（get_memory 按需取，不占预算）；`RecallMemory`/`MemoryUnit` 透传字段。consolidation merge 不 stamp（`merged_from` 等价）。spec `docs/superpowers/specs/2026-10-09-a5-schema-writeback-design.md`。
