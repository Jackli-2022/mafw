# 脑启发记忆研究刷新（2026-10-09）

> 目的：对照 `2026-10-08-brain-like-roadmap.md` 的已完成/未完成清单，扫描 2026 年 1-10 月 arXiv 新证据，识别 ①路线图方向的外部验证 ②我们未覆盖的新缺口。

## 1. 路线图方向的外部验证（别人也做了，且机制更细）

| 论文 | 对应我们 | 增量信息 |
|---|---|---|
| **EngramRAG** arXiv:2609.32049 | D5 PPR + D1 衰减 | CLS 框架下的完整方案：U-PPR（Hebbian 可塑性调制 PPR 转移概率，高频实体成 Epistemic Macro-Hub）；**CATD——按拓扑承重量缩放衰减半衰期而非墙钟近因**（我们衰减只看 salience，没看"被多少东西依赖"）；SUPERSEDES DAG 过滤（我们已有 soft-supersede 链）；三源 RRF（dense+BM25+U-PPR，我们 R2 已融合两源）。LoCoMo R@5 +38.9% vs dense |
| **REALM** arXiv:2609.16053 | D2 检索即重写 | 验证方向，但更进一步：**检索反馈驱动的不只是文本改写，是局部图结构重组**（reorganize related memory units into coherent local structures）。我们 D2 只改写文本 |
| **Auto-Dreamer** arXiv:2605.20616 | D4/D6 | CLS offline consolidator，用 GRPO 以端到端 agent 表现为奖励**训练**整合器；内存库小 12× 还更强。提示"整合器可学习"——我们 prompt 式 worker 是 zeroshot 版 |
| **DG-Mem** arXiv:2608.23268 | A4 选择压力 | 实例/schema 双层（CLS），**Shapley attribution 给每条规则算 utility 权重再喂检索**——比我们 A4 的 need 命中计数精细一档 |
| **MemSIF** arXiv:2608.01742 | A2 草稿-验证 | 明确命名 DUM（Delayed Utility Manifestation）：写时 salience 不预测查询效用 → ActiveFact 按需形成、**多源支持才提升**。直接佐证 A2 tentative（cap 0.35 + reflection 提升）设计 |
| **HiMem** arXiv:2601.06377 | D3 surprise | surprise 的另一个用法：**Topic-Aware Event–Surprise 双流分段**——surprise 不只当写入门，还当 episode 边界信号。我们 obs 切分目前按会话/小时，无 surprise 分段 |

## 2. 新缺口（路线图未覆盖）

| # | 缺口 | 来源 | 一句话 |
|---|---|---|---|
| **G1** | 权威/来源标签（authority preservation） | arXiv:2608.01679（AuthMem-Bench，49 配置中 48 个权威坍缩）、arXiv:2607.29167（PPMF） | 巩固时擦除来源约束（"用户说的" vs "我观察到的" vs "工具返回的"），存储条目获得超出其来源的权威 → 未授权行为率 50.3%。我们 redactSecrets 只脱敏密文，无权威维度。**落地形态：HarmonicUnit 加 source/authority 字段，写入时标注，消费时（尤其审批与 skill 物化）校验** |
| **G2** | 写相路由（cost-aware write gating） | arXiv:2608.22215（Dual-Layer：non-write/write-new/write-update 小大模型级联，剪掉 68% 冗余写入） | **直击我们成本黑洞**（index-scan 占 $377/87% 全是写入侧生成成本）：写入前先便宜判定"值不值得写/是更新还是新增"，比 laya 只判 update/create 多一个 non-write 出口 |
| **G3** | 语气保真（confidence preservation） | arXiv:2606.29279（Manufactured Confidence） | 巩固把对冲语气（"可能/据说"）升级为确信断言，下游照单全收；被动"unverified"标签被无视。**修复在写侧：保留 tentative 措辞不升级**；且**单条 load-bearing 记忆是危险源，一个冗余来源即修复**——佐证我们 tentative cap + 提示 consolidation prompt 加"保留原文证据等级"约束 |
| **G4** | 元认知检索仲裁（retrieve-when-needed） | arXiv:2610.05223（MARTA） | 与我们 FOK 门互补：FOK 判"记忆库里有没有"，MARTA 判"参数知识够不够、值不值得查"。L3 知识边界的另一半——**先自评内部不确定性再决定是否触发检索**，省检索成本也防"检索依赖症" |
| **G5** | 反思产物的安全面 | arXiv:2605.18930（OEP）、arXiv:2608.08795（SAVOR） | 反思会把局部正确经验过度泛化成高风险规则（攻击者可故意喂"干净但不可迁移"的经验）；**A1 公理蒸馏进 L5 是最高权威层，需 triage 人审门（已有人审）+ "过度泛化检测"提示** |

## 3. 远端方向的旁证

- **D6/D7/L4**：SEAA（arXiv:2609.17331）——自我-他人边界 + 行为惯性 HMM + 第一人称自我叙事实验涌现；CogniFold（arXiv:2605.13438）——CLS 三层加前额叶"意图层"（簇密度越阈 → 意图浮现，比 A1 阶梯补顶多一个"主动意图"概念）
- **权重内化（显式排除项）**：Dual-Layer（2608.22215）做了"选择性 SFT 内化"并有正收益，但需训练基建，维持排除
- **MMPO**（arXiv:2605.30159）：Belief Entropy 作记忆摘要质量的自监督信号——若未来要优化 turnCompress 摘要质量，这是测量面

## 4. 对统一路线图的修订建议

1. **G2 写相路由提到最高优先**——成本调研刚确认写入侧占 87% 成本，且是纯工程（小模型/规则前置判定），不依赖任何 spec-first 前置
2. **G1 权威标签进 A5 spec**（schema 写回时一并设计字段）
3. **G3 进 consolidation prompt**（一行约束，零架构改动）
4. **D5 spec 写时参考 EngramRAG 的 CATD**（拓扑承重衰减可并进 D1）
5. **G4 并入 L3**（FOK + 内部不确定性双门）
