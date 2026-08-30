# Goal 编排 RSI — Phase 2：策略包演化闭环设计

日期：2026-08-27（v2，按子代理评审修正）
状态：🔴 架构评审未通过（2026-08-26）— 1 blocker + 6 majors，需修订后重新评审
依赖：Phase 1（`2026-08-27-goal-orchestration-rsi-phase1-design.md`）已落地，goal_outcomes 有 baseline 数据

## 架构评审结论（2026-08-26）

**结论：未达到可进入实现计划的程度。**

### Blockers（必须修复）

| ID | 问题 | 详情 |
|----|------|------|
| B3 | `mafw_propose_triage_decision` 只挂建议不执行确认 | 激活链路语义用错——§4.1 描述 "POST /api/triage/{id}/confirm 增加按 type 分发"，但 `mafw_propose_triage_decision` 的现有语义是 "仅挂建议"，需要新增 triage item `type: 'evolution'` 的确认执行逻辑，而非复用现有 propose 路径 |

### Major 问题

| ID | 问题 |
|----|------|
| M6 | `evolution_proposals` 表缺 `requires` 字段——§2.3 已添加（`requires TEXT DEFAULT 'policy'`），但需确认 Phase 1 建表语句是否包含此字段 |
| M7 | `GoalWorktreeManager` 硬编码 `goal/{goalId}` 且 `checkout('main')` 但仓库主分支是 `master`——Phase 3 §4.1 已提出泛化要求，但 Phase 2 的 policy 数据化不涉及 worktree，需确认是否有隐式依赖 |
| M8 | 验证窗口 n=20 统计功效不足——§4.3 已修正为 "变体臂与对照臂各自 ≥ 最小样本（默认 10）才下结论" + "占比类预测要求效应量门槛（变化 ≥10pp）"，需确认统计功效分析是否充分 |
| M9 | evolver cron 可被全局单飞守卫静默跳过——§3.1 已修正为 "per-action 独立 guard" + "skip 后延迟 30min 重试一次"，需确认 `runPipelineGuarded` 的现有实现是否支持独立锁 |
| M10 | 验证窗口内 policy 再切换状态机未闭合——§4.3 已添加 superseded 机制（新 proposal 激活时旧 active → superseded），但需确认 superseded 后的 outcome 归属逻辑 |
| M11 | `failure_signature` 无实现基础——继承 Phase 1 M4 问题，需确认 Phase 2 evolver 的归因推理是否依赖 failure_signature 的实际生成 |

## 1. 目标

编排的"可调决策"从代码迁移到版本化策略数据，由每日 evolver 基于 outcome 归因提出字段级变更，经 triage 人确认后激活，效果由 declared_prediction 对照验证，可回滚。

闭环：`outcome 数据 → evolver 反思提议（可证伪预测）→ evolution 类 triage 确认 → active.json 切换 → 新 goal 创建时快照变体标记 → 验证/回滚`

## 2. 策略包数据化（前置重构）

### 2.1 目录布局（`~/.mafw/orchestration/`）

```
orchestration/
├── active.json                    -- { "version": "...", "proposalId": ... }
└── policies/
    └── <version>/
        ├── policy.yaml            -- 结构化参数（阈值/开关）
        └── prompts/
            ├── plan.md            -- plan prompt 模板
            └── review.md          -- review prompt 模板
```

### 2.2 策略包内容（以 Phase 1 注册表首期最小集为准）

| 组件 id | 现值真实来源（评审核实） | 数据化目标 |
|---|---|---|
| `plan.prompt` | `core/skills/mafw-plan/entry.ts` **本地** buildPlanPrompt | `prompts/plan.md` 模板 |
| `review.prompt` | `core/skills/mafw-review/entry.ts` **本地** buildReviewPrompt | `prompts/review.md` 模板 |
| `review.samematch_threshold` | review.node.ts 硬编码 `>=2` | policy.yaml |
| `review.verdict_parse` | review.node.ts parseReviewVerdict | policy.yaml（开关/参数级，启发式本体留代码） |
| `loop.max_rounds` | config.loop.maxRounds=3 | policy.yaml（覆盖 config 默认值） |
| `loop.stuck_timeout` | config.timeouts.stuckLoopTimeout | policy.yaml |
| `execute.degradation_l3` | degradation.ts | policy.yaml |

注意（评审 M1）：
- `core/tools/run-plan.ts` / `run-review.ts` 的 buildPlanPrompt/buildReviewPrompt 是无人调用的漂移副本——**先收敛**（删除或改为 re-export entry 版），再抽模板
- `/skill mafw-plan` 还有一层 `.opencode/skills/mafw-plan/SKILL.md` 指令文本，属注册表外编排材料，本期不动，登记为已知面
- plan/review session 的模型取 opencode 会话默认（session.create 不传 model），模型路由组件**连同 session 创建接线一起做**，列后续增补，不在本期

### 2.3 读取侧改造（优先级链）

`policy.yaml > config.yaml > 代码默认值`。config 已有热重载；policy 层在 `getActivePolicy()` 上扩展为返回完整 bundle，**缓存 + mtime 失效**（goal 节点启动时读一次足够）。

prompt 模板改造：entry.ts 本地 prompt 函数的散文骨架抽到 `prompts/*.md`，代码只做变量插值。**导出后立即删除代码内置全文**，单一数据源；模板缺失/损坏 → 该 goal 节点报错进入 `plan_error` outcome（不静默回退说谎的 builtin 版本——评审 m3：代码演进后内置副本与 builtin-v1 必然漂移，版本标签会说谎）。

### 2.4 baseline 迁移

首次启用把当前生效值原样导出为 `policies/builtin-v1/`，导出后删代码内置 prompt。测试断言：导出瞬间 builtin-v1 渲染输出与删前代码版逐字节一致（一次性迁移测试，非常驻）。

## 3. Evolver（每日 cron）

### 3.1 触发与运行环境

- 规则：`orchestration-evolve`，cron 每日 UTC 4:30（错开 reflect 3:00 / decay 3:30），pipeline-rules.ts 供给
- actionRegistry 注册 `orchestration:evolve`；worker 复用 session-worker-pool（独立 worker，`orchestration-evolver` 角色，workerModel 同 recall.workerModel）
- **per-action 独立 guard**（评审 M9：现有 runPipelineGuarded 是全局布尔，turn-compress 积压会让 evolver 静默缺席）——evolve 用独立锁，skip 后延迟 30min 重试一次
- **成本护栏**（评审 m5）：单次运行 token 预算上限（config.recall.workerModel 同款配额逻辑），运行成本记日志；超限即截断下钻只输出聚合层结论

### 3.2 Evolver 输入（三层证据下钻）

1. **顶层**：近 7 天 goal_outcomes，按 (project_id, policy_version, failure_kind) 分层聚合——PASS 率、平均轮数、平均成本、thumbs 净分
2. **中层**：top 失败聚类（按 failure_signature 分组）的 lessons 与 review 报告反馈文本
3. **底层（按需，配额内）**：单个失败 goal 的 trajectory 摘要（toolErrorCount 高的 turn）

### 3.3 提议生成（GEPA 式反思 + 可证伪契约）

Worker prompt 要求输出 JSON：

```json
{
  "proposals": [{
    "component_diffs": [{"component_id": "review.samematch_threshold", "field": "value", "from": 2, "to": 3}],
    "declared_prediction": "review_false_fail 类占比从 X% 降到 <Y%（窗口：激活后 20 个 goal 或 14 天，先到为准）",
    "rationale": "..."
  }]
}
```

硬约束（代码强制，不靠 prompt 自觉）：
- `component_id` 必须在注册表内且 `evolvablePhase <= 2`；否则整条提议丢弃
- 每次提议最多 **3 个** component_diffs
- prompt 类 diff 以**段落级**操作表达（`replace_section` / `append_section` / `remove_section`），非全文替换
- **去重**（评审 m6）：component_diffs 规范化哈希与历史 proposal 比对，完全相同则跳过；同组件冷却期（上次涉及该组件的 proposal 终态后 3 天内不再提议）
- 无洞察输出空 proposals——"no change" 是合法输出

### 3.4 提议落库

写入 `evolution_proposals`（status=`proposed`），创建 **evolution 类 triage item**（新 type，见 §4.1）。

## 4. 激活、验证、回滚

### 4.1 激活链路（评审 B3：现有 triage confirm 语义是"从模板创建 goal"，不能复用）

- 新增 triage item `type: 'evolution'`；`POST /api/triage/{id}/confirm` 增加按 type 分发：evolution 类 → policy 应用逻辑（生成 `policies/v<n>/` = 当前 active 拷贝 + 应用 diff → 写 active.json → proposal status=`active`），goal 类维持原语义
- `mafw_propose_triage_decision` 维持"仅挂建议"语义不变

### 4.2 变体标记

goal 创建时快照 `{policy_version, proposal_id}`（Phase 1 §3.1 机制）。baseline 的 proposalId 为 NULL。**归档时不重新读 active policy。**

### 4.3 验证（evolver 下次运行时的前置步骤）

1. 找 status=`active` 且满足窗口条件的 proposal：**激活后 outcome 数 ≥ 20 或已满 14 天，先到为准**
2. 统计口径（评审 M8）：
   - 按 project_id 分层报告，不跨项目混算（项目构成漂移会冒充策略效果）
   - 机验仅当变体臂与对照臂（同项目、同窗口期的 baseline outcome）各自 ≥ 最小样本（默认 10）才下结论，否则 `insufficient_data`
   - 占比类预测要求效应量门槛（变化 ≥10pp），不假装 n=20 能检测小效应
3. 达标 → `validated`；显著恶化（PASS 率降 >10pp 或成本升 >30%）→ 自动回滚；不可机验 → `manual_review`
4. **superseded**（评审 M10）：新 proposal 激活时，任何仍处 `active` 且未满窗口的旧 proposal → `superseded`（不再验证，也不计失败）

### 4.4 回滚

- 自动回滚写回上一版本 active.json——**这是"triage 人确认后生效"原则的唯一显式例外**（恶化止损不能等人），回滚后立即生成 triage item 通知人
- 回滚区间已落库的 outcome 保留 proposalId 但在对比查询中排除（验证 SQL 加 `AND proposal_status != 'rolled_back'` 语义，由查询层 join 实现）
- `policies/` 全部版本永久保留（stepping stones）；evolver prompt 携带历史 proposal 终态，避免重复提议

## 5. 循环外保护（不可演化面）

- 注册表 registry.ts 本体、evolver 硬约束校验、triage 分发逻辑、auth/权限模块——不在注册表内，evolver 物理上无法触及
- policy 加载失败 → goal 节点显式报错（不静默回退）；策略层故障转化为 outcome 数据（plan_error），不中断系统

## 6. 测试

- policy 加载：优先级链、mtime 缓存、损坏报错路径
- 提议校验：注册表外拒绝、>3 diff 拒绝、段落级 diff 应用、规范化哈希去重、冷却期
- 迁移测试：builtin-v1 导出与删前代码版逐字节一致（一次性）
- 验证器：达标/恶化/数据不足/superseded 四分支；自动回滚写 active.json + triage 通知；回滚区间排除
- triage 分发：evolution 类 confirm → policy 应用；goal 类 confirm 语义不回归
- cron guard：evolve 独立锁 + 延迟重试

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/orchestration/policy.ts` | 扩展为完整 bundle 加载（缓存+mtime、优先级链） |
| `gateway/src/orchestration/policy-migrate.ts` | 新建：builtin-v1 导出 |
| `gateway/src/orchestration/evolver.ts` | 新建：分层归因 + worker 反思 + 校验/去重/冷却 ~280 行 |
| `gateway/src/orchestration/validator.ts` | 新建：分层统计验证 + superseded/回滚 ~150 行 |
| `gateway/src/core/skills/mafw-plan/entry.ts`、`mafw-review/entry.ts` | prompt 抽模板；收敛 core/tools 漂移副本 |
| `gateway/src/core/langgraph/nodes/review.node.ts` | sameSig 阈值等改读 policy |
| `gateway/src/index.ts`、`chat/graph-runner.ts` | maxRounds 改读 policy；注册 `orchestration:evolve`；triage confirm 按 type 分发 |
| `gateway/src/recall/pipeline-rules.ts` | +evolve cron 规则；per-action guard |
| `tests/unit/gateway/` | +5 个测试文件 |
| `AGENTS.md` | 增补 orchestration 演化系统说明 |

## 8. Phase 2 退出标准

- evolver 在真实数据上产出 ≥1 条合法 proposal，走完 evolution-triage → 激活 → 验证全流程（含一次 validated 或 rolled_back）
- 分层查询能对比 ≥2 个版本：`SELECT project_id, policy_version, verdict, count(*), avg(rounds), avg(total_cost) FROM goal_outcomes GROUP BY 1,2,3`
