# 记忆系统差距三路调研：A 休眠机制 / B 结构性差距 / C 否决项复核（2026-09-29）

> **方法**：三路并行文献+系统调研（A：休眠机制接线；B：脑-结构性差距；C：被实测否决机制的边界条件复核），
> 每路独立检索 arXiv API / NCBI eutils（Europe PMC 部分被拒 403）并逐条核验引用。
> 前序：`2026-09-23-brain-vs-ai-memory-survey.md`（三方对照）、`2026-09-27-read-path-brain-alignment.md`（R5–R8 依据）、
> R1–R8 读路径交付实测（spec §0）。
> 本报告回答：**每个差距接不接、怎么接、什么条件重启**。

---

## 0. TL;DR

1. **A3 检索访问加成是 P0，但必须改数学形式**：线性 `+0.02/次` 是最差形态（无界、正反馈、写放大）。
   正解 = ACT-R 对数式（`B = ln Σtⱼ⁻ᵈ`，Anderson 正典）+ 并入既有每日衰减 pass 批结算 + 曝光惩罚防 popularity bias。
2. **B1 新旧交错回放是下版本主题**（三线证据最厚：CLS [Established] + RL 实证五篇 + agent 记忆三篇 MemDream/EngramRAG），
   且 A3/B4 都是它的下游——三者构成"检索事件 → 能量 → 回放优先级"闭环，正是 09-23 调研预言的"从检索层优化转向学习动态"的跳板。
3. **C 路四项否决全部维持，无一过度概括**——但 C1（查询改写）/C3（邻居捆绑）属"条件性否决"，重启条件已量化。
4. **两个删/合决定**：`top_associations` 删字段（预存静态链接被新证据反对）；`review_count/last_reviewed` 并入 stale-verify 作调度状态（不建新管线）。

---

## 1. A 路：休眠机制接线

### A3 检索访问加成（retrieved +0.02 未接线）—— ★P0，改形式接

**文献**：
- **ACT-R base-level activation**（`B = ln Σtⱼ⁻ᵈ`）[Established]——每次访问贡献随时间幂律衰减项，对数求和天然防爆；
  工程实证：1.7M Last.fm 事件（arXiv:2108.02138）、PISA 嵌入 Transformer 生产部署于 Deezer（arXiv:2408.16578, RecSys 2024）
- **popularity bias 反馈循环危害**：多样性下降、同质化、少数群体受害更深（arXiv:2007.13019）；
  exposure-aware retrieval A/B 实测热门主导 -40%、独特物品 +25%、参与度不降（arXiv:2503.23630）
- **零写放大对照**：Generative Agents（arXiv:2304.03442）检索分 = recency×importance×relevance，**查询时现算不回写**
- deferred/batched strengthening 直接文献**未找到**（诚实标注）；最接近即上述两种零写盘形态
- MemoryBank（arXiv:2305.10250）Ebbinghaus+reinforce 先行者，但无严格消融 [弱证据]

**设计**：
1. `searchScored` 出口收集命中 id + reranker top1 概率 → 内存 ring buffer（100ms 契约内，零落盘）
2. **并入每日 UTC 3:30 衰减 pass 结算**（pass 已存在，零新增调度）：事件不直接 `energy += 0.02`，
   而是 ACT-R 式——条目记 `retrieval_ts[]`（或摊销为 last_retrieved_at + count），结算时
   `bonus = min(cap, ln(1 + Σ e^(-λ·Δt))·k)`，高置信命中加权多（与 A1 调度信号同源）
3. 结算同步做**曝光惩罚**：本周期内已被注入 ≥N 次的条目折扣，防 rich-get-richer

**判定：接线 P0（对数式 + 每日批结算 + 曝光惩罚）**。

### A4 FOK 阈值校准—— P1

**文献**：
- Know Before You Fetch（arXiv:2606.29959，与我们三区门直接同构）：out-of-fold 校准 ECE 0.275/0.643/0.711 → 0.062/0.009/0.031；
  警示：gating 不总赚（Qwen3-8B +27% 延迟 vs 32B -8%）——**校准后按真实成本模型选 operating point**
- Conformal Abstention（arXiv:2405.01563, DeepMind）：几百个校准点即得有限样本保证（区间粒度 ~1/(n+1)）
- **分组校准崩溃警告**（arXiv:2608.19376）：marginal coverage 0.86 下 worst-class ≈0；分组（Mondrian）校准需要**每组真实标签**，
  样本不足的分组校准反而崩溃
- 动态阈值 RL 降校准误差 70–85%（arXiv:2502.06884）——进阶选项

**设计**：离线脚本消费生产 FOK 日志（zone + top1prob）拟合 `P(命中 | top1prob)` isotonic 替换固定阈值；
全局保底，LongMemEval 6 类分组**只监控 ECE，某组 ≥300 样本才给独立阈值**；LongMemEval 30 弃权题做种子；
重训必 out-of-fold。目标 = 拒答区 precision（当前 0.967 仍有头部空间）。

**判定：接线 P1（纯离线、低风险、日志已在积累）**。

### A1 复习队列消费者（review_count/last_reviewed）—— P2 并入 stale-verify

**文献**：HLR 调度信号是**事件（练习对错）非纯时间**（Settles & Meeder, ACL 2016, DOI 10.18653/v1/P16-1174；
*注意引用纠错：arXiv:1602.01070 是 q-fin 论文，非本文*）；最优复习时刻由**回忆概率**给出（arXiv:1712.01856）；
复习预算必须 cap——新内容引入超复习吞吐存在**尖锐相变**（arXiv:1602.07032, KDD 2016）；
SRT（arXiv:2608.17530）：SM-2 + per-example review state 用于 LLM 持续预训练 replay，恢复 5–37pp 旧知识——
**AI 系统里 SR 调度最直接的消融实证**；Mem0（arXiv:2504.19413）无周期复习管线——MAFW stale-verify 已是同族。

**设计**：不建新管线。`review_count`/`last_reviewed` 直接作 stale-verify 调度状态；
下次验证时间 = f(回忆概率)（A3 事件流免费供给）；每周 top-10 cap 保留（相变教训）。

**判定：P2 合并，不新建**。

### A2 top_associations—— 删字段

**文献**：HippoRAG PPR multi-hop +20%（arXiv:2405.14831）；HippoRAG 2 修复图 RAG 在基础事实任务上的退化（arXiv:2502.14802）——
图扩展收益集中在关联/多跳，单跳曾负收益；**SYNAPSE（arXiv:2601.02744）主张 relevance 应来自动态扩散激活而非预存链接**；
query-blind 图遍历是噪音源，query-语义门 F1 +3.6~7.4 且延迟降 1.5–4.9x（arXiv:2606.30133）；
经典 spreading activation 引入无关概念，query 约束版 MAP +43.8%（arXiv:1808.01968）。

**判定：删字段**（或降级为共现统计仅日志）。预存静态链接恰是被新证据反对的形态；
写放大 + supersede 链不传播到链接表的成本真实；未来多跳走 query-aware 动态激活（cue_anchors 迭代扩展已覆盖 hop-1）。

---

## 2. B 路：结构性差距

### B1 新旧交错回放—— ★下版本主题

**神经科学**：CLS 奠基（McClelland et al. 1995, PMID 7624455）[Established]；回放不均匀——
**need（即将用到）× gain（价值）** 优先采样（Mattar & Daw 2018, Nat Neurosci, PMID 30349103）[Well-supported]。

**AI 实证**：PER 按 TD-error 优先回放 DQN 41/49 胜均匀（arXiv:1511.05952）；
**交错比例不是越大越好**——静态高 replay ratio 致 catastrophic plasticity loss，Adaptive RR 动态调整最优（arXiv:2310.07418）；
primacy bias——早期经验反复回放后主导（arXiv:2502.00802）；
sleep-time compute 离线摊销测试时成本 ÷5、精度 +13~18%（arXiv:2504.13171, Letta）；
**MemDream** 离线"梦循环"修复记忆图，LoCoMo +4.5 F1（arXiv:2609.34545）；
**EngramRAG** CLS 双态（Waking 反思 + 异步 Dreaming 巩固），SUPERSEDES DAG 把 fact-mutation split-brain 幻觉 70%→0%（arXiv:2609.32049）；
4MAS awake/sleep 遗忘减半（arXiv:2608.19514）。
**风险**：回放增加表征重叠、侵蚀模式分离（arXiv:2509.00047）；新旧混合数据产生 domain shortcut（arXiv:2607.22994）。

**设计**：turnCompress 每小时 batch 不只喂新回合——按 `priority = need(近期 cue 命中，A3 事件流) × gain(salience) × 1/energy`
采样 3–5 条旧记忆注入同一 worker prompt；任务从"总结新回合"扩为**"对照旧记忆做 UPDATE/CREATE/supersede 决策"**——
ConsolidationService（judged 62/update 0）挂进这条链变成批量裁判（顺带解决 D-② 的空转问题）。
风控：回放配额上限；被回放记忆盖 `last_replayed` 戳防 primacy bias；旧记忆只作对照证据不重写原文（防 domain shortcut）。

**判定：下版本主题**——理论 [Est] + 跨域实证八篇 + 我们最深结构缺口（单向删除通道）+ 明确最小改动路径。

### B4 隐式奖励调制—— 中期切片（搭 B1 便车）

**神经科学**：多巴胺在**编码时**调增益且预测后续记住（Adcock et al. 2006, PMID 16675403）[W-s]；
奖励可**回顾性**增强先前无关事件巩固（Murayama & Kitagami 2014, PMID 23421444）[W-s]；
奖励越高越优先回放（Mattar & Daw）。

**AI**：ExpeL outcome→insights 单调提升（arXiv:2308.10144）；SkillGLoW commit gate——经验 prior 须执行证明不降级才入库（arXiv:2609.02217）；
ArenaFlow 分层 credit propagation（arXiv:2609.21378）；ScrubJay-MEM utility-horizon 类型条件衰减（arXiv:2608.04746）。

**设计**（不对称小步）：`archiveGoal(verdict=COMPLETED)` → goal 关联记忆（goal_sessions ⋈ source_session_id）
energy +0.05~0.1（量级对齐 useful_feedback 的 +0.1，逐条上限防马太）；**失败不降权**（防错误归因——失败 goal 里的正确记忆不该被罚）；
进阶再学 ArenaFlow 按 cue 主题重叠分配 δ。奖励后的记忆获得回放优先级（need×gain 正是此意）——与 B1 天然耦合。

**判定：中期切片**——接线便宜、风险可控，但需 B1 回放通道配合才理论完整。

### B6 回源证据链—— 中期切片（hop-2 检索层继续搁置）

**AI**：CueMem 把记忆条目当"检索线索而非自足证据"，cue→源 turn 图扩展重建证据上下文（arXiv:2609.12354）；
EdgeMem 完全保留原始回合、零生成 LLM（arXiv:2609.05553）——两者共同主张**"摘要丢证据，源回合才是证据"**；
provenance-bound authorization 把记忆污染攻击成功率 11.0%→2.0% 且保留 92.1% 正常操作（arXiv:2609.32186）；
**池饱和外部互证**：技能池 5→100 时使用精度 29.6%→3.3%（arXiv:2608.14036）——大池上扩展的边际收益被候选精度崩塌吃掉。

**设计**：`mafw_get_memory` 高利害决策（改代码/写配置）时附"回源"能力——按 source_session_id 拉原始回合片段；
hop-2 检索层只在 k≤3 小候选集 / round 粒度 / LongMemEval-M 上重测（避开饱和池）。

**判定：回源优先接线（低风险），hop-2 检索层搁置**。

### B2 模式分离修正—— 中期切片（补"关系可见性"）

**文献**：DG 正交化正典（O'Reilly & McClelland 1994, PMID 7704110）[Established]；
知识冲突文献共识**不合并、显式建模冲突**：ConflictRAG 检测 90.8%、成本 -62%（arXiv:2605.17301）；
**MemoryLACE** 把 merge/supersession/contradiction 作一等关系，检索时展开 current/historical/supporting/conflicting 证据单元（arXiv:2609.03201）；
反面警示：**重复会翻转可信度**——低可信信息重复呈现后 LLM 偏好反转（arXiv:2601.03746），合并/强化旧记忆有放大错误风险；
68% 冗余可剪且保留 98% QA EM（arXiv:2608.22215）——合并不必推翻。

**设计**：不推翻 MinHash 合并，补**检索出口的关系展开**——命中条目按需展开 supersede 链历史版本 + 冲突标注
（现在只有链头改写，历史版本靠 R6 呈现层捎带），写端可再学 AutoViewMem 在 cue_anchors 层解缠（arXiv:2609.21940）。

**判定：中期切片**。

### B5 工作记忆层—— 搁置（做快照可写化即可）

CoALA（arXiv:2309.02427）WM 接口规范；MemGPT OS 式分层（arXiv:2310.08560）；
**EnterpriseMem-Bench**（arXiv:2605.26344）五前沿模型三路消融：无记忆多轮任务第 3 轮崩零，
**WM 主导效果但追加组件效果模型/数据依赖（+14~-16pp）、复杂度不单调**；
VISTA 类型化 WM 块 22.7→50.7%（arXiv:2606.30005）；HORMA ≤22% token 更优（arXiv:2606.11680）。
→ WM 主收益已被 goal-snapshot + note-board + R8 快照吃到大半；
补齐方向 = 把 R8 快照从只读缓存升级为**可写 task-state block**（worker 显式更新/淘汰），成本远低于新建层。

**判定：搁置（低配改良）**。

### B3 检索诱导遗忘（RIF）—— 搁置

机制本身 [Contested]（Rowland et al. 2014, PMID 25484872 质疑可靠性）；
**AI 全站零实现**（arXiv 检索 "retrieval-induced forgetting" 无结果）；
直接反例：Cinel et al. 2018（PMID 29745709）——augmented memory 交互复习系统里 RIF **误伤之后需要的竞争者**，是副作用非功能。
三缺（功能存疑、零先例、有反例）→ 纯投机，不做。

---

## 3. C 路：否决项复核

| 项 | 结论 | 关键证据 | 重启条件 |
|---|---|---|---|
| **C1 查询改写** | **维持否决** | 强基线（含 reranker）下改写单独使用至多持平：multi-query+RRF 的召回增益"被 rerank 与截断大量中和"，Hit@10 反降 0.51→0.48（arXiv:2603.02153）；企业数据四策略 UNION +12.5 但单策略持平（arXiv:2609.05637）——我们的栈（BM25+dense RRF+Qwen3-Reranker）正是中和条件 | ①BM25 top-1 低置信才触发（门控路由 <40% 成本拿一半增益）②多改写 UNION 非单改写 ③只走快照路径（2s 防抖，不碰 100ms 契约） |
| **C2 近因加权** | **维持否决** | 检索层 recency **无生产先例**：Mem0 纯语义相似（arXiv:2504.19413 全文核）、Zep 双时态 KG、RoMem 明言"按 recency 排序会埋没旧的永久知识"（arXiv:2604.11544）、EngramRAG 拓扑承重半衰期（arXiv:2609.32049）；盲测 regime 下 recency 是最差单因子（保留 0.368 gold vs 学习价值函数 0.770，arXiv:2606.12945） | 无——recency 的正当地位在写侧遗忘 + 呈现层"优先最近"指令，两者 MAFW 均已保留 |
| **C3 邻居捆绑（检索层）** | **维持否决（session 粒度）**，**测量面错配非机制无效** | EdgeMem +8.44 是 LoCoMo **turn 粒度端到端答题**增益，其检索指标为 session 级 **k=3**（"rank-3 doubles as small-budget test"）；rerank 增益随预算急剧收缩（保留 3/30 候选 +17.4，充裕预算 +1.5，arXiv:2609.34227）；我们 recallK=50 对 50 会话池饱和——R@10 session 粒度对该机制天然不敏感 | 换 **round 粒度 + R@3** 评测面重测（EdgeMem 确切条件）。最小实验：LongMemEval-S round 粒度真值重算 R@3，±1 邻居 on/off，50 题 |
| **C4 沉默 vs 声明** | **维持（声明不撤回）** | 与 Sufficient Context 的 selective generation 同构——已答问题正确率 +2~10% 溢出，与我们可答题 +0.023 同向（arXiv:2411.06037）；其 "useful context" 类直接支持"声明+保留上下文"组合；过度弃答风险已被实测排除（EdgeMem 保守规则损失 8 judge 分 vs 我们可答题微升）；陈旧记忆风险归 supersede 链不归 FOK——职责分离正确 | 无（唯一未闭环项=声明对用户的锚定效应，HCI 实证缺口） |

**C 路总判定**：四项否决均不过度概括；C1/C3 属条件性否决，重启条件与最小验证实验已给出。

---

## 4. 综合优先级（三路合并）

### 共享基础设施洞见

**A3、A1、B1、B4 消费同一条"检索事件流"**：

```
searchScored 出口 → [命中 id + reranker 概率 + 时间戳] ring buffer（内存，零落盘）
        │
        ├─ A3：每日衰减 pass 结算 → ACT-R 对数加成 + 曝光惩罚 → energy
        ├─ A1：回忆概率 → stale-verify 下次验证时间（review_count/last_reviewed 当调度状态）
        ├─ B1：need 信号 → 回放采样优先级（need × gain × 1/energy）
        └─ B4：archiveGoal(COMPLETED) → energy +δ → 反哺回放优先级
```

先建"检索事件 buffer + 每日结算"这一层（A3），A1 调度免费获得，B1/B4 是它的下游消费者——
这正是 09-23 调检预言的**"从检索层优化转向学习动态"**的完整落点。

### 行动清单

| 优先级 | 事项 | 工作量 | 依据 |
|---|---|---|---|
| **P0（本周）** | A3 检索事件 buffer + ACT-R 对数结算 + 曝光惩罚 | ~1-2 天（含测试） | ACT-R 正典 + 零新增调度（搭衰减 pass 便车） |
| **P0（本周）** | D-② consolidation 零 UPDATE 审计（前一张清单遗留，B1 的前提） | ~半天 | judged 62/update 0，B1 批量裁判要挂这条链 |
| P1 | A4 FOK isotonic 离线校准（日志攒够后） | ~半天 | ECE 0.71→0.03 量级的既证收益 |
| P1 | A2 删 `top_associations` 字段（+ A1 字段语义并入 stale-verify 文档） | ~半天 | 预存链接被新证据反对 |
| **下版本主题** | B1 交错回放（turnCompress 重构：新回合 + 3-5 条按 need×gain×1/energy 采样的旧记忆 → 对照决策） | spec + 多切片 | 三线证据最厚；B4 顺路挂载 |
| 中期切片 | B4 奖励调制（archiveGoal → +δ，不对称+上限） | 1 切片 | 与 B1 耦合 |
| 中期切片 | B6 回源（mafw_get_memory 附 source_session_id 证据片段） | 1 切片 | provenance 安全 + CueMem/EdgeMem 同构 |
| 中期切片 | B2 检索出口关系展开（supersede 历史 + 冲突标注） | 1 切片 | MemoryLACE/EngramRAG |
| 可选验证 | C3 round 粒度 R@3 邻居重测（50 题） | ~半天 | 测量面错配的闭环验证 |
| 不做 | B3 RIF、B5 独立 WM 层（只做快照可写化）、C1/C2/C4 重启 | — | 见上文 |

---

## 5. 参考文献（本报告新引，已核验）

**A 路**：arXiv:1712.01856 · 1602.07032 · 2608.17530 · 2504.13171 · 2504.19413 · 2405.14831 · 2502.14802 · 2601.02744 · 2606.30133 · 1808.01968 · 2108.02138 · 2408.16578 · 2305.10250 · 2007.13019 · 2503.23630 · 2304.03442 · 2606.29959 · 2405.01563 · 2502.06884 · 2608.19376 · DOI 10.18653/v1/P16-1174（HLR）

**B 路**：PMID 7624455 · 30349103 · 16675403 · 23421444 · 23589831 · 7704110 · 29745709 · 25484872 · arXiv:1511.05952 · 2007.06700 · 2310.07418 · 2502.00802 · 2404.09715 · 2509.00047 · 2607.22994 · 2609.34545 · 2609.32049 · 2608.19514 · 2605.17301 · 2609.03201 · 2601.03746 · 2608.07622 · 2608.22215 · 2609.21940 · 2608.04746 · 2308.10144 · 2609.02217 · 2609.21378 · 2309.02427 · 2310.08560 · 2605.26344 · 2606.30005 · 2606.11680 · 2604.11462 · 2605.07042 · 2609.07471 · 2604.00016 · 2609.12354 · 2609.05553 · 2609.32186 · 2608.14036

**C 路**：arXiv:2003.13624 · 2006.05009 · 2112.08558 · 2509.22325 · 2502.15009 · 2609.05637 · 2510.23998 · 2212.10496 · 2603.02153 · 2604.06097 · 2606.11945 · 2606.28352 · 2607.08032 · 2509.25250 · 2607.29600 · 2604.11544 · 2606.12945 · 2606.10299 · 2410.10813 · 2411.06037 · 2608.22228 · 2607.18240 · 2410.02173 · 2405.02228 · 2609.34227

*未核验项：CueMem 消融数字（81.1→71.4）在摘要中未复现（方向确认）；van de Ven generative replay 系列具体条目未抓到（以 2026 新文献替代）。均不影响结论方向。*
