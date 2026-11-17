# 大脑如何避免“想起很多，但不对”：记忆检索控制与下一步

> 日期：2026-11-17
> 状态：调研与工程建议，不是已批准的实施计划。
> 触发问题：自动 recall 出现旧记忆误注入、最新事实未命中、精确命中被 FOK 压制，以及 REST / MCP / auto-recall 结果不一致。
> 前置：`2026-11-17-memory-complexity-vs-hippocampus-cortex.md`、`../superpowers/specs/2026-11-17-personal-memory-first-principles-design.md`。

## 0. 结论

**下一步不应是简单增加 recency/freshness 排序，也不应再增加一套记忆生产管线。**

大脑侧可迁移的核心不是“最新优先”，而是四个功能阶段：

1. **分离**：相似经历仍保留身份、来源、时间和适用范围差异。
2. **补全**：部分线索可以产生候选，但候选不等于事实。
3. **竞争选择**：当前目标从多个活跃候选中选择，并抑制不适用的竞争者。
4. **来源监控**：独立检查它来自哪里、是否仍有效、是否适合当前情境。

映射到 MAFW，下一刀应是：

> **统一三个检索入口的候选流与诊断；把“候选生成”和“允许注入”拆开；用真实查询同时评测命中、误注入、过期记忆使用和入口一致性。**

recency 只能是同分候选的次级信号；有效性由 `active/superseded_by/retracted/valid_time` 等语义决定，不能由时间新旧代替。

> **实施进展（2026-11-17）**：路径一致性、MCP 分数保真、REST 共享索引、snapshot cue anchors 与 scan query provenance 已修复，见 `docs/releases/2026-11-17-retrieval-path-parity.md`。固定 40 条真实查询与注入准入评测尚未实施；线上精确查询仍未命中，不能据 parity 修复宣称质量达标。

## 1. 本轮线上症状说明了什么

查询 `看看现在记忆系统效果·` 的实际注入包含：

- 与记忆系统有关但过旧的 `note-board v3`；
- 与当前抑制机制有关的 `no-memory 快照不 served`；
- 弱相关的旧调研流程；
- 基本无关的 desktop text-selection / tokens 及联想邻居；
- 主要是当前问题和旧提醒的 T1 摘录。

同句随后手工调用 `/api/recall/context` 得到 `相关记忆：无`；MCP `mafw_search_hybrid(bm25)` 却给出 `FOK=inject, top1prob=0.570` 和旧调研条目；REST `/api/memory/search` 又返回另一组旧条目。

代码核查补充了一个重要边界：线上短增量会经 `buildQueryWithFallback` 拼接上一条 assistant 尾部，而手工复测只传了用户句。因此二者**不是同一个 Query Frame**，不能把差异解释成随机性；但它仍说明当前缺少可重放、可比较的查询与诊断快照。

这支持三个独立问题，而不是一个“新旧权重”问题：

1. **candidate miss**：正确记忆没有进入前列候选。
2. **false injection**：候选虽相似，但不应进入当前工作上下文。
3. **path divergence**：入口或调用上下文使用了不同的查询、评分、过滤或门控。

只调 recency 无法证明其中任何一个被修复。

## 2. 大脑实际提供的功能约束

### 2.1 模式分离：相似不等于同一个事件

海马体研究支持对相似经历形成更可区分的表征，以减少干扰；同时也支持从部分线索补全已有表征。两者是平衡关系，不是“向量越近越好”。

工程类比：

- 写入时保留 `memory_id / source_trace_ids / session / project / valid_time / supersedes / distinct_from`；
- 同一主题下的不同版本、不同项目、不同事件不能只因措辞相似就合并；
- 检索相似度只负责找候选，不能抹平这些身份差异。

边界：把 Harmonic unit 或概念 tag 直接称为 DG/CA3 没有依据；这里迁移的是“减少相似经历互相覆盖”的功能约束。

### 2.2 模式完成：联想可以产生答案候选，也可以产生误报

部分线索恢复记忆是有价值的，但“恢复出一个模式”本身不证明它适合当前问题。

工程类比：

- BM25、dense、cue anchor、PPR/coactivation 都可以参与**候选生成**；
- 邻居扩展不应自动获得注入资格；
- 每个注入项必须独立通过当前查询的相关性、scope 和有效性检查。

因此，当前“顶层命中 → 自动带出一组弱邻居”的策略应被视为待验证的候选扩展，不是必须保留的召回本体。

### 2.3 前额叶提取控制：关键是从竞争者中选择，而非继续扩大 top-k

记忆控制研究强调竞争候选之间的选择、干扰解决与抑制。工作上下文的目标不是“装得更多”，而是让当前目标可用的少量证据胜出。

工程类比：

- 输出候选时同时记录落选者及原因，而不只保存最终 top-k；
- 同一实体/事项/断言的竞争版本应作为竞争组处理；
- `superseded/retracted` 不得因高分复活；当前有效状态与历史情景应分通道回答；
- 每轮只注入少量通过门控的证据，不能用更多弱联想补位。

边界：这并不证明应该模拟某个脑区，也不要求新增持久化“神经抑制分数”。

### 2.4 失配检测：冲突时应核实和更新，不应把新旧文本一起塞给模型

人类海马体研究显示，记忆预期与输入失配会影响编码/提取状态。可迁移的保守约束是：冲突应成为显式事件，而不是被相似度平均掉。

工程类比：

- 发现新旧事实冲突时，先核实来源和适用范围；
- 当前状态更新继续使用 soft supersede，T1 和历史版本保留；
- 不自动物理删除，也不因一次冲突就无条件重写所有相关记忆。

再巩固的预测误差边界仍有争议，不能拿它证明任何自动重写策略都正确。

### 2.5 来源监控：检索强度不是有效性证明

来源监控研究把“想起内容”和“判断内容从哪里来、是否可信”区分为不同过程。FOK 也可以与真实可回忆性分离。

工程类比：

- FOK 只应作为 abstention/风险信号，不能替代逐条相关性与来源校验；
- 精确 cue/title/identifier 命中需要独立保护，避免被全局分布门压掉；
- 但精确命中也不应绕过 `superseded/retracted/scope`；
- 每个注入项应有可兑现的 memory/source pointer，而不是只给概率。

### 2.6 时间与情境：recency 不是 relevance

时间情境模型能解释近因效应，但“与当前时间情境更近”不等于“与当前任务语义相关”。环境情境促进回忆的元分析效应真实存在但有限，也不足以单独承担门控。

工程类比：

- “现在/目前/最新”是**状态与时间约束**，不是简单按 `created_at DESC`；
- “上次/当时/之前”是**历史证据查询**，应优先 T1/episode；
- recency 只用于同分、同有效性候选的末级排序；
- 不用时间衰减代替有效性、撤回或主动抑制。

## 3. 现有设计与评测已经暴露的缺口

仓内第一性原理设计已经要求：

- `relevance / validity / authority / importance / activation` 分离；
- activation 只做末级排序或缓存；
- 禁止 cluster expansion、跨主题 PPR、无关 T1 补位；
- 候选必须通过 `active + scope allowed + relevant + within budget`。

所以当前问题不是缺少一份更脑化的设计，而是**线上实现尚未兑现已有读取契约**。

现有 LongMemEval L1 也不足以验收这次问题：

- 主要报告 Recall@k / NDCG@k，奖励 gold 命中，不充分惩罚额外误注入；
- 本仓使用的是 cleaned 数据，去除了部分干扰性 noise session；
- 检索只扫描 `primary_abstraction + cue_anchors`，且生产写入与评测摄入不同；
- 自动每轮主动召回、隐式查询、入口一致性、真实库内 16k+ 记忆竞争没有被当前 L1 完整覆盖。

因此，既有 BM25 高分不能反推出当前自动注入可靠。

### 3.1 代码核查：入口分歧是已证实事实

父会话抽查了子代理给出的关键代码，以下不是推测：

| 位置 | 已核实行为 | 后果 |
|---|---|---|
| `gateway/src/core/memory/harmonic-index.ts:343-361` | 计算了 `retriever = options.retriever ?? 'bm25'`，分支却仍读 `options.retriever` | 省略 retriever 的调用静默落到 token，默认变量是死代码 |
| `gateway/src/routes/memory.ts:419-436` | REST 每请求新建 index；缺省或非 bm25 参数落到 token | 与共享图状态、配置默认和其他入口分叉 |
| `gateway/src/mcp/handlers/search-hybrid.ts:135-177` | MCP 首轮及迭代 fresh hits 把原始 score 写成 `1`，后续再做 min-max/图融合 | 丢失 BM25 量纲，图权重和插入顺序可压过精确命中 |
| `gateway/src/kernel.ts:2723-2766` | snapshot rerank/FOK 输入把 `cue_anchors` 置空 | 与 MCP 的 reranker 输入不同，概率和排序不可直接比较 |
| `src/hooks/session-recall.ts:43-64` | 短用户增量补上一段 assistant 尾部 | 只重放用户句不是线上完整查询 |
| `gateway/src/recall/index-scan.ts:31-35` + `recall-context.ts:367-435` | `ScanResult` 不保存构建 query；direct/graph scan 命中获得固定 `0.35/0.2` | 合并时无法验证 scan 是否仍属于当前问题，旧上下文可竞争有限槽位 |
| `gateway/src/recall/topic-state.ts` 与实际消费链 | `retrievalKeys` 可保存但没有进入检索 Query Frame | Topic State 当前主要改善头部控制面，尚未充分改善候选质量 |

当前线上配置也不是代码默认值：`defaultRetriever=bm25`、`reranker=llamacpp`、`fok.enabled=true`、`snapshot.enabled=true`、`boundaryDense=false`。所以实际注入可能走 snapshot + reranker + T1，而 live fallback 使用另一套 raw-BM25 FOK；评测必须记录实际 path，不能统称“自动 recall”。

这也意味着下一步首先有若干**确定性正确性修复**，不需要先发明新神经机制：修死变量、保留真实分数、统一 reranker 输入、让 REST 使用共享索引与配置默认、让 scan 结果可追溯到构建 query。

## 4. 推荐的下一步：一个窄而完整的读取修复

### 4.1 先建立可证伪基线，不先调参数

从本轮真实会话与历史常见用法构造 **40 条人工标注查询**：

| 类型 | 数量 | 例子 | 必须验证 |
|---|---:|---|---|
| 当前状态/最近进展 | 10 | `看看现在记忆系统效果` | 最新有效交付/评估命中，旧历史不得冒充现状 |
| 精确标识符/标题 | 10 | `mafw_topic_set`、`Proactive Topic Recall` | 精确命中不能被 FOK 误杀 |
| 隐式继续/指代 | 10 | `接着刚才那个问题` | 使用当前 Topic/Matter，不靠泛词联想 |
| 无答案与负面对照 | 10 | 无关主题、虚构事实、已撤回前提 | 应显示无相关或纠正，不注入噪声 |

每条标注：

- `must_include`：允许回答所需的 memory/trace IDs；
- `must_exclude`：旧版、无关或明确禁用的 IDs；
- `expected_mode`：current-state / what-happened / lesson / explicit-search / abstain；
- 可接受的 supportive context，避免把“不直接包含答案但有助当前对话”一律误判为噪声。

同时保留黄金证据不变、逐渐增加无关记忆的 scale-conditioned 版本，观察可靠性何时随库规模下降。

### 4.2 指标必须同时报，不允许只报 Recall@k

- **hit@1 / hit@3 / recall@k**：必需证据是否出现；
- **injection precision**：实际注入项中通过人工/规则标注的比例；
- **false-injection rate**：无相关或负面对照中仍注入记忆的比例；
- **stale/invalid injection rate**：注入 superseded/retracted/失效内容的比例；
- **current-vs-history confusion**：把历史当现状或把当前状态当历史的比例；
- **entrypoint agreement**：同一 Query Frame 下 REST/MCP/auto 的候选、过滤原因和 served IDs 是否一致；
- **source redemption**：注入指针能否兑现原文/证据；
- **latency/cost**：边界 100ms 硬契约与额外计算成本分开报告。

主验收目标是：提高必需证据命中，同时降低 false injection；若只提高 Recall@k 而误注入上升，不算通过。

### 4.3 读取路径的目标形状

```text
同一份 Query Frame
  → 统一候选生成（BM25 / dense / exact cue / 有界邻居）
  → 统一硬过滤（active / scope / permission / validity）
  → 竞争组与当前状态解析
  → 独立 injection admission（逐条相关证据 + source）
  → 很小的 Working Context
  → candidate / rejection / exposure / outcome ledger
```

REST、MCP 和 auto-recall 可以有不同的返回格式和 top-k 默认，但不能各自维护一套评分、FOK 与过滤语义。

第一刀不包含：

- 不按新鲜度重排全库；
- 不新增后台 Topic LLM；
- 不新增 dream/reflection/记忆文本生产器；
- 不改变 note-board 的独立 must-surface 行为；
- 不删除 T1 或历史记忆；
- 不用 LLM 自评置信度代替来源与任务结果。

### 4.4 建议实施顺序（待批准后另写计划）

1. **Baseline + trace**：固定 40 条查询，保存完整 Query Frame、path、候选原分、过滤/折叠原因、FOK、served IDs；先得到现状数字。
2. **Path parity 正确性修复**：用失败测试锁定 dead retriever、MCP 常数分、REST 独立 index/默认 token、snapshot 空 cue anchors；这一刀不改召回策略。
3. **候选与注入解耦**：scan 保存构建 query 并做上下文匹配；邻居仅作候选；逐条 admission 与 exact-hit 保护在 40 条集上标定，FOK 继续抑制不可靠 recall 本体。
4. **配对复测**：同库、同 Query Frame 比较改动前后，报告新增测试数、全量测试数和上述命中/误注入指标；不达标则不上线。

明确不采纳三类看似快捷的建议：

- 不重新给 note-board 加主题门控；它是用户确认的独立 must-surface。
- 不在 `no-memory/low-confidence` 时重新渲染旧 recall 本体；那只会把噪声重新放回来。
- 不把候选内 recency 乘进主相关性分数；先修已证实的路径与校验缺陷。

## 5. 后续才做的机制

1. **结果反馈**：记录 injected → used / ignored / corrected，避免“曝光次数”自动变成“价值”。
2. **竞争组抑制**：在同实体/同事项/同断言组内分析反复误注入与落选原因。
3. **状态更新**：出现新证据时 reconcile + soft supersede，并验证下一轮能召回新版本、旧版本不再冒充现状。
4. **缓存优化**：activation、dream/prefetch 只按延迟和任务收益评估，不进入真实性或相关性真相源。

这些都不应阻塞第一轮“统一读取 + 独立门控 + 真实评测”。

## 6. 外部证据

### 神经科学与记忆控制

- Yassa & Stark (2011), pattern separation / completion：[`10.1016/j.tins.2011.06.006`](https://doi.org/10.1016/j.tins.2011.06.006)
- Badre & Wagner (2007), controlled retrieval / selection / interference：[`10.1016/j.neuropsychologia.2007.06.015`](https://doi.org/10.1016/j.neuropsychologia.2007.06.015)
- Johnson, Hashtroudi & Lindsay (1993), source monitoring：[`10.1037/0033-2909.114.1.3`](https://doi.org/10.1037/0033-2909.114.1.3)
- Smith & Vela (2001), environmental context meta-analysis：[`10.3758/BF03196157`](https://doi.org/10.3758/BF03196157)
- Howard & Kahana (2002), temporal context：[`10.1006/jmps.2001.1388`](https://doi.org/10.1006/jmps.2001.1388)
- Bein, Duncan & Davachi (2020), mnemonic prediction errors：[`10.1038/s41467-020-17287-1`](https://doi.org/10.1038/s41467-020-17287-1)
- Bekinschtein et al. (2018), retrieval-specific adaptive forgetting：[`10.1038/s41467-018-07128-7`](https://doi.org/10.1038/s41467-018-07128-7)

### Agent 记忆评测

- LongMemEval (ICLR 2025)：indexing / retrieval / reading，含 temporal reasoning、knowledge updates、abstention；[arXiv:2410.10813](https://arxiv.org/abs/2410.10813)
- LoCoMo-Conv (2026)：隐式/组合等真实对话查询，分别评测 retrieval 与 response；[arXiv:2609.03467](https://arxiv.org/abs/2609.03467)
- Scale-Conditioned Evaluation (NeurIPS 2026)：固定证据、增加无关 session，观察可靠性与 usable-scale boundary；[arXiv:2605.07313](https://arxiv.org/abs/2605.07313)
- From Recall to Forgetting / FAMA (2026)：显式惩罚 obsolete/invalidated memory 的使用；[arXiv:2604.20006](https://arxiv.org/abs/2604.20006)

## 7. 方法与边界

- 两个子代理使用 `gateway/volcengine/deepseek-v4.1-flash`，分别做机制文献与代码只读调研；父会话补查评测文献并核对关键 DOI。
- 神经科学只提供功能约束与工程假说，不证明某个 MAFW 实现必然有效。
- 本文中的线上数字是当日快照；下一轮结论必须来自固定标注集、配对对照和真实入口日志。
- 本轮不改生产代码或配置；仅按记忆约定写入调研结论与子代理模型偏好。
