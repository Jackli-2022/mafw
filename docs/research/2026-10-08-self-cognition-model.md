# 自我认知模型调研：从叙事自我到可操作的 self-model

> 日期：2026-10-08
> 前序：`2026-10-08-more-brain-like-memory.md` 的 D7（叙事自我）深化
> 触发：D7 日记只是"自传体记录"——数据不是模型。本调研回答：agent 的自我认知模型应该长什么样、业界怎么做的、MAFW 怎么落地

## 1. 问题定义：记录 ≠ 模型

叙事自我（每日日记）解决"我经历了什么"的**连续性**，但不回答"我是谁、我会什么、我什么时候会失败"。
自我认知模型（self-model）的判据：**一个结构化、活的、被决策层消费的关于自我的表示**——关键在"被消费"。只被阅读的是档案；能改变行为（预算分配、拒答阈值、策略选择）的才是模型。

## 2. 认知科学分层（设计依据）

| 理论 | 内容 | MAFW 对应 |
|---|---|---|
| Damasio 三层自我 | protoself（机体状态）→ core self（当下主体）→ autobiographical self（跨时间的连续我） | runtime 能力集 / 当前会话上下文 / harmonic memory + 日记 |
| Metzinger 自我模型论 | 自我不是实体，是一个"透明的模型"——系统用它行动但看不到它的构造过程 | 自我认知模型不需要"意识"，需要一个**被行动消费的结构化表示**；注入 prompt 即"透明" |
| Nelson & Narens 元认知 | monitoring（监测自己知道多少）→ control（据此调节行为）的闭环 | FOK 门（reranker 概率三区）是 monitoring 雏形；缺 control 回路 |
| McAdams 叙事身份 | 人通过叙事把碎片经历整合成连续的"我" | D7 日记是这一层的工程对应 |

结论：自我认知模型 = **monitoring 数据源 → 结构化自我表示 → control 消费点**的闭环。只有中间一层是档案；闭环才是模型。

## 3. 业界先例

| 工作 | 自我认知的切面 | 验证状态 |
|---|---|---|
| **Generative Agents**（Park et al.，arXiv:2304.03442） | observation → reflection（层级抽象成"我是谁/我在乎什么"）→ planning；消融证明 reflection 层对可信行为是必要的 | ✅ 已拉取验证 |
| **Voyager**（arXiv:2305.16291） | skill library = **程序性自我模型**："我会什么"以可执行代码形式持续累积，抗灾难性遗忘 | ✅ 已拉取验证 |
| Letta/MemGPT | core memory = persona + human 两个**自编辑**块：自我是 agent 自己维护的活文档，不是只读档案 | 知识库引用 |
| Reflexion（NeurIPS 2023） | 语言化自我反馈：失败后生成口头反思存入 episodic buffer，下轮直接改变行为 | 知识库引用 |
| Apollo situational awareness | 测量 LLM 是否知道自己处于测试/部署环境——自我定位能力的评测先例 | 知识库引用 |
| LLM calibration / FOK 文献 | 原生 LLM 校准差（不知道自己不知道）→ 外挂结构（我们的 FOK 门）是合理路线 | 知识库引用 |

## 4. MAFW 自我认知模型设计草案

四层结构化自我表示（新 scope，或 pinned 层的结构化扩展）：

### L1 能力账本（capabilities ledger）——"我擅长什么"
- **数据源现成**：`goal_outcomes` 表（verdict/failure_kind/轮数/成本）+ trajectory 成本 + thumbs 反馈
- 聚合为按任务类型的成功率画像："goal 编排类任务历史 PASS 率 X%、平均 N 轮"
- 纯 SQL 聚合，无 LLM 成本

### L2 失败模式谱（failure taxonomy）——"我反复踩什么坑"
- **数据源现成**：reflection 蒸馏出的 failure/correction 类 insight（316 条池子里已有）；goal_outcomes.failure_kind
- 聚合去重为签名化的失败模式清单（复用 MinHash 合并）

### L3 知识边界（knowledge boundary）——"我在哪些领域不可信"
- **数据源现成**：`fok-samples.jsonl` 的 top1prob × 主题区统计——持续低概率的主题区=弱区
- 消费：弱区自动降低 FOK 注入阈值（更谨慎地声明"无可靠记忆"）

### L4 自传体时间线（autobiographical timeline）——"我走到哪了"
- 即 D7 日记 + goal 里程碑 + manager 的 charter 决策索引

### 消费点（"模型"与"记录"的分界线）

| 消费点 | 行为改变 |
|---|---|
| goal plan 节点 | 查 L1 能力账本决定预算/maxLoops（"这类任务我历史上 3 轮才过 → 预算放宽"） |
| FOK 门 | 查 L3 知识边界分区调阈值（弱区更谨慎） |
| reflection prompt | 注入 L2 失败模式谱（"本期素材是否又犯了这些反复模式"） |
| D4b 做梦/反事实模拟 | L1+L2 作为风险清单的输入 |

## 5. 测量面

- **校准**：预测置信 vs 实际结果的 Brier score（goal verdict 是现成 ground truth）
- **重复失败率**：同一 failure signature 的复发间隔是否拉长
- **连续性**（叙事层）：定性 + 用户主观评分

## 6. 路线图位置

依赖关系：L4 需要 D7 日记（数据层）；D4b 是 L1+L2 的消费点；FOK/goal_outcomes 是 monitoring 数据源（都已存在）。
建议序：**L1 能力账本先行**（纯 SQL、goal_outcomes 已在写、立即可测）→ L2 失败模式谱（MinHash 基建现成）→ L3 知识边界（等 FOK 样本量，正好接便签板上的校准任务）→ L4 叙事层最后（是呈现层不是决策层）。

## 7. 迁移性

四层结构（能力/失败谱/边界/自传）与 MAFW 解耦后可直接迁移到用户的其他认知实验（数字果蝇、虚拟世界 agent）——self-model 是载体无关的表示层。
