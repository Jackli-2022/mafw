# 编码门控（Encoding-Time Salience Gating）：脑式重构 S3

> 日期：2026-09-24 · 状态：设计待审
> 范围：在 `/api/obs/capture` 为每条观测计算并存储显著度/新颖度信号（**打标不丢数据**），供 S2 优先采样
> 依据：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.2（编码受调质门控）、`mem_1790151275099_5y6ode`（写入强度=标量集成，非 LLM：新颖/唤醒/奖赏/图式/重复）
> 相关：`2026-09-24-replay-sampling-design.md`（S2，消费信号）、`gateway/src/judge/salience.ts`（现有标量集成）

## 1. 背景与诊断

### 1.1 现状
- 插件 hooks（user_input / tool_result / reasoning / text.complete / tool.failed）→ `POST /api/obs/capture` → `t1_observations`（脱敏入库）。
- **捕获无条件**：每条观测一律入库，无显著度/新颖度信号。
- turn_pipeline 事后对**整批 transcript** 处理，无法按显著度区分。

### 1.2 脑对照缺口
大脑编码受**神经调质门控**（ACh 编码 vs 检索模式；DA 新颖/奖赏预测误差；NE+杏仁核 情绪唤醒）——不是所有输入都编码，显著事件优先。MAFW 捕获**无门控**，导致：低价值观测与高价值观测同等进入巩固队列，稀释信号、抬高成本。

**关键设计约束**（`mem_1790151275099`）：显著度是**标量检测器集成**（新颖/情绪/奖赏/重复/图式一致），每个可用小模型/启发式近似，**不需要 LLM**。

## 2. 目标 / 非目标

**目标**
1. 在捕获时为每条观测计算 `obsSalience`（确定性/嵌入，无 LLM）。
2. **打标不丢数据**：全部观测仍入 `t1_observations`（源保留），仅新增显著度字段；门控体现为 S2 的采样优先级 + 可选的低显著降权。
3. 提供低显著+重复观测的标记（`low_salience`），供 turn_pipeline 跳过/合并以省 token。

**非目标**
- 不丢弃观测（不做硬门控/采样丢弃）。
- 不引入 LLM 判显著度。
- 不改 `redactSecrets` 脱敏顺序（先脱敏后算信号）。

## 3. 设计

### 3.1 观测显著度（确定性）
`obsSalience(obs, ctx)` 复用 `judge/salience.ts` 的标量集成思路：
```
salience = clamp01( w_n·novelty + w_e·emotion + w_r·reward + w_p·predictionError − w_rep·repetition )
```
- **novelty**：观测嵌入与"本会话近期观测质心"的 1 − cos（嵌入不可用 → 0.5 中性）。
- **emotion**：`calculateSalience(text)` 的正则情绪项（复用现有）。
- **reward**：信号可用则加（如 tool 成功/失败、用户 thumbs）——首版可留 0。
- **predictionError**：观测与既有 semantic 簇的矛盾信号（S2/S4 就绪后接入；首版 0）。
- **repetition**：与近期观测的高相似（cos≥0.9）计数 → 降权。

### 3.2 存储
`t1_observations` 新增列 `salience REAL`（`ALTER TABLE ... ADD COLUMN` 幂等；存量 NULL，读时回退 0.5）。落库前仍经 `redactSecrets()`。

### 3.3 消费
- S2 的 `priority` 用 `obsSalience` 替换启发式回退。
- 可选：`low_salience = salience < θ_low (默认 0.3)` 且 `repetition` 高的观测，turn_pipeline 可跳过或合并（默认关闭，配置门控）。

## 4. 测试与验收

- **单测** `obs-salience.test.ts`：novelty/emotion/repetition 各分量、clamp、嵌入不可用回退、空文本。
- **单测** 迁移：旧行 `salience` NULL 读时回退 0.5；幂等（重复迁移不报错）。
- **集成**：capture 高新颖/高情绪观测 → `salience` 高；重复观测 → 低。
- **验收**：`GET /api/memory/stats` 或 obs 查询可观测 `salience` 分布；S2 采样优先级随之变化。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 嵌入逐条计算开销 | 复用 EmbeddingRuntime 批量/防抖；不可用回退中性 0.5 |
| 阈值误判（重要观测低显著） | 只打标不丢弃；门控默认关闭；θ_low 保守 |
| 迁移破坏旧行 | `ADD COLUMN` 幂等 + 读时回退 |

## 6. 涉及文件

- 新增：`gateway/src/recall/obs-salience.ts`（纯函数，deps 注入）
- 修改：`gateway/src/memory/gateway-db.ts`（列 + 迁移）、`gateway/src/recall/turn-completion.ts` 或 capture 路由（写入信号）、`gateway/src/config.ts`（权重/θ_low）
- 测试：`gateway/tests/unit/obs-salience.test.ts` + gateway-db 迁移回归

## 7. 依赖与分解

- **被 S2 依赖**（优先采样信号源）；本身无前置依赖，可与 S1 并行。
- 建议顺序 S1 → S3 → S2。
