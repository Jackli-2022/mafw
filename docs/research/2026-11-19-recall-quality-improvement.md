# 2026-11-19 · 记忆召回质量提升：根因、业界证据与实验路线

## 0. 结论

下一阶段的收益不应来自“更多候选、更低 FOK、更高 snapshot serve 率”，而应来自三件事：

1. **把评测单位从 expected-id 命中扩展为实际渲染块的有用率、答案覆盖和误展示。**
2. **先审计可用性，再让现有 TopicState / 当前任务上下文参与领域与问题方面约束，验证能否区分“词面相关”与“能回答”。**
3. **只做有证据、可弃权、独立 held-out 的 answerability shadow；不再上线朴素 CE/LLM 阈值。**

当前系统已经具备 hybrid retrieval、reranker、FOK、lexical veto、exact rescue、snapshot 当前轮词级校验。真实负样本说明：继续加强“相关性”不足以解决展示质量。

## 1. 当前真实失败是什么

### 1.1 词级支持是“任一字段、任一词”，不是答案支持

`lexical-support.ts` 在去除英文功能词和问题框架后，准入条件仍是：候选 title 或任一 cue 与 query 共享任一内容 ASCII token 或 CJK bigram；跨 title/cue 取 OR，不要求领域与方面共现。

这能阻止零重叠误注入，但也意味着：

- “现在记忆系统质量和效率”中的“质量”可让旧交付流程记忆通过；
- “分析一下，调研一下提升质量”中，`7lsgaw` 的 title 直接共享“分析 / 调研 / 提升 / 质量”；
- title 没有重叠时，cue 仍可能提供支持；
- 不需要同时覆盖“记忆系统”这个领域对象、“质量/效率”这些方面以及“现在”这个时间范围。

把“质量”加入停用词不是修复：它在其他 query 中可能是真正的主题词。问题是**缺少结构化领域/方面覆盖**，不是某个词本身。

### 1.2 Snapshot 的构建答案与当前问题不是同一个对象

- build：最近 4 个逻辑轮 / 600 字符 rolling window，经 hybrid + reranker + FOK。
- serve：containment 只判断当前 query 与 rolling window 是否同题。
- 当前轮 adapter：只对结构化 Harmonic/T1 metadata 做词级支持，不重排、不重新计算当前 query 的 CE/FOK。

所以 `fokStatus=inject` 表示“rolling window 的候选池可注入”，不能证明“过滤后的 block 回答当前 query”。

### 1.3 已有 TopicState 没参与检索或准入

当前会话已能识别主题“个人记忆质量治理”，`TopicState` 已有：

- `summary`
- `entities / aliases`
- `openLoops`
- `retrievalKeys`
- `revision / sourceTraceId / updatedAt`

但 recall route 只把它渲染成 `<topic-recall>` 头部，不用它约束候选。这使“当前任务是什么”与“旧记忆谈了什么”之间缺少连接。

### 1.4 T1 的相关性不等于信息增量

真实 snapshot 块会把上一条用户指令原样带入。它可能与会话相关，却不给当前回答增加证据。现有跨层去重只处理精确 T1 重复和共享长度 ≥12 的 ASCII 标识短语，无法处理中文语义重复或“重复当前指令”。该层只存在于 snapshot serve；当前 live fallback 没有 T1 行。

### 1.5 固定 40 条看不到这些失败

固定集无 sessionID，只覆盖 live fallback；`falseInjection` 只问 negative 是否出现任何 `#mem-`，`autoHit` 只问 expected id 是否出现。它不回答：

- 同域但错误的 snapshot 是否展示；
- 一个正确 anchor 是否夹带多个噪声 neighbor；
- 当前最新结论是否覆盖旧偏好；
- T1 是否只是重复指令；
- 展示块是否真正回答当前问题。

此外，固定集 `autoHit` 把 expected id 仅作为 neighbor 出现也计为 hit（rank=null），因此它甚至不区分“作为答案 anchor 展示”与“随 anchor 附带”。

### 1.6 Filtered snapshot 的 FOK 校准样本存在归因错位

当前 route 在实际过滤后仍可能把 rolling-window 原 top1 的 `top1prob` 与过滤后的 `ids` 写入同一 FOK sample。若原 top1 已被删除，概率和展示 id 不再对应，会污染后续 `P(hit|top1prob)` 校准。后续质量实验前应把 filtered 样本标记/排除，或让样本明确绑定原候选与最终展示集合；不能把这类样本当作“FOK 不需要调整”的干净证据。

## 2. 已有负结果约束后续设计

`2026-11-18-verify-before-display-experiment.md` 已证明：

- 6/20/50 候选池都恢复 4/4 目标；
- 50 个预锁定控制在三种池中分别出现 19/22/24 个 false-verification；
- 扩池增加错误与延迟；
- 只显示 top1 不能修复；
- CE 输入只有 title + cue，主要学到 topical relevance；
- `2026-11-18-memory-health-root-causes.md` 的后续归因显示：24 个 CE 错误中，22 个至少缺一个 query 点名的实体或数值；
- 原实验中最低 target 与最高错误的表观概率差小于同一候选在不同 batch 中观察到的概率波动，不能据此反推新阈值。

因此不得：

- 把 CE 概率阈值从 0.5 调成另一个数就直接上线；
- 用本轮控制集调参后继续称 held-out；
- 以 lexical clue 或普通 low/no-confidence 放行替代 verifier；
- 把 4/4 恢复当成安全证据。

## 3. 业界证据对本系统的含义

### 3.1 分别测 context precision / recall，而不是一个 AUTO 数字

RAGAS 将 Context Precision 定义为相关项在检索排名中的位置/精度，将 Context Recall 定义为参考信息被覆盖的比例；Response Relevancy 与 Faithfulness 是另外的问题，不能混入检索命中。

映射到本系统，应以实际渲染块报告：anchor precision、neighbor precision、expected-family coverage、无效展示率、重复率，而不是只看 expected id 是否出现。

### 3.2 Relevance 不等于 sufficient evidence

RINSE 直接区分三类缺口：问题部分未覆盖、topical-but-answerless、跨证据组合不足。其配对 benchmark 特意控制词面、证据数量等 shortcut；这正对应我们当前“共享质量/分析就通过”的失败。

SURE-RAG 进一步把 sufficiency 当作 set-level 属性：缺失 hop 和冲突不能靠逐条独立打分发现，需要 coverage、关系强度、不确定性和冲突的聚合。

含义：未来 verifier 应输出 **supported / refuted / insufficient**，并检查问题覆盖和证据关系，不应只输出“相关概率”。

### 3.3 当前任务状态应与 archival recall 分层

Letta 官方文档将 always-visible 的 current/core/scratchpad state 与按需检索的 archival memory 分开，并明确当前工作记忆和频繁变化状态不应只靠 archival search。

本系统不必复制 Letta，也不应把 Lead 专用 working-set 实现直接搬来；可复用现有个人 `TopicState` 作为当前任务视图，让长期记忆仍是可撤回的真相源。

### 3.4 短追问需要上下文，但不能让历史覆盖当前 query

Conversational Search 综述指出 follow-up 存在省略和指代，需要 query reformulation；同时“retrieval shortcut”会让模型依赖部分历史、忽略当前 query 并发生 topic drift。

因此应先比较 raw / topic+raw / last-pair / rolling-window 等确定性上下文组合，而不是直接让 LLM 自由改写。当前 query 必须始终保留，TopicState 需带 revision/sourceTraceId，显式换题时不得强行使用旧主题。

### 3.5 文档/记忆的上下文有帮助，但不是本负样本的直接修复

Anthropic Contextual Retrieval 在其自有评测中通过 chunk-specific context 降低检索失败，并显示与 reranking 可叠加。它主要发生在 ingestion/indexing 侧。

对本系统的启发是记忆需要带领域、时间、来源上下文；它不能替代 serve-time answerability，也不能证明扩大 topK 会提高质量。既有“不做全历史 T1 backfill”的约束保持不变，该方案不是近期杠杆。

### 3.6 长期记忆要分能力评测

LongMemEval 将信息提取、多会话推理、时间推理、知识更新、弃权分开，并区分 indexing / retrieval / reading。当前固定 40 应继续作为个人回归集；新 session-shaped 集合应另覆盖 current-state、conflict、provenance、abstention，而不是修改旧期望。

## 4. 推荐实验路线

### P0：建立 session-shaped 块级质量基准

先冻结真实 turn 序列、当前 query、snapshot query、snapshot ids、候选正文和实际 rendered block；live 与 snapshot 分开报告。legacy 无结构化 metadata 与 episodes snapshot 单列，不混入普通 filtered-snapshot 指标。

**先锁标注协议，再看任何对照结果：**

- 标注单位是 `(turn, memory id)`，同时保留它在块中的 anchor/neighbor/T1 角色；
- 标注者可见 `memory_value`、来源上下文和实际渲染行，不能仅凭 title 猜 answerability；
- 首批由两人独立、对方案盲标，分歧经裁决；后续抽检一致性；
- expected answer family 同时冻结“参考答案陈述 + 等价 id 集合”，不能只凭 id 命中推断答案覆盖；
- 标签为 `answer / context / noise / repeat / stale-or-conflict`，另对未展示候选标记 `legit-suppressed`（本可回答却被准入丢弃）。该标签只统计本次 pre-admission 候选池（snapshot `memories` / live topK）内被准入丢弃者，未展示候选设固定抽样上限；未检索到不属于误抑制。

首轮只预注册两个主指标与两个安全指标，避免小样本多指标挑优胜：

| 类型 | 指标 | 定义 |
|---|---|---|
| 主指标 | useful anchor precision | 实际展示 anchor 中 answer+context 的比例；neighbor 另列诊断 |
| 主指标 | answer coverage | 参考答案陈述/等价 family 被实际展示支持的比例 |
| 安全 | false display | 无答案/同域负例展示了任何 noise 本体 |
| 安全 | legitimate suppression | 可回答候选被某层准入错误抑制的比例 |

邻居 precision、T1 redundancy、noise+repeat 字符占比仅作次要诊断。current-state 可计算为“active head 被展示且 superseded id 缺席”；visible recall 复用现有 receipt 与 abort 口径，不新造埋点。

首批 20–50 条真实序列只用于建立 dev baseline；另留 memory-family 隔离 held-out。比较前预注册主指标和最小可检测差，小样本报告 Wilson/聚类 bootstrap 区间，不把 0/n 写成绝对安全。已锁定的 50 控制 + 12 hard negative 作为新规则的最终安全集；一旦查看其新方案结果，不得继续调规则后再称 held-out。

### P1：Topic + facet admission shadow

不改生产响应，先离线比较。开始前必须审计 TopicState 的字段填充率与正确率；无 topic、字段为空或检测到换题时回退现行为，不能伪造领域约束。

换题/可用性预注册为三态：`usable`（active 且字段非空）、`unavailable`（无 active/字段为空）、`changed-or-uncertain`（当前轮 revision/sourceTraceId 改变，或 raw query 与 topic+summary 的现有 `snapshotContainment` < 0.25）。后两种不加 topic 约束，结果分层报告；0.25 沿用现有配置并做敏感性分析，不引入隐藏新阈值。

Facet 不来自隐藏手写词表：优先使用 `TopicState.retrievalKeys/entities/aliases` 作为领域集合，raw query 去掉领域后的内容单元作为方面；exact identifier/title 继续走确定性旁路。取不到可靠结构时不加新约束。

对照臂：

1. 现有内容单元支持；
2. TopicState 领域 + raw 方面共同支持；
3. **lexical veto off（仅离线）**，量化当前 gate 已造成的合法抑制，确定继续收紧的空间；
4. **snapshot off / live-only**，测 snapshot 相对 live 的边际质量价值；
5. 每个方案都在预注册 dev、最终 50 控制 + 12 hard negative 上同时报 answer coverage、false display 与 legitimate suppression。

对“现在记忆系统质量和效率”，旧交付流程若只有“质量”而没有记忆治理领域，应判为不足；对“分析一下”这类省略 query，可用 active topic 补领域，但不能让旧 topic 覆盖显式换题。

当前/现在/最新类 query 另测 temporal/current-state 约束，不用全局 recency boost 代替版本与来源判断。

### P1：确定性上下文 query 对照

比较以下输入对检索与当前轮准入的影响：

- raw current query；
- active topic retrievalKeys/entities + raw；
- last user/assistant pair + raw；
- rolling window + raw；
- 双版本 snapshot（last-pair / rolling-window）。

每种都保留 raw query 和来源。先不做自由 LLM rewrite；如果选择生成式 rewrite，需单独测 topic drift、错误前提注入和额外延迟。

### P2：Evidence-grounded sufficiency verifier shadow

输入不再只有 title+cue，而是 query、当前 TopicState、候选 body 与来源上下文。首轮只处理单证据/单命题，输出 `supported / insufficient`、覆盖的问题 facet 和候选中可定位的 evidence span；只有 query 自带明确事实前提时才增加 `refuted`，不在没有 candidate answer 时伪造 claim。

无 evidence span、缺关键实体/值、只有主题相似时不得判 supported。集合级 hop/冲突判定等到真实多跳样本出现后再做，不作为首轮依赖。

使用 dev 校准，memory-family 隔离 held-out 只做最终复验；与旧 CE 对照 false-verification、legitimate suppression、answer coverage 和成本。只有新 verifier 同时通过预注册恢复、同域控制、hard negative、真实负样本和延迟门，才讨论后台准入；不进入 100ms live 热路径。

### P2：T1 信息增量 shadow

单独标记“用户指令重放 / 与 Harmonic 重复 / 提供新证据”。测试只在信息增量不足时抑制，不能因为 T1 较短或来自 user_input 就一律删除；T1 仍是提取遗漏时的救援通道。

## 5. 上线前的统一验收门

任何质量方案必须同时满足：

1. 固定 40 期望不变，exact/current/implicit/false/stale 逐项报告，不回退；
2. 新 session-shaped dev 与未参与调参的 held-out 分开报告；50 控制 + 12 hard negative 作为最终安全集；
3. 当前真实负样本不得再原样展示旧交付流程；
4. answer coverage 提升不得以 noise、repeat、false display 或 legitimate suppression 增加为代价；
5. snapshot 与 live 分开，serve 率不是质量目标；必须有 live-only 对照证明边际价值；
6. 普通 low/no-confidence 本体继续抑制，FOK/lexical veto 不在生产放宽；veto-off 仅作离线测量臂；
7. verifier 只在后台/shadow，live p95 不增加；
8. 所有规则/阈值在查看 dev 前预注册，在 dev 选择，held-out 不再调参；
9. 先修正/排除 filtered snapshot 的错位 FOK 样本，再使用校准数据作质量判断。

## 6. 明确不推荐

- 把“质量/分析/调研”等加入全局停用词；
- 降低 FOK、放宽 lexical veto 或放行普通 low/no；
- 扩大候选池到 20/50 期待 verifier 自行过滤；
- 只提高 CE 阈值、只显示 top1 或全局提高 recency；
- 用 LLM 自由改写当前 query 而不保留原文/做 topic-drift 对照；
- 为提高 snapshot serve 率降低 containment 或当前轮质量门；
- 删除历史偏好/重建向量库来掩盖当前排序与准入问题；
- 把模型最终回答“看起来不错”当成记忆质量证明。

## 7. 建议实施顺序

1. 修正 filtered FOK 样本归因；冻结标注协议、主指标和 session-shaped 评测；
2. 审计 TopicState 填充率/正确率，跑 lexical-veto-off 与 live-only 离线对照；
3. Topic/facet 与确定性上下文 query shadow，同时量 false display 和 legitimate suppression；
4. 仅对胜出的确定性方案做生产小切片；
5. evidence-grounded verifier 与 T1 信息增量 shadow；
6. 独立 held-out 通过后，才考虑后台 snapshot 准入和生命周期扩覆盖。

## 8. Primary sources

- RAGAS Context Precision: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/
- RAGAS Context Recall: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/
- RAGAS Response Relevancy: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/
- RAGAS Faithfulness: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/
- RINSE — Relevance Is Not Sufficient Evidence: https://arxiv.org/abs/2609.37469
- SURE-RAG — evidence sufficiency / selective RAG: https://arxiv.org/abs/2605.03534
- Anthropic Contextual Retrieval: https://www.anthropic.com/research/contextual-retrieval
- Letta memory blocks: https://docs.letta.com/v1-sdk/memory/memory-blocks/
- Letta archival memory / current-state 分层: https://docs.letta.com/v1-sdk/memory/archival-memory
- A Survey of Conversational Search: https://arxiv.org/abs/2410.15576
- LongMemEval: https://arxiv.org/abs/2410.10813

## 9. 调研过程说明

代码分析基于当前 `snapshot-current-query.ts`、`lexical-support.ts`、`snapshot-builder.ts`、`recall-snapshot.ts`、`topic-state.ts` 与既有 CE 负结果。Kimi 调研子代理因周配额限制未产生结果；本文外部依据由主会话直接检索并读取 primary sources。未修改生产代码、配置、数据库或固定 40 期望；新增测试 0。
