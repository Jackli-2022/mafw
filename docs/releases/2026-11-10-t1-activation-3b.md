# 2026-11-10 · T1 Activation Phase 3B（未部署）

- **分支**：`feat/t1-retrieval-2a`（延续 2A/2B/3A，未合并/未部署）
- **计划**：`docs/superpowers/plans/2026-11-10-t1-activation-3b.md`
- **设计**：`docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.3 / §12 step 4
- **本阶段提交**：`3ed4fbb5`（状态）→ `812496fd`（provenance 传播）→ 本文档提交（每日衰减 + stats）
- **状态**：已实现并通过全量门禁；**尚未部署**

## 交付内容

### 1. `t1_trace_state`

```sql
t1_trace_state(
  trace_id TEXT PRIMARY KEY,
  activation REAL NOT NULL DEFAULT 0,
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  last_retrieved_at INTEGER,
  last_replayed_at INTEGER,
  activation_updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

### 2. 写入与传播

- `recordT1RetrievalEvent`（`search` / `recall` / `redeem`）在同一事务中：
  - `activation = min(1, activation + 0.1)`
  - `retrieval_count += 1`
  - `last_retrieved_at = now`
- 未知 trace 只记录事件，不创建状态行。
- `propagateT1Activation(traceIds, weight=0.05)`：`mafw_get_memory` 成功解析精确 `source_trace_ids` 后调用；单次权重上限 0.2，未知 id 忽略。
- `mafw_get_memory` 的传播失败被吞掉，读取照常返回。

### 3. 每日衰减

- `decayT1TraceState({ halfLifeDays })`：按 `activation_updated_at` 计算经过天数，`activation *= 0.5^(days/halfLife)`，低于 0.01 归零。
- 接入 `memory:decay`，半衰期取 `config.recall.t1Recall.activationHalfLifeDays`（默认 14）。
- heartbeat counts 增加 `t1ActivationDecayed`。

### 4. 观测

`/api/memory/stats` 的 `t1` 新增：

```json
{ "activation": { "traces": 0, "mean": 0, "max": 0 } }
```

### 5. 明确非目标

本阶段 activation **不参与** T1/Harmonic 排序、energy、快照注入或 FOK。它只是为下一阶段“有界排序/驻留消费”准备的状态信号；必须先积累真实数据与 A/B 证据再打开排序消费。

## 门禁结果

- gateway 全量：`npx jest --runInBand --forceExit` → **744 suites / 5806 tests，0 fail**
- SDK：`cd packages/gateway-sdk && npm test` → **205 tests，0 fail**
- 类型：`cd gateway; npx tsc --noEmit -p tsconfig.json` → **rc=0**
- 根构建：`npm run build` → **rc=0**
- 3B 新增测试：**10**（状态/衰减 7、传播 2、每日衰减接线 1；gateway 5796 → 5806）

## 已知限制

- 增量是固定值（检索 +0.1、传播 +0.05），不是 ACT-R 的 `ln(sum t^-d)`；后续可用事件表离线校准。
- `last_replayed_at` 目前只保留字段，尚未由 replay 管线写入。
- 排序消费未开启；`t1.activation` 目前只用于观测与后续 A/B。
- 未部署。
