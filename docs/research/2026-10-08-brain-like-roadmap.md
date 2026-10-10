# 脑启发记忆演化路线图（整合版）

> 日期：2026-10-08
> 本文是整合层：差距 → 7 个脑化方向 → 自我认知模型 → 统一依赖图与路线图。
> 细节附录：`2026-10-08-more-brain-like-memory.md`（附录一：7 方向全量论证）、`2026-10-08-self-cognition-model.md`（附录二：自我认知模型全量论证）、`2026-10-08-abstraction-runtime-wiring.md`（附录三：W 系列接线 + skill 物化通道与 G1-G5 闸门）。

## 1. 差距回顾（curator vs 脑的六个本质差距）

1. 权重 vs 文本（学习基质外置，检索成本永续）
2. 同基质重放 vs 二手转述（弱模型读强模型的转录）
3. 重构性 vs 静态文本（检索不改写内容）
4. gist 存活 vs verbatim 永存（无差异化衰减）
5. 做梦缺失（只有整合性回放，无生成性模拟）
6. 显著性外生（无预测误差式的内生写入门）

## 2. 七个脑化方向（详见附录一）

| # | 方向 | 脑机制 | 一句话改法 |
|---|---|---|---|
| D1 | ~~差异化衰减~~（已落地一半） | Fuzzy-Trace：细节先死、要点存活 | ~~分档衰减率~~**已实现**（`abstraction-level.ts:decayRateFor`：episodic 0.010/procedural 0.003/global 0.001/semantic 0.005）；**剩余**：gist 写出后源 episodes 降能 |
| D2 | 检索即重写 | reconsolidation：回忆时可塑 | 高频命中+检测到冲突 → curator 当场改写（supersede 链） |
| D3 | surprise 门控 | 多巴胺=预测误差 | novelty = 1 − maxCosine 作 importance 先验（向量基建现成） |
| D4 | 做梦 | 生成性回放 | D4a 预测性预取（R8 快照扩展）；D4b 反事实模拟注入 plan |
| D5 | 扩散激活检索 | HippoRAG：PPR 图谱 | cue_anchors 建图 + Personalized PageRank，攻 multi-session 0.375 短板 |
| D6 | 第一人称重放 | 同基质 replay | reflection 喂 turn 级原文；主模型自反思（成本换保真） |
| D7 | 叙事自我 | McAdams 叙事身份 | 每日第一人称日记（=自我认知模型 L4 的数据源） |

## 2.5 双系统并行差距：抽象能力不足（2026-10-08 用户提出，优先级高于 D 系列）

CLS 的双系统是**并行且持续交互**的（海马体记实例 / 新皮层抽规律，每次回放都是快系统喂慢系统）；我们是"小时编码 + 每日蒸馏"的**串行批处理**，且抽象环节是全套系统里投入最薄的：单遍 JSON 蒸馏、最弱模型、无层级、无质量回流。

**五个具体短板**：①单遍蒸馏无迭代；②最贵的认知任务用最便宜的 workerModel（一刀切）；③阶梯顶端断裂（semantic insight 不再被抽象，L5 靠手动）；④伪并行（turnCompress 被 prompt 明文禁止泛化，两管线同周期零交互）；⑤抽象产物无选择压力（下游命中率不回流）。

| # | 方向 | 改法 | 基建 |
|---|---|---|---|
| A1 | 阶梯补顶（模式的模式） | 周管线 insights→公理候选→审批进 L5 | L5 commit 现成 |
| A2 | 真并行（草稿-验证） | turnCompress 产低置信 tentative 草稿抽象，reflection 提升/否决 | 双管线现成，改 prompt+标记位 |
| A3 | 抽象用强模型 | workerModel 拆 extract/reflect 两档（`worker.prompt` 第四参收 model） | 配置拆分 |
| A4 | 选择压力回流 | 上轮蒸馏产物的 need 命中率写进下轮 reflection prompt | RetrievalEventBuffer 现成 |
| A5 | 抽象写回 schema | 蒸馏更新 schema 簇代表条目，不只新增碎片 | S2 簇现成，缺写回 |

**测量面**：semantic 层下游命中率、L5 提升率、A2 草稿被提升/否决比例。

## 2.6 接线侧：抽象→runtime 的 push 通道（W 系列，2026-10-08 用户修正）

> 详见 `2026-10-08-abstraction-runtime-wiring.md`。核心修正：抽象不足的真因不在生产侧而在接线侧——L5 公理纯 pull（MCP 工具），reflection insight 只有 BM25 检索一条或然通道，**零 push**。

| # | 通道 | 业界模式 | 一句话 |
|---|---|---|---|
| W1 | 常驻先验块 `<agent-priors>`（L5+失败谱+能力账本，~800 字符，compaction 免疫） | Letta 常驻式 | 全路线图杠杆最高 |
| W2 | workflow 物化（高频 procedural → skill 文件，审批门） | Voyager/AWM 物化式 | 抽象变可调用能力 |
| W3 | schema 驱动感知（命中簇→整簇 gist 注入） | Bartlett pattern completion | 依赖 D5 |
| W4 | goal 级先验（plan 注入 L1+L2） | options/规划层式 | plan 节点已接线（v4.22.0） |

## 3. 自我认知模型（详见附录二）

核心论点：**记录 ≠ 模型**。自我认知需要 monitoring → 结构化表示 → control 消费的闭环。

| 层 | 回答 | 数据源（均现成） | 消费点 |
|---|---|---|---|
| L1 能力账本 | 我擅长什么 | goal_outcomes 表（纯 SQL） | plan 预算/maxLoops |
| L2 失败模式谱 | 我反复踩什么坑 | reflection failure 类 insight | reflection 注入、D4b 输入 |
| L3 知识边界 | 我哪里不可信 | fok-samples 分主题统计 | FOK 分区阈值 |
| L4 自传时间线 | 我走到哪了 | D7 日记 + goal 里程碑 | 连续性呈现 |

## 4. 整合依赖图

```
                    ┌─ D3 surprise 门控（写入侧信号）
T1 观察 ──turnCompress──▶ episodic ──reflection──▶ semantic ──▶ L5
              │                │            │
              │           D1 差异化衰减   L2 失败模式谱 ◀──┐
              │                │            │            │
   R8 快照 ──D4a 做梦预取       │      D2 检索即重写 ◀── need 信号（RetrievalEventBuffer）
              │                │            │
   goal_outcomes ──L1 能力账本──┼──▶ plan 预算           │
   fok-samples ────L3 知识边界──┴──▶ FOK 分区阈值
   D7 日记 ────────L4 自传 ────────▶ 叙事连续
              D4b 反事实模拟 ◀── L1 + L2
              D5 PPR 检索 ◀── cue_anchors + 实体共现图
```

## 5. 统一路线图（基建 × 测量可达性排序）

| 序 | 项 | 理由 |
|---|---|---|
| 0 | ✅ **W1 常驻先验块** | 已交付（Plan 1，2026-10-08） |
| 1 | ✅ **W2 skill 物化通道**（md↔md 渲染 + G1-G5 闸门；deopt 留 v2） | 已交付（Plan 1，2026-10-08） |
| 2 | ✅ **D1b 源条目降能** | 已交付（Plan 1，2026-10-08） |
| 3 | ✅ **D3 surprise 门控**（laya 三值门 tauLow） | 已交付（2026-10-09：tauLow 默认关 + 校准器；真实数据证明暂无安全线） |
| 4 | ✅ **L2 失败模式谱** | 已交付（Plan 2：`buildFailureTaxonomy` + cat: 锚点） |
| 5 | ✅ **A4 选择压力回流** | 已交付（Plan 2：`selectionFeedbackBlock`） |
| 6 | ✅ **L1 能力账本** | 已交付（Plan 2：`buildCapabilityLedger` + `/api/agent/capabilities`；任务分类器仍缺） |
| 7 | ✅ **D4a 做梦预取** | 已交付（2026-10-09：每晚生成查询 → 首捕获消费） |
| 8 | ✅ **A2 真并行草稿-验证** | 已交付（2026-10-09：tentative 草稿 + reflection 提升/否决） |
| 9 | ✅ **D2 检索即重写** | 已交付（2026-10-09：每日 reconsolidate 消费 worker） |
| 10 | D4b 反事实模拟 | 依赖 L1+L2；plan 节点已接线（v4.22.0）→ **spec-first**（`2026-10-09-remaining-roadmap-all.md` Phase I） |
| 11 | ✅ **A1 阶梯补顶** | 已交付（2026-10-09：周管线 insights→公理候选→triage→L5） |
| 12 | ✅ **L3 知识边界** | 已交付（2026-10-09：FOK 样本 topic 字段 + 分主题阈值拟合） |
| — | ✅ **G2 写相路由（laya 冗余门）** | 已交付（2026-10-09：route-write 冗余门 + 沉底/强化 + observe-first） |
| 13 | D5 PPR 检索 | 需建图，LongMemEval 可测 → **spec-first**（Phase G） |
| — | P1.5 审批决策判定 | ✅ 数据积累已交付（2026-10-09：approval-decisions.jsonl eval/reply 对；模型选型后置） |
| — | D6/D7+L4 | 体验层，远端 |
| — | ✅ **W4 goal 级先验** | 已交付（Plan 3：plan 节点注入 L1+L2） |
| — | ~~A3 抽象用强模型~~ | **用户判定非瓶颈**（2026-10-08：问题在缺 skill 通道，不在模型能力）——降权搁置 |

> **第一批（Plan 1）已落地**（2026-10-08）：W1 常驻先验块（`<agent-priors>` 全链）+ W2 skill 物化通道（五闸门→staging→triage→安装指针化）+ D1b 源条目降能 + L2 category 落盘。计划：`docs/superpowers/plans/2026-10-08-w1-w2-d1b-abstraction-wiring.md`。

> 实施核查（2026-10-08）发现 D1 分档衰减已在生产运行（`automation-engine.ts:102` 调 `decayRateFor(entry.type)`），原"纯参数"判断过时；reconsolidation 窗口（`recall/reconsolidation.ts`）也已在反馈路径接线，D2 只缺冲突触发的消费 worker。

## 6. 显式排除

- LoRA 权重级巩固（无训练基建 + 灾难性遗忘）——远期愿景
- 情绪模拟（无测量面）

## 7. 2026-10-10 刷新：N 系列新缺口（`2026-10-10-memory-architecture-brain-survey.md`）

> 四线调研（系统巩固/睡眠、抽象/图式、检索/遗忘/调制、AI 业界格局）产出。G 系列已全部落地；N 系列接续编号。

| # | 缺口 | 一句话 | 优先级 |
|---|---|---|---|
| N1 | 实体概念层 | canonical entity ID + 写时别名挂接 + identity 判合并（修 MinHash 假合并；distilled_by 的深化）——concept cells / Kolibius 2025 | 高 |
| N2 | REM 生成性重组 | 第二种离线偏置：跨簇类比、gist 重组（现全部管线是 SWS 式整合）；D6/D7 第一块砖，observe-first | 高（远期启动） |
| N3 | 事件分段 | 上下文稳定性/PE 触发 episode 边界替代小时批（Güler 2025：context stability 主导；与 10-09 HiMem 缺口合流） | 高 |
| N4 | 自适应分化 | PE 违背的记忆增强区分度而非合并（MinHash 只有 integration 半边；Kim 2017） | 中，挂 G2 后续 |
| N5 | 检索双面性 | 检索后失真检查 + RIF 竞争者抑制（ACT-R 只覆盖强化半边） | 中，挂 G2 后续 |
| N6 | 双时间戳查询面 | point-in-time 查询（Graphiti 模式；数据已在 supersede 链） | 低 |
| N7 | 巩固优先级消费 | goal-active 期记忆优先巩固 + 写后 tag window 回溯提升（Wilhelm 2011；behavioral tagging） | 中 |
| N8 | 结构骨架一等记忆 | W3 升级：存关系骨架供跨域迁移（TEM；Yu 2021 因子化） | 低（W3 重定义后） |

- **D5 测量门与 N1 合跑**（实体层改变 PPR 基线，分开跑浪费基准）。
- **海马映射修正（2026-10-10 质询）**：turnCompress ≠ 海马（它做写时抽象+写时选择，恰是海马不做的两件事）；真对应物是 session transcript/t1（捕获属性对但不可检索进 harmonic 面）。详见 survey §2.4。后果：FTT verbatim 轨迹在检索空间不存在、选择错误不可恢复（t1_archive 死存储）——**D6 从"reflection 喂原文"升格为"verbatim 可检索层"设计**，且强化差距 #2（同基质重放）。
- **海马层重构调研完成（2026-10-10，`2026-10-10-hippocampal-layer-redesign-survey.md`）**：海马八职能七个机械（LLM 只属巩固层）；verbatim 层业界收敛 + 硬证据（MemGPT DMR 92.5% vs 32.1%、LongMemEval 键增广 +9.4%）；t1_archive 51616 回合只写不读。**分级选项 V1（verbatim 检索面+provenance 修复，2-3 天零新 LLM）/ V2（机械捕获+话题分段+turnCompress 读原文重定位，吸收 D6+N3+N7）/ V3（分系统通道+N1 实体层+index-scan 成本重构 83%）待用户决策**。前史：09-23 双系统 spec 的 C0 已实施（按需兑现）、C4 检索通道未落地。
- **CLS 快慢链路重新锚定（2026-10-10，`2026-10-10-cls-fast-slow-anchoring.md`）**：核心发现反转——最像脑的是 B1 交错回放+两相节奏（turnCompress 觉醒式/reflection 睡眠式），**最不像脑的是"皮层"本身：三条提交路径全部学习率 1.0**（MinHash 立即合并/laya 立即 UPDATE/reflection 单遍定稿，`ReflectCursor` 后永不重访），违反 CLS 小步长多暴露契约。V2 修订：延迟合并定案 + **新增宽限期重访**（reflection 次日新鲜上下文重访近 48-72h 自产 gist——生产界无人做多遍巩固，Reflexion/Self-Refine 证明 2-3 遍饱和收益）+ **reflection 交错**（B1 式跨会话 prior 注入蒸馏 pass）。
- **对齐确认**：soft-supersede（Lei 2024 加法式更新 × Graphiti/Mem0 业界转向）、离线双系统（Letta/Mem0/LightMem 跟进）、A2 草稿-验证（Davis & Gaskell 词学习 CLS 模型同构）——三条差异化资产获外部证据。
