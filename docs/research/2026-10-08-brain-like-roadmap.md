# 脑启发记忆演化路线图（整合版）

> 日期：2026-10-08
> 本文是整合层：差距 → 7 个脑化方向 → 自我认知模型 → 统一依赖图与路线图。
> 细节附录：`2026-10-08-more-brain-like-memory.md`（7 方向全量论证）、`2026-10-08-self-cognition-model.md`（自我认知模型全量论证）。

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
| 1 | D1b 源条目降能（gist 化后 supersede 源 episodes） | D1 分档衰减已在跑，只剩这一步 |
| 2 | D3 surprise 门控 | consolidation 余弦本来就在算 |
| 3 | L1 能力账本 | 纯 SQL，goal_outcomes 在写，Brier 可测 |
| 4 | D4a 做梦预取 | R8 快照管线现成 |
| 5 | L2 失败模式谱 | MinHash 现成；**前置缺口：reflection 不落 category** |
| 6 | D2 检索即重写 | reconsolidation 窗口已有（S5），缺消费 worker |
| 7 | D4b 反事实模拟 | 依赖 L1+L2；plan 节点已接线（v4.22.0） |
| 8 | L3 知识边界 | 缺口：FOK 样本无主题字段 + 样本量（接便签板校准任务） |
| 9 | D5 PPR 检索 | 需建图，LongMemEval 可测 |
| 10 | D6/D7+L4 | 体验层，远端 |

> 实施核查（2026-10-08）发现 D1 分档衰减已在生产运行（`automation-engine.ts:102` 调 `decayRateFor(entry.type)`），原"纯参数"判断过时；reconsolidation 窗口（`recall/reconsolidation.ts`）也已在反馈路径接线，D2 只缺冲突触发的消费 worker。

## 6. 显式排除

- LoRA 权重级巩固（无训练基建 + 灾难性遗忘）——远期愿景
- 情绪模拟（无测量面）
