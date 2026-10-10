# CLS 快慢链路重新锚定：海马-新皮层契约 × MAFW 实现（2026-10-10）

> 问题：海马体和新皮层的快慢链路到底是什么关系？我们的实现各组件锚定到哪个脑部件？哪里错了需要重锚？
> 方法：三线并行调研（CLS 分工与学习规则 / 海马-皮层对话协议 / AI 侧双系统实现与多遍学习证据）+ 本地核对（turn-pipeline B1/S2 prompt 事实、reflection ReflectCursor 单遍语义）。
> 前序：`2026-10-10-memory-architecture-brain-survey.md` §2.4（海马映射修正）、`2026-10-10-hippocampal-layer-redesign-survey.md`（V1-V3 选项）。本文是第三次收敛：**快慢链路契约**的逐组件锚定。

---

## TL;DR

重新锚定的核心发现是一个**反转**：上次修正说"turnCompress 不是海马"（对），但本次对照完整的 CLS 契约后发现——**我们系统里最像脑的部分恰恰是 B1 交错回放和两相节奏，最不像脑的是"皮层"本身**：脑的慢系统用小步长 + 十到百次交错暴露才提交结构，我们的"皮层"（semantic 库）**以学习率 1.0 运行**——MinHash 写时立即合并、laya 判官立即 UPDATE、reflection 单遍蒸馏即定稿（`ReflectCursor.isReflected` 后永不重访）。全部三个提交路径都是"首次暴露全额提交"，这是对 CLS 契约的核心违反，也是 V2 延迟合并 + 新发现的"宽限期重访"要修的东西。

---

## 1. 脑侧契约：快慢链路的精确条款

### 1.1 快慢契约（五条）

| 条款 | 快系统（海马） | 慢系统（新皮层） |
|---|---|---|
| **表示** | 稀疏（1-5% 活跃）、非重叠、合取码——结构上不可干扰，但不可泛化 | 稠密、重叠、分布——可泛化、优雅降级，但相互干扰 |
| **学习规则** | 1-trial Hebbian LTP（活跃突触上速率≈1.0） | 小步长统计学习，每次暴露微小增量 |
| **暴露次数** | 1 次 | 无图式时**十到百次**（每事件学习率比 10¹-10²） |
| **内容** | 任意合取的个别项（what×where×when，不管意义） | 共享特征、潜在结构、环境统计（语义/图式） |
| **保留** | 高保真但暂时性缓冲（天-周梯度衰减），逐步卸载 | 近乎永久，但只有 gist/结构存活 |

- **稳定性-可塑性困境是架构性的**：McClosky & Cohen 1989 / Ratcliff 1990 证明顺序训练必然灾难性干扰，网内调节（预训练/上下文单元）救不了——**必须**分解为两个码相反、速率相反的系统（McClelland 1995）。
- **交错强制令**：皮层的学习样本**必须新+旧混合**，顺序块被禁——顺序训练在梯度上用有偏近期样本系统性移动共享权重，即使速率慢也一样干扰。重放实现交错，且是**优先级课程**而非均匀 minibatch（Kumaran 2016："replay allows goal-dependent weighting of experience statistics"——reward×novelty×goal 加权）。
- **图式例外**：结构契合的个别项**免走慢路**——有图式的大鼠单次学习、48h 皮层化（Tse 2007），mPFC 即刻早基因上调是 assimilation hub（Tse 2011）；人类 fast mapping（Sharon 2011，遗忘症患者经前颞快速习得）。三个条件：结构已存在 + 契合（assimilation 非 accommodation）+ hub 可吸收。**"not so fast" 边界**（Warren & Duff 2014）：持久的任意绑定仍需海马——皮层快的是"推断"，慢的是"任意绑定的持久化"。CLS 2.0 修订（Kumaran 2016）：海马也做部分泛化（recurrent activation 支持跨 episode 推断）——快层不只服务细节查询。

### 1.2 对话协议（九步规格，报告二提炼）

1. **写路径（觉醒）**：经验分配稀疏索引 engram（兴奋性竞争分配）；**同时**在皮层突触设弱标签（Frey & Morris 1997）——写是并行的，只是皮层那份是弱标记。
2. **槽位授予（皮层→海马）**：NREM 慢振荡 up-state 门控海马输出；SO-纺锤波-涟波三元嵌套是投递时窗（Sirota 2003；Staresina 2015）。
3. **负载（海马→皮层）**：~100ms 压缩（10-20×）序列重放；睡眠顺向、觉醒逆向+重组（Gupta 2010 捷径=生成性重组）。
4. **频率与课程**：每夜数千槽位；**每条新记忆十到百次重放，前载衰减，跨夜数天到数周**（Kudrimoti 1999；Ribeiro 2004 48h 新奇共振）。
5. **选择策略**：reward×novelty×recency 加权（Singer & Frank 2009；Cheng & Frank 2008）+ **主动限流**（Karaba 2024 CA2-CCK+ BARR——重放过量本身就伤巩固，通道有速率限制器）。
6. **更新规则（皮层）**：每槽位小 Hebbian/STDP 增量（低 ACh 可塑态）；**单次投递不足够**，跨重复槽位累积才有痕迹。
7. **反馈通道（皮层→海马，下一次编码）**：图式契合 → mPFC 同化路径并**解除海马编码**；新奇 → 海马分离路径（SLIMM 双路由）；**预测自上而下重塑可分性**（Nigam & Schwiedrzik 2024 顶层模式分离）；前海马=语义门户（Poppenk 2013 长轴）。
8. **指针结晶**：重叠记忆反复投递把海马**索引神经元**变成皮层**概念细胞**——别名挂接每次几次配对即成（Kolibius 2025；Ison 2015）。
9. **终态**：平行痕迹共存——vmPFC/皮层 gist 痕迹成为检索 hub，海马 episodic 痕迹**静默而非删除**（Kitamura 2017 前额叶 engram 迟到自足；Ryan 2015 静默可复活）。

### 1.3 两相节奏（觉醒/睡眠分工）

- 觉醒态：立即（秒级暂停/奖赏点）、逆向（credit assignment）、可模拟未来路径（Pfeiffer & Foster 2013）；**觉醒态也有真巩固**——顶叶 engram 1h 内形成、持续 ≥12h（Brodt 2016/2018 "fast track to the neocortex"）；觉醒休息期海马-皮层相关性升高预测后续记忆（Tambini 2010）。
- 睡眠态：顺向、巩固导向、重复稳定化——**"rehearsal initiates systems consolidation, sleep makes it last"**（Himmer 2019）：觉醒可以启动（设标签），睡眠的重复才使它持久。

---

## 2. 重新锚定：逐组件映射表

| # | CLS 组件 | 脑 | MAFW 现状（代码事实） | 锚定评估 |
|---|---|---|---|---|
| 1 | 快系统存储 | 海马（稀疏非重叠、1-trial、可检索缓冲） | t1/transcript 捕获✓；**检索面缺失**（V1）；episodic 单元=worker 转述的"精选快层" | 半建 |
| 2 | 慢系统存储 | 新皮层（重叠统计表示） | harmonic semantic 簇 + S2 schema-clusters | 对齐 |
| 3 | **慢系统学习率** | 小步长、十到百次暴露才提交 | **违反**：三条提交路径全部首次全额——MinHash 写时立即合并（≥0.7 即 supersede）、laya 判官写时立即 UPDATE、reflection 单遍定稿（`ReflectCursor.isReflected` 后永不重访）；A2 tentative 是全系统唯一的"小步长"机制 | **核心违反** |
| 4 | **交错强制令** | 重放=新+旧混合的优先级课程 | **B1 交错回放✓**：`replayPriority`（need×gain×1/energy）采样跨会话旧记忆注入 turnCompress worker prompt，与同批新内容一起处理 + 48h 排除窗 + S2 schema 集成偏好——**全系统最 CLS-正确的部分**；但**只覆盖 turnCompress**：reflection 按 per-session 游标处理，同一 pass 内无跨会话新旧混合 | 对齐一半（最强项+缺口） |
| 5 | 重放频率/课程 | 每记忆十到百次、前载衰减、跨夜 | turnCompress（小时）→ reflection（日）→ axiom-distill（周，need 选中者）≈ 前载多触课程，**形状对但暴露次数 2-3 遍 vs 脑十到百遍**；事件门重访已有（reconsolidate 矛盾触发 / axiom need 触发 / stale-verify 年龄触发） | 部分——缺无条件前载期 |
| 6 | 选择策略 | reward×novelty×recency | B1: need×gain×1/energy；A1: need×energy 选公理源；A4 need 回流 | 对齐（need≈reward 代理） |
| 7 | 限流 | Karaba 主动节流（过量重放有害） | PipelineBudget（成本门）+ 48h 窗 | 对齐（成本语义，非干扰语义——脑限流防干扰，我们限流防美元） |
| 8 | 图式快路径 | Tse/SLIMM（结构契合→mPFC 直通 48h） | S2 簇集成偏好（worker 命中簇时 supersedes 进簇代表）+ laya τ_high fast-UPDATE | 部分——判定基准是**内容相似/簇匹配**，脑是**结构契合**（N1 实体层后可升级） |
| 9 | 皮层→海马反馈 | SLIMM 双路由 + prediction-aware separation | D3 novelty 门（laya，默认关）+ R8 快照包含度（话题漂移） | 弱 |
| 10 | 指针结晶 | 索引神经元→概念细胞（别名数次挂接） | A5 distilled_by 双向指针（雏形✓）；实体概念层缺（N1） | 半建 |
| 11 | 终态 | 平行痕迹、silent not deleted | D1b 源降能不删 + supersede 链保留 + t1_archive 全量保留 | 对齐 |
| 12 | **两相节奏** | 觉醒立即标弱标签/睡眠重复固化（Himmer 2019） | turnCompress（小时级=觉醒态立即处理）+ reflection（日级=离线固化）——**节奏同构**；gradeFor（goal 结果注入 worker prompt）≈ 觉醒逆向重放的 credit assignment；D4a dream 预取 ≈ Pfeiffer 未来路径模拟 | 对齐（意外的好） |

### 2.1 意外的强对齐（保留并显式承认）

1. **B1 是教科书级的 CLS 交错**：优先级采样（非均匀）+ 新旧同批 + 48h 排除窗——三个特征与 Kumaran 2016 的"优先级课程"逐条对上。
2. **两相节奏同构**：小时级 turnCompress（觉醒式立即，含 gradeFor credit assignment）+ 日级 reflection（睡眠式固化）——与"rehearsal initiates, sleep makes it last"两相一致。
3. **终态语义正确**：demote-not-delete 全链路（supersede/D1b/archive）与"silent not deleted"一致。
4. **事件门重访已存在**：reconsolidate（矛盾）、axiom（need）、stale-verify（年龄）——脑的选择性重放三种触发都有对应物。

### 2.2 核心违反：慢系统学习率 1.0

脑的皮层**从不首次全额提交**——每次重放一个小增量，十到百次才成痕迹。我们的三条提交路径全部一次写全：

- MinHash ≥0.7 → 立即 soft-supersede（**无第二遍确认**）
- laya 判官 UPDATE/CREATE → 写时立即生效
- reflection 蒸馏 → 单遍定稿，`isReflected` 盖章后该 episodic 永不重访

**AI 侧证据它有害**：
- LightMem insert-only + 延迟合并：LongMemEval-S 68.64 vs Mem0 53.61（**+15pt**）——其动机正是"premature merge 导致不可逆信息丢失"（东京/京都案例）
- eMEM-Bench：flat 单层存储在 DRM-lure 拒斥丢 29pt、context-dependent 检索丢 30pt——**非参数库的干扰是真实且可测的**（文本库没有权重冲突，但有检索混淆）
- Reflexion +11pt / Self-Refine ~20%：新鲜上下文 2-3 遍重访饱和收益——多遍不必多（十遍），但**一遍不够**
- **生产界无人做多遍巩固**（Mem0/MemGPT/A-MEM 全部单遍；Letta sleep-time 是预计算非重巩固；GenAgents 反射树是最接近的：阈值触发递归，未消融）——这是开放缺口，也是我们的机会

### 2.3 交错的缺口

B1 只覆盖 turnCompress 的 worker prompt。reflection 的输入是 per-session 增量 episodic——**同一蒸馏 pass 内没有新旧混合**（只有 selectionFeedbackBlock 统计摘要）。脑的每一次皮层更新都是新旧混合的 minibatch。这使 reflection 提取的"结构"样本有偏（单会话视角），跨会话模式只能靠 A2 草稿（被禁止的例外）或 axiom 周管线（晚了六天）捕捉。

---

## 3. 锚定声明（修正版）

> **海马** = t1/transcript（捕获）+ episodic 精选单元（转述缓冲）——快存储半建（检索面缺，V1 修）。
> **新皮层** = harmonic semantic 簇 + S2 schema-clusters——存储对，**学习规则违反**（速率 1.0）。
> **重放** = turnCompress 小时批（觉醒重放：新内容+B1 旧记忆交错进 worker prompt，gradeFor 做 credit assignment）+ reflection 日批（睡眠重放：蒸馏固化）——协议骨架对，暴露次数和交错覆盖缺。
> **图式快路径** = S2 簇集成 + laya τ_high——存在，判定基准待从"相似"升"结构契合"。
> **皮层→海马反馈** = D3 novelty 门（关）+ 快照包含度——最弱一环。
> **终态** = demote-not-delete 全链——正确。

---

## 4. 对 V1-V3 选项的修订

| 修订 | 内容 | 依据 |
|---|---|---|
| **V2 强化：延迟合并定案** | MinHash 写时合并 → 写时**标记不合并**（redundant-candidate 锚），合并判定迁巩固层；laya UPDATE 保持但**高权改写走次日确认**（重访时矛盾仍在才 supersede） | LightMem +15pt；premature-merge 不可逆丢失；eMEM-Bench 干扰实测 |
| **V2 新增：宽限期重访（grace-period re-pass）** | reflection 每日 pass 除新 episodic 外，**把近 48-72h 自己产的 gist 以新鲜上下文重访一遍**（确认/修订/合并判定在此做）——对应脑的前载衰减重放曲线；现有事件门（矛盾/need/年龄）保留 | 脑每记忆十到百次前载重放；Reflexion/Self-Refine 2-3 遍饱和；生产界无人做（缺口=机会） |
| **V2 新增：reflection 交错** | reflection 输入注入 B1 同款跨会话 prior（或改混合批次），使每次蒸馏都是新旧混合样本 | CLS 交错强制令；当前单会话视角有偏 |
| **V3 细化：schema 判定升级** | 图式快路径判定从"内容相似"升"结构契合"（N1 实体层 + 簇结构匹配）；D3 novelty 门校准后作为皮层→海马反馈路径开闸候选 | SLIMM 双路由；Nigam prediction-aware separation |
| **成本注** | 宽限期重访 = reflection 每日增量最近 2-3 天 gist 的重读（~数十条 × 千字符级），预算帽内可控；与 2.3 的交错注入可合并为同一次 pass | PipelineBudget 门控 |

**修订后的推荐路径不变**：V1（verbatim 检索面，修快层）→ V2（机械捕获 + 延迟合并 + **宽限期重访 + reflection 交错** + 话题分段）→ V3（通道/实体/成本重构）。

---

## 5. 决策点（留给用户）

1. **宽限期重访的窗口与深度**：48h/72h？只重访 gist 还是连 tentative/episodic 一起？（建议：V2 实施 spec 时 observe-first——先记录"重访会改判多少"再全量开）
2. **reflection 交错形态**：B1 式注入（改 prompt）vs 混合批次（改游标语义）——前者小后者深
3. **学习率隐喻的落地边界**：LLM 生成是全量写，"小步长"只能落为"多遍 + 每遍小承诺"（tentative 化扩展到 reflection 产物？能量起步 0.6 第二遍升 0.8？）——细节进 spec
4. **V3 的干扰语义限流**：成本门（PipelineBudget）之外要不要加干扰语义的重放预算（Karaba 对应物）——远期

---

## 附：调研底稿

三线原始报告存本会话 task 结果（CLS 分工 ses_edb232e02ffeNvDQ9NBX6WDARR / 对话协议 ses_edb22fed2ffesGresCqUc0m7IU / AI 双系统 ses_edb22b587ffe4rRvXJEGnv0bOh）。关键引文：

- 契约：Grossberg 1980；McClosky & Cohen 1989；Ratcliff 1990；O'Reilly & McClelland 1994；McClelland 1995；Norman & O'Reilly 2003；O'Reilly 2014；Kumaran 2016
- 图式例外：Tse 2007/2011 *Science*；Sharon 2011 PNAS；Warren & Duff 2014；Coutanche 2014；Merhav 2015
- 协议：Buzsáki 2015；Lee & Wilson 2002；Kudrimoti 1999；Ribeiro 2004；Sirota 2003；Staresina 2015；Girardeau 2009；Karaba 2024 *Science*；Singer & Frank 2009；Cheng & Frank 2008；Foster & Wilson 2006；Pfeiffer & Foster 2013；Gupta 2010；Jadhav 2012
- 觉醒两相：Brodt 2016 PNAS / 2018 *Science*；Tambini 2010；Himmer 2019 *Sci Adv*；Hasselmo 1999；Frey & Morris 1997
- 反馈/结晶：van Kesteren 2010/2012；Nigam & Schwiedrzik 2024；Poppenk 2013；Kolibius 2025；Ison 2015
- 终态：Winocur 2010；Kitamura 2017 *Science*；Ryan 2015 *Science*
- AI 侧：Lin 1992；Mnih 2015；Schaul 2016（PER 41/49）；Shin 2017 DGR；van de Ven 2020；Kemker 2018 FEARNet；Lopez-Paz 2017 GEM；Ba 2016；Ott & Liu 2023（78% vs 15%）；Letta arXiv:2504.13171；LightMem arXiv:2510.18866（68.64 vs 53.61）；eMEM arXiv:2606.03374（−29/−30pt）；PoisonedRAG arXiv:2402.07867；Reflexion arXiv:2303.11366；Self-Refine arXiv:2303.17651；GenAgents arXiv:2304.03442
