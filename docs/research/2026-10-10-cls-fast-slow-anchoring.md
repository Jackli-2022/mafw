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

## 4.5 慢路内部规格（2026-10-10 补充调研：三个慢学习者）

慢路不是一个系统，是三个（Doya 2000 计算分工：皮层=无监督表示学习、纹状体=强化学习、小脑=监督学习）：

**新皮层（语义/图式）**——物理实现：任务激活分支上 ~1h 长出新树突棘、少数选择性稳定（数月保持，预测行为保留，Xu 2009/Yang 2009）；**睡眠是双算子雕刻师：NREM=形成算子（branch-specific 棘形成，Yang 2014）+ REM=修剪算子（选择性消除其余，Li 2017）**；全局缩减+局部保护并存（de Vivo 2017 睡眠中轴-棘界面缩 18%；Diering 2017 Homer1a 优先削弱弱突触——记忆在缩减中存活因缩减对非记忆突触有偏）；线虫因果证据：突触重塑就是巩固事件本身（Chandra 2023 Cell）。多夜动力学：**首夜最大单次收益（手指敲击 ~20% 提速），无练习后续夜不增益（Walker 2003）；有练习则夜夜叠加（Brawn 2010 椋鸟）**；"睡眠增益"部分是防觉醒干扰的保护（Brawn 2010 晨训/晚训对照）。远端：前额叶 engram 编码时分配但静默、2-4 周成熟（Kitamura 2017）；啮齿海马依赖梯度 ~4 周（Kim & Fanselow 1992），人类月-年。

**纹状体（程序性/习惯）**——goal-directed（腹/背内侧）→ habitual（背外侧 putamen）**并行控制者、渐变主导权**（Yin & Knowlton 2006；Balleine & O'Doherty 2010）；devaluation 范式证明自动化；**task-bracketing**（序列首尾高放电中间抑制）= 动作流重编码为宏（Barnes 2005；Jin 2014；Graybiel 2008：习惯=情境触发的组块化动作宏，无在线评估）；多巴胺 RPE 相关物从腹侧迁背侧（O'Doherty 2004——同一教学信号先训评估器再训执行器）；时间线：小时-天 goal-directed、天-周 overtraining→habitual；睡眠技能增益 ~20%、stage-2/纺锤关联（Walker 2002）。

**小脑（自适应/时序）**——爬行纤维教学信号→Purkinje LTD，监督式误差校正+eligibility 时序信用分配（Ito 2000；Raymond 1996）；技能早期（误差大时）参与最强，后期交给皮层-纹状体（Hardwick 2013 元分析）。

**跨切不变量**：三个慢学习者都在快路生成的候选集上做"选择+巩固"——皮层选有标签的突触、纹状体选被强化的动作、小脑选误差校正的预测；**单事件最大增益都在第一个睡眠机会，只有经验重开窗口才复利**。

### 4.6 双系统"并行"的六个体现（2026-10-10 追问定案）

并行 ≠ 分工，更 ≠ 接力（海马存→转移→皮层是 SCT 旧叙事；现代图景是**双写共存、检索主导权渐变**）：

1. **写入并行**：同一次经验双写——海马全量（1-trial 稀疏 engram）+ 皮层**弱标签**（Frey & Morris 突触标记，并行设置）；皮层 engram **编码时就分配**只是静默（Kitamura 2017）。皮层的"慢"是承诺度的慢，不是开始时刻的晚。
2. **读出并行**：每次识别双轨同时贡献——recollection（海马，情节细节）+ familiarity（皮层，标量熟悉感，Norman & O'Reilly 2003 双过程）；FTT verbatim/gist 平行存储独立检索。
3. **交互并行**：编码进行中海马已在用皮层图式（SLIMM 实时双路由——congruent 即时解除海马编码）；休息/睡眠海马持续回放喂皮层——双向耦合从不断线。
4. **速率并行**：同一暴露在两系统产生两个不同步长的学习事件（海马 rate≈1.0 vs 皮层 ε）——不是先后，是**同时不同步长**。
5. **存储并行**：痕迹永久共存（转换理论）——巩固是**检索主导权**的渐变（Kitamura：前额叶 engram 2-4 周成熟自治），非存储转移；海马痕迹**静默而非删除**。
6. **广域多写**：一次情绪经验同时写海马（情景）+ 杏仁核（情绪标签）+ 纹状体（动作/奖赏）+ 皮层（语义特征）——单经验多写者，"双系统"是最小刻画。

**MAFW 对照**：已并行——V1 后双层检索面（H+semantic 同时可查）；**tentative（A2）= 皮层弱标签的对应物**（快系统时刻写低承诺抽象）；demote-not-delete = 痕迹共存；宽限期重访 = 弱痕迹成熟。仍串行（成本约束下接受）——脑的"每 theta 周期双写"在我们这里是"每批次双写"（turnCompress 同批写 episodic 精选 + tentative 草稿）：粒度从 125ms 变小时批，结构同构；A2 每批限 1 条 vs 脑每次暴露都有皮层弱标签——承诺度对齐了，频率没有。

MAFW 映射：REM 修剪算子→N2+沉底/衰减的语义升级；task-bracketing→W2 skill 物化的脑侧对应（agent 反复手动执行→procedural→SKILL.md = goal-directed→habitual 转换）；首夜一次性+练习叠加→宽限期重访窗口尺寸依据（48-72h≈首夜+次日）；小脑无对应（缺，远期）。

## 5. LLM 边界与"权重"清单（2026-10-10 追问定案）

### 6.1 海马层零 LLM（重申 + 收口）

H 层全部职能机械实现（§见 hippocampal-layer survey §3.1）；唯一的 LLM-on-H 操作是**键增广**（LongMemEval +9.4% 的事实键拼接），但它由巩固层**异步**补做，不是捕获时依赖。F 层（turnCompress）保留 LLM 但重定位为"读原文写候选"，且触发可从每小时固定改为**容量/话题边界事件驱动**（LightMem 证据：全部高性能系统用阈值/语义边界，无固定墙钟窗口）——省 LLM 调用的同时贴近脑的觉醒态即时性。

### 6.2 慢路径不更新模型权重——"皮层"是文本库，不是模型

**架构事实**：我们的"皮层"= harmonic 文本记忆库（roadmap 显式排除 LoRA 权重巩固）。三个模型组件（embedding 模型 / laya / reranker）全部冻结，**它们是计算电路，不是皮层存储**。

我们系统里真正被"慢学习"更新的"权重"（CLS 皮层可塑性的对应物）：

| "权重" | 更新者 | LLM？ |
|---|---|---|
| 文本条目本身（巩固重写） | F/S 巩固管线 | ✅（唯一语义席位） |
| energy / salience | 衰减 + ACT-R + goal reward | ❌ 机械 |
| anchor 图边权（D5 Hebbian need 调制——最接近真突触可塑性的结构） | 检索遍历 | ❌ 机械 |
| cue_anchors（检索键重写） | 巩固 + verified:/tentative 状态机 | 混合 |
| 向量（派生索引） | 条目重写时重嵌 + supersede 时删旧 | ❌ 机械（fire-and-forget） |

三个组件的定位与脑对应（2026-10-10 二次质询修正——"调控层=神经调质"的类比此前误配给 laya，修正：机械标量才是神经调质对应物）：

| 组件 | 职能 | 脑对应 | 冻结理由 | 不准的吸收层 | 慢更新通道 |
|---|---|---|---|---|---|
| **embedding 模型**（bi-encoder） | 文本→语义向量（单侧编码） | **感觉皮层特征提取器**（腹流通路：不变性递增的特征金字塔，成年期稳定——V1 不因新记忆重布线） | 特征是共享基础设施；个人库微调无收益 + 破坏向量库兼容 | 检索架构层：hybrid RRF（BM25 补换述盲区）+ R7 双索引（标识符 38%→90%） | 无 |
| **laya**（NLI 冲突 checkpoint） | pair 判断：冲突/冗余/分离 | **热路径 = CA3 比较器**（Lisman & Grace 环：结构硬连线，准确性靠皮层输入质量——context 注入=喂比较器更好的输入）；**慢路径 = 纹状体**（CLS 第三系统：习惯/增量学习，Atallah 2004，从反馈慢慢改判定策略） | 比较器不实时重布线；实时权重=灾难遗忘+serving 失稳（2026-09-29 论证） | ①三值置信门（不确定→LLM；当前全部自主门关闭）②context 注入 | **影子日志（judge-vs-outcome 分歧）→ 睡眠压力触发 → 批微调**——纹状体多巴胺学习（预测误差→习惯更新）的精确对应；已有设计，等标签 |
| **reranker**（cross-encoder） | query×doc pair 打分（R3 验证 + FOK 概率特征） | **前额叶元认知监测**（Schnyer 2004：前额叶损伤选择性损害 FOK 准确性——FOK 是算出来的不是感觉到的；Devaluez 2023：FOK 领域特异性） | 元认知是读出电路不是存储 | 分主题阈值拟合（L3 fok-samples 对照真值）+ arbiter observe-only | 无权重更新；阈值表持续再拟合（元认知的正确学习形态） |

**机械标量信号（salience/novelty/need/energy）才是神经调质系统的对应物**（多巴胺/NE 的标量门控——2026-09-23 spec 原判断正确："写入强度门控用标量集成而非 LLM"）。laya 不调增益，它做 pair 判断——比较器 + 习惯电路，不是调质器。

**"不更新权重不准"的实证与三层吸收**（2026-10-10 数据）：235 对 pairs（create 219 / skip 11 / update 5，update 率 2% vs 健康带 16-22%）+ separate 失明 + P1.5 off-label 评估——laya 当前确实不准，且**系统已经按"不可信"运行**（全部自主门关闭、observe-first）。准确性不在模型层修复，在三层吸收：架构层（置信门升级 LLM）→ 决策层（τ/分主题阈值校准——**G2 校准门槛现已达标**：≥50 scored + ≥5 update）→ 慢通道（影子日志批微调，睡眠压力触发）。权重不是永不更新，是**不实时更新**——实时性由 context 注入满足，这正是脑自己的答案（比较器冻结 + 皮层预测喂输入 + 纹状体慢学习）。

例外通道（维持远期排除）：影子日志驱动的批处理微调（睡眠压力=judge-vs-outcome 不一致率超阈触发）——CLS 视角对应真正的参数化皮层学习，无训练基建 + 灾难遗忘风险，维持 roadmap 显式排除。

## 6. 决策点（留给用户）

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
