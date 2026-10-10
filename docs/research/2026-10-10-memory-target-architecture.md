# MAFW 记忆系统目标架构（2026-10-10 定稿）

> 本文是本轮调研弧（brain survey → 海马层 → CLS 锚定 → 粒度/边界 → 慢路内部 → LLM 边界/权重 → dense 定案）的**收敛总图**，后续实施 spec 以本文为唯一架构引用。
> 依据文档：`2026-10-10-memory-architecture-brain-survey.md`（映射总表）、`2026-10-10-hippocampal-layer-redesign-survey.md`（H 层+粒度+边界+dense 定案）、`2026-10-10-cls-fast-slow-anchoring.md`（CLS 契约+慢路内部+LLM 边界+权重清单）、`2026-10-08-brain-like-roadmap.md` §7（N 系列+V1-V3）。

## 0. 八条设计原则（全部有脑侧+业界双依据）

1. **捕获机械、巩固语义**——海马八职能七个机械，LLM 唯一席位在巩固层（成本差 2-3 个数量级）。
2. **verbatim 永远可检索**——选择错误软失败；FTT 双轨迹（脑可早期回忆原文、晚期只剩 gist）。
3. **慢学习 = 文本重写 + 元数据动力学，不是模型微调**——"皮层"是文本库不是模型（roadmap 显式排除 LoRA）。
4. **不首次全额提交**——延迟合并 + 宽限期重访（CLS 小步长契约；LightMem +15pt；脑每记忆十到百次前载重放）。
5. **交错强制令**——B1 模式（need×gain 采样、新旧同批）扩展到全部巩固 pass（McClelland：顺序块即使慢速也干扰）。
6. **demote-not-delete 终态**——supersede 链 / D1b 降能 / archive 保留 = 静默而非删除。
7. **边界内容定，切分器=索引器**——TCM 漂移切事件段，封存的 TCM 向量即段检索键。
8. **标签在写时打、巩固时消费**——novelty/need/salience 机械标量（神经调质语义）作巩固排序输入。

## 1. 总图：四层 + 判定层

```
┌────────────────────────────────────────────────────────────────────┐
│ 判定层（judge，无存储，全部冻结/规则）                                │
│  机械标量: salience / novelty(1−maxCos) / need / energy   ←神经调质   │
│  laya: pair 判定（冲突/冗余/分离）            ←CA3比较器+纹状体        │
│  reranker: FOK 概率 + R3 精排                ←前额叶元认知监测         │
│  LLM 升级: 不确定带的 teacher（laya 永不做不确定区终审）                │
│  学习回路: 影子日志(laya判定vs teacher分歧) → 睡眠压力 → 批微调(远期)   │
└────────────────────────────────────────────────────────────────────┘
      ▲                                     ▲
┌─────┴─────────────┐            ┌──────────┴─────────────────────────┐
│ H 层（海马，新建）   │            │ 存储层（"皮层"，已有+扩展）           │
│ verbatim 可检索     │──巩固写入──▶│ harmonic 文本库                     │
│ t1_obs→t1_archive  │            │  semantic / procedural / global     │
│ 零 LLM 机械捕获:    │◀─B1交错回放─│  + anchor 图（Hebbian need 边权）    │
│  嵌入(定案:dense检索)│            │ 权重=文本条目/energy/边权/锚点/向量   │
│  +实体收割(V2)      │            │ 模型全冻结: embedding/laya/reranker │
│  +novelty+机械sal. │            │                                     │
│  +MinHash标记不合并 │            │                                     │
│  +TCM边界→事件段    │            │                                     │
└────────────────────┘            └────────────────────────────────────┘
      ▲ raw 供读（链式子序列，按事件段）         ▲
┌─────┴───────────────────────────────────────┴─────────────────────┐
│ F 层（快巩固 = turnCompress 重定位）      │ S 层（深巩固 = reflection 扩展）│
│ 事件驱动（话题边界/容量，替代小时批）       │ 每日 3:00                      │
│ 读: 事件段原文 + B1 交错 + S2 schema 簇   │ 读: 新 episodic + 近48-72h 自产 │
│ 写: semantic 候选 + tentative(0.35)      │     gist（宽限期重访）+ 交错prior│
│ 选择软化: 不写≠丢失（raw 永在）            │ 写: gist+distilled_by+D1b 降能  │
│                                          │     +A2 promote/reject+A4 回流 │
└──────────────────────────────────────────────────────────────────┘
     两层都是 LLM。周管线: axiom-distill（need 二遍）/ skill-promotion
     （W2 = goal-directed→habitual + task-bracketing，SKILL.md=情境触发宏）

【持续动力学·机械无LLM】每日: decay(分型率+CATD) + ACT-R drain + reconsolidate(PE门)
                        周日: stale-verify(只读环境探测)
```

**粒度谱系**（海马多尺度对应）：观察行=绑定单元(~125ms 合取) → round=engram → **事件段=situation model**（TCM 漂移切界，Tier0 结构信号: 文件/goal/工具失败/会话）→ 会话=episode envelope → project/goal=人生时期。

## 2. 三条数据流

### ① 写路径（在线，机械，零 LLM）
```
插件 hooks → /api/obs/capture（脱敏）→ t1_observations
每轮: 嵌入(fire-and-forget→dense 检索面) + novelty + 机械 salience
      TCM 运行向量 → 余弦跌破阈=事件边界 → 段分组（段键=封存 TCM 向量）
MinHash 标记不合并（判定迁巩固层——修假合并+保学习标签）
完成轮 → t1_archive（verbatim，51k 轮已在，V1 回填嵌入）
```

### ② 巩固路径（离线，LLM+laya，批处理）
```
F 层: 读事件段原文+B1 交错+S2 簇 → 写闸门（权威→G2 沉底→laya 三值）
S 层: 读新 episodic+宽限期 gist+交错 prior → 蒸馏/A2/A4/D1b/A5
周管线: axiom（need 触发）/ skill（五闸门→SKILL.md）
学习回路: 影子日志 → 分歧率（睡眠压力）→ 批微调（门槛: 校准现已达标 235 对）
```

### ③ 读路径（在线，100ms 契约）
```
每轮 LLM 前 → /api/recall/context
  R8 快照命中(TTL+包含度) → serve | miss → 实时 BM25（harmonic，现状不动）
  快照构建（后台 2s 防抖，无延迟约束）: H 层 dense NN + harmonic BM25/dense
    + PPR → RRF 融合 → reranker → FOK 三区门 + G4 arbiter(annotate-only)
  注入: <recall> 指针（可含 #t1-xxx）+ ↳gist/邻居 + note-board
        + user-profile + agent-priors + goal-snapshot
  检索出口 → RetrievalEventBuffer → 每日 ACT-R 结算
```

## 3. 边界定案（LLM / 权重 / 检索）

| 边界 | 定案 |
|---|---|
| LLM | H 层零 LLM；F/S 巩固层唯一语义席位；判定层 laya/reranker 冻结 + LLM 升级 |
| 权重 | 更新对象=文本条目(LLM)/energy·salience(机械)/anchor 边权(Hebbian)/cue_anchors/向量(重写重嵌)；模型全冻结；laya 慢通道=影子日志→批微调（设计好、等标签触发） |
| H 层检索 | **dense 直接上（2026-10-10 用户定案）**：进场点=快照路径（无 100ms 约束）；边界实时路径维持 BM25-only 不动；显式记债 V1 盲区=标识符/精确串（V2 GLiNER+regex 键增广补；C0 SQL LIKE 兜底） |

## 4. 实施相位

| 相位 | 内容 | 规模 | 状态 |
|---|---|---|---|
| **V1** | ① t1 嵌入（fire-and-forget + 51k 回填）② t1 向量命名空间 ③ H dense NN 进 R8 快照融合 + `<recall>` #t1 指针 ④ provenance 修复（worker source 指回源会话）⑤ 边界路径不动 | 2-3 天，零新 LLM | **定案待实施** |
| **V2** | ① 机械捕获升级（GLiNER 实体收割 + novelty 接线 + MinHash 标记化）② TCM 话题分段替换小时批（吸收 N3）③ F 层读事件段原文重定位（吸收 D6）④ 宽限期重访 48-72h ⑤ reflection 交错注入 ⑥ 机械 salience observe-first | 1-2 周 | 设计定案 |
| **V3** | ① 分系统检索通道（09-23 C4）② N1 实体概念层（identity 判合并）③ index-scan LLM 裁判迁巩固层（砍 83% 成本路径）④ D5 测量门 + LongMemEval 双层消融 | 2-4 周+基准 | 依赖 V1/V2 |
| 远期 | N2 REM 生成性重组（D6/D7 线）· N4 自适应分化 · N6 双时间戳查询面 · N7 已并入 V2 · N8 结构骨架 · laya 批微调通道 · 小脑式误差学习器缺位 | — | 触发条件见 roadmap §7 |

## 5. 显式记债清单（已知盲区，不静默吞掉）

| 债 | 归还相位 |
|---|---|
| H 层标识符/精确串查询盲区（dense 已知盲点，R7 教训） | V2 键增广（GLiNER+regex 收割进键）；C0 LIKE 兜底 |
| REM 修剪算子缺位（沉底/衰减是弱版本） | N2 |
| reflection 单遍定稿的历史存量 | V2 宽限期重访只覆盖新增；存量一次性回扫可选 |
| 小脑式监督误差学习器 | 远期（reranker 校准勉强算监督式但不同层） |

## 6. 与现状的映射（已有什么、新建什么）

| 已有（保留） | 新建 |
|---|---|
| t1_obs/t1_archive（51k 轮，C0 按需回源） | t1 嵌入回填 + 向量命名空间 + dense NN 检索面 |
| EmbeddingRuntime（fire-and-forget） | 扩展到 t1 轮次 |
| turnCompress（B1 交错 + S2 簇 + probe-commit） | 重定位：事件驱动 + 读事件段原文 |
| reflection 全家（A2/A4/A5/D1b）+ 周管线 | 宽限期重访 + 交错注入 |
| decay/CATD/ACT-R/reconsolidate/stale-verify | 不动 |
| R8 快照 + BM25/dense/PPR + FOK + arbiter | 快照融合加入 H 层命中 |
| laya 三值门 + G2 + 影子日志（pairs jsonl 235 对） | 校准分析（门槛已达标）→ 后续批微调通道 |
| MinHash 写时合并 | 改标记不合并（V2） |
