# 当前记忆系统是否太复杂：T1 / turnCompress / reflection / dream 与海马体—皮层对照

> 日期：2026-11-17
> 范围：只读代码审计、运行 stats 与日志抽样、机制文献对照；不修改生产配置、不删除记忆。
> 判断标准：不是“是否像大脑”，而是每个部件是否有独立、可追溯、可复现的任务收益。

## 0. 结论

**是的：以当前数据规模、标签质量和运维证据看，系统已经过度复杂；但多余的不是 T1 + Harmonic 双层，而是重复的语义判官、无人消费的计算和多套维护政策。**

应保留：不可变 T1、可追溯长期记忆、冻结检索面、soft supersede、fail-open 边界。
应收敛：route-write/consolidation 重复判官，以及 grace/reconsolidate/stale-verify 等多套 reconcile 政策。
`dream` 不是记忆巩固，而是“预测下次查询 → 预取快照”；它与 reflection 不重叠，应作为可选延迟优化单独评估。
不应把 `sem:` concept tags、任意 top-k、LLM 摘要分别直接命名为 DG 模式分离、CA3 补全或皮层慢学习。

## 1. 运行侧事实（2026-11-17 快照）

`GET /api/memory/stats` 与 automation rules 显示：

- 登记了 9 个记忆相关 pipeline：`memory:decay`、`memory:turnCompress`、`memory:reflect`、`memory:review`、`memory:skillPromotion`、`memory:axiomDistill`、`memory:reconsolidate`、`memory:dream`、`consolidation`。
- 其中 8 个由 automation cron 直接调度；`consolidation` 另出现在 pipeline heartbeat 中。
- T1：74,202 archive rows、765 active rows、4,571 个带 turn code 的 turn；semantic atoms 为 on。
- Harmonic/cortex：16,548 total、10,052 active、5,167 superseded、1,998 legacy episodic。
- 只有 947/16,548（5.72%）memory 有 exact provenance；这不等于其余记忆都无来源，但说明精确审计覆盖有限。
- 最近一次 `dream`：0 sessions / 0 generated；最近一次 `reconsolidate`：checked/rewritten/skipped/replayed 全 0。
- 当前日志窗口内，dream 在 11-16、11-17 均于触发后约 4–5ms 完成；reconsolidate 在 11-15 至 11-17 均约 3–4ms 完成。这是“近期空转”的证据，不是“永远无效”的证据。
- 最近三次夜间 reflection：分别 reviewed=203/distilled=241、84/173、10/22；该指标中的 deduped 与 superseded 均为 0。它提示需要审计文本增殖，但不能据此推断全局没有去重。
- 当前日志窗口的 52 次 turnCompress 汇总中，20 次为 zero-session run，4 次含失败；总计 339 turns archived、675 replayed。最近错误包括 300s prompt timeout 与 fetch failed。

这些数字证明的是**运维与归因复杂度已经真实存在**，不是证明所有管线都应删除。

### 1.1 当前同时存在“产出过多”与“空转”两种症状

- reflection 三次夜间运行合计 distilled=436，而自身 deduped/superseded 指标均为 0；
- dream 与 reconsolidate 近期基本无候选、无产出；
- turnCompress 大量定时运行没有 session，但也存在 LLM timeout/fetch failure。

因此问题不是简单的“管线做太多”或“管线都没用”，而是**调度与产出主要由时间、游标和内在门槛驱动，缺少未来任务结果来约束它们**。

### 1.2 当前名称混合了不同 taxonomy

T1/Harmonic 是存储；turnCompress 是转移过程；reflection/dream 是离线策略；decay/review 是维护。
它们不能直接作为四个并列“层”与海马体/皮层一一对应。
如果每个策略都能制造长期记忆，复杂度按 producer 数量增长；应统一写入契约、producer provenance 与结果评估，而不是只合并文件名。

## 2. 判断“太复杂”的标准

一个部件只有同时满足以下条件，才值得作为默认自动生产机制保留：

1. **独立职责**：输入、输出或时间尺度与其他部件确实不同。
2. **可追溯**：能回到原始 trace/span，知道由哪个 producer、哪个版本生成。
3. **可消融**：能在相同任务上做 with/without 或 leave-one-producer-out。
4. **有任务收益**：降低任务失败、重试或用户纠正，而不只是增加 unit 数或内在 AUC。
5. **成本可控**：LLM、embedding、存储与延迟有预算，失败 fail-open。
6. **可回退**：shadow/disable 不破坏 raw T1，不强迫迁移不可还原的数据。

安全、版本、来源、软 supersede 带来的复杂度属于保护性复杂度，不应与“多一个生成式管线”混为一谈。

## 3. 海马体—皮层对照原则

- 海马体侧的关键不是“摘要”，而是快速、高保真的情景绑定，以及模式分离、线索补全、索引与选择性回放。
- 新皮层侧的关键不是“另一个 LLM prompt”，而是跨事件慢统计、重叠表征、图式与对原始证据的受约束重组。
- 离线执行不自动等于睡眠巩固；生成新文本也不自动等于 replay 或 dream 的神经机制。
- 生物类比只能提供候选机制。是否上线必须由 MAFW 自己的 paired task outcome 决定。

## 4. 目标最小形态

概念上收敛为：

1. **一个不可变情景层**：T1 raw + 可重建索引；热路径不训练、不调用 LLM。
2. **一个长期知识层**：Harmonic unit + 来源 + supersede + 慢统计/schema；文本不是无来源的新事实。
3. **一条快巩固路径**：turnCompress 负责近期 turn 的候选抽取与归档，输入必须保留有界原始证据，而不只是正则事件码。
4. **一条慢维护路径**：reflection 负责跨 episode 汇总；grace/reconsolidate/stale-verify 共用一个 reconcile 政策与 provenance-preserving 写回。
5. **确定性维护独立且可命名观测**：decay、ACT-R、回填不要挤在一个 `ok` 里；它们便宜，但也需要真实效果指标。
6. **专用任务分别验证**：axiomDistill/skillPromotion 是草稿工具，不应借脑类比自动扩张；dream 只属于可选预取，不属于记忆生产。
7. **一个结果账本**：decision/candidate/exposure/outcome，用 paired ablation 决定保留、合并或关闭。

代码模块不必机械合并成一个大文件；需要合并的是写入政策、来源账本与验收标准。

## 5. 可证伪的精简实验

1. **先做层覆盖率**：冻结一批留出查询，分别测 raw-only、turnCompress-unit-only、reflection-gist-only、both 的答案覆盖；先问“哪层提供了不可替代内容”，不新增模型。
2. **再做 producer 消融**：对 reflection/turnCompress/reconcile 的产出记录 producer；在同一任务集合上排除某一 producer 的 unit，其他条件不变、不补位。
3. **dream 用不同指标**：它是预取器，只评估缓存命中、首次 recall 延迟与额外 LLM/token 成本；不要用记忆 unit 消融冒充它的价值。
4. **主终点使用任务损失**（如 `1-success`），重试、用户纠正、token/tool 成本分开报告；按 session cluster bootstrap。
5. **删除需要等价证据**：CI 上界低于预注册的最小有用收益，才称“收益可排除”；单纯不显著或最近空转不够。最小有用收益由部件成本和任务价值确定，不拍脑袋。
6. **内在指标不能上线**：AUC/R@10 提高但 paired task loss 不改善，不得以“更像海马体/皮层”为理由保留。
7. **样本不足就是 inconclusive**：继续 shadow 或保持现状，不把无差异包装成成功，也不凭一次小样本否定所有机制。

## 6. T1 / turnCompress 代码审计要点

以下结论由子代理只读审计后，父会话抽查关键代码确认。

### 6.1 值得保留的主干

- `/api/obs/capture` 同步 append raw observation；archive 保留原文，worker 输出不回流 T1。
- `trace_id`/`source_trace_ids` 让长期记忆可以兑现到原始证据。
- `t1_fts`、feature/actor/concept 等机械索引本身不需要 LLM；它们不是主要算法负担。
- T1 的边界注入经 R8 snapshot；实时 100ms fallback 只查 Harmonic，不把 T1 图计算塞进边界。

### 6.2 已确认的无效或重复工作

| 现象 | 代码证据 | 含义 |
|---|---|---|
| 同一 turn 被多路重复 embedding | `routes/obs.ts:112-122`；`turn-pipeline.ts:358-469`；`t1-signals.ts:135-280` | observation 向量、atoms、novelty/mismatch、surprise 不共享表示；应优先缓存/复用，而非新增信号 |
| novelty/mismatch/surprise 只测量、不消费 | `kernel.ts:3602-3614`；`routes/memory.ts:195-200` | 当前主要读者是 stats；继续全量计算缺少收益证据 |
| dense T1 shadow 算完不进 fusion | `t1-search.ts:242-251` | `shadow` 下产生 query embedding 与向量扫描，却令 `denseForFusion=[]` |
| 原始 transcript 采样后被 timeline replay 覆盖 | `turn-pipeline.ts:478-511` | salience/sampled transcript 的正常路径工作被丢弃；worker 实际主要消费派生 replay block |
| `sem:` 与 concept 使用同一套 12 个概念 id | `t1-semantic-atoms.ts`、`t1-concepts.ts`、`t1-search.ts:230-236,281` | 这是概念软打标，不是 DG；检索上可能与 concept/lexical 通道重复计票 |
| episode 的 shadow 只约束检索，不约束 reflection | `kernel.ts` 的 recall/reflect wiring；`reflection.ts` episode 输入 | 名称是 shadow，但已经能驱动长期记忆生产，需统一实验语义 |

### 6.3 过度复杂不等于所有派生表都该删

T1 当前真正的问题是“忠实保存很强，但有效曝光与机制验收较弱”：

- 子代理在生产日志窗口统计到 snapshot serve 232 次、skip 530 次（约 30% serve）；实时 fallback 不查 T1。
- episode 约 74% 是单 turn，声明式边界表为 0；因此不能仅凭 episode 数量宣称情景分段有效。
- `sem:error:connection_reset` 覆盖约 41% turn，是 hub/区分度警报；不能称模式分离成功。
- T1 signals 的既有验证接近随机，learned k-WTA P1 也已失败。这里应做减法，不应再添加新码。

### 6.4 与复杂度无关、但审计暴露的正确性风险

这些应单独立项修复并用测试验证，不应借“精简”悄悄改变行为：

1. episode-only snapshot 在 live 模式下可能被 `decideSnapshotUse` 错判为 no-snapshot。
2. 归档且缺 feature 的 turn，`t1Excerpt` 不回退 archive，可能从 concept/actor/sparse/neighbor 通道消失。
3. episode 模式下部分 source-episode demote/stamp 操作可能拿 `t1ep_*` 去查 Harmonic unit id，形成静默 no-op。
4. atom calibration 的进程内状态与随机参考集使跨重启复现性不足；参数不可辨识问题已在 atom audit 中单独记录。

## 7. Reflection / dream / 皮层管线审计

### 7.1 Reflection 与 dream 不重叠

- **reflection** 消费 closed multi-turn episode + 有界 raw-T1 evidence，调用 LLM 生成/裁决 insight，并写 Harmonic。
- **dream** 消费会话尾部文本，生成至多 3 个可能的下次查询，写入 `dream-queries`，随后用于 scan/prefetch；它不写 Harmonic unit。
- 因此 dream 不是 REM、不是巩固，也不是另一个“皮层生产者”。它只是缓存预热。当前关闭它主要减少一个调度与失败面，**不会节省本来就不发生的夜间 LLM 调用**。

### 7.2 两套实际重复

1. **route-write 与写后 consolidation 重用同一 consolidation judge**。子代理对 `consolidation-pairs.jsonl` 的统计中，写后 judge 有大量调用只是再次确认写前已经决定的 create。频繁调用只证明在使用，不证明有任务收益；应合并成一个判官与一份配对日志。
2. **grace / reconsolidate / stale-verify / consolidation-merge 都在做 reconcile**：老记忆 + 较新证据 → keep/update/merge/demote。可以保留不同候选选择器，但应共享 PE 定义、写回、来源并集、budget、shadow/live 语义。

### 7.3 发现的正确性问题先于“精简”

| 问题 | 代码证据 | 判定 |
|---|---|---|
| dream 永久过滤掉真实 turn | `dream-prefetch.ts:4-18` 要求 `status='completed'`；`gateway-db.ts:1221-1236` 的 `listTurns()` 不返回 `status` | 父会话已核对；解释生产 0 session。测试使用了真实接口不提供的字段 |
| reflection 在 SQL LIMIT 后才过滤 reflected cursor | `gateway-db.ts:2889-2910`；`reflection.ts:458-478` | 父会话已核对；当最旧一页全已反思时 pending 被截在后面。子代理在审计时读到 340 pending、oldest-10 全 reflected |
| grace rewrite/merge 丢精确来源 | `grace-revisit.ts:101-140` | 父会话已核对；新 unit 未继承/并集 `source_trace_ids`，且 energy 被抬高。当前 shadow 限制了爆炸半径 |
| episode 无法归属时回退到最后一个 episode | `reflection.ts` 的 `deriveEpisodeId(...) ?? lastEpisode` | 可能制造不准确的 episode 关联；不应把这种回退当来源证据 |

这些是 bug/审计缺陷，不是“脑机制是否有效”的实验结果。应先修契约与来源，再评估管线价值。

### 7.4 Replay 当前优化的是 prompt，不是记忆价值

代码里至少有四种 replay：prior-knowledge interleave、本批 timeline 渲染、reflection raw evidence retrieval、T1 activation 状态。
它们可以决定“worker 看见哪些材料”，但没有闭环回答“这次回放是否降低未来任务损失”。
其中 timeline replay 会把前面 priority-sampled raw transcript 覆盖掉；reflection 的 activation top-3 还可能混入与本 episode 无关的全局高激活 trace。
所以当前不能把 replayed 计数当成“巩固收益”。

### 7.5 皮层侧实况

Harmonic 是**长期语义文本知识库**，不是慢学习分布式皮层。reflection、dream、axiom、grace、reconsolidate 和 judge 都是批处理文本/判定流水线。
较接近“慢统计”的是 ACT-R 结算、energy decay、schema cluster、支持度/能力统计；但当前参数与任务结果的连接仍弱。
真正值得增加的皮层侧机制不是更多 gist，而是**带独立 episode/session/day 支持度、来源和矛盾边的慢统计/schema**。

## 8. 海马体—皮层机制对照

| 机制 | 神经科学中的不变式 | 当前 MAFW | 判断 |
|---|---|---|---|
| 快速绑定 | 便宜、高保真、内容无关；索引与内容分开 | raw T1 append/archive + trace 指针 | **保留，最对齐** |
| 模式分离 | 易混输入得到可区分表征；不是固定 top-k 配额 | 12 concept/sem tags；learned k-WTA P1 失败 | **不成立；优先用标识符、版本、时间与 distinct_from** |
| 线索补全 | 部分线索恢复存储模式，同时有误补全风险 | FTS/dense/RRF + 有界 1-hop 邻居 | **可作功能近似，不是 CA3 吸引子；需精确率与停止规则** |
| 慢学习/图式 | 跨事件共享统计/参数，支持泛化；图式调节巩固 | 主要是离散文本 unit 与级联摘要 | **只能称长期知识库；schema 应是支持度图而非更多摘要** |
| 选择性巩固 | 离线、有预算、按未来需要选择，存在干扰成本 | 多个 cron 与 replay 计数，缺任务结果闭环 | **保留快慢时间尺度，收敛为一个 consolidate + 一个 reconcile** |
| 再巩固/遗忘 | PE 门控更新；加法式链接旧迹；遗忘首先是可提取性下降 | soft supersede 很好；部分 rewrite 丢来源，decay 参数未标定 | **保留 soft supersede，统一 PE/provenance，不物理删 raw** |

### 8.1 脑类比有工程价值的地方

- **索引 ≠ 内容**：raw 不可变，派生索引可重建，检索最终能兑现原始证据。
- **快写慢学**：热路径便宜，语义巩固离线且有预算。
- **选择性巩固**：不是所有经历都值得生成新 unit；优先级最终要由未来需要与结果价值约束。
- **PE 门控 + 加法式更新**：检索本身不应自动改写；更新用新版本和来源链，不覆写旧证据。

### 8.2 应停止的类比

- “LLM 摘要就是皮层”：文本摘要没有因此获得重叠分布式表征或插值泛化能力。
- “固定 top-k/12-anchor 就是 DG”：稀疏配额不等于对易混输入去相关；本仓 P1 已给出负结果。
- “ANN/PPR 返回邻居就是 CA3 补全”：候选扩展需要来源、置信和误报评估。
- “dream 这个名字证明 REM 重组有价值”：当前实现只是查询预测/缓存预热。
- “更多离线作业就是更多巩固”：离线只是时间位置，不是收益证据。

## 9. 建议顺序（本轮不执行）

### A. 先修正确性与可审计性

1. 修 reflection 游标分页、dream 的真实 row contract，并用真实 DB 行形状补测试。
2. 所有 reconcile rewrite/merge 强制保留 `source_trace_ids` 并集、authority 与 producer/version；无法归属时宁可缺省，不伪造 episode 边。
3. 统一 shadow/live/off：shadow 不应一边称“不影响行为”，一边驱动生产 reflection 写入。

### B. 做低风险减法

1. 停止或抽样无人消费的 novelty/mismatch/surprise 与 dense-shadow 全量计算；保留旧数据读取，先做显式层评测再决定永久删除。
2. 复用 turn embedding，合并三次 feature upsert 与重复全表扫描。
3. 合并 route-write/consolidation 重复 judge；把多套 reconcile 收敛为同一写回与预算。
4. 当前 dream 虽是 enabled cron，但结构性 no-op；建议关闭。若未来要启用，先修 row contract，再单独证明预取收益；不要为它增加“生成式重组”。
5. 不删 raw T1、archive、FTS、trace 指针与 soft supersede。

### C. 再做价值实验

先做层覆盖率与成本/延迟测量，再做 gist-vs-raw、leave-one-producer-out、记忆级 paired ablation。
现有 P1 的教训保持不变：内在 AUC 或“更像大脑”都不是上线理由。

## 10. 文献来源（子代理经 Crossref 核验）

- McClelland, McNaughton & O'Reilly (1995), CLS：[`10.1037/0033-295X.102.3.419`](https://doi.org/10.1037/0033-295X.102.3.419)
- Kumaran, Hassabis & McClelland (2016), CLS 更新与图式：[`10.1016/j.tics.2016.05.004`](https://doi.org/10.1016/j.tics.2016.05.004)
- Teyler & DiScenna (1986), hippocampal indexing：[`10.1037/0735-7044.100.2.147`](https://doi.org/10.1037/0735-7044.100.2.147)
- Yassa & Stark (2011), pattern separation：[`10.1016/j.tins.2011.06.006`](https://doi.org/10.1016/j.tins.2011.06.006)
- Nakazawa et al. (2002), CA3 与部分线索召回：[`10.1126/science.1077358`](https://doi.org/10.1126/science.1077358)
- Tse et al. (2007), schema 与快速皮层学习：[`10.1126/science.1135935`](https://doi.org/10.1126/science.1135935)
- Rasch & Born (2013), sleep 与记忆巩固：[`10.1152/physrev.00032.2012`](https://doi.org/10.1152/physrev.00032.2012)
- Yang et al. (2024), SWR 选择性：[`10.1126/science.adk8261`](https://doi.org/10.1126/science.adk8261)
- Sevenster et al. (2013), PE 门控更新：[`10.1126/science.1231357`](https://doi.org/10.1126/science.1231357)
- Nadel & Moscovitch (1997), 多痕迹/反对简单“搬家式”巩固：[`10.1016/S0959-4388(97)80010-4`](https://doi.org/10.1016/S0959-4388(97)80010-4)
- Ryan et al. (2015), 存储与可提取性分离：[`10.1126/science.aaa5542`](https://doi.org/10.1126/science.aaa5542)
- Richards & Frankland (2017), 功能性遗忘：[`10.1016/j.neuron.2017.04.037`](https://doi.org/10.1016/j.neuron.2017.04.037)

相关仓内证据：`docs/releases/2026-11-19-engram-p1-result.md`、`docs/research/2026-11-19-hippocampus-cortex-vs-mafw.md`、`docs/research/2026-11-19-atom-parameter-audit.md`、`docs/research/2026-11-19-post-p1-deep-think-kimi.md`。

## 11. 方法与边界

- 三个独立子代理均使用 `gateway/volcengine/deepseek-v4.1-flash`，分别审计 T1/turnCompress、夜间管线、机制文献；父会话抽查了关键代码并采集运行 stats/log。
- 本报告没有改生产代码、配置或记忆数据；发现的 bug 是审计线索，不应被误述为已修复。
- 运行数字是不同审计时点的工作快照，会随系统运行变化；它们用于揭示结构与成本，不作为长期率估计。
