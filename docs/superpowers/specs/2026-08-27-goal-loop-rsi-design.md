# Goal 循环 RSI — Artifact 层 + Harness 层演化设计

日期：2026-08-27
状态：待审阅
依赖：Phase 1（观测层）已落地；Phase 2（策略包）spec 已定稿。本 spec 复用 Phase 2 的 proposal/triage/验证/回滚机制，不新建闭环，只扩展**可演化组件面**。

## 1. 目标

把 goal 循环本身纳入演化范围，按风险递增分两层：

- **Artifact 层**（先做）：循环消费/产出的数据形态——charter schema、goal 模板库、分解启发式 skill bank、success criteria playbook。错了只影响单个 goal 质量，循环能自我纠正。
- **Harness 层**（后做）：循环的控制结构——转移规则数据化（低风险跳过 review、failure_kind 决定 replan/abort、自适应并行度）。harness 是演化机制的载体，改错会损坏演化能力本身，需要更强门禁。

业界依据：RSEA（三层 NL 状态 + held-out 门）、ACE（结构化增量更新防 collapse）、EvoHunt（无约束 playbook 演化）、Library Drift（outcome-driven 生命周期）、动态图 survey（schema-constrained rewrites）。

## 2. Artifact 层（Phase 2.5）

### 2.1 可演化组件注册（扩展 ORCHESTRATION_REGISTRY，`evolvablePhase: 2.5`）

| 组件 id | 内容 | 存储 | 演化方式 |
|---|---|---|---|
| `artifact.charter_schema` | Goal charter 的字段结构（当前：objective/boundaries/metrics；可演化出 failure_modes、success_examples、risk_tier 等） | `~/.mafw/orchestration/artifacts/charter-schema.yaml` | 字段级 diff（add_field/remove_field/rename_field） |
| `artifact.goal_templates` | 常见 goal 类型的模板库（bugfix/feature/refactor/research），含 boundaries/metrics 预填 | `artifacts/templates/<name>.yaml` | 模板内容段落级修改；新模板创建；模板退役 |
| `artifact.decompose_heuristics` | 分解启发式 skill bank：从成功 goal 的 waves.json 归纳的分解模式（"UI 任务先骨架后细节"式） | `artifacts/decompose-skills.md`（结构化 bullets） | ACE 式 bullet 增删改，非全文替换 |
| `artifact.success_criteria` | success criteria playbook：分层 criteria 模式（must_pass/should_pass/nice_to_have），按 review 失败模式演化 | `artifacts/criteria-playbook.md` | ACE 式 bullet 增删改 |

### 2.2 消费点接线（演化生效的前提）

| 组件 | 当前消费点 | 改造 |
|---|---|---|
| charter_schema | `mafw_create_goal` MCP handler 的入参校验 | schema 从 artifacts 加载，校验按当前 schema 版本；goal 落库记 `charter_schema_version` |
| goal_templates | 无（现在 goal 全靠 LLM 现场写） | `mafw_create_goal` 增加可选 `template` 参数；manager prompt 注入模板清单摘要 |
| decompose_heuristics | plan 节点 buildPlanPrompt | 作为 `<decompose-guide>` 段注入 plan prompt（policy bundle 的 prompts/plan.md 加插值槽） |
| success_criteria | review 节点 buildReviewPrompt | 作为 `<criteria-guide>` 段注入 review prompt |

消费点缺失时 fail-open（段为空），不阻塞 goal 创建——artifact 层是增强不是依赖。

### 2.3 演化机制（复用 Phase 2 闭环，加三条专属约束）

Evolver 输入增加 artifact 专属证据层：
1. **charter 质量信号**：review 失败中归因于"goal 定义不清"的比例（failure_kind=plan_error / review 报告文本含 scope 争议）
2. **模板命中率**：用模板创建的 goal vs 现场写的 goal 的 PASS 率对比
3. **分解模式聚类**：成功 goal 的 waves.json 结构特征（节点数、波次数、并行度）按 outcome 分桶

专属硬约束（代码强制）：
- **防 collapse**（ACE 教训）：bullets 类 artifact 单次演化净增 ≤5 条、净删 ≤3 条，禁止全文替换 diff
- **schema 演化兼容**：charter_schema 删字段必须两阶段——先标 deprecated（保留写入、校验降级 warn），一个版本后才允许 remove
- **生命周期**（Library Drift 教训）：goal_templates 带 outcome-driven 退役——模板引用 ≥10 次且 PASS 率显著低于无模板臂（>10pp）→ evolver 提议退役；活跃模板数上限 20

### 2.4 验证口径

复用 Phase 2 declared_prediction 机制，artifact 类预测的窗口**按引用次数计**而非按 goal 数（如"使用该模板的后 10 个 goal 中 plan_error 占比降到 <X%"），因为 artifact 只影响引用它的 goal。

## 3. Harness 层（Phase 3.5，数据门槛激活）

### 3.1 激活门槛（硬门，代码强制）

转移规则演化在以下条件**全部满足**前物理禁用（registry 中 `evolvablePhase: 3.5`，evolver 校验拒绝）：
- goal_outcomes 累计 ≥ 50 条且覆盖 ≥ 2 个项目
- failure_kind 分布中最大类占比 < 70%（数据有区分度，单一失败模式说明样本不足）
- Phase 2 机制已完成 ≥1 次 validated 演化（闭环本身被证明可用）

### 3.2 转移规则数据化（前置重构）

把 `index.ts` / graph-runner 中硬编码的状态转移条件抽为 `~/.mafw/orchestration/transition-rules.yaml`：

```yaml
rules:
  - id: skip-review-low-risk
    when: { node_type: execute, risk_tier: low, prior_same_kind_pass_rate_gte: 0.9 }
    then: { transition: "execute -> archive" }        # 跳过 review
    default: disabled                                  # 演化出的规则默认关闭
  - id: failure-routing
    when: { failure_kind: "verify_env" }
    then: { action: abort, not: replan }               # 环境类失败不值得 replan
    default: disabled
```

运行时：状态机代码不变，转移决策点改为"先查 rules（按 id 有序），无命中走硬编码默认"。**硬编码默认是底线，rules 只是覆盖**——数据文件损坏 → 全部走默认，系统行为 = 现状。

### 3.3 可演化转移面（registry `evolvablePhase: 3.5`）

| 组件 id | 演化内容 | 显式排除（不可演化） |
|---|---|---|
| `harness.review_skip` | 哪些节点/条件下跳过 review | verify_env 失败永远不跳 review；PROD 级 goal 永不跳 |
| `harness.failure_routing` | failure_kind → replan/abort/escalate 的路由 | ABORT 触发条件本身（人控面） |
| `harness.parallel_schedule` | wave 内并行度、依赖松驰策略 | 单 goal 并发上限全局值（成本护栏） |
| `harness.node_granularity` | 分解粒度指导（plan prompt 的波次/节点规模建议） | 节点类型集合（PLAN/EXECUTE/REVIEW 是代码级，属 Phase 3） |

### 3.4 更强门禁（相对 Phase 2 的增量）

- **held-out 对照**（RSEA）：转移规则激活后，同项目新 goal 按 4:1 随机分对照臂（rules off）。对照臂标记落 goal_outcomes，验证按两臂对比，不是只比历史 baseline
- **双窗口验证**：短窗（10 个 goal）查显著恶化→自动回滚；长窗（30 个 goal 或 30 天）才允许 validated
- **同时活跃上限**：harness 类活跃 proposal 最多 1 个（转移规则互相干扰无法归因）；artifact/参数类不受此限
- **回滚即时性**：harness 类回滚不等 evolver 下次运行——每次 goal 归档后轻量检查活跃 harness proposal 的恶化条件，命中即回滚

## 4. 与 Phase 2/3 的边界

| 层 | 演化对象 | 机制 | 风险 |
|---|---|---|---|
| Phase 2 | 参数 + prompt 模板 | proposal → triage → active.json | 低 |
| **Phase 2.5（本 spec §2）** | goal artifact 数据 | 同 Phase 2，加防 collapse/生命周期 | 低 |
| **Phase 3.5（本 spec §3）** | 转移规则数据 | 同 Phase 2，加对照臂 + 双窗口 + 单活跃 | 中 |
| Phase 3 | 状态机源码 | worktree 变体 + 分层门禁 | 高 |

转移规则数据化（§3.2）同时是 Phase 3 的**减震器**：大部分"循环结构改进"能在规则数据层表达，不必动状态机代码；Phase 3 只处理真正需要新节点类型/新转移拓扑的演化。

## 5. 不可演化面（循环外保护，追加）

- 转移规则的**求值器代码**、默认转移表、对照臂分流逻辑——不在 registry 内
- charter schema 的**版本兼容层**（deprecated 字段处理代码）
- §3.1 激活门槛的判定代码本身

## 6. 测试

- artifact 加载：缺失 fail-open、损坏报错、charter schema 版本校验与 deprecated 降级
- 防 collapse：bullets 净增/净删上限、全文替换 diff 拒绝
- 模板生命周期：引用计数、低 PASS 退役提议、活跃上限
- charter 两阶段删字段：deprecated → remove 跨版本流程
- 转移规则：规则命中覆盖默认、无命中走默认、损坏文件全默认、对照臂 4:1 分流确定性（按 goal_id 哈希，可复现）
- 激活门槛：50 outcomes/2 项目/failure 分布/1 validated 四条件任一不满足拒绝 harness proposal
- harness 门禁：双窗口、单活跃、归档即检查回滚

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/orchestration/registry.ts` | +artifact 4 组件（phase 2.5）、harness 4 组件（phase 3.5，含门槛元数据） |
| `gateway/src/orchestration/artifacts.ts` | 新建：artifact 加载（fail-open）、bullets diff 应用、schema 版本兼容 ~200 行 |
| `gateway/src/orchestration/transition-rules.ts` | 新建：规则加载/求值/对照臂分流 ~150 行 |
| `gateway/src/orchestration/evolver.ts`（Phase 2 新建） | 扩展：artifact 证据层、防 collapse 校验、模板生命周期、harness 门槛检查 |
| `gateway/src/orchestration/validator.ts`（Phase 2 新建） | 扩展：artifact 引用窗口、对照臂对比、harness 双窗口 |
| `gateway/src/index.ts` | `mafw_create_goal` template 参数 + charter schema 校验接线；转移决策点接 transition-rules |
| `gateway/src/core/langgraph/nodes/plan.node.ts`、`review.node.ts` | 注入 decompose-guide / criteria-guide 段 |
| `gateway/src/index.ts`（归档路径） | harness proposal 归档即检查回滚钩子 |
| `tests/unit/gateway/` | +4 个测试文件 |
| `AGENTS.md` | 增补 §5.20 后小节：artifact/harness 演化面 |

## 8. 退出标准

- **Phase 2.5**：evolver 产出 ≥1 条 artifact 类 proposal 并走完全流程（含一次 bullets 防 collapse 校验拦截的负例测试）；模板退役机制在合成数据上触发一次
- **Phase 3.5**：激活门槛判定在真实 goal_outcomes 上跑通（未达标时正确拒绝）；转移规则对照臂分流在 ≥20 个 goal 上无跑偏（对照臂比例 20%±5%）
