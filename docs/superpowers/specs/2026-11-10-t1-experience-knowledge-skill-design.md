# T1 情景记忆、派生知识与 Skill 能力化设计

> 日期：2026-11-10
> 状态：整体方向已获用户认可；本文记录后续方向，**不代表已批准开始实施**。
> 前置阅读：`docs/research/2026-10-10-memory-architecture-brain-survey.md`、
> `2026-10-10-hippocampal-layer-redesign-survey.md`、
> `2026-10-10-cls-fast-slow-anchoring.md`、
> `docs/superpowers/plans/2026-10-11-v1-verbatim-dense-layer.md`。

## 1. 意图

当前系统已经能捕获 T1、归档原文、生成 Harmonic 抽象记忆，并有一版 T1 dense
快照召回和 procedural memory → SKILL.md 的人审物化通道。但仍存在四个结构性问题：

1. T1 的检索、回源和强化没有形成闭环；抽象记忆被使用时，源 T1 不会被精确再激活。
2. T1 的 `(session_id, turn_id)` 身份会在归档后重用，无法安全承载精确 provenance。
3. T1/T2/T3/T4/L5 的编号把存储、知识类型、成熟度和展示方式混成了一条层级阶梯。
4. 现有 W2 是文本物化；真正的 skill 还需要触发、输入输出、验证、权限、版本和 deopt。

用户确认的两个并列目标：

- **能重新想起当时的原文**；
- **通过原文重放，让抽象结论越来越可靠**。

## 2. 已核实的现状

以下数字是 2026-11-10 的本机只读快照，用于说明问题规模，不作为长期不变的事实：

- `t1_archive`：67,813 行 / 3,546 个回合键 / 1,391 个会话。
- 当前 T1 向量：24,702 条；`vectors-t1-*.json` 约 512 MiB。
- 849 份现存召回快照中，775 份在生成时含 T1 命中。该数字不证明这些命中后来被使用。
- Harmonic 索引 11,017 条中 10,539 条有 `source_session_id`，没有 turn 级来源字段。

代码事实：

- `routes/obs.ts` 写 T1、计算 `obsSalience` 并 fire-and-forget 嵌入原文。
- `recall/verbatim-recall.ts` + `recall/snapshot-builder.ts` 已支持快照内 T1 dense 命中。
- 快照在 Harmonic 零命中时提前返回，T1 不能独立救援；快照 serve 只记录 `snap.ids` 的
  Harmonic 检索事件。
- `mcp/handlers/search-hybrid.ts` 只搜索 Harmonic；agent 没有显式 T1 搜索入口。
- `mcp/handlers/get-memory.ts` 的 C0 回源按 `source_session_id + cue_anchors` 在归档中
  猜相关证据；T1 指针只回源归档，不回读活跃观察。
- `t1_archive` 不保留 `salience`；归档搬运会改变行 ID。
- ACT-R 只结算 Harmonic energy；T1 没有 activation、检索计数或重放状态。
- W2 `memory/skill-promotion.ts` 已提供 need/energy/一致映射/verified/稳定性/数量/权威
  闸门、staging 与人审；`renderSkillMd()` 目前主要把 `memory_value` 渲染成 SKILL.md。

### 2.1 已复现的身份缺陷

`GatewayDatabase.nextTurnId()/currentTurnId()` 只读取 `t1_observations`。当
`archiveTurn()` 清空活跃行后，同一会话的下一回合会重新从 1 编号。

最小复现：第一回合 `turn_id=1` → 归档 → 下一回合仍为 `turn_id=1`。

生产归档中有 480 个 `(session_id, turn_id)` 含多条 `user_input`，活跃/归档同键重叠
774 行。这证明不能直接在现有键上建立精确 source-turn 强化。

## 3. 目标、非目标与反目标

### 目标

- 每段经历具有永久、唯一的 `trace_id`；归档不改变身份，回合序号不复用。
- 原文不可变，初始 salience 和来源元数据在归档后保留。
- T1 与 Harmonic 可以独立召回、按需融合；Harmonic 零命中不阻止 T1 救援。
- agent 可主动搜索 T1，并可用同一指针机制读取活跃或归档原文。
- 抽象记忆与源 T1 之间有精确、多对多、可验证的 provenance。
- 检索/兑换/验证形成分级事件；T1 activation 有界强化并实际影响排序或重放。
- 离线巩固能重读原始证据，以新旧交错和多遍处理提高抽象可靠性。
- 概念上收敛为 Experience / Knowledge 两类记忆，skill 归入独立能力系统。
- 索引可重建、可淘汰，原文默认保留；控制向量内存、文件大小与写放大。

### 非目标

- 不复制 runtime 的完整会话 transcript；T1 仍是 gateway 的脱敏观察证据层。
- 不在 obs 捕获或 100ms 边界 recall 热路径新增 LLM。
- 不把向量搜索当作神经元级模拟；脑对应只用于功能契约。
- 不让 activation 代表真实性、权威性或当前有效性。
- 不在第一版自动生成带可执行脚本或写操作的 skill。
- 不因向量淘汰而删除原文，不因检索失败而判定原文不存在。

### 反目标

- 仅给 T1 加一个 energy 字段，却不让任何检索或巩固消费者使用它。
- 通过 cue-anchor LIKE 猜测精确来源，再把猜测当成事实强化。
- 高频检索但未真实执行成功的记忆直接变成自动能力。
- 原文随强化被改写，或旧版本被物理覆盖。
- 为追求脑相似而增加更多数字层级。

## 4. 概念架构：两类记忆，不是一条层级阶梯

```text
Experience｜情景记忆：当时发生了什么
- raw：T1 不可变原文
- summary：可选的 episodic 精选摘要（物理上仍可存放在 Harmonic）

Knowledge｜派生知识：从中学会了什么
- semantic：事实、偏好、决定
- procedural：方法、教训、流程
- axiom/global：经反复验证后更稳定的原则

Capability｜独立能力系统：下次如何可靠地做
- skill / tool / agent；不是第三种记忆层级
```

兼容映射：T1→Experience.raw；episodic→Experience.summary；semantic/procedural→Knowledge；
L5/global→Knowledge.axiom。`abstraction_level` 可暂时作为衰减等现有逻辑的内部派生值，
不再作为对外架构分类。L3 参数化约束归入控制/工作上下文，不单列长期记忆层级。

 pinned、sticky、agent-priors、goal snapshot、自动 recall 是**披露/注意力策略**；
 dense、BM25、FTS、图索引是**查找机制**；tentative、验证、毕业是**成熟度状态**；
 skill 物化是**能力外化**。它们都不是额外记忆层级。

## 5. 数据与存储契约

### 5.1 原始事实与身份

推荐逻辑模型：

```text
T1Turn
- trace_id              永久 UUID/ULID
- session_id / project  来源范围
- turn_seq              持久、单调、不复用
- event_at / captured_at
- encoding_salience
- archived_at

T1Observation
- observation_id        永久行身份
- trace_id
- source / content / failure / created_at
```

设计选择（由设计者拍板，非用户逐项指定）：优先评估「单表 + `archived_at`」，避免搬行和
双表指针分叉。若实施评审认为迁移风险过高，可暂留双表，但必须保持同样的永久身份、
序号和元数据不变量；这不是放松身份要求的理由。

`turn_seq` 由独立持久序列/回合记录分配，不能从活跃表当前最大值推导。归档不修改
`trace_id`、`observation_id`、原文或编码时 salience。

### 5.2 派生索引

T1 dense + 词面索引是真相源之外的可重建数据：

- 向量从全量 JSON 数字数组迁移到按行更新的二进制存储（优先 SQLite BLOB；是否使用
  sqlite-vec 由实施前 benchmark 决定）。
- 保留 model/dims/content-hash 元数据；模型变化时可整段重建。
- 增加 FTS5 或现有 BM25 的词面通道，覆盖函数名、路径、错误码、配置键、数字和精确串。
- 新写入失败由自动回填补齐；心跳暴露 T1 覆盖率、缺失数与失败原因。

### 5.3 溯源与动态状态

```text
T1Provenance
- memory_id / trace_id
- relation / weight
- created_at

T1TraceState
- trace_id
- activation / retrieval_count
- last_retrieved_at / last_replayed_at
```

原文、provenance、activation、向量分别存储。强化只修改状态，不修改原文，不提升
authority，不直接修改 verification。

## 6. 读取路径

### 6.1 独立双路召回

- T1 与 Harmonic 各自独立检索；禁止因 Harmonic 零命中而跳过 T1。
- `mafw_search_hybrid` 增加明确的 layer/scope 选择（Harmonic / T1 / both），返回 T1
  指针和证据摘要；具体参数名由实现计划按现有工具契约决定。为保持旧调用方的结果形状、
  延迟与曝光稳定，省略该参数时先维持 Harmonic-only；T1/both 在评测期显式 opt-in，
  自动快照则始终独立尝试两路。是否未来更改默认由 A/B 结果决定。
- 融合先保证查询相关性，再以有界 activation 调整排序；高热度不得救回不相关内容。
- FOK 最终考虑两路证据，不能只根据 gist 置信度宣称整体无记忆。
- 自动 recall 仍只注入少量指针/摘录；完整原文按需兑换。
- T1 指针对活跃与归档数据都可用，并处理短 session 尾码歧义，不拼接多个会话结果。

### 6.2 检索事件与强化

区分信号：

1. 候选展示/自动注入：弱曝光；
2. agent 兑换并阅读原文：更强的实际使用；
3. 环境验证或目标结果：独立可靠性/奖赏证据，不与曝光混为一谈。

抽象记忆被 recall/search 时，沿**精确 provenance** 向源 T1 加权传播；没有精确链接的
legacy 记忆不伪造传播目标。直接 T1 命中记录到该 `trace_id`。

每日复用 ACT-R 式有界强化和曝光折扣，并执行 T1 自身衰减。activation 必须至少消费于
检索排序、热索引驻留或原文重放之一，否则只记录观察、不宣称已强化。

## 7. 写入与巩固路径

```text
新 T1 + 被再激活的旧 T1 + 相关旧 Knowledge
  → turnCompress / reflection
  → 新旧交错、多遍、小步处理
  → 确认 / 强化 / 修订 / 新抽象
  → 写回 Knowledge + 精确 provenance
```

- turnCompress 从唯一准入者改为快速巩固者；未提取不等于不可检索。
- **精确 provenance 由 worker 显式指认**：输入批次中的回合带 `trace_id` 标记，写入工具
  接受 `sourceTraceIds`，gateway 校验它们确属当前批次。不得把整批回合默认继承为证据。
  未提供有效来源的写法仍允许落库（保持管线 fail-open），但标记为 session 级/无精确来源，
  不参与精确 T1 强化传播；覆盖率目标只统计显式且通过校验的链接。
- reflection 能按 provenance/activation 重读原始 T1，避免只复读二手摘要。
- 无矛盾的重复以强化为主；出现新证据/预测误差才进入再巩固。
- Knowledge 更新继续采用 additive 新版本 + soft supersede；T1 原文不合并、不覆盖。
- D1b 对 Harmonic 源 episode 的降能不等于删除或降低原始 T1 的可回读性。
- 现有 pinned/sticky、goal reward、FOK、stale-verify、skill/axiom 管线继续复用。

## 8. Memory → Skill：能力化而非文本改名

### 8.1 不同记忆的角色

- T1/episodic：成功、失败和环境证据；
- semantic：参数、约束和适用范围；
- procedural：步骤草案；
- axiom/global：不可违反的边界。

Skill 是这些证据共同支撑的行动程序，不是一条高频记忆的别名。

### 8.2 能力化管线

```text
Experience / Knowledge
  → 候选发现
  → Skill Draft（能力契约）
  → 测试 / 验证 / 人审
  → Capability Registry
  → 调用产生新 T1
  → 保留 / 新版本 / 暂停 / deopt
```

候选发现以真实复用和执行结果为主，检索热度只作辅助。应观察同类任务执行次数、成功
次数、上下文覆盖、失败签名和现有 skill 覆盖；具体阈值先 observe-first，不在本文硬编码。

Skill 草稿必须包含：触发与负向触发、输入输出、稳定步骤或明确决策分支、工具与权限、
成功判据、失败处理、适用范围、source_memory_ids/source_trace_ids、版本与状态。
稳定且明确的分支可以被固化；要限制的是含糊的临场判断，不是机械统计「如果」数量。

第一版只支持自然语言 playbook 型 SKILL.md，保持 staging + triage 人审。可执行脚本、
写操作和自动执行型 skill 是后续独立设计，需要更强测试、权限与回退门。

安装后 skill 进入能力注册表，不成为高级 HarmonicUnit。源经历和证据保留；检索展示时
可折叠重复步骤，但不通过改 energy 实现去重。

skill 调用产生新的 T1，经离线巩固反哺知识。重复失败、环境漂移、源知识 supersede 或
更优替代出现时，暂停当前能力版本或 deopt；原文、源记忆和历史版本保留。

**调用与成功的权威信号**：只有 runtime/host 记录的 skill 激活事件或带 skill id/version 的
显式调用才算一次调用；出现在候选目录、被搜索到或被读取 SKILL.md 都不算。runtime 没有
可信事件时记为 unknown，不从文本相似度猜调用。成功只由预先声明的机械检查、关联 Goal
的真实 verdict 或人类验收确认；agent 自我报告和「已加载」均不算成功，缺证据时结果未知。

**v1 权限与 deopt 边界**：playbook 不新增可执行脚本权限；停用/版本切换在 skill 下一次
发现或激活边界生效。已经注入运行中会话的指令无法从模型上下文中撤回，v1 不承诺即时
撤销；需要该能力的可执行 skill 留待后续独立设计。

脑对应是「反复实践驱动的 proceduralization」，不是「被想起次数足够多就自动化」。

## 9. 正交信号

| 信号 | 语义 |
|---|---|
| 查询相关性 | 与当前问题有多相关 |
| salience | 发生时有多重要 |
| activation / energy | 当前有多容易被想起 |
| authority | 最初来源是谁 |
| verification | 当前是否经过验证、是否仍可信 |
| skill 执行统计 | 一个行动程序是否有效，不是记忆真实性 |

经常想起不等于正确，重要不等于相关，原文存在不等于事实仍有效。

## 10. 生命周期

- 相关性不足：本次不展示。
- 长期未使用：activation 下降。
- 资源压力：从热向量索引淘汰。
- 知识过期：新 Knowledge supersede 旧 Knowledge。
- 原始 T1：默认保留，可按永久 ID 回读、重建索引或重新巩固。

显式隐私删除若未来加入，应是独立、可审计的例外流程，不与自然遗忘混用。

## 11. 存量迁移与兼容

1. 先阻止新数据重号，再启用任何 source-turn 强化。
2. 已有重号 `(session_id, turn_id)` 不得直接加唯一约束或强行指定唯一来源。
3. 旧数据保留原始行；无法确定回合边界的标记 `legacy_ambiguous`。若按行序/时间做近似
   拆分，必须始终标记为近似，不升级为精确 provenance。
4. 旧 Harmonic 的 session 级来源可继续支持 C0 粗回源，但不参与精确 T1 强化传播。
5. 向量与词面索引可从原文重建；迁移失败不影响原文读取。
6. 现有 `abstraction_level`、OKF、工具输出和快照字段需要兼容层；对外架构文档不再使用
   数字阶梯表达职责。

## 12. 后续实施顺序（仅方向，不是执行计划）

1. **身份正确性**：永久 ID、持久序号、归档元数据、历史重号策略与回归测试。
2. **独立可读性**：T1 主动搜索、T1-only 救援、活跃/归档指针、词面通道、覆盖观测。
3. **索引资源**：二进制向量、增量写入、自动回填与资源基准。
4. **精确 provenance + activation**：先观测事件，再开有界传播与排序/驻留消费。
5. **原文重放**：turnCompress/reflection 新旧交错、多遍巩固与再巩固门控。
6. **Skill v1**：playbook 能力契约、真实复用证据、验证、人审、版本和 deopt。

每一步独立可回退；不要在身份未修前提前启用第 4 步。

## 13. 验收与测量

- 归档/重启后 `turn_seq` 不复用，`trace_id`/`observation_id` 不变，salience 不丢。
- Harmonic 零命中时仍能通过 T1 回答可证据化的问题；T1-only rescue 有单独指标。
- T1 指针可精确兑换活跃/归档回合，短码歧义不会混会话。
- provenance 覆盖率与抽样精确率；legacy 近似来源不得计入精确覆盖。
- raw-only / gist-only / 双路融合在冻结 LongMemEval 样本上对照，关注检索与最终回答两层。
- 强化后检索改善与错误/过期内容被强化的比例同时报告。
- T1 向量覆盖率、内存、磁盘、flush 写放大、快照延迟与 100ms 边界回归。
- 原文重放前后，抽象结论的来源覆盖率、环境验证通过与过期知识复发率。
- Skill v1 的触发准确率、held-out 任务成功率、可信调用/成功信号覆盖率、失败后的 deopt；
  v1 不新增脚本执行权限，停用须在下一次发现/激活时生效；不只统计安装数。

## 14. 明确留到后续的方向

- 可执行脚本/写操作/自动执行型 skill 的安全与测试契约。
- 向量量化、ANN/sqlite-vec 或独立索引服务（仅在基准证明需要时）。
- 更完整的双时间查询、实体概念层与结构契合判定。
- 检索失真、竞争者抑制及更完整的再巩固校准。
- 用户显式隐私删除与跨项目共享策略。
