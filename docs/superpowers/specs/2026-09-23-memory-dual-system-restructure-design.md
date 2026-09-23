# 记忆系统重构：内容轴（双系统 + 抽象度正交）+ 调控层（判断层）

> 日期：2026-09-23 · 状态：设计待审
> 范围：把"五层线性阶梯"重构为"内容轴（并行系统 + 正交抽象度）+ 调控层（判断层）+ 回放耦合"（分阶段落地）
> 依据：大脑写路径调研（并行系统 + 回放耦合 + 神经调质，无线性阶梯）、判定层选项调研、MAFW LLM 使用清单
> 相关：`2026-09-23-brain-vs-ai-memory-survey.md`、`2026-09-23-consolidation-replay-design.md`、`2026-09-23-c0-source-reconstruction-design.md`、`2026-09-23-anchor-edge-idf-design.md`

## 1. 背景与诊断

**大脑写路径调研结论**：不存在 `raw → episodic → semantic → procedural → axiom` 的单向晋升流水线。大脑是**两个正交轴**：
- **内容系统**（并行）：episodic（海马，快/一次/稀疏/保真）、semantic（皮层，慢/统计/gist）、procedural（基底核，**独立**，重复/反馈驱动）。
- **抽象度**（连续）：任何条目都携带，跨系统，非层级。
- **耦合** = 回放（交错采样，输出 gist，源保留）；**无"公理提交"步骤**。
- **写入强度** = 神经调质标量集成（新颖/唤醒/奖赏/图式一致/重复），非 LLM。
- **调控层（判断层）**：判断"怎么处理"（写不写/多重要/合并/回放/遗忘），**不存内容**，调制内容轴——对应大脑的**神经调质系统**（neuromodulatory，扩散投射、调制内容系统，自己不存记忆）。**不是第三个记忆系统**。

**MAFW 现状冲突**：
| 冲突 | 现状（代码事实） | 目标 |
|---|---|---|
| 线性阶梯 | T1→T2→T3→T4→L5 逐级晋升 | 系统并行 |
| `abstraction_level` 不一致 | **7 处**：`add-memory.ts:45`（global→3/episodic→1/else→2）、`index.ts:6039`（`POST /api/memory/add`，同上）、`core/mcp/tools.ts:465`（procedural→3/global→4/else→2）、`hybrid-compressor.ts:80`（procedural→2）、`reflection.ts:288`（2）、`core/memory/t1-to-t2-compressor.ts:135`（1）、`recall/constraints-migrate.ts:64`（2） | 统一映射 |
| 死管线 | `memory:distill` → `runDistillation` no-op stub（`abstraction-distiller.ts:36`） | 删除 |
| procedural 错接 | 写路径从 episodic/压缩派生 | 独立通道 |
| L5 顶层封存 | 离散 `commit_heuristic` | 连续 abstraction，可再巩固 |
| 判定散落/用 LLM | salience 正则、type 硬编码、consolidation 全走 worker LLM、矛盾/精排缺失 | 统一调控层（本地分层，见 §3.4） |

## 2. 目标 / 非目标

**目标**：内容轴（双系统并行 + 抽象度正交）+ 调控层（判断层，本地分层）+ 回放耦合。
**非目标**：不做参数化写回；不改 boundary recall（守 100ms，已 LLM-free）；不删 `t1_archive`；不改 OKF 存储格式。

## 3. 目标模型

### 3.1 两轴正交
| 轴 | 取值 | 含义 |
|---|---|---|
| **系统**（`type`） | episodic / semantic / procedural / global | 记忆**属于哪个系统**（并行，不晋升） |
| **抽象度**（`abstraction_level`） | 1 / 2 / 3 | 记忆**多抽象**（连续属性），与系统正交 |

**统一映射**（所有写路径）：`episodic → 1`，`semantic | procedural → 2`，`global → 3`。

### 3.2 层职责（并行，非阶梯）
| 层 | 存储 | 写入 | 检索 | 不做什么 |
|---|---|---|---|---|
| **快层** | `t1_archive` + `type:episodic` | 快编码、稀疏、保真 | 线索→源 turn 重建（C0） | 不被 semantic 取代 |
| **慢层** | `type:semantic` | 慢巩固（P1 回放）+ 图式一致快路径 | 语义/图 | 不从 episodic "承接" |
| **程序层** | `type:procedural` | **独立通道**（重复/反馈/成败） | 场景匹配 | 不从 semantic 派生 |
| **公理** | `type:global` | 高抽象 semantic（可再巩固/supersede） | 全局 | 非不可变顶层 |

### 3.3 耦合
- **回放**（P1 已实现）：turnCompress 注入跨会话 prior knowledge。
- **再巩固**（后续）：检索命中+使用时轻量改写，**预测误差门**控制。
- **图式快路径**（后续）：新记忆与既有 semantic 簇高相似 → 一次写入高初始 energy（可计算，非 LLM）。

### 3.4 调控层（判断层）—— 大脑对应：神经调质系统

**判断层不是第三个"系统"，是"调控层"**：回答"**怎么处理**"（写不写/多重要/合并/回放/遗忘），**不存内容**，调制内容轴。对应大脑的**神经调质系统**（neuromodulatory）——扩散投射、调制内容系统（海马/皮层/基底核）的编码/巩固/重放/遗忘，**自己不存记忆**。

| 判定 | 大脑调质 | 结构 | 信号 |
|---|---|---|---|
| 写不写 | 乙酰胆碱（编码门） | 基底前脑 | 编码 vs 检索模式 |
| 多重要（salience） | 多巴胺（新颖/奖赏预测误差） | VTA/SNc | 新颖性、奖赏 |
| 情绪显著 | 去甲肾上腺素 + 杏仁核 | 蓝斑 / 杏仁核 | 唤醒、情绪 |
| 回放优先级 | 多巴胺 + 乙酰胆碱 | VTA/基底前脑 | 价值、注意力 |
| 遗忘 | 神经调质（睡眠下调） | 全脑 | 可及性切换 |

**判断层清单（13 项，分三类）**：
- **写入侧**：① 写不写（规则/Noul）② 类型（embedding+head）③ 显著性（embedding+head/GBM）④ 锚点（规则）⑤ 矛盾/取代（NLI/cross-encoder）⑥ 合并裁判（worker LLM；Jev Choice 可选）⑦ 抽象度（规则）
- **读取侧**：⑧ 精排/相关性（cross-encoder）⑨ 使用校准（cross-encoder/NLI）⑩ 查询改写（生成模型）
- **维护侧**：⑪ stale 校验（worker agent，需取证据）⑫ 回放采样（相似度/规则）⑬ 遗忘（规则/Score）

**实现分层（本地优先）**：Tier 0 deterministic/embedding（免费即时）→ cross-encoder（1–10ms）→ NLI（20–200ms）→ worker LLM（兜底）。**关键**：Qwen3-Embedding 是 **bi-encoder**（query/doc 各自编码）→ **挂头只能做分类/打分，做不了 pair 判断**（矛盾/精排需 cross-encoder）。**Jev 仅 ⑥ 合并裁判真适配**（可选，默认不接；外部依赖/隐私/中文），②/③ 可选试点，其余本地更优或 Jev 做不到。

## 4. 分阶段改动

### Phase A：清理与统一（零/低成本，先做）
- **A1 删死管线**：移除 `automation-engine.ts:41` 的 `actionRegistry.set('memory:distill', …)`、`abstraction-distiller.ts`（或标注 deprecated），并更新 `mcp/tool-registry.ts:398/455` 的 action 枚举（否则留下可校验但死的 action）。**注**：`pipeline-rules.ts` **无**默认 `memory:distill` 规则（仅 `memory-decay`/`memory-review`），故无需改规则供给。
- **A2 统一 `abstraction_level`**：抽 `abstractionLevelFor(type)` 纯函数，**7 处**写路径改用它（含 `index.ts:6039`、`constraints-migrate.ts:64`）。**注**：`core/memory/t1-to-t2-compressor.ts` 仅经 deprecated `core/plugin.ts` 路径接线，确认其是否在跑再计入。
- **A3 可观测**：`/api/memory/stats` 暴露 `abstraction_level` 分布（验证一致性）。**注**：`HarmonicIndexEntry` **不含** `abstraction_level`（只在 OKF frontmatter）→ 统计与一次性重算需**读单元文件**（全量读约 12s），或先给 index entry 补该字段。

### Phase B：调控层（判断层）—— 本地分层（Jev 可选）
- **B1 统一接口**：`gateway/src/judge/`（`judge(kind, state) → typed answer`），每个 kind 选实现（规则/embedding/cross-encoder/NLI/LLM/Jev）。
- **B2 本地分层**：Tier 0 deterministic/embedding（type 分类、salience 新颖度）→ cross-encoder（精排/矛盾）→ NLI（矛盾/类型）→ worker LLM（兜底）。
- **B3 合并裁判**：worker LLM 保持；**可选**换 Jev Choice（`{update|create|none}` + target_id，低置信升级 LLM）。
- **B4（可选）**：Jev 试点（精排/显著性）——**默认不接**（外部依赖/隐私/中文）。

### Phase C：双系统结构（高成本，需独立 spec/plan）
- **C1 取消线性阶梯**：`type` 表示并行系统；`abstraction_level` 仅抽象度。
- **C2 procedural 独立通道**：turnCompress/reflection **不**默认写 procedural；procedural 由重复/反馈信号驱动。
- **C3 global/L5 降为连续 abstraction**：可再巩固/supersede。
- **C4 分系统检索通道 + 分层衰减**（并入原 C1）：episodic 通道（时间/近因）+ semantic 通道（语义/图）RRF 融合；episodic 半衰期短、semantic 长。

### Phase D：快路径 + 再巩固（中成本）
- **D1 图式快路径**：与既有 semantic 簇 cosine ≥ 阈值 → 一次写入高 energy。
- **D2 再巩固**：接线检索访问 + 使用反馈 → 更新窗口（预测误差门）。

## 5. 迁移与兼容

- **`abstraction_level` 重算**：一次性迁移，按 `type` 统一映射（幂等；`HarmonicIndexEntry` 无该字段 → 读单元文件重算，或给 index entry 补字段）。
- **不改 OKF 存储格式**；现有约 3400 条平滑分层（按 `type`）。
- **回滚**：每 Phase 独立开关；A/B 可单独回退。

## 6. 测试与验收

- **A**：`abstractionLevelFor` 单测 + 5 处写路径一致性；死管线移除回归。
- **B**：本地分层各层 A/B（cross-encoder/NLI vs BM25）；合并裁判 Jev vs LLM A/B（自有标注集）；置信门阈值调优。
- **C**：分系统通道 LongMemEval 对照（preference/multi-session 是否改善）。
- **D**：图式快路径命中率；再巩固不引入漂移（预测误差门）。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Phase C 动检索 → 回归 | 独立开关 + LongMemEval 对照 + 可回退 |
| Jev 中文/领域准确率低 | 需自有标注验证；低置信升级 LLM；**默认不接** |
| Jev 接入新增外部依赖/延迟 | 仅写入侧、**可选**；fail-open 回退 worker LLM |
| 本地分层新增模型下载 | ONNX/GGUF 一次性；fail-open |
| 迁移破坏现有分层 | 幂等迁移 + 备份 |
| `abstraction_level` 语义被误用为"层级" | 文档 + 类型注释明确"正交属性" |

## 8. 涉及文件（概览）

- **A**：`automation-engine.ts`（规则）、`abstraction-distiller.ts`、`mcp/tool-registry.ts`（枚举）、`mcp/handlers/add-memory.ts`、`index.ts:6039`（HTTP 写路径）、`core/mcp/tools.ts`、`core/compression/hybrid-compressor.ts`、`recall/reflection.ts`、`core/memory/t1-to-t2-compressor.ts`、`recall/constraints-migrate.ts`、`core/memory/harmonic-types.ts`（+ `abstractionLevelFor`）、`index.ts`（stats）
- **B**：新增 `gateway/src/judge/`（统一接口 + 本地实现）、`memory/consolidation-service.ts`、`recall/turn-pipeline.ts`；可选 `gateway/src/jev/`
- **C/D**：`core/memory/harmonic-index.ts`、`memory/harmonic-file-store.ts`、`config.ts`、`recall/*`

## 9. 分解说明

本 spec 是**伞形设计**，覆盖 4 个阶段。**每阶段单独出 spec/plan**（Phase A 可立即执行；Phase C 需独立深度设计）。下一步建议从 **Phase A** 开始。
