# 读路径脑对齐调研：元记忆监控 / 情景上下文复原 / 线索抽取 / 预测预取（2026-09-27）

> **方法**：四路并行调研（神经科学 + AI 系统双线），为读路径重构 spec 提供依据。
> 前序：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（三方对照总览）、
> `docs/superpowers/specs/2026-09-24-read-path-restructure-design.md`（R1–R5 实测）。
> 本文覆盖四个候选方向：**R5 FOK 元记忆门、R6 情景上下文复原、R7 确定性线索抽取、R8 预测性预取**。

---

## 0. TL;DR

1. **上下文复原（R6）证据最强**：CueMem 去图扩展 81.1→71.4；EdgeMem episode 通道 +8.4（最大单步）；且只加一句"优先最近版本"呈现指令就值 knowledge-update +6.4 / temporal +6.8。**此前"temporal/multi-session 非检索层可修"的结论被推翻**。
2. **FOK 门（R5）必须在代码里，不在 prompt 里**：LLM 自报置信度只是题目难度的一阶代理（arXiv:2605.24299）；mPFC 损伤 = 自信虚构，正是 LLM 失败模式。用 reranker top1 概率 + margin 校准后做三区门，弃答时**显式注入"无可信记忆"块**（沉默是错的）。
3. **线索抽取（R7）做减法不做扩展**：确认 R1 否决（CAsT：自动改写比人工差 35%）；该做的是 query reduction——抽取路径/标识符/引号串加权保留（Kumaran & Allan 2008），最大杠杆是标识符感知分词（arXiv:2605.18561）。逐字 token 几乎必然也在写入 trace 里——**这是编码特异性的工程形式**。
4. **预测预取（R8）是延迟优化不是质量优化**：用户最后一句话只含 session 词汇的 36%（arXiv:2607.22392）→ 快照 query 必须用滚动 N 轮 + goal 快照。不提升 R@1，优先级最低。

---

## 1. 元记忆监控（FOK 门）

### 1.1 脑机制

- **Nelson & Narens 1990**：元记忆 = 监控 + 控制两层。
- **Koriat 1993**（可及性启发）：FOK **不是**痕迹强度的直接读出，而是从"检索产出的部分信息量与流畅度"推断——脑门控在"检索是否产出了有结构的候选"，不在校准概率。
- **Schnyer et al. 2004**（PMID 14998710）：右 mPFC 损伤患者 FOK 准确性选择性受损而回忆完好——元记忆与记忆本身可分离。
- **Maril et al. 2005**（PMID 15670690）：舌尖现象/FOK 激活前 PFC/ACC（努力信号），成功回忆激活 MTL（找到信号）——**"在搜"与"搜到"是分离信号**。
- **Ubaldi et al. 2022**（PMID 35552235）：检索失败上调语义控制网络——失败检测触发升级（继续搜或显式"不知道"）。
- mPFC 损伤的表型 = **自信虚构**，正是检索不到时 LLM 的失败模式。

### 1.2 AI 证据

| 来源 | 发现 |
|---|---|
| **arXiv:2411.06037**（Sufficient Context, Google） | 强模型在上下文不足时**臆造而非弃答**；充足性信号做选择性生成，答时准确率 +2~10% |
| **arXiv:2606.29959**（Know Before You Fetch） | 原始不确定性信号校准极差（ECE 0.71），**out-of-fold 校准后 ECE 0.01–0.06** 才可用；先校准再设阈 |
| **arXiv:2608.22228**（GRAB-RAG） | prompt 式弃答在误导性上下文下崩溃（41.6% 照答）→ 门必须是**检索时的结构门**，不能被 LLM 覆盖 |
| **arXiv:2605.24299 / 2510.09033** | LLM **无个体化元认知**：口头置信度是题目难度的一阶函数；"在回忆某物"与"回忆为真"内部状态不可分 → **门必须外置** |
| **arXiv:2501.12835**（AdaRAG-UE） | 35 种自适应检索方法基准：简单不确定性信号与复杂管线打平——**便宜信号够用** |
| **arXiv:2609.24259**（MemCalib） | 前沿模型系统性 over/under-use 注入记忆；门是其上游互补（决定是否注入） |

### 1.3 最小设计（对 MAFW）

- **特征**：reranker top1 概率 + top1−top2 margin（Koriat 的工程形式）；**不用原始 BM25 分**（跨 query 不可校准）。
- **校准**：isotonic 回归，用自身日志的 (query, hit/miss) 对拟合；LongMemEval 可直接当校准集。
- **三区**：conf ≥ t_high → 正常注入；t_low ≤ conf < t_high → 只注 top1 + 低置信包装；conf < t_low → **注入显式弃答块**：
  ```
  <recall status="no-reliable-memory">
  长期记忆已检索；无条目超过可靠性阈值。涉及过去的决定/偏好/事实时，
  说"没有记录"，不要重构。
  </recall>
  ```
- **MAFW 专属坑**：① gate 用**未经 energy×salience 加权**的原始相关性分（否则门测的是"能量策略下的可取性"而非"存在性"）；② supersede 链解析必须先于 margin 计算（新旧成对永久压低 margin）；③ 阈值按非对称目标调（错记忆重罚、漏记忆轻罚）。

---

## 2. 情景上下文复原（R6）—— 证据最强

### 2.1 脑机制

- **lag-CRP**（Kahana 1996，PMID 8822162）：回忆一条后，时间相邻项被想起的概率随 |lag| 幂律衰减；lag+1 约为 lag+3 的 2–3 倍；前向不对称。人类记忆研究中最稳健的效应之一。
- **TCM**（Howard & Kahana 2002，DOI 10.1006/jmps.2001.1388）：项目与编码时缓慢漂移的上下文状态绑定；**回忆一个项目即复原其上下文**，进而成为邻居的线索。
- **CMR**（Polyn et al. 2009，PMID 19159151）：语义与时间上下文**可加**——BM25 上叠时间扩展不是冗余。
- **Manning et al. 2011**（PMID 21737744）：神经振荡证据——上下文复原**因果性地**引导下一次回忆的方向。
- **time cells**（MacDonald et al. 2011，PMID 21867888）：海马为事件打时间戳、桥接相邻事件。
- **边界条件**：contiguity 在 episode 边界处衰减 → 跨 session 只能小窗桥接。

### 2.2 AI 消融证据

| 系统 | 证据 |
|---|---|
| **CueMem**（arXiv:2609.12354） | 去图扩展 **81.1→71.4**；LongMemEval temporal 87.18 / knowledge-update 75.20（6 系统中最佳）；去"优先最近版本"呈现指令 → knowledge-update **−6.4**、temporal **−6.8** |
| **EdgeMem**（arXiv:2609.05553） | 免生成 LLM；anchor 阶梯：扁平 turn BM25 49.74 → **+episode 通道 58.18（最大单步 +8.4）** → +共现 60.43 → +时间 61.01；种子带 ±1 前后邻居 |
| **EM-LLM**（arXiv:2407.09450, ICLR'25） | contiguity buffer 在 44% 任务上最佳；**必须 ≤ similarity buffer**——邻居增强而非替代相关排序 |
| **Zep/Graphiti**（arXiv:2501.13956） | 双时态边（valid_at/invalid_at）——知识更新使旧边**失效而非删除**，是 knowledge-update 的最强已发布答案 |
| **HippoRAG**（arXiv:2405.14831） | 种子 → 结构化邻居扩展 > 孤立单元检索（multi-hop +20%） |

### 2.3 最小设计（对 MAFW）

1. **锚点 → ±1 时间邻居**：BM25 命中条目为锚点，捆绑同 session 的 ±1 条目（对称窗；脑的前向不对称是回忆顺序现象，QA 不该丢后向上下文）。w 从 1 开始，在 benchmark 上调 {1,2}。
2. **小跨 session 桥**：锚点是 session 首/尾条目时，带上时间相邻 session 的边缘 1 条。
3. **呈现**：按时间序排列成块，每条前缀 `[日期, session]`，锚点标记 ▶；邻居 token ≤ 50% 预算；去重。
4. **知识更新呈现指令**（白捡的 +6.4/+6.8）：保留全部版本（含 superseded），按时间序，加指令"优先采用离问题时间最近的信息"；显式标记 supersede 链头为当前版本。
5. **门槛**：只对 BM25 分超过 floor 的锚点扩展（邻居放大真命中也放大误命中）。
6. **评测**：重跑 LongMemEval per-category，预期增益集中在 temporal/multi-session。

### 2.4 风险

- 误命中的邻居 = 误上下文（只扩展高分锚点 + 邻居预算从属）。
- 邻居含旧版本 → supersede 链头标记 + 呈现指令，**绝不物理排除旧版**（"X 什么时候变的"类问题需要它）。
- 上下文膨胀是默认失败模式（CueMem ~2K token 重构上下文比 108K 全史高 27 分）——硬 token 帽。

---

## 3. 确定性线索抽取（R7）

### 3.1 IR 证据

- **确认 R1 否决**：CAsT（arXiv:2003.13624）自动改写比人工差 35%——改写是噪声信道；PRF 在短噪声 query 上漂移（Carpineto & Romano 2012, DOI 10.1145/2071389.2071390）。
- **Query reduction > expansion**：Kumaran & Allan 2008（DOI 10.1145/1390334.1390347）——长噪声 query **保留名词短语/专名、丢弃其余**胜过整句。这是"线索抽取"的经典验证形态。
- **标识符分词是最大杠杆**：CodeSearchNet（arXiv:1909.09436）确立 camelCase/snake 拆分；arXiv:2605.18561 显示 BM25 的对数 IDF **结构性低估超稀有标识符**，且分词消融吸收大部分 IDF 修正——**分词 + 稀有词权 >> 任何扩展方案**。
- **有 reranker 下游时，第一阶段策略转向召回保护**：Mackie et al. 2023（arXiv:2306.17082）——reranker 会原谅第一阶段的部分错误；只做**加性加权，永不做减性过滤**。

### 3.2 编码特异性依据

Tulving & Thomson 1973：线索仅在与编码内容重叠时有效。**用户逐字打出的路径/标识符/引号串几乎必然也在写入 trace 里；LLM 改写出的同义词不在。** 确定性抽取 = 尊重编码特异性的线索生成器。

### 3.3 最小设计（对 MAFW）

- **做**：① 标识符感知分词（`getUserPreferences` 双索引整词 + `get user preferences`）；② 抽取路径/标识符/引号串/日期 → 2–3× 加性加权；③ BM25 IDF 尾部修正（在 ② 之后仍有标识符 miss 时）。
- **不做**：任何生成式/同义词/PRF 词项添加；硬 MUST 过滤；无噪声控制的实体加权。
- **前置检查**：写路径 `primary_abstraction` 必须保留逐字标识符（压缩管线若把它们改写掉，读端加权找不到东西）。
- **坑**：分词变更会移动 IDF → 变更后必须重跑 LongMemEval 基线再归因增益；小语料 IDF 不稳，幅度本地调。

---

## 4. 预测性预取（R8）

### 4.1 脑机制

- **Preplay**（Dragoi & Tonegawa 2011，PMID 21179088）：海马在经验发生前自发预激活未来轨迹，且在决策点预枚举多条候选——**检索是预测"将需要什么"，不是被动反应**；preplay 受目标偏置（Ólafsdóttir 2015）。
- **预测编码**（Rao & Ballard 1999；Friston 2010 PMID 20068523；Hindy et al. 2016 PMID 27065363）：海马模式完成**就是**自上而下的预测信号。
- **PFC 目标偏置**（Miller & Cohen 2001，PMID 11283309；Norman & O'Reilly 2003）：CLS 双速结构 = 我们的"快照快路径 + 完整搜索慢路径"。

### 4.2 AI 证据

| 来源 | 发现 |
|---|---|
| **arXiv:2605.17989**（Predictive Prefetching for RAG, ICML'26） | 利用生成中提前出现的"语义前兆"预测何时检索/检索什么；端到端延迟 −43.5%，质量不降 |
| **arXiv:2606.20113**（流式 Tool-Intent） | 对部分用户输入投机检索；意图稳定点通常很早，73.9% 查询可隐藏延迟 |
| **arXiv:2607.22392**（The Prompt Is Not the Query） | **最后一句话只含 session 用户侧词汇的 36%**；45–50% 会话存在只在历史里的需求维度 → 快照 query 必须用滚动 N 轮，单轮不够 |
| **arXiv:2605.27240**（ENPMR-Bench） | 现有反应式范式在"主动检索需要相关记忆"上失败——预取填的是实测缺口 |
| Rhodes & Maes 2000（JITIR, DOI 10.1147/sj.393.0685） | 25 年前先例：持续预检索与当前上下文相关的文档——**边界 recall 本就是 Remembrance Agent** |
| **arXiv:2605.09268**（Beyond Continuity） | LLM 即使被显式提示也会携带陈旧上下文 → **话题转移检测必须确定性做在 gateway，不能委派给模型** |

### 4.3 最小设计（对 MAFW）

- **快照内容**：kv_store `recall-snapshot/{sessionID}` = top-N(20–30) 预排序 id + 预格式化 `<recall>` 块 + `queryHash` + `computedAt`；query = goal 快照 + 活跃文件路径 + 滚动 K 轮用户文本。
- **刷新触发**（后台，永不在热路径）：① 每个完成回合（2s 防抖）；② goal 变更事件（已有）；③ 话题转移信号。
- **话题转移检测**（分层便宜信号）：① 词面 Jaccard/BM25 重叠低于阈 → 刷新；② 硬信号：goal 变更、session 切换、时间间隔 > 30min。
- **边界读路径**：读快照 ~1ms；增量 >50 字符时跑正常搜索，**新鲜结果在前、快照在后**，去重 + 预算帽；短增量（"好，继续"）直接服务快照。
- **风险**：陈旧快照锚定（转移即失效）；错误记忆入快照后每轮都注入（快照构建必须走 `resolveSupersededHeads`）；快照挤占预算（硬帽）。

---

## 5. 修正后优先级

| 排序 | 项 | 依据 | 成本 | 对弱项的命中 |
|---|---|---|---|---|
| **1** | **R6 上下文复原** | 消融实证最强（CueMem/EdgeMem/EM-LLM 三源）；呈现指令部分零风险 | 中 | temporal / multi-session / knowledge-update |
| **2** | **R5 FOK 门** | 防臆造结构防线；脑机制对应最清晰；便宜信号够用 | 中 | 全类（防负分） |
| 3 | R7 线索抽取（标识符分词 + 逐字加权） | 安全加性；需先查写端保真 | 低 | 标识符类查询 |
| 4 | R8 预测预取 | 只优化延迟，不提升 R@1 | 中高 | 边界路径覆盖 |

---

## 6. 参考

### 神经科学
Nelson & Narens 1990 · Koriat 1993 · Schnyer et al. 2004 (PMID 14998710) · Schnyer et al. 2005 (15904549) · Maril et al. 2005 (15670690) · Kikyo & Miyashita 2004 (15589099) · Ubaldi et al. 2022 (35552235) · Fleming & Dolan 2012 (22492746) · Modirrousta & Fellows 2008 (18573261) · Kahana 1996 (8822162) · Howard & Kahana 2002 (DOI 10.1006/jmps.2001.1388) · Sederberg et al. 2008 (18954208) · Polyn et al. 2009 (19159151) · Manning et al. 2011 (21737744) · MacDonald et al. 2011 (21867888) · Tulving & Thomson 1973 · Dragoi & Tonegawa 2011 (21179088) · Diba & Buzsáki 2007 (17828259) · Foster & Wilson 2006 (16474382) · Ólafsdóttir et al. 2015 · Rao & Ballard 1999 · Friston 2010 (20068523) · Hindy et al. 2016 (27065363) · Miller & Cohen 2001 (11283309) · Norman & O'Reilly 2003 (14599236)

### AI 系统（arXiv / DOI）
Sufficient Context 2411.06037 · Know Before You Fetch 2606.29959 · GRAB-RAG 2608.22228 · 2605.24299 · 2510.09033 · AdaRAG-UE 2501.12835 · MemCalib 2609.24259 · Kale 2607.07626 · SKR 2310.05002 · CueMem 2609.12354 · EdgeMem 2609.05553 · EM-LLM 2407.09450 · Zep/Graphiti 2501.13956 · HippoRAG 2405.14831 · CAsT 2003.13624 · CROWN 1911.02850 · Kumaran & Allan 2008 (DOI 10.1145/1390334.1390347) · Carpineto & Romano 2012 (DOI 10.1145/2071389.2071390) · CodeSearchNet 1909.09436 · 2605.18561 · Word-Entity Duet 1706.06636 · Mackie et al. 2306.17082 · Predictive Prefetching 2605.17989 · Tool-Intent 2606.20113 · The Prompt Is Not the Query 2607.22392 · ENPMR-Bench 2605.27240 · Beyond Continuity 2605.09268 · HaS 2604.20452 · RAGCache 2404.12457 · JITIR (DOI 10.1147/sj.393.0685) · UMA 2602.18493 · HyMem 2602.13933
