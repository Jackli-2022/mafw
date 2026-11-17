# 记忆“值得记住”的信号与评估：调研

> 2026-11-19。触发：MAFW E2 的三个编码期信号（novelty / mismatch / surprise）在扩充验证集后全部落在随机附近；
> episode 级、同 session 内的 `novelty max` 0.738 是唯一亮点。本文回答“为什么”，并对照 2025–2026 的做法给出下一步。
> 所有外部数字均为论文/项目自报，未在我们数据上复测。

## 1. 我们的测量（事实）

- turn 级，标签“该轮产出的 unit 存在”（91 正例）：novelty 0.434 / mismatch 0.555 / surprise 0.559；
  **文本长度 0.619**、观测数 0.591；同 session 内长度 **0.796**。
- 信号与长度几乎不相关（corr 0.05 / 0.007）：它们量的是另一根轴，但那根轴对标签没有预测力。
- episode 级（373 正例，其中 73 个有信号）：全局 AUC 仍低；**同 session 内** `novelty max` 0.738、`surprise max` 0.698，
  高于体积基线（turns 0.643、length 0.665）。
- 标签本身是代理：unit 由反思 worker 按批次写，不是逐轮判定；检索标签只有 86 个正例。

## 2. 文献怎么看“值得记住”

### 2.1 写入准入：多因子，而不是单一 novelty

- **A-MAC**（arXiv:2603.04549，2026）把候选记忆的打分拆成 **Utility / Confidence / Novelty / Recency / Type Prior**，
  用一个**学习到的线性准入策略**组合；LoCoMo F1 0.583，比 A-Mem 高 0.042，延迟低 1187ms。
  → novelty 只是五分之一，且权重是学的。
- **Generative Agents**（Park et al., 2023）用 LLM 自评 importance（整数），再与 recency、relevance 加权检索。
- **LUFY**（Sumida et al., 2024）用情绪唤醒与 surprise 驱动选择性保留；**SAGE**（2026）把 novelty 做成“记忆演化门”。
- 结论：主流做法里，**novelty 从不单独承担“该不该记”**；它和 utility/confidence/type 一起工作，权重来自监督或标注。

### 2.2 surprise 的正确用法：分段，不是打分

- **EM-LLM**（ICLR 2025，arXiv:2407.09450）用 **Bayesian surprise** 做**事件边界检测**，再用图论细化边界；
  在人类感知的事件边界上与人工标注高度一致。surprise 在这里回答“哪里切段”，不是“哪段值得记”。
- 强化学习的 **Prioritized Experience Replay**（Schaul et al., 2016）用 **TD error** 当优先级——
  这是“预测与目标之差”，需要值函数；文本 embedding 的余弦距离只是一个廉价代理，二者不等价。
- 结论：我们把 surprise 用来排序“回放优先”，但文献里它的强证据在分段；要做回放优先级，需要**任务结果**（reward/verdict）而不是文本距离。

### 2.3 标签：记忆评估本身是瓶颈

- **MemoryArena**（arXiv:2602.16313，2026）：在 LoCoMo 上接近饱和的模型，到多 session agentic 任务里任务成功率只有 0.00–0.12。
- **ACL 2026**《How Memory Management Impacts LLM Agents》指出：未来任务评估可以作为**免费的质量标签**；
  并报告“misaligned experience replay”——看似正确的执行记录可能提供误导性经验。
- **Grounding Agent Memory**（arXiv:2609.11060，2026）用 propose–probe–commit：让 curator 到环境里**探测**再决定是否入库，
  CLBench 通过率 73% vs 39%。
- 结论：我们缺的不是更好的标量，而是**结果标签**。“unit 存在 / 被检索 / session 有产出”都太间接。

### 2.4 episode / event 粒度

- **LycheeMemory V2**（arXiv:2608.12990）做在线语义分段 + segment-level 记忆编码；**HiGMem**（arXiv:2604.18349）分 turn/event 两层，
  用 event summary 作为 turn 选择的锚点。两者都说明：**写入与评估的粒度应当一致**。
- 我们的结果与此吻合：episode 级、同 session 内的 `novelty max` 明显好于 turn 级全局。

## 3. 为什么我们的信号失败

1. **标签偏置**：unit 由批次写入，长度/观测数比任何语义距离都更能预测“是否产出 unit”（同 session 内 0.796）。
2. **代理错位**：novelty 是“与已有知识的距离”，mismatch 是“线索/正文的差”，surprise 是“与上一轮的差”；
   三者都不含 utility（这个信息以后用不用得上）与 confidence（来源可不可信）。
3. **表示太粗**：整轮 embedding 被工具输出长度主导；决策、错误、偏好这些“值得记”的要素没有进入向量。
4. **评估循环**：回放本身已按 salience 选过，unit 又由 LLM 批量写，标签里混入了策略与批次效应。

## 4. 对 MAFW 的建议（按性价比）

| 优先级 | 做法 | 落点 | 预期 |
|---|---|---|---|
| P0 | 反思/回放排序改用 **episode 级** `novelty max` + 体积项，仅 shadow | `t1-episode` 聚合 + `replayPriority` flag | 同 session 0.74，先测不启用 |
| P1 | 引入**结果标签**：goal verdict / 任务成功失败 / 用户追问 作为 free label | `goal_node_runs` + `t1_retrieval_events` | 打破代理标签循环 |
| P2 | 写入准入改多因子（utility/confidence/novelty/recency/type），先用规则再用学到的权重 | consolidation / reflection gate | 对齐 A-MAC，但需要标注 |
| P3 | 环境探测式入库（propose–probe–commit） | 对可验证事实（命令、路径、API）先探测再写 | 成本高，适合高价值条目 |
| 不做 | 用惊喜值做 episode 分段 | — | EM-LLM 已证明分段有效，但我们的分段靠声明 + 推断，收益不在排序 |

## 5. 结论

- **“算得太简单”只说对了一半**：余弦距离确实丢掉了 utility/confidence/结果；但即使换成 session 内 surprise，turn 级仍然打不过长度。
- 真正缺的是**评估层级与标签**：episode 级 + 同 session 比较已经接近可用（0.738），但需要 100+ 正例和结果标签才能决定是否上生产。
- 下一步最小实验：用 goal verdict 给 episode 打成功/失败标签，测 `novelty max` 是否能区分“成功 episode”与“失败 episode”；
  这比继续调文本信号更有信息量。

## 参考

- A-MAC: Adaptive Memory Admission Control for LLM Agents, arXiv:2603.04549
- EM-LLM: Human-inspired Episodic Memory for Infinite Context LLMs, ICLR 2025, arXiv:2407.09450
- Prioritized Experience Replay, Schaul et al., arXiv:1511.05952
- MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks, arXiv:2602.16313
- Grounding Agent Memory: Environment-Probing Curation for Enterprise Agents, arXiv:2609.11060
- LycheeMemory V2, arXiv:2608.12990；HiGMem, arXiv:2604.18349
- How Memory Management Impacts LLM Agents, ACL 2026（future task evaluations as free labels）
- Generative Agents, Park et al., 2023；LUFY, Sumida et al., 2024
- 本仓：`docs/releases/2026-11-19-session-surprise.md`、`docs/releases/2026-11-18-t1-novelty-mismatch.md`
