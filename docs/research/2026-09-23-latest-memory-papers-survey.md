# 最新记忆系统论文调研 + MAFW 架构对照（2026-09-23）

> 方法：arXiv API `abs:"agent memory"`（403 条）与 `abs:"long-term memory" AND abs:"LLM"`（257 条）
> 按 submittedDate 倒序取前 30；筛出与 MAFW 谐波记忆系统相关的条目。
> 前序调研：`2026-08-26-memory-systems-pipeline-survey.md`（系统谱系）、
> `2026-09-01-long-term-memory-retrieval-survey.md`（检索优化）。本文聚焦 2026-08 末 ~ 2026-09 新批次。

---

## 1. 当前 MAFW 记忆系统架构（实测快照）

| 层 | 实现 | 实测状态 |
|---|---|---|
| 表示 | `HarmonicUnit`（primary_abstraction / cue_anchors / memory_value / energy / salience / pinned / sticky_until / superseded_by） | 索引 **v2**，3211 条（semantic 1815 / procedural 886 / episodic 504 / global 6） |
| 存储 | OKF markdown（frontmatter + body）分 tier 目录 + `.harmonic_index.json` + `gateway.db`（t1_observations / trajectory / anchor graph） | superseded 118，pinned 1，sticky 11 |
| 检索 | BM25 × energy × salience（默认）→ 可选 dense RRF(k=60) 融合 → **anchor graph 扩展**（maxHops 1 / maxNeighbors 3 / damping 0.6 / rerankGraphWeight 0.15）→ 显式时间锚定 ×1.5 | 1000 条 ~2-3ms |
| 写入 | MinHash 段级合并（阈值 0.7，char 3-gram）→ **ConsolidationService**（cosine 0.8 召回 + LLM 判 UPDATE/CREATE）→ soft-supersede | consolidation `judged=3 / creates=3`（修复后首次真正触发） |
| 衰减 | 0.005/天 增量衰减，salience 越高越慢；v1→v2 基线迁移（今日修复，迁移不再被覆盖） | last_decay 3172，新条目 created_at 已带 |
| 披露 | pinned → `<user-profile>`（每轮）；sticky → `<note-board>`（保质期） | 与 type 正交 |
| 向量 | local llamacpp cuda Qwen3-0.6B（1024d），按 provider.name 打标签 | vectors 5519，coverage 1.72 |
| 后台 | turnCompress（每小时）/ reflection / stale-verify（每周）/ memory:decay（03:30 UTC） | runtime=opencode（pi 可热切） |

**今日刚修的三处**（commit `7c250909`）：① 衰减冻结（动作操作活索引实例 + 补 `created_at`）；
② 判官空转（改走 runtime completion 通道）；③ 中文 cue_anchors 单字化 → CJK bigram + 存量回填 611 条。

---

## 2. 论文速览（2026-08 末 ~ 2026-09 批次）

### 2.1 记忆的「使用」与评测

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| MemCalib | 2609.24259 | 评测 LLM **是否恰当地使用**注入的记忆；前沿模型普遍 over/under-use；提出 MemCalib-RL 双向反事实信用分配 | 我们 L2 QA 66.7%，瓶颈可能不在检索而在"用"；可加记忆使用校准评测 |
| DolphinBench | 2609.24971 | 用**任务完成**而非 QA 评记忆，强制报告 cost+latency（3 persona × 500k tokens） | 与我们的成本意识一致（index-scan 曾占 83%） |
| Harness the Memory | 2608.15008 | 26 指标横评 memory substrate；**无单一 substrate 通吃**；过度检索反而伤害顺序决策 | 印证"按需检索"而非全量注入；substrate routing 思路 |
| MemGauge | 2608.30177 | 分阶段（写/管/读）utility-risk 权衡；写入门有阈值式风险跃迁 | 提示：写入准入是投毒风险的关键闸门 |

### 2.2 生命周期：合并 / 取代 / 矛盾 / 遗忘

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| **Revoked but Still Authoritative** | 2609.08258 | 五个 soft-revocation 记忆系统**默认都不在检索时执行撤销**：被撤销事实仍被返回、且排序压过替代项，导致 agent 执行不安全动作 | **直接命中我们的 `superseded_by`**：我们只 ×0.5 惩罚而非硬排除 → 强行动项 |
| MemoryLACE | 2609.03201 | 显式建模证据生命周期（sparse merge / supersession / **contradiction**）；比 Hindsight 快 66.6% | 我们有 supersede，无显式矛盾对；可加 contradiction 关系 |
| MemForest | 2609.08273 | 事件树分区 + 渐进合并；压 50% 保 97.1% 性能，检索 1.89× | 与我们 MinHash merge + 2000 字截断同问题域 |
| What Eviction Destroys | 2609.08279 | restore-counterfactual 审计驱逐：不可逆 vs 可恢复错误 | 我们不做驱逐（pruneRetainCount），可留观 |
| PolyMemDB | 2608.25577 | 多模态存储 + 时间衰减 + semiring 聚合解事实冲突 | 时间衰减 + 冲突解决的同向做法 |

### 2.3 检索与组织：cue / 图 / 视图 / 重建

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| **CueMem** | 2609.12354 | 记忆记录当**检索线索**而非自足证据：cue → 源 turn 锚点 → turn 图上重建证据 | **正中我们的 cue_anchors + anchor graph**：我们已 hop-1 扩展，可再加"回源 turn 重建" |
| **EdgeMem** | 2609.05553 | 免生成 LLM 构建：多锚点超图（内容/时间/情景），**保留原始 turn**；LoCoMo 61.01 领先 | 与我们"检索只看 abstraction+anchors、按需取全文"同构 |
| REALM | 2609.16053 | 检索驱动的**记忆再巩固**：异质认知图 + 自适应图搜索原子；LoCoMo 75.97 | 我们的 anchor graph 可向"再巩固"演进 |
| Agent Zero Memory | 2608.29606 | 三并行记忆（事件时间线 / 实体事件 KG / **citation-locked** 文档记忆）；LongMemEval 95.60 | 引用锁 + intent gate（自足轮零延迟）值得借鉴 |
| AutoViewMem | 2609.21940 | 写入时按"自配置正交视图"解耦异质信息，检索保持纯 top-K | 与我们 write-side 治理取向一致 |
| CreaMem | 2609.08550 | 场景感知分区 + 情景/特质双编码（EMNLP'26 Findings） | 多跳增益显著 |
| HERO | 2608.22310 | 人画像增强的异质记忆图，保留原始对话文本 | — |
| MACE | 2609.21533 | MemGoG 子图（support/conflict/repair）+ 记忆-智能体共演化（多智能体） | 多智能体场景，参考 |
| SELF-INDEX | 2609.19656 | 索引自演化（Optimizer 自诊断 + Query Simulator 主动探索） | 与我们 index-scan 的检索失败诊断相关 |
| WFM | 2609.18182 | Wiki Foundation Model：图 ↔ 稠密文档混合表示 | 工程重型，参考 |

### 2.4 参数化记忆（与我们非参数路线对照）

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| RPMem | 2609.23466 | session → 模型无关 latent memory → 回写 LoRA；跨 backbone 可迁移；PERMA 85.52 | 与"写入侧治理优先"取向相反，留观 |

### 2.5 安全 / 隐私 / 治理

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| PipePoison | 2609.00523 | 间接记忆投毒当作**端到端优化**问题（写→读→用三阶段耦合） | 我们的 `redactSecrets` 只覆盖密钥，未覆盖投毒 |
| When Errors Become Memories | 2608.30198 | 因果路径追踪：错误经"记忆更新通路"传播比"问题反馈"更持久；Memory Repair 消 70.2% | 印证"写入侧治理"优先级 |
| AIM | 2609.12320 | 私/公记忆 + 索引级访问控制 + MUMBench（首个多用户记忆基准） | 多用户场景参考 |
| SP-Mem | 2608.16551 | 隐私全生命周期（敏感值隔离 + 按需检索） | — |
| MutMem-V2 | 2609.01235 | 记忆变更的密码学授权与可验证证据 | — |
| Cairn | 2609.19502 | 社区声誉即集体记忆（时间衰减 Beta + 置信收缩） | 跨 agent 共享记忆参考 |
| Emergence World | 2609.17320 | 多智能体 16 天压力测试：投毒内容被写入持久记忆并**46 小时后仍被使用**；检测 ≠ 遏制 | 记忆投毒持久性实证 |

### 2.6 运维可靠性（**最贴近本项目**）

| 论文 | arXiv | 一句话 | 对 MAFW |
|---|---|---|---|
| **Memory as Infrastructure**（SIx Harness） | 2609.05510 | 单条 Claude Code 会话跑 633k 行代码库数月，其记忆子系统的**可靠性工程**：session-start 健康门、心跳遥测（**"没有任何枚举失败模式可以静默通过"**）、SRE 式告警疲劳预算；78,933 hook 调用 / 85 次失败 / 0 次静默 | **几乎就是本项目的镜像**。我们今天的衰减冻结与判官空转正是典型**静默失败**（日志只有 Scheduled、无执行）→ 强行动项 |

### 2.7 压缩与预算

| 论文 | arXiv | 一句话 |
|---|---|---|
| RSM-full | 2609.04915 | cosine-gated max-member merge + atom-aware packing；4k 预算下达 Full-Context 83% 质量、32% token |
| MEMO | 2609.07471 | 多模态证据记忆：文本/视觉/双通道载体 + 布局匹配 |
| ContextPilot | 2608.28476 | RL 训练 agent 主动管理上下文（规划/长期记忆/软卸载），EMNLP'26 |

---

## 3. 与 MAFW 的对照与行动项（按性价比排序）

1. **撤销硬执行（Revoked but Still Authoritative, 2609.08258）** — 我们把 superseded 仅做 ×0.5 排序惩罚；
   论文证明这在所有被测系统里都导致"撤销事实仍被返回并压过替代项"。建议：检索/披露层对
   `superseded_by` 条目**硬过滤**（或至少保证绝不排在替代项之前），与 pinned 的 superseded 失效逻辑统一。
2. **静默失败防线（Memory as Infrastructure, 2609.05510）** — 今日两处 bug 都是"动作存在、从未生效、无人知晓"。
   建议：给关键后台管线（decay / turnCompress / reflect / stale-verify / consolidation）加**心跳遥测 + 健康门**：
   记录 last-run / last-success / 处理条数，`GET /api/memory/stats` 暴露"距上次成功执行时长"，异常即告警。
3. **cue → 源 turn 重建（CueMem 2609.12354 / EdgeMem 2609.05553）** — 我们的 cue_anchors 已驱动 anchor graph hop-1；
   下一步可把锚点解析回**原始 session turn**（我们已有 `source_session_id` + trajectory），实现证据回源重建。
4. **矛盾对显式化（MemoryLACE 2609.03201）** — 现只有 supersede 链；可加 contradiction 关系（同名锚点 + 内容冲突）。
5. **记忆使用校准（MemCalib 2609.24259）** — 我们检索 R@5 已 0.87+，L2 仅 66.7%，缺口在"用"与"读"；可引入校准评测。
6. **投毒防线（PipePoison 2609.00523 / Emergence World 2609.17320）** — 现仅 `redactSecrets` 脱敏密钥，无投毒检测。

---

## 4. 参考（arXiv ID 速查）

2609.24971 DolphinBench · 2609.24259 MemCalib · 2609.23986 Jev-Mem · 2609.23466 RPMem ·
2609.21940 AutoViewMem · 2609.21533 MACE · 2609.19656 SELF-INDEX · 2609.19502 Cairn ·
2609.18182 WFM · 2609.17320 Emergence World · 2609.16053 REALM · 2609.12354 CueMem ·
2609.12320 AIM · 2609.11060 Env-Probing Curation · 2609.08550 CreaMem · 2609.08279 Eviction Audit ·
2609.08273 MemForest · 2609.08258 Revoked-but-Authoritative · 2609.07471 MEMO · 2609.05553 EdgeMem ·
2609.05510 Memory-as-Infrastructure · 2609.04915 RSM-full · 2609.03201 MemoryLACE · 2609.01818 Zeta-Lite ·
2609.01235 MutMem-V2 · 2609.00523 PipePoison · 2608.30198 Errors-as-Memories · 2608.30177 MemGauge ·
2608.29606 Agent Zero Memory · 2608.28476 ContextPilot · 2608.25577 PolyMemDB · 2608.22310 HERO ·
2608.18704 MemFuse · 2608.16551 SP-Mem · 2608.15193 Valhalla · 2608.15008 Harness the Memory
