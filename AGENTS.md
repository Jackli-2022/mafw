# MAFW Gateway & Plugin 架构

> **术语�?*：`CONTEXT.md` 是项目共享语言（ubiquitous language）——说�?命名/写码用它的词；`/waitwhat` 命令�?manager 重述依赖它�?

## 1. 谐波记忆系统

### 3.1 数据模型

所有层级统一�?`HarmonicUnit`�?

```typescript
interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';  // 字段名是 type（非 memory_type�?
  primary_abstraction: string;    // 6-8 词核心摘要（实际各写路径放全�?摘要不等�?
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // 参与排序�?*入口**计算：judgeSalience/importanceToSalience，write() 不算；检�?×energy×salience，缺失按 1�?
  abstraction_level?: number;     // 0=T1, 1=T2, 2=T3/T4, 3=L5；写路径统一映射（episodic�?，semantic/procedural�?，global�?�?
  review_count?: number;          // A1：stale-verify 调度状态（验证�?stampReview 盖章�?1 天排除窗 + 无记录优先）
  last_reviewed?: string;         // A1：同�?
  merged_from?: string[];         // 合并来源 id（consolidation UPDATE / route-write update / �?worktree 融合填充；MinHash 写路径合并已退役）
  distinct_from?: string[];       // S4 模式分离：与这些相似条目**刻意保持区分**（route-write separate 分支写入；consolidation 候选池尊重，双向禁止合并）
  superseded_by?: string;         // soft-supersede：指向取代本条的�?id（披露注入排除；检索命中改写为�?supersede 链头�?
  pinned?: boolean;               // 披露层：每轮注入 <user-profile>（superseded 后失效）；与 type 正交
  sticky_until?: string;          // 便签板：每轮注入 <note-board> 直到�?ISO 日期（板级过期，记忆本体保留；坏日期 fail-open 在板�?
  created_at: string;
  updated_at: string;
}
```

> 存量合体清理：`cd gateway; npx ts-node scripts/unmerge-blobs.ts`（dry-run 默认，`--apply` 执行并自动备份；需�?`mafw stop`；索�?filePath 相对 `~/.mafw` 解析�?

> 注：`goal_id` 为历史兼容字段，当前写路径不填充�?
> `top_associations` 已删�?026-09-29）：预存静态联想链接被新证据反对（SYNTHESIS arXiv:2601.02744 主张 relevance 来自动态激活；query-blind 链接是噪音源 arXiv:2606.30133），未来多跳�?query-aware 动态激活——见 docs/research/2026-09-29-memory-gap-abc-survey.md §A2�?
> **MinHash 写路径合并已退役（V2 ①a�?026-10-12�?*：`HarmonicUnitFileStore.write()` 不再做合并检查（`skipMerge` �?deprecated no-op），`MinHashMerger.merge()` 无消费者；`MinHashMerger` 仅剩�?worktree 融合复用�?`generateSignature/similarity`。去重改为三层：**写时 exact-hash（仅 HTTP�? 读时近重折叠（cos�?.92 �?token-Jaccard�?.8�? 巩固层语义合�?*（consolidation + route-write）�?
> **soft supersede** 现由 `markSuperseded()` 承担（consolidation UPDATE / route-write update / grace / reconsolidate / worktree 融合）：相似旧条目标�?`superseded_by` 并降�?energy（�?.5），不物理删除，便于 knowledge-update 场景保留历史版本。检索出口由 `resolveSupersededHeads()`（`harmonic-index.ts`，`searchScored` 末尾单点�?*强制撤销**：命�?superseded 条目改写到其 supersede 链头（保分数、按链头去重取最高分），悬空/成环/超深（默�?5）链直接丢弃——仅靠排序惩罚不够，被撤销事实仍会返回并压过替代项（arXiv:2609.08258）�?

### 3.2 检�?

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`�?
```
查询 �?加载 .harmonic_index.json（无�?memory_type 与层级）
     �?�?energy × 检索得分排�?
     �?按需�?tier 文件加载完整 memory_value
```
三种检索器（`gateway/src/core/memory/harmonic-index.ts`）：
- **bm25（默认）**：query 分词�?BM25（k1=1.2, b=0.75）�?energy × salience，tokenize 为小写单词（len�?�? CJK unigram；查询时现算，不持久化索引文�?
- **hybrid**：bm25 + dense embedding �?RRF(k=60) 融合（`searchScored` �?`denseScores` 选项；异步嵌入由调用方完成，searchScored 保持同步）；embedding �?`memory.embedding` 配置（local ONNX Qwen3-Embedding-0.6B / dashscope compatible-mode，默�?off�?
- **token**：子串计�?× energy × salience，可通过 `mafw_search_hybrid` �?`retriever:'token'` �?`/api/memory/search?retriever=token` 显式回退

**显式时间锚定**（`gateway/src/recall/time-anchor.ts`）：查询含时间表达（昨天/last week/N�?recent 等）时，created_at 落入对应窗口的条�?×1.5 软提升（不硬过滤，E.4 陷阱）；`options.now` 供评测传 question_date�?

LongMemEval 基准（session 粒度 R@10）：token 0.474 �?**bm25 0.949**�?/6 类提升；1000 entries 搜索 ~2-3ms）。`searchScored()` 同时返回原始分数，供下游精排、截断与置信度展示使用。heuristic reranker �?session 粒度�?realistic-energy 消融证实零增益（rerankWeights 全部信号在候选集内无区分度）�?

Index scan 传输（`recall/index-scan.ts`）优先走 runtime 契约�?`completion.complete()`（`completionApi` 能力，thunk 现读热切换安全），缺能力/失败时回退直连 HTTP（`runtime/completion-http.ts` 共享实现，`cacheable` 块映�?DashScope `cache_control: ephemeral`）�?

### 3.3 压缩

`HarmonicUnitFileStore.write()` 输出 `HarmonicUnit` 并自动：
1. `cue_anchors` 兜底（空�?`extractAnchors(primary_abstraction)`�? **标识符收�?*（`harvestIdentifierCues`，预�?`harvestMaxCues`=8）—�?*salience 不在此计�?*，由入口（HTTP/MCP）算好传�?
2. 写入对应 tier 文件（`concepts/{semantic|episodic|procedural|global|knowledge}/`，OKF frontmatter 白名单见 `okf-writer.ts`�?
3. 更新 `.harmonic_index.json`（index v2�?
4. 锚点�?共激活图 upsert + `[[link]]` �?
5. 触发静�?`onMemoryWritten` 监听器（dense 嵌入索引 + consolidation 入队 + GLiNER 实体收割[默认关]�?

> 去重三层（写路径无合并）�?*L1 写时 exact-hash**（`dedup-guard.ts`，SHA1 LRU，仅 HTTP `/api/memory/add`）；**L2 读时近重折叠**（`searchScored`，cos�?.92 �?token-Jaccard�?.8）；**L3 巩固层语义合�?*（consolidation + route-write，见 §3.5）。`merged_from` �?2000 字符合并截断�?MinHash 退役一并消失（HTTP content 另有 4000 上限）�?

> 注：`HybridCompressor`（会话压缩管线）只挂�?deprecated legacy 插件路径，当�?gateway 运行时写路径�?`/api/memory/add` + MCP handler + turnCompress worker，均�?`HarmonicUnitFileStore.write()`�?

### 3.5 Dense 混合检索与语义合并（P1/P2，opt-in�?

`memory.embedding.provider`（默�?`off`；`local` = ONNX Qwen3-Embedding-0.6B / `dashscope` = text-embedding-v4 compatible-mode）：

- **EmbeddingRuntime**（`gateway/src/memory/embedding-runtime.ts`）：进程单例（provider + `MemoryVectorStore` + `EmbeddingIndexer`）。向量文�?`~/.mafw/memory/vectors-<model>.json`（按 provider.name 打标签，GGUF �?ONNX 嵌入不共享）；写路径 fire-and-forget 嵌入�?s 防抖批量 flush，失败丢弃不阻塞�?
- **本地引擎双实�?*（`memory.embedding.engine`）：`onnx`（transformers.js 进程内，`threads` 线程帽默�?2�? `llamacpp`（`llamacpp-provider.ts`：llama-server sidecar 子进程，官方二进制自动下载含 ghfast.top 镜像回退，`gpu: cpu|vulkan|cuda` 变体切换、GPU 变体自动 `-ngl 99`）�?*llama-server embedding 必备旗标**（踩坑实证）：`-fa on`（否则非因果注意力物�?L² 矩阵，ctx4096 �?RSS 3GB）、`-np 1 --no-warmup`（否�?np=auto 多槽 KV + warmup 全量缓冲 �?2.8GB）、`-cram 0`（prompt cache �?embedding 任务只写不读涨到 8GB 上限，llama.cpp #26293）、`-c/-b/-ub �?文本 token 上限`（超长输�?HTTP 400 被静默丢弃会拖垮 dense 通道，provider �?400→截断重试兜底）
- **检�?*：`computeDenseScores(query)` �?`searchScored({denseScores})` �?RRF 融合；`mafw_search_hybrid` �?`retriever:'hybrid'` �?`/api/memory/search?retriever=hybrid` 已接线；boundary recall 同步路径**�?*嵌查询（100ms 契约�?
- **ConsolidationService**（`gateway/src/memory/consolidation-service.ts`）：写入�?cosine�?.8 候选召�?�?worker 模型 LLM �?UPDATE/CREATE（Memora 式）；UPDATE 合入新条�?+ soft-supersede 旧条�?+ 删除旧向量；裁判不可达时 skip（fail-open）；`GET /api/memory/stats` 暴露 update ratio�?*候选池过滤�?026-09-29 审计 H4 + S4�?*：判官前剔除 superseded 与孤儿候选（向量在但 unit 不可读）——合并进死条目会复活它；**`distinct_from` 双向尊重**（unit 标记的候选、候选标�?unit 的，都禁止合并——模式分离是刻意决定）；**判定对审计日�?* `~/.mafw/logs/consolidation-pairs.jsonl`（每次判官调用一行：new/候�?cosine/verdict）——update ratio 0% 的根因审计见 `docs/research/2026-09-29-consolidation-audit.md`（H2 判官偏置�?pair 数据终判�?6-22% 健康带对个人库可能需重定义）
- **laya 三值分流门（D3�?026-10-09�?*：级联升级为三值——p≥tauHigh→UPDATE、全部候�?p≤tauLow→直�?CREATE（跳�?LLM；CREATE 本就是判�?fail-open 行为）、中间带→转 LLM。`tauLow` 默认 0=关闭；开闸需 `gateway/scripts/calibrate-laya.ts` �?pairs jsonl 提议（≥50 scored + �? update �?+ create/update 带不重叠 + 0.3 上限）并经用户批准；tauHigh 保持 0.99（separate 失明带永不自�?UPDATE）。审�?`decidedBy:'laya-low'`，stats �?`layaCreated`。首跑真实数据（187 对）�? �?create �?0.9-1.0（失明确证）+ �?3 �?update �?正确返回无安全线

### 3.4 能量衰减

- 基础衰减�?**0.005/�?*（`EnergySystem.decayRatePerDay`，salience 越高衰减越慢——`HarmonicIndexEntry` 携带 `salience`，衰�?pass 读取�?
- 默认自动化规�?`memory-decay`（每�?UTC 3:30，`recall/pipeline-rules.ts` 供给）：**增量衰减**——按 entry `last_decay_at`（缺失回退 `created_at`）计算流逝天数做纯时间衰减（无事件加成）；`last_decay_at` 仅在实际写入衰减时盖章（低于 0.005 写入阈值时天数继续累积，防�?salience 条目饥饿�?
- **检索访问结算（ACT-R 式，2026-09-29�?*：recall 路由 / 快照 serve / `mafw_search_hybrid` 三个生产出口把命中（id + 概率 + 时间戳）记入 `RetrievalEventBuffer`（内存环形缓�?+ 7 �?need 索引，`core/memory/retrieval-events.ts`，fail-open；eval 不经这些出口天然隔离）；每日衰减 pass **同一�?* drain 并按 `actrBonus()`（`B=ln(1+Σ(Δt+24h)^-0.5·w)`，`core/memory/retrieval-bonus.ts`）结算——k=0.03 均衡点使"一次新鲜检�?�?一天衰�?，cap 0.02，重复曝光折扣防 rich-get-richer；bonus 先于衰减应用�?clamp 1.0。线�?`+0.02` 直写已删（无�?正反馈，access-bonus.ts 移除�?
- **goal 奖励调制（B4�?026-09-29�?*：`archiveGoal(verdict=PASS)` �?goal_sessions 关联且未 superseded 的记�?energy +0.08（clamp 1.0�?*不对称：失败不降�?*，防错误归因）——`core/manager/goal-reward.ts`，fail-open
- 事件加成（`useful_feedback` +0.1 等）�?`EnergySystem.calculateEnergy` 提供，只作用�?**L3 参数�?`ParametricStore`**（`core/memory/store.ts`），**不作用于谐波单位**，也不在衰减 pass 中混用；谐波单位的检索加成走 ACT-R（上一条）、goal 奖励走上一�?
- index v1→v2 一次性迁移：全部 entry �?`last_decay_at`=迁移时刻�?*不补扣历史衰�?*（旧实现�?`created_at` 每次运行重复扣全龄衰减，累计 r·n(n+1)/2 平方损失，历史已过度衰减故豁免）；迁移由 `HarmonicIndexManager.migrateDecayBaseline()` 执行

### 3.6 管线心跳（Pipeline Heartbeat�?

背景管线**默认静默失败**——ledger 只记 `AUTOMATION_TRIGGERED`（规则触发了），不记是否跑成/产出多少�?026-09 的衰减冻结与判官空转正是这类（日志只�?Scheduled/重复 Migrated，无"实际生效"信号）�?

- `recall/pipeline-heartbeat.ts`：`PipelineHeartbeat`（kv 持久�?+ 纯逻辑可测）——每个管线出�?`record(name, { ok, counts?, error? })`，`snapshot()` 计算 `stale`（距上次成功 > 2× 预期间隔；从未跑过不�?stale 防启动误报），`sweep()` �?episode 只告警一次（成功即清�?
- 接线：`memory:decay`（automation-engine action，经 `AutomationEngine.setHeartbeat`）、`memory:turnCompress`/`memory:reflect`/`memory:review`（index.ts 管线闭包，`failed>0` �?ok:false）、`consolidation`（`ConsolidationService.onJudge` 回调，仅判官真正被调用时记录�?
- �?`gateway.db` kv_store scope `pipeline-heartbeat`；`GET /api/memory/stats` �?`pipelines` 字段（`lastRunAt`/`lastSuccessAt`/`lastCounts`/`ok`/`stale`）；index.ts �?30min `sweep()` 告警（arXiv:2609.05510「没有枚举失败模式可以静默通过」）
- **日预算帽�?026-10-09�?*：`recall.pipelineBudgetUsdPerDay`（默�?0=无限）——`PipelineBudget`（`recall/pipeline-budget.ts`，fail-open）按 UTC 日聚�?`TrajectoryStore.getWorkerSpendSince`（worker_role 非空�?turns cost 求和）门控五�?LLM 管线：extract/reflect/review/index-scan/consolidation 判官；超�?deny + 每管线每�?warn 一次；laya 级联（本地零成本）与 decay/回放等非 LLM 路径不受门控�?

## 4. Tools 清单（v6.9 总共 44 个）

### 4.1 Gateway MCP 工具�?0 个，`gateway/src/mcp/tool-registry.ts`�?

| Tool | 用�?|
|---|---|
| `mafw_search_hybrid` | 谐波记忆检索（BM25×energy×salience 默认；`retriever:'token'` 回退子串计数；支持迭代图扩展�?|
| `mafw_get_deltas` | 获取参数化约束（L3�?|
| `mafw_update_state` | 更新状态文�?|
| `mafw_load_state` | 读取状态文�?|
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |
| `mafw_add_memory` | 写入记忆单元（`supersedes` 显式取代旧条目——HTTP 表单�?/ MCP 收数组，�?create 后标记；`pinned` 披露层；`sticky`/`stickyDays` 便签板；`cueAnchors` 多跳线索；`authority` 权威标签�?|
| `mafw_get_memory` | �?id 取记忆全文（支持 `<recall>` 指针�?6 位；superseded 自动�?supersede 链最新版�?|
| `mafw_supersede_memory` | 标记已有记忆�?superseded（不写新条目，仅降能+惩罚检索排序） |
| `mafw_pin_memory` | pin/unpin 披露层（`<user-profile>` 每轮注入）；`sticky`/`stickyDays` 上板/续期/下架便签�?|
| `mafw_commit_heuristic` | 提交 L5 启发�?|
| `mafw_get_axioms` | 获取 L5 公理 |
| `mafw_merge_memory` | �?�?worktree 记忆融合 |
| `mafw_resolve_merge` | 解决记忆融合冲突 |
| `mafw_create_goal` | 创建 Goal（Manager 专用�?|
| `mafw_set_goal` | 设置活跃 Goal |
| `mafw_get_goal_status` | 查询 Goal 状�?|
| `mafw_list_goals` | 列出 Goal |
| `mafw_answer_question` | 回答待决问题（Manager�?|
| `mafw_get_evidence` | 获取 Goal 证据 |
| `mafw_cancel_goal` | 取消 Goal |
| `mafw_list_pending_questions` | 列出待决问题 |
| `mafw_list_automation_rules` | 列出自动化规�?|
| `mafw_get_automation_rule` | 查询自动化规�?|
| `mafw_get_automation_history` | 自动化历�?|
| `mafw_run_automation` | 手动运行自动�?|
| `mafw_validate_rule` | 校验规则 |
| `mafw_list_triage_items` | 列出 triage �?|
| `mafw_get_triage_item` | 查询 triage �?|
| `mafw_propose_triage_decision` | 提议 triage 决策 |
| `mafw_draft_automation_rule` | 起草自动化规�?|
| `mafw_desktop_screenshot` | 桌面截图 |
| `mafw_desktop_navigate` | 桌面导航 |
| `mafw_desktop_get_ui_state` | 桌面 UI 状�?|
| `mafw_desktop_click` | 桌面点击 |
| `mafw_desktop_type` | 桌面输入 |
| `mafw_desktop_scroll` | 桌面滚动 |
| `mafw_restart_agent` | 重启 gateway 拥有�?agent 进程（opencode serve sidecar）；external/进程�?runtime 不可�?|

> **接线要求�?026-09-08 修复�?*：以�?39 个工具经 gateway MCP 暴露（`http://127.0.0.1:3000/mcp`），opencode 侧需在配置中�?`"mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true, "oauth": false } }` 才可用。接线有两条路径：①插件**激活时自接�?*（`src/utils/self-wiring.ts` �?`ensureMcpWiring()`——检测全局 `~/.config/opencode/opencode.jsonc` �?`"mcp"` 段则幂等补写，带 `.bak-mafw-<ts>` 备份，fail-open）；②手动写全局或项目级 opencode 配置�?*排错关键**：旧�?`mcpServers`（v4.1 时代 `opencode.json.example`）已�?opencode 1.x 废弃�?*静默忽略**，接线缺失无任何报错、工具直接消失；验证�?`opencode mcp list` 应显�?`mafw connected`。插件原生工具（6 个，§4.2）不�?MCP，独立可用�?
>
> **双传输端点（2026-09-09，commit 1fa8c304�?*：`/mcp` 同时承载两种传输，客户端按形态自动分流——`POST /mcp`（无 sessionId）→ **无状�?StreamableHTTP**（官�?transport，`sessionIdGenerator: undefined` + `enableJsonResponse`，响应随 POST 内联返回；opencode 客户端优先此路径）；`POST /mcp?sessionId=` �?legacy SSE 消息通道；`GET /mcp`（带 `mcp-protocol-version` 头）�?405（无独立流，StreamableHTTP 客户端视为预期）；`GET /mcp`（无该头）→ legacy SSE 会话建立�?*每条 SSE 连接独立 `Server` 实例**（SDK Protocol 单传输，共享会导致响应路由到"最后连�?的客户端—�?026-09-09 间歇�?-32001 超时事故根因，回归测�?`gateway/tests/unit/mcp-sse-multi-client.test.ts`�? 15s `: ping` 心跳（防 ~305s 客户�?idle-abort 重连轮转�? 会话生命周期日志（`[MCP]` 前缀）。SDK `@modelcontextprotocol/sdk@^1.30`�?

### 4.2 插件侧工具（14 个，`src/tools/`�?

| Tool | 用�?|
|---|---|
| `mafw_media_ask` | 分析/追问图片/视频/音频（经 Media Agent A2A；支�?taskID 多轮追问�?mediaPath 自动上传�?|
| `mafw_media_upload` | 上传本地媒体文件�?Media Agent 并返回引用指�?|
| `mafw_media_speak` | 文本合成语音（TTS；带 djb2 hash 标记供桌面端去重播放�?|
| `mafw_python` | 持久 Python 内核执行（变�?导入跨调用保持；matplotlib 图表返回图片附件�?|
| `mafw_python_restart` | 重启 Python 内核（内核崩溃或内存泄漏时调用） |
| `mafw_add_memory` | 写入记忆单元（HTTP 直连 `/api/memory/add`——serve 派生�?worker 会话�?MCP 连接，故不走 MCP 通道�?|
| `mafw_submit_result` | Batch 1：结构化交卷（JSON Schema 校验/重试�?|
| `mafw_spawn_subagent` | Batch 3：派�?gateway 追踪的子代理（parentID/depth�?|
| `mafw_message_subagent` | Batch 3：给子代理续�?|
| `mafw_subagent_result` | Batch 3：读取子代理结果（structured 优先�?|
| `mafw_task_submit` | Batch 4：提交持久任务（shell 后台命令 / subagent�?|
| `mafw_task_list` | Batch 4：列出当前会话的持久任务（五态过滤） |
| `mafw_task_cancel` | Batch 4：取消持久任务（幂等�?|
| `mafw_task_message` | Batch 4：给持久子代理任务续聊（terminal 任务会回�?working�?|

> **插件 dev loop**：本仓库�?opencode �?`.opencode/plugins/mafw-plugin.ts` shim 直连 `../src/plugin`（v1 原生加载 TS，无需 tsc）；改动生效 = `mafw restart-agent`。仓库外项目靠全局 `file:<npm-prefix>/node_modules/@jack200714/mafw` 加载 `dist/plugin.js`（发布后 `npm install -g jack200714-mafw-<ver>.tgz` 更新）。包入口字段：`main` + `opencode.plugin` = `dist/plugin.js`�?026-10-05 修复：此�?tarball 不含 `dist/` 且全局配置指向旧包名路径，仓库外项目冻结在 v4.5.1）�?

## 5. v6.8 新增系统

### 5.1 统一配置管理
- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认�?
- 所有端�?URL/超时/路径集中�?`gateway/src/config.ts`
- 环境变量�?`MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`�?

### 5.2 记忆�?Goal 解�?
- `HarmonicUnit.goal_id` 可�?—�?记忆不绑定任�?Goal
- 所�?Hooks 在无 goal 上下文时照常运行
- `recordFeedback` 存储路径已扁平化（`.mafw/feedback/`）；`askUser` 已扁平化（`.mafw/user-questions/{id}.json`，legacy �?goal 分目录读取兜底）
- `CostEstimator.ToolCallRecord.goalId` 改为可�?

### 5.3 记忆融合系统（git worktree�?
- `mafw_merge_memory` MCP 工具：MinHash 签名比对（相似度阈�?**0.6**），提取独有记忆（energy=0.4�?
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` �?git merge 前调�?`mergeMemoryFromWorktree()`（读�?worktree �?harmonic index + OKF，非 legacy memories.json�?
- 融合记录写入 `~/.mafw/fusion-log.jsonl`
- HTTP 端点：`POST /api/merge-memory`（插�?`/merge-memory` 命令用，复用 MCP handler�?
- CLI 命令：`/merge-memory`；`/worktree-list`、`/worktree-prune` 仅存在于 deprecated legacy 插件路径

### 5.4 文件日志系统
- 插件�?`installFileLogging()` 劫持全局 `console.log/warn/error`，写�?`<project>/.mafw/logs/mafw.log`（`src/utils/logger.ts`�?
- gateway 侧日志写 `~/.mafw/logs/mafw.log`（`gateway/src/core/utils/logger.ts`�?
- 格式：`[ISO时间戳] [LEVEL] 原始消息`
- 5MB 自动轮转

### 5.5 Desktop 前端（packages/desktop/�?026-09-09 起脱�?opencode-dev�?
- Electron + SolidJS + `@mafw/ui`（fork �?@opencode-ai/ui，含 MAFW v2 组件�? `@mafw/session-ui` + `@mafw/sdk`（packages/gateway-sdk�?
- **Gateway 捆绑（模�?A�?026-09-10�?*：desktop 安装包自�?gateway——`scripts/stage-gateway.ts` �?`gateway/dist` + 生产依赖 stage �?`gateway-bundle/`（better-sqlite3 重构建为 Electron ABI：先�?`prebuild-install -r electron`，失败回退 node-gyp �?Electron headers 源码编译；zeromq �?Node-API 免重构建），electron-builder `extraResources` 打进 `resources/gateway/`。`package*` 四条 npm script 已串 staging；`gateway-bundle/` �?gitignore。启动决策收敛在纯函�?`src/main/mafw-gateway-plan.ts`：adopt（探测已有）�?bundle（`ELECTRON_RUN_AS_NODE` spawn 自带副本，desktop 退出时树杀）→ cli（dev 回退 `mafw daemon`）→ failed；`stopGateway` 只杀自己 spawn 的（收养的不再误杀�?
- �?UI：左�?Rail(200px) + 上部 TabStrip + 内容�?
- 构建：`cd packages/desktop && npx electron-vite build`（main/preload/renderer 三段）；dev �?node 脚本（predev 仅拷图标，不再构�?opencode CLI�?
- �?npm workspaces：`packages/*`；opencode-dev/ 已移除（2026-09-09），全部源码�?packages/ 为准
- **Tray 系统托盘**�?026-09-17 重构，对�?MS 通知区域指南 + Slack/Discord 惯例）：`src/main/tray.ts`（Electron 耦合层）+ 三个纯模块——`tray-toggle.ts`（单�?toggle：无窗口→create / 可见且聚焦→hide / 否则 show；双�?Open �?toggle 双击抖动）、`tray-status.ts`（`countPending`/`trayTooltip`/`trayMenuStatusLabel` 纯函�?+ 30s 轮询 `/api/approvals`+`/api/permissions` �?fail-open poller，tooltip 与菜单状态行动态反映待审批数）、`close-decision.ts`（close 决策新增 `trayAvailable` 输入：无托盘图标�?hide-to-tray 会让窗口不可达，降级为真关）。`tray-prefs.ts`：closeToTray/trayIconEnabled/两个一次性提示标志。菜�?= 状态行(disabled) + Open MAFW + Close to tray 复�?+ Quit MAFW；取消勾�?close-to-tray 首次弹窗告知"关最后窗�?退出应用并树杀 bundle gateway"（P0 静默杀栈修复）；首�?hide-to-tray 弹一次�?OS 通知（`tray-hint.ts`，windows.ts→tray-hint 单向 import 防循环）。Windows �?icon.ico（不�?GUID——未签名 exe �?GUID 绑死 exe 路径，换路径会让托盘创建失败）；macOS 不接 click handler（setContextMenu 后左键本就弹菜单，接了会双触发）。Config 页新�?Desktop 区块镜像两个开关（IPC `get-tray-prefs`/`set-tray-prefs` �?`syncTrayPresence()` 热创�?销毁）
- **小窗口响应式**�?026-10-09，对齐业界共识）：主窗口�?`minWidth:720/minHeight:480`（`src/main/window-bounds.ts` 纯函�?`mainWindowOptions`——恢复的过小尺寸抬到下限、缺省坐标不下发）；�?1200px 断点�?Rail 自动折叠（`src/renderer/mafw/layout-breakpoints.ts` `railAutoAction`——wide→narrow 收起、narrow→wide 仅撤销自动收起、同侧不动；自动折叠不持久化、`untrack` 防拉锯；mount 时窄窗口先收）；**composer toolbar 溢出修复**：结构护栏（`.mafw-composer-toolbar`/�?`min-width:0`；left `flex:1 1 auto; overflow:hidden` 裁切自身不外溢；right `flex:0 0 auto` 保发送恒显）+ 分档容器查询 `@container`—�?*�?20** 隐藏次要图标（`mafw-composer-optional`：审�?语音播报/录音�? composer-meta、model-name �?20�?*�?20** 隐藏分隔线、model-name �?6�?*�?20** 隐藏上下�?pill、model-name �?2；`mafw-model-name` �?ellipsis；`@media (max-width:680px)` �?padding 64�?2。样式契约测�?`composer-toolbar-css.test.ts`�?）。业界共识见调研文档 §5（工具条单行、按优先级降级、用 @container、发送恒显；溢出菜单/chips 分行留后续）�?*收起态零�?*：`railCollapsed` �?rail 内容不渲染、列�?0（列保留�?grid 占位以保�?topstrip/main 仍落 column 2；v7 起改�?`--rail-w` 变量 + 过渡，见下）。调�?`docs/research/2026-10-09-desktop-small-window-layout.md`；桌面测�?872�?8�?
- **v7 动效收口**�?026-10-10，spec `docs/superpowers/specs/2026-10-10-desktop-motion-polish-design.md`，plan `docs/superpowers/plans/2026-10-10-desktop-motion-polish.md`）：两级动效 token（`--dur-fast` 140ms / `--dur-surface` 280ms + `--ease-standard`/`--ease-surface`，无 spring，旧 `--dur-1..4`/`--ease` 保留�?deprecated 别名）；`components/presence.ts` `createPresence` 折叠面「过渡期挂载、静止卸载」（�?ManagerCard 15s/UsagePill 60s 轮询）；rail 列宽 `grid-template-columns: var(--rail-w) 1fr` + 过渡（`--rail-w` 内联驱动、`.mafw-rail-col` overflow 裁切、`.mafw-rail-wrap` flex:0 0 auto 防压缩）、dock `.mafw-body` 列宽过渡（RightDock open={dockPresent()} 保内容至收缩末）；自绘交互面 `:active` 按压下沉半像�?+ hover �?fast 档；turn 进场门控（`chat/turn-enter.ts` 只新 tail �?`mafw-enter`，历史水�?翻旧页不弹，blanket 规则删除）；入口动画（drawer/modal/picker/usage-wb）统一 surface 档；token 契约测试 `motion-tokens.test.ts`�?2 例）；循环动画时长集中建档。桌面测�?890 通过
- **主题 token 结构收敛**�?026-10-12，spec `docs/superpowers/specs/2026-10-12-desktop-theme-consolidation-design.md`，plan `docs/superpowers/plans/2026-10-12-desktop-theme-consolidation.md`）：v5「复制勿引用」不变量退役—�? 主题�?token 块各合并�?*单块选择器列�?*（`.mafw-shell, body` / `html[data-theme="light"] .mafw-shell, html[data-theme="light"] body` / 系统�?media 同理），`.mafw-picker-pop` 三个冗余 token 块删除（picker �?Portal �?body，从合并块继承同值）；主题逻辑�?`src/renderer/mafw/theme.ts` 纯模块（`readSavedTheme`/`nextTheme`/`applyTheme`，与 `public/oc-theme-preload.js` 同源 `mafw-theme` 键）；补兜底别名 `--text-6`/`--success`/`--border-strong`/`--accent-success`/`--red-9`（�?现行 fallback，零视觉变化；`--border` �?fallback 记债白名单）；契约测试升级为「作用域覆盖 + 三主题键集一�?+ 悬空引用闭集扫描」（`theme-merge-css.test.ts`）。全程零视觉变化
- **工具�?tool cards**�?026-10-11）：`renderer/mafw/components/tool-cards/` 按工具名 `ToolRegistry` 注册，每个工具一张卡�?*MCP 双前缀**：opencode �?MCP 工具�?server 前缀 �?gateway 工具 `part.tool` 实为 `mafw_mafw_<name>`（插件原生工具为�?`mafw_<name>`），`registerAliased` 经单一来源 `aliasKeys(name)=[name,"mafw_"+name]` 同时注册两种 key（`registered-tools.ts`）。数据面：`part.state.output` �?gateway 返回�?JSON 字符串、`status==="completed"`、`input` 是工具参数。渲染层：`familyCard`（`TOOL_SPECS` 30�? 自绘（`MafwSearchCard`/`MafwAddMemoryCard`/`MafwRuleCard`/python�? **`genericSections()` 通用兜底**（对象→顶层键值表 / 数组→列�?/ �?JSON→code 段，**杜绝空卡**；`ruleSections()` 按返回形状分�?9 个规则工具）。契�?单测：`extract.test.ts`、`rule-model.test.ts`、`index.test.ts`�?*v8 美化**�?026-10-11，spec `docs/superpowers/specs/2026-10-11-tool-card-polish-design.md`，对标六�?`docs/research/2026-10-11-tool-call-rendering-survey.md`）：触发�?22�?6px、标�?13px `--text-1`、args `key=value` 11px `--text-4`；内容体 `.mafw-tool-box`�?.5px 描边 + `--r-md` + `--bg-inset`）替代旧左竖线缩进；status badge（`ToolCardSpec.badge`/`ruleBadge` �?`trigger.action`，verdict/valid/count/status）；`BasicTool animated` 高度动效；code �?`--font-data`。桌面测�?930 通过
- **Agent Workbench 二期�?026-10-23，spec `docs/superpowers/specs/2026-10-22-workbench-phase2-design.md`�?*：右 dock 新增「�?浏览」tab（`BrowserDock` + `<webview partition="persist:workbench-browser">`；main �?`browser-session.ts` 权限全拒、非 http(s) 导航拦截/外抛、window.open �?dock 内导航、`will-attach-webview` 加固；链�?dock 内开，导航条含系统浏览器出口�? **批注草稿**（`shared/annotations.ts` �?reducer/仓库 + `electron-store("mafw-annotations")` 持久；编辑器/diff 双动作「加入批�?/ 立即发送」；`PendingAnnotations` 列表�?composer 上方；`use-send-message` 发送入口统一打包、turn-queue 入队时打包）�?*共享 terminal（路�?B）HOLD**：wire 实证（`docs/research/2026-10-22-phase2-wire-probe.md`）确�?persistent-pty �?*用户终端**设施，agent shell 工具不落会话 PTY —�?�?spec 门禁不上假共享，�?runtime 侧接入后解冻（wire 契约已钉死：connect-token 需 `x-opencode-ticket: 1`；WS 帧化输入 `[type u8][cols u16][rows u16][payload]`；重�?cursor = `info.output.tail`）。（终端面板已由 2026-10-26 �?terminal-dock spec �?*不共享用户终�?*形态先行交付，见下条）
- **Desktop 内嵌终端�?026-10-26，spec `docs/superpowers/specs/2026-10-26-terminal-dock-design.md`，plan `docs/superpowers/plans/2026-10-26-terminal-dock.md`�?*：右 dock 新增�?_ 终端」tab—�?*不共�?*的用户终端（显式 descope 二期 T1 的共享承诺；T1 HOLD 原文保留）。归属模�?**跟随目录**（普通会�?项目目录、worktree=worktree 目录，与文件树根同规则）；后�?serve **location-scoped `/api/pty`**（persistent：desktop 关窗/重载存活；serve 重启 PTY 全灭 →「已随服务重启关闭�?重新打开；托�?Quit 树杀全栈属既定语义）�?*gateway 零改�?*�?.1.0 兜底反代已注�?serve Basic（`injectServeAuth` + `serveAuthHeaders`），`/api/info` 暴露 `urls` + `capabilities.persistentPty`�?026-10-26 live 实证 create/connect-token/WS roundtrip/resize/delete 全通）。desktop 侧：`main/terminal/terminal-core.ts`（纯逻辑：信封解�?活跃 PTY 选取/meta �?`0x00`+cursor 解析/连接状态机/输入恒等透传�? `main/terminal/terminal-bridge.ts`（每目录一�?WS + 多窗�?fanout；ticket 现取现用；deps 注入可测�? preload `window.api.mafw.terminal.*` + `TerminalDock`（xterm.js `@xterm/xterm@6` + addon-fit；隐藏时保实例、可见再 fit�? 外部终端出口（wt→cmd start 兜底）。能力门：仅 opencode + `persistentPty`；pi/adopted(�?env 密码)/external serve �?降级提示。commits `c2644473`（core+deps�?`de977f48`（bridge�?`375c4ebd`（preload+external�?`1438a003`（dock）；desktop **1445/1445**、tsgo rc=0、electron-vite build ok。GUI 冒烟�?dev app 重启（清单见 plan Task 5：真 shell/close-to-tray 存活/目录切换/serve 重启重开/两步结束）�?
- **Desktop 终端 surface + SSH 会话（2026-10-29，spec `docs/superpowers/specs/2026-10-29-terminal-surface-ssh-design.md`，plan `docs/superpowers/plans/2026-10-29-terminal-surface-ssh.md`）**：底部 280px 终端条退役，终端升为工作台 L2 `文件 / 浏览器 / 终端`；`TerminalSurface` 会话 tab（本地 + 多 SSH）、`main/terminal/ssh-session.ts`（ssh2 shell、ring buffer、自动重连 1/2/4/8/16s）、`ssh-jump.ts`（一层 ProxyJump）、`ssh-host-store.ts` + `terminal-secrets.ts`（safeStorage 加密密码/口令，绝不进 renderer）、`known-hosts-store.ts` + `ssh-connect.ts`（TOFU 指纹，变化红色阻断）、`terminal-service.ts` + `terminal-ipc.ts`（`mafw-terminal-v2-*`，旧 bridge 已删）、`terminal-store.ts`/`TerminalView.tsx`/`TerminalHostDrawer.tsx`/`SshHostDialog.tsx`。本地终端仍跟随 benchRoot；隐藏/切目录不后台起 shell；SSH tab 恢复后首次 surface 可见才连接。desktop **1993/1993**、tsgo rc=0、electron-vite build rc=0；GUI SSH 冒烟未在本机执行（需真实 sshd/跳板机与 desktop dev）。commits `2c3087a5`..`357a4c3e`。
- **Desktop 交互补完 B 线（2026-10-23，spec `docs/superpowers/specs/2026-10-23-desktop-interaction-parity-design.md`，plan `docs/superpowers/plans/2026-10-23-desktop-interaction-parity.md`�?*�?*v2.1.0 tool part 归一�?*（实证见 `docs/research/2026-10-23-task-metadata-probe.md`：part �?`name:"subagent"` 而非 `tool:"task"`，metadata �?`sessionID`）——`tool-part.ts` �?live `applyPartUpsert` 与历�?`loadSessionHistory`/`loadOlder` 入口�?`tool = tool ?? name`；session-ui `TOOL_NAME_ALIASES` �?`subagent→task`、`shell→bash`；后台检�?`toolNameOf` 兜底�?*子代理跳�?*：task �?`taskChildSessionID` 兼容 `sessionId`/`sessionID`/`childSessionID`，`isTaskTool` 接受 `task`/`subagent`，失败卡 `ToolErrorCard.onNavigate` 仅在�?child id 时可点�?*inputbar**：`composer-readline.ts` 支持 Ctrl+A/E/B/F/K/U/W/T + Alt+B/F（选区折叠、kill 选区优先、IME/picker 不抢）；Ctrl+F/K �?composer 内归 readline（只拦字�?Ctrl，Meta/Cmd 保持原生），历史按会话持久化�?`localStorage`（`mafw-input-history:v1:<sid>`�?0 条、单�?>4KB 整条丢弃、�?20KB）�?*点击 chatview**：`composer-focus.ts` 谓词 + `composer-focus-scheduler.ts` 220ms 延迟聚焦（双�?拖�?交互元素/媒体控件不抢）�?*后台 REST**：`background-capability.ts` 三�?`checking|available|unavailable` + 挂载�?60s 重探 + SSE 重连 reset，dock/work bar 用说明替代死按钮；`/api/shell` �?:3000 �?401（v2 鉴权桥属并行工作）。commits：`6cc97c78`、`6316bd28`、`e7cf0f83`、`6914f531`、`7fdc940d`、`8be3046d`、`3f53aea1`；desktop **1332/1332**、session-ui **81/81**、tsgo rc=0、electron-vite build ok（本批新�?恢复 60 个用例，含恢�?9 个此前丢失的 background-detect 回归；后�?deferred minors 5 项已修，新增 tool-error-link/taskAgentName/outputPlaceholder/runtime-probe 测试，计数为最终值；用户并行 commits `163fcb0a`/`586c5bd7`/`e35564c1` 不计入本批）
- **Desktop B2：quote-reply + 变更树实时化�?026-10-23，spec `docs/superpowers/specs/2026-10-23-b2-quote-reply-changes-tree-design.md`，plan `docs/superpowers/plans/2026-10-23-b2-quote-reply-changes-tree.md`�?*：选中聊天文本 �?`formatQuote`（`>` 前缀、首尾空行剔除�?000 字截�?+ 可见标记、代理对安全�? `appendQuote` 保留草稿；`QuoteToolbar` Portal + mousedown preventDefault；选区限定 `[data-message]` 内且 `!readOnly`；Esc �?capture-phase + `quote-selection.ts` 选区快照抑制 keyup 重弹（第二次 Esc 才中断回合）。ChangesDock 平铺 �?`buildChangeTree` 目录树（目录优先/聚合 +�?status 徽标）；�?统计仍用 `aggregateSessionDiffs`，脉冲用新增 `liveDiffs={store.session_diff[sid]}`，`nextPulseState` 保证每会话首份快照只建基线；脉冲用伪元素 opacity-only 动画（design contract + reduced-motion）。commits：`7825521e`、`b86cfc5c`、`51bb717a`、`ed991cd1`（Task 4 amend 掉误入的并行 revert-undo 半截；该功能由用�?`fb315869` 完整落地）、`e77be1fa`；desktop **1361/1361**、B2 相关 25 个用例、tsgo rc=0、electron-vite build ok；GUI 冒烟�?dev app 重启（选区引用/Esc/树脉冲）�?
- **Desktop 工作台合�?+ G1/G2�?026-10-26，spec `docs/superpowers/specs/2026-10-26-workbench-merge-design.md`，plan `docs/superpowers/plans/2026-10-26-workbench-merge.md`�?*：右 dock 四件套（files/editor/browser/terminal）合并为宽工作台——IDE 骨架（文件树 200px + 编辑�?浏览器主�?tab + 底部终端 280px 可收起）；三�?*绝对 px 吸附** 420/520/640（护�?`clamp(320, min(760, 可用宽−520))`、双击回 520、localStorage `mafw-workbench-detent`、旧 `mafw-chat-width` 像素最近迁移）；会话数据七面板�?44px 图标�?+ 浮层（badge 保留，Esc/点外关闭）；面板骨架统一（`dock-panel.tsx` �?DockPanelHeader/DockEmpty/DockBanner + lucide 换装 + 浏览器主题化空�?懒挂�?+ �?CSS 清理）；G1 截屏批注（desktopCapturer 整屏 �?renderer 裁剪浮层 �?pending-capture 管线，图片走既有媒体管道）；G2 网页元素点选（悬停高亮注入 + 元素信息 + 区域截图 �?capture 草稿）。commits `f6929aa2`/`58834c5a`/`1f45b19c`/`cda17df0`/`431f6a2c`/`9729f480`/`3821cc81`/`55e48286`（终审修复）；desktop **1507/1507**、ui **8/8**、tsgo rc=0、electron-vite build ok。终审修复：浏览器二次导航（`navigationPlan`：已�?webview �?loadURL）、非 chat 视图隐藏 dock 壳（窄屏 overlay 不再�?Dashboard/Config）、会话轨 badge 归属（`railBadgeFor`）、G2 元素字段透传（outerHTML/attrs�? app �?Esc/60s 超时取消、capture↔附件按 `capture-<id>.png` 联动移除、浮层面板滚动、终端收起常挂载（保 scrollback）、旧键一次性迁移（`migrateDockKeys`）、裁剪浮层模态化（捕获阶段吞键）�?*冒烟修复（commit `cfe785c2`�?*：拖动实时预览徽标（px + 实际比例）、会话轨 Esc 只关浮层（stopPropagation）�?*G2 元素截图改走 desktopCapturer 窗口区域裁剪**（Electron 42 �?`<webview>` �?guest `capturePage` 均悬挂，日志 UnknownVizError）、相机按钮窄工具栏降级、`workbench-defaults.ts` 旧黄金比代码清理。CDP 自动冒烟已过：三档拖�?吸附/双击�?520、会话轨开合、G1 框选→草稿→附件联动删除、G2 点选→元素草稿→附件联动删除；待人工：终端 close-to-tray/切目�?serve 重启/pi 降级、窄�?overlay、B2/B3 时间线。关键决策：比例档位在宽屏塌缩（1920 �?40�?0 仅差 10px�?560 三档全重合）�?改绝�?px（业�?VS Code/opencode/Zed/Codex �?px，调�?`2026-10-26-detent-ratio-vs-absolute.md`）。未做：G1 画布标注（后续增量）、多屏同时框选（当前截窗口所在屏）、G3 steer（独立立项）、GUI 冒烟�?dev app�?
- **Desktop 档位 rev2（2026-10-26，commit `6483323a`）**：按用户要求 640 设为默认、去掉过窄的 420、640 外再加一档——档位改为 **520 / 640 / 760**，默认 **640**；旧持久化 420 经 `normalizeDetent` 回默认 640；拖动域仍 `[320, min(760, 可用宽 − 520)]`，760 在 1400 窗实测生效（chat 760 / dock 714），双击回 640；spec/plan 已加 rev2 注记。desktop **1510/1510**、tsgo rc=0、electron-vite build ok。
- **Desktop 标题栏任务条重叠修复（2026-10-26，commit `7ec8a056`）**：chatview 标题栏「✔ 全部完成（10/10）」被挤到 50px 且不裁剪，文字压到「时间线」/「细节」；根因是 `.mafw-taskbar` 无 `overflow`/`min-width`，内容 scrollWidth=226 外溢。修复：任务条 `overflow:hidden` + `min-width:88px` + `flex:1 1 auto`；全完成态改紧凑「✔ 10/10」；标题栏 `container-type:inline-size`，≤600 隐藏 token 徽标/进度条/耗时/当前任务文本；删除重复的 `done/total` span（任务条已显示计数）。实测 chat 640/520/760：任务条 scrollW==clientW、与时间线/细节重叠 0、时间线命中自身；desktop **1513/1513**、tsgo rc=0、build ok。
- **Desktop 终端 resize 调度器 Illegal invocation 修复（2026-10-26，commit `e922087e`）**：`createResizeScheduler` 默认 timers 把裸 `setTimeout`/`clearTimeout` 存进对象，调用时 `this` 变成 timers，Chromium 抛 `Illegal invocation`（ResizeObserver → schedule），终端 fit/resize 不再执行。修复为 `(fn, ms) => globalThis.setTimeout(fn, ms)` / `(h) => globalThis.clearTimeout(h)`；新增 receiver 回归测试（模拟浏览器对 this 敏感）；真实 Chromium 页面内 import 验证 schedule/cancel 无异常、定时器执行 1 次；重载后打开工作台终端并 resize，异常 0。desktop **1514/1514**、tsgo rc=0、build ok。
- **Desktop �?composer 溢出修复�?026-10-26，commits `b16978d8`/`2eab6cdc`�?*：小窗口 inputbar 显示不全——根因是左组 `overflow: hidden` 硬裁 + Tooltip 包装层即使按钮隐藏仍�?flex gap�? �?flex item）；实测 620/520/420 宽左组裁�?57/157/257px�?60 时发送键被挤出。修复：新增「⋯」更多菜单（截屏批注/命令/引用 Agent/审阅改动/语音播报/语音输入/切换 Agent/切换模型；Esc/点外关闭），菜单挂在 `.mafw-composer` 上（`position:absolute; bottom:48px`，不能放 overflow:hidden 的左组）；`:has()` 按子按钮状态整层隐�?Tooltip；容器断�?�?20 显示更多入口、≤620 命令/引用入菜�?+ 审批/plan pill 图标化、≤520 Agent pill 入菜单、≤420 模型 pill 入菜�?+ 间距 4px�?*顺带修窄屏点�?bug**：`.mafw-dock-slot` �?overlay 类此前只�?`viewportNarrow()`，工作台关闭后空�?560px 固定层仍覆盖聊天（发送键 `elementFromPoint` = dock-slot）；改为 `viewportNarrow() && dockPresent()`，关闭后槽宽 0。验证：720 实窗 + 620/520/420/360 容器宽度 left 裁切 0、发送键恒可见；620/720 工作台关闭时菜单 `hitInsideMenu:true`、Esc 可关；desktop **1510/1510**、tsgo rc=0、electron-vite build ok�?- **Desktop B3/B3.1：checkpoint/rewind 时间�?+ per-turn diff�?026-10-23，B3 spec `docs/superpowers/specs/2026-10-23-b3-checkpoint-rewind-design.md`，B3.1 spec `docs/superpowers/specs/2026-10-23-b31-per-turn-diff-design.md`，plans `2026-10-23-b3-checkpoint-rewind.md`/`2026-10-23-b31-per-turn-diff.md`�?*：右 dock/标题栏「时间线」→ `CheckpointOverlay`：已加载 user 回合（倒序�?0 �?UI 过滤、排�?`user-`/`local-`/`queued-`）、prompt 摘要、runtime-aware 确认、最新回合仍可操作�?*对话回滚**复用 `sessions.revert`（opencode 2.1 stage+commit 不可逆，inline/overlay 统一 `revertWarning`，运行中禁用）�?*代码回滚（B3.1 解冻�?*：gateway �?assistant `snapshot.start/end` �?git tree diff 计算每回合文件改动（`~/.local/share/opencode/snapshot/<projectID>/<repoDir>`）；`GET /sessions/:id/diff?messageID=` 只走该分支，�?未知 id 404，绝不回退全会�?diff。B3 时间线与 B2 ChangesDock/EditorDock 共用 per-turn 数据；仅完整可反�?patch 显示代码回滚（新�?删除/二进�?�?mode 不可），�?git 会话�?pruned snapshot 返回 404 并隐藏；嵌入 `DiffReviewPanel` �?session-wide fallback + 非反转文�?hunk 回退。确认防双击（行按钮�?request、确认面板才执行）。`runtime_switched` 刷新 caps/name。commits：B3 `08a29ad7`、`a9249fa4`、`5e9a2c19`、`759bc229`、`a7228812`；B3.1 `44a88017`、`a621b157`、`e40c64bd`、`6255b147`、`c36c7ef9`、`e30ab975`、`0677b47b`；desktop **1405/1405**、gateway **2538/2538**、tsgo rc=0、electron-vite build ok；GUI 冒烟�?dev app/gateway 重启�?*B3.1 deferred minors 收口�?026-10-26�?*：在飞回合不再参�?per-turn 抓取（`collectTurnDiffCandidates(..., { excludeLastTurn })`，终�?per-assistant-step refetch storm�? overlay loading 空候选时收掉 + MafwShell 请求代际守卫/失败 key 重试/50 条上�?+ gateway snapshot id 40/64-hex 校验（阻�?`--output` 选项注入�? git 引号路径解码；desktop **1458/1458**、gateway **2636/2636**（commits `8bad47e1`、`52350c65`）。composer badge 已改为合�?per-turn 数据（`session-turn-diffs.ts` 单一来源，与 ChangesDock 一致；commit `fb07abfd`）�?
- **Batch 5：Gateway queue inbox UI�?026-10-26，spec `docs/superpowers/specs/2026-10-26-batch5-queue-inbox-ui-design.md`，plan `2026-10-26-batch5-queue-inbox-ui.md`�?*：SDK `QueueItem` + `session.queueList/queueCancel/queueClear` + `promptAsync.delivery/idempotencyKey/expectReply` 类型面；preload 同步。Desktop `queue-store`（per-session 快照/排序/文本提取）经 dispatcher `queue` dep �?`queue.updated`；composer 上方新增「网关队列」条（逐条取消/清空），与本�?turn queue 分开。TUI 状态栏 `inbox N` + `queue.updated` 更新 + 切换会话拉取。commits `7400c085`/`aebad5ed`/`fd2b2193`/`6a4126c1`；desktop 1430、SDK 146、TUI 225�?24 pass/1 skip）、gateway 2607、session-ui 89；v4.33.0�?
- **Batch 6：Thinking/Effort + Signature�?026-10-26，spec `docs/superpowers/specs/2026-10-26-batch6-thinking-signature-design.md`，plan `2026-10-26-batch6-thinking-signature.md`�?*：`ThinkingLevel`（off/minimal/low/medium/high/xhigh/max�? prompt `thinkingLevel`/`variant` 契约、HTTP、SDK/preload、queue 全链；Pi `setThinkingLevel` + prompt opts；`thinkingSignature` �?reasoning `signature`，canonical `MafwPartBase.signature/native` + SDK `SessionMessagePart.signature/native`。commits `52526e8b`/`83ad6730`/`16f782d1`/`9d5f437c`/`e6bf3c32`；gateway 2617、SDK 147、TUI 225�? skip）、session-ui 89；v4.34.0�?
- **Batch 7：Session Config Options�?026-10-26，spec `docs/superpowers/specs/2026-10-26-batch7-session-config-design.md`，plan `2026-10-26-batch7-session-config.md`�?*：`GET/POST /api/session/:id/config` façade + `session.config` canonical 事件；分�?mode/agent/model/model_config/thought_level；复�?approval policy + runtime switch，kv 记录 agent/model/variant/thinkingLevel；Pi `setThinkingLevel` 运行时能力；SDK/preload/TUI/SDK 事件 union 同步。commits `0ff1d56a`；gateway 2625、SDK 148、TUI 225�? skip）、session-ui 89；v4.35.0�?
- **Batch 8：MCP Structured Tool Results 收尾�?026-10-26，spec `docs/superpowers/specs/2026-10-26-batch8-tool-structured-results-design.md`，plan `2026-10-26-batch8-tool-structured-results.md`�?*：`toCallToolResult` 自动�?JSON text 提升�?structuredContent（object/array/标量，非 JSON 原样）；`createToolRegistry()` 为所有缺省工具补 generic object outputSchema，首�?3 个保�?bespoke schema。commits `78489311`；gateway 2629；v4.36.0�?
- **Batch 9 / T2-1：检查点自动�?+ 三�?Restore�?026-10-26，spec `docs/superpowers/specs/2026-10-26-t2-checkpoint-automation-design.md`，plan `docs/superpowers/plans/2026-10-26-t2-checkpoint-automation.md`�?*：`session_checkpoints` �?+ `CheckpointService`；turn 完成自动记录（anchor=本回�?user、tree=pre-turn 快照树；内部/隐藏会话门控；fail-open�? 手动创建；三�?restore（`session`=只截断历�?/ `files`=正向补丁回工作区 / `both`=opencode 全语义），untracked 只报告不删除；`checkpoint-workspace` kv 基线保证 files 恢复可撤销；`checkpointApi` 能力�?+ `revert{files}`；三条路�?+ `session.checkpoint` canonical 事件六处词汇；SDK/preload 三方法；桌面时间线服务端模式 + 三态菜单。commits `dbd09ce6`/`5defe16a`/`b5052263`/`e275e72d`/`9ae53c1d`/`7a0bbbb8`/`fa2e0ffe`/`6f0701de`/`fa6a8784`/`fb342990`/`13e547b2`/`ce8c22bf`/`0c286537`/`07baee58`/`d9d2f398`；gateway 2723、SDK 151、TUI 225�?24 pass/1 skip）、session-ui 89、desktop 1504；v4.37.0�?*真机冒烟 20/20**（自�?手动检查点、files 恢复含新增删除、untracked 残留、后悔药、SSE 事件、confirm/404/忙门、时间线倒带含目标、排他锚点、回合外编辑 400、manual 仅代码）�?*重要实证**：① serve 2.1 �?`/api/vcs/apply`�?04；SDK 默认 `throwOnError=false` 静默吞），files 恢复�?B3.1 revertDiff 均改�?gateway-side `git apply`（`core/diff/apply-patch.ts`）；�?opencode 2.1 �?`revert` **删除 anchor 消息本身**（不是保留），故 session/both 恢复会删掉目标检查点；manual 检查点因此只支�?files（`checkpoint-workspace` kv 记忆工作区树，临�?index `diff-files` 证实幂等）�?
- **Batch 10 / T2-2：回合级软暂停 RunState（2026-10-26，spec `docs/superpowers/specs/2026-10-26-t2-runstate-soft-suspend-design.md`，plan `docs/superpowers/plans/2026-10-26-t2-runstate-soft-suspend.md`）**：`run_states` 表 + `RunStateService`（suspended/resumed/completed/failed/cancelled）+ `RunCoordinator`（abort→settle→续跑简报→落库；resume 先落状态再 fire-and-forget；启动 reconcile；队列闸门）。四路由 `/suspend /resume /run /run/discard` + `runStateApi` 能力位；canonical `run.updated`；SDK/preload 四方法；桌面暂停按钮 + 暂停条 + run-store。**诚实语义**：无进程级挂起，暂停=abort+简报，恢复=合成 `[MAFW 续跑]` 提示开新回合。commits `a159dd8c`/`ac48b2f0`/`b0a8ffc3`/`616e58a4`/`aadf0b1d`/`8b30061d`/`48ab2ee6`/`122be5a3`/`f422678c`/`7ffd5bb7`；gateway 2778、SDK 157、TUI 225（224 pass/1 skip）、session-ui 89、desktop 1520；v4.38.0。**真机冒烟 14/14**（闲时 409、暂停/简报、GET run、重复暂停 409、暂停中入队、恢复+续跑提示进历史、run 终态、discard、discard 后队列续发）。**冒烟驱动的修复**：① opencode SDK v2 历史已是 `{info, parts}`，adapter 归一化漏拆导致 runtime 生成的 `info.text`（续跑/队列提示）历史为空——已修（parts↔content）；② resume 后延迟的 abort 终态会误结束新 run——引入 `awaitingStart`（turn.started 前的终态只 settle）。**review 修复**：suspend 单飞、pi 目录/空闲 abort 闸门、reopen 终态守卫、命令/enriched/WS 旁路 409、窄窗暂停入口（更多菜单）、`awaitingStart` TTL + 队列保持、能力热切换后 GET/discard 仍可用。

- **Batch 11 / T2-3：类型化 data part（2026-10-26，spec `docs/superpowers/specs/2026-10-26-t2-data-parts-design.md`，plan `docs/superpowers/plans/2026-10-26-t2-data-parts.md`）**：AI SDK 6 语义 `data-<name>`（id 调和 + transient）；`session_data_parts` overlay 表（session 作用域 `data_` id）+ `DataPartService`（name/64KB/assistant 承载校验、同 id 渐进更新、transient 删旧持久行）+ `POST /api/sessions/:id/data` + 历史出口合并（runtime 同 id 优先）+ 桌面 `part.updated` 不置忙、终态清理 transient + session-ui 通用 JSON 数据卡（前缀回退）。commits `5bdb0597`/`ab3ee39b`/`d4d3443f`/`a125664f`；gateway 2807、SDK 158、session-ui 94、desktop 1529、TUI 225（224 pass/1 skip）；v4.39.0。**真机冒烟 11/11**（持久注入+历史合并、同 id 原地更新、跨消息 409、transient 不入历史、user 目标/超大/非法名 400）。**review 修复**：persistent part 显式 `transient:false`（防 transient→persistent 被终态清理误删）、注入路由 Buffer 拼接 + 256KB body 帽（UTF-8 多字节不截断）、prune 按 `updated_at`（热更新行不被淘汰）、显式 id 非法 400（不静默改写）、消息被 revert 后允许 rebind、transient 事件不入 `event_log`（重连不重放）、session-ui 测试改 bun:test（typecheck 通过）。

- **Desktop Agent 工作台 B/B1 布局（2026-10-26，spec `docs/superpowers/specs/2026-10-26-agent-workbench-layout-ia-design.md`，plan `docs/superpowers/plans/2026-10-26-agent-workbench-layout-ia.md`）**：右 dock 从 44px 会话轨 + 420px 浮层改为 **B 两层**——一级 `工作台 / 执行 / 审阅`；工作台二级 `代码 / 浏览器`；执行二级固定下拉 `概览 / 待办 / 子代理 / 后台 / 轨迹`；审阅复用 ChangesDock；终端常驻底部。删除 SessionRail / session-rail-model / dock-tab / 旧 Workbench 与 `<1200` 自动 overlay；notes 移入左 dock `notes` face（左 rail 便签入口）；用量进执行概览折叠区。左 dock 改为宽度驱动：`resolveMode(open,width)`，≥1366 push、以下 overlay，启动时不在浮层态自动展开；窗口最小 1088×720、默认目标 1600×1000（按主屏 workArea 自适应）。B1 状态与旧 `mafw-right-dock-tab`/`mafw-workbench-tab` 一次性迁移。commits `8279987e` / `8dcf90aa` / `fe8bd3b4` / `76752330` / `2ff68abc` / `057e6239` / `ce5820c7` / `0c949161 / cf8224ae / eda5beb6`。desktop **1534/1534**、tsgo rc=0、electron-vite build rc=0。GUI smoke：1603 实窗 + CDP device metrics 1088/1366/1600；L1/L2、执行下拉五类、审阅、notes、终端跨视图持久均通过；1088 左 dock overlay / 1366 push；无新异常。已知：实际 Electron 最小窗尺寸由 main 常量与单测覆盖，GUI 三档通过 device metrics 验证；窗口级 1088 最小尺寸需发布包再确认。终审后修复 cf8224ae：overview 数据源、执行滚动、键盘下拉、终端默认开、trajectory 切会话清空、窄屏文件抽屉选择后关闭、quota 迁移；full **1530/1530**。minors 修复 eda5beb6：旧 localStorage 键清理、L1/L2 roving tabindex + 键盘导航、概览 agent/model/status、拉宽自动恢复左 dock、1366 左 dock 夹紧、标签/迁移测试钉扎；full **1534/1534**。
- **Desktop 工作台文件预览（2026-10-27，spec `docs/superpowers/specs/2026-10-27-workbench-file-preview-design.md`，plan `docs/superpowers/plans/2026-10-27-workbench-file-preview.md`，调研 `docs/research/2026-10-27-workbench-file-preview-research.md`）**：L2「代码」改名「**文件**」（内部 id 保持 `code`）；图片八型（png/jpg/jpeg/gif/webp/ico/bmp/avif）在文件 surface 内开**只读预览 tab**（editor tab 条复用、contain 自适应、natural 尺寸+文件大小 metadata、外部变更自动刷新、恒 readOnly 不参与 dirty/保存/冲突）；SVG **默认源码** + 头部显式「预览/源码」toggle（VS Code 1.97 / Zed #10403 教训；预览用 `<img>` 防 SVG 脚本）；HTML/HTM 走新协议 **`mafw-file://<rootToken>/<rel>`** 在浏览器 surface 单 webview 导航并自动切 surface（rootToken 不透明随机、root 切换即失效、traversal 双闸拒绝、**protocol.handle 双 session 注册**：defaultSession 供 renderer `<img>` + `persist:workbench-browser` partition 供 webview——Electron protocol per-session 只挂一边另一边 404）；browser-policy 只放行 `mafw-file:`（`file:`/`data:`/`javascript:` 禁令不动）；流式 `net.fetch(pathToFileURL)` + range 透传（无 1MB 上限）；地址栏本地文件显示解码相对路径（设计契约禁 emoji）；新增 `fs-stat-file` IPC 与 `fileProtocol` renderer 客户端（并发去重/失败不缓存）。commits `638716c7`..`911f6b55`（7 个）；desktop **1629/1629**（本批 +56）、tsgo rc=0、electron-vite build rc=0；GUI 冒烟（真 png 120×80 / svg 源码↔预览 / html 相对 css+js 子资源 + 地址栏 + 自动切 surface）全通过。**rev（同日，用户裁决「打开即看」）**：SVG 改为**默认预览**（源码一键切换；VS Code 1.97 亦默认预览，Zed 文本默认是少数派且 community #52255 在请求改预览；调研 `docs/research/2026-10-27-file-preview-defaults-research.md`）；修复首开 svg 无协议 token 导致 src 为空的 bug（svg 打开前 ensureRootToken，失败退回源码态）。commit `4aa18148`；desktop **1629/1629**、tsgo rc=0、build rc=0；GUI 冒烟 svg naturalW=100/源码↔预览往返、png 无回归。**rev2（同日，PDF/CSV 增补）**：PDF → 浏览器 surface 由 Chromium PDF 查看器渲染（webview 开 `plugins`、MIME `application/pdf`）；CSV/TSV → 文件 surface 默认表格预览 + 一键源码（纯函数 `csv-parse.ts`：RFC4180 引号/转义/引号内换行/CRLF/BOM + 分隔符嗅探 `,;\t`，上限行 500/列 50/单元格 200 字符）；`fileOpenPlan` pdf→browser、csv/tsv→table。**关键修复**：`registerRootDir` 现接受相对 root（project id `""`/`"."` 这类会话的 benchRoot 是 `"."`）并 resolve 后注册——此前图片/SVG/HTML/PDF 预览对这类会话全部静默失败（token 永远 null）。commits `4a379a19`（特性）+ `720d0fb3`（相对 root 修复）；desktop **1649/1649**（本批 +20）、tsgo rc=0、build rc=0；GUI 冒烟：CSV 表格含引号逗号/转义引号、TSV 嗅探、PDF 浏览器 surface 渲染（区域截图白底黑字 + webview URL = doc.pdf）、HTML 同分支回归通过。**rev3（同日，Markdown）**：md/markdown → 文件 surface 默认渲染预览（复用 `@mafw/session-ui/markdown`，sanitize + 代码高亮 + 表格，与聊天同款；cacheKey 用 djb2 内容哈希防同 tab 旧缓存），tab 头「源码」一键回编辑；`fileOpenPlan` md→editor。commit `d21c009f`；desktop **1651/1651**、tsgo rc=0、build rc=0；GUI 冒烟 h1/h2/列表/表格/加粗/行内代码/代码块内容 + 源码↔预览往返通过（Vite 模块缓存半截更新坑复现一次：重启 dev 后正常）。**rev4（同日，JSON + Office）**：JSON 默认折叠树（`json-tree.ts` + `JsonPreview.tsx`；每层 500 项上限；源码/树切换）；XLSX=exceljs 表格+sheet 切换（200×50 上限）、DOCX=docx-preview、PPTX=pptx-preview，全部**动态 import 懒加载**（构建产物独立 chunk：exceljs 1.45MB / pptx-preview 2.9MB，不拖启动）；数据走 `mafw-file://` + `fetch(arrayBuffer)` → scheme 加 `corsEnabled` + ACAO（否则 renderer fetch 报 Failed to fetch）；legacy .xls/.doc/.ppt → 只读提示 + 外部打开。修 TDZ bug（`markdownText` memo 在 `activeSourceText` 之前创建）。commits `b9c20f0b`（JSON）+ `8cfa159d`（Office+CORS）；desktop **1666/1666**（本批 +15）、tsgo rc=0、build rc=0；GUI 冒烟：xlsx 双 sheet/中文/引号、docx 标题+表格、真实 pptx 幻灯片渲染、json 树/源码切换全通过。
- **Desktop 左 rail 视觉与功能整理（2026-10-27，spec `docs/superpowers/specs/2026-10-27-left-rail-visual-polish-design.md`，plan `docs/superpowers/plans/2026-10-27-left-rail-visual-polish.md`，调研 `docs/research/2026-10-27-left-rail-visual-polish-research.md`）**：收起态 rail 六钮（`＋` 新建右键菜单=新建会话/⎇并行 worktree（worktreeApi 门控）→ 工作/搜索/便签三连排 → spacer → Dashboard（badge）/Config（静音连接点））；1a 填充块激活（accent 12% 圆角块+accent 图标，退役 4% 底+inset 左条）、命中区 32→34px/gap 5px；图标家族补 `sticky-note`/`layout-grid`（`bubble-5` 经核实已是干净气泡，不重复造）；☀ emoji 与主题钮退役，主题迁 Config「Desktop › 外观」节（`/theme` 命令保留）；连接点去辉光/去呼吸动画。展开态：日期分组头去横线/去计数/静音色、`formatRailTitle`（ISO 兜底→`未命名 · M月D日`、空/`New conversation`→未命名，渲染层 choke points：dock/Welcome/openSessionTab/SSE retitle；重命名草稿保持原始标题）、`railProjectName` 三处兜底（含下拉菜单项；非当前项目→未命名项目）、Manager 三行卡→置顶单行（phase 中文/待决 pill/2px 进度细线）、切换器 chevron 后置。推挤判定改默认档 50:50 预算：`WORKBENCH_MIN_WIDTH 520→640`；`leftDockPushBudget(dockWidth)=46+dockWidth+1280`（默认 264→**1590**，只保默认档不随 520/760 联动，跌破即浮层）、`leftDockPushDragMax` 钳 push 态拖宽、`LeftDock resizeMax` 接线；拉宽自动恢复用同一 budget。commits `1b64e4e2`..`ee20bbb3` + `20ee05f0`；desktop **1561/1561**（本批 +27；右 dock 选中态统一为左 rail 同款填充，commit `e79e30ae`）；终端归属裁决：只属工作台视图（执行/审阅不再显示终端条与开关钮，推翻 10-26「跨视图持久」验收项）+ Ctrl/Cmd+` 开合快捷键（capture 阶段消费防 \x00 落 PTY；纯逻辑 terminal-hotkey.ts / terminalStripVisible / terminalHotkeyAction），commit `019357d0`，desktop **1573/1573**（本批 +12）、tsgo rc=0、electron-vite build rc=0；GUI 冒烟：6 钮顺序/右键两项/未命名标题/外观节/无辉光点/Manage 单行/分组头无横线均通过（push 模式 2048 实窗；float 阈值由单测矩阵覆盖）。

- **Desktop 会话导出（补记，2026-10-28，W0-4 文档债）**：桌面端会话导出早已存在但 §5.5 未记录——`export-markdown.ts`（`buildSessionMarkdown` 纯构建，跳过 queued/local 块）；入口三处：命令面板「导出当前会话为 Markdown」（MafwShell 417/435）、SessionStrip 右键（onExport → MafwShell 1903）、main save dialog 落盘。local-first 无云端链接分享。

- **Desktop 预览批注 + 交互重写（2026-10-27，spec `docs/superpowers/specs/2026-10-27-preview-annotation-design.md`，plan `docs/superpowers/plans/2026-10-27-preview-annotation.md`，调研 `docs/research/2026-10-27-annotation-interaction-research.md`）**：批注触发面从源码选区扩展到全部预览——md/docx 划选=quote 锚、json 节点=JSON 路径锚、csv/xlsx 单元格=A1 锚、图片/svg 拖框=归一化区域锚 + canvas 裁剪截图（img `crossOrigin=anonymous` + mafw-file ACAO，file part 发送）、pptx 点击=slide+坐标锚（`.pptx-preview-slide-wrapper` 识别页码）；PDF 缺席（Chromium viewer 无法注入）、HTML 已有 G2 元素点选。**交互逻辑重写**（用户反馈「交互难受」）：标记即输入（拖框/点击直接开输入框）、**Enter=立即发送 / Ctrl+Enter=攒草稿**（双按钮退役）、Ctrl+M 源码/预览划选直达、Esc 取消。草稿卡按锚点类型显示（`rel › $.a.b` / `B2` / `区域 12%,34%` / `节选「…」`）；发送文本块按锚点渲染（quote 引用块 / 路径+当前值 / sheet+B2 / 区域百分比+页码）。**反馈态**：立即发送登记 mark（内存，按 sessionID 隔离），`turn.completed/turn.failed/turn.aborted` 翻「已回应」，图片显示图钉、文本显示 marks 条，点击切审阅面。`imageDataUrl` 仅内存（electron-store 载荷剥离），发送走 **A2A 媒体管道**（直发 `media.createTask` → 文本指针 / 草稿队列 atts 同路；绝不把裸图片塞给文本模型）；草稿重启后无截图时文案降级为「截图未保存，仅坐标」。**review 修复（`dc110bcd`）**：`onOpenReview` 经 WorkbenchShell→WorkbenchCodeView→EditorDock 全链透传（C1）；预览面 Ctrl+M 与 selectionchange 挂 document（I1）；`turn.completed` 才翻「已回应」且按回合序号只翻早于本回合创建的 mark（I3/I4）；区域截图统一媒体管道（I2）；单元格点击避开文本拖选、浮层换锚点 keyed 重挂（I6）。**rev2 交互/视觉重做（2026-10-27，用户反馈「还是一样难受」）**：新增**批注模式**（编辑器头部「批注」按钮，开启后选中文字/点击节点/落框即打开输入，无需先点浮钮；Esc 退出）；输入浮层改为**底部停靠批注抽屉**（参与布局、内容自动让位、锚点自动滚入视野、1 行起步 + `field-sizing:content` 自增高、meta/提示/按钮单行不换行）；**锚点原地标记**（引文矩形高亮 / JSON/单元格点标记，待回应脉冲→已回应灰化；图片/SVG/PPTX 图钉保留）；动效（抽屉上滑、图钉 pop、高亮淡入、浮钮 scale-in，reduced-motion 降级）。删除废稿 `AnnotationPopover`/`popover-pos`。commit `4612074f`；desktop **1711/1711**（rev2 净 -3：删 popover-pos 4 例、加 rev2 1 例）、tsgo rc=0、electron-vite build rc=0；截图审计：选中即出抽屉（无浮钮）、锚点 bottom 237 < 抽屉 top 262（不遮挡）、预览自动滚动 52px、输入框自动聚焦、发送后锚点原地高亮 + 状态条，无渲染错误。

- **Desktop 批注框定位 rev3（2026-10-27，用户质疑「批注框在最底下不对」）**：调研结论——**底部 sheet 是移动端/模态模式**；桌面侧栏应使用锚点旁浮层（Cursor / VS Code inline chat / Figma 同型）。新增 `annotation-placement.ts` `placeAnnotationBox`：锚点**下方 → 上方 → 右侧 → 左侧**逐级翻边 + clamp 到容器，尽量不覆盖锚点；`AnnotationSheet` 改为绝对定位浮层（`width: min(420px, 100% - 16px)`），锚点矩形由 EditorDock 各处提供（quote 选区并集 / json 行 / 表格单元格 / 图片拖框 / PPTX 点）；打开时 `revealAnchor` 只滚动内容让锚点可见，不再占据底部布局。6 例 placement 单测（below / above / 左右 / 越界 clamp / 四面不足）。commit `18d60c42`；desktop **1717/1717**（+6 placement）；tsgo rc=0、build rc=0；截图实测：选区 bottom 298 → 浮层 top 303（below，gap 5），bodyBottom 816（不再贴面板底）。注：rev2 底部抽屉已被 rev3 取代。**补（`adb7b61c`）**：点击批注框外任意区域自动关闭（document `pointerdown` capture + 框内命中判断；框内点击保持打开，Esc/取消/发送同样关闭）；GUI 实测：点第一段→关闭、点输入框内→保持、无渲染错误。

- **Desktop 批注交互 rev2（2026-10-27，用户反馈「交互逻辑/动画仍难受」后重做，commit `4612074f`）**：① **批注模式**：编辑器头部「批注」开关（aria-pressed），开启后选中文字即弹输入（不再需要先点浮钮），JSON 树点行即批注，图片拖框/单元格/PPTX 点击同模式；Esc 退出。② **底部批注抽屉**（`AnnotationSheet`，替换浮层 popover）：作为编辑器 body 的 flex 子项停靠底部，内容自动让位（不再遮挡锚点）；单行自适应输入框（`field-sizing: content`）+ 单行 hint/按钮；打开时 `revealAboveSheet` 把锚点滚入视野。③ **锚点原地反馈**：发送后在被批注文字处画高亮矩形（pending 脉冲 → responded 静音），JSON/单元格画点标记；图片/PPTX 编号钉保留。④ **动效**：抽屉 160ms 上滑、标记 fade/pop、浮钮 scale-in，全部走既有 motion tokens + reduced-motion 降级。⑤ 删除旧 `AnnotationPopover`/`popover-pos`（被抽屉方案取代）。验证：desktop **1711/1711**（rev2 净 -3：删 popover-pos 4 例、换抽屉 1 例）、tsgo rc=0、build rc=0；GUI 截图审计：批注模式按下→选中自动弹抽屉（`pill:false`）、锚点段落与抽屉 `overlap:false`（preview 自动 scroll 52px）、输入框自动聚焦、Enter 后抽屉消失 + 原地高亮 1 处、无渲染错误。commits `63414978`（锚点纯逻辑）`66ca8cee`（浮层）`a0362e5b`（源码交互）`a01336bd`（md/docx）`93cc064b`（json）`87be2feb`（单元格）`f24c5b2f`（图片拖框）`33ccbf5d`（pptx）`9b8e78d3`（反馈态）`7b4d6a15`（打包测试）；desktop **1714/1714**（本批 +48：特性 +38 / review 修复 +3 / minors 净 +7）、tsgo rc=0、electron-vite build rc=0。GUI 冒烟：md 划选→Enter→marks 已回应、json 节点→Ctrl+Enter 草稿卡（`$.server.port`）、图片拖框→就地输入→草稿卡（canvas 未污染）、csv B2 单元格、真实 pptx 2 页点击图钉，均通过、无渲染错误。已知：草稿批次发送不登记 feedback mark；PDF 批注未做。

- **W5b 选区引用（2026-10-28，commit `76939e0d`）**：文件预览（md/docx 引文锚）划选 → 批注浮层新增「引用」动作（与直发/攒草稿并存）→ `buildFileQuote` 生成引文块（blockquote + 「引用自 `rel`」，2000 字截断）→ `composer-insert` 按会话投递→ ChatPane 追加到输入框草稿（不发送，可编辑）。v1 范围：仅预览引文锚（源码行选区/json/cell/region 保留批注直发，v2 再扩）。desktop **1782/1782**（+8：file-quote 5 + composer-insert 3）、tsgo/build rc=0；GUI 冒烟：划选→浮层按钮 [引用/取消/攒草稿/发送]→点引用→composer `> 引文

引用自 note.md`，无渲染错误。

- **Goal 节点模型可配置（2026-10-28，commit `6966b7a1`）**：模型从身份硬编码改为 `config.goal.nodeModel`（providerID/modelID 对，空对=回落身份内置）。解析纯函数 `resolveNodeModel`（config 优先，半空对不半用）；`GET/POST /api/model-config` 增 `goal.nodeModel`（空对恢复默认、非空对校验 provider/model），driver bindModel 每次读配置（热生效无需重启）；桌面 Config→Models 新增「Goal 节点（plan/execute/review）」行（级联 provider/model + 跟随默认清除）。已配 `opencode-go/deepseek-v4.1-flash`（蓝区 gateway 模型 403 期间的唯一可用）并真机验证：smoke-9 plan 成功 parked（身份默认会 403，配置模型跑通=bindModel 读配置生效）；config.yaml `goal.nodeModel` 已落盘；Config UI 行显示当前值（加载暂态后就位）。gateway 22/22（新增 node-model 4 + model-config goal 5）、desktop 1774/1774、tsgo/build rc=0。备注：蓝区 gateway provider 仍 403，修复后在 Config 将 Goal 节点切回 gateway 即可。

- **W5a Steer（2026-10-28，commit `dbc5666a`）**：wire probe 实证（probe2-4）：opencode 2.1 的 `delivery:'steer'` 在单步生成与多步工具回合下均为「**回合结束后优先送达**」（steer 发出后 8.4s、迟于 turn 完成 5ms 才落库；pi 才是工具间隙注入）——文案不承诺打断。能力位 `steerApi`（opencode/pi true，minimal false，`active.capabilities.steerApi` 实测生效）；发送路径 `decideBusyDelivery`：**Enter=steer**（徙佐，回合后优先）、**Ctrl+Enter=gateway 队列**（delivery:queue，Batch5 inbox），带媒体/不支持/调用失败均回落本地 turn-queue（不丢附件不丢消息）。desktop **1774/1774**（+9：decideBusyDelivery 4 + busy 路径 5）、gateway 71/71（runtime 契约 3 帮）、tsgo/build rc=0；GUI 最小冒烟（composer 受控输入、Ctrl+Enter 被新分支消费、无渲染错误）。**环境告警**：蓝区 `gateway/volcengine/deepseek-v4.1-flash` 当前 403 Consumer is forbidden（goal 三节点身份钉的就是它，需用户处理）；当前唯一可用模型 `opencode-go/deepseek-v4.1-flash`（commandcode 欠费、kimi 周额度、alibaba key 失效）。busy 回合 GUI 冒烟待 B2 同批补（HTTP 层已实证）。

- **W3 小批 + archive_failed 修复（2026-10-28，commits `6d531700`/`1a26e6df`）**：① archiveGoal 死引用修复——loadArchiveModule 指向已删除的 v1 插件路径（且原生 import() 对 Windows 绝对路径需 file:// URL），改静态 import 同包模块 + 非 git 目录优雅 no-op（此前每个 goal 归档必炸 archive_failed，污染终态；真机 smoke-8 验证 COMPLETED/PASS）；② 复制会话命令（命令面板，extractExportTurns 纯函数与导出共用）；③ 空历史↑提示（shouldHintEmptyHistory 每会话一次）；④ 自定义快捷键（keybindings.ts 纯模块 normalize/resolve/conflicts + keybinding-store localStorage 与 dock detent 同先例，**偏离 roadmap 的 ~/.mafw/keybindings.json 裁决**）：8 个 app 级动作（终端/面板/左右 dock/搜索/细节/会话搜索/任务列表），Config→Desktop→快捷键节录制/冲突提示/恢复默认，**改键实时生效**（GUI 实证 ctrl+shift+u 新键立即接管、旧键失效）；composer readline 与 EventInspector（Ctrl+Shift+E dev 工具）保持固定。三个 design-contract/terminal-scoping/workbench-wiring 契约测试随设计变更同步钉新接线。desktop **1765/1765**（+22）、gateway 2917/2917、tsgo/build rc=0。已知：剪贴板写回读在 CDP 无权限下无法验证（验证受限记录）。

- **W1 计划审阅工作流（2026-10-28，spec `docs/superpowers/specs/2026-10-28-w1-plan-review-design.md`，plan `docs/superpowers/plans/2026-10-28-w1-plan-review.md`）**：goal plan 节点人工批准门——`planReview: manual`（缺省 auto，MCP `mafw_create_goal`/`mafw_set_goal` 参数 → request.json → state v3，存量零迁移）。plan 成功 → `AWAIT_PLAN_APPROVAL` 合法驻留（advanceInner/examineStaleNode 双守卫，stray advance 不越门）；`POST /api/goals/:id/plan-approval`（approve → execute；reject → planFeedback 注入同 round 重跑，attempt 改为同(loop,node) 既有行 max+1）；`GET /api/goals/:id/plan`（waves 缺失 → null 不 500）；planFeedback 清除点=plan 成功兑现（防跨轮泄漏）；终态防线（approve/reject 查 isTerminalState，ABORT 清 planApproval）；`PLANNING_AWAIT_APPROVAL` 进 milestone 白名单。Desktop：GoalDetailOverlay 「计划」按钮 + 泳道「待批准」徽标 → `PlanReviewOverlay`（`plan-render.ts` 确定性渲染 waves，零 LLM）→ 划选引文锚批注（AnnotationSheet 复用，Enter 攒草稿）→ 驳回时 `buildRejectFeedback` 打包（**批注驳回专用**，不做发送节点会话——steer 语义未验证；TUI descope，均用户拍板）。**关键实证（opencode v2 会话模型与 agent 解耦）**：agent md 的 model 只对 subagent 工具子会话生效，goal 会话先 create（默认模型）再 promptAsync(agent)，必须显式 `runtime.session.switchModel`（driver 新增 `bindModel` fail-open 适配器；修 复 toAgentDefinition 丢 provider 前缀的潜伏 bug）；goal 三节点身份钉 `gateway/volcengine/deepseek-v4.1-flash`（用户裁决）。commits `727491b2`/`d271ae65`/`8bcf9928`/`19065f4c`/`cef8f6ec`；gateway **2917/2917**、desktop **1743/1743**、SDK 158/158、tsgo/build rc=0；E2E 双通道冒烟：HTTP 全闭环（park→驳回→重规划→再 park→批准→execute→review PASS）+ GUI（泳道徽标→浮层→划选批注→驳回落库）。已知：`archive_failed` 既有 bug（归档路径 ESM import 失败把 nextAction 写 FAILED，verdict=PASS 照常，待修；非 W1 引入）；gateway `npm test`（--runInBand）跑完 55s 后被 kernel zeromq 句柄拖住不退出——全量须加 `--forceExit`；PowerShell Set-Content UTF8 带 BOM 会使 gateway 的 JSON.parse 失败（request.json 要用 [IO.File]::WriteAllText + UTF8Encoding($false)）。

- **T2-4 系统提示分段 + 每会话 instruction entries（2026-10-27，v4.40.1，spec `docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md`，plan `docs/superpowers/plans/2026-10-27-t2-instruction-entries.md`）**：opencode 2.1 原生 `/api/experimental/session/{id}/instructions/entries`（GET/PUT/DELETE，JSON value，source `api/<key>`，内容哈希快照，fork 复制）。`InstructionSyncService` 在 gateway prompt 前把 `mafw.memory-guide` / `mafw.user-profile` / `mafw.agent-priors` 写入 entries；**每次 sync 都 list 实际 entries**（外部删除/revert/compaction 后不信任 write cache），只对缺失/变化 key PUT、空块 DELETE；整 sync 250ms AbortSignal 硬预算，404/405 60s 熔断。`GET /api/recall/instructions` 返回 `managed/missing/staleKeys/erroredKeys/revision/blocks`，插件只补 missing 块（10min last-good + 内置 guide 兜底），pi 走同一 endpoint（无 entries）。能力位 `instructionsApi`（opencode 2.1 true，pi/@v1/@v2 false）；`session.instructions.updated` 继续压制。commits `9add0cc5`/`8f9cea6c`/`0d21e412`/`764233da`/`d7b3b71e`/`8897d5b3`/`acf8636a`/`67e7718e`/`d84fb063`/`ff3e4c6a`/`814ab105`/`c024a41f`/`04b9ea3d`；gateway **2851**、root plugin **29**、SDK **158**、session-ui **94**、desktop **1573**、TUI 225（224+1 skip）；build/typecheck rc=0；**真机 smoke 18/18**（含 compaction 保持 entries）；review gateway/glm-5.3：0 Critical / 3 Important 已修 / 4 Minor 已修。边界：直接 opencode CLI/TUI 的 pinned 变更可能滞后到下一次 gateway prompt；gateway+旧插件混装可能重复（`recall.instructions.enabled=false` 逃生 + 懒删）；export/import 不携带 entries。本机网关 dist 已部署并重启，agent serve 内插件需 `mafw restart-agent` 才换新实例。

- **T2-5 能力发现契约（2026-10-28，v4.41.0，spec `docs/superpowers/specs/2026-10-27-t2-capability-discovery-design.md`，plan `docs/superpowers/plans/2026-10-28-t2-capability-discovery.md`）**：新增 `DiscoveryService`（目录级 30s 缓存 / 单飞 / 分区降级 5s / 已知会话广播）聚合 MAFW registry、runtime command/skill 目录、AGENTS.md 来源。端点：`GET /api/sessions/:id/discovery`（commands/skills/instructions + revision + degraded/warnings）、`POST .../discovery/refresh`、`GET .../discovery/skills/:key`（技能正文，512KB 帽）；legacy `GET /command`（runtime-only，避免桌面与 MAFW 组重复）、`GET /skill`（元数据）恢复 SDK/桌面命令面板。canonical 事件 `session.commands` 只广播命令（ACP available_commands 语义），在 refresh / MAFW 命令热重载 / runtime 热切换时触发；skills/AGENTS 是 pull-only。能力位 `discoveryApi`（opencode 2.1 true，pi/@v1/@v2 false）；opencode adapter 用 `/api/command`、`/api/skill` 的 `directNative`，按 live 窄 payload 可选映射（`path ?? location`、slash 缺省 false），partial failure 用 `Promise.allSettled` 保留成功侧。pi 记录 live cwd，discovery 降级为 MAFW + AGENTS 来源。AGENTS.md 只暴露 path/scope/bytes/mtime，正文不暴露（opencode privilege 边界）。commits `74275555`/`f20fd54b`/`59408ea9`/`e0ce6f39`/`a3310ef0`/`c78e724f`/`18e8ab54`/`3be6435d`/`e04662a5`/`d16b5fb6`；gateway **2917/403 suites**、root plugin **29**、SDK client **117**、desktop session-events **24**；build/typecheck rc=0；**真机 smoke 22/22**（含 mafw_event 信封）。review gateway/glm-5.3：1 Critical（client.ts 编码损坏，已恢复+UTF-8 重放，U+FFFD=0）/ 3 Important 已修（信封、skillsFailed 503、plural delete forget）/ 7 Minor 中 6 修（realpath、runtime 同名、both-fail 归因、MAFW warning-only、legacy 全量过滤、nearest .git），M6 traceability 记录。边界：MAFW project custom 仅 gateway 当前项目可见，worktree/其他项目 `.mafw/commands` 不发现（warning）；pi 无 skill catalog；skills/AGENTS 无 watcher；SDK contract.test 仍红于并行 goal-plan-review 的 `/api/goals/:id/plan*` 未登记（非本批改动）。

- **B3：MCP/Skills 扩展管理 v1（零写入，2026-10-28）**：Config 新增「扩展」nav（config-nav 10 keys）两张卡——**Skills**：`GET /skill` 列表（全局/项目 badge + 大小），行内详情读 `GET /api/skill/content?directory=&id=`（服务端白名单只读列表内 location，256KB 帽，未知 id 404 绝不按路径直读）+ 打开目录；**MCP**：配置层 `opencodeConfig.get()` 文档数组合并 `mcp.servers` 显示 type/url/command/来源/disabled，状态由 CLI `opencode mcp list` 解析，needs_auth 提供复制 `opencode mcp auth <name>`。**wire 实证（2026-10-28，B3.1 已修正）**：v1 曾因反代 URL 拼接 bug（`new URL('/mcp', base+'/api')` 会丢 `/api`）误判「serve 无 MCP 运行时端点」；实际 serve 2.1 是 **v2 API**：`GET /api/mcp?location=`（`{location,data:[{name,status:{status}}]}`）、`PUT/DELETE /api/experimental/mcp/:server`（增删，留 B4）、`POST /api/experimental/mcp/:server/connect|disconnect`（204）；OAuth 无 HTTP 路由（在 opencode `/mcps` 内登录）。B3.1 已恢复「连接/断开」（运行时操作，不改配置）。CLI 解析器 `routes/mcp-list.ts`（parseMcpListOutput + resolveMcpListCommand）：Windows `.ps1` 直跑 EFTYPE / shell 15s 挂死不可用、`.cmd` 直跑同步抛 EINVAL 必须 shell:true、优先 npm 全局布局 `node_modules/@opencode/cli/bin/opencode.exe`（139ms）。**契约流程修正**：`gateway/src/routes/route-catalog.ts` 登记 4 条（skill.content / mcp.servers / goals.plan / goals.planApproval）+ `npm run emit:openapi` 重生成 `gateway-paths.json`——手改 gateway-paths.json 会被 emit 冲掉（此前 goals.plan 丢失根因）；goals plan 路由正则改捕获组形态以过 phantom 扫描。另修两处既有钉扎：SDK events 计数 29→30（用户 3be6435d 加 session.commands 未同步）、gateway runtime capabilities 期望补 steerApi。gateway **2945/2945（408 suites）**、SDK **161/161**、desktop **1782/1782**、typecheck(tsgo -p)/build rc=0；GUI 冒烟：扩展页 41 技能行/详情 10KB SKILL.md、MCP 行 mafw remote connected + 来源 opencode.jsonc、无渲染错误。**踩坑**：`npx tsgo --noEmit` 不带 `-p` 是假绿（不检查），真门禁 `npx tsgo --noEmit -p tsconfig.json`；Solid props 是 getter，MafwShell 里不存在的 `sessionDirectory()` 延迟到 Config 内才炸。

- **B3.1：MCP 运行时连接/断开恢复（2026-10-28，B3 误判修正）**：复核发现 B3 的「serve 无 MCP 运行时端点」结论源自反代 URL 拼接 bug——`new URL('/mcp', 'http://host/api')` 会丢掉 `/api`，请求实际打到 Web UI 根；修正为 `${apiBase}${path}` 字符串拼接后：`GET /api/mcp` 返回 `{location,data:[{name,status:{status}}]}`、`POST /api/experimental/mcp/:server/connect|disconnect` 返回 204。从 opencode 二进制路由表核实 v2 全量：`GET /api/mcp`（状态）、`GET /api/mcp/resource`、`PUT/DELETE /api/experimental/mcp/:server`（增删，需写入批准→B4）、`POST .../connect|disconnect`；OAuth 无独立 HTTP 路由（`/mcps` 内登录）。新增 gateway 反代 `routes/mcp-runtime.ts`（`/api/mcp` 状态 + `/api/mcp/:name/connect|disconnect` → experimental 映射），SDK `mcp.connect/disconnect` + contract 条目（route-catalog 登记 → emit:openapi），desktop MCP 卡恢复「连接/断开」按钮（needs_auth 仍给复制命令提示）。gateway **2987/2987（417 suites）**、SDK **161/161**、desktop **1782/1782**、typecheck(tsgo -p)/build rc=0；GUI 复核：preload connect/disconnect 为 function、MCP 行显示「断开」、`POST /api/mcp/mafw/connect`=204。

- **B3.2：MCP 能力契约化（2026-10-28，架构修正）**：B3/B3.1 曾把 opencode 语义漏进 gateway（路由里 spawn `opencode mcp list`、硬编码 `/api/experimental/mcp/*`、桌面直接合并 opencode 配置文档）。按「契约能力增强」修正：`RuntimeCapabilities.mcpApi` + `RuntimeClient.mcp`（`RuntimeMcpChannel`：list/connect/disconnect）；opencode 专属实现（v2 HTTP、CLI + Windows shim、配置文档合并）收敛到 `runtime/opencode-mcp.ts`；gateway `routes/mcp.ts` 只做能力门 + 契约调用（能力缺失 503，pi/minimal 自动降级）；技能详情优先走 `runtime.discovery.loadSkill`（MAFW 本地技能回退白名单文件读取）；desktop MCP 卡消费中立 DTO（type/url/command/source/disabled）并按 `runtimeCaps.mcpApi` 能力门显示。实测：`/api/mcp/servers` 返回 `{name,status,type,url,source}`、connect `{ok:true}`、skill content 走 runtime 通道；gateway **3008/3008（421 suites）**、desktop **1782/1782**、typecheck/build rc=0；SDK 160/161（唯一红是并行 voice c2c12a47 的 `/api/voice/status` dead-contract，非本批）。B4 spec rev2 已改为「opencode 适配器拥有持久化（JSONC/备份/原子写/etag）」，gateway 只新增 `mcpConfigApi` + `RuntimeMcpConfigChannel` 门面。

- **B4：MCP 全局配置写入（2026-10-28）**：按契约能力增强实现 `mcpConfigApi` + `RuntimeMcpConfigChannel`（preview / previewRemove / apply / remove / restore）；持久化全部在 opencode 适配器（`runtime/opencode-mcp-config.ts` + `runtime/mcp-jsonc.ts`，`jsonc-parser@3`：字段级合并保留 headers/env/oauth/disabled、type 变更需 replace、备份 `.bak-mafw-<ts>`、原子写、sha256 token 409、diff/日志掩码、恢复只回滚 `mcp.servers` 子树）；gateway `routes/mcp-config.ts` 只做能力门 + 透传（503 当能力缺失）；desktop MCP 卡新增「添加服务器」对话框（表单 → preview → 确认写入）与行内「删除」（仅配置来源行），`runtimeCaps.mcpConfigApi` 能力门。实测：`POST /api/mcp/config/preview` 返回真实 target/token/backup；GUI 冒烟打开对话框→预览→取消（未写盘，全局配置 mtime 未变）。gateway **3034/3034（424 suites）**、desktop **1788/1788**（+6 form）、typecheck/build rc=0；SDK 160/161（唯一红仍是并行 voice `/api/voice/status` dead-contract）。**部署注意**：`jsonc-parser` 是 gateway 运行时依赖——dist 拷贝式部署必须同步 `node_modules/jsonc-parser`（本次踩坑后已补）；npm 发布包由 package.json 自动携带。**已知债**：Config.tsx 顶部 `// @ts-nocheck`（渲染层大文件），typecheck 不覆盖其内部错误（B3 的 `on`/`sessionDirectory` 因此延迟到运行时才炸）。

- **已知债清偿：渲染层 @ts-nocheck（Config/MafwShell，2026-10-28）**：移除两个核心大文件的 `// @ts-nocheck` 并修完 48 + 11 个类型错误（数字样式统一为 `"Npx"` 字符串、preload `runtime.get().active.envOverride` 类型补全、`SelectV2.options` 改字符串数组、`flexShrink`→`flex-shrink`、ModelSelectRow providers 类型、ChatPane 残留 props 清理）。**顺带挖出并修复 3 个被 nocheck 掩盖的真 bug**：① Config「克隆内置插件」调用 `window.api.mafw.usagePluginsCreate`（不存在，运行时 TypeError）→ 改 `sessions.usagePluginsCreate`；② 批注截图媒体指针用 `task.taskID`（A2A createTask 实际返回 `id`，指针会写 undefined）→ 改 `task.id`；③ `ChatPaneProps` 残留 10 个未使用必填 props（store/setStore/onRegisterAnchor/…/onRegisterMediaSpeak）→ 移除，`onClosePane` 可选化并 optional-call。desktop **1788/1788**、typecheck(`tsgo -p`) rc=0、build rc=0；GUI：Config/扩展/预览正常、Welcome 与 ChatPane（composer/input/titlebar）正常渲染、无「渲染出错」。**全量清偿（同日第二批）**：再移除其余 **41 个渲染文件**的 @ts-nocheck（components/pickers/pages/voice），修完 88 → 0 个类型错误（数字样式 → "Npx"、FormQuestionLike/AskQuestionData 对齐、ContextMenuItem.label 可选、SelectV2 current 对象化、ToastV2 无 variant、QuestionWidget 畸形 Show、ModelPicker 类型谓词、voice 的 MicVAD 实例类型/Uint8Array/状态窄化）。顺带修 2 个真问题：① Dashboard「Resume」调用了不存在的 goals control action（RESUME 不在契约枚举，已移除该项）；② LeftDock 的 `autoFocus` 属性名错误 → `autofocus`（此前搜索/重命名输入框不会自动聚焦）。desktop **1788/1788**、typecheck(`tsgo -p`) rc=0、build rc=0；GUI 扫雷 Config 全部 10 个 nav + Dashboard 均无渲染错误。**渲染层已无 @ts-nocheck**。

- **流式尾光标「每段都有」bug 修复（2026-10-28）**：现象——对话进行中每个 text 段后面都出现闪烁绿色块。根因：gateway 历史 text part **没有 `time.end`**（实测），`message-part.tsx` 流式判定只看 `message.time.completed`，导致未完成消息里**每个** text/reasoning part 都被当作 streaming；`mafw.css` 的 `::after{content:"▌";color:var(--accent)}`（#4FD388 绿 + 1s blink）于是挂在每个 markdown 根上。修复：新增纯函数 `shouldShowStreamingCaret`（role / messageCompleted / partEnd / **isTailPart**）+ session-ui 的 Text/Reasoning 两个分支与 desktop `ThinkingBlock` 统一改为「只有消息最后一个 part 才显示」；工具执行中（最后 part 是 tool）光标为 0。session-ui **99/99**（新增 5 例）、desktop **1843/1843**、tsgo/build rc=0；真机 `text→tool→text` 回合实测 max=1、工具阶段=0。视觉字形未改（仍是绿色半块，仅作用域修正）。

- **已知债清偿（第三批，2026-10-28）**：① **SDK voice dead-contract**：`/api/voice/status` 已进契约但 SDK 无调用（并行 voice 工作遗留），补 `voice.status()` → SDK **163/163** 全绿；② **`/api/opencode-config` 命名债**：SDK 新增 `runtimeConfig`（走 `/api/runtime-config`），`opencodeConfig` 降为 deprecated 别名；preload 同步新增 `runtimeConfig` + 旧名别名；Config 页改用 `runtimeConfig`；gateway 双路由同一 handler（旧名保留兼容），catalog 里旧名两条标 `internal`（不再计入死契约）。③ **automations DELETE 契约缺失**：网关已有 `DELETE /api/automations/:id`（删除规则）但 catalog 未登记，导致并行 SDK 调用 dead-drift；补 `automations.remove` 条目。④ **dist 拷贝部署依赖遗漏**：新增 `gateway/scripts/deploy-local.mjs` + `npm run deploy:local`，同步 `dist` 并按 package.json 补齐目标缺失的生产依赖（jsonc-parser 踩坑的根治）。gateway api-contract **3/3**、SDK **163/163**、desktop **1849/1849**、tsgo/build rc=0；HTTP 实测 `/api/runtime-config`（5 docs）、旧别名、`/api/voice/status`（ok=true）均通。注：并行 WIP（NotesDock/SubagentDock 菜单迁移）未纳入本提交。

- **死代码/兼容层清偿（2026-10-28 第四批）**：① 删除确认零引用的遗留模块 `gateway/src/chat/{index,graph-runner,intent-classifier}.ts`、`gateway/src/poll.ts`、`gateway/src/core/plugin.ts`、`gateway/src/core/index.ts`（v4.1 barrel）；**保留** `core/mcp-server.ts` + `core/mcp/tools.ts`——它们仍被 `enableLegacyMcp=true` 的 spawn 路径使用（legacy opt-in，非死代码）。② `noReply` 契约字段退役：删除 `SessionPromptOpts.noReply`、pi-session/pi-runtime 的透传与警告条件，改由 `expectReply:false` 单一语义（测试已用 expectReply，未受影响）。③ `skipMerge` no-op 退役：`HarmonicUnitFileStore.write` 恢复两参签名，清理 consolidation/route-write/评估脚本/测试中的传参（MinHash 写路径早已退役）。④ 删除 desktop `use-send-message.ts` 的 `taskPromise` 死分支（全仓库无赋值点，永不进入）。gateway **3033/3033（424 suites，-1 删除的 skipMerge no-op 用例）**、desktop **1850/1850**、session-ui **99/99**、SDK **163/163**、tsgo/build rc=0。

- **上下文 pill 恒 0% 修复（2026-10-29）**：ChatPane 标题栏的上下文占用只取 `tokens.input`（`t.total || t.input || ...`），开启 prompt cache 后 input 仅数百 token、真实 prompt 在 `tokens.cache.read`（实测 ~66 万），而模型窗口 1,000,000 → `round(914/1e6)` 恒为 0%。新增纯函数 `computeContextUsage`（used = input + cache.read + cache.write，与 UsageDock 既有口径一致），ChatPane 与 UsageDock 共用；desktop 新增 4 个单测（desktop **1901/1901**）、tsgo/build rc=0；真机验证活跃会话 pill 从 `0%` → `12%`（该会话 ~108k/1M，符合预期）。

- **上下文显示统一 + UsageDock 入口（2026-10-29）**：① 修 pill 第二层根因——原 `<Show>{(ctx)=>{ const ctxText = … }}</Show>` 在 Solid 非 keyed children 里只计算一次，打开会话早期快照（tokens 未到）会**永久**显示旧值；改为 `createMemo` 的 `contextText`/`contextTooltip`，随 tokens 更新。② `formatContextUsage` 统一 pill 与 UsageDock 的文案：有窗口→`12%`，不足 1%→`<1%`，窗口未知→`1k` + tooltip「上下文: 1k tokens（窗口大小未知）」，无数据→`—`。③ 找回 UsageDock：它现在位于「右侧工作台 → 执行 → 概览 → 用量与上下文」折叠区；新增**点击上下文 pill** 直接打开（`openWorkbench('execution','overview')` + `openExecutionUsage()`），命令面板新增「打开用量与上下文」。真机验证：pill 与 UsageDock 均为 12%、点击 pill 后 `.mafw-usage-ctx-row` 可见、无渲染错误；desktop **1905/1905**（+4）、tsgo/build rc=0。

- **单个模型用量消失修复（2026-10-29）**：现象——UsageDock「按模型」整块不见。根因两层：① `/api/usage.modelStats` 的 SQL 有 `WHERE model IS NOT NULL`；opencode v2 的 assistant message 把模型放在 `info.model = { id, providerID }`，而 `TrajectoryCollector` 只读 v1 顶层 `info.modelID/providerID` → 新回合 trajectory_turns 的 model/provider 全 NULL（实测当天 22 条全 NULL），按模型统计只剩 8-30 天前的旧行。修复 `modelIdentityOf()` 双读 v1/v2（`modelID ?? model.id`、`providerID ?? model.providerID`），step_finish 事件 model 同步。② UI：`ModelStatsSection` 默认窗口 7d，空列表时整块隐藏（读起来像功能被删）；改为只要 `modelStats.windows` 存在就渲染，空窗口显示「该时间窗口暂无模型用量（可切换 30 天 / 全部）」。验证：gateway 新增 3 单测（v2 形状 / v1 兼容 / v2 模型切换），gateway **3036/3036（425 suites）**、desktop **1905/1905**、tsgo/build rc=0；真机新会话 1 回合后 `today/7d` 出现 `{model:'deepseek-flash', provider:'deepseek'}`，UsageDock「按模型」可见（42% 缓存命中）。注：修复前已写入的 NULL 行不会回填（历史 30d/all 仍有旧模型数据），后续新回合正常。

- **缓存命中口径统一 + 历史 NULL model 回填（2026-10-29）**：按模型卡的「缓存命中」与项目/会话详情不是同一指标——前者 `cache.read/(input+cache.read)`，后者是「缓存读取占总 token 比例」（分母含 output/reasoning），所以会出现模型卡 40% vs 会话明细 90%+ 的观感落差。统一为 `token-metrics.ts: cacheHitRate = read/(input+read+write)` （加 4 个单测），TokenGrid 新增「缓存命中率（prompt 侧）」行，模型 KPI 改名「缓存命中率」。另：按模型只统计 model 非空的回合，历史 NULL 行（collector v1 形状 bug）被排除 → 新增 `gateway/scripts/backfill-trajectory-models.ts`（dry-run 默认 / `--apply`；来源 `session_message` v2 + `session_v2.model` + legacy `message`），已回填 12 行；剩余 53 行属于已删除会话、无源可补。回填后 7d 出现 `volcengine/deepseek-v4.1-flash`（8.1M tokens / 92%），模型 KPI 91%，与当前项目 84% / 会话 93% 同口径。desktop **1909/1909（+4）**、gateway **3036/3036**、tsgo/build rc=0。

### 5.6 Rail 侧边栏数据流
Rail 通过 `window.api.mafw.{namespace}.{method}(...)` 静态类�?API 获取数据�?
```
onMount �?gateway.info() �?ready
       �?invoke("project", "list")       �?GET /api/projects
       �?invoke("project", "current")    �?GET /api/projects/current
       �?invoke("session", "list", pid)  �?GET /api/sessions?projectID=...
```
注意：`projects.current()` 返回的是 `Project` 对象本身，不�?`{ project: Project }` 信封�?
点击"All projects"里的其他项目时，同时�?`projects.setCurrent(path)` 同步�?gateway�?

所�?data fetching 在组件内 inline 使用 `createEffect`，无独立 hook�?
轮询间隔：Dashboard 15s / Approvals 10s / Triage 10s / Automations 10s�?

#### Rail 全事件驱动互动（2026-09-15，commits dda276c8..9007c220，v4.7.0�?

会话列表�?*任意客户�?*（TUI/CLI/另一窗口）的�?�?改名即时同步，不再依�?本地写后 invalidate"�?

- **sessionStore 局部变�?*（`session-store.ts`）：`patch(id, partial)` / `remove(id)`（跨缓存桶、保排序与兜底标题、bump version signal�?
- **事件规划�?*（`session-events.ts`，纯函数可测）：`planSessionEvent()` �?SSE 生命周期事件映射�?patch/remove/invalidate/none——隐藏口径对�?gateway `isHiddenSession`（`core/session-visibility.ts`：parentID / legacy worker 标题前缀 / `agent==='memory-curator'` / `internal` 角色表——agent 判定是确定性的，kv 角色�?7 �?TTL 剪枝后�?worker 会话不会复活到列表）；patch 走字段白名单（title/time/directory/projectID），**绝不 spread info**（SSE info �?`metadata.mafw.role`，防止抹掉本�?manager 标记）；pi �?`session.updated` 空壳（agent_start，无 info）忽略，防每回合 invalidate 风暴
- **MafwShell onmessage 三分�?*：`created`→invalidate；`updated`→patch + tab 标题双写（`sessions()` + `store.session`）；`deleted`→remove + `closeSession`（外部删除已打开 tab 自动关闭，split view/active 回退复用�?
- **gateway 配套**（`runtime/event-broadcast.ts` 纯函�?+ jest）：Mode A 广播封装收敛 `opencodeBroadcast()`，passthrough 事件透传 `directory`（normalize 已提取）；两个项目注册点（HTTP `/register` + registry 目录 watcher）广�?`project_registered`，desktop `projectsRev` 信号触发 Rail/MafwShell 项目列表重拉
- **wire 契约**：gateway 顶层广播（非 `mafw_event` 类型）必�?*扁平�?`data` �?*——desktop 剥壳 `event = raw?.data || raw` 会把 `data` 当内层载荷吞�?`type`；形状由 `event-broadcast.test.ts` 固化（信封名 v2 起为 `mafw_event`，原 `opencode_event`�?
- **顺手修复**：Rail 删除调用 `sessions.remove`（不存在）→ `delete`（原删除必弹失败 toast）；Rail 删除�?tab 残留（`onSessionDeleted` �?`closeSession`）；tab 双击改名纯本�?�?�?gateway rename
- **pi runtime 固有降级**：pi �?created/deleted/标题事件（SessionManager �?hook），invalidate 兜底；测�?desktop +23 / gateway +6

#### Shell 事件分发与会话工作区收敛�?026-09-20，阶段一绞杀者）

MafwShell �?onmessage（原 ~350 �?if-else）与工作区状态抽为独立模块，shell 收敛为布局壳（spec：`docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md`）：

- **SSE dispatcher**（`renderer/mafw/sse/dispatcher.ts`）：`dispatchShellEvent(event, deps)` 纯路由——core/lifecycle 内联，其余经 `EXTRA_HANDLERS` 链（flow-cards / dock / chat-stream / media-speak，`sse/handlers/*`）；一切副作用经注�?`ShellEventDeps`（core/lifecycle/flowCards/dock/chat 五组），逐分支可单测；消费语义精确保留原落穿行为（`message.updated`/`part.delta` 提前消费，流式主链与未知事件落穿�?media_speak 检查后 missTrace）；漏接线检测（`isTailAccountedAtShell`）在 dispatcher 尾部
- **�?reducer**（`sse/chat-reducers.ts`）：乐观 user 消息替换 / assistant 合并 / part delta 累积 / part upsert（含乐观 text 吸收�? `session.next.tool.*` 承载消息确保 / media_speak 参数提取，全部无 Solid 依赖可测
- **会话工作区单�?*（`workspace/session-workspace.ts`）：`workspace` 拥有 tabs signal（`sessions`/`activeId`）、消�?store（`store`/`setStore`）与五个回调注册表（anchor/sendingReset/queueFlush/phase/mediaSpeak，Record 形�?+ register/unregister/call API）；MafwShell 以别名引用（`const store = workspace.store` 等），调用点语法零改�?
- 测试：desktop 测试已入 CI（root `test:desktop`；desktop �?`npm test` = node --test + `@mafw/test-shim`�?026-10-21 �?bun 迁移）；desktop +53（dispatcher 9 / flow-cards 9 / dock 8 / chat-reducers+chat-stream 27 / workspace 5，含已知�?legacy launcher 测试移除 -1�?

#### plan/build 模式引导�?026-09-20，切�?3�?

- **gateway 零改�?*：`SessionPromptOpts.agent` 全链路已通（两条 prompt 路由 + pi 透传）；opencode 内置 plan/build primary agent 天然�?`/api/agents` 列表
- **能力�?= 列表内容判定**：pi �?`translateAgents()` 恒空（providerConfigApi=true 也不 503），desktop `primaryAgents` �?plan/build 才显示切�?UI——不得用 capability flag
- **desktop**：`agentSel` 全局单值升�?`agentPicks: Record<sid, name>`（对�?modelPicks，内存级；`sessionAgent(sid)` accessor）；composer 三态循环「默认→plan→build」（按钮 + Tab 键，picker/mention 激活时 Tab 不抢）；agent pill 加列表非空门（pi 下不再渲染假 "manager" pill）；WelcomeHome「先规划，再执行」按钮（`onStartWithPlan` = createSession + applyAgentSwitch(plan)�?
- **TUI**：`/plan` `/build`（幂�?set agentSelection�? `/agent` picker（含「默认」项�? chat-store `getAgent` dep 并入 promptAsync body + 状态栏 `◇plan` 徽标
- **顺带修复**：`POST /api/approvals/:id/respond` �?stub 仍在挂账（独�?bug，与切片无关�?

#### worktree 并行会话�?026-09-20，切�?4�?

- **能力�?*：`RuntimeCapabilities.worktreeApi`（opencode true / pi false）——desktop 入口�?`GET /api/runtime` �?capabilities 显隐
- **创建**：`POST /api/session` body �?`worktree?: boolean | string`（`routes/session-worktree.ts` `createSessionWithWorktree`）——`SessionWorktreeManager.create(slug)`：`git worktree add <project>-wt-<slug> -b mafw/<slug>`（平铺于项目同级，与 goal `<proj>-goal-<id>` 约定一致；同名 slug 一律递增 -2/-3�?*每会话独�?worktree，无跨调用复�?*）→ `session.create({ directory: worktreeDir })` �?kv `session-worktree/<sid>` = `{dir, branch, projectDir}`
- **删除联动**：`session.delete`（wave1 dispatch）成功后 `cleanupWorktreeForSession`——worktree remove + branch -D，全�?fail-open 不阻塞删�?
- **desktop**：ChatPane titlebar「⎇ 并行」按钮（能力门）+ Rail �?/ titlebar �?`�?<slug>` 徽标（`worktree-label.ts` 纯函数判定：`s.directory` basename 前缀 `<base>-wt-` �?�?项目主目录）
- **TUI**：`/sessions` picker 行尾 dim `�?slug>` 标注（只读）
- **已知边界**：①TS 类字段初始化器先�?constructor 参数属性——`git = simpleGit(this.projectDir)` 拿到 undefined 回退 process.cwd() 会把 worktree 注册�?gateway 自身 repo（已修：constructor 内赋值）；②worktree 内记忆写入不�?directory 分离（HarmonicUnitFileStore 固定 `~/.mafw`），session 维度记忆融合机制未建（goal 链路�?mergeMemoryFromWorktree 不受影响）；③残留孤�?worktree 可经 `git worktree prune` + 手动清理�?*GoalWorktreeManager 修复�?026-09-20�?*：①prepare(archive) �?projectDir �?constructor 不一致时重绑 simpleGit cwd（防御性，测试钉扎）；②并行路径改�?`worktree add -b` 直建分支——旧实现先在主仓 checkoutLocalBranch �?`worktree add <branch>`，主仓分支被切走�?add 必败被吞�?already exists"假日志。另：`POST /api/approvals/:id/respond` �?stub 已替换为真实现（`routes/approvals-respond.ts`：在注册项目 user-questions/（flat+legacy）定位提�?JSON �?answered/answer/answeredAt，goal askUser 轮询消费；id 路径逃逸防护）

### 5.9a RightDock 用量/配额拆分�?026-09-07�?
- RightDock tabs：`tasks | trajectory | usage | quota | notes`
- **UsageDock（用量）**：上下文�?+ Token 统计（会�?项目/记忆三行 + **分模型统�?*：今�?7�?30�?全部窗口切换、KPI �?[�?tokens/估算成本/缓存命中率]、Top3+其他聚合、TooltipV2 五类明细）；数据 `GET /api/usage` �?`modelStats.windows`�?5s 轮询
- **QuotaDock（配额）**：ProviderSection 配额窗口（从 UsageDock 迁出）；UsagePill 点击开 quota tab�?5s 轮询同一端点
- 分模型统计查询现算：`TrajectoryStore.getModelUsageStats()` GROUP BY provider+model（索�?`idx_traj_turn_ttl`），成本�?`usage/model-prices.ts` 价目表估算（无价目模�?`estimatedCost: null` 显示 `—`�?

### 5.9b TUI（packages/tui/�?026-09-11�?
- `mafw tui` 子命令启动（bin/mafw.js spawn `packages/tui/dist/cli.js`，stdio inherit + `windowsHide: false`——TUI 需要可见控制台）；CLI 先探�?gateway `/health`（`MAFW_SERVER_API_PORT �?MAFW_GATEWAY_PORT �?3000`，`MAFW_TUI_PORTS` 覆盖钩子供测试隔离），不通提�?`mafw daemon` 并退�?
- �?HTTP/SSE 客户端：pi-tui（ESM-only，engines �?2.19，TuiAltScreen + setLayoutRoot(VStack)：TabStrip / 内容�?grow:1 / StatusBar�? `@mafw/sdk`，gateway 零改动。四 tab：Chat（promptAsync + SSE 流式累积�?new /btw /older /help、Esc 中止）、Goals�?0s 轮询 + 详情/取消/问答 overlay）、Memory（BM25 检�?+ 便签�?`u` 下架）、Triage（approvals 区块 + c/r/d）；SSE `permission.asked` �?once/always/reject overlay
- 分层：`src/store/`（状态机，不依赖 pi-tui）→ `src/ui/`（组件）；AppModel（tab 切换/quit）与�?store 均纯 TS 可测；ConnectionStore 监督 SSE�?/2/5/15s 退避重订阅�?
- 测试：`node --test tests/*.test.ts`（Node 22+ 类型剥离）；**源码禁用 TS parameter properties**（strip-only 不支持）；相�?import �?`.ts` 后缀 + tsconfig `rewriteRelativeImportExtensions`（tsc 编译时改写为 .js）；UI 组件直接 `render(width)`/`handleTabKey` 断言（pi-tui **不导�?VirtualTerminal**）；冒烟�?cli 退出码（`MAFW_TUI_SMOKE=1` 启用）；冒烟与轮询注�?interval cleanup（store.stop() 必须�?schedule handle，否�?node 进程挂住�?
- 发布注意：`@earendil-works/pi-tui` + `chalk` �?**root dependencies**（发布后全局解析），root `files` �?`packages/tui/dist/`；SDK `event.connected()` �?TUI 监督器新�?
- 已知类型缺口：SDK `TriageItem` �?`id` 字段（wire 实际有，TUI �?`TriageItem & { id: string }`）；`--hybrid` 检�?flag �?SDK `memory.search` �?retriever 参数后接（v1 固定 bm25�?

#### 5.9b.1 TUI v2 能力批（2026-09-14，对�?Claude Code/Codex/opencode/Hermes 调研缺口�?

**Chat 本体**�?
- **Markdown 渲染**：assistant 文本�?pi-tui `Markdown` 组件（`message-blocks.ts` �?`markdownTheme`，标�?列表/代码�?表格；无 cli-highlight 依赖，代码块不着色）；user 文本保持纯文�?`>` 前缀
- **busy 消息排队**：`ChatStore.send()` streaming 时入 `queuedTurns`（turn �?`queued`，渲�?`⏳` dim），`turn.completed` �?`flushQueue()` 每次续发一条（复用 turn 不重复；v2 词汇�?
- **`!` shell 模式**（`src/shell-mode.ts`）：`! <cmd>` 本地 exec�?0s 超时�?28KB buffer、输出截 50 行），渲染进 transcript 本地块（`RawLines`，跨 rebuild 保留），**不进模型上下�?*（Hermes 同款零成本语义）
- **外部编辑�?*（`src/external-editor.ts`）：Ctrl+G / `/editor` �?`tui.stop()` �?`$VISUAL/$EDITOR`（win 默认 notepad）编辑临时文�?�?`tui.start()`（pi coding agent 同款模式；Windows �?spawnSync 防输入缓冲争抢）
- **会话切换**：`/sessions`（别�?`/resume` `/switch`）→ SelectList picker（★manager 标记）→ `ChatStore.switchSession()` + `ConnectionStore.setSession()` 重订 SSE + `chatTab.rebuild()`（localBlocks 保留——loadHistory 与本地块的竞态曾清空 shell 结果，测试抓出）
- **/model**：providers.list 展平（connected 过滤）→ 选中�?`modelSelection` �?后续 `promptAsync` �?`body.model`；状态栏显示
- **/compact**：`POST /api/session/:id/summarize`（gateway `routes/session-summarize.ts` 薄代�?runtime `session.summarize`）→ 重载历史
- **/undo /redo**：revert 到最后一�?*已持久化** user 消息（`local-`/`queued-` 前缀跳过�? unrevert；pi runtime �?unrevert �?方法缺席报错
- **状态栏用量**：`session.tokenSummary` 15s 轮询 + idle 触发 �?model/tokens(`formatTokens` 1.2K/1.3M)/cost($0.06)/duration(`15m 30s`)；slash 命令表收敛在 `slash-commands.ts`（`SLASH_COMMANDS` + `createSlashHandler`，app.ts 注入实现�?

**Goals 编排下钻**：goal 详情 overlay �?`s` �?`GET /api/goals/:id/sessions`（gateway `routes/goal-sessions.ts`，goal_sessions �?+ runtime session.get 富化 title�?*必须挂在 `/api/goals*` dashboard 兜底之前**）→ SelectList（phase/loop）→ Enter 只读 transcript overlay（`historyItemsToTurns` 复用渲染管线，最�?50 条）

**SDK 新增**：`session.summarize`、`goals.sessions(goalId)`（`GoalSessionInfo`）；测试 TUI 90�?9 �?1 冒烟跳过�? gateway 路由 17 + SDK 71

**测试�?*：pi-tui 布局引擎（layout.js `layoutComponent`）需�?viewport 高度上下文，手动 `tab.render(80)` 会把 ScrollView 裁到 1 行——ChatTab 级测试断言 `(tab as any).transcript.render(80)` 而非全栈 render；chalk �?TTY 环境自动关色，断言 ANSI 需�?`chalk.level = 3`

#### 5.9b.2 TUI 鼠标点击�?026-09-14，对�?opencode "click accepts"�?

- **分层**：滚轮滚�?滚动条拖�?拖选复制（OSC52�?URL 点击�?pi-tui TuiAltScreen **内建**（`mouse` 选项默认开，SGR 1000/1002/1006 + tmux/screen 自动降级 button-motion）；组件级点击派发是自建�?`ui/clickable-tui.ts` �?`enableClickDispatch(tui)`—�?*实例补丁** `handleSelectionMouseEvent`（TS-private，子类重写会撞私有冲突；版本锁定 ^0.84.1 + typeof 门控 fail-open）：左键按下（非拖动）→ overlay 模态命中（`resolveOverlayLayout` 运行时穿透算 rect）→ 布局�?`currentLayout.root` 由深到浅命中 �?未命中回落选区逻辑。overlay 打开时外部点击吞掉（模态语义，不落底不触发选区�?
- **命中契约**：组件实现可�?`handleMouseClick(col, row)`（相对组件左上角，返�?true = 消费）：TabStrip（clickAt �?�?tab，onTabClick 回调�?app �?applyTab 同路径）、ChatTab（未聚焦点击聚焦/已聚焦放行保拖选）、Goals/Memory/Triage（行点击 = 选中，Enter 仍负责动作——triage 破坏性操作不一点触发）、picker 全部�?`ClickableSelectList`（点击行 = 选中+onSelect，opencode click-accepts；含 HeaderSelectOverlay �?header 变体，permission overlay 用）
- **SelectList 穿�?*：`filteredItems/selectedIndex/maxVisible` TS-private 运行时公有，`as any` + 版本锁定；可见窗口计算与 `SelectList.render` 同式（scroll-info 行不可点�?
- 测试 `tests/mouse.test.ts` 12 例（FakeTerminal + 真实 SGR 输入管线 + renderNow �?currentLayout）；总计 TUI 104�?03 �?1 冒烟跳过�?

#### 5.9b.3 TUI 交互重构 P1+P2�?026-09-14，四家交互模型调研落地）

**P1 交互地基**（commit 825bf0d4）：
- **InteractionStateMachine**（`ui/interaction-state.ts`）：`prompt|busy|overlay|transcript(P3 预留)` 单一模式替代散落�?editing/streaming/hasOverlay 三布尔；overlay > busy > prompt 优先级；dispatchKey 时从活查询刷新（overlay 开关无事件钩子�?
- **COMMAND_REGISTRY**（`ui/command-registry.ts`）：单表驱动 slash 补全（autocompleteItems）�?help 分组渲染（helpLines，破坏�?⚠）、别名解析（resolveCommand，Hermes COMMAND_REGISTRY 模式）；�?category/destructive/immediate 元数据（immediate=busy 立即执行不排队，Claude 语义�?
- **声明�?keymap**（`ui/keymap.ts`）：app 级键位收敛为 binding 表（quit/abort/memory-blur/editor-open/tab/q/help），动作名对�?opencode 词汇；AppModel 瘦身为纯状态持有（键测试迁 keymap.test.ts�?
- **Editor history**：submit �?`editor.addToHistory`（pi-tui 内建 up/down 导航，此前从未接线）

**P2 输入/反馈回路**�?
- **Up 收回排队**（Claude 语义）：输入为空 + queued>0 �?Up 把全部排队消息收回编辑框（一行一条）；`ChatTab.handleInput` 转发前拦�?
- **Ctrl+S prompt stash**（Hermes 栈式）：有文�?入栈清空、空输入=LIFO 恢复（toggle 语义：恢复后再按=重新入栈）；`PromptStash` 只存内存不落盘；状态栏 📌N 徽标
- **/queue 管理**（别�?/q）：QueueOverlay——j/k/↑↓ 选择、Enter 收回该条进编辑框、d 丢弃、Esc 关；ChatStore �?queuedCount/queuedTexts/takeBackAll/dropQueuedAt
- **状态栏增强**：busy �?+ queued N + 📌N + �?per-prompt 计时（流式实时跳、idle 冻结，Hermes �?2s/15m 30s 语义�? 会话总时�?
- **完成响铃**：回合结�?`\x07`（MAFW_TUI_BELL=0 关）

测试 136�?35 �?1 冒烟跳过）。坑：测试里闭包计数器经解构/直接返回都是快照值，必须�?getter 包装

#### 5.9b.4 TUI 阅读回路重构 P3�?026-09-14�?

- **消息块组件树**（`ui/blocks.ts`，commit 4e61332a）：ChatTab transcript �?一 turn 一纯文本组�?改为 per-part 块树——UserTextBlock（queued �?dim�? AssistantMarkdownBlock / ReasoningBlock / **ToolBlock（可折叠�?*/ PendingBlock；`UpdatableBlock` 契约承接流式快照替换（update(part) 清缓存）
- **ToolBlock 交互**：单击切换展开/折叠（Claude click-to-expand，`userExpanded` 覆盖全局默认）；全局 `/verbose` 循环 all↔off；`/focus` 静视图（Hermes 语义：开=收起+记住、关=恢复，tool 块渲染单�?`⋯` 隐藏标记，display-only 不改历史）；`DisplaySettings` 共享对象，块渲染时读取，切换�?invalidateAll 全量失效
- **ChatTab 块协�?*：refreshTranscript 增量挂新 turn/�?part（pending 之前插入）、快照替换、done 移除 pending；queued→delivered 转正走全�?rebuild（罕见路径）；`scrollToTurn(messageID)` 按块渲染高度累计滚动（scrollTo 前需 updateLayout 钳制——测试要手动喂）
- **Ctrl+O 会话内搜�?*（`ui/transcript-search.ts`）：TranscriptSearchOverlay——输入即过滤（大小写不敏感，�?8 条命中带角色标记 + 片段），�?�?选择，Enter 跳转 scrollToTurn，Esc 关；keymap �?openTranscriptSearch（chat tab + �?overlay 时）
- **/diff [staged|all]**：runShell git diff �?colorDiffLine 着�?overlay�?50 行截断）
- turnToLines 保留（goal transcript overlay 复用）；状态栏 `�?focus` 徽标
- 测试 158�?57 �?1 冒烟跳过）：blocks 10、transcript-search 5、chat-tab 块协�?scrollToTurn/显示设置 8、keymap Ctrl+O、registry/slash 面更�?

#### 5.9b.5 TUI 会话安全 P4�?026-09-14，交互重构收尾）

- **破坏性命令确�?*（`ui/confirm-overlay.ts`，Hermes 三选）：COMMAND_REGISTRY destructive 标记（new/compact/undo/redo）执行前�?ConfirmOverlay——本次执�?/ 本会话总是执行 / 取消（Enter/l/d/Esc）；inline skip `now|--yes|-y`（`handleSlashWithConfirm` 包装层，always 结果�?`sessionApproved` Set�?
- **/rename <标题>**：SDK session.rename�?*/fork**：SDK session.fork �?switchToSession 切到新会话；**/status**：`computeRecap`（`ui/session-recap.ts`）本地计算——轮�?工具调用计数/top 工具/最近交互快照，�?LLM 零缓存影响（Hermes 语义），recapLines 渲染 overlay
- **`mafw tui --session <id>`**：cli.ts parseArgs 显式连接指定会话（fork 后跳转、调试用）；**入口守卫**——cli.ts 顶层 main() 改为 `import.meta.url === pathToFileURL(process.argv[1]).href` 才执行（测试 import 解析参数不再触发网络探测，曾导致测试�?180s 挂死�?
- 测试 167�?66 �?1 冒烟条件跳过，MAFW_TUI_SMOKE=1 时真跑）

#### 5.9b.6 TUI 命令扩展�?026-09-18，v4.11.0�?

- 新命令：`/export`（`ui/export-chat.ts` 导出会话�?Markdown 文件，跳�?queued/local 块）、`/copy [N]`（`ui/copy-text.ts` OSC52 复制�?N �?assistant 回复，`\x1b]52;c;<b64>\x07` fail-open）、`/exit`（别�?/quit）、`/usage`（别�?/cost，`ui/usage-overlay.ts` 渲染 gateway `/api/usage/summary` �?session/project/global KPI�?
- 远端命令消费：启动时 `mafwCommands.list()` 拉取 �?`ui/gateway-commands.ts` `mergeCommands` 合并�?*本地优先**：远�?name/alias 撞本�?name/alias 隐藏远端；远�?category 映射 本地分类），`chatTab.setAutocompleteExtra` 重建补全 provider；未命中本地的命�?fallback �?`mafwCommands.run` 派发（`slash-commands.ts` default 分支），远端 destructive 同过确认�?
- `CommandDef` 新增 `argumentHint`（补全描述尾拼接�?`gateway` 标记；`COMMAND_CATEGORIES` 增『自定义�?
- **模糊匹配不自�?*：pi-tui `CombinedAutocompleteProvider` 内建 `fuzzyFilter`（子序列+大小写不敏感+`- _ . / :` 词边界加�?打分排序，dist/fuzzy.js），slash 补全天然满足 Claude Code 语义——评估后 YAGNI 不引入自�?fuzzy 模块

#### 5.9b.7 TUI 小窗口布局修复�?026-10-09�?

调研 codex/claude/opencode/kimi/dsh 小窗口策略后（`docs/research/2026-10-09-tui-small-window-layout-research.md`，含复现�?`packages/tui/layout-probe.ts`）修三个问题：①**开口箱**——矮行时 VStack �?`slice(0,allocated)` 硬切 Editor，底边框消失；新�?`ui/editor-frame.ts` 包裹 Editor，钳总行数到 `max(3, rows-3)`、保�?底边框、优先留输入行再留补全项，ChatTab �?`minSize:3` 挂载。②**补全弹层无相对约�?*——ChatTab.render �?`terminal.rows` �?`editor.setAutocompleteMaxVisible`�?12�?�?16�?、否�?5；仅下次触发生效，当前列表由 EditorFrame 兜底裁剪）。③**状态栏截断方向�?*——`status-bar.ts` 段带优先级逐段删最低者（hint/占位先丢，usage/conn 最后留），不再从左到右盲截。参照：kimi dock 契约 editor `minSize:3`、codex composer `Min(3)` + footer 折叠链。测�?`tests/small-window.test.ts` 7 例；TUI 全量 219�?18 �?1 冒烟跳过）�?

### 5.10 UI 组件约定
- MAFW 禁止新增�?`<button>`、`<input>`、裸 `title` 属性，一律用 `@opencode-ai/ui/v2/*` 组件
- 按钮�?`ButtonV2`（variant: contrast/outline/ghost�?
- 文本输入�?`TextInputV2`
- 开关用 `SwitchV2`
- 提示�?`TooltipV2`（统一 `openDelay: 300`�?
- 加载�?`LoaderV2`
- 通知�?`ToastV2`（统一 `toastStore` 入口�?

### 5.7 Gateway 启动顺序
```
start()
  ├─ installFileLogging()              �?~/.mafw/logs/mafw.log
  ├─ initServices()                    �?Memory + Cost + MCP + Automation
  ├─ startApiServer()                  �?HTTP API on port 3000
  ├─ init SDK client                   �?@opencode-ai/sdk
  ├─ probe isServeHealthy()            �?先探已有 opencode server
  �?  ├─ �?�?直接复用
  �?  └─ 不�?�?startServe() �?waitForServeReady() ×60s
  �?      └─ 超时 �?MCP-only mode
  ├─ recoverConfig / recoverRegistry   �?恢复注册�?
  ├─ recoverState                      �?恢复活跃 Goal
  └─ automationEngine.start()          �?轮询 + 事件监控
```
Server 启动失败不崩溃，优雅降级�?MCP-only 模式�?

### 5.8 Desktop �?Gateway 探测连接
`mafw-sidecar.ts:startGateway()` �?`mafw-gateway-plan.ts` 的优先级决策�?
```
probeExistingGateway()（MAFW_SERVER_API_PORT �?MAFW_GATEWAY_PORT �?3000，GET /health 确认�?
  �?�?�?adopt：state="ready"，不 spawn
  �?不�?�?packaged �?resources/gateway/dist/index.js 存在
  �?    �?bundle：spawn(process.execPath, [entry], ELECTRON_RUN_AS_NODE=1, windowsHide)
  �?    �?will-quit �?taskkill /F /T 树杀（Windows�?
  �?否则 �?cli：execFile("mafw", ["daemon"])（dev 回退，CLI 缺失�?failed�?
```
运行时健康检查每 30s 一次，连续 5 次失败后自动 restart�?

### 5.9 Client SDK �?Gateway IPC 通道
```
Renderer (SolidJS)                    Main Process                    Gateway
window.api.mafw.{sessions}.{list}()
  └─ ipcRenderer.invoke("mafw-invoke")
       └─ mafw-ipc.ts
            └─ mafwClient[ns][m](...args)
                 └─ fetch("http://localhost:<port>/api/...")
                      └─ Gateway HTTP API
```
Renderer 调用静态类�?API（`window.api.mafw.sessions.list()`），不再�?`invoke(ns, m, args)` 字符串派发�?
SSE 事件直接从前�?EventSource �?gateway，不�?IPC�?

`@mafw/sdk` 包位�?`packages/gateway-sdk/`，提�?`MafwClient` �?+ 全部 DTO 类型�?

### 5.11 后台记忆召回（Background Recall�?

系统概述 �?**边界 recall + 回合�?recall** 两个机制�?

```
opencode server 进程                    Gateway 进程
┌─────────────────────────────�?       ┌──────────────────────�?
�?Plugin (两个 hook)          �?       �?HarmonicIndexManager �?
�?                            �?       �?                     �?
�?experimental.chat.messages  �?       �?GET /api/recall/     �?
�? .transform                 �?HTTP──▶│ context?query=...    �?
�? �?边界 recall 触发         │◀───────�?�?search �?format    �?
�? �?注入指针块到 messages 尾部�?       �?�?{pointers}          �?
�?                            �?       �?                     �?
�?experimental.chat.system    �?       �?(无独立通道：全部记�? �?
�? .transform                 �?       �? 都在谐波系统�?      �?
�? �?注入 <memory-guide> �?  �?       �?                     �?
�?   system 前缀（OptMem 式）  �?       �?                     �?
└─────────────────────────────�?       └──────────────────────�?
```

实际�?recall/观察机制由两部分组成（插件观察捕�?+ 边界注入）：

| 环节 | 时机 | 实现 |
|------|------|------|
| �?观察捕获 | 用户消息 / 工具执行�?/ text.complete / reasoning.ended / tool.failed | 插件 hooks（`src/plugin.ts`）→ `POST /api/obs/capture` �?t1_observations |
| �?边界 recall | **每次 LLM 调用�?*（messages.transform �?agentic 循环内；增量游标使同 turn 后续 step 近似幂等；增�?<50 字符时拼入上一�?assistant 尾文本做短增量回退�?| 插件�?`GET /api/recall/context` �?`<recall>` 指针�?|
| �?聚合压缩 | cron 每小时（turn-compress 规则�?| turnCompress pipeline �?per-session worker �?`mafw_add_memory` |

> �?�?步进注入（step-inject：step-finish �?daemon 把高价值记�?`promptAsync` 回会话触发自治续跑）已于 2026-09-19 删除：实测产出几乎全�?已确认，无需行动"（一次全上下文回放换一句废话），且依赖 runtime 事件流——会话不跑在托管 serve 上时整条链断供。其唯一独占的检索信号（�?assistant 尾文本为 query）已�?�?的短增量回退覆盖�?

**职责分工�?* Plugin = 两个 transform 注射口。Daemon = gateway 事件流订阅（轨迹采集 / compaction flush / BudgetGuard 等）�?
聚合压缩/反�?worker �?LLM 模型�?`config.recall.workerModel` 固定（代码默�?`alibaba-cn/qwen3.7-max`，Config 页可改），per-message 传入；已存在�?worker session 下一�?prompt 即生效，无需重建�?
- 为复用前缀缓存、降�?token 成本，worker session �?idle 达到 `config.recall.workerCompactIdleMs`（默�?8h）后，下一�?prompt 会先�?opencode �?`session.summarize` �?compaction；summarize 失败则直�?dispose 轮换（下�?prompt 重建新会话）�?
- xiaomi provider 可在 opencode 配置里开 `options.setCacheKey: true`，让请求带上 `promptCacheKey` 以便命中缓存（对端点是否生效取决于小�?API）�?

### 5.11a 边界 recall 性能契约与预取快照（R8�?026-09-28�?

边界 recall（`/api/recall/context`，插件每�?LLM 调用前注�?`<recall>`）有 **100ms 硬契�?*（插件侧 abort，fail-open）�?*实测曾长�?240ms �?契约被违�?�?abort �?fail-open �?每轮自动记忆注入静默失效**。三个叠加根因与修复�?

| 根因 | 实测 | 修复 |
|---|---|---|
| BM25 每次查询对全库重新分�?| 3753 �?�?3ms/�?| `tokenCache`（按 id 缓存 tokens，searchable text 校验失效；`bm25RawScored`�?|
| BM25 打分对每个查询词扫描全文档词 | 单趟 ~18ms �?| `tokenCache` 改存词频表（`tf`/`len`）→ 单趟 ~10ms、五趟扩展路�?37�?1ms |
| 查询扩展 10 实体 + 4 子查�?= 14 趟全�?BM25 | 并发�?256�?97ms | `search.expansionMaxSearches`（默�?4�?|
| 后台快照构建并发（dense 嵌入 + 两次 reranker）饿死边界路�?| �?| `snapshotBuildInFlight` 串行 + `LlamaCppReranker.rerankDetailed`（一次打分同时出重排与概率） |

修复后：**服务端检�?74�?7ms（契约内�?*，快照路�?**3ms**�?
- **边界路径没有 dense 的空�?*（实测开启后 72�?6ms �?100�?07ms，护栏在 +25ms 触发且无 dense 收益）→ `search.boundaryDense` 默认 false 保留实验开关；R2 �?R8 快照（后台）进入边界路径
- 失败排查：`/api/recall/context` �?snapshot 决策日志�?`containment=` 与查询长度；短指令（"继续"/"可以"）与内容窗口天然零重叠，此时走实时路径是正确�?

**R8 预取快照**（`search.snapshot`，默�?off→生产已开）：`/api/obs/capture` �?`user_input` 触发每会话防抖（2s）后台构建——滚动窗口查询（4 �?600 字符，最后一轮只�?session 词汇 ~36%）→ hybrid（R2 dense RRF�? R3 rerank + R5 FOK + R6 邻居 �?渲染块存 kv（scope `recall-snapshot`）；边界路径命中即服务（TTL 10min + **包含�?*�?.25 判定话题未漂移），否则回落实�?BM25�?
- **话题判定必须用包含度（overlap/min 侧）而非 Jaccard**：Jaccard �?600 字符窗口 vs 15 token 追问"有长度偏置，实测 158/246 次快照被误跳�?
- 定位延迟�?`/api/recall/context` �?`[Recall] timing` debug 日志（search/noteBoard/goal/neighbours 分段�?

### 5.11b 读路径脑对齐切片（R1–R8）交付状�?

| 切片 | �?| 状�?| 关键实测 |
|---|---|---|---|
| R3 验证层（Qwen3-Reranker GGUF�?| 排序 | �?| R@1 +0.09 |
| R2 dense 融合 | 召回 | ✅（快照内） | 回合粒度 R@1 +4~7pt / R@10 +6~8pt |
| R2+R3 叠加 | 排序 | �?| 120q R@1 0.673 / NDCG@1 0.917（最优） |
| R6 邻居**呈现**（↳ �?+ 最近版本指令） | 注入 | �?每轮 | L2 +8.3pt |
| R6 邻居**检索层** | 排序 | �?默认 off | 两粒度全零（LongMemEval 真值粒度错配） |
| R5 FOK 三区�?| 门控 | ✅（快照�?+ 显式检索出口返�?`fok`�?| 拒答 0.867�?.967；特征必须用 reranker 概率（AUROC 0.782）而非 bm25 分数比（0.582）；行为"声明不撤�?；概率阈值与分数阈值是两套（误用会把一切判�?no-memory�?|
| R7 标识符双索引 | 分词 | �?| 空格�?hit@10 38%�?0% |
| 写端标识符收割（cue_anchors�?| 写路�?| �?+ 迁移脚本 + 提示词根因修�?| 冻结样本 hit@50 70%�?8%；月度缺口基线（52�?8%）供提示词修复前后对�?|
| R1 LLM 改写 / R4 近因 | �?| �?不作默认 | �?temporal / 净�?|

**方法论（写死�?*：先问测量面——加候选类看回合粒�?R@k，重排类�?R@1/NDCG，呈现类只能�?L2，门控类�?AUROC，写端保真看冻结样本 + 可复现对照�?*样本漂移会伪造结�?*（缺口集合随状态移动）�?*一次性备份会被后续迁移覆�?*，A/B �?before 必须从当前状态派生�?
- 探针：`evaluation/mafw-identifier-probe.js`（R7）、`mafw-fidelity-probe.js` / `mafw-fidelity-ab.js`（写端保真）、`gateway/scripts/harvest-cue-anchors.ts`（迁移，dry-run 默认�?

### 5.12 注入点收�?

所有注入路径统一使用 `gateway/src/recall/inject-format.ts` �?`formatRecallContext()` 渲染�?

| 路径 | 注入�?| 格式 |
|------|--------|------|
| `experimental.chat.messages.transform` | pointer 块（`<recall>`�?| 尾部，per-turn |
| `experimental.chat.system.transform` | 记忆操作引导（`<memory-guide>`，OptMem 式） | 前部，常�?|
| `withMemoryInjection()` | deltas + facts + recall | 全量，每�?promptAsync |
| `/api/chat/enriched` | deltas + facts + recall | 全量，首次会话创�?|

pointer 块与全量内容块分别收敛在 `inject-format.ts` �?`formatRecallContext()` / `renderMemoryBlocks()`�?

### 5.13 主动记忆引导（OptMem 式）

**无独立于谐波记忆的通道**。所有记忆（含用户约�?偏好）都存谐波系统；`<memory-guide>` 常驻 system，让 agent **主动操作**记忆系统（参�?[OptMem](https://github.com/VictorTaelin/OptMem)）：

```
<memory-guide>
## 记忆
你的长期记忆�?MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续�?
不主动记录，你将无法记得过去的决定、偏好与教训�?

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的�?
  �?调用 mafw_add_memory（选择 semantic/episodic/procedural，附 cueAnchors�?
- 内容已被 repo 文件承载 �?记指针（路径+一句话 gist），不复述全�?
- procedural 记忆结尾�?�?下次用：<skill/工具>"（记忆即路标�?
- 不写冗余记忆

### 需要旧记忆：主动检�?
- 新任务开始、或不确定此事是否已�?�?调用 mafw_search_hybrid 检�?

### 子代�?
子代理不得调�?mafw_add_memory / mafw_search_hybrid（防重复写入），由父会话统一管理
</memory-guide>
```

- 实现：`src/hooks/memory-guide.ts`，经 `experimental.chat.system.transform` 每轮注入（常驻）
- 被动注入（chat 开�?recall / tool-calls 增量 / step-ended 注入）保留，与主动引导互补：被动 = 系统帮你想起，主�?= agent 自己管理
- �?`.mafw/constraints.json`（pinned 约束独立通道）已废弃：启动时自动迁移为谐波记忆（semantic、energy 0.9）并改名 `constraints.migrated.json` 备份（幂等，`gateway/src/recall/constraints-migrate.ts`�?

#### Pinned 披露层（2026-08-28�?

`pinned` �?HarmonicUnit 一等标志（�?type 正交）：pinned 且未 superseded 的记忆经
`GET /api/recall/pinned` 渲染�?`<user-profile>` 块，由插�?system.transform 每轮注入
（`<memory-guide>` 之后，半稳定内容靠后保前缀缓存；fail-open 150ms 超时）。预�?
20 �?2000 字符，按 energy×salience 截断（salience 缺失�?1），溢出�?
`[Recall] pinned overflow` 日志。知识更新：`mafw_add_memory { supersedes: 旧id }` 显式取代
（复�?`markSuperseded()` soft-supersede 链，新条�?energy 继承 max(0.8, 旧条�? �?pinned 不继承）�?
纠错正门 `mafw_pin_memory`。渲染收敛在 `inject-format.ts:formatPinnedProfile()`�?
路由逻辑�?`routes/pinned-recall.ts`（deps 注入可单测）�?
不加独立 update/delete 工具（业界实践：记忆变异属后台管线——下�?turnCompress 矛盾检测）�?

#### Sticky 便签板（2026-09-07�?

`sticky_until` �?HarmonicUnit 一等字段（ISO 日期；OKF frontmatter 白名单需显式携带，index entry 为板成员资格权威来源、渲染时回退）：未过期且�?superseded 的记忆经
`/api/recall/context` 尾部渲染�?`<note-board>` 块（`routes/note-board.ts`，deps 注入可单测；
渲染 `inject-format.ts:formatNoteBoard()`），解决"用户�?记下�?但只�?BM25 词面匹配才能想起"
的缺口——检索条件化之外的有保质期保证送达层。语义对齐业界调研（mem0 expiration/
Graphiti invalidation）：**板级过期 �?记忆删除**，到期仅下架，本体照常可�?BM25 检索；
坏日�?fail-open 留在板上并排最后；排序按到期近者优先（紧急提醒前置）。预�?10 �?1600 字符（单�?240 截断；`NOTE_BOARD_BUDGET` 单一来源，端�?503/降级兜底�?`emptyNoteBoardBudget()` 复用，勿硬编码）�?
溢出�?`[Recall] note-board overflow` 日志。写入：`mafw_add_memory { sticky: true, stickyDays? }`
（默�?7 天）；管理：`mafw_pin_memory { id, sticky, stickyDays? }` 上板/续期/下架�?
`mafw_get_memory` 补齐指针兑现：按�?id �?`<recall>` �?6 位取全文，superseded 自动沿链附最新版�?
HTTP 等价 `GET /api/memory/get?id=`。业界三层映射：pinned=Letta core blocks（永久可见）�?
sticky=OptMem wake（近期可见）、BM25=archival（按需检索）。桌面呈现：`GET /api/memory/sticky`
（结构化 entries+budget，fail-open）→ SDK `memory.listSticky/setSticky` �?右侧 Dock「�?便签」tab
（NotesDock：倒计�?�? 天红色高亮、续�?下架/删除、预算徽标�?5s 轮询）�?

#### Agent-priors 常驻先验�?+ Skill 物化通道（W1/W2 + D1b�?026-10-08�?

抽象层到 runtime �?push 通道（此�?L5 公理�?MCP pull、reflection insight 只有 BM25 或然命中）。调研：`docs/research/2026-10-08-abstraction-runtime-wiring.md`；路线图：`2026-10-08-brain-like-roadmap.md`�?

- **W1 `<agent-priors>`**：`GET /api/recall/priors`（`routes/agent-priors.ts`，deps 注入可单测）聚合 L5 公理/启发�?+ L2 失败模式谱（`cat:failure`/`cat:correction` 锚点，need×energy×salience 排序），�?`formatAgentPriors()`（预�?800 字符）渲染；插件 `src/hooks/agent-priors.ts` �?`system.transform` 注入（memory-guide/user-profile 之后，fail-open 150ms）�?*先决**：reflection �?insight category 现落 `cat:` 锚点（`buildInsightUnit`，此前映射到 type 后即弃）�?
- **W2 skill 物化**（md↔md 通道，零 LLM）：`memory/skill-promotion.ts` �?`evaluatePromotion` 五闸�?G1 热度(need7d)/G2 一致映�?步骤�?vs 条件分支)/G3 验证�?`verified:` 锚点)/G4 稳定�?�?7 天未修订)/G5 列表膨胀(maxSkills) + `renderSkillMd`（OKF→SKILL.md，name=`ms-<id�?>`，description=摘要+触发词）�?周管�?`memory:skillPromotion`（周�?05:00 UTC）扫�?procedural 记忆，合格者写 `~/.mafw/skill-staging/<name>/SKILL.md` + triage 草稿（`summary.skillDraft`）→ 人审（`POST /api/triage/:id/confirm` �?skillDraft 分支�?`skill-install.ts`）→ 拷入 `~/.config/opencode/skills/` + 源记忆改写为指针（`已物化为 skill:<name>` + `skill:<name>` 锚点）。判据依据：Schneider&Shiffrin 一致映射、JIT 热点编译、Voyager 自验证、AWM 复用频率�?
- **D1b**：reflection 成功蒸馏后对�?episodes �?factor（默�?0.3）降能（`demoteSourceEpisodes`）——Fuzzy-Trace：细节先淡、要点存活；降能�?supersede（多 gist 共享 episode�?:1 链会过度重定向）�?
- **L1/L2/A4（自我认知反馈闭环）**：`orchestration/capability-ledger.ts` �?`buildCapabilityLedger`（goal_outcomes 聚合：PASS �?均轮�?均成�?thumbs/failure_kind 分布�? `buildFailureTaxonomy`（`cat:failure`/`cat:correction` 蒸馏产物�?primary_abstraction 聚类），�?`GET /api/agent/capabilities`（`routes/capability.ts`，deps 注入）暴露；**A4 选择压力回流**：reflection prompt 追加 `selectionFeedbackBlock`（本会话既有 insights �?7 �?need 命中，未被检索的提示合并/删除；`needFor` 注入 `getReflectPipeline`）。已知缺口：goal 无任务类型维度（L1 只到 verdict/failure_kind 粒度）�?

**工具语义类别层（2026-10-13�?*：`runtime/tool-classes.ts` 并集单表（工具名 �?`TOOL_CLASS`：readonly/search/file-edit/shell/subagent/web/plan/other，大小写不敏感——opencode/pi 小写�?+ Claude PascalCase + codex 条目类型名统一解析；spec `docs/superpowers/specs/2026-10-13-tool-class-layer-design.md`，调�?`docs/research/2026-10-13-tool-identity-layer-research.md`）。消费方：审�?`isReadOnlyTool`（read-only 档放�?= readonly+search，修 opencode `list` 漏登）；identity `resolveToolCategory`（per-runtime 双表收敛为单表查询，�?pi `find` 漏登�?manager �?auto-deny）；`commandTextOf`/facet `toolCommand` �?key 候选链（command→cmd→script，防�?runtime �?key 失明）；curator 白名单并集（read/grep/glob/list/ls/find）；handleOpencodeEvent 单点 enrich `part.toolClass`（additive 可选字段，desktop/TUI 渲染迁移留后续）�?

### 5.13a 数据目录与统一数据�?

**MAFW 数据根固定为 `os.homedir()/.mafw`**（`config.resolvePath()`，与启动 cwd / MAFW_PROJECT_DIR 完全解耦；`paths.mafwDir` 配置覆盖失效）。启动时自动迁移 gateway 包目录旁的旧数据（`gateway/src/recall/data-dir-migrate.ts`，幂等，删除旧位置）——注意迁移源�?`<gateway�?/../.mafw`�?*不是** project-relative `.mafw`；插件侧仍会在项目目录重�?`.mafw/`（日志与请求文件等）�?

**统一数据�?`~/.mafw/memory/gateway.db`**（`GatewayDatabase`，`gateway/src/memory/gateway-db.ts`）：
- `t1_observations`：回合观察（插件�?`/api/obs/capture` 写入，turnID 网关分配，UNIQUE 去重�?*入库前经 `redactSecrets()` 脱敏**（`gateway/src/recall/redact.ts`，sk-/ghp_/Bearer/JWT/key=value 等格�?�?`[REDACTED]`），下游 turnCompress/worker prompt/archive 只读脱敏内容——存量历史行不回溯）
- `kv_store`：易失关键小状态—�?
  - `manager-session`（key=projectDir�?*per-project manager session**，替代旧 manager-session.json�?
  - `reflect-cursor`（key=sessionID，反思增量游标）
  - `registry/snapshot`（注册表快照，权威仍�?`scheduler/registered-projects.json`�?
- �?t1.db / manager-session.json / recall-reflect-cursor.json 启动时自动回填并入库后删除（`gateway/src/recall/gateway-db-migrate.ts`，幂等）
- `GET /api/manager/session` 返回全部项目�?manager session 列表（`?projectDir=` 过滤单条�?
- `POST /api/manager/session/rotate`（`{projectDir, reason?}`，`routes/manager-rotate.ts`）：**开新话�?*——旧 session metadata 降级 `role: 'manager-archived'`（去 pinned/exempt，回归普通生命周期，自动出现在桌面历史列表），强创建�?session 替换 kv 并重跑身份注入；�?`ensureManagerSession` �?`managerSessionInflight` 互斥。MCP `mafw_new_topic` 复用同一 flow

**Manager 常驻目标感知�?026-09-03�?*�?
- **每轮 goal 快照**：`GET /api/recall/context` 识别活跃 manager session（kv sessionId 比对）后�?recall 块尾部追�?`<goal-snapshot>`（`core/manager/goal-snapshot.ts` 确定性聚合，�?0 �?500 字符，compaction 免疫）；�?manager session 不受影响�?*按名引用渲染**�?026-09-15，wayfinder 约定）：`标题 (goalId) [phase=…]`——标题在前、id 在括号里，不用裸 id 刷屏
- **Charter 决策地图五段约定**�?026-09-15，借鉴 mattpocock wayfinder，`skills/manager-identity.ts` 系统提示）：Destination / Plan / Decisions so far（决策索引：一�?gist + 记忆 id，不复制详情�? Not yet specified（fog，已知的未知，frontier 推进后毕业）/ Out of scope（排除项）；决策本体�?`mafw_add_memory`（semantic，cueAnchors �?goalId）记录，charter �?state 只存指针——记忆可跨会话检索，state 只是索引
- **里程碑推�?*：`core/manager/milestone-push.ts` �?`eventBus("phase_transition")`（PLANNING_COMPLETE/REVIEWING_COMPLETE/ASKING_USER�? `archiveGoal()`（completed/failed/cancelled），per-project 合并队列�?s），持久化去重键 `milestone-notified/{goalId}:{phase}:{stateVersion}`，`promptAsync(noReply: true)` 硬免回复（消息落历史不触�?LLM；pi runtime busy 分支会丢 noReply 语义——已知限制）
- **/btw 支线问答**：用户直发指令（桌面 `/btw` slash 命令 / 插件 `/btw` command �?`/api/mafw-commands/run`），spawn 一次�?session（registerInternal 'btw'，不回流 T1），prompt 一次拿回答即删；`new-topic`/`btw` 均为**用户指令驱动**（UI-driven, not LLM-driven），刻意不暴�?MCP 工具�?agent
- **/waitwhat 重述**�?026-09-15，借鉴 mattpocock wait-what）：用户�?没听�?�?gateway 取当前会话最后一�?assistant 文本，promptAsync 回同一会话要求"简明语言（STE100 风格�? CONTEXT.md 术语重述，不新增内容"（`routes/waitwhat-command.ts`，deps 注入可单测；回答�?SSE 三端同见）；接线：桌�?ChatPane mafw 命令�?+ 插件 `waitwhat` command + TUI `/waitwhat`（immediate�?
- 旧三�?`manager-report-*` 自动化规则已退役（wake 链路读已删除�?legacy 文件 + 事件无人 emit，整链死代码），`ensureManagerRules` 启动时清理规则文�?

**聚合压缩（memory:turnCompress，每小时�?*：每活跃 session 将本小时所有完成回合合并为一�?batch transcript，交给该 session �?*持久 worker 会话**，由 agent **自主调用 `mafw_add_memory`** 记录值得长期记忆的条目（类型按内容自选）。处理过的回�?*一律归�?*（t1_archive，空/失败不重试——原始观察保留供未来重提取）。内�?worker 会话�?`/api/obs/capture` 的会话白名单过滤—�?*输出永不回流 T1**（防递归）�?*交错回放（B1 二期�?026-09-29�?*：worker prompt 除新回合外注入跨会话 prior knowledge——BM25 召回候选池后按 `need × gain × 1/energy` 重排（need = RetrievalEventBuffer �?7 天命中数，`replayPriorityForMemory`），被选条目盖 `last_replayed` 戳（48h 排除窗防 primacy bias，池全排除时回填防空）；回放条目只作 reconcile 对照证据不重写原文（�?domain shortcut）；`TurnPipelineResult.replayed` 计入 heartbeat 观测�?

#### 5.13b 环境探测式记忆维护（Environment-Probing Curation�?026-09-14，arXiv:2609.11060�?

post-task curator 只看轨迹会记下错误答�?过度泛化/过期知识�?回顾性证据边�?）。落地为四点（A/B/C/D）：

- **A. curator 只读探测�?*：`memory-curator` agent 工具白名单在三个记忆工具之外放开 `read/grep/glob/ls`（`skills/memory-curator-agent.ts`）；**edit/bash/webfetch �?deny**—�?026-08-31 transcript 执行事故的硬防线（mutation 禁止）不变，只读工具不破坏该不变量。`HARD_BOUNDARIES` 改写�?只读验证允许、任何写/执行绝对禁止"。`TOOL_EXTRACTION_SYSTEM` �?propose–probe–commit 段：项目相关 procedural/semantic 记忆写入前先探测验证（每条候�?�? �?probe）；transcript 与环境矛盾时以环境为准并 supersedes；只记可复用过程不记实例答案。另�?*指针优于全文**（内容已�?repo artifact 承载时记"路径+一句话 gist"，文件是真相源记忆是索引）与 **next-time 路标**（procedural 记忆结尾�?�?next time: 用哪�?skill/工具"）两条约定（2026-09-15，借鉴 mattpocock handoff）�?
- **B. stale 刷新（memory:review 每周�?UTC 4:00�?*：`StaleVerifyPipeline`（`recall/stale-verify.ts`）取 top-10 energy×salience �?procedural/semantic 记忆�?14 天、未 superseded），�?`stale-verify` worker 用只读工具重验，失真�?supersedes 链�?*语义升级**：index.ts `registerMemoryPipelineActions` 覆盖�?automation-engine 模块级的 memory:review 桩（原只打印 ReviewScheduler 队列，review_count 无消费者）；规则由 `pipeline-rules.ts` 供给。能量衰减管"淡忘"，本管线�?内容有效�?�?
- **C. 验证置信度约�?*：探测验证过的记�?cue_anchors �?`verified:YYYY-MM-DD` 锚点（prompt 约定，不�?schema），检索时可区�?环境验证�?vs"trajectory-only"�?
- **D. 成败信号喂给 curator**：`TurnPipelineOptions.gradeFor` —�?`GatewayDatabase.getOutcomeForSession()`（goal_sessions �?goal_outcomes 取最�?archived）拼�?worker prompt；prompt 明确"passing grade 不证明中间假设正确，失败轨迹的经验须先验�?�?

限制：bash 不开（opencode 权限 per-tool，无法过滤只读命令）�?命令还能不能�?类验证不在覆盖范围；plan B（gateway 侧确定性路径探测）记录在案未实施�?

#### 5.13c Slash 命令注册表（2026-09-18�?

`/api/mafw-commands/run` 由硬编码 if 链收敛为注册表（`gateway/src/commands/`）：

- **registry.ts**：`MafwCommandDef`（name/aliases/description/argumentHint/category/destructive/kind�? `MafwCommandRegistry`（别名解析、重注册覆盖）；6 条内置元数据�?`BUILTIN_COMMAND_DEFS`（new-topic 别名 `new`�?
- **builtin-handlers.ts**�? 条内�?handler（deps 注入可单测），语义与�?if 链逐字一致；**custom-exec.ts**：自定义命令执行 = 渲染模板 �?promptAsync �?sessionID（缺�?manager session 兜底�?
- **custom-commands.ts**：用户自定义命令——`~/.mafw/commands/`（用户级�? `<project>/.mafw/commands/`（项目级，同名覆盖用户级），markdown + frontmatter（description/argument-hint），子目录即命名空间（`git/commit.md`→`git:commit`）；模板语法 `$ARGUMENTS`/`$1..$N`/`` !`shell` ``（块内参�?shell 转义防注入，cwd=projectDir�?0s 超时�?MB cap�?`@file`（≤100KB，相�?projectDir，防路径逃逸）；`fs.watch` 300ms 防抖热重载，变更广播 `mafw_commands_changed`（扁平顶层事件）
- **GET /api/mafw-commands**：元数据清单（SDK `mafwCommands.list()`）；TUI/Desktop 拉取合并—�?*本地命令优先**（远�?name/alias 撞本�?name/alias 时隐藏远端，�?TUI `/new` 与远�?`new-topic` 不双显、远�?`status` �?TUI 隐藏让位本地 recap）；TUI 未命中本地时 fallback �?`mafwCommands.run` 派发，远�?destructive 命令同样过确认门
- 插件�?6 �?opencode command 维持静态注册（`/goal` 插件�?requests 文件 skill 流程，与 gateway goal �?manager-prompt 语义不同——刻意保留两条路径）

### api/recall/context endpoint

```
GET /api/recall/context?sessionID=xxx&query=xxx
Response: { pointers: string|null }
```

- v0：同�?HarmonicIndexManager.search(query, 3) �?formatRecallContext()
- fail-open：超�?错误返回 `{ pointers: null }`，不阻塞 LLM 流程
- 未来：daemon 预计算好注入载荷，endpoint 读快�?~1ms

### 5.14 Media 接入（A2A Media Agent，pi 引擎 · 多模态）

纯文�?多模态推理模型通过 **A2A 协议**（Agent2Agent v1.0）与 gateway 内置�?
**Media Agent** 多轮协作分析 **图片 / 视频 / 音频**�?*推理 Agent（LLM）主动驱�?*�?
MAFW 插件仅作�?A2A 客户端执行。媒体分析引擎是 **pi-coding-agent**
（`@earendil-works/pi-coding-agent`，进程内 SDK 嵌入），模型经每模态配置指�?
（默�?`xiaomi/mimo-v2.5`，直连小�?API，认证复�?opencode auth.json 的凭据）�?

```
MafwShell（桌面前端）                           Gateway 进程�?000�?
  粘贴/上传图片/视频/音频 �?POST /a2a SendMessage  gateway/src/media/media-agent.ts
    parts: [{raw: 媒体base64}, {text: 问题}]       ├─ A2A JSON-RPC（@a2a-js/sdk v1.0.1�?
  �?消息只发文本指针                               ├─ POST /a2a�?.well-known/agent-card.json�?
    [媒体附件 taskID: x contextID: y（媒�? 名）]   �? /a2a/artifacts/<id>（loopback-only�?
                                                  ├─ TaskStore + ArtifactStore（LRU 500 + TTL 24h�?
opencode LLM（推�?Agent�?                      └─ MediaService �?pi adapter �?模型（每模态可配）
  看到指针 �?自主调用 mafw_media_ask                └─ gateway/src/media/pi-adapter.ts
    src/tools/media-ask.ts（插�?tool，A2A client�?   ├─ pi-coding-agent（ModelRuntime，进程内 SDK�?
      ├─ GetTask { id: taskID } �?contextId          ├─ 认证：opencode auth.json �?provider key
      └─ SendMessage { contextId, referenceTaskIds:    �? （setRuntimeApiKey 运行时注入，不落盘）
           [taskID], parts: [{text: question}] } �?追问  └─ fixMediaPayload（onPayload 钩子�?
    返回：媒体回�?+ �?taskID（继续追问用�?ID，媒体不重传�?
```

要点�?
- **�?A2A，无 MCP、无 transform 自动转发**：追问由推理 Agent 自主决策（调�?
  `mafw_media_ask` 工具）；媒体只上传一次（raw FilePart），追问�?
  `referenceTaskIds` 引用前序任务，每轮是一个新任务（同步模型下任务即时终结�?
- **多模态（image / video / audio�?*：MediaAgent �?`SUPPORTED_INPUT_MODES` �?
  `['text','image','video','audio']`，按 mediaType 白名单路由；大小上限�?
  image �?0MB / video �?0MB / audio �?5MB（超限显式失败）
- **媒体原生进入主模�?*（非"描述注入文本模型"）：媒体作为 PiAiImage carrier
  （`{type:'image', data: base64, mimeType: video/mp4|audio/...}`）交�?pi�?
  pi �?openai-completions 序列化器输出 `image_url`�?*fixMediaPayload**
  （`gateway/src/media/pi-adapter.ts`，派生自 pi-multimodal-proxy �?
  fixVideoAudioPayload，MIT）在 `onPayload` 钩子里重�?wire format�?
  - `video/*` �?`{type:'video_url', video_url:{url}}`（小米视频格式）
  - `audio/*` �?`{type:'input_audio', input_audio:{data:url}}`（小米音频格式，
    data 为整�?data URI�?
  主模型（�?xiaomi/mimo-v2.5）直接分析媒体，`video_tokens`/`audio_tokens`
  真实计入（实测验证）
- **每模态独立模�?*：gateway `media:` 配置段——`provider`/`model`（默�?
  xiaomi/mimo-v2.5�? `image/video/audio` 每模�?`{provider?, model}` 覆盖�?
  �?pi �?`getModel(provider, modelId)` 解析；桌�?Config 页可编辑
- **认证复用 opencode**：key �?`~/.local/share/opencode/auth.json` �?provider
  读取（opencode �?connect 即可），`setRuntimeApiKey` 运行时注入，无独�?
  MAFW API key
- **CJS/ESM �?*：gateway 编译�?CJS，pi-coding-agent �?ESM——pi-adapter 通过
  `new Function('spec','return import(spec)')` 运行时动态导入（tsc 会把普�?
  `import()` 降级�?require，require ESM 包会抛错�?
- 工具描述强化 LLM 可读性：触发条件（会话存�?`[媒体附件]` 指针）、taskID �?
  指针提取、返回含�?taskID；`ToolResult` 结构�?
  `{ title, output, metadata: { taskID, newTaskID } }`
- 错误处理：GetTask TaskNotFound / SendMessage 失败 / 任务 FAILED / gateway 不可�?
  �?显式错误文本，不抛异常不崩会�?
- **标准 opencode（无桌面端）完整可用**�?
  - 入口 A：`src/hooks/media-ingest.ts`（transform）——粘贴图�?视频/音频
    自动建任务并替换为文本指针；`MEDIA_INGEST=off`（兼�?`VISION_INGEST=off`）可�?
  - 入口 B：`mafw_media_upload` 工具——LLM 主动上传本地媒体路径建任�?
  - 追问：`mafw_media_ask`；指�?`[媒体附件 taskID: x contextID: y（媒�? 名）...]`�?
    幂等兼容�?`[视觉附件` 前缀；参�?`mediaPath`
- 安全：`/a2a` 系列端点 loopback-only�?03 拒绝非本机）；Artifact id �?uuid 不可猜；
  FilePart `url` 只接受本 agent 工件引用（SSRF 防护�?
- 前端（MafwShell）媒体附�?�?`window.api.mafw.media.createTask` �?文本指针�?
  图片�?canvas 下采样，视频/音频直读 dataUrl
- 工具清单：`mafw_media_upload`（建任务，返回指�?+ taskID）、`mafw_media_ask`
  （追问，返回回答 + �?taskID）；旧名 `mafw_vision_upload`/`mafw_vision_ask` 已移�?
- **MediaRuntimeExecutor**（`gateway/src/media/media-runtime-executor.ts`）：媒体 agent �?
  AgentRuntime 后端——pi runtime 激活时 `resolvePrompt` �?`engine='pi'` 分支返回 executor �?
  PromptFn；图片追问在同一 AgentSession 内连�?prompt（真多轮记忆，同一 dataUrl + provider/model
  复用会话，追问轮自动回退到最近会话）；视�?音频保持 ModelRuntime.complete + fixMediaPayload
  单次路径；超�?180s + abort；A2A cancelTask �?cancelHook �?cancelInflight 中止进行中会�?
- 测试：`tests/unit/gateway/pi-adapter.test.ts`（fixMediaPayload 单测 + adapter 边界）�?
  `media-service.test.ts`（PromptFn 抽象隔离）、`media-agent.test.ts`（A2A 四模态）�?
  `media-runtime-executor.test.ts`（会话复�?超时/cancel�?

#### 5.14a Media Engine 插件系统

媒体分析引擎可插拔：用户往 `~/.mafw/media-plugins/` �?`.js` 文件即可替换/新增某模态的分析引擎�?
`MediaPluginLoader`（`gateway/src/media/media-plugin-loader.ts`）扫�?热加�?fail-open�?
`MediaService.resolvePrompt(kind, cfg)` 按模态路由到插件引擎或默�?pi�?

> **插件中心全量清单�?026-09-15�?*：三�?loader 不再生成 `example.js.disabled` 模板（启动时 `cleanupExamples()` 幂等清理存量）；`GET /api/plugins`（插件中心）含内置条目——runtime: `opencode`/`pi`、media: `pi`、usage: 全部内置适配器（`builtin`/`overridden`/`pluginType` 字段，同名用户文�?�?内置件标 `overridden`）；安装�?**raw octet-stream**（`POST /api/plugins/install?filename=&type=`，`type` 可缺省——gateway �?tmp-require 嗅探 `module.exports` 接口（`createRuntime`→runtime / `createPrompt`+`fixPayload`+`engine`+`modalities`→media / `fetch`→usage / `tools`→ui；多命中 400 `ambiguous plugin interface: <a/b>`，前端出兜底下拉）。桌�?Config→Plugins：「Runtime & Media」卡已删，runtime 切换=hub 行「激活」、media 每模态下拉并�?hub、usage 内置行只�?「克隆」（复用 clone-builtin 模板端点）。响应另�?`packages` 键（统一插件包状态，2026-09-16）�?

#### 5.14b 统一插件包（Unified Plugin Packages�?026-09-16�?

`~/.mafw/plugins/` 一个插件包可同时贡献多种能力（usage 配额 / media 引擎 / runtime；uiTools v1 仅登记展示，桌面侧加载仍�?`~/.mafw/ui-plugins/`）：

- 单文件包 `name.js` 或目录包 `name/plugin.json`（`{name, version?, main?}`，main 缺省 index.js�?
- 模块形状：声明式 `{ name, usage?, media?, runtime?, uiTools? }` �?`async activate(ctx) �?contributions`
- 统一 ctx = 三个 legacy ctx 超集：apiKey/fetch(60s)/log/pluginConfig（读 `plugins.<name>.config`，回退 legacy 三段�?projectDir/gatewayPort/usage.modelStats（`gateway/src/plugins/package-context.ts`�?emit（`POST /api/events` 发布自定义事件到�?UI 通道；type 建议 `plugin:<name>:<event>` 命名空间，消费方对未�?type 忽略——SSE 通知语义，无注册制）
- **优先级（同名）：�?> legacy 目录文件 > 内置**；legacy 四目录行为不�?
- PluginHost（`gateway/src/plugins/package-host.ts`）：扫描/激�?跨面原子 reload（先全部激活再一次性推�?loader �?`setPackageEntries`�? 顶层与每包子目录�?watcher
- 内置件与用户插件同一接口（dogfood）：opencode �?`registerBuiltin('opencode', �?` 注册（index.ts，可被同名文�?包覆盖）；media `pi` �?`registerBuiltinEngine('pi', �?` 注册，`resolveMediaPrompt`（`media/resolve-prompt.ts`）先�?engines map，非 builtin 同名直接生效
- hub：`GET /api/plugins` 响应�?`packages` 键（PackageState[]�?
- 环境变量 `MAFW_PLUGINS_DIR` 覆盖包目录（测试用）
- 限制：reload 只清主文�?require.cache（改包内 lib/ 需 `mafw restart`�?

**两种插件形�?*（CJS `module.exports`）：

```js
// 形�?A：完全自定义引擎（不�?pi，直�?HTTP 调用�?
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],
  async createPrompt(ctx) {
    return async (parts, opts) => { /* 返回分析文本 */ };
  },
};

// 形�?B：复�?pi 运行时，只换 wire 格式修复�?
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) { /* 自定义改写，返回 undefined 表示不修�?*/ },
};
```

**ctx**（`gateway/src/media/plugin-context.ts`）：`apiKey(name)` / `fetch(url, opts)`�?0s timeout�?
`pluginConfig(name)`（读 `config.media.pluginConfig`�? `log`�?

**config 路由**（per-modality 覆盖全局）：
```yaml
media:
  engine: pi              # 默认引擎
  video:
    engine: qwen-vl       # video 模态走插件
  pluginConfig: {}        # 插件自定义配�?
```

**HTTP API**：`GET /api/media/plugins`（状态列表）、`POST /api/media/plugins/reload`（手动重载）�?
校验失败 fail-open（状态记 error，不影响其他插件与默�?pi）�?
`pi-adapter` �?`fixPayload` 现为可�?dep（默�?`fixMediaPayload` 小米格式），插件可覆盖�?
缓存 key �?engineName 防同模型不同引擎串缓存�?
测试：`tests/unit/gateway/media-plugin-loader.test.ts`�?1 例）、`media-service.test.ts` resolvePrompt 路由�? 例）�?

#### 5.14b UI 工具卡插件系统（desktop�?

`~/.mafw/ui-plugins/*.js`（CJS `module.exports = { name, tools }`）自定义桌面 ChatView
工具执行卡。main 进程执行插件 `render(ctx)` 返回声明�?Widget 树（8 种：text/code/kv/
tags/list/row/image/link），�?IPC �?renderer 内置解释器渲染；sandboxed renderer
不执行用户代码。优先级：无注册卡直接生效，覆盖 MafwToolCards/session-ui 内置卡需显式
`override: true`；pending/running 走默认链，completed/error 才渲染用户卡（防流式 output
O(n²) 传输）。启动扫�?+ fs.watch 热重载，fail-open（坏插件跳过、render 抛错回退默认卡）�?
实现：`desktop/src/main/ui-plugins.ts`（加载器）、`shared/ui-plugins.ts`（类�?校验）�?
`renderer/mafw/components/UserPluginCards.tsx`（代�?解释器）。示例：
`docs/examples/ui-plugins/example-tool-cards.js`�?

### 5.15 OpenCode Serve Sidecar（自监管�?

opencode serve�?096）由 gateway �?**sidecar 子进�?*方式直接监管
（`gateway/src/serve-sidecar.ts`，替�?SDK `createOpencodeServer` 封装）：

- **spawn 契约�?SDK 完全一�?*：`createOpencodeServer` 内部使用 cross-spawn�?
  `opencode serve --hostname=127.0.0.1 --port=4096`、env `OPENCODE_CONFIG_CONTENT="{}"`�?
  就绪信号 stdout `opencode server listening on <url>`（超�?5s 树杀报错�?
- **健康轮询监督**：SDK 不暴露子进程/exit 回调�?*owned �?adopted serve 都走 watchdog**�?
  �?30s 探测 `/global/health`，连�?3 次失�?�?`recoverServe()` 重启�?*重订阅事件流**
  （SSE 建立�?serve 之上，进程重启后必须重连，否则自动化触发器和桌面 SSE 转发全部静默失效�?
- **windowsHide 必须显式�?*�?026-09-07 黑窗事故）：gateway �?detached（无控制台）运行时，
  �?`windowsHide: true` �?spawn 每次都会创建**可见控制台窗�?*——用户关�?= 杀�?serve�?
  watchdog 重启又弹新窗，形�?黑色弹窗关掉还会�?的循环。SDK `createOpencodeServer` 不传
  windowsHide，故 `serve-sidecar.ts` 已改�?*手写 spawn**（保�?SDK 契约：参数�?
  `OPENCODE_CONFIG_CONTENT`、ready 行解析、taskkill /F /T 树杀�?
- **退避策�?*：连续崩�?streak 1/2/3 �?�?0/5s/15s 快速重试；�? �?�?5min 间隔�?
  streak 仅在 serve 稳定运行 60s 后清零（�?flapping 热重启）
- **adopted 场景**：gateway 崩溃后孤�?serve 存活，新 gateway 启动�?
  `isServeHealthy()` 探到�?*收养**（不重新 spawn），watchdog 同上
- **恢复动作收敛**：共�?`recoverServe()` = `killProcessOnPort(4096)` + `startServe()` + `subscribeToEvents()`
- **手动恢复入口**：`POST /api/runtime/restart-agent`（SDK `runtime.restartAgent()` / Config 页按�?/
  MCP `mafw_restart_agent`）触发与 watchdog 相同的编排（kill+respawn+事件流重订）；external 模式 503
- 外部 serve 模式（`MAFW_SERVER_SERVE_URL`）不监管（用户管理的进程�?
- serve �?stdout/stderr 由手�?spawn �?`onOutput` 转发（index.ts �?`[Serve]` debug 日志记录），
  serve 崩溃原因不再静默；诊断同时依�?watchdog �?"Serve unhealthy" / recovery 日志
- 经验：子进程型依赖必须配监督（检测点不能在启动时一次完事）；恢复动作必须完�?
  （重启进�?�?恢复连接，事件订阅要一并重连）�?
  **detached 环境下所有子进程 spawn 必须�?`windowsHide: true`**（python kernel / llamacpp 均已带）

### 5.16 自更新（Self-Update，不依赖 desktop�?

gateway 可自行构建新代码�?*子进程接力重�?*（`gateway/src/self-update.ts`）：

- **触发协议**：`~/.mafw/pending-restart.json`（homedir 控制面）—�?
  `{ target: "gateway", action: "update"|"restart", reason?, delayMs?, commit? }`�?
  原子写（`.tmp` + rename）；gateway 2s 轮询，先删令牌防循环，坏 JSON 连续 5 次后删除
- **更新动作**：`action: update` �?包根 `npm run build`（exit 0 + dist 校验）→ 顺带
  `npm pack` + `npm install -g`（尽力而为，失败不阻塞）；`restart` 跳过构建
- **接力重启**：spawn 新进程（`MAFW_TAKEOVER=1`，同入口 dist）→ 2s 确认存活 �?
  优雅 `stop()` + exit；新进程 2s 内崩溃则**取消重启**，旧进程继续服务�?
  失败安全：build 失败/坏令牌均不重�?
- **TAKEOVER 分支**：跳过单实例守卫 �?�?3000 释放（≤30s）→ 接管 �?更新
  `~/.config/mafw/gateway.pid`（CLI status/stop 继续有效�?
- **调用者定�?*：事件流�?bash 工具命令�?`pending-restart` 的会�?= 写令牌�?
  （确定性）；兜底最近活跃会�?
- **完成通知**：新 gateway 启动完成 + recoverState 后，向调用者会�?`promptAsync`
  注入 `[MAFW SYSTEM] 自更新已完成...`（同会话自动续跑）；调用者未知时兜底通知
  **主项�?* manager session（不做全项目广播——其他项�?manager 收到只烧 token�?
  2026-09-08 修复）；失败 �?`notified:false` + 被动续跑（agent �?last-restart.json�?
- **记录**：`~/.mafw/last-restart.json`（reason/commit/requestedAt/sessionID/notified�?
- 等价入口：`mafw update` CLI（写同一令牌；无会话上下�?�?manager 兜底通知�?
- 非目标：git 远端拉取（无 remote）、定时自动更新、进程内热替换（重启 ~2-3s�?
  文档声明中断窗口）；dev 模式自举�?dist 为准
- agent 操作手册：`.opencode/skills/mafw-gateway-restart/SKILL.md`（七步流程）

### 5.17 持久 Python 内核（Prime Agent 同款 Jupyter kernel�?

�?agent 一个会话级持久 Python 环境（变�?导入/数据跨工具调用保持），Prime Agent
（`packages/coding-agent/src/core/kernel/`）同款架构：

```
opencode LLM                              Gateway�?000�?                 .venv-pykernel
  mafw_python { code } ──�?POST /api/python/execute ──�?KernelService ──ZeroMQ──�?ipykernel_launcher
    （ToolContext.sessionID 定位内核�?       ├─ session→kernel Map           ├─ 标准 Jupyter 协议 5.3
  mafw_python_restart    ──�?/restart        ├─ Mutex 串行队列（防并发踩踏�?  ├─ allow_stdin:false
                                             ├─ 崩溃检测→自动重启+提示        └─ matplotlib 附件（display_data�?
                                             └─ TTL 1h 闲置回收
```

要点�?
- **`gateway/src/python/kernel-service.ts`**：Jupyter wire 协议（ZeroMQ Dealer/Subscriber�?
  HMAC 签名�?jupyter_client �?`json.dumps` 分隔�?+ `ensure_ascii=False` 字节序列化）�?
  `execute` 收集 stdout/stderr/execute_result/display_data（matplotlib 图→base64 附件�?
  error{traceback}；输�?cap 65536 + `truncated` 标记；超时→control 通道 interrupt�?
  崩溃（exit 事件）→ 标记 dead �?下次调用自动重启并返�?`kernelRestarted: true`
- **Windows 陷阱**：`child.kill('SIGKILL')` 无效 �?`taskkill /F /T` 兜底；zeromq receive
  �?`Promise.race` 超时会留�?幽灵 receive"吞消�?�?同一时刻只挂一�?receive�?
  超时仅做检测（�?pending 才判死）；循环用 `socket === this.iopub/shell` 判断
  被替换（重启后旧循环静默退出）
- Python 环境：`.venv-pykernel`（专用，ipykernel/numpy/pandas/matplotlib），
  `MAFW_PYTHON_BIN` 可覆�?
- 安全：loopback-only；无沙箱（本机可信场景）；TTL 1h 回收 + 停机清理
- 引导：工具描述强化（数据分析/统计/多步计算 �?�?mafw_python 而非 bash python -c�?
  `bash-python-guide` hook 检测长 python 内联脚本注入温和提示（每会话一次）
- 测试：kernel 集成套件需 `--runInBand --forceExit`（真实内�?+ zeromq handle 残留�?

### 5.18 Agent 身份�?IdentityRegistry（v4.21.0�?

所�?MAFW agent 身份（manager / memory-curator + 未来内置）收敛到 gateway 持有�?
**`IdentityRegistry`**（`gateway/src/runtime/identity-registry.ts`�? 身份单一事实源：
`IdentitySpec { name, description, scope, systemPrompt, policy, nativePermissions?, nativeTools? }`
——`policy { deny, allowlist }` 用中立类别词汇（`file-edit`/`shell`/`subagent`/`web`/`readonly`�?
+ 工具名（`mafw_*` 前缀通配）；物化�?`toAgentDefinition(spec)` �?*同一 builder** 派生
（manager←`getManagerAgentDefinition`、curator←`buildMemoryCuratorDefinition`），原生产物零漂移�?

设计文档：`docs/superpowers/specs/2026-10-08-runtime-neutral-agent-identity-design.md`�?
调研：`docs/research/2026-10-08-agent-identity-injection-survey.md`�? runtime 身份注入机制）�?

**注入三车�?*�?
- **车道 1（默认·主通道）物�?+ 绑定**：启动遍历注册表 `agents.install(name, toAgentDefinition(spec))`
  �? 物化——opencode �?agent md / pi �?prompts+extension，零重写）；`IdentityState`
  （`gateway/src/runtime/identity-state.ts`）记 `(runtime, identity)` 物化状态；
  `withIdentityPrompt` 包装 `runtime.session.promptAsync/prompt`：绑�?已物�?�?注入 `agent` 参数�?
  注册表身份但未物�?�?剥离（防未知 agent 报错）；非注册表 agent（build/plan）原样透传�?
  compaction 免疫�?runtime 自身保证（Codex strip+重建 / Kimi 重渲�?/ dsh 重派生）�?
- **车道 2/3（前瞻·未实现�?*：无物化通道�?runtime �?injectSystem（认知面）或消息位追加�?

**绑定**：`registerInternalSession(sid, role, identity?)` 登记 session 级绑定（manager 全路�?+
worker `onSessionCreated` �?memory-curator）；用户经桌�?TUI 选身�?= 回合级绑�?
（`/api/session/:id/promptAsync` 路由登记，`turn.completed` 清除）；manager rotate 降级解绑�?
`injectManagerIdentity`（旧一次�?`[SYSTEM]` 消息�?*已删�?*——身份经车道 1 到达，修�?compaction 稀释�?

**网关策略�?*（`ApprovalPolicyService.evaluate` 身份维度�?*先于 internal blanket-deny**—�?
manager 本身�?internal 会话）：
- �?`policy.deny` 或（白名单存在且 �?allowlist）→ **auto-deny**（reason �?`identity policy (<name>)`�?
- �?allowlist 且会�?internal（gateway 驱动）→ **auto-approve**（无人值守�?
- �?allowlist 且会话用户驱�?�?落三档评估（用户在场，档位决定问/不问�?
- `applyApprovalPolicy`（`core/approval/hook.ts`）既有自动应答器**零改动生�?*（opencode+pi �?runtime�?
- `GET /api/agents` 合并输出：注册表身份（`source:'mafw'`）在�?+ runtime 原生（`source:'runtime'`）；**仅已物化身份可见**（未物化选了也会�?`withIdentityPrompt` 剥离，列出是 UX 谎言；被滤名字不占去重，runtime 同名条目�?`source:'runtime'` 落穿�?

**manager 权限（仍成立，经 registry 物化�?*：`edit` deny / `task.general` deny / bash 默认 allow /
38 �?`mafw_*` MCP 工具显式 allow（对齐内�?plan）；系统规则 `ensureManagerRules()`
（`gateway/src/core/manager/system-rule-templates.ts`）每次启动写 `~/.mafw/`。机制依据：
opencode `permission/index.ts` �?`disabled()`——仅 `edit/write/apply_patch` 映射 `edit` key�?
其余用工具名�?permission key。自更新影响：manager 不能 edit �?SKILL.md 要求自更新全流程�?bash�?

**runtime 插件职责**：实�?`agents.install` �?*物化�?*（把 AgentDefinition 渲染成自家格式：
agent md / config 指令�?/ patch）；物化成功�?gateway 自动走车�?1。见
`.opencode/skills/runtime-plugin-authoring/SKILL.md`�?

### 5.19 Runtime 能力契约（多 runtime 接缝�?

gateway �?agent runtime 之间�?*能力自声明契�?*（`gateway/src/runtime/`）：

- `contract.ts` �?`RuntimeCapabilities`（sessionApi/promptWhileBusy/eventStream/
  nativeApprovals/providerConfigApi/perLlmCallTransform/sessionStorageApi/agentConfigApi/
  agentProcessApi�?
  + `RuntimeClient` 接口�?+ `AgentRuntime`。能力分级：Tier 0（协作协�?+ per-turn 记忆�?
  �?Tier 1�? 自治执行 + per-step 记忆）→ Tier 2�? 桌面完整，opencode 形状 DTO 归一化输出）
- `RuntimeClient.tools`�?*Tier-0 必�?*，无能力位，spec `2026-10-15-runtime-tool-registration-contract-design.md`）：
  `registerTools(factory)`——gateway 激活期推送六件套 factory（spec+execute 单源
  `runtime/mafw-tools.ts`，execute 闭包�?spec 走，runtime 只做 plumbing：按会话
  factory(sessionId) 取注册项、parameters JSON Schema 翻译为自家类型系统、execute 透传）；
  `nativeTools()`——runtime 原生工具声明（name + TOOL_CLASS），激活期�?
  `tool-classes.ts` overlay�?*声明优先于并集表**，热切换整体替换，坏条目 warning 跳过�?
  生效，审�?`isReadOnlyTool`/身份 `resolveToolCategory`/事件 `enrichToolClass` 零改动受益�?
  缺实�?= `validate.ts` hard 拒绝 �?插件回退 opencode。out-of-process 通道�?
  `GET /api/tools`（spec 清单�? `POST /api/tools/execute {name, params, sessionID}`
  （loopback 门；执行自动合成两帧 tool part（running→completed/error，`toolpart_<uuid>`�?
  �?handleOpencodeEvent 同管线广播（enrich/trajectory/Mode A），spec 2026-10-20�?
  in-process opt-in 合成 = `wrapRegistrationsWithEvents`）。opencode 实现 = adapter ack no-op（六件套�?v1 插件承载 + MCP 自接线）�?
  pi 实现 = registry `setToolFactory` stash �?host extension `T.Unsafe(jsonSchema)` �?
  JSON Schema（`~unsafe` �?non-enumerable 不入 wire，spike 实证 typebox 1.3.7 +
  pi-ai openai-completions 原样透传�? execute 桥接（`{text,isError}` �?pi ToolResult）�?
  已知文档债：六件套描述文本在 v1 插件（`src/tools/`）与 gateway 单源两处暂存（v2 迁移统一�?
- `normalize.ts` �?runtime 原生事件 �?`EventFacets`（正交切面：step/chatSignal/
  broadcast/toolCommand）；opencode 版本知识（≥1.18 step-finish part 结算）只存在�?
  本文件（step facet �?BudgetGuard 回合计数�?
- `opencode-runtime.ts` �?内置恒等实现（全能力，`external` 跟随 MAFW_SERVER_SERVE_URL）；
  内含 opencode 专属实现：SQLite session 存储（`sessionStorageApi`）、auth.json 凭据
  （`credentials`）、agent frontmatter 序列化（`agents.install`�?
- `agent-definition.ts` �?运行时中立的 `AgentDefinition` 模型（description/mode/model/
  systemPrompt/permissions），�?runtime 翻译为自己的配置格式
- `loader.ts` �?`~/.mafw/runtime-plugins/*.js` 插件加载（CJS `module.exports =
  { name, capabilities, createRuntime(ctx) }`，fail-open，`POST /api/runtime/reload`
  可热重扫插件文件；能力声明覆盖在 Tier-0 基线之上；`RuntimePluginContext` 携带
  `projectDir?`/`gatewayPort?`�?026-09-16，pi 消费，config 兜底）；包贡献经
  `setPackageEntries()` 注入，查找顺�?legacy 文件 > �?> 内置�?

**可选能力与接口扩展�?*
- `external?: boolean` + `getBaseUrl(): string` �?runtime 声明托管模式；`external=true`
  �?gateway �?spawn/�?kill，watchdog 仅健康探�?+ 事件流重�?
- `credentials?: { getApiKey(provider): string | null }` �?凭据获取；media 服务优先�?
  runtime credentials，回退直读 auth.json
- `sessionStorageApi?: boolean` + `session.listByDirectory?(dir, limit)` �?直读 runtime
  私有存储列出会话；缺失时回退 `session.list` + 客户端目录过�?
- `agentConfigApi?: boolean` + `agents?: { install(name, definition); remove?(name) }` �?
  agent 定义安装；缺失时跳过 + warn 日志（manager 功能降级但不崩）
- `agentProcessApi?: boolean` + `agentProcess?: { restart() }` �?agent 进程生命周期管理�?
  opencode owned runtime �?true（kill+respawn serve sidecar）；external/pi �?false
- `completionApi?: boolean` + `completion?: { complete(req) }` �?无状态单次补全通道
  （index-scan �?media 无状态路径优先走契约，fail-open 回退直连 HTTP�?
  共享实现�?`runtime/completion-http.ts`）；`cacheable` �?prompt-cache 提示非承�?
  （直连传输映射为 DashScope `cache_control: ephemeral`，其�?runtime 可忽略）�?
  usage 由消费侧记账，runtime 只负责返�?
- `sessionBranchApi?: boolean` + `session.fork/revert/unrevert` �?会话分支原语（fork=新会话携带历史副本；  revert=消息级回退）。pi 不实�?unrevert（HTTP 404），�?pi revert 不回滚文件（SessionManager.branch
  原地�?leaf、不可逆——语义弱�?opencode，契约注释为准）；HTTP 薄代�?`routes/session-branch.ts`
  （能力门 503），SDK `session.fork/revert/unrevert`
- `diffApi?: boolean` + `session.diff` / `session.vcs.{diff,apply}` �?会话 diff 与工作区 patch 原语
  （切�?2；opencode v2 独有，pi 缺席即能力门 503）。HTTP 面：`GET /api/sessions/:id/diff?messageID=`
  �?`POST /api/sessions/:id/diff/revert`（body 传原 patch + hunkIndices，gateway `core/diff/hunk-patch.ts`
  纯函数反转选中 hunk �?`vcs.apply` 落工作区；校�?400 / apply 502 / 能力�?503）。registry dispatch
  （wave1-handlers `session.diff`/`session.revertDiff`），SDK `session.diff/revertDiff`；desktop 审阅面板
  `DiffReviewPanel`（composer �?按钮 + SessionTurn「审阅改动」双入口），SSE `session.diff` �?
  dispatcher diff handler 实时填充 `session_diff` store
- `turnBudgetApi?: boolean` + `SessionPromptOpts.maxTurns/maxCostUsd` �?回合预算；两个内�?runtime 均无
  原生强制，gateway �?`BudgetGuard`（`core/budget-guard.ts`）兜底：�?step 切面计数 + TrajectoryStore
  成本，超�?abort + noReply 通知；goal 会话�?`onSessionCreated` 挂载，预算读 goal state
  `policySnapshot.{maxTurns,maxCostUsd}`（缺省不启用�?
- `PromptResultEnvelope` �?`session.prompt()` 返回超集：`parts` + `finish/usage{input,output,cached,
  reasoning,costUsd}/error`（字段缺�?= undefined 非错误；opencode �?AssistantMessage.cost/tokens 映射�?
- EventFacets 新增 `compaction: 'start'|'end'|null` �?opencode `session.compacted` �?end；pi 经注入的
  `mafw-compaction` extension 上报 `session_before_compact`/`session_compact`（翻译为
  `session.compacting`/`session.compacted`）。gateway 收到后对该会话触�?turnCompress flush
  （`TurnPipeline.runSession`，fail-open，与 hourly cron 互斥�?
- `permissionReply(sessionID, requestId, 'once'|'always'|'reject', message?)` �?三值签名（P1 破坏性变更，
  �?boolean approved）；pi `'always'` = session 级动�?allowlist（运行时 push `policy.autoApprove`�?
  不落盘）；`/api/sessions/:id/permissions/:requestId` body 接受 `{reply, message?}` 兼容�?`{approved}`�?
  **切片 1 �?'always' 在两�?reply 路由都自动沉淀持久规则**（`persist` 参数 `'tool'|'prefix'|true` 控制
  粒度，缺�?true=prefix 优先自动推导；fail-open�?

#### 审批三档预设�?026-09-20，切�?1�?

`ApprovalPolicyService` mode �?manual/auto 二档升级为三档预设（spec `2026-09-20-desktop-ux-refactor-design.md` §3）：

- **三档语义**：`read-only`（只读工�?`isReadOnlyTool` 自动放行，任何变�?human）→ `auto`（安全命令免审�?
  危险正则 human�?5 次预算耗尽**回落 read-only** 并广播）�?`full-access`（一�?auto-approve，不计数�?
  内部会话 auto-deny 仍最高优先）
- **legacy 兼容**：kv 存量 `'manual'` �?`normalizeMode` 读归一�?`'read-only'`；`POST permission-mode`
  仍接�?`'manual'`；未知值一�?read-only（fail 保守�?
- **规则存储**：`~/.mafw/permission-rules.json`（`PermissionRulesStore`，条�?`{tool, pattern?, action:'allow'}`�?
  原子写、损�?fail-open 空表）；evaluate 双读 `rules.matches || allowlistStore.matches`（config.yaml
  `approval.allowlist` �?legacy 过渡）；pattern �?`*` = 前缀匹配（对 commandText �?patterns�?
- **规则沉淀**：`deriveAlwaysRule(found, scope)` 纯函数（scope true=prefix 优先/'tool'/'prefix'）；reply 路由
  always 分支 fail-open 写规则；`/api/approvals/rules` GET/POST/DELETE CRUD（契约已登记，SDK
  `permissions.listRules/addRule/removeRule`�?
- **三端**：desktop 🛡 按钮三档循环 + PermissionCard「记此前缀(P)/记此工具(T)」双按钮 +
  ApprovalsSection �?rules API；TUI `/permissions` 三档循环 + 状态栏 `permLabel`（`🛡 全开`�? overlay
  五项（once/always/persist/persist-tool/reject�?
- ~~pi 扩展内置 `autoApprove` 旁路~~�?*2026-10-08 已修**：pi tool_call 先经 `evaluatePermission` 同步直评，ask→政策环兜底，见 §5.19 mafw-host）；opencode 原生 agent permission 配置�?MAFW 层正交保�?
- `questionApi?: boolean` + `session.question.{list,reply,reject}` �?原生 question 通道（opencode v2 SDK
  `session.question.*` 直连；pi �?question API 不实现）；`/api/questions*` 能力门按
  `questionApi ?? nativeApprovals` 向后兼容
- `SessionPromptOpts.delivery/expectReply` �?busy 投递时机（pi 映射 `streamingBehavior`；opencode 忽略�?
  与免回复（opencode `noReply` 等价�?*pi 无原生等价——全路径降级为普通消�?+ 每会�?warn 一�?*）；
  `noReply` �?@deprecated（gateway 内部消费方已迁移，字段保留一个清理周期）
- `CompletionRequest.responseFormat` �?json_schema 约束输出（opencode 直连传输映射 OpenAI
  `response_format.json_schema`；pi 无顶层支持，fail-open 忽略�?
- session 媒体附件：file part（image/video/audio）一等载体语义（契约 `SessionPromptOpts.parts` 注释）；
  pi image �?`partsToPromptInput` �?ImageContent（既有）；pi video/audio �?`mafw-media` extension �?
  `before_provider_request` 注入小米 wire 格式（registry pendingMedia 队列，注入即清空�?
- Goal 预算面：`mafw_create_goal`/`mafw_set_goal` 接受 `budget.{maxTurns,maxCostUsd}` �?request.json �?
  policySnapshot（`core/goal-budget.ts` `mergeBudgetIntoSnapshot`，fail-open）→ BudgetGuard 硬停闭环
- 桌面 ChatView fork/revert：ChatPane �?`window.api.mafw.sessions.fork/revert/unrevert`（preload �?
  通用 IPC 派发 �?SDK）接 session-ui `SessionTurn` actions 位；revert 内联确认 + �?store 触发重拉
  （MafwShell 空消�?effect 自动 loadSessionHistory）；fork 成功 toast + `onOpenForkedSession`
  （openSessionTab）打开�?tab；unrevert �?session.revert 态显�?

激活插件：`config.yaml` �?`runtime.plugin: <name>`（或 `MAFW_RUNTIME_PLUGIN`）；
未配�?加载失败一律回退内置 opencode。可观测：`GET /api/runtime` 返回当前
runtime 能力�?+ 插件扫描状态。能力门：缺能力�?runtime 对应端点 503�?
事件订阅跳过，不崩溃�?

**会话目录契约�?026-10-20�?*：`SessionCreateOpts.directory`�?*必填、绝对路�?*）是会话工作目录的唯一权威来源�?
�?gateway 每次显式传入（内部会�?worker/media �?`MafwScheduler.resolvedProjectDir()` =
UI 当前项目 ?? config 项目根）；runtime 侧用 `requireSessionDir(opts.directory, ctx.projectDir)`
（缺则抛错，不静默兜底）。`ctx.projectDir` 降级�?*启动期信�?*（绝对化快照），仅兜底�?
死通道已清理（`sdkConfig.directory` / `OpencodeRuntimeConfig.directory` 0 读取）�?
依据：`docs/superpowers/specs/2026-10-20-session-directory-contract-design.md`

> **插件开发协助四件套�?026-09-18�?*：①未知事件遥测（`event-telemetry.ts`，已知集=EVENT_FLOW_MATRIX keys �?`plugin:`/`session.next.` 前缀族，全量启用；首次出�?warn + `GET /api/runtime` 暴露 `unknownEvents`；`POST /api/events` 扁平非命名空间发布同样采集）；②事件试衣�?`POST /api/runtime/dry-event`（normalize facets + 矩阵每跳处置 + 字段契约警告 `event-field-contract.ts`，纯函数�?deps）；③`ctx.events.make/check` 构造期助手（loader ctx，未�?type 构造点�?warn，fail-open）；④场景一致�?`POST /api/runtime/conformance` + `mafw plugin-test`（S1 chat-roundtrip 事件�?/ S2 session-lifecycle API 往返，`handleOpencodeEvent` �?per-session event tap 收集观测，驱动真实会话消�?LLM 往返）。评估器纯函数在 `conformance-scenarios.ts`�?

#### Runtime 热切换（无需重启�?

运行时切换有两种触发路径，均**不重�?gateway 进程**�?

| 触发方式 | 入口 | 流程 |
|----------|------|------|
| **HTTP API** | `POST /api/runtime/switch { plugin }` | 校验插件存在（未�?400 + available 列表）→ `config.persistOverrides` 持久化到 `~/.mafw/config.yaml` �?`createRuntime()` 重建 �?接线 client/consumers �?`resubscribeEvents` 重订阅事件流（AbortController 取消旧订阅，防孤儿迭代）�?dispose �?runtime |
| **Config hot-reload** | `config.yaml` 文件变更 watcher�?s 防抖�?| `config.reload()` 检�?`runtime` 段变�?�?自动执行同上 createRuntime + resubscribe 流程；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖 |

辅助端点�?
- `GET /api/runtime` �?当前 runtime name/capabilities + envOverride + 插件扫描状�?
- `POST /api/runtime/reload` �?重扫 `~/.mafw/runtime-plugins/*.js`（清 `require.cache` 后重�?require），不切换，仅刷新插件列�?

热切换安全约束：
- `server`/`paths` 配置段变更仍需重启（`config.reload()` 返回 `restartRequired`�?
- `apiToken` 变更即时生效，无需重启
- 插件 `createRuntime()` 抛异�?�?回退内置 opencode，不�?gateway
- �?runtime dispose �?`onSwitched` 回调统一处理（pi: registry 清空 + event stream 终止�?

宿主插件侧（runtime 进程内的 transform/工具注册）是每个 runtime 单独交付物，
不在本契约内；gateway �?HTTP�?api/obs/capture�?api/recall/context�?a2a�?
对宿主插件保�?runtime 中立�?

#### HostAdapter 认知面契约（2026-10-08，Phase 3 形式化）

编排面（RuntimeClient）管 gateway→runtime�?*认知面（HostAdapter）管宿主适配器→gateway**，协�?= loopback HTTP（宿主语言/进程无关），实现核心�?`gateway/src/runtime/host-adapter.ts`（`COGNITION_CONTRACT` 时序常量 + `createCognitionClient` + `createRecallCursor` + 工具 HTTP 核心）。四动词�?

| 动词 | 协议 | 时序/语义 |
|---|---|---|
| observe | POST /api/obs/capture | 5s fail-open；source �?user_input/assistant_reply/tool_result/reasoning |
| injectContext | GET /api/recall/context | **100ms fail-open**；游标增量（id 优先/count 回退�? 短增量（<50 字符）并�?assistant 尾部 300；注入物�?`synthetic:true` 部件标记防回�?|
| injectSystem | GET /api/recall/pinned + 静�?MEMORY_GUIDE | 150ms fail-open；追�?system 尾部 |
| tools | /api/memory/add�?api/python/*�?api/tts�?a2a | 六件套；add_memory �?HTTP �?serve worker �?MCP |

宿主实现：pi = `runtime/pi/pi-mafw-host-extension.ts`（薄事件映射，消�?host-adapter 核心）；v1 opencode 插件 = 原生实现同语义（**刻意不重�?*——生产宿主，v2 迁移时统一）；v2 = 待迁移（�?host-adapter 为核，spike 原型见调研文�?§8）�?*一致性验�?*：`POST /api/runtime/conformance {scenarios:["cognition-observe","cognition-inject"]}` —�?S3 验证 T1 三类观察行、S4 验证 recall 触达 + memory-guide 端到端到达模型（复述法，宿主无关）�?

**内置插件：pi-coding-agent runtime（`gateway/src/runtime/plugins/pi-runtime.ts`�?*
- `config.runtime.plugin: pi` 激活；进程�?SDK 嵌入（ESM �?`new Function('spec','return import(spec)')`�?
- 能力：sessionApi/promptWhileBusy/eventStream/nativeApprovals/providerConfigApi/sessionStorageApi/agentConfigApi true
- 认证链：`ctx.credentials.getApiKey` �?auth.json 回退 �?ModelRuntime.setRuntimeApiKey（单例共享）
- 会话：`PiSessionRegistry`（Map<sessionID, AgentSession>，忙�?followUp 队列�?
- 存储：`pi-session-storage.ts`（调�?pi SessionManager.list(cwd) 列出持久化会话，映射�?gateway SessionInfo 格式�?
- 事件：`PiEventStream`（subscribe �?RawRuntimeEvent �?normalize.ts 四信�?turn.completed/turn.failed/part.updated/message.updated；v2 词汇�?
- external=true：gateway �?spawn；外�?runtime 的事件订阅与 serveReady 解耦（不等 opencode serve�?
- 媒体 agent 消费 AgentRuntime（Phase 2，见 `docs/superpowers/specs/2026-08-27-pi-runtime-design.md`�?

**认知面宿主扩�?mafw-host�?026-10-08，Phase 2�?*：`runtime/pi/pi-mafw-host-extension.ts`，随会话 factory 注入（create/fork 双路径，`runtime.pluginConfig.pi.hostExtension !== false` 默认开）。四动词：observe（message_end user/assistant+thinking + tool_result �?loopback `/api/obs/capture`）、injectContext（context 事件，双模游�?id 优先/count 回退，短增量并入 assistant 尾部�?00ms fail-open，synthetic part 标记防回流）、injectSystem（before_agent_start 链式追加 `<memory-guide>` + pinned `<user-profile>`）、tools（六件套 registerTool，typebox �?ESM �?import `@earendil-works/pi-coding-agent/node_modules/typebox` 取同实例）。与 v1 插件完全同出口（loopback HTTP）——ACT-R 结算/FOK 采样/内部会话过滤零漂移�?*approval 旁路已修�?026-10-08�?*：静�?autoApprove 五件套删除，改为 `evaluatePermission`（ApprovalPolicyService.evaluate 同步直评，index.ts 三处 runtime 赋值点注入�? ask→政策环（applyApprovalPolicy）兜底；`ApprovalPolicy.autoApprove` 语义 = 会话动�?allowlist + config 显式预置�?

#### 事件映射注册�?026-10-08，v4.20.0�?

runtime 插件�?*纯数据表**把原生事件接�?canonical 管线，不再手写翻译层（spec：`docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md`）：

- **插件声明**（`module.exports`）：`eventSource { typePath, sessionIdPath?, directoryPath? }` + `eventMappings: [{ from, to, when?, fields? }]` + `transformEvent(raw)` 逃逸口�?
  - `from` = 原生类型（string|string[]）；`to` = canonical 类型�?`'drop'`；`when` 为纯数据条件（`{path, equals?|exists?}`，`typePath` 可指嵌套判别字段�?Claude `$.event.type`�?
  - `fields` 值三选一：`{path,default?}` / `{const}` / `{template}`（`'pi_step_{$.sessionID}'` 式插值，覆盖 ID 物化）；路径 = 裁剪 JSONPath 子集（点�?下标�?*�?eval**�?
  - **匹配优先级（B1 default-deny�?026-10-20 rev2�?*：eventMappings（数组序，含 drop 行与 `canonicalIdentity()` 词汇单源派生的恒等行）→ transformEvent（B2 守卫：try/catch + 输出形状校验）→ **拦截 + 计数**。canonical 直发分支已删除——同名收编词�?identity 行注册（恒等翻译也是翻译）；信封形态（pi 已翻译流）按 canonical 词汇判定放行/拦截；畸形（无可解析类型）透传给下游诊断。无声明 runtime = eventStream 加载期降�?
- **gateway �?*：`CANONICAL_FACET_RULES`（`runtime/canonical-facets.ts`）把 canonical type �?EventFacets 表化（原 `normalizeOpencodeEvent` if 链；`normalize-oracle.test.ts` 逐事件钉扎表驱动 �?v2 手写参照）；v2 �?`toolCommand` 升为规则行（tool part 快照载体），�?approval metadata 构造为执行器内置特�?
- **执行�?*：`runtime/path-expr.ts`（安全路径求值）+ `runtime/event-mapper.ts`（applyEventMappings / validateEventMappings / wrapGlobalEventStream / canonicalIdentity / hasEventDeclarations；`TranslationHooks { onUnmatched, onSuppressed, onTranslationError }`�?
- **加载期校�?*（`loader.ts`）：未知 canonical `to` / 坏路�?/ **声明 eventStream 却无翻译声明** �?插件 `eventStream` 能力降级 + error 状态（fail-open，仍注册；包贡献 runtime �?index.ts activatePluginRuntime 兜底降级�?
- **B2/B3 可观�?*：`GET /api/runtime` 暴露 `translationErrors`（transformEvent/normalizeMessages 守卫失败，限�?ERROR + 计数）与 `translationDrops`（per-type **unmatched**=未命中翻译【监控信号，turn 终态类每次 loud warn�?/ **suppressed**=drop 行或 transformEvent 显式 null【作者意图】）；conformance 断言 unmatched===0（升�?runtime 后跑一遍即抓词汇漂移）+ session-lifecycle 历史形状断言（`{info,parts[]}`�?
- **dry-event 试衣�?*：`POST /api/runtime/dry-event { plugin, event }` 输出 映射→facet→矩阵→字段契约 每跳（含 approval facet 回显 + 工具三原语的 assembler 跳回�?`assembled`�?
- **已迁�?*：pi（`PI_EVENT_MAPPINGS`，`translatePiEvent` �?switch 表化—�?*turn_end �?`part.messageID`，修�?BudgetGuard step facet �?pi 上从未触发的 bug**）；opencode 原生事件�?canonical（不包装）；~~词汇表沿�?opencode 形状~~�?*2026-10-12 v2 已反�?*，见下）
- **词汇 v2�?026-10-12，`docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md`�?*：canonical 词汇所有权�?MAFW——`turn.completed/failed/aborted` 三元组统一回合终态（�?session.idle/message.complete/message.error/message.aborted 五终态双�?+ Mode A 改写 hack 全部删除，广播统一 passthrough）；`message.part.*` �?`part.*`；`todo.updated` �?`plan.updated`；新�?`usage.updated`（gateway �?TrajectoryTurn tokens/cost 合成）与 permission.asked 载荷可�?`options[]`/`suggestedRule`；`session.next.*` 六条除名（唯一消费�?v1 宿主插件在进程内吃原生事件）；信�?`opencode_event` �?`mafw_event`（SDK 类型 `MafwEventEnvelope`）�?*强制翻译接线**：opencode �?`registerBuiltin` �?`OPENCODE_EVENT_MAPPINGS`（`runtime/opencode-events.ts`：差异行 + session.next.*/sync 显式 drop �?+ `canonicalIdentity('$.payload.properties')` 恒等行——transformEvent 已退役）接入，与文件插件同一注册接口；三分支（plugin/builtin/direct）共�?`wrapGlobalEventStream`（强制）�?`wrapToolPartAssembly` 序列�?*词汇单源**：SDK `events.ts`（客户端契约）↔ `runtime/mafw-vocabulary.ts`（gateway 常量 `MAFW`，交叉测�?`vocabulary-sync.test.ts` 钉扎）；三层守卫链不变（SDK union �?矩阵测试 �?desktop `assertShellEventCoverage`�? TUI 第四道弱守卫（KNOWN_EVENTS �?union，`tests/event-coverage.test.ts`）�?*toolCommand facet 载体迁移**：原 `session.next.tool.*`（`type.includes('tool')` 特例）→ `part.updated` + `part.type='tool'` 规则行（`$.part.state.input.command`），自更新调用者定位行为保持�?*eventBus 扁平发射注册表化**：`runtime/flat-emit-registry.ts`�?0 类型）替�?setupEventBus if 链；goal_node 已正式登�?SDK union/矩阵/穷尽守卫。oracle 重立�?v2 手写参照（`normalize-oracle.test.ts`）；replay 升级为全链路 golden（opencode raw �?翻译 �?normalize，`event-replay.test.ts`�?
- **工具身份 canonical 翻译层（A 切片�?026-10-20 rev2�?*：`runtime/tool-classes.ts` �?`TOOL_CANONICAL_TABLE`（形状兼容别名：command_execution/ls/find/file_change/collab_tool_call/web_search/todo_list/powershell �?opencode 名）+ `canonicalToolOf(name)` 解析链（overlay 声明 �?静态表 �?已是 opencode �?�?undefined 不硬猜）；`NativeToolDeclaration.canonical?` 声明�?overlay。enrich 双出口：live = `enrichToolIdentity`（handleOpencodeEvent 单点，补 `part.toolClass` + `part.canonicalTool` additive）；历史 = `enrichHistoryParts`（messages 路由出口，全 runtime）。消费面：session-ui 四级查找�?`原生�?> canonicalTool > CLASS_FAMILY[toolClass] > GenericTool`（`tool-canonical.ts`，注册表�?`tool-registry.ts` 轻依赖模块）+ read 域多 key（`filePath ?? path ?? file_path`�? 上下文组成员资格 canonical 感知；TUI chat-store �?trajectory collector 聚合键改 `canonicalTool ?? tool`（recap 不再按别名碎片化�?
- **工具 part 合帧�?026-10-12�?*：`runtime/tool-part-assembler.ts` �?`ToolPartAssembler`（per-session、callID 键控状态机）把「call/result 分离」runtime 的三原语（`tool.call`/`tool.delta`/`tool.result`�?*内部类型**：进 `CANONICAL_TYPE_SET` 校验但不进公开词汇�?矩阵、不广播）合帧为 opencode 形状 ToolPart 快照（part.id = `toolpart_<callID>`，live 与历史同 id 去重）。`wrapToolPartAssembly` �?`wrapGlobalEventStream` 之后接线（plugin + builtin 两分支；opencode 无三原语 �?恒等直通），`handleOpencodeEvent` 有三原语防漏底线。历史路径：契约可�?`session.normalizeMessages`（缺省恒等），gateway messages 路由�?`applyNormalizeMessages` 统一过；pi 实现 `runtime/pi/pi-message-normalize.ts`（ToolCall block + toolResult �?toolCallId 归并）——修复「pi 工具卡桌面从不渲�?+ 历史空」。spec：`docs/superpowers/specs/2026-10-12-tool-part-compat-design.md`

#### nativeApprovals 翻译层（pi runtime�?

pi runtime 声明 `nativeApprovals: true`，通过 MafwApprovalExtension 拦截 tool_call 事件�?

1. **ApprovalBridge**（`pi-approval-bridge.ts`）：每个 session 独立�?Promise map�? 分钟超时自动拒绝
2. **MafwApprovalExtension**（`pi-approval-extension.ts`）：pi extension，拦�?tool_call，发�?permission.asked/replied 事件
3. **事件翻译**（`pi-events.ts`）：`translatePiEvent` �?permission.asked/permission.replied 翻译�?opencode 形状，经 `normalizeOpencodeEvent` 归一化为 EventFacets
4. **HTTP API**：`POST /api/sessions/:sessionID/permissions/:requestId` 转发�?`runtime.session.permissionReply`
5. **配置**：`runtime.pluginConfig.pi.approvalPolicy` 自定�?autoApprove/autoDeny 列表

默认策略：read/grep/ls/find/glob 自动放行，其余需审批�?

#### 插件切换端点（runtime / media，桌�?Config 页「插�?Plugins」卡片）

- `GET /api/runtime` �?active runtime（name/capabilities/**envOverride**�? 插件扫描状态；`POST /api/runtime/switch { plugin }` �?**热切�?*（进程内重建 runtime，无需重启）：校验插件存在（未�?400 + available）→ `config.persistOverrides` 持久�?�?`createRuntime` 重建 �?接线 client/consumers �?**`resubscribeEvents` 重订阅事件流**（AbortController 取消旧订阅，防孤儿迭代）�?dispose �?runtime（pi �?registry + event stream）；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖；`POST /api/runtime/reload` 重扫插件文件
- `POST /api/media/switch { engine?, image?: {engine?}, video?: {engine?}, audio?: {engine?} }` �?校验引擎名（未知 400 + available；pi 恒可用）�?持久�?+ `mediaPluginLoader.reload()` **热生�?*；返�?`{ success, media: {engine, image, video, audio} }`
- `GET /api/model-config` / `POST /api/model-config` �?记忆 worker 模型 + 媒体每模态模型（`recall.workerModel`、`media.provider/model`、`media.{image,video,audio}`）：provider 列表来自 `GET /api/provider`（不可用 fail-open）；POST 严格校验（空字符�?清空回退，跳过校验）�?`config.persistOverrides` 落盘 �?�?recall 变更时置�?`scanService` 单例（TurnPipeline/ReflectionPipeline 每次新建本就热生效；媒体 per-request �?config 天然实时）；路由 `routes/model-config.ts`，deps 注入可单测；SDK `models` 命名空间 + 桌面 Config 页「模�?Models」卡�?
- `GET /api/memory/embedding-config` / `POST /api/memory/embedding-config` �?记忆嵌入引擎设置（provider/engine/model/threads + llamacpp.gpu/threads/contextSize）：POST 校验枚举 �?`persistOverrides` �?**热切�?*（kill �?llama-server sidecar �?重建 EmbeddingRuntime �?后台 backfill）；写路�?`onMemoryWritten` 监听已改为懒解析 `getEmbeddingRuntime()`，热换不�?stale provider�?*路由必须注册�?`/api/memory/*` dashboard 兜底委托（index.ts ~2970 行）之前**。向量文件按 provider.name 打标签，gpu 变体间共享（同模型嵌入空间一致）；路�?`routes/embedding-config.ts`；SDK `embedding` 命名空间 + 桌面 Config 页「Memory」区�?
- 切换逻辑�?`gateway/src/routes/{runtime-switch,media-switch,model-config,embedding-config}.ts`（deps 注入，可单测），index.ts 仅薄接线
- 桌面 Config 页：Runtime 下拉（`SelectV2`，选择�?`confirm()` 二次确认 �?switch �?toast；`envOverride` 显示警告条）+ Media 每模态下拉（热生效）+ 模型 Models 卡片（级联双 `SelectV2`，provider 变更时重�?model 下拉并过滤）；SDK `MafwClient.runtime/media/models` 命名空间 + preload 对应方法

### 5.20 Goal 编排 RSI �?Phase 1 观测�?

**数据模型**（gateway.db）：
- `goal_outcomes`：每�?goal 归档时写一行（verdict、轮数、成本、thumbs、policy_version、failure_kind/signature�?
- `goal_sessions`：goal 生命周期内所�?session 的追加映射（豁免 trajectory prune——保留期 `trajectory.retentionDays`，默�?365 天，0=永久�?
- `evolution_proposals`：演化提议表（Phase 2 使用，Phase 1 仅建表）

**写入点：**
- 三个 session 创建节点（plan/execute/review）调�?`onSessionCreated` 追加 goal_sessions
- archiveGoal 成功后调�?`recordGoalOutcome` 聚合 trajectory + feedback 写入 outcome
- ABORT（HTTP + control file）调�?archiveGoal(verdict='CANCELLED')
- onGoalCreated �?`policySnapshot` 写入 state.json

**查询�?*
- `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=`

**组件注册表：**
- `gateway/src/orchestration/registry.ts` 声明可演化组件（Phase 1 只读�?
- `gateway/src/orchestration/policy.ts` �?`~/.mafw/orchestration/active.json` 回退 builtin-v1

### 5.21 语音管道（Voice Pipeline�?026-09-17 重构�?

**Desktop 核心（`packages/desktop/src/renderer/mafw/voice/`，UI 无关�?TS�?*�?
- **VadAnalyzer**（`silero.ts`）：Silero VAD v5 单实�?+ �?getUserMedia 流（echoCancellation/noiseSuppression/autoGainControl），事件 hub 多播 `speech_started/speech_stopped/misfire`——不再有 monitor/recording 模式切换；参�?`media.tts.vad.*`（confidence 0.5/stopSecs 1.2/minSpeechMs 500）可配，fail-open 默认值；`?url` 资产导入�?typeof 守卫（node --test �?test-shim loader 可导入）
- **TurnStopStrategy**（`turn.ts`）：轮次边界�?VAD 分层（Pipecat 模式）；v1 `SilenceTimeoutStrategy` 直通（静音宽限已由 Silero redemptionMs 在引擎内），未来语义 turn detector 挂此接口
- **AudioWorkletPlayer**（`worklet-player.ts` + `public/voice/pcm-worklet.js`）：环形缓冲流式 PCM 播放，起步缓�?200ms 抗抖动，`flush()` = 清缓冲即时静音（barge-in），`playCursorMs` 播放游标（v1 仅日志）；采样率�?SSE `x-tts-sample-rate` 响应头（不再硬编�?24kHz）；**�?BufferSource 回退**（Electron Chromium 必有 AudioWorklet，显式报错）
- **VoiceSession**（`session.ts`）：桌面语音唯一入口，显式状态机 `idle|recording|speaking|interrupted`；VAD 信号按状态路由（recording→分�? speaking→barge-in）；barge-in = flush + `POST /api/tts/interrupt`（fire-and-forget�? 状�?interrupted；`speakFromTool` djb2 hash TTL 去重（与 gateway media-speak 工具同实现）；`playUrl` artifact 短播放也走会话（互斥/barge-in 一致）；`speak` 流式失败回退整段 wav（barge-in abort 不回退）；ChatPane 只留绑定层（事件→UI 信号、segment→upload helper�?

**Gateway TTS 插件化（`gateway/src/tts/`�?*�?
- **TtsEngine** 接口：`capabilities { streaming: 'native'|'none', voiceCloning, styleControl, languages, sampleRate }` + `synthesizeStream �?AsyncIterable<PcmChunk>`（采样率随块走，不强�?24k�? `synthesize �?wav Buffer`（兜底）+ `TtsOpts { voice/style/speed/lang/refAudio? }`（refAudio 克隆预留�?
- **TtsEngineRegistry**：优先级 �?> legacy（`~/.mafw/tts-plugins/*.js`�? 内置；未知名 fail-open 回退 mimo + warn
- **内置引擎**：`mimo`（MiMo-V2.5-TTS 云，native 流式，默认）；`kokoro`（kokoro-js 进程�?ONNX，Apache 2.0 含权重，optional dependency 不强装，模型 ~90MB 按需下载�?`~/.mafw/models/kokoro/`，`streaming:'none'`，ESM �?`new Function('spec','return import(spec)')`，加载失�?promise 缓存复位可重试）
- **句切分适配�?*（`sentence-adapter.ts`）：`streaming:'none'` 引擎按句 synthesize 立即 yield，统一流式语义（中英标点切�?+ 100 字符硬切�?
- **插件接口**（legacy 形态）：`module.exports = { name, capabilities?, voices(), synthesize(text,opts,ctx)→wav Buffer, synthesizeStream? }`；统一插件包新�?`tts` 贡献类型（`TtsContributionSpec`，PluginHost bindTts 原子推送）
- **打断传播**：`POST /api/tts/interrupt { sessionId }` �?abort �?session 全部在途合成（`ttsInflight` Map 登记，stream 路由 close 时清理）；`/api/tts/stream` body 新增可�?`sessionId`，响应头�?`x-tts-sample-rate`
- **许可红线**（内置只从安全档选）：ChatTTS/F5-TTS/Fish S2（非商用/研究许可）、IndexTTS（商用需授权）、edge-tts（微�?ToS）、Piper（GPL�?*不内�?*，仅可作用户自装插件；CosyVoice/GPT-SoVITS 等经 tts-plugins 接入
- 测试：gateway jest 27 �?TTS 单测（registry/adapter/mimo/interrupt/loader/kokoro）；desktop 12 �?voice 单测（turn/silero hub/pcm-align/session 状态机�?

### 5.22 Goal 编排 P1：NodeDriver + 节点�?Trace�?026-10-08�?

goal 编排从「装配完成未接线」正式启用：**langgraph 三件套（graph/checkpointer/interrupt/Command-resume）退�?*，换�?state 文件 + 事件驱动�?`NodeDriver`（`gateway/src/core/goal/`）。spec `docs/superpowers/specs/2026-10-08-goal-orchestration-p1-design.md`；plan `docs/superpowers/plans/2026-10-08-goal-orchestration-p1.md`�?

- **NodeDriver**（`driver.ts`）：�?goal 一个互斥状态机实例。`advance(goalId)` �?state v3 �?`routing.ts` 纯函数定下一节点（从 `graph.ts:4-15` 逐字移植）→ 建会话（`agent: 'mafw-'+node` 绑定身份）→ `void promptAsync`�?*�?await**——pi �?promptAsync �?idle 会话阻塞到回合结束，pi-session.ts:117-120）→ 注册 per-session 完成监听 �?`writeGoalState(nodeSession)`。完成由 `handleOpencodeEvent` �?idle/error 分支分发（`goalDriver?.onSessionIdle/onSessionError`）�?
- **双门完成判定**：`turn.completed` + 产物文件（`node-prompts.ts:nodeArtifactPaths`：waves.json / `receipts/{goalId}/loop-{N}-receipt.json`（per-loop 不再覆盖�? `reviews/{goalId}-loop{N}.md`）存在且可解析；缺失/非法 �?`failNode`（artifact_missing/artifact_invalid）→ archive_fail�?
- **三节点身�?*：`IdentityRegistry` 内置 `mafw-plan`（deny file-edit/shell/web�? `mafw-execute`（全开�? `mafw-review`（deny file-edit/web，allowlist �?shell）——复�?v4.21.0 物化车道，替换旧 `/skill mafw-*` 裸文本�?
- **W4 goal 级先验（2026-10-08�?*：plan 节点 prompt 注入 L1 能力账本 + L2 失败谱（`capabilityPriorBlock`，`DriverDeps.capabilityPrior` �?`NodePromptCtx.priorBlock`）——规划时看到同类任务历史 PASS �?均轮数与反复失败模式，主动规避。闭环：L1/L2（Plan 2）产�?�?W4 消费�?
- **state v3**（`state-v3.ts`，NodeDriver 唯一写入方）：`round` 为规范名 + `loop` 双写别名（旧读方兼容）；新增 `nodeSession`/`nextNode`/`nextAction`。原子写�?tmp+rename）�?
- **starter**（`index.ts:startGoal` + `starter.ts:resolveGoalDir`）：`goal_created` 事件 �?定位目标项目（hint > request 文件扫描 > 首项目）�?`ensureGoalState` �?advance。`mafw_set_goal`/`mafw_create_goal` 接受 `projectDir`（已注册校验，MCP services 注入 `listProjects`），写入目标项目 `.mafw`（修目录错配）�?
- **askUser state 驱动**：`executeAskUser` �?`QuestionLedger` asked（修「asked 无写入点 �?respond �?404」断链）+ state.pendingQuestion；`handleAnswer/handleCancel` �?state.userResponse/nextNode �?advance；respond 路由改调 driver（不�?Command-resume）。manager 可经 `mafw_list_pending_questions`/`mafw_answer_question` 自治代答�?
- **Trace 数据�?*：`goal_node_runs` 表（gateway.db：goal_id/loop/node/attempt/session_id/status/started_at/finished_at/outcome/error/tokens/cost；watchdog 重试 = 新行�?attempt 保留失败历史）；`goal_node` SSE 事件（扁平顶层广播：`{type,goalId,projectDir,loop,node,transition,at,durationMs?,verdict?,error?,attempt}`）；`phase_transition` payload 签名不变（milestone-push 零迁移）�?
- **恢复/watchdog**（`recovery.ts` + `driver.examineStaleNode`）：启动 `recoverGoals` + 周期 `watchdogScan`（挂 startBackupPolling）。语义：**产物优先**（gateway 死亡期间完成的节点直接兑现）�?会话探测（`session.get`，能力门 sessionStorageApi）→ abort + 重试 attempt+1（≥maxAttempts �?archive_fail）�?
- **API**：`GET /api/goals/:id/timeline`（node_runs �?state 聚合，须�?dashboard 兜底前）、`POST /api/goals/:id/nodes/:runId/retry`（execute 需 `confirm:true` destructive 门）；SDK `goals.timeline/retryNode`�?
- **legacy 并存**：`core/skills/mafw-*/entry.ts` + 插件 `/goal` 命令链保留（`state_change` 唤醒�?driver.advance 幂等）；死代码标�?deprecated（`chat/graph-runner.ts`/`core/mcp/tools.ts`/`poll.ts`/`core/plugin.ts`，物理删除留后续 PR）�?
- 测试：gateway 新增 14 文件 / 65 用例（routing/state-v3/node-runs/identities/node-prompts/driver/completion/askuser/starter/projectdir/recovery/timeline-route/retry-route/e2e）；全量 258 套件 1738 用例绿�?

**P2 前端节点泳道图（2026-10-09，仅 Desktop�?*：Goal 详情 `GoalDetailOverlay` 从「charter + 会话列表」升级为**节点级执行可视化**——泳道（�?plan/execute/review，列=loop�? 点格子内联明细（起止/耗时/token/成本/verdict/错误/产物 chips/打开会话/重跑）�?

- **纯逻辑** `packages/desktop/src/renderer/mafw/goal-timeline.ts`：`buildGoalLanes(nodes, maxRounds)`（行×列矩�?+ 每格 attempts 归并）、`cellTone`（review verdict 覆盖）、`formatDuration`、`cellSummary`、`artifactRef`（per-loop 相对路径引用）——单�?
- **组件** `GoalTimelineLane.tsx`（props 驱动，泳道网�?+ 内联展开）→ `GoalDetailOverlay.tsx` �?`window.api.mafw.goals.timeline/retryNode`；会话下钻经 `onOpenSession(sessionId)`（节�?run 自带 sessionId�?
- **实时**：dispatcher 顶层消费 `goal_node`/`goal_created`/`phase_transition` �?`CoreDeps.onGoalEvent` �?模块单例 `goals-rev.ts` �?`goalsRev` signal bump；GoalDetailOverlay/Dashboard 依赖�?signal 重拉，保�?15s 轮询兜底（`goal_node` �?sessionID，必须在 sid 分发前消费，否则 missTrace 刷屏�?
- **preload** `mafw-api.ts`/`mafw-types.ts` goals 段补 `timeline`/`retryNode`（SDK P1 已有方法 + `GoalTimeline` 类型�?
- **产物**：桌面无 mafwDir，产物以相对路径 chips 展示、点击复制（OS 打开留后续）
- 测试：desktop `npm test`（node --test + test-shim�?64 用例全绿（goal-timeline 10 + dispatcher 增量 2）；`electron-vite build` 成功。手工冒烟（真实 goal 观察泳道实时变化）留�?GUI 环境

### 5.23 脑启发记忆演化第二批�?026-10-09�?

计划：`docs/superpowers/plans/2026-10-09-remaining-roadmap-all.md`（D3 独立计划�?`2026-10-09-d3-laya-three-way-gate.md`）。全部后台管线统一形态：纯函数核�?+ cron 接线 + `PipelineBudget` 门控 + heartbeat 记录 + observe-first�?

- **D2 检索即重写**：`recall/reconsolidate-pipeline.ts`（`selectNewerRelated` 纯函�?+ `ReconsolidatePipeline.runOnce`）——被检索进�?24h labile 窗口（`recall/reconsolidation.ts` �?mark）的记忆，每�?`memory:reconsolidate`（cron `30 4 * * *`）用更新的同 cue 记忆对照，worker �?keep/rewrite；rewrite �?supersedes 链写新条目。每 id 每趟 consume 一次（无重试风暴）；budget 门�?
- **D4a 做梦预取**：`recall/dream-prefetch.ts`（`selectDreamSessions`/`parseDreamQueries`�? 每晚 `memory:dream`（cron `0 2 * * *`）对�?24h 活跃会话生成 �? �?下次可能�?，存 kv `dream-queries`；`/api/obs/capture` �?user_input 分支一次性消�?�?`scanService.prefetch` 预建快照�?
- **A2 草稿-验证并行**：turnCompress prompt 放开 �? �?`tentative` 锚草稿（`capTentativeEnergy` �?`/api/memory/add` 写前封顶 energy 0.35）；reflection（`collectTentative`/`applyTentativeVerdicts`）每日提升（�?tentative + energy 0.7 + `verified:` 锚）或否决（energy 0.05 + `rejected` 锚）。快系统产草稿、慢系统验证�?
- **A1 阶梯补顶**：`memory/axiom-distill.ts`（`selectAxiomSources`/`parseAxiomCandidates`�? �?`memory:axiomDistill`（cron `0 6 * * 0`）把�?need semantic insights 蒸馏为公理候�?�?triage 草稿（`summary.axiomDraft`）→ confirm 分支逐条�?`L5Store.addHeuristic` 提交（不�?goal）�?
- **L3 知识边界**：FOK 样本（`recall/fok-samples.ts`）inj 形加 `topic`�? top-1 记忆首个 cue_anchor；快照构建后�?`appendFokEvent` �?`fok-samples.jsonl`）；`fitFokThresholdsByTopic`（`recall/fok-gate.ts`）按主题拟合、样本不�?不可分则并入 global，消�?`byTopic[topic] ?? global`�?
- **P1.5 审批决策判定**：`core/approval/decision-log.ts` �?`~/.mafw/logs/approval-decisions.jsonl`（`eval`/`reply` 两形，按 requestId join）——`hook.ts` �?verdict，两�?reply 路由�?human 回复�?*模型选型后置**（当�?laya 为冲突专�?checkpoint，命令破坏性分�?off-label）�?
- **G2 写相路由冗余门（2026-10-09�?*：route-write 中间带插 laya redundant 问题（`askPair` 双问题同调用）——pRedundant≥tauRedundantHigh �?沉底（energy 0.05 + `redundant:<id>` 锚，�?BM25 捞回�? 覆盖条目 actrBonus 强化（重�?Hebbian 加强旧痕迹），跳�?LLM judge；consolidation �?`redundant:` 锚条�?skip（`redundant-sink`）。observe-first：tauRedundantHigh 默认 1.0，校�?`proposeTauRedundantHigh`（保守方向：阈值以上不许有 update verdict�? 用户批准开闸。spec `docs/superpowers/specs/2026-10-09-laya-write-routing-design.md`�?
- **G5/G3 蒸馏安全�?026-10-09，`64f24164`�?*：REFLECT_SYSTEM 加「防过度泛化（scope 限定观察语境�? 保语气证据等级」约束，TENTATIVE_SYSTEM �?tentative 措辞，AXIOM_SYSTEM 禁扩 scope——OEP/SAVOR �?Manufactured Confidence 的写侧修复，�?schema 变更�?
- **G1 权威标签�?026-10-09，`2bf5ea6f`�?*：`HarmonicUnit.authority`（`user|agent|tool|pipeline`，缺�?legacy �?pipeline 最低处理；AuthMem-Bench 权威坍缩修复）。写路径：HTTP/MCP add 接受+校验（默�?agent）、reflection 固定 pipeline、merge 权威只升不降（`higherAuthority`）。消费面：`<agent-priors>` 徽标 + pipeline ×0.7 软惩罚、pinned �?user �?`[待确认]`、skill 物化 G6 闸门（pipeline �?verified 不物化）、axiom 草稿�?`authorityFloor`。spec `docs/superpowers/specs/2026-10-09-g1-authority-preservation-design.md`�?
- **G4 检索仲裁（MARTA�?026-10-09，`1ad3b2cb`�?*：`recall/parametric-arbiter.ts` 纯函数——实体包含度�?0s 缓存�? 自指正则 + FOK zone �?三态；v1 **annotate-only 永不硬跳**（注入块头部加提示），observe-first �?`~/.mafw/logs/arbiter-samples.jsonl`；`search.arbiter` 默认 on。spec `docs/superpowers/specs/2026-10-09-g4-retrieval-arbiter-design.md`�?
- **D5 PPR 增强 + CATD�?026-10-09�?*：检索层 `searchScored` �?association PPR（`graph/diffusion.ts`）增 **Hebbian need 调制**（`diffusion.needModulation` 默认 on——转移权�?×(1+ln(1+need7d))，被检索过的通路更易再走�? **Macro-Hub 抑制**（`diffusion.hubFloor` 默认 50——入�?÷(1+ln(deg/floor))，hub 是通路非终点）。能量衰减增 **CATD**（`abstraction-level.ts:catdDecayRate` + `AnchorGraphStore.weightedDegree`；`decay.catd` 默认 on，�?0.5——承重条目半衰期随拓扑负载延长，孤立条目不变）。spec `docs/superpowers/specs/2026-10-09-d5-ppr-catd-design.md`（测量门 LongMemEval multi-session 0.375→≥0.55 待跑）�?
- **D4b 反事实模拟（2026-10-09�?*：goal �?**taskType 维度**（`TASK_TYPES` 七值枚举；创建时声明（`mafw_create_goal`/`mafw_set_goal` 参数）→ plan 节点 `waves.taskType` 回写**优先**（规划者判断更准，`completeNode` 校验回写 state v3）；`goal_outcomes` �?`task_type` 列（幂等 ALTER，legacy NULL �?other 池））。L1 账本�?`byTaskType` 聚合 + `ledgerForTaskType`（同类型 �? 样本才分桶，小样本退全局防外推）。plan prompt 注入 **`counterfactualBlock` pre-mortem**（同类任务失败率/最常见 failure_kind/平均损失 + L2 踩坑对照 + �?wave `riskNote` 要求——要求本身不依赖历史数据）。`DriverDeps.capabilityPrior` 签名�?`(goalId)`，新�?`counterfactualPrior`。spec `docs/superpowers/specs/2026-10-09-d4b-counterfactual-design.md`�?
- **A5 抽象写回 schema�?026-10-09�?*：`HarmonicUnit.distilled_by`（gist 指针数组�?*�?supersede**——成员保留可检索，�?gist 共享成员；与 D1b 降能同趟共存）。写入：reflection 蒸馏成功 �?`HarmonicUnitFileStore.stampDistilled(episodeIds, gistId)`�?*直写 OKF 镜像 setSticky 模式，不�?store.write �?MinHash 自合�?*；追加去�?cap 3，fail-open）。读出：边界 recall 指针行尾 `�?gist 已蒸馏：<id �?6>` 提示（get_memory 按需取，不占预算）；`RecallMemory`/`MemoryUnit` 透传字段。consolidation merge �?stamp（`merged_from` 等价）。spec `docs/superpowers/specs/2026-10-09-a5-schema-writeback-design.md`�?

## 6. Gateway 运维

### 6.1 CLI 命令
Gateway 唯一运维入口�?`mafw` CLI，用 `npm install -g` 全局安装�?`npx mafw` 使用�?

```bash
# 进程管理
mafw status            # 查看运行状�?
mafw start             # 前台启动
mafw daemon            # 后台启动
mafw stop              # 停止
mafw restart           # 重启前台（stop + 1s + start�?
mafw restart-agent     # 重启 agent serve sidecar（POST /api/runtime/restart-agent；external/进程�?runtime 返回 503�?

# 日志和诊�?
mafw logs              # 看最�?50 �?
mafw health            # HTTP 健康检�?
mafw stats             # gateway 统计

# 项目/Goal 管理
mafw projects          # 已注册项�?
mafw goals             # 活跃 Goal
mafw register <dir>    # 注册项目

# 其他
mafw config            # 当前配置
mafw dashboard         # 打开 Web Dashboard
mafw version           # 版本�?
```

### 6.2 日志路径
Gateway �?console.log/warn/error 自动写入文件�?
- `~/.mafw/logs/mafw.log` �?文件日志（daemon 模式下也用这个）
- 5MB 自动轮转，格�?`[ISO时间] [LEVEL] 消息`
- Error 对象在日志中需要用 `err.message` 而非 `err`（JSON.stringify Error �?{}�?

### 6.3 重启注意事项
- Restart 前会自动 kill 旧进程（基于 PID 文件�?
- 如果旧进程是�?CLI 启动的，�?`mafw stop` �?`mafw start`

### 6.4 构建、安装与发布

```bash
npm run build                 # 构建 plugin + gateway + @mafw/sdk + tui（sdk 必须先于 tui——tui esbuild 依赖 @mafw/sdk/dist�?
npm pack                      # 打包�?.tgz（jack200714-mafw-<version>.tgz�?
npm install -g @jack200714/mafw    # 全局安装（bin 命令�?mafw�?
mafw version                  # 验证安装
```

发布后用户只需 `npm install -g @jack200714/mafw` 即可使用 `mafw` CLI（包名变迁：`opencode-plugin-mafw` �?`mafw`�?026-09-15）→ `@jack200714/mafw`�?026-09-15，因 npm typosquatting 相似度规则拦截无 scope 短名，scoped 包豁免；bin 命令始终�?`mafw`）。旧名均从未发布�?npm，零迁移）�?

**完整重装流程（清�?+ 构建 + 安装）：**
```bash
npm run build
npm pack
npm install -g jack200714-mafw-*.tgz     # 覆盖旧版本（Windows cmd 下通配符不展开，需显式文件名）
```

**注意事项�?*
- `prepare` �?fail-open 守卫�?026-09-14）：gateway devDeps（gateway/node_modules/typescript）缺席时跳过 build——干净 `npm ci` �?postinstall 只装 gateway prod deps，若此时强行 build 会静默借用 root �?TS 5.6.3 �?gateway（module:nodenext �?ESM 导入全报 TS1479；TS 5.8+ 才有 require(esm) 宽容）。CI/publish 流程�?build 由显式步骤在 gateway `npm ci` 之后执行
- 全局安装路径可通过 `npm config get prefix` 查看
- 安装�?`mafw` 命令�?PATH 中，如果 shell 找不到请刷新 PATH（新开终端或重�?shell�?
- `.npm-global` 路径下的文件名为 `mafw`（无后缀）、`mafw.cmd`、`mafw.ps1`，对应不�?shell

Desktop 构建：根 `npm install` �?`cd packages/desktop && npx electron-vite build`（`@mafw/sdk` �?workspaces 解析�?`packages/gateway-sdk/`）�?

### 6.5 HTTP 路由注意事项
Gateway API 路由使用正则匹配，query string 会导�?`$` 锚定不匹配：
- 正确：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)`
- 错误：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages$/)`（不匹配 `?limit=100`�?

### 6.6 GitHub Actions CI�?026-09-14�?

三个独立 workflow（`.github/workflows/`）：
- `ci.yml`：push(main)/PR �?�?OS（ubuntu/windows）�?Node 22 验证——root+gateway 两段 `npm ci`、root build、gateway jest、TUI node --test、gateway-sdk / session-ui / ui / desktop 四包 node --test�?026-10-21 起，�?`@mafw/test-shim`）；concurrency �?ref 取消旧跑
- `desktop-release.yml`：tag `v*` �?Win(nsis)+Linux(AppImage/deb/rpm) 打包（node stage-gateway + electron-builder `--publish never`，`OPENCODE_CHANNEL=prod` �?env 块）�?release job 汇总挂 **draft release**（softprops）；workflow_dispatch = 构建-only 干跑；electron 缓存�?OS 分路�?
- `npm-publish.yml`：仅手动 dispatch；`NPM_TOKEN` 缺失时绿 skip，配置后 `npm publish --provenance`

注意：desktop `electron-builder.config.ts` �?`native/` extraResource �?`existsSync` 守卫（仓库不携带该目录）；desktop `npm test` = node --test + `@mafw/test-shim`�?026-10-21 �?bun 迁移），已入 CI（root `npm run test:desktop`）；已知坏的 legacy launcher 用例已随迁移移除�?

## 7. LongMemEval 记忆基准（evaluation/longmemeval/�?

基于 LongMemEval (arXiv:2410.10813, ICLR 2025) S 集（500 题，6 类，~50 haystack sessions/题）的谐波记忆质量评测。TS runner 直接 import gateway 类，`fs.mkdtempSync` 隔离 HarmonicUnitFileStore�?*不污�?*真实 `~/.mafw`，不需启动 gateway 实例�?

**两层**�?
- **L1 检索层**：`ingest` 灌入 �?`HarmonicIndexManager.search(question, k)` �?`recall@k / ndcg@k`（per-session �?`answer_session_ids`�?
- **L2 阅读�?*：L1 top-k 记忆 + reader LLM �?judge LLM（per-type prompt�?/1�?

**关键发现（baseline�?8 题子集，session 粒度，frozen energy�?*�?
- Phase 2：总体 R@10 = 47.4% �?**94.9%**（bm25 检索器）；R@5 = 28.1% �?93.2%；R@1 = 5.8% �?**58.6%**
- **session 粒度优于 round**�?.474 vs 0.277�?
- L2 QA accuracy：token+openrouter 基线 16.7% �?bm25+mimo-v2.5(xiaomi) **58.3%**；Phase Q 加来源标�?排序 ablation 后进一步到 **64.6% (date order) / 66.7% (rank order)**
- multi-session / preference 仍是短板�?.375），需 Phase M 语义�?
- 生产默认检索器已切�?**bm25**（Phase R），`token` 仍可通过 `MAFW_SEARCH_RETRIEVER=token` 回退

**设计决定（README 也写了）**�?
- 能量默认冻结 0.8（保可复现），`realistic` 模式�?`question_date` 为基准算 0.005/天衰�?
- 摄入�?haystack 全文�?`primary_abstraction`，对�?检索器只看 primary_abstraction + cue_anchors" 的事�?
- judge prompts 是近似移植（GitHub / HF 直连不通，未拉取官方版），下次获取官方 prompts 请替�?`evaluation/longmemeval/src/judge-prompts.ts`

**运行**（详�?`evaluation/README.md`）：
```bash
# 数据下载（需 hf-mirror.com 可访问）
curl -L -o evaluation/longmemeval/data/longmemeval_s.json \
  https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

# L1 检索层
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session

# L2 阅读层（reader + judge�?
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l2-qa.ts \
  --l1Run evaluation/longmemeval/results/<ts>/l1-run.jsonl \
  --reader meta-llama/llama-3.1-8b-instruct \
  --judge meta-llama/llama-3.1-70b-instruct \
  --apiUrl https://openrouter.ai/api/v1/chat/completions \
  --apiKeyProvider openrouter
```

## 8. Usage Provider Plugin System

### 8.1 架构概述

所�?8 个内置适配器已重构�?JS 插件（commit c2faeef4），采用双目录加载机制：
- **内置插件**：`dist/usage/builtin-plugins/`（随包分发）
- **用户插件**：`~/.mafw/usage-plugins/`（用户同名文件覆盖内置）

Gateway 仅提�?PluginLoader + ctx + UsagePoller；UI 保持通用�?

### 8.2 插件类型

| 类型 | 适配�?| 窗口类型 |
|------|--------|----------|
| `api` | deepseek, kimi, openrouter, siliconflow-cn | balance（余�?限额）|
| `token-plan` | opencode-go, zhipuai-coding-plan, kimi-for-coding, commandcode | 5h / 7d / month |

**内置插件 `gateway`（蓝区统一网关�?*：credit 总量 + day/7d/month 滚动窗口；限额经 Config 页插件参数表单手配（`usage.pluginConfig.gateway: { credit, day, week, month, baseURL? }`），消�?= 本地 trajectory tokens × `GET {baseURL}/models` �?per-model credit 价格�?min 缓存）。注意：`usage.budgets.gateway > 0` 仅在插件结果为纯 balance 窗口时才折叠（含 day/7d/month 窗口时跳过并 warn）�?

### 8.3 插件接口

```javascript
module.exports = {
  name: 'my-provider',
  type: 'api' | 'token-plan',
  plan: 'Plan Name',
  async fetch(ctx) {
    // ctx.apiKey(name) - 读取 auth.json 中的 provider key
    // ctx.cookie(name) - 读取 config.usage.cookies[name]
    // ctx.pluginConfig(name) - 读取 config.usage.pluginConfig[name]
    // ctx.usage.modelStats({ sinceMs?, provider? }) - 本地 trajectory 分模�?token 统计（滚动窗；缺省返�?[]�?
    // ctx.fetch(url, opts) - �?10s 超时�?fetch
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

### 8.4 特定适配器实现细�?

#### KimiCodingPlanAdapter（kimi-for-coding�?

**Bug 修复**（commit 69bfebf6）：
- 旧实现：所�?limit items 硬编�?`window:'5h'`
- 新实现：映射 `window.duration`（分钟）�?窗口类型
  ```javascript
  const durationToWindow = { 300: '5h', 10080: '7d', 43200: 'month' };
  ```
- 回退：未匹配�?duration 默认 `'5h'`
- 月度窗口：当 `limits[]` 中无月度限制时，�?`root.usage.{limit,used}` 添加月度窗口

#### CommandCodeAdapter（commandcode�?

**API 结构**（https://api.commandcode.ai/internal/billing/credits）：
- `body.windowLimits`（顶层，�?`body.credits.windowLimits`）：`fiveHour`/`weekly` �?`cap`+`used`+`resetAt`
- `body.credits.monthlyCredits`：月度剩余（无硬性上限）

**月度窗口实现**�?
```javascript
windows.push({
  window: 'month',
  used: monthlyCredits,
  limit: 0,      // 无硬性上�?
  unit: '$',
  pct: 0,        // 显示为无限样�?
});
```

### 8.5 配置

```yaml
usage:
  disabledPlugins: []  # 禁用的插件名称列�?
  cookies: {}          # session cookies（如 commandcode�?
  pluginConfig: {}     # 插件自定义配�?
```



