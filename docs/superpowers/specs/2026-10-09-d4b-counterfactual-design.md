# D4b 反事实模拟（Counterfactual Simulation）设计

> 日期：2026-10-09 ｜ 路线图：Phase I（`2026-10-09-remaining-roadmap-all.md`）
> 依赖（已就绪）：L1 能力账本（`orchestration/capability-ledger.ts`）、L2 失败谱、W4 plan 先验注入（v4.22.0）。
> 脑依据：前额叶在规划时做前瞻（prospection）——不只模拟「怎么做成功」，还模拟「哪里会失败」；
> 计划心理学（Klein RPDM）的 pre-mortem：事前验尸显著提高计划质量。

## 1. 问题

W4 已把「同类任务历史 PASS 率 + 反复失败模式」注入 plan 节点（capabilityPriorBlock），
但只是**描述性**先验——告诉规划者「你过去怎样」，没有要求规划者**推演**「这次若失败会怎样」。
且 L1 只到 verdict/failure_kind 粒度——「修 bug」和「做调研」的成功率混在一起，先验失焦。

前置缺口：goal 无任务类型维度。

## 2. 设计

### 2.1 taskType 维度（前置）

**枚举**：`'feature' | 'bugfix' | 'refactor' | 'research' | 'docs' | 'test' | 'other'`

**两个写入点，规划者优先**：
| 点 | 机制 | 优先级 |
|---|---|---|
| 创建时 | `mafw_create_goal`/`mafw_set_goal` 参数 `taskType`（可选）→ request.json → `ensureGoalState` init → state v3 | 低（声明值，可能猜错） |
| 规划时 | waves.json 顶层可选 `taskType` → driver `completeNode` plan 分支回写 state | **高**（规划者读了 charter+repo，判断更准） |

**落库**：`goal_outcomes` 表加 `task_type TEXT` 列（幂等 ALTER TABLE）；`recordGoalOutcome`
读 state.taskType 写入。历史行 NULL → 聚合时并入 `other`/全局池。

### 2.2 L1 分桶

`buildCapabilityLedger` 增 `byTaskType: Record<string, { total, passRate, avgRounds, avgCostUsd }>`；
新增 `ledgerForTaskType(outcomes, taskType)`：同类型样本 **≥3** 才用分桶值，否则退回全局
（小样本不外推——两次 bugfix 全败不代表 bugfix 必败）。

### 2.3 反事实块（counterfactualBlock）

纯函数，渲染进 plan prompt（priorBlock 之后）：

```
### 反事实推演（pre-mortem）——若此任务失败，最可能的形态
- 同类任务（bugfix）历史失败率 40%（N=10），平均损失 3.2 轮 / $1.85
- 最常见失败：exec_error（×4）、bad_plan（×2）
- 历史踩坑对照（为每个 wave 预设缓解）：
  - [×5] PowerShell 无 rg，Select-String 替代
  ...
要求：每个 wave 附 `riskNote`——一句话「此 wave 最可能的失败 + 对应缓解」。
```

无 outcome 数据时退化为仅 taxonomy + riskNote 要求（反事实要求本身不依赖历史）。

### 2.4 plan 产物契约增量

waves.json 每个 wave 加可选 `riskNote` 字段（不强制——缺失不 fail 完成判定，
riskNote 是 prompt 约定不是 schema 门槛）；顶层可选 `taskType`。

### 2.5 driver / 接线

- `NodePromptCtx` 加 `counterfactualBlock?: string`；plan 分支注入
- `DriverDeps.capabilityPrior` 签名 `(goalId) => string | null`（需读 state 的 taskType）；
  新增 `counterfactualPrior?: (goalId) => string | null`
- index.ts 接线：读 goal state → taskType → `ledgerForTaskType` + `counterfactualBlock`
- `completeNode` plan 分支：`waves.taskType` 合法枚举则回写 state

## 3. 测试计划

1. ledger byTaskType 聚合 + ledgerForTaskType <3 样本退全局
2. counterfactualBlock 渲染（有/无 outcome、taxonomy 注入）与空态
3. create-goal taskType → request.json；ensureGoalState init.taskType
4. driver completeNode：waves.taskType 回写；renderNodePrompt plan 含反事实块 + riskNote 契约
5. goal_outcomes ALTER 幂等 + recordGoalOutcome 写 task_type
6. 全部 fail-open：taskType 非法/缺失不阻塞 goal 流程

## 4. 边界

- riskNote 不做 schema 强校验（prompt 约定）；execute/review 节点不注入反事实块（只在 plan）
- 不做反事实的事后验证（riskNote 是否命中）——先攒 waves.json 数据，后续可测「有 riskNote 的 wave 失败率是否更低」
- 不改 /api/agent/capabilities 响应形状（byTaskType 是新增字段，向后兼容）
