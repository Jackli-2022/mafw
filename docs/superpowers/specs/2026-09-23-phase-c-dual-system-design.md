# Phase C · 双系统结构（Dual-System Structure）设计

> 日期：2026-09-23 · 状态：设计待审
> 范围：内容轴的落地——取消线性阶梯、procedural 独立、global 降连续、**分系统检索通道 + 分层衰减**
> 依据：`2026-09-23-memory-dual-system-restructure-design.md`（伞形 §3）、大脑写路径调研
> 前置：Phase A（abstractionLevelFor 统一）已上线

## 1. 背景

伞形 spec §3 定义**内容轴**（系统并行 + 抽象度正交）。Phase A 已统一 `abstraction_level`。Phase C 落地结构。

**现状与目标的差距**：
| 项 | 现状 | 目标 | 差距 |
|---|---|---|---|
| C1 系统并行 | `type` 已是系统，但历史上有"阶梯"语义 | 明确并行 | 概念/文档 |
| C2 procedural 独立 | worker agent 自选 type（含 procedural）——**已是独立写入** | 不从 episodic 派生 | ✅ 基本满足 |
| C3 global/L5 降连续 | global 是 `type`，`abstraction_level=3` | 高抽象 semantic，可再巩固 | 概念/文档 |
| **C4 分层衰减** | **统一 0.005/天**（`EnergySystem`） | episodic 快、semantic 慢 | ❌ **缺** |
| **C4 分系统检索通道** | **单通道 BM25 混排** | episodic 通道 + semantic 通道 RRF | ❌ **缺** |

## 2. 目标 / 非目标

**目标**：C4（分层衰减 + 分系统检索通道）——内容轴的检索/衰减落地。
**非目标**：不改存储；不改 boundary recall 契约；C1-C3 仅文档澄清（代码已满足）。

## 3. 设计

### 3.1 C4a 分层衰减（先做，低成本）
新增纯函数 `decayRateFor(type)`（`core/memory/abstraction-level.ts` 或 `energy-system.ts`）：
| type | 衰减率/天 | 依据 |
|---|---|---|
| episodic | **0.010** | 快层应快忘（海马快衰减） |
| semantic | **0.005** | 现状（慢层稳定） |
| procedural | **0.003** | 程序记忆持久 |
| global | **0.001** | 公理级最稳 |

`runEnergyDecay`（`automation-engine.ts:64`）改为 `energySystem.decay(entry.energy, days, salience, decayRateFor(entry.type))`（`EnergySystem.decay` 加可选 rate 参数，缺省用 `decayRatePerDay`）。

### 3.2 C4b 分系统检索通道（后做，需独立 plan）
`searchScored` 内按系统分两通道：
- **episodic 通道**：时间/近因加权（`created_at` 邻近 + energy）。
- **semantic/procedural/global 通道**：BM25 + 锚点/联想图（现状）。
- 两通道各自排序 → **RRF 融合**（复用 `rrfFuse`）。
- 守 100ms：两通道均同步、无 IO。

## 4. 测试 / 验收

- **C4a**：`decayRateFor` 单测；`runEnergyDecay` 对 episodic 衰减快于 semantic（构造两条目，跑一次 pass，比较）。
- **C4b**：分通道 vs 单通道 LongMemEval 对照（preference/multi-session）。
- **回归**：全量套件。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| C4a 改变现有衰减 → 历史条目加速淡出 | 只对新 pass 生效；可配开关 |
| C4b 动检索 → 回归 | 独立开关 + LongMemEval 对照 + 可回退 |
| 分通道在候选少时反而变差 | 通道为空时回退单通道 |

## 6. 涉及文件

- **C4a**：`core/memory/abstraction-level.ts`（`decayRateFor`）、`core/memory/energy-system.ts`（可选 rate）、`automation-engine.ts`（decay pass）
- **C4b**：`core/memory/harmonic-index.ts`（`searchScored` 分通道 + RRF）、`config.ts`

## 7. 分解

**C4a 先做**（低成本、可测）；**C4b 独立 plan**（动检索，需对照）。
