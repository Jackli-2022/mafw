# 再巩固（Retrieval-Driven Reconsolidation）：脑式重构 S5

> 日期：2026-09-24 · 状态：设计待审
> 范围：检索/使用反馈驱动的记忆更新窗口（预测误差门），把检索从"只读终点"变为"记忆演化驱动"
> 依据：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.4E（Nader 2000 再巩固）、§2.3（再巩固默认缺席）、REALM `2609.16053`（检索反馈驱动再巩固，LoCoMo +7.17）
> 相关：`2026-09-24-write-time-routing-design.md`（S1，UPDATE 执行侧）、`2026-09-23-memory-dual-system-restructure-design.md`（Phase D2）

## 1. 背景与诊断

### 1.1 现状
- 检索**只读**：`searchScored` 不修改命中条目（除 S1 的写时路由外）。
- "检索访问 +0.02"（Phase D2a）**已实现但休眠**——`search-hybrid.ts` 的 `updateEnergy(id, +0.02)` 未接线到检索路径。
- 使用反馈（`mafw_record_feedback` 点赞/点踩）只调 alignment energy，不驱动记忆改写。

### 1.2 脑对照缺口
大脑：**提取使记忆回到不稳定态**（可更新窗口），需重新蛋白合成再稳定（Nader 2000）——但**需预测误差/较弱或较新记忆**才可诱导（否则每次回忆都改写 → 漂移）。MAFW 检索是终点，记忆**写入后不再演化**（除显式 supersede）。

**对标**：REALM `2609.16053` 把记忆建模为**持续生命周期**，检索反馈驱动再巩固，消融证实持续有益。

## 2. 目标 / 非目标

**目标**
1. **接线访问信号**：检索命中 → `updateEnergy(+0.02)`（激活休眠实现）。
2. **使用信号 → 再巩固资格**：命中且**被实际使用**（thumbs / 被引用 / `get_memory` 兑现）→ 标记 `reconsolidation_eligible`（带时间窗）。
3. **预测误差门**：下一轮巩固对 eligible 记忆**允许 UPDATE**；仅当新信息**与旧矛盾**才改写（仅"再次遇到"不改，防漂移）。
4. 可观测 `reconsolidated` 计数。

**非目标**
- 不做"每次检索都改写"（会漂移）——必须过预测误差门。
- 不改 100ms 边界 recall（同步路径只做能量加成，不做改写）。
- 不引入 LLM 判"是否使用"（用确定性信号：thumbs / 引用标记）。

## 3. 设计

### 3.1 访问加成接线（低风险，先做）
- `mafw_search_hybrid` / `/api/memory/search` 显式检索路径：命中 top-k → `indexManager.updateEnergy(id, +0.02)`（幂等、有上限 1.0）。
- **边界 recall（`/api/recall/context`）不加**（守 100ms，且非显式使用）。

### 3.2 再巩固资格
命中条目在**被使用**时标记资格：
- 触发：`mafw_record_feedback { targetId, thumbs_up }`；或该 id 在后续轮次被 `mafw_get_memory` 兑现；或（可选）被 agent 显式引用。
- 存储：`gateway.db` 表 `reconsolidation_queue(id, marked_at, expires_at, reason)`，TTL 默认 24h。
- 资格过期即失效（再巩固窗口有限，对齐 Nader 的时间依赖）。

### 3.3 预测误差门 + UPDATE
- 下一轮 turn_pipeline 巩固时，对 `reconsolidation_queue` 中未过期的 id：
  - 若本轮 transcript 含**与该记忆矛盾**的新信息（判官判 `update` 且属该 target）→ 允许 UPDATE（走 S1 的 `mergeIntoNewer`）。
  - 若仅**再次遇到一致信息** → 不改写，仅刷新 `updated_at` / 能量（防漂移）。
- 与 S1 协同：S1 处理"新写入是重复"；S5 处理"已被使用的旧记忆被新信息更新"。

### 3.4 可观测
`GET /api/memory/stats` 增 `reconsolidation: { eligible, reconsolidated }`。

## 4. 测试与验收

- **单测** `access-bonus.test.ts`：检索命中 → energy +0.02（有上限）；边界 recall 不加。
- **单测** `reconsolidation-queue.test.ts`：标记/过期/TTL、幂等。
- **集成**：写记忆 → 检索+thumbs → 资格入队 → 下轮矛盾新信息 → 旧记忆 UPDATE（supersede 链）；仅一致信息 → 不改写。
- **回归**：S1 路由不变；检索延迟不退化。
- **验收**：`reconsolidated > 0`（有更新发生）；无"仅重复即改写"的漂移（对照实验）。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 记忆漂移（过度改写） | **预测误差门**（仅矛盾才改）+ TTL 窗口 + 仅"被使用"才入队 |
| 资格表膨胀 | TTL 过期清理；入队去重 |
| 使用信号难判 | 首版用确定性信号（thumbs / get_memory 兑现），不做 LLM 判 |
| 访问加成被刷 | +0.02 有上限 1.0；只对显式检索路径 |

## 6. 涉及文件

- 新增：`gateway/src/recall/reconsolidation.ts`（队列 + 预测误差门，deps 注入）
- 修改：`gateway/src/mcp/handlers/search-hybrid.ts`（访问加成接线）、`gateway/src/mcp/handlers/record-feedback.ts`（标记资格）、`gateway/src/recall/turn-pipeline.ts`（消费队列 + 矛盾 UPDATE）、`gateway/src/memory/gateway-db.ts`（队列表）、`gateway/src/index.ts`（stats）
- 测试：`gateway/tests/unit/recall/access-bonus.test.ts`、`reconsolidation-queue.test.ts` + 集成

## 7. 依赖与分解

- **依赖 S1**（UPDATE 执行侧）与检索路径接线；无前置阻断。
- 建议最后实现（S1 → S3 → S2 → S4 → S5），因其消费 S1 的整合能力。
