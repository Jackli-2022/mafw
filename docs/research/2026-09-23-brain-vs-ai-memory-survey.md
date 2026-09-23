# 大脑记忆 × AI 记忆系统 × MAFW：三方对照调研（2026-09-23）

> **方法**：双线并行调研。
> ① 神经科学线：以 Europe PMC / PMC 全文与检索 API 为权威源（Wikipedia 不可达），综述论文优先，标注 [Established] / [Well-supported] / [Contested]。
> ② AI 记忆系统线：先挖掘仓库既有四份调研，再以 arXiv 摘要/HTML 补 2026 新批次，逐系统抽取 组织/存储/检索/神经类比。
> 最后与 MAFW 谐波记忆系统做三方对照。
> 前序调研：`docs/reports/llm-agent-memory-systems-survey.md`（系统谱系）、
> `docs/research/2026-08-26-memory-systems-pipeline-survey.md`（写入管线）、
> `docs/research/2026-09-01-long-term-memory-retrieval-survey.md`（检索优化）、
> `docs/research/2026-09-23-latest-memory-papers-survey.md`（2026-09 论文批次）。

---

## 0. TL;DR

1. **大脑不是"一个库"，而是"快索引 + 慢皮层 + 线索重构"**：稀疏海马索引指向分布式皮层表征；**联想**是共激活与表征重叠的副产物；**取回**是线索触发的模式完成＋索引再激活（重构而非回放，且会改写记忆）；**检索**是前额叶引导的策略/监控；遗忘是主动功能。
2. **AI 记忆系统大多只实现了一半**：快证据层（原始 turn / 原子事实）普遍存在，慢抽象层多为一次性 LLM 摘要；**系统巩固（回放）、再巩固（检索改写）、模式分离、engram 稀疏分配**基本缺席。
3. **"神经启发"多是命名，不是机制**：真正落地神经计算的是 HippoRAG（海马索引 + PPR 联想补全）；其余系统用"consolidation/engram/forgetting"指代去重/摘要/TTL 等工程操作。
4. **MAFW 已命中最关键的神经机制**：稀疏索引（`primary_abstraction`/`cue_anchors` + `<recall>` 指针 + `mafw_get_memory`）、线索驱动检索、energy 衰减、soft-supersede 链。这与 2025–26 的 "cue/pointer + 重构" 浪潮（CueMem/EdgeMem/Memora）同构。
5. **最大缺口 = 系统巩固的"回放"与检索驱动的"再巩固"**：MAFW 的 turnCompress/reflect 属摘要类，非回放；检索访问 +0.02 加成处于休眠（未接线）。这是从"检索层优化"转向"学习动态"的关键跳板。

---

## 1. 第一线：大脑如何组织、存储、联想、取回、检索记忆

> 状态标记：**[Established]** 教科书共识 · **[Well-supported]** 强证据、细节有争议 · **[Contested]** 核心争论中。
> 引用凡标"经核"者已对 Europe PMC 验证；经典心理学/早年文献依据既有共识标注。

### 1.1 组织：多系统分层 + 稀疏索引

#### A. 多记忆系统（声明式 vs 非声明式）
**定义**：记忆非单一系统，解剖与功能可分离。
**核心发现**：双侧内侧颞叶（MTL）损伤（患者 H.M.）导致事实/事件顺行性遗忘，却保留运动技能与知觉学习——奠基性双重分离。声明式（外显）= 情景 + 语义，海马依赖、快、单次、可意识提取；非声明式（内隐）= 技能/习惯（纹状体）、条件反射（杏仁核/小脑）、启动（新皮层），慢、多次、海马不依赖。
**引用**：Scoville & Milner 1957, *J Neurol Neurosurg Psychiatry*；Squire 1992, *Psychol Rev* 99:195–231（PMID 1594723）；Squire & Wixted 2011, *Annu Rev Neurosci* 34:259–288（PMID 21456960）。**[Established]**

#### B. 情景 / 语义 / 程序 / 工作记忆
**核心发现**：情景记忆单次习得、快速遗忘；语义记忆从反复重叠的情景编码中"语义化"涌现。工作记忆为注意基、容量约 4 chunk（非 Miller 7±2）。
**引用**：Tulving 1972；Cowan 2008, *Prog Brain Res* 169:323–338（PMID 18394484，经核）；Baddeley & Hitch 1974；Baddeley 2000, *Trends Cogn Sci*。**[Established]**

#### C. 解剖基质（系统 → 基质）
| 系统 | 主要基质 |
|---|---|
| 情景/声明式 | 海马 + MTL（内嗅/鼻周/海马旁皮层）+ 分布式新皮层 |
| 语义 | 前颞叶 / 分布式联合皮层 |
| 程序（技能/习惯） | 背侧纹状体（基底核）+ 小脑 + 运动皮层 |
| 情绪条件反射 | 杏仁核 |
| 启动 | 新皮层（知觉/概念） |
| 工作记忆 | 前额叶（持续放电）+ 顶叶 |
| 空间/情境 | 海马（place cells）+ 内嗅（grid cells） |

**引用**：Squire 1992；Eichenbaum 2000, *Nat Rev Neurosci* 1:41–50；Eichenbaum, Yonelinas & Ranganath 2007, *Annu Rev Neurosci* 30:123–152；O'Keefe & Dostrovsky 1971, *Brain Res*。**[Established]**

#### D. 层级抽象：情景 → 图式/语义
**核心发现**：既存联想"图式"（内侧前额叶）使图式一致的新联想**单次巩固**、几乎立刻海马独立，打破常规慢速皮层时间线；新皮层网络从反复重叠经验中提取统计结构。
**引用**：Tse et al. 2007, *Science* 316:76–82（PMID 17412951）；Bartlett 1932, *Remembering*。**[Well-supported]**

#### E. 互补学习系统（CLS）
**定义**：快学习海马与慢学习新皮层互补——海马快速编码具体情景而不覆盖皮层结构；皮层缓慢提取共享结构。
**核心发现**：单一连接网络学重叠模式会**灾难性遗忘**。解法：稀疏、模式分离的海马库做单次编码，离线**重放/复现**交错新旧以训练慢皮层——"稳定性–可塑性困境"由双时间尺度解决。
**引用**：McClelland, McNaughton & O'Reilly 1995, *Psychol Rev* 102:419–457（PMID 7624455，经核）；Marr 1971, *Phil Trans R Soc B* 262:23–81；McClelland, McNaughton & Lampinen 2020, *Phil Trans R Soc B* 375:20190637（PMID 32248773）。**[Established 框架；边界条件有争议]**

### 1.2 存储 / 编码

#### A. Hebbian 可塑性、LTP/LTD
**核心发现**：突触在前后神经元共激活时增强（"一起激发，连在一起"）；高频刺激穿通纤维产生持续数小时–数天的 LTP；依赖 NMDA 受体、Ca²⁺ 内流、CaMKII/PKA，晚期 LTP 需新蛋白合成。
**引用**：Hebb 1949；Bliss & Lømo 1973, *J Physiol* 232:331–356；Malenka & Nicoll 1999, *Neuron*。**[Established]**

#### B. Engram 细胞 / 神经元集群
**定义**：物理记忆痕迹 = 编码时激活、回忆时再激活的稀疏分布式集群（Semon 1904 概念）。
**核心发现**：c-Fos 标记 + 光遗传证明 engram 对回忆**必要且充分**：沉默则回忆受阻，人工再激活则唤起记忆（甚至虚假/异情境记忆）。engram 稀疏（区域内约 1–5%）且跨区分布。
**引用**：Josselyn & Tonegawa 2020, *Science* 367:eaaw4325（PMID 31896692，经核）；Liu et al. 2012, *Nature*；Ramirez et al. 2013, *Science*（虚假记忆）；Tonegawa et al. 2015, *Neuron*。**[Well-supported；"engram=记忆单元"仍在研究]**

#### C. 记忆分配与内在兴奋性
**核心发现**：哪些神经元加入 engram 并非随机——**内在兴奋性更高**（如 CREB 高）者优先被招募；兴奋性波动决定两个 engram 是重叠（整合/共分配）还是分离，从而关联时间相近/相关记忆。
**引用**：Han et al. 2007/2009, *Science*；Yiu et al. 2014, *Neuron*；Josselyn & Frankland 2018, *Annu Rev Neurosci* 41:389–413（PMID 29709212）。**[Well-supported]**

#### D. 突触巩固（分子）
**核心发现**：学习后数分钟–数小时，不稳定突触变化经基因表达与蛋白合成稳定。蛋白合成抑制剂（茴香霉素）与 CREB/PKA/CaMKII 阻断在编码附近给药致遗忘，效应**时间依赖**。**突触标记与捕获**：弱标记突触可捕获邻近强激活突触的塑性相关蛋白。
**量化**：关键窗口约数分钟–6 小时。
**引用**：Kandel 2001, *Science* 294:1030–1038 / Kandel 2004, *Biosci Rep* 24:475–522（PMID 16134023）；Frey & Morris 1997, *Nature*；Dudai 2004, *Annu Rev Psychol* 55:51–86（PMID 14744210）。**[Established]**

#### E. 系统巩固：标准模型 vs 多痕迹理论（MTT）
**标准模型**：随时间（天→年）记忆由海马依赖重组为皮层依赖，产生**时间梯度逆行性遗忘**（近事最脆弱，Ribot 定律）。
**MTT**：海马对情景/自传体记忆**始终必要**；每次提取写入新的、略有差异的痕迹，故老记忆冗余更多；语义可海马独立，情景不可。
**状态**：两者均活跃争论——标准模型基于人类/动物的梯度逆行遗忘与远事依赖皮层；MTT 基于自传体情景记忆的平坦梯度与海马对远事情景细节的持续参与。
**引用**：Squire & Alvarez 1995, *Curr Opin Neurobiol*；Nadel & Moscovitch 1997, *Curr Opin Neurobiol* 7:217–227（PMID 9142752）；Frankland & Bontempi 2005, *Nat Rev Neurosci* 6:119–130（PMID 15685217）。**[Contested]**

#### F. 睡眠回放（sharp-wave ripples）、NREM/REM
**核心发现**：离线睡眠中近期编码模式被自发再激活（"回放"）。NREM/SWS 期海马 **sharp-wave ripples（SPW-R）** 回放清醒 place-cell 序列（常压缩、反向），与皮层**慢振荡（~0.8 Hz）**、**纺锤波（10–15 Hz）**及低乙酰胆碱协同（利于巩固而非编码）。干扰 ripple 损害记忆。REM 更多涉及程序/情绪记忆与创造力（人类证据较弱且不一致）。
**量化**：SPW-R ~100–300 Hz（啮齿类），SWS 期约 1/s；回放压缩约 10–20×。首证：Wilson & McNaughton 1994。睡眠中靶向再激活（TMR）可偏置巩固。
**引用**：Wilson & McNaughton 1994, *Science* 265:676–679（PMID 8036517）；Rasch & Born 2013, *Physiol Rev* 93:681–766（PMID 23589831，经核）；Buzsáki 2015, *Hippocampus* 25:1073–1188；Girardeau et al. 2009, *Nat Neurosci*。**[Well-supported（NREM）；REM 角色有争议]**

#### G. 齿状回模式分离
**定义**：把相似输入模式变换为互不重叠（正交化）的表示。
**核心发现**：稀疏、高阈值的齿状回颗粒细胞（含成年神经发生）去相关相似经验；CA3 递归侧支做互补的**模式完成**（见 1.3B）。证据跨单元记录、即早基因成像、转基因模型、人类 fMRI 与老化（DG/CA3 功能障碍致年龄相关辨别缺陷）。
**引用**：Yassa & Stark 2011, *Trends Neurosci* 34:515–525（PMID 21788086，经核）；Leutgeb et al. 2007, *Science*；Bakker et al. 2008, *Science*。**[Well-supported]**

### 1.3 联想（Association）

**联想不是外挂功能，而是编码/存储方式本身——"共激活即联结"。**

#### A. Hebb 细胞集群
**核心发现**：反复共激活的神经元形成集群（cell assembly），之后激活其中一部分即倾向激活全体——联想的细胞基础。
**引用**：Hebb 1949, *The Organization of Behavior*。**[Established]**

#### B. 自联想 vs 异联想
**核心发现**：CA3 递归侧支构成**自联想**网络（部分→全体，吸引子动力学）；CA1/内嗅皮层做**异联想**（把 A 关联到 B）。两者分工支持"补全"与"跨项联结"。
**引用**：Marr 1971, *Phil Trans R Soc B* 262:23–81；Rolls 2013, *Phil Trans R Soc B*。**[Well-supported]**

#### C. 关系/联结编码（relational memory）
**核心发现**：海马把"什么-哪里-何时"绑成一个**关系性表征**，而非独立存储单个项目；这解释了海马损伤后"记得单个事实却无法灵活联结"的缺陷。
**引用**：Eichenbaum 2000, *Nat Rev Neurosci* 1:41–50；Eichenbaum, Yonelinas & Ranganath 2007, *Annu Rev Neurosci* 30:123–152；Cohen & Eichenbaum 1993, *Memory, Amnesia, and the Hippocampal System*。**[Well-supported]**

#### D. 共分配联结（时间相近 → 关联）
**核心发现**：时间相近/相关的事件因神经元兴奋性重叠而**共享 engram 细胞**，一个线索可唤起两个记忆——"时间邻近即关联"的机制。
**引用**：Yiu et al. 2014, *Neuron* 83:722–735；Josselyn & Frankland 2018, *Annu Rev Neurosci* 41:389–413。**[Well-supported]**

#### E. 语义联想：扩散激活
**核心发现**：皮层语义网络中，激活沿概念间连接扩散（spreading activation），概念间"距离"即联想强度——语义检索的基础。
**引用**：Collins & Loftus 1975, *Psychol Rev* 82:407–428；Anderson 1983, *J Verbal Learn Verbal Behav*（ACT*）。**[Established（认知模型）]**

#### F. 图式关联
**核心发现**：mPFC 图式让新信息快速挂接到既有知识结构，图式一致的新联想单次巩固。
**引用**：Tse et al. 2007, *Science* 316:76–82（PMID 17412951）。**[Well-supported]**

> **小结**：联想强度 = 共激活历史（Hebbian）＋ 表征重叠度（engram 共分配）＋ 图式兼容性（mPFC）。

### 1.4 取回（Recall —— 把内容带回来）

#### A. 线索驱动回忆与编码特异性
**核心发现**：线索仅在"编码时与目标绑定"时有效（编码特异性原则）；回忆是**线索驱动的重构**，非穷举搜索。
**引用**：Tulving & Thomson 1973, *Psychol Rev* 80:352–373；Godden & Baddeley 1975, *Br J Psychol*。**[Established]**

#### B. CA3 模式完成
**核心发现**：CA3 递归兴奋网络是吸引子/自联想器：部分线索可再激活完整集群。CA3 NMDA 受体敲除损害联想记忆回忆而相对保留编码——CA3 参与模式完成的直接证据。
**引用**：Nakazawa et al. 2002, *Science* 297:211–218；Rolls 2013, *Phil Trans R Soc B*；Marr 1971。**[Well-supported]**

#### C. 海马索引理论（海马 = 指针）
**定义**：海马存储稀疏**索引**，绑定该经验激活的分布式皮层位点；再激活索引即再激活整个皮层模式。
**引用**：Teyler & DiScenna 1986, *Behav Neurosci* 100:147–154（PMID 3008780）；Rolls 2010, *Behav Brain Res*；Teyler & Rudy 2007, *Hippocampus*。**[Established（理论）；机制细节有争议]**

#### D. 检索是重构而非回放
**核心发现**：回忆是受图式偏置的主动重构，可引入错误与虚假记忆；与想象未来共用机制。检索还会主动造成竞争记忆的遗忘（**提取诱发遗忘**）。
**引用**：Bartlett 1932；Loftus & Palmer 1974；Schacter, Addis & Buckner 2007, *Nat Rev Neurosci* 8:657–661；Anderson, Bjork & Bjork 1994, *J Exp Psychol Learn Mem Cogn* 20:1063–1087。**[Established]**

#### E. 再巩固（提取使记忆可更新）
**核心发现**：被重新激活的已巩固记忆可回到不稳定态、需重新蛋白合成以再稳定——更新的窗口。恐惧条件反射中，再激活**后**注入茴香霉素致遗忘（即使条件反射 14 天后）；不再激活则无影响，延迟 6 h 亦无效。
**引用**：Nader, Schafe & LeDoux 2000, *Nature* 406:722–726（PMID 10963596）；Nader & Hardt 2009, *Nat Rev Neurosci* 10:224–234（PMID 19229241）；Dudai 2012, *Annu Rev Neurosci* 35:227–247。**[Well-supported（现象）；边界条件有争议]**

#### F. 双过程：回忆（recollection） vs 熟悉感（familiarity）
**核心发现**：取回有两种可分离模式——**回忆**（海马依赖，带情境细节、"记得"）与**熟悉感**（鼻周皮层，无细节、"知道见过"）。双过程理论解释了为何有些记忆"能再认却说不出"。
**引用**：Yonelinas 2002, *J Mem Lang* 46:441–517；Eichenbaum, Yonelinas & Ranganath 2007, *Annu Rev Neurosci* 30:123–152。**[Well-supported]**

### 1.5 检索（Search —— 主动寻找）

**大脑不做"全库扫描"；检索是前额叶引导的线索生成 + 海马补全 + 监控。**

#### A. 前额叶控制检索
**核心发现**：DLPFC 负责**检索努力、策略、线索生成与结果监控**（retrieval search & monitoring）；海马负责实际的联想补全。二者构成"目标约束下的搜索"。
**引用**：Norman & O'Reilly 2003, *Psychol Rev* 110:611–632；Lisman & Grace 2005, *Neuron* 46:703–713。**[Well-supported]**

#### B. 自由回忆的动力学
**核心发现**：自由回忆有稳定结构——**时序邻近**（想起的会带出时间相邻项）、**语义聚类**（按类别成簇涌出）、**首因/近因效应**。这些是"搜索轨迹"的指纹，非随机采样。
**引用**：Kahana 1996, *J Exp Psychol Learn Mem Cogn*；Howard & Kahana 2002, *J Math Psychol*；Bousfield 1953。**[Established]**

#### C. 语义搜索 = 扩散激活
**核心发现**：从一个概念沿语义网络扩散到相关概念，是语义记忆检索的机制。
**引用**：Collins & Loftus 1975, *Psychol Rev* 82:407–428。**[Established（认知模型）]**

#### D. 目标导向检索
**核心发现**：PFC 维持检索目标（"我在找什么"），海马在目标约束下补全——检索即"受目标约束的主动推理"。
**引用**：Norman & O'Reilly 2003；Lisman & Grace 2005。**[Well-supported]**

#### E. 再认：熟悉感先行
**核心发现**：再认时熟悉感信号先快速判断"像不像"，回忆再补细节；二者可分离（见 1.4F）。
**引用**：Yonelinas 2002。**[Well-supported]**

### 1.6 遗忘（Forgetting）

#### A. 衰减、干扰、主动/适应遗忘
**核心发现**：认知心理学长期偏好**干扰**胜过被动衰减，但神经生物学支持**主动、受调控的衰减/遗忘**（多在睡眠发生）；"自然遗忘"反映 engram 细胞经环路重塑从**可及**转为**不可及**，受环境失配调制。分子效应器含 Rac1/cofilin；成年神经发生可通过重塑 DG 驱动遗忘。
**引用**：Hardt, Nader & Nadel 2013, *Trends Cogn Sci* 17:111–120（PMID 23369831）；Ryan & Frankland 2022, *Nat Rev Neurosci* 23:173–186（PMID 35027710）；Shuai et al. 2010, *Cell*；Akers et al. 2014, *Science*。**[Contested（衰减 vs 干扰）；主动遗忘 Well-supported]**

### 1.7 争议 / 开放问题
1. **系统巩固 vs MTT**：海马对远事是否变得可弃？情景记忆的逆行梯度在不同记忆类型上时有时无。**未决**。
2. **再巩固边界条件**：需预测误差/较弱或较新记忆/特定提醒协议才可诱导；人类可重复性存疑。
3. **Engram vs 分布式**：记忆定位于可定义集群，还是本质分布式/关系式？engram 长期成熟（静默 engram、皮层转移）与系统巩固关系未决。
4. **衰减 vs 干扰**：认知心理学多否定衰减，神经生物学主张主动睡眠衰减——尚未调和。
5. **睡眠功能**：NREM 回放对声明式巩固证据强；REM 具体角色（程序？情绪？创造？仅许可？）人类不一致。
6. **工作记忆容量**：~4 chunk vs 7±2；注意基 vs 干扰/短时存储衰减。
7. **模式分离/完成二分**：DG-分离 / CA3-完成的映射有力，但亚区功能并非完全分离。

---

## 2. 第二线：AI 记忆系统如何实现

> 神经类比图例：● 明确神经机制主张 · ◐ 认知/松散类比 · ○ 工程类比（OS/Zettelkasten），无脑主张 · — 无。

### 2.1 对照矩阵

| 系统（arXiv/来源） | 组织（模式/类型/层） | 存储（后端；去重/合并/巩固；衰减） | 检索（机制；排序/融合/重排） | 神经类比 |
|---|---|---|---|---|
| **HippoRAG** `2405.14831`；**HippoRAG 2** `2502.14802` (ICML'25) | `(s,p,o)` 三元组 + 段落节点的 KG；无固定本体、实体锚定 | Neo4j/NetworkX + 段落向量索引；节点身份天然去重；无衰减 | 查询→查询三元组→图匹配→段落召回；**Personalized PageRank** 传播；v2 加深度段落整合 | ● **海马索引**；**模式分离/完成**（DG/CA3/CA1）；联想记忆 |
| **MemGPT / Letta** `2310.08560` | 3 层：主上下文（core）/ 召回存储（全史）/ 归档存储（无界） | 向量库 + core 文本块；LLM 驱动 append/replace；**无去重、无衰减** | Agent 主动工具调用检索；core 常驻、归档按需 | ○ **OS 虚拟内存**类比；◐ 工作/长时映射 |
| **Mem0** `2504.19413` | 抽取的原子事实，按 user/agent/session 命名空间；可选图变体 | 向量库（+Neo4j）；**写时 LLM 判 ADD/UPDATE/DELETE/NOOP**；就地 UPDATE；**无衰减** | 嵌入 top-k；图多跳可选；混合融合可配 | — |
| **Zep / Graphiti** `2501.13956` | **时序 KG**：episode→entity→community；双时态边（`t_valid`/`t_invalid`） | Graphiti + Postgres/pgvector；冲突自动更新；**边失效而非删除** | **三混合**：cosine + BM25 + BFS 图 → RRF/MMR/交叉编码重排 | ◐ 时序有效性；无明确脑主张 |
| **A-MEM** `2502.12110` (NeurIPS'25) | **Zettelkasten** 原子笔记 + 关键词/标签/链接；记忆网络 | 向量库 + 链接图；相似建链；**记忆演化**（写时更新既有笔记）；无衰减 | 语义搜索 + 链接遍历（多跳）；标签过滤 | ○ Zettelkasten 方法 |
| **Generative Agents** `2304.03442` (UIST'23) | 单一**记忆流** + 反思（递归抽象） | 扁平时间戳列表 + 嵌入；**无去重**；仅近因指数衰减 | 线性扫描：`α·近因 + β·重要 + γ·相关`；top-k 注入 | ◐ 近因/重要/相关；反思即抽象 |
| **MemoryOS** `2506.06326` | 3 层：短/中/长期个人记忆 | OS 式：对话链 FIFO（ST→MT）、分段页组织（MT→LT）；无真衰减 | 分层：缓存→工作→长期 | ○ **OS 内存管理** |
| **LangMem** (LangChain) | 类型化记忆（semantic/episodic/procedural），命名空间隔离 | LangGraph Store（可插拔）；嵌入阈值去重；后台摘要压缩 | 嵌入相似 + 命名空间/类型过滤 | ◐ 认知记忆类型学 |
| **Titans** `2501.00663` (Google) | **参数化神经记忆模块**（可学矩阵）+ 注意力；MAC/MAG/MAL | 记忆编码于权重；**surprise 门控写入**；门控遗忘；不可检视 | 交叉注意力可微读取；>2M 上下文 | ● 短时（注意力）vs 长时（神经记忆）；surprise 编码；遗忘门 |
| **Memora** `2602.03315` (ICML'26, MS) | **primary abstraction** + **memory value** + **cue anchors** + 情景记忆；共享锚点构成隐式图 | 余弦 TopK ≥ γ → **LLM 判 CREATE/UPDATE**（合并入一条）；孤儿锚点剪枝 | 语义 top-k 或 **policy retriever**（MDP：Refine/Expand/Stop，GRPO 训练）；LoCoMo 86.3 / LongMemEval 87.4 | ◐ 抽象/具体平衡；线索依赖回忆；检索即主动推理 |
| **CueMem** `2609.12354` | 记忆记录 = **检索线索 + 源 turn 链接**（非自足证据）；turn 图（时间+语义边） | 线索库 + 源 turn 锚点 + turn 图；查询时重构；未述衰减 | 检索线索 → 映射源 turn 锚点 → turn 图扩展 → 重构紧凑证据 | ● **自传体记忆的重构观** |
| **EdgeMem** `2609.05553` | **证据保留多锚点超图**：内容/时间/情景线索；保留原始 turn | 免生成 LLM 构建；无生成压缩；超图存储 | 直接返回源证据；LoCoMo 严格判 61.01 vs 58.70；构建/检索零生成式 LLM 调用 | ◐ 互补情景线索；证据保真 |
| **REALM** `2609.16053` | **异质认知图**；记忆单元自主组织/演化 | 持续生命周期；**由检索反馈重组记忆**；无固定模式 | 自适应组合**图搜索原子**；LoCoMo 75.97 / LongMemEval 65.11；消融：再巩固持续有益 | ● **记忆再巩固** |
| **MemoryLACE** `2609.03201` | 原子 NL 记忆 + **生命周期关系：稀疏合并/取代/矛盾**；保留出处 | 轻量、无全局 KG；关系感知证据单元 | 关系感知证据重构（非独立检索）；较 Hindsight 快 66.6% | ◐ 证据生命周期 |
| **AutoViewMem** `2609.21940` | **自配置正交语义视图**；出处锚定抽取；离线巩固 | 写时解耦为低重叠视图；标准 top-K 存储 | 纯 top-K 相似（无路由、无迭代检索） | ◐ **干扰理论** |

**仓库调研另涉及**：NEMORI（巩固 + 权重衰减 + 多粒度）、LightMem（感知/短/长金字塔）、MemGen（查询时生成记忆）、MemoryBank `2305.10250`（艾宾浩斯衰减）、Agent Zero Memory `2608.29606`（citation-locked）、CreaMem `2609.08550`、HERO `2608.22310`。

### 2.2 关键系统要点

- **HippoRAG / HippoRAG 2 —— 唯一教科书级神经启发检索系统**：OpenIE 三元组成为 KG 节点/边，段落为独立节点；查询→LLM 查询三元组→种子→**Personalized PageRank**（联想回忆步）→段落重排。显式主张海马**稀疏索引**（三元组/锚点指向段落）、**模式分离**（实体区分）、**模式完成**（PPR 从部分线索补全）。是"神经启发"claim 最强的一例。
- **MemGPT/Letta —— OS 类比而非脑类比**：主上下文/召回/归档三层；写入是 agent 工具调用；**无去重、无衰减**（归档只增）。是"agent 自管记忆"概念祖先。
- **Mem0 —— 写侧智能，无神经主张**：差异点在**写时 LLM 路由** ADD/UPDATE/DELETE/NOOP，是最被复制的写侧模式（Memora 的 "w/o abstraction = Mem0" 基线）。
- **Zep/Graphiti —— 显式时序有效性**：双时态边 `t_valid`/`t_invalid`，失效不删除；三混合检索。是"显式时间有效性优于衰减加权"的参考。
- **Memora —— 与 MAFW 结构最亲**：primary abstraction（规范身份）+ memory value（具体）+ cue anchors（多对多访问）+ 情景记忆；余弦 ≥ γ + LLM 判 CREATE/UPDATE；共享锚点构成隐式图（RAG/KG 是其特例）。**消融关键**：无抽象（=Mem0）0.653 → 加抽象 0.795 → 加 update 0.801 → 语义检索 0.849 → policy 检索 0.863——**抽象层单项增益最大（+0.142）**。
- **2026 神经启发批次**：CueMem（线索→源 turn 重构，显式"重构观"）、EdgeMem（免生成、保真超图）、REALM（检索反馈驱动再巩固，消融证实有效）、MemoryLACE（取代/矛盾生命周期）、AutoViewMem（写时正交化抗干扰）。
- **仓库外补充**：Dual-Layer Agentic Memory `2608.22215`（快写路由 + 周期性**参数化巩固**写回权重，显式 CLS）、"Memo, Not True Memory" `2604.27707`（论证只实现海马快半、存在泛化天花板）、EverMemOS `2601.02163`（engram 生命周期命名）、eMEM `2606.03374`（8 种认知范式基准，含模式分离/完成、DRM 诱饵）、Human-Inspired Memory Architecture `2605.08538`（六机制含睡眠巩固/engram 成熟/再巩固）、HippoMM `2504.10739` / Hippocampus-DETR `2606.27831`（显式亚区映射，视觉）、AI Engram `2606.14997`（engram 判据形式化）。

### 2.3 缺口分析（脑机制在 AI 系统中的落地程度）

| 脑机制 | 现状 | 判定 |
|---|---|---|
| 海马稀疏索引（指针） | HippoRAG、CueMem、EdgeMem、Memora、MAFW | **已落地**（最好覆盖，2025–26 主流方向） |
| 模式完成 / 联想回忆 | HippoRAG PPR、A-MEM、Zep BFS、REALM | **部分**（仅图/指针族；扁平向量族缺失） |
| 模式分离 | HippoRAG（声称）、AutoViewMem（视图）、eMEM（基准） | **基本缺席**（密集嵌入主导，相似输入保持相似） |
| 图式抽象 | Generative Agents、EverMemOS、DCPM、MemSIF | **部分**（一次性摘要，非可修订图式） |
| 主动/适应遗忘 | FSFM、GateMem、FadeMem；被动衰减普遍 | **部分**（衰减多，适应式罕见） |
| CLS（快/慢耦合） | 广泛援引；仅 Dual-Layer 写回权重是真实例 | **部分框架 / 缺学习动态** |
| 再巩固（检索改写） | REALM、SmartVector、Human-Inspired（孤例） | **默认缺席**（检索几乎都是只读） |
| 系统巩固（睡眠回放） | Dual-Layer、LatentEvolve；其余为摘要 | **缺席**（摘要/去重 ≠ 回放） |
| Engram 稀疏分配 | AI Engram、EverMemOS（命名）、HippoMM/DETR（视觉） | **文本记忆中缺席** |

---

## 3. 第三线：MAFW 谐波记忆系统现状（实测快照）

> 来源：`AGENTS.md` §3/§5.11–5.13 + `2026-09-23-latest-memory-papers-survey.md` + 本次 `GET /api/memory/stats` 实测。

| 层 | 实现 | 实测状态（2026-09-23） |
|---|---|---|
| 表示 | `HarmonicUnit`（primary_abstraction / cue_anchors / memory_value / energy / salience / pinned / sticky_until / superseded_by） | 索引 **3263** 条 |
| 存储 | OKF markdown 分 tier + `.harmonic_index.json` + `gateway.db` | superseded 链、pinned、sticky 与 type 正交 |
| 检索 | BM25 × energy × salience（默认）→ 可选 dense RRF(k=60) → **anchor graph 扩展**（maxHops 1 / maxNeighbors 3 / damping 0.6）→ 显式时间锚定 ×1.5 | 1000 条 ~2-3ms |
| 撤销 | `resolveSupersededHeads()` 检索出口**强制改写到链头**（非仅 ×0.5 惩罚） | ✅ 已落地（v4.13.2） |
| 写入 | MinHash 段级合并（阈值 0.7，char 3-gram）→ **ConsolidationService**（cosine 0.8 召回 + LLM 判 UPDATE/CREATE）→ soft-supersede | 判官 judged=3 / creates=3 / updates=0 |
| 衰减 | 0.005/天 增量衰减，salience 越高越慢 | 心跳 ok |
| 披露 | pinned → `<user-profile>`（每轮）；sticky → `<note-board>`（保质期） | 与 type 正交 |
| 向量 | local **onnx** Qwen3-Embedding-0.6B（1024d），按 provider.name 打标签 | vectors 5571 / coverage 1.71 |
| 后台 | turnCompress（每小时）/ reflect / stale-verify（每周）/ decay（03:30 UTC） | **turnCompress 当前 ok:false（4 session 失败）** |
| 心跳 | `PipelineHeartbeat` + `GET /api/memory/stats` 的 `pipelines` 字段 | ✅ 已落地（v4.13.2） |

**注意**：实测显示 `memory:turnCompress` 最近一次 `ok:false`（`4 session(s) failed`）——这正是心跳机制的价值：静默失败被暴露。reflect / review 尚无 `lastRunAt`（从未跑过，心跳按设计不判 stale）。

---

## 4. 三方对照：脑 ↔ AI 系统 ↔ MAFW

| 神经机制 | 大脑 | 当前 AI 系统 | MAFW 现状 | 差距判定 |
|---|---|---|---|---|
| 多系统分层（情景/语义/程序） | 解剖可分离系统 | 多为类型标签 | `type` 四类 + `abstraction_level` T1–L5 | ✅ 已对齐 |
| 稀疏索引（海马指针） | 海马索引 → 皮层表征 | HippoRAG/CueMem/EdgeMem/Memora | `primary_abstraction`/`cue_anchors` + `<recall>` 指针 + `mafw_get_memory` | ✅ 已对齐（领先） |
| 线索驱动回忆 | 编码特异性 | 检索族均线索基 | `cue_anchors` 驱动 BM25 + 图扩展 | ✅ 已对齐 |
| 联想（共激活/表征重叠） | Hebb 细胞集群；engram 共分配；扩散激活 | 共享锚点/图边（HippoRAG/A-MEM/Memora） | `cue_anchors` 共享即隐式图；MinHash 合并 | ◐ 部分（有隐式图，无"共激活"动态） |
| 取回（recall） | 线索触发 + CA3 模式完成 + 索引再激活 | 图/指针族做补全；扁平族无 | BM25 命中 → 指针 → `mafw_get_memory` 取全文 | ◐ 部分 |
| 检索（search，主动） | PFC 策略/线索生成/监控 + 海马补全 | 少数（Memora policy retriever） | 无策略层（单次查询） | ❌ 缺席 |
| 模式完成 / 联想补全 | CA3 吸引子 | HippoRAG PPR 等（图族） | anchor graph hop-1（浅，非迭代吸引子） | ◐ 部分（可加深） |
| 模式分离 | DG 正交化 | 密集嵌入**反方向**；AutoViewMem 视图 | MinHash 合并 = **反方向**（相似即合并） | ❌ 缺席（结构性问题） |
| 图式抽象 | 增量抽象 + 同化/顺应 | 一次性摘要 | L5 启发式 / global / turnCompress 摘要 | ◐ 部分（无"顺应"修订） |
| 突触可塑性（强度） | LTP/LTD 权重 | importance / recency 权重 | `energy` × `salience` | ✅ 已对齐 |
| 突触巩固（分子） | 分钟–小时稳定 | 写时治理（Mem0/Memora） | 写时 salience + MinHash + ConsolidationService | ✅ 已对齐（工程化） |
| 系统巩固（回放） | SPW-R 回放 → 皮层 | 摘要/去重为主；Dual-Layer 写回权重 | turnCompress/reflect = **摘要**，非回放 | ❌ 最大架构缺口 |
| Engram 稀疏分配 | 稀疏、兴奋性竞争分配 | 文本记忆无；参数化/视觉有 | 无 | ❌ 缺席（研究级） |
| 重构（非回放） | 图式偏置重构 | CueMem/EdgeMem 回源重构 | 指针→全文兑现；有 `source_session_id` + trajectory | ◐ 部分（可回源 turn） |
| 再巩固（检索改写） | 提取→可更新窗口 | REALM 等孤例；多数只读 | soft-supersede 链；检索访问 +0.02 **休眠未接线** | ❌ 基本缺席 |
| 被动衰减 | 时间衰减（有争议） | 普遍 | energy 0.005/天、salience 调制 | ✅ 已对齐 |
| 主动/适应遗忘 | 目标/干扰条件化 | FSFM/GateMem/FadeMem 孤例 | 仅 salience 调制，无目标/干扰剪枝 | ◐ 部分 |

**结论**：MAFW 在"快索引 + 线索 + 强度 + 写时治理 + 衰减"这一**海马快半**上已与神经机制和 2025–26 前沿高度对齐，且撤销硬执行、管线心跳已补齐。缺口集中在**慢半与可塑性动态**：系统巩固的"回放"、检索驱动的"再巩固"、模式分离的表示级正交化、适应式遗忘。

---

## 5. 行动项（按性价比排序）

1. **系统巩固的"回放"（补最大缺口）** —— 现 turnCompress/reflect 是一次性 LLM 摘要，非"采样历史 → 诱导结构 → 交错训练慢层"。最小可行：为 worker prompt 注入**跨会话历史样本**（从 `gateway.db` trajectory 采样同主题旧条目），使其在摘要时**交错复现**旧知识而非只压新回合——即 CLS 式 interleaved replay 的非参数近似。参考 `2604.27707`（只做快半有泛化天花板）、`2608.22215`（Dual-Layer 写回权重，终局形态）。
2. **检索驱动再巩固** —— 接线休眠的"检索访问 +0.02"，并进一步：命中的记忆在**被实际使用**（`mafw_record_feedback` 点赞 / 被引用进回答）后进入"可更新窗口"，允许 turnCompress 对其做 UPDATE 而非只 CREATE。参考 REALM `2609.16053`（消融证实再巩固有效）、SmartVector `2604.20598`（反馈再巩固 + 对数访问强化）。
3. **cue → 源 turn 重构** —— 已有 `source_session_id` + trajectory；把 anchor graph 命中的锚点解析回**原始 session turn**，实现 CueMem/EdgeMem 式"证据回源重建"，弥补"摘要丢细节"。参考 CueMem `2609.12354`、EdgeMem `2609.05553`。
4. **模式分离（表示级正交化）** —— 当前 MinHash 合并与模式分离方向相反（相似即合）。可探索写时**低重叠视图**（AutoViewMem `2609.21940`）或对高相似但语义冲突条目**强制分离**（不合并），并为检索出口保留可区分信号。
5. **适应式遗忘** —— 从纯 salience 调制走向**目标/干扰条件化**：与当前 Goal 无关且长期未被检索、被新版本取代的条目加速淡出；参考 FSFM `2604.20300`（安全触发/适应强化）、FadeMem `2601.18642`（相关性/访问/时序调制）。
6. **记忆使用校准评测** —— 检索 R@5 已 0.87+，L2 仅 ~66.7%，缺口在"读/用"。引入 MemCalib `2609.24259` 式双向反事实校准，区分 over/under-use。参考 eMEM `2606.03374`（认知范式基准，含 DRM 诱饵/来源监控）。
7. **即时运维** —— `memory:turnCompress` 当前 `ok:false`（4 session 失败），需排查（心跳已捕获，属正常暴露）。参考 `2609.05510`（无失败模式可静默通过）。
8. **联想增强（共激活建边）** —— anchor graph 现仅按"共享锚点"连边；加入**共激活信号**：同会话 / 时间邻近 / 同 Goal 出现的条目互加边权（Hebbian 共现），使联想反映"一起出现"而非仅"词面共享"。参考 1.3A/1.3D。
9. **检索策略层（显式路径）** —— boundary 之外，为显式检索加"查询改写 / 多轮扩展 / 停止判据"（PFC 式策略），参考 Memora policy retriever `2602.03315`；不改 100ms 边界契约。

---

## 6. 参考

### 神经科学（已对 Europe PMC / PMC 验证者）
Scoville & Milner 1957 · Squire 1992 (PMID 1594723) · Squire & Wixted 2011 (21456960) · Cowan 2008 (18394484) · McClelland et al. 1995 (7624455) · McClelland et al. 2020 (32248773) · Marr 1971 · Tse et al. 2007 (17412951) · Hebb 1949 · Bliss & Lømo 1973 · Kandel 2001/2004 (16134023) · Frey & Morris 1997 · Dudai 2004 (14744210) · Josselyn & Tonegawa 2020 (31896692) · Josselyn & Frankland 2018 (29709212) · Han et al. 2009 · Yiu et al. 2014 · Yassa & Stark 2011 (21788086) · Wilson & McNaughton 1994 (8036517) · Rasch & Born 2013 (23589831) · Buzsáki 2015 · Nakazawa et al. 2002 · Teyler & DiScenna 1986 (3008780) · Nadel & Moscovitch 1997 (9142752) · Frankland & Bontempi 2005 (15685217) · Nader et al. 2000 (10963596) · Nader & Hardt 2009 (19229241) · Hardt et al. 2013 (23369831) · Ryan & Frankland 2022 (35027710) · Anderson et al. 1994 · Schacter et al. 2007 · Eichenbaum 2000 · Eichenbaum, Yonelinas & Ranganath 2007 · Cohen & Eichenbaum 1993 · Collins & Loftus 1975 · Anderson 1983 · Yonelinas 2002 · Norman & O'Reilly 2003 · Lisman & Grace 2005 · Kahana 1996 · Howard & Kahana 2002 · Bousfield 1953

### AI 记忆系统（arXiv）
HippoRAG `2405.14831` · HippoRAG 2 `2502.14802` · MemGPT `2310.08560` · Mem0 `2504.19413` · Zep `2501.13956` · A-MEM `2502.12110` · Generative Agents `2304.03442` · MemoryOS `2506.06326` · Titans `2501.00663` · Memora `2602.03315` · CueMem `2609.12354` · EdgeMem `2609.05553` · REALM `2609.16053` · MemoryLACE `2609.03201` · AutoViewMem `2609.21940` · Dual-Layer `2608.22215` · "Memo, Not True Memory" `2604.27707` · EverMemOS `2601.02163` · eMEM `2606.03374` · Human-Inspired `2605.08538` · FSFM `2604.20300` · FadeMem `2601.18642` · SmartVector `2604.20598` · AI Engram `2606.14997` · HippoMM `2504.10739` · Hippocampus-DETR `2606.27831` · MemCalib `2609.24259` · Memory-as-Infrastructure `2609.05510` · MemoryBank `2305.10250`

### 仓库文档
`docs/reports/llm-agent-memory-systems-survey.md` · `docs/research/2026-08-26-memory-systems-pipeline-survey.md` · `docs/research/2026-09-01-long-term-memory-retrieval-survey.md` · `docs/research/2026-09-23-latest-memory-papers-survey.md` · `AGENTS.md` §3/§5.11–5.13
