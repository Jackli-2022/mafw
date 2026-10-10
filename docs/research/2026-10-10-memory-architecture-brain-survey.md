# 记忆系统架构梳理 × 大脑对照调研（2026-10-10）

> 目的：①全景梳理 MAFW 记忆系统 as-built 的存储 / 检索 / 抽象 / 遗忘 / 更新机制；②对照 2023-2026 认知神经科学新证据（系统巩固与睡眠、抽象与图式、检索与遗忘、神经调制门控）与 2025-2026 AI agent 记忆业界格局，识别对齐点、张力与新缺口。
> 姊妹文档：路线图 `2026-10-08-brain-like-roadmap.md`；arXiv 刷新 `2026-10-09-brain-research-refresh.md`。本文 **N 系列新缺口**编号接续 G 系列。
> 方法：4 条并行调研线（系统巩固/睡眠、抽象/图式、检索/更新/遗忘/调制、AI 业界格局），引文经 PubMed/Europe PMC/Crossref/arXiv 核验；三个原始术语无法定位（van Kesteren "PRIUDE"、标题含 "portable concepts" 的论文、Cerf "fire together wire together"——实证为 Ison et al. 2015），已在正文按可证文献修正。

---

## 1. 现状架构（as-built）

### 1.1 总图

```
【在线写路径】                                【读路径】
插件 hooks → /api/obs/capture                 每轮 LLM 调用前:
  → t1_observations (脱敏,会话白名单)          GET /api/recall/context (100ms 契约)
       │                                        ├─ R8 快照命中即服务 (TTL 10min+包含度≥0.25)
       ▼ (hourly)                              └─ miss → 实时 BM25 (tokenCache 词频缓存)
  turnCompress worker                                │
  ├─ B1 交错回放 (need×gain×1/energy, 48h 排除窗)    ├─ D5 PPR 扩散 (Hebbian need 调制 + Macro-Hub 抑制)
  ├─ agent 自主 mafw_add_memory                     ├─ R5 FOK 三区门 (reranker 概率, 分主题阈值)
  │   (类型自选; ≤1 条 tentative 草稿 @energy 0.35) ├─ G4 arbiter 三态 (annotate-only)
  └─ 处理过回合 → t1_archive (永不回流)              ▼
       │                                      <recall> 指针块 (+↳gist 提示 +↳邻居行)
       ▼                                      + <note-board> / <user-profile>
  route-write 六闸门:                          + <agent-priors> (L5+失败谱+能力账本)
  ├─ 权威校验 (authority: user|agent|tool|pipeline)  + <goal-snapshot> (manager)
  ├─ G2 laya 冗余门 (p≥τ → 沉底 0.05+redundant 锚)  + <memory-guide> (常驻)
  ├─ MinHash 合并 (0.7 阈值, 段级, soft-supersede)
  ├─ Consolidation 判官 (dense cosine≥0.8 候选 →  检索出口 → RetrievalEventBuffer (ACT-R 结算)
  │   laya 三值: p≥0.99 UPDATE / 全低直接 CREATE / 中间带 LLM)
  └─ salience/energy/abstraction_level 计算 → OKF + index

【离线管线 8 条 cron】
  02:00 memory-dream      活跃会话 → ≤3 "下次可能问" → 首捕获 prefetch
  03:00 memory-reflect    蒸馏 episodic→semantic gist; A2 提升/否决; D1b 源降能;
                          A5 stampDistilled; A4 选择压力回流; cat:failure 谱
  03:30 memory-decay      分型衰减 + CATD 拓扑承重 + ACT-R bonus drain (增量)
  04:30 memory-reconsolidate  24h labile 窗记忆 vs 更新同 cue 记忆 → keep/rewrite
  周日 04:00 memory-review    stale-verify 只读探测重验 → verified: 锚 / supersedes
  周日 05:00 skill-promotion  G1-G6 闸门 → SKILL.md staging → triage 人审 → 安装+指针化
  周日 06:00 axiom-distill    高 need insights → 公理候选 → triage → L5 commit
  hourly   turn-compress      (见上)
```

### 1.2 数据模型：HarmonicUnit（统一单元）

| 字段 | 语义 | 脑侧类比（§2 详） |
|---|---|---|
| `type` | episodic / semantic / procedural / global | 四记忆系统（Squire 分类） |
| `memory_value` | 全文内容 | 皮层内容存储 |
| `primary_abstraction` + `cue_anchors` | 检索面（6-8 词摘要 + 多跳线索锚） | 海马索引（索引≠内容） |
| `energy` × `salience` | 强度 × 显著度（排序 = 检索分 × energy × salience） | 记忆强度 / 调质标记 |
| `abstraction_level` | 1=episodic, 2=semantic/procedural, 3=global | 抽象梯度（连续，非类型派生） |
| `authority` (G1) | user > agent ≈ tool > pipeline | 来源监控 / 现实监控 |
| `distilled_by` (A5) | gist 指针数组（非 supersede，双向） | 概念细胞自索引神经元演化 |
| `superseded_by` / `merged_from` | soft-supersede 链（不物理删） | 加法式链接更新（非覆写） |
| `pinned` / `sticky_until` | 披露层 / 便签板（保质期保证送达） | PFC 目标维持（工程近似） |
| `verified:` / `tentative` / `redundant:` / `rejected` | 锚点即状态机 | 巩固状态标记 |

### 1.3 抽象是怎么做的（双系统 + 五条上行通道）

**双系统形态**（对齐 CLS，但为串行批处理改造——见 §2.5 张力）：

1. **快系统（小时级 turnCompress）**：per-session 持久 worker 会话读 batch transcript，agent 自主调用 `mafw_add_memory`——类型按内容自选；跨集抽象被 prompt 限制，但允许 ≤1 条 `tentative` 草稿（A2，energy 封顶 0.35）。
2. **慢系统（每日 reflection）**：增量游标扫 episodic → LLM 蒸馏 semantic gist → 源 episodes 降能 ×0.3（D1b，"细节先淡、要点存活"）→ `distilled_by` 双向指针回填（A5）→ tentative 草稿判定 promote（0.7 + verified 锚）/ reject（0.05 + rejected 锚）（A2）→ 上轮蒸馏产物的 7 天 need 命中率写进下轮 prompt（A4 选择压力）。

**五条上行通道**（阶梯不再断裂）：

| 通道 | 周期 | 产物 | 人审 |
|---|---|---|---|
| reflection 蒸馏 | 日 | semantic gist + distilled_by | 否 |
| axiom-distill（A1 补顶） | 周 | L5 公理（模式的模式） | triage |
| skill-promotion（W2 物化） | 周 | `~/.config/opencode/skills/` 里的 SKILL.md（procedural → 可调用能力） | triage |
| L1 能力账本 / L2 失败谱 | 事件驱动聚合 | goal_outcomes SQL 聚合 / cat:failure 聚类 → `<agent-priors>` 注入 | 否 |
| W4 goal 级先验 + D4b 反事实 | 每 goal | plan 节点注入 L1（byTaskType ≥3 样本分桶）+ L2 + pre-mortem riskNote | 否 |

### 1.4 遗忘与更新是怎么做的

- **分型衰减**：episodic 0.010 / semantic 0.005 / procedural 0.003 / global 0.001 每天，增量结算（`last_decay_at`）。
- **CATD（D5）**：衰减率 ÷ (1 + β·ln(1+加权度))——被越多记忆依赖的条目忘得越慢（拓扑承重）。
- **ACT-R 检索加成**：三个生产检索出口记 `RetrievalEventBuffer`，每日衰减 pass 同趟 drain——`B = ln(1+Σ(Δt+24h)^-0.5·w)`，k=0.03（一次新鲜检索 ≈ 一天衰减），cap 0.02，重复曝光折扣防 rich-get-richer。
- **soft-supersede**：MinHash 合并 / consolidation UPDATE / reconsolidate rewrite / 显式 supersedes——全部走"标记链头 + energy ×0.5"，不物理删除；检索出口 `resolveSupersededHeads()` 强制改写命中到链头。
- **reconsolidate（D2）**：被检索（带预测误差门）的记忆进入 24h labile 窗，每日 4:30 用更新的同 cue 记忆对照，矛盾才 rewrite。
- **stale-verify**：周检 top-10 高值 procedural/semantic，curator 只读探测环境，失真走 supersedes。
- **对称例外**：goal PASS → 关联记忆 +0.08（不对称：失败不降权，防错误归因）。

---

## 2. 大脑对照：逐机制映射

> 评估三档：**对齐**（机制同构，外部证据支持）；**部分**（有对应物但缺一半或判定基准不同）；**缺口**（脑有我们无 → §5 N 系列）。

| # | MAFW 机制 | 脑对应 | 关键证据 | 评估 |
|---|---|---|---|---|
| 1 | runtime session transcript + t1_observations（verbatim 高保真捕获；transcript 可经 runtime 工具检索） | 海马本体：快速、高保真、**无选择**捕获 + 可检索（模式补全）+ 天然衰减（compaction ≈ 有损衰减时钟，且不受记忆系统控制） | Teyler 索引理论；Sekeres 2016 | 部分——捕获属性对，但海马职能被拆散且部分错位（→ §2.4） |
| 1a | hourly turnCompress（选择 + 首次抽象 + B1 回放） | **不是海马**：「写入门（调质式选择，但脑的门在巩固侧、海马先全收；我们的门在存储侧、先筛再收）+ SWS 快速整合/图式直通 + 觉醒态重放」的混合体 | Tse 2007；van Kesteren SLIMM；Lewis & Durrant 2011 | 部分（映射修正 2026-10-10，见 §2.4） |
| 2 | reflection 蒸馏 + D1b 源降能 | **巩固=转换非复制**：感知细节最先丢、语义内容存活皮层化 | Winocur/Moscovitch 转换理论 2016；Sekeres 2016；Krenz 2023（表征向语义化漂移，*Nat Commun*） | 对齐——D1b 正是 "details fade, gist survives" |
| 3 | A2 草稿-验证（tentative 0.35 → promote/reject） | FTT：verbatim/gist 并行独立存储；（近似）低置信 gist 直到验证 | Reyna FTT；Chang 2025（MINERVA2 形式化） | 对齐（工程实现先于脑对应；FTT 双迹并行支持我们"源不删 + 草稿低权"） |
| 4 | decay（全局）+ ACT-R bonus（选择性）配对 | **全局突触缩减 + 选择性强化是同一个系统的两面** | Tononi SHY；Rasch & Born 2013（renormalization 使选择性强化成可能）；Xu 2024（睡眠恢复最优计算域） | 对齐——decay-only 丢选择性，boost-only 干扰爆炸，我们两边都有 |
| 5 | CATD 拓扑承重衰减 | 间接：schema 化知识更稳定；无"拓扑度"直接神经证据 | （AI 侧 EngramRAG；脑侧 vmPFC 远端记忆稳定性） | 部分——机制合理但脑侧证据弱，靠测量门（LongMemEval）自证 |
| 6 | B1 交错回放（need×gain 排序 + 48h 排除窗） | 选择性重放：**重叠重放提取图式；重放有干扰成本，脑有专用电路限流** | Lewis & Durrant 2011；Karaba 2024（CA2/CA3 平衡重放量，*Science*） | 对齐——48h 窗防 primacy bias；缺"干扰预算"（现只有成本预算） |
| 7 | reconsolidate（PE 门 + keep/rewrite） | 再巩固：**预测误差才开窗**；功能是更新非擦除 | Sevenster 2013（*Science*）；Díaz-Mataix 2013；Lee 2017 | 对齐 |
| 8 | soft-supersede 链 | **系统级更新是加法式链接**：远端记忆更新=建新海马 engram 链接旧迹，不覆写皮层 | Lei et al. 2024（*Neuron*） | 对齐（强）——我们的 supersede 链与脑同构 |
| 9 | MinHash 合并 | integration（前海马/CA1） | Schlichting 2015；Molitor 2021 | 部分——只有整合半边，**缺分化半边**（→ N4） |
| 10 | laya consolidation 三值判官 | **图式一致性写入路由**：congruent → 直通皮层快速整合；novel → 海马慢路径 | Tse 2007（图式加速巩固，48h 皮层化）；van Kesteren SLIMM 2012 | 部分——τ_high 0.99 快 UPDATE ≈ congruent fast path，但判定基准是**相似度**（cosine）非**图式契合度** |
| 11 | FOK 三区门（分主题阈值） | 元记忆 FOK：可达性启发式（会系统性误校）；搜索终止信号 | Koriat 1993/2000；Nelson & Narens 1990；Devaluez 2023（FOK 领域特异性） | 对齐且更优——reranker 概率特征（AUROC 0.782）比脑的 familiarity 启发式更有判别力；分主题阈值 = domain-specific monitoring |
| 12 | G4 arbiter（annotate-only） | 元认知 retrieve-when-needed（先自评内部不确定性再决定查） | MARTA（arXiv:2610.05223） | 对齐——observe-first 与"FOK 需对照真值校准"的文献结论一致 |
| 13 | D5 PPR + Hebbian need 调制 + Hub 抑制 | 扩散激活检索；**PPR ≈ SR 同构**（海马可对任意图算平稳分布） | Millidge 2025（arXiv:2512.24722） | 对齐——且 SR 同构暗示同一张图可服务规划（D4b 延伸方向） |
| 14 | ACT-R 检索加成 | **测试效应**：检索是第二次编码，最强学习干预 | Roediger & Karpicke 2006；Yang 2021 元分析（g≈0.50） | 部分——覆盖"强化"半边；**缺失真检查与竞争者抑制半边**（→ N5） |
| 15 | authority 字段 + 消费面闸门 | 来源监控 / 现实监控（想象 vs 知觉的来源归因） | Johnson source-monitoring framework；AuthMem-Bench（48/49 系统 authority 坍缩） | 对齐——业界普遍缺位，我们 G1 已修 |
| 16 | 事件切分 = 会话/小时批 | **事件分段**：预测误差/上下文稳定性触发边界，非固定窗口 | Zacks 2007；Kumar 2023（LLM 惊讶度预测分段）；Güler 2025（上下文稳定性主导）；Baror 2026 | **缺口 → N3**（10-09 HiMem 已标，本次脑侧证据再确认且升级） |
| 17 | cue_anchors 平面字符串 + R7 双索引 | **概念细胞**：不变的概念级表征；联想数次即挂新别名（写时 Hebbian） | Quiroga 2005/2026；Ison 2015；Dijksterhuis 2024（代词再激活名词概念细胞） | **缺口 → N1**（无实体规范化层） |
| 18 | A5 distilled_by（gist↔源双向指针） | **概念神经元从索引神经元经重叠记忆演化而来** | Kolibius, Josselyn & Hanslmayr 2025（*Trends Cogn Sci*） | 对齐——A5 正是 proto-concept-cell；N1 是它的下一步 |
| 19 | W2 skill 物化（procedural 一等公民） | 程序性记忆：基底核/小脑独立系统，**非 episodic 派生** | Squire 分类；Knowlton 1996 | 对齐且业界缺位——CoALA 的 procedural 是全行业普遍缺失肢 |
| 20 | memory-review 只读探测重验 | （无直接对应）环境校验式维护 | — | 工程创新（5.13b） |
| 21 | D4a dream 预取 | **REM 生成性模拟**：联想松动、跨域重组、规则抽象 | Stickgold & Walker 2013；Cai 2009；Pereira 2023（REM 声学提示促规则抽象） | 部分——我们是预测性预取（SWS 式复用），**非生成性重组**（→ N2） |
| 22 | salience 写时计算 | **写入门控**：新奇（LC-NE）、奖赏 PE（DA）、情绪（杏仁核）、**预期未来相关性**都能开门 | Takeuchi 2016（*Nature*）；Adcock 2006；Wilhelm 2011 | 部分——salience 有了；缺 reward-tagging / expected-relevance 显式接线与**追溯性 tag window**（→ N7） |
| 23 | 边界 recall 读路径零写 + 管线批量写 | **ACh 编码/检索模式切换**：同基底同时读写会互相干扰 | Hasselmo 1999/2006 | 对齐（架构层面天然满足） |
| 24 | 双系统 = 串行批处理（小时编码 + 每日蒸馏） | CLS 双系统**并行且每刻交互**（快系统每次回放都在喂慢系统） | Sun et al. 2023（*Nat Neurosci*：重叠存储的目的就是泛化） | 张力——A2 已部分缓解（快系统产草稿、慢系统验证）；串行批处理仍是大框架差异（见 §6） |

### 2.4 映射修正（2026-10-10）：海马体对应物的精确定位

> 初版把「T1 + turnCompress ↔ 海马快速捕获」标为对齐，经质询修正：turnCompress 做的恰是海马**不做**的两件事——**写时抽象**与**写时选择**。海马是高保真、快、不筛选的编码器；抽象与筛选是（慢速）皮层与（调质）巩固门的事。

海马的一揽子职能在 MAFW 中被拆到四处，其中两处错位、一处缺位、一处反向：

| 海马职能 | MAFW 落点 | 状态 |
|---|---|---|
| 快速高保真无选择捕获 | session transcript（runtime 所有）+ t1_observations（结构化镜像） | 捕获属性对；但海马同时**可检索**——t1 不可检索（冷存储），transcript 不进 harmonic 检索面（只在 runtime 工具里） |
| 索引（索引 ≠ 内容） | harmonic index（primary_abstraction + cue_anchors） | 错位：脑**先建索引后巩固**，我们**先抽象（turnCompress 转述）后建索引** |
| 模式分离（相似保持区分） | —（MinHash 反向：写时合并相似，容量 hack） | 缺位/反向 → N4 |
| 模式补全（部分线索恢复全貌） | BM25/PPR 检索 | 部分：是**库级**检索，非**痕迹级** auto-association |
| 重放发生器（ripples） | B1 交错回放（注入 worker prompt） | 半对：服务于**提取时刻**，脑的重放服务于**皮层整合** |

**turnCompress 的真实身份**是三个脑功能的混合体，没有一个叫海马：①写入门（神经调质式选择——但脑的门在"是否被巩固"且海马先全收，我们的门在"是否进入可检索记忆"先筛再收）；②SWS 式首次抽象（图式一致直通快路径——Tse 2007 的 48h 皮层化的小时级对应物）；③觉醒态重放（B1）。

**工程根因（非失误，是约束权衡）**：①成本不对称——海马容量天文数字、单条边际成本为零；我们每条记忆付一次 LLM 调用，"先全收再筛"付不起，必须写时一次完成筛选+压缩；②检索质量——对 raw transcript 做全库检索会被噪声淹没；③组织边界——verbatim 层归 runtime 所有，其生命周期（compaction）不受记忆系统控制，只能挂 compaction 事件做抢救性 flush（turnCompress flush on compacted）。

**架构后果**：①FTT 的 verbatim 轨迹**在检索空间不存在**——从第 1 小时起，检索面只有 worker 转述；脑"早期可回忆原文、晚期只剩 gist"的双轨迹能力缺失；②选择错误不可恢复——turnCompress 漏掉的掉进 t1_archive 死存储（"供未来重提取"但今天无重提取管线）；③脑 "tag at encoding → consolidate selectively" vs 我们 "先筛再收"——§2.5 张力-1 的根源形态；④与 2026-10-08 路线图差距 #2（同基质重放 vs 二手转述）/ D6 同源，且比当时认知更深：不只反思读不到原文，**检索面从未有过原文**。修复方向：D6 从"reflection 喂 turn 级原文"升格为"verbatim 可检索层"的完整设计（transcript/t1 的检索面接入 + compaction 前抢救已部分存在）。

### 2.5 三个深层张力（机制映射之外）

1. **"巩固选择"发生在什么时候**：脑在**编码时刻**就打标（salience/reward/expected relevance），只有打了标的才进离线重放池；且**编码后窗口内**（分钟-小时）出现显著事件可**回溯性提升**弱标记记忆（behavioral tagging 两阶段提交）。我们的 salience 也是写时算，但 consolidation 侧没有消费这个优先级（reflection 按游标不按 tag），且无回溯窗口。
2. **离线模式只有一种**：脑的睡眠分 **SWS 模式**（verbatim 强化 + 重叠整合，紧耦合）与 **REM 模式**（联想松动、跨域重组、情绪再校准、gist 偏置）——两种偏置都做抽象但方向不同。我们的离线管线全部是 SWS 式（整合/强化/压缩），零 REM 式（生成性重组）。
3. **合并 vs 分化是被路由的**：脑对重叠记忆同时运行 integration（CA1/前海马）与 differentiation（DG/CA3/后海马），由**预测误差**门控——违背预期的记忆被主动**分化增强区分度**而非合并。我们只有 MinHash integration 一条路，PE 违背的新知识可能被错误合并进旧簇。

---

## 3. 四线调研要点（新证据摘要）

### 3.1 系统巩固与睡眠

- 转换理论胜出：巩固 = 语义化转换（非复制），皮层版本是 schematic、去情境的，与原 episodic 痕迹共存（Moscovitch 2016；Krenz 2023 表征漂移直接证据）。
- 睡眠记忆分工：SWS（verbatim 强化 + 重叠记忆整合）vs REM（联想扩散、gist、图式偏置）——Stickgold & Walker "sleep-dependent memory triage"；REM 声学提示可促规则抽象（Pereira 2023）；睡眠使洞察发现率翻倍（Wagner 2004，60% vs 23%）。
- SHY vs 巩固之争未决但收敛于"两者兼备"：全局缩减 + 选择性强化的联合约束（Karaba 2024：脑主动限制重放量 → **重放有干扰成本，需要预算**）。
- 巩固选择三信号：情绪价（负面增强自发重放）、编码时奖赏（VTA-DA→海马 LTP）、**预期未来相关性**（被告知"以后要考"的记忆被睡眠选择性巩固——Wilhelm 2011）。
- 行为标记（behavioral tagging）：弱记忆在编码后 ~1h 内遇到显著事件会被回溯性固化——**两阶段提交**（tag 在学习时打，plasticity 产物由后到的显著事件提供）。

### 3.2 抽象与图式

- FTT 活跃且被形式化：verbatim/gist 并行独立存储、独立检索、不同遗忘速率；gist 随专长/年龄**增强偏好**（gist 偏好既是智慧也是 phantom recall 之源——必须暴露 provenance）。
- 概念细胞：不变性沿腹流通路递增至海马近全不变；编码**人/概念**而非图像；**内容-情境双群体**分离又结合（Bausch 2026）；代词可再激活名词概念细胞（Dijksterhuis 2024）；**概念神经元 = 索引神经元 + 重叠记忆的终点**（Kolibius 2025）。
- 认知地图：海马-内嗅存关系结构抽象（TEM 统一空间/关系泛化）；SR（后继表征）解释位置细胞；网格码组织概念空间；**结构因子化于内容**支持 one-shot 迁移（Yu 2021）；OFC 存任务状态地图。
- 图式：图式一致的新知识 **一次学习 + 48h 皮层化**（Tse 2007）；SLIMM——mPFC 检测"共鸣"直接整合 congruent 输入，海马处理 novel 输入。
- 分化 vs 整合：前海马整合 / 后海马+PFC 分化**同刻发生**（Molitor 2021）；PE 违背的项目被自适应分化（Kim 2017）；时间邻近促整合、唤醒偏向吸引（模糊化）。
- 语义 hub-and-spoke：ATL 无模态枢纽 + 模态 spokes；新概念走"海马快编码 → 逐渐词化入皮层竞争网络"（Davis & Gaskell 2009 的 CLS 词学习模型——与我们 A2 草稿→promote 同构）。
- 事件分段：边界由 PE/预测不确定度/上下文稳定性触发；**2025 修订：上下文稳定性比 PE 本身更主导**（Güler 2025；Baror 2026）；图式一致经验被粗分段（Bağlar 2026）。

### 3.3 检索、更新与遗忘

- 检索即写：强化（测试效应 g≈0.50）+ 失真（重复检索**放大** phantom memory）+ **竞争者抑制**（RIF：检索 A 抑制重叠的 B——检索是 pattern-completion-suppresses-overlap 的过程，**强化一条记忆对邻居永远不中性**）。
- 再巩固：PE 才开窗（完全预期的再激活不开）；功能 = 更新；**系统级更新是加法式**（新 engram 链接旧的，Lei 2024）；旧记忆随龄/强度抗拒开窗。
- 遗忘是主动且有益的：Rac1 主动擦除、**独立的多巴胺遗忘通路**（DAMB/Gq，与学习通路可分离——促固化与促修剪应分开门控）；消退记忆本身会被遗忘 → **被覆盖的记忆会随压制衰减而回浮**（supersede 链需在旧内容回浮时保持校验）。
- 静默 engram：**存在 ≠ 可达**——存储了但检索不可达的记忆可被非常规通路复活；别在检索失败时删除。
- 写入门控：LC-NE 新奇信号发"编码许可"（Takeuchi 2016）；ACh 是编码/检索模式开关；杏仁核给优先级盖章。
- 模式分离/补全是**不同细胞群**而非一个旋钮（Nakashiba 2012）；2024 新证据：分离是**预测感知的**——PE 内容获得额外区分度（Nigam & Schwiedrzik 2024）。
- FOK 是可达性启发式，会系统性误校（familiarity ≠ availability），必须对照真值校准——我们的 fok-samples 分主题拟合正是这个范式。

### 3.4 AI agent 业界格局（2025-2026）

- **共识七条**：写时 LLM 门控（无人默认存 verbatim）；保留原始 + 派生抽象（provenance 链）；混合检索（dense+BM25+图）；**离线巩固成主流**（Letta sleep-time compute + 2026 Dreaming、Mem0 Dream、LightMem、ChatGPT rolling summary）——"系统巩固"隐喻已赢；**invalidate-not-delete**（Graphiti 时间无效化、Mem0 supersede/merge）；纯文件是合法基质（Claude Code markdown+索引、Letta git-backed MemFS）；用户透明控制。
- **行业六大缺位**（我们对照）：遗忘被普遍忽视（仅 MemoryBank 艾宾浩斯 + Mem0 opt-in）——**我们的分型衰减+CATD+ACT-R 是稀缺资产**；多级抽象普遍缺失（都是两级：raw→fact/pattern，**无人实现 CoALA 完整 episodic→semantic→procedural 阶梯**——我们的 A1/A2/W2 是差异化资产）；变异位置未收敛（写时判官 vs 后台管线）；基质三分天下；**self-model 普遍缺位**（仅 Letta persona；能力自知无人做——我们的 L1/L2/L3 是差异化资产）；基准单一（LoCoMo/LongMemEval 只测 QA recall，不测漂移/陈旧/写路精度）。
- 值得抄的：Graphiti **双时间戳**（事件时间 vs 摄入时间，point-in-time 查询）；Mem0 实体库（entity extraction → graph memory，虽报告 graph 增益仅 ~2%）；Letta MemFS 用 git 做记忆版本控制（provenance/同步免费）。

---

## 4. 对齐确认（外部证据支持现有设计）

1. **离线巩固 + 双系统**：业界（Letta/Mem0/LightMem/ChatGPT）与脑（SWS/REM 分工）双确认——8 条 cron 管线架构方向正确。
2. **soft-supersede**：Lei 2024（系统再巩固是加法式链接更新）+ Graphiti/Mem0 全行业转向 invalidatate-not-delete——三重验证。
3. **"保原始 + 派生抽象"**：Graphiti episodes→facts、Mem0 evidence links 与我们的 t1_archive + distilled_by 同构；**A5 的双向指针比业界更完整**（业界只有 evidence 下指，我们还有 gist 行尾提示上浮）。
4. **混合检索 + PPR**：HippoRAG 2（ICML 2025）+ Millidge 2025（PPR≈SR）——D5 路线正确且与规划共享基质的暗示支持 D4b 联动。
5. **decay+boost 配对**：SHY 与选择性强化"both-and"共识——我们的全局衰减 + ACT-R/目标奖励结构同构。
6. **A2 草稿-验证**：Davis & Gaskell 词学习 CLS 模型（新词先海马快编码、后皮层化参与竞争）与我们 tentative→promote 完全同构——这是业界无人做、脑侧有模型支持的设计。
7. **FOK/arbiter 元认知层**：Koriat 可达性模型 + 必须对照真值校准的结论——我们的 observe-first（fok-samples 分主题拟合、arbiter-samples.jsonl）正是该范式。

---

## 5. 新缺口（N 系列，接续 G 系列）

| # | 缺口 | 一句话 | 证据 | 优先级判断 |
|---|---|---|---|---|
| **N1** | **实体概念层**（concept cells） | canonical entity ID + 写时别名挂接（数次共现即挂，Ison 2015）+ 基于 identity 的合并判定（修 MinHash 只看 shingle 相似的假合并）+ 概念细胞演化（distilled_by 的深化：索引神经元→概念神经元） | Quiroga 2005/2026；Ison 2015；Dijksterhuis 2024；Kolibius 2025；业界 Mem0 entity store / Graphiti entity nodes | **高**——数据质量根因（检索 hub 质量、假合并、R7 标识符检索上限都卡在这） |
| **N2** | **REM 模式**（生成性重组 pass） | 第二种离线偏置：跨簇松散联想、类比链接、gist 重组（SWS=整合/REM=重组分工）——与 D4a（SWS 式预取）互补 | Stickgold & Walker 2013；Cai 2009；Pereira 2023；Lewis & Durrant 2011 | **高**（挂 D6/D7 线——远期方向但脑侧证据强） |
| **N3** | **事件分段**（episode boundaries） | PE/预测不确定度/**上下文稳定性**触发边界替代小时批——episodic 单元获得语义粒度 | Zacks 2007；Kumar 2023；Güler 2025（context stability 主导）；Baror 2026；HiMem（10-09 已标） | **高**——与 N1 同为数据质量根因；上下文稳定性可纯启发式实现（无需 LLM） |
| **N4** | **自适应分化**（adaptive differentiation） | PE 违背的新记忆**增强区分度**（增补判别性 cue、拒合并）而非并入旧簇——补 MinHash integration 的另一半 | Kim 2017；Schlichting 2015；Molitor 2021（同刻双操作）；Nigam & Schwiedrzik 2024（top-down 分离） | 中——consolidation 侧小增强，可挂 G2 后续 |
| **N5** | **检索双面性补完** | ①检索后失真检查（强度≠真实，phantom 放大）；②RIF 竞争者抑制作去重（选中者强化 + 近重复未选者微抑制——G2 的检索时版本） | McDermott 2006；St Jacques 2013；Anderson 1994；Norman 2007 | 中——ACT-R 的另一半 |
| **N6** | **双时间戳查询面**（bi-temporal validity） | 事件时间 vs 摄入时间分离 + point-in-time 查询（"九月时我们相信什么"）——数据已在 supersede 链里，缺查询面 | Graphiti（业界） | 低 |
| **N7** | **巩固优先级 + tag window** | reflection 处理顺序按 need×energy（已有 A1 排序）；补：goal 活跃期写入的记忆优先巩固（expected relevance）+ 写后窗口内检索命中/验证回溯提升 | Wilhelm 2011；behavioral tagging（Moncada & Viola 2007；Toader 2023 丘脑门控） | 中——部分已有（goal reward +0.08 / A4 need 回流），缺显式消费 |
| **N8** | **结构骨架一等记忆**（cognitive map 升级 W3） | 不只"命中簇→注入 gist"，存**关系骨架**（转移结构/图式）为可跨域迁移的一等记忆对象 | Whittington 2020 TEM；Yu 2021 因子化；Constantinescu 2016 | 低（W3 重定义后再启动） |

**沿袭修订**：G 系列已全部落地（G1-G5, 2026-10-09）；A3（强模型抽象）维持搁置；D6/D7/L4 远期判断被 N2 强化——REM 生成性重组是它们的最短实现路径。

---

## 6. 路线图修订建议

1. **N1 + N3 排最前**：两者都是**数据质量根因**（N1 修合并与检索的上限，N3 修 episodic 单元语义粒度），且都无需新管线——N1 是写路径闸门增强（route-write 前：实体抽取→规范化 ID→identity 判定），N3 是 obs 切分策略替换（上下文稳定性启发式：话题包含度跌破阈值即切边界）。
2. **N2 定义为 D6/D7 的第一块砖**：先做 observe-only 版（REM pass 只产出"跨簇类比候选"落 triage 观察，不自动写）——与 D3 纪律一致。
3. **N4/N5 挂 G2 后续**：G2 冗余门已建立 laya 在写路径的接线，N4 分化/N5 RIF 是同一判定面（重叠检测）的正反两用。
4. **N7 中期**：reflection 排序按 need×energy 已有（A1 用 need 排），把 goal-active 维度补进 `selectAxiomSources`/reflection 优先级即可。
5. **D5 测量门维持待跑**（LongMemEval multi-session 0.375→≥0.55）——N1 实体层落地后一起跑（实体图会改变 PPR 质量基线，分开跑会浪费一次基准）。
6. **§2.5 张力-1 的回应**：编码时打标（salience）已有，"consolidation 侧消费优先级"由 N7 补齐——即脑的 "selection happens at write time" 在我们这里是 "tag at write, **consume at reflect**"。

---

## 附：本调研的四线原始报告

四条并行调研线的完整报告（含全部引文）存于本文档的调研底稿：本会话 task 结果（ses_edbc74bc0ffeGZPCZxBr9Azz4W / ses_edbc72281ffe0KVnOFM6BNvsD7 / ses_edbc6f730ffeNLi5SgV1BvaiZR / ses_edbc6d3b6ffe093HJSyhWYkZW2）。核心引文均已核验；以下为关键锚点：

- 转换理论：Moscovitch et al. 2016 *Annu Rev Psychol*；Krenz et al. 2023 *Nat Commun*
- 睡眠分工：Stickgold & Walker 2013 *Nat Neurosci*；Wagner et al. 2004 *Nature*；Pereira et al. 2023 *J Neurosci*；Karaba et al. 2024 *Science*
- 巩固选择：Wilhelm et al. 2011 *J Neurosci*；Takeuchi et al. 2016 *Nature*；Toader et al. 2023 *Cell*；Moncada & Viola 2007 *J Neurosci*
- 概念细胞：Quiroga et al. 2005 *Nature*；Quian Quiroga 2026 *Neuron*；Ison et al. 2015 *Neuron*；Dijksterhuis et al. 2024 *Science*；Kolibius et al. 2025 *Trends Cogn Sci*
- 图式：Tse et al. 2007/2011 *Science*；van Kesteren et al. 2012 *Trends Neurosci*（SLIMM）；Hennies et al. 2016 *J Neurosci*
- 分化/整合：Schlichting et al. 2015 *Nat Commun*；Molitor et al. 2021 *J Neurosci*；Kim et al. 2017 *J Neurosci*
- 认知地图：Behrens et al. 2018 *Neuron*；Whittington et al. 2020 *Cell*；Stachenfeld et al. 2017 NeurIPS；Millidge 2025 arXiv:2512.24722（PPR≈SR）
- 检索即写：Roediger & Karpicke 2006 *Psych Sci*；Yang et al. 2021 *Psychol Bull*；McDermott 2006 *Psych Sci*；Anderson et al. 1994 *JEP:LMC*；Norman et al. 2007 *Psychol Rev*
- 再巩固：Nader et al. 2000 *Nature*；Sevenster et al. 2013 *Science*；Lee 2017 *Trends Cogn Sci*；Lei et al. 2024 *Neuron*（加法式系统更新）
- 遗忘：Richards & Frankland 2017 *Neuron*；Bjork & Bjork 1992（new theory of disuse）；Ryan et al. 2015 *Science*（静默 engram）；Yang et al. 2023 *Curr Biol*（消退记忆被主动遗忘→覆盖回浮）
- 门控：Hasselmo 1999/2006（ACh 模式开关）；Nakashiba et al. 2012 *Cell*（分离/补全不同细胞群）；Nigam & Schwiedrzik 2024 *Nat Commun*（预测感知分离）
- 元记忆：Koriat 1993 *Psychol Rev*；Nelson & Narens 1990；Devaluez et al. 2023 *Sci Rep*
- 业界：Letta sleep-time compute arXiv:2504.13171 + 2026 MemFS/Dreaming docs；Mem0 arXiv:2504.19413 + Dream docs；Zep/Graphiti arXiv:2501.13956；HippoRAG 2 arXiv:2502.14802 ICML 2025；A-Mem arXiv:2502.12110 NeurIPS 2025；LightMem arXiv:2510.18866 ICLR 2026；CoALA arXiv:2309.02427 TMLR 2024；Claude Code memory docs 2026；survey arXiv:2504.02441 / arXiv:2505.00675
