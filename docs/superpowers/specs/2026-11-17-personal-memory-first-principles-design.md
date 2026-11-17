# 个人 Agent 记忆与学习系统：第一性原理重设计

> 日期：2026-11-17
> 状态：**设计草案，待用户批准；不是实施计划**
> 范围：T1 证据、长期事实/事情、经验学习、Skill 能力化，以及它们如何支撑个人 Agent。
> 前置：`docs/research/2026-11-17-memory-complexity-vs-hippocampus-cortex.md`、
> `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md`、
> `docs/superpowers/plans/2026-11-13-personal-agent-roadmap.md`。

## 1. 用户目标与已确认约束

用户要的不是更多摘要，而是一个能长期陪伴的个人 Agent：

1. 记下真实经历（T1）。
2. **可靠地记住事情**：用户事实、偏好、决定、项目状态、承诺和待办。
3. 从经历中总结经验，知道经验何时适用、何时失效。
4. 经验经过重复验证后可以生成 Skill。
5. 在未来相关情境中想起来、用得上，并根据结果继续学习。

用户已确认：**所有轮次都返回“当前主题 + 相关记忆”**；没有可靠相关记忆时明确标记“无相关记忆”，但不得注入弱联想、无关候选或额外说明来假装“记得”。

设计者的边界选择（不是用户逐项指定）：本设计只重做记忆与学习闭环，支撑但不重做个人 Agent 的执行器；Skill v1 只生成 playbook 草稿，安装、修改、激活和执行继续使用明确授权与现有人审/权限面。

## 2. 第一性原理：系统必须保存的不是“记忆”，而是四种不同东西

一个个人 Agent 要在未来正确行动，至少需要回答四个不同问题：

| 问题 | 必需信息 | 错误做法 |
|---|---|---|
| 当时到底发生了什么？ | **Evidence**：不可变证据 | 把摘要当原文 |
| 现在什么是真的、什么仍要做？ | **State**：当前事实与开放事项 | 把历史文本全部当现状 |
| 类似情况下什么做法有效？ | **Lesson**：带适用条件和结果的经验 | 从一次经历直接概括普遍规律 |
| 下次如何可靠地执行？ | **Capability**：版本化 Skill | 把高频文本改名成 Skill |

因此最小系统是：

```text
Memory & Learning = Evidence + Current State + Lessons + Capabilities
                    + Attention Policy + Update Protocol + Outcome Ledger
```

检索算法、向量、reflection、dream、energy 都不是必需品本体；它们只是可能服务于上述契约的实现。

### 2.1 三条不可违反的不变式

1. **证据不可变**：任何总结、重写、合并和遗忘都不能破坏 T1 原始证据。
2. **现状必须可更新**：记住“旧内容”不等于记住“现在有效的事实”；更新产生新版本并保留历史。
3. **能力必须由结果证明**：被检索、被阅读、被 LLM 自评重要，都不能证明经验或 Skill 有效。

## 3. 大脑侧：迁移功能约束，不复制生物部件

### 3.1 海马体：快速情景绑定与索引

迁移：便宜写入、高保真、what/when/where 的绑定、部分线索找到原始经历。

对应：**T1 Evidence Log + 可重建索引 + trace 指针**。
不对应：LLM 摘要、固定 12-anchor、任意 top-k。它们不构成模式分离或海马体本身。

### 3.2 新皮层：慢统计、图式与泛化

迁移：从多个独立经历中积累支持度、反例和关系，形成可复用结构，而不是反复生成相似文本。

对应：**Lesson 的跨 episode 统计、schema/关系支持度、反例与有效范围**。
不对应：Harmonic 里的离散文本天然就是皮层；离线运行也不自动等于慢学习。

### 3.3 前额叶与工作记忆：当前目标和有限注意力

迁移：当前任务只容纳很小的工作集；目标维持与干扰抑制比“召回更多”更重要。

对应：**Working Context / Attention Policy**。它是每轮临时计算出的视图，不是另一层永久记忆。
用户明确置顶、当前承诺和当前 goal 是必须考虑的事项；弱关联是首先被抑制的内容。

### 3.4 基底节与程序化学习：从重复行为到 Skill

迁移：技能形成依赖重复实践、结果反馈和情境触发，不是“想起次数足够多”。

对应：**Lesson → Skill Draft → 验证 → 激活 → 真实调用结果 → 暂停/退役**。
v1 不模拟神经机制，也不生成自修改可执行代码。

### 3.5 再巩固与遗忘

迁移：出现预测误差/新证据时才更新；更新保留旧痕迹；遗忘主要是可提取性下降。

对应：新版本 + soft supersede/retract；T1 原文不删；缓存可以冷，事实有效性不能由热度决定。

## 4. 计算机底层架构：日志、物化视图、缓存、能力包与控制面

### 4.1 与计算机架构的准确对应

| 计算机构件 | 本系统对应 | 设计约束 |
|---|---|---|
| Append-only journal / WAL | T1 Evidence | 永久 ID、幂等、不可变、可重放 |
| Transactional current state | MemoryRecord 当前有效版本 | 更新有版本、来源、有效时间和撤回 |
| Materialized view | 用户画像、当前项目、开放承诺、经验支持度 | 可从 Evidence + MemoryRecord 重建 |
| Cache / working set | 每轮 Working Context、快照、向量热索引 | 可淘汰、可失效；不是真相源 |
| Content-addressed package registry | Skill Registry | 版本、测试、来源、权限、回滚 |
| Scheduler / queue | 离线提取、重放、验证 | 事件优先、幂等、有预算、可暂停 |
| ACL / capability security | 个人 Agent 与 Skill 的执行授权 | service 不冒充 human；权限独立于记忆 |
| Telemetry / tracing | decision/candidate/exposure/outcome ledger | 用于归因，不把曝光当价值 |

**脑类比决定“为什么需要快慢学习”；计算机架构决定“怎样保证一致、可重建和可回退”。两者不能互相替代。**

### 4.2 逻辑数据模型

```text
Evidence (现有 T1)
- trace_id / session_id / turn_seq / event_at
- raw observations / source / project scope
- immutable

MemoryRecord（长期记忆真相源；初版复用 HarmonicUnit + 结构化 metadata）
- memory_id / kind: fact | preference | commitment | lesson
- subject / predicate / body
- scope: user | project | goal
- status: tentative | active | superseded | retracted
- valid_from / valid_to / last_confirmed_at
- authority / verification
- source_trace_ids / supersedes / distinct_from
- created_at / updated_at / schema_version

SkillVersion（独立能力注册表，不是 Harmonic 高级记忆）
- skill_id / version / status: draft | active | paused | retired
- triggers / negative_triggers / inputs / outputs
- playbook_ref / tests_ref / permissions
- source_memory_ids / source_trace_ids
- declared_success_check / created_at / activated_at

Outcome（结果证据）
- decision_id / goal_id / session_id / skill_id+version?
- exposure_ids / verifier / verdict / observed_at
- retry / correction / cost / censoring
```

`MemoryRecord` 与 `SkillVersion` 各自只有一个真相源；FTS、向量、快照和 UI 聚合均为派生视图，禁止双写后各自漂移。

### 4.3 为什么要区分 State 与 Cache

“当前喜欢 X”是状态；“这条记忆最近很热”是缓存/调度信息。
热度不得覆盖 `retracted`、`superseded`、低权限或低相关性。
一个单一 `energy` 不能同时承担真实性、重要性、相关性、可提取性和 Skill 效用。

至少保留五个正交量：

- `relevance`：与当前情境是否相关；
- `validity`：是否仍是当前有效版本；
- `authority/verification`：来源与验证程度；
- `importance`：用户明确重要性或未来遗漏成本；
- `activation`：仅用于缓存、预取和同分排序。

Skill 另有 `utility/outcome`，不回写为事实真实性。

## 5. 写入：三个入口，而不是多条自动文本生产线

### 5.1 原始经历：始终记录

```text
runtime event → redact → T1 append → permanent trace id → async index
```

同步路径不调用 LLM；索引失败不阻塞证据保存。

### 5.2 用户明确要求记住：立即成为用户事实

用户说“记住/以后都/别忘了”时，不应等待夜间 reflection：

1. 当前话语先进入 T1；
2. 创建 `MemoryRecord`，`authority=user`，保留原文；
3. 根据语义选择长期事实或带期限的提醒；
4. 立即返回 `memory_id` 与可撤回/修改入口；
5. 若当前 trace 尚未可用，标 `provenance=pending_capture`，后续按真实 ID 对账，不伪造精确链接。

用户明确指令比自动抽取的优先级高；agent 不得把用户事实降成普通工作笔记。

### 5.3 自动学习：事件驱动地产生候选

```text
episode closes / goal outcome arrives / explicit feedback
  → 读取相关 raw T1 + 当前相关 MemoryRecord
  → 提取事实候选或 Lesson 候选
  → reconcile（create / confirm / revise / retract / keep）
  → 保留精确来源与反例
```

- turnCompress 可保留为近期候选提取器，但必须读“事件码 + 有界原文”。
- reflection 收敛为跨 episode 学习器，不再负责所有维护。
- grace/reconsolidate/stale-verify 共用同一 reconcile 写回与 provenance 规则。
- dream 不属于本链路；如保留，只能是独立缓存预取器。
- 没有新证据时不重写，不因 cron 到点就必须产出。

## 6. 读取与“想起来”：先决定需要什么，再检索

### 6.1 主 Agent 用工具维护 Topic/Matter，系统每轮构造 Query Frame

不新增每轮后台 LLM Topic Updater。主 Agent 已经理解自然语言，在识别到新事情、话题继续/切换、状态变化时，主动调用工具维护当前 Topic State：

```text
mafw_topic_set
- topic?: string             // 设置或纠正当前主题；空/未设置不得伪造
- matterId?: string          // 可链接已有 Matter；省略时可创建新 Matter
- summary?: string
- entities?: string[]
- aliases?: string[]
- openLoops?: string[]
- retrievalKeys?: string[]
- active?: boolean           // false 表示关闭/退出当前主题
- expectedRevision?: number
```

同一工具用于首次设置、继续更新和主题纠偏。当前 T1 来源由 host/gateway 按真实 session/turn 附加，Agent 不猜 trace id。工具不直接改写长期事实；事实、经验和撤回仍走 MemoryWriter。

每次自动检索使用：

```text
current user input
+ latest committed Topic/Matter State
+ active project / goal / intent
+ known entities / time references
+ requested mode: remember | what-happened | solve-task | explicit-search
```

100ms 边界不调用 LLM。Agent 未调用维护工具时，T1 仍始终捕获，自动检索退化为当前输入 + 现有轻量上下文；不得因为 Topic State 缺失而生成无关联想。Topic/Matter 维护是质量增强，不是 raw 保存或自动检索的前提。

### 6.2 Attention Policy

每轮候选按以下顺序进入工作集：

1. **Must Surface**：用户明确 pinned、当前到期的承诺、当前 goal 的必要约束；
2. **Current State**：与当前 user/project/goal/entity 精确匹配的 active 事实；
3. **Capabilities**：触发条件与负向触发都匹配的 active Skill；
4. **Lessons**：适用条件匹配且有结果支持的经验；
5. **Evidence**：用户问“当时/上次/为什么”或当前知识不足时，返回 T1 指针/摘录。

任何候选必须通过：`active + scope allowed + relevant + within budget`。
检索相关性不能复活 superseded/retracted 内容；activation 只能做末级排序或缓存决策。

### 6.3 用户确认的逐轮召回格式：主题 + 相关记忆

所有轮次都产生同一个小结果，不再以“无可靠记忆”为理由追加弱关联内容：

```text
主题：<当前可靠主题>
相关记忆：
- <通过门控的记忆，带来源/版本>
```

没有相关记忆时：

```text
主题：<当前可靠主题>
相关记忆：无
```

尚未设置主题时，必须同时给 Agent 明确的修复动作：

```text
主题：未设置
相关记忆：无
Agent：理解当前对话后，使用 mafw_topic_set 设置主题
```

无法可靠识别但已有候选时不得把候选写成事实；可以返回 `主题：待确认` 和对应候选，供主 Agent 通过 `mafw_topic_set` 纠正或确认。

候选门控：

```text
relevant = active
           && scope_allowed
           && relevance passes the validated gate
           && (authority/source/verification meets the item kind's contract)
```

- 没有候选时仍返回主题和“相关记忆：无”；除此之外不注入任何记忆文本。
- 禁止用 cluster expansion、跨主题 PPR、无关 T1 或通用提示补位。
- 禁止附加“请自行验证”“以下是历史偏好”等与当前主题无关的固定尾注。
- 用户显式搜索时可以返回较宽候选，并清楚标注 tentative/unknown；显式搜索不等于自动注入。
- pinned/MustSurface 也必须是当前主题的合法相关项或明确的到期承诺；冲突和撤回仍生效。

### 6.4 个人 Agent 的五个稳定视图

| 视图 | 回答 |
|---|---|
| 关于我 | 长期事实、偏好、沟通与授权习惯 |
| 现在需要我 | 开放承诺、待办、human-blocking 事项 |
| 当时发生什么 | T1 evidence / episode 指针 |
| 以前学到什么 | Lessons、适用条件、反例与验证 |
| 我现在会做什么 | Active Skill 及版本、权限和结果 |

跨项目只引用项目状态，不复制项目记忆；个人 Agent 仍不能代替人类验收、审核、接受风险或合并。

### 6.5 Proactive system prompt：主 Agent 负责主题管理

系统提示需要把主题管理设为主 Agent 的常规职责，而不是依赖另一个后台 LLM：

```text
每轮读取召回块中的主题与相关记忆：
1. 若主题为“未设置”，在理解当前对话后调用 mafw_topic_set；不要为了调用工具而捏造主题。
2. 若当前用户意图与主题或相关记忆明显不一致，先按当前证据重新判断；需要时调用 mafw_topic_set 纠偏。
3. 若记忆与当前对话冲突，不直接覆盖或删除；先用 search/get_memory 核实，再走 clarify/supersede/retract。
4. 没有相关记忆时接受“相关记忆：无”，不得用无关内容补位。
5. 主题管理、事实记忆和 Skill 权限分开；设置主题不代表用户授权执行动作。
6. 工具调用失败不阻塞当前回答；T1 原始记录不受影响。
```

“看到记忆与现在不一致”只触发核实与调整，不授权 Agent 仅凭一句话改写所有相关历史。

## 7. 从经历到经验：Lesson 是带证据的可 falsifiable 命题

一条 Lesson 至少包含：

```text
context / trigger
action or interpretation
expected outcome
supporting trace ids + independent episode/session count
contradicting trace ids / failure conditions
validity / last_verified_at
confidence source (not LLM self-score)
```

规则：

1. 单次成功可形成 tentative Lesson，不能写成普遍原则。
2. 无矛盾重复主要增加支持统计，不制造同义新 unit。
3. 新证据与预测不符时进入 revise/retract，旧证据仍保留。
4. 只有独立 episode/session 才算新支持；同一会话反复复读不是多次证明。
5. LLM 可以提出 Lesson，但不能自己宣布它已验证。

## 8. 从经验到 Skill：能力化有独立门槛

### 8.1 候选条件

一个 Skill 候选必须由以下证据共同支持：

- 至少一个成熟 Lesson 或明确可重复的程序性模式；
- 在多个独立真实任务中出现相同情境；
- 有可验证的正向结果，并能描述失败条件；
- 不被现有 active Skill 覆盖；
- 能写出稳定触发、负向触发、输入输出和成功检查。

具体数量与效应门槛在实施前用现有数据做 observe-first 标定，不在本设计中拍定。

### 8.2 v1 产物

只生成自然语言 playbook 型 Skill Draft：

- 触发/负向触发；
- 输入/输出；
- 步骤与允许的判断分支；
- 工具与权限需求；
- 成功检查、失败处理、适用范围；
- 来源 Lesson/Memory/T1；
- 版本与测试。

草稿不自动激活，不自动生成可执行脚本，不自行扩大权限。激活需现有 triage/人审；运行结果必须带 `skill_id+version`。

### 8.3 退役与回退

- 失败、源 Lesson 被 retract、环境漂移或更优版本出现时暂停/退役；
- 已在运行会话中注入的指令不承诺即时撤回；下一发现/激活边界生效；
- 所有历史版本与来源保留；
- Skill 数量、安装数量、生成数量都不是成功指标。

## 9. 与现有系统的关系

### 保留并强化

- T1 raw/archive、永久 trace、FTS、按需回源；
- soft supersede、authority、用户 pinned/sticky 的显式语义；
- turnCompress 的近期处理角色和 reflection 的跨 episode 角色；
- Skill 的 staging/triage、版本与 deopt；
- 个人 Agent 的 service/human 权限边界。

### 收敛或改造

- Harmonic 从“各种文本的集合”改为 `MemoryRecord` 的承载实现；逻辑上区分事实、承诺、偏好、Lesson。
- route-write/consolidation 共用一个 reconcile 决策与日志。
- 多套再巩固/复查共享 provenance-preserving 写回。
- Skill 从 HarmonicUnit 内部的“高级记忆”方案收敛到独立 Capability Registry；旧方案仅作兼容读取。
- energy/activation 不再作为事实有效性与 Skill 毕业的通用代理。

### 移出本设计主链

- dream：可选缓存，不是学习机制；
- 无消费者的 novelty/mismatch/surprise 与 dense-shadow 全量计算；
- learned k-WTA/生成式皮层等新表示学习；
- 无可靠候选时的自动弱联想注入。

## 10. 兼容与迁移原则

1. 不删除旧 T1 或 Harmonic；先提供逻辑视图和只读适配。
2. 旧 unit 缺 subject/predicate 时可保留为 `legacy_knowledge`，不得伪造结构化事实。
3. 旧来源只有 session 级时继续标 coarse；不得计作精确 trace。
4. 已 retract/superseded 的旧事实不参与自动 recall。
5. 迁移期间每类数据只有一个写入真相源；不得长期双写文件与 SQL 后互相补洞。
6. 新能力先 shadow 记录“会注入什么”，通过评测后再改变自动上下文。

## 11. 验收：先证明“记得住”，再证明“学会了”

### A. 记住事情

- 用户显式要求记住的事实，在重启、换会话和改述查询后仍能准确找回。
- 新事实更新后不再把旧值当现状；撤回后相关记忆列表不再包含它。
- 每条自动注入都能回答来源、适用范围和为何此时出现。
- 每轮都有主题与相关记忆结果；无可靠记忆时明确为“相关记忆：无”，且没有任何弱联想补位。
- 未设置主题时明确显示“主题：未设置”与 `mafw_topic_set` 提示；主 Agent 能在后续工具调用中设置或纠正主题。
- 当前承诺能进入个人 Agent 的“现在需要我”，而不是埋在全局相似文本中。

### B. 学到经验

- Lesson 能列出支持、反例和独立 episode 数；同义重复不持续增殖。
- raw-only / MemoryRecord-only / both 的冻结对照能证明派生层在哪些任务族有独立价值。
- 内在 AUC 不替代任务结果；无结果时标 unknown/inconclusive。

### C. 形成 Skill

- 候选来自真实复用与验证，不来自检索热度或 LLM 自评。
- Skill Draft 的触发、负向触发、权限、成功检查和来源完整。
- 激活后在 held-out/真实任务中有可信调用与结果；失败可暂停并回到旧版本。
- Skill v1 不增加可执行权限，不代人类审批或验收。

### D. 工程不变量

- T1 raw 不变；100ms 边界不新增 LLM/训练/复杂图计算；失败 fail-open。
- 派生索引可重建；无可靠记忆时只返回主题与“相关记忆：无”；跨项目 scope 不泄漏。
- 每个自动部件都有独立关闭开关和“删除它哪个指标会变差”的回答。

## 12. 明确不做

- 不再以“更像大脑”为理由增加稀疏码、Hopfield、dream 巩固或更多 cron。
- 不让所有经历都生成长期文本；不把文本数量当学习。
- 不把检索次数、energy、FOK、LLM importance 当事实真实性或 Skill 价值。
- 不在热路径做 LLM 解析、自动反思、图扩散或训练。
- 不做自动安装/执行/自我修改的 Skill v1。
- 不把个人 Agent 做成第二套项目执行器。

## 13. 留给实施计划的决定

以下不妨碍设计评审，由 builder 在计划中按现有代码与基准决定：

- HarmonicUnit metadata 的具体字段落法与旧文件兼容；
- Query Frame 的轻量解析和 relevance gate 的标定；
- Working Context 的初始容量与各类别预算；
- Skill Registry 的物理目录/API 与现有 staging/triage 的映射；
- 离线任务的事件队列、cron 扫尾频率和预算；
- 迁移批次、测试文件与每阶段样本量。

本设计获批后才进入实施计划；任何代码修改、管线开关变化和数据迁移都需另行计划与验证。

## 14. 当前首刀的明确边界（builder check 后收敛）

首刀只做 Topic State 工具、recall 头部和 proactive prompt，不声称完成完整记忆重设计：

1. Topic State **按 session 隔离**；新会话默认“未设置”，不从旧会话继承；同一 session 在 gateway 重启后保留。
2. `active:false` 后对外仍为“未设置”；不引入自动过期，避免陈旧主题被无期限继承。
3. 主题管理提示只要求主 Agent 主动管理；子代理遵守现有限制，不调用 `mafw_topic_set`。per-session 存储保证即使误调也不会覆盖其他会话。
4. `mafw_topic_set` 只维护当前注意力状态；`mafw_mark_episode_boundary` 仍只标记 T1 证据边界。两者不自动互相调用。
5. `matterId` 首刀仅为可选不透明字符串；不创建 Matter 表、注册表或跨 session 生命周期。
6. 新头部加在现有 recall 本体上方；本刀不改 BM25/dense/FOK、快照、邻居和候选排序。**因此本刀不宣称完成“严格相关门控”**，旧候选质量的改造必须另立评测与实施切片。
7. 首刀 prompt 不提不存在的 retract/clarify 工具；仅引用 `mafw_topic_set` 与现有 search/get/add/supersede。事实撤回和语义 reconcile 另立后续切片。
8. canonical prompt 在 `packages/runtime-core/src/host-adapter.ts`，`src/hooks/memory-guide.ts` 仅作 gateway-unreachable fallback；两处同步修改。
9. 100ms 边界不新增 LLM；topic 读写只使用 session key 与现有 SQLite kv store。
