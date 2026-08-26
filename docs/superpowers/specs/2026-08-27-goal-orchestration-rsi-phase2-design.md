# Goal 编排 RSI — Phase 2：策略包演化闭环设计

日期：2026-08-27
状态：待审阅
依赖：Phase 1（`2026-08-27-goal-orchestration-rsi-phase1-design.md`）已落地，goal_outcomes 有 baseline 数据

## 1. 目标

编排的"可调决策"从代码迁移到版本化策略数据，由每日 evolver 基于 outcome 归因提出字段级变更，经 triage 人确认后激活，效果由 declared_prediction 对照验证，可回滚。

闭环：`outcome 数据 → evolver 反思提议（可证伪预测）→ triage 确认 → active.json 切换 → 后续 goal 打变体标记 → 验证/回滚`

## 2. 策略包数据化（前置重构）

### 2.1 目录布局（`~/.mafw/orchestration/`）

```
orchestration/
├── active.json                    -- { "version": "builtin-v1" }
└── policies/
    └── <version>/
        ├── policy.yaml            -- 结构化参数（阈值/模型路由/开关）
        └── prompts/
            ├── plan.md            -- plan prompt 模板
            └── review.md          -- review prompt 模板
```

### 2.2 策略包内容（对应注册表组件）

| 组件 id | 现值来源 | 数据化目标 |
|---|---|---|
| `plan.prompt` | `core/skills/mafw-plan/entry.ts` 本地 buildPlanPrompt + `.opencode/skills/mafw-plan/SKILL.md` 指令文本 | `prompts/plan.md` 模板（收敛双份 prompt，以 entry.ts 为准） |
| `review.prompt` | `core/skills/mafw-review/entry.ts` 本地 buildReviewPrompt | `prompts/review.md` 模板 |
| `review.samematch_threshold` | review.node.ts:69 硬编码 `>=2` | policy.yaml |
| `loop.max_rounds` | config.loop.maxRounds=3 | policy.yaml（覆盖 config 默认值） |
| `plan.model` | opencode session 默认模型（plan.node.ts:40 create session 不传 model） | policy.yaml + 需新增 session 创建时 model 参数接线 |
| `review.model` | opencode session 默认模型（review.node.ts:44 create session 不传 model） | policy.yaml + 需新增 session 创建时 model 参数接线 |

**前置重构**：先收敛 `core/tools/run-plan.ts` 与 `core/skills/mafw-plan/entry.ts` 的双份 prompt（以 entry.ts 为准，删除 tools 版），再抽取模板。baseline 等价测试断言对象为 entry.ts 本地函数输出。

### 2.3 读取侧改造（优先级链）

`policy.yaml > config.yaml > 代码默认值`。config 已有热重载；policy 层在 `getActivePolicy()` 上扩展为返回完整 bundle，**缓存 + mtime 失效**（每 goal 启动时读一次足够，不需 per-request）。

prompt 模板改造：entry.ts 本地 buildPlanPrompt/buildReviewPrompt 的散文骨架抽到 `prompts/*.md`，代码只做变量插值；模板缺失/损坏 → 回退代码内置版本（fail-open）。

plan/review session 创建路径新增 model 参数：`plan.node.ts:40` 和 `review.node.ts:44` 的 `client.session.create` 调用从 policy 读取 model 并传入。

### 2.4 baseline 迁移

首次启用时把 entry.ts 本地函数当前输出原样导出为 `policies/builtin-v1/`——保证 builtin-v1 与现状逐字节等价（有测试断言）。导出后**删除代码内置 prompt**，单一数据源（防 builtin-v1 标签说谎）。

## 3. Evolver（每日 cron）

### 3.1 触发与运行环境

- 规则：`orchestration-evolve`，cron 每日 UTC 4:30（错开 reflect 3:00 / decay 3:30），pipeline-rules.ts 供给
- actionRegistry 注册 `orchestration:evolve`，照 reflect 模式；worker 复用 session-worker-pool（独立 worker，`orchestration-evolver` 角色，workerModel 同 recall.workerModel）
- **独立 pipeline guard**：不复用全局 `runPipelineGuarded`（单飞守卫会导致 turn-compress 积压时 evolver 静默跳过），改为 per-action 独立 guard 或 skip 后延迟重试（如 4:30 被跳过则 4:45 补偿）
- **成本预算**：每日 evolver 运行 token 预算上限（policy.yaml `evolver.dailyTokenBudget`，默认 50k），超出则本次运行截断并记录；运行成本写入 `~/.mafw/logs/evolver-cost.jsonl`

### 3.2 Evolver 输入（三层证据下钻）

1. **顶层**：近 7 天 goal_outcomes 聚合——按 (policy_version, failure_kind) 分组的 PASS 率、平均轮数、平均成本、thumbs 净分
2. **中层**：top 失败聚类的 lessons（.mafw/lessons/）与 review 报告反馈文本
3. **底层（按需）**：单个失败 goal 的 trajectory 摘要（toolErrorCount 高的 turn）

### 3.3 提议生成（GEPA 式反思 + 可证伪契约）

Worker prompt 要求输出 JSON：

```json
{
  "proposals": [{
    "component_diffs": [{"component_id": "review.samematch_threshold", "field": "value", "from": 2, "to": 3}],
    "declared_prediction": "review_false_fail 类占比从 X% 降到 <Y%（验证窗口：激活后 20 个 goal）",
    "rationale": "近 7 天 review_false_fail 占失败 40%，sameSig 过早升级..."
  }]
}
```

硬约束（代码强制，不靠 prompt 自觉）：
- `component_id` 必须在注册表内且 `evolvablePhase <= 2`；否则整条提议丢弃
- 每次提议最多 **3 个** component_diffs（可审查性）
- prompt 类 diff 以**段落级**操作表达（`replace_section` / `append_section` / `remove_section`），非全文替换
- 无洞察时输出空 proposals（不强行演化——"no change" 是合法输出）
- **代码级去重**：`component_diffs` 规范化后哈希查重（近 30 天内相同 diff 被拒绝过则不再提议）+ 同组件冷却期（同组件 7 天内不重复提议，无论上轮结果）

### 3.4 提议落库

写入 `evolution_proposals`（status=`proposed`），同时创建 triage item（**新类型 `evolution_proposal`**，summary 含 diff 表 + declared_prediction + rationale）。

## 4. 激活、验证、回滚

### 4.1 激活

**新增 triage 类型与 confirm handler**（现有 `POST /api/triage/{id}/confirm` 语义是从模板创建 goal，不适用于 policy 应用）：

- 新增 triage item 类型 `evolution_proposal`（区别于现有 `automation_rule` / `goal_creation`）
- 新增 confirm handler `POST /api/triage/{id}/confirm-evolution`（或在现有 confirm 内按 item 类型分发）：
  1. 从 triage item 关联的 proposal 读取 `component_diffs`
  2. 基于当前 active policy 拷贝 + 应用 diff → 生成新版本目录 `policies/v<n>/`
  3. 写 `active.json` 指向新版本
  4. proposal status → `active`
  5. triage item → `confirmed`

triage 拒绝 → proposal status → `rejected`，triage item → `rejected`，不生成新版本。

### 4.2 变体标记（打标时机）

**goal 创建时快照**（非归档时读取，防止 policy 切换污染进行中的 goal）：

- `onGoalCreated`（`index.ts:4601` 附近）调用 `getActivePolicy()` 获取 `{ version, proposalId }`
- 快照写入 goal 的 state 文件或 request 文件（如 `state.policySnapshot` 字段）
- `recordOutcome` 在归档时从 state 读取快照，写入 `goal_outcomes.policy_version` 和 `goal_outcomes.evolution_proposal_id`

baseline（builtin-v1）的 proposalId 为 NULL。

**并发与切换边界**：policy 切换瞬间，已创建但未归档的 goal 继续使用旧版本（快照已定）；新创建的 goal 使用新版本。同一时刻不同 goal 可能跑在不同 policy 版本上，这是预期行为。

### 4.3 验证（evolver 下次运行时前置步骤）

#### 4.3.1 统计方法

验证窗口采用**时间 + 样本双条件** + **项目分层**：

- 最小样本量：每臂（active vs baseline）≥ 30 个 goal（检测 15pp 效应量，power 0.8，α=0.05 的量级估计；policy.yaml `evolver.minSamplePerArm` 可调）
- 时间窗口：激活后 7-14 天（防 baseline 环境漂移；policy.yaml `evolver.verificationWindowDays`）
- **项目分层报告**：`goal_outcomes` 按 `(policy_version, project_id)` 分组统计，fitness 查询展示 per-project PASS 率 + 总体加权；项目构成漂移超过阈值（如某项目占比变化 >20pp）则标记 `project_drift_warning`
- 效应量门槛：预测为"占比下降 X pp"类，实际下降 < X/2 pp 则判定未达标（防微弱效应冒充成功）
- 置信区间：报告 PASS 率差值的 95% CI（Wilson score interval），CI 跨零则标注 `inconclusive`

#### 4.3.2 验证流程

1. 找 status=`active` 且满足双条件（时间窗口 + 最小样本）的 proposal
2. 对照 `declared_prediction` 做机器可验部分（占比/均值类预测用 SQL + 统计函数算；不可机验的标注 `manual_review`）
3. 达标（效应量达门槛 + CI 不跨零）→ `validated`
4. 显著恶化（PASS 率下降 >10pp 或成本上升 >30%，CI 不跨零）→ 自动回滚：active.json 写回上一版本，proposal → `rolled_back`，生成 triage item 通知人（**回滚是"triage 人确认"原则的唯一例外**，显式声明）
5. 窗口内数据不足或 CI 跨零 → 下周期间继续等；超过 `evolver.maxWaitDays`（默认 21）仍未达标 → `inconclusive`，不自动回滚但生成 triage item 提示人决策

#### 4.3.3 状态机闭合

- proposal 未集满窗口时被新 proposal 顶掉 → 旧 proposal status → `superseded`（非继续 active），关联 outcome 保留但标记 `excluded_from_comparison`
- 自动回滚后，旧版本期间已落库的 outcome 保留 `policy_version` 标签，但 `evolution_proposal_id` 对应已 rolled_back 的 proposal，后续对比时排除（`WHERE proposal_id IS NULL OR proposal.status NOT IN ('rolled_back', 'superseded')`）

### 4.4 档案

`policies/` 下所有版本永久保留（DGM 式 stepping stones）；evolver prompt 携带历史 proposal 的 validated/rolled_back/superseded/rejected 记录 + component_diffs 哈希，避免重复提议已否决方向（配合 §3.3 代码级去重）。

## 5. 循环外保护（不可演化面）

- 组件注册表 `registry.ts` 本身、evolver 的硬约束检查代码、triage 确认流、auth/权限模块——**不在注册表内，evolver 物理上无法触及**
- policy 加载 fail-open：任何损坏回退 builtin-v1，goal 编排永不因策略层故障中断

## 6. 测试

- policy 加载：优先级链（policy > config > 默认）、损坏回退、mtime 缓存失效
- 提议校验：注册表外组件被拒、>3 diff 被拒、段落级 diff 应用正确性、代码级去重（相同 diff 哈希被拒）
- baseline 等价：`policies/builtin-v1` 渲染输出与 entry.ts 本地函数输出逐字节一致
- 验证器：达标/恶化/数据不足/inconclusive 四分支；自动回滚写 active.json；统计函数（CI 计算、效应量门槛）
- triage evolution confirm handler：正常激活、拒绝、diff 应用失败
- 状态机：superseded 转移、回滚后 outcome 排除标记
- evolver 端到端：mock outcomes + mock worker → proposal 落库 + triage item 创建（类型 `evolution_proposal`）

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/orchestration/policy.ts` | 扩展为完整 bundle 加载（缓存+mtime、优先级链） |
| `gateway/src/orchestration/policy-migrate.ts` | 新建：builtin-v1 导出（从 entry.ts 本地函数） |
| `gateway/src/orchestration/evolver.ts` | 新建：归因聚合 + worker 反思 + 提议校验落库 + 代码级去重 ~280 行 |
| `gateway/src/orchestration/validator.ts` | 新建：declared_prediction 机验 + 统计函数（CI、效应量）+ 回滚 ~150 行 |
| `gateway/src/orchestration/triage-evolution.ts` | 新建：`evolution_proposal` triage 类型 + confirm handler ~80 行 |
| `gateway/src/core/skills/mafw-plan/entry.ts` | prompt 骨架抽为模板，代码插值；session.create 新增 model 参数 |
| `gateway/src/core/skills/mafw-review/entry.ts` | prompt 骨架抽为模板，代码插值；session.create 新增 model 参数 |
| `gateway/src/core/langgraph/nodes/plan.node.ts` | session.create 从 policy 读取 model |
| `gateway/src/core/langgraph/nodes/review.node.ts` | sameSig 阈值改读 policy；session.create 从 policy 读取 model |
| `gateway/src/index.ts` | onGoalCreated 快照 policy；注册 `orchestration:evolve`；evolver 独立 guard |
| `gateway/src/chat/graph-runner.ts` | maxRounds 改读 policy |
| `gateway/src/recall/pipeline-rules.ts` | +evolve cron 规则 |
| `tests/unit/gateway/` | +5 个测试文件（含统计函数） |
| `AGENTS.md` | 增补 orchestration 系统说明 |

## 8. Phase 2 退出标准

- evolver 在真实数据上产出过 ≥1 条合法 proposal 并走完 triage→激活→验证全流程（含一次回滚或 validated）
- `SELECT policy_version, verdict, avg(rounds), avg(total_cost) FROM goal_outcomes GROUP BY 1,2` 能对比出 ≥2 个版本的差异
