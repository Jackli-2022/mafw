# Goal 工作状态层（Working State Layer）设计 v2

- 日期：2026-08-31（v2 评审修订）
- 状态：草案 v2（评审后：3 BLOCKER + 7 MAJOR + 6 minor 全部修正）
- 上游调研：Recuris (2608.24876)、SKILL.state (2608.26263)、GCPC (2608.27487)、LoopArena (2608.28281)、Repair-or-Resample (2608.25920)
- 关联 spec：2026-08-27-goal-loop-rsi-design.md、2026-08-27-memory-skill-rsi-design.md

## v1 → v2 修订说明

v1 在 **legacy 代码地图**上做的设计，评审发现三个地基性错误：

1. **活跃编排面是 LangGraph nodes，不是 skill entry**：`core/skills/mafw-*/entry.ts` 在
   gateway/src 内零调用方；活跃链路是 `index.ts` → `plan.node.ts` / `node-runner.ts`
   创建 opencode 会话并 prompt `/skill mafw-{plan,execute,review}`，真正执行的是
   `.opencode/skills/mafw-*/SKILL.md` 驱动的 agentic 会话
2. **state.json 的真实写主是 sync.node**：`syncToDashboard`（sync.node.ts:23-44）用
   固定字段集整体覆盖写盘，每个 node 进出时调用——v1 新增的 workItems/checklist
   会在第一个 phase 转换就被静默抹掉（今天它已经在丢弃 sessions/artifacts/metrics）
3. **"文本含 pass 即 PASS"在活跃路径 100% 命中**：活跃 review agent 写自由 markdown，
   `parseReviewVerdict` 的 JSON.parse 必败 → 每个 verdict 都走文本 fallback
   （review.node.ts:33-35 + node-runner.ts 重复一份），且 "did not pass" 也误判 PASS。
   这不是边缘 fallback，是生产环境当前的真实正确性 bug

v2 全部机制重新锚定到 LangGraph nodes + SKILL.md + 活跃 MCP handler。

## 0. 问题陈述

1. **覆盖式更新**：活跃 MCP handler（handlers/update-state.ts:15）`{...state, ...patch}`
   全值浅合并、接受任意 key——SKILL.state 实测 68% 状态错误来自此类更新
2. **模型自述即完成（活跃 bug）**：review verdict 由"review 文件文本含 pass/通过"判定
   （review.node.ts:34），"did not pass" 同样命中；requests.metrics 在活跃路径
   **从不参与判定**（比"缺指标跳过"更糟——指标零检查）
3. **verdict 二值化**：无 partial_credit——GCPC 实测二值不变的匹配对中 20.9% 实质
   提升、18.7% 实质回退，RSI 演化信号从根上漏 40%

核心论据不变：**收益来自"知道当前处于什么已验证状态"的工作记忆层**
（Recuris WM-only +23.9 vs EM-only +2.0）。

## 1. 架构落点（v2 全部修正）

```
活跃编排：index.ts scheduler → LangGraph nodes（plan.node / execute via node-runner / review.node）
                                    │  每个 node 进出时 syncToFile → syncToDashboard 写 state.json
真实执行：opencode agentic 会话（SKILL.md 驱动，full 权限，可调 MCP/bash/edit）
控制接口：mafw_update_state MCP handler（handlers/update-state.ts）
观测：gateway.db（goal_outcomes / goal_sessions / t1_observations）
```

工作状态层的写入必须贯穿全部三条路径（MCP 校验门、node 边界 reconcile、
syncToDashboard 保留字段），单一防线必然被绕过。

## 2. 数据模型

### 2.1 WorkItem / Checklist（state.json 扩展字段）

```typescript
export type WorkItemStatus = 'pending' | 'done' | 'blocked';

export interface EvidenceRef {
  kind: 'commit' | 'observation' | 'receipt';
  ref: string;    // commit: hash；observation: "sessionID:turnID" 复合引用；
                  // receipt: receipts 目录下文件名（仅 wave 末/会话末可验，见 §3.3）
  note?: string;
}

export interface WorkItem {
  id: string;               // 来自本 loop waves.json 的 task id
  content: string;
  status: WorkItemStatus;
  evidence: EvidenceRef[];  // status=done 必填且可解析
  blocker?: string;         // status=blocked 必填
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  requirement: string;
  quote: string;            // goal charter 原文逐字引用（机械校验 grounding）
  route: 'assertion' | 'generated' | 'judge';
}

// state.json 新增顶层字段（syncToDashboard 必须保留，见 §3.1）：
//   workItems?: Record<string, WorkItem>
//   checklist?: ChecklistItem[]
//   reviewPartialCredit?: number | null   （review.node 写入，供 outcome 透传，见 §5）
```

**Loop 生命周期语义（v2 新增，修 M4）**：
- workItems 是 **per-loop** 的；plan.node 每轮重新生成 waves → 全新 task id 集合
- **plan-init 是豁免 R2 的 replace-set 原语**（§3.2 R0b）：仅 plan.node 边界允许
  整表替换 workItems + checklist；旧集合不保留在 state.json（历史在 reviews/
  receipts 工件中可溯），但替换时把上一轮 done 计数写入 `metrics.workDoneHistory[]`
- **删除 v1 的 R7 reopen**：现有架构 FAIL 后整轮重新 plan，reopen 永不触发；
  旧 workItems 作为 re-plan 的输入上下文（done 的不重做）由 SKILL.md 提示词承载

### 2.2 与既有层的关系（不重叠）

| 层 | 管什么 | 载体 |
|---|---|---|
| 工作状态层（本 spec） | 本 loop 进行到哪、什么被证据证实 | state.json workItems |
| 编排控制 | 下一步建什么 session | LoopState + syncToDashboard（不动协议） |
| 谐波记忆（EM） | 跨 goal 学到的长期经验 | tier 文件（不动） |
| 观测层 | 失败归因、RSI 信号 | gateway.db（§5 扩展） |

## 3. 三条写路径的防线

### 3.1 防线一：syncToDashboard 保留字段（修 B1，前置一切）

sync.node.ts 改为 **load-modify-write**：

```typescript
const existing = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf-8')) : {};
const dashboardState = {
  ...existing,              // 保留 workItems/checklist/metrics/sessions 等未知字段
  version: '2', goalId: state.goalId, loop: state.round, /* ...受控字段覆盖... */
  updatedAt: new Date().toISOString(),
};
```

同时把 `reviewPartialCredit`（LoopState 新字段）纳入受控字段集。
**这是整个 spec 的前置修复**——不做它，其余全部白做。
顺带修复存量 bug：sessions/artifacts/metrics 今天就在被抹掉（评审 minor 5）。

### 3.2 防线二：MCP handler 校验门（修 M1/M2）

handler（handlers/update-state.ts）改为调用共享模块
`gateway/src/core/state/work-state.ts`（新文件，node reconcile 复用同一实现）：

```
mafw_update_state { goalId, patch?, workItemPatch? }
```

| 规则 | 内容 |
|---|---|
| **R0** | `patch` 顶层出现 `workItems`/`checklist` 键 → **硬拒绝**（修 M2：不只是工具描述劝退） |
| **R0b** | workItems 整表替换（replace-set）仅当调用上下文为 plan-init（handler 参数 `planInit: true`，仅 plan SKILL 被告知可用） |
| R1 | workItemPatch 字段名/类型合法，未知 key 拒绝 |
| R2 | 非 plan-init 时 itemId 必须已存在 |
| R3 | status→done 时 evidence 非空 |
| R4 | 每条 EvidenceRef 按 kind 确定性解析（§3.3） |
| R5 | status→blocked 时 blocker 非空 |
| R6 | checklist 在 plan-init 之后任何字段不可变 |

全过才原子提交（tmp+rename）；任一失败 → 整批拒绝，ToolResult 携带全部
PatchError（itemId/rule/message）供模型修正重提。

### 3.3 证据解析器（修 B3：按写回时序分层）

| kind | 解析方式 | 可用时机 |
|---|---|---|
| `commit` | `git cat-file -t <hash>`（goal worktree 内） | task 级回写立即可用（execute agent 先 commit 再回写） |
| `observation` | `sessionID:turnID` 复合引用，gateway.db t1_observations 存在该工具回执（修 minor 3：turnID per-session 自增，必须复合） | task 级回写立即可用 |
| `receipt` | `.mafw/receipts/{goalId}/` 文件存在且可解析 | **仅 wave 末/会话末**（writeReceipts 在全部 wave 完成后才执行——per-task done 挂 receipt 必被 R4 卡死，v1 自相矛盾点） |

**不变式**（修 minor 4）：证据校验发生在 worktree 存续期（execute 会话内 +
review 会话内，归档之前）；归档后 workItems 随 state.json 冻结，不再重验。
SKILL.md（mafw-execute）相应修改：每 task 完成 = git commit → workItemPatch
（commit/observation 证据）；receipt 证据只允许在会话末批量补验时使用。

### 3.4 防线三：node 边界 reconcile（修 M3，承认门非密闭）

agent 会话是 full 权限 opencode session，可用 bash/edit 直写 state.json 绕过 MCP
（SKILL.md 今天就在指示"显式更新 state.json"）。校验门无法密闭，因此：

- plan.node / review.node **进入时**调用 work-state.ts 的 `reconcileWorkItems()`：
  重跑 R1–R6 只读校验；非法条目**隔离**（移入 `state.quarantinedWorkItems` +
  log.warn + 记 metrics.reconcileViolations），不阻断编排
- SKILL.md 三个技能文件改为统一指示："经 `mafw_update_state` 的 workItemPatch
  更新工作状态；**禁止**直接编辑 state.json"
- reconcile 违规率是新观测指标——高违规率说明 SKILL.md 引导失效或模型不守约

## 4. Verdict 证据化与部分信用

### 4.1 Review 报告文件格式 v2（修 M6：改的是文件格式，不是 LLM 响应）

活跃解析链读的是 `reviews/{goalId}-loop{n}.md` 的**文件内容**。v2 规定
SKILL.md（mafw-review）产出格式：

````markdown
# Review Report — loop {n}

```mafw-review
{
  "items": [
    { "id": "c1", "verdict": "yes" },
    { "id": "c2", "verdict": "no" },
    { "id": "c3", "verdict": "abstain", "reason": "日志中无测试输出" }
  ],
  "verdict": "FAIL",
  "reason": "...",
  "metrics": { "tests_pass": 1 }
}
```

（自由文本理由附后，供人读）
````

- **解析器共享**：`parseReviewVerdict` 当前在 review.node.ts:25-37 和
  node-runner.ts:41 **重复两份**——抽取为 `core/langgraph/review-parser.ts` 单一实现，
  两处改 import（顺带消灭重复）
- **解析规则 v2**：提取 ```` ```mafw-review ```` 围栏块 → JSON.parse → 逐项校验
  （item id 必须属于冻结 checklist、verdict ∈ yes/no/abstain）；
  **围栏块缺失/非法 → verdict: 'ERROR'**（复用现有 ERROR 型）
- **废除文本 fallback**：删除 "含 pass/通过 → PASS" 分支（两处）。这是活跃正确性
  bug，按 §7 单独紧急合入，不等全链路
- ERROR 的编排语义：等同 FAIL 处理（触发重试/计数），连续 2 次 ERROR →
  pendingQuestion 问用户（复用 sameSig 提问通道）

### 4.2 Checklist 生成与冻结（plan 阶段）

plan.node 完成后（waves 入库、workItems 初始化的同一 plan-init 原语内）：

1. plan SKILL.md 指示 agent 按 charter + requests metrics/boundaries 生成
   4–15 项 checklist（GCPC 中位 8），每项带 quote + route
2. gateway 机械校验（plan.node 边界，确定性）：quote 逐字出现在 charter 原文；
   route=assertion 的项指向 requests.metrics 真实存在的指标
3. 校验不过的项丢弃；全废 → checklist 为空，该 goal 退回二值 verdict（fail-open）
4. 提交后冻结（R6）

### 4.3 评分纪律与 fail-closed

- **assertion 项由 gateway 确定性判定**：review.node 解析 metrics JSON 块，
  对 route=assertion 项直接比对 requests.metrics target；**指标缺失 = no**
  （fail-closed，修"指标从不参与判定"的活跃缺陷）
- generated/judge 项取 agent 逐项判定，但 prompt 纪律：**只认 receipts/diff/
  测试结果等日志证据，agent 自述不算**；Abstain 从分母剔除
- `partial_credit = yes / (yes + no)`；checklist 为空时缺省
- `evidence_coverage = (yes + no) / |checklist|`——低覆盖说明观测捕获有盲区
- **PASS 硬门槛**：`verdict==='PASS'` 且无 no 项（Perfect 伴随指标）；
  partial_credit 是 RSI 软信号，不放宽完成定义

## 5. 写入链（修 M5：加了列也要有数据流）

```
review.node 计算 partial_credit + evidence_coverage
  → LoopState.reviewPartialCredit（新字段）
  → syncToDashboard 受控字段集（§3.1 保留）
  → archiveGoal 时 outcome-recorder.ts 从 state.json 读取
  → upsertGoalOutcome 显式列清单 + ON CONFLICT 同步扩展（gateway-db.ts:450-469）
  → goal_outcomes 加列：partial_credit REAL NULL、evidence_coverage REAL NULL
    （ALTER TABLE 幂等迁移，gateway-db.ts:219-238 有先例）
```

**per-round 观测（修 M7）**：新建 `goal_rounds` 表
（goal_id, loop, verdict, partial_credit, evidence_coverage, same_sig, created_at，
PK(goal_id, loop)），review.node 每轮写入——goal_outcomes 每 goal 仅一行
（archive 时写），per-loop 失败今天无任何记录（handleLoopEvent 是 stub），
没有 goal_rounds 则 §6 验证口径无数据源。

## 6. 实施分阶段

### Phase 0（紧急，独立小 PR）：废除文本 fallback

- 抽取 review-parser.ts 单一实现；删除两处 "含 pass → PASS"；
  无 JSON → verdict ERROR（ERROR 语义已存在于 graph 条件边，行为变化最小化：
  ERROR 按 FAIL 路径走，不新增分支）
- 单测："did not pass" → 不再判 PASS；空文件 → ERROR；合法 JSON → 正常
- **理由**：这是生产环境当前 100% 命中的误判源，不应等全链路

### Phase A：写路径三防线

- syncToDashboard 改 load-modify-write（含 sessions/metrics 存量抹除的顺带修复）
- work-state.ts 共享模块（R0–R6 + 证据解析器 + reconcile）
- handler 接线 + R0 硬拒绝；SKILL.md 三技能改"禁止直写 state.json"
- 单测：覆盖式更新被拒、plan-init 豁免、非法证据被拒、reconcile 隔离
- 门禁：新测试全绿 + 既有 43 套件无回归 + tsc

### Phase B：workItems 全链路

- plan.node 边界：waves → workItems 初始化（plan-init 原语，含 workDoneHistory 滚动）
- mafw-execute SKILL.md：每 task commit 后 workItemPatch 回写
- plan.node/review.node 进入时 reconcile
- 单测：plan→execute→review→FAIL→re-plan 全链状态机；loop 边界 replace-set
- 旧 state.json 无 workItems → 跳过工作状态层（向后兼容，仅新 goal 启用）

### Phase C：verdict 证据化 + 观测埋点

- review 文件格式 v2 + SKILL.md 改造 + checklist 生成/机械校验
- goal_rounds 表 + goal_outcomes 加列 + 写入链全通
- 单测：quote 伪造拒收、assertion 项指标缺失判 no、Abstain 剔出分母、
  partial_credit 计算、ERROR 连续 2 次触发 pendingQuestion

依赖：Phase 0 独立；A 是 B/C 的前置；B、C 可并行。

## 7. 验证口径（修 M7：指标可测量化）

1. **declared_prediction**（Phase B 上线前声明）：
   "启用 workItems 的 goal，每 goal 平均 rounds 数下降 ≥15%，
   且 per-round FAIL 率（goal_rounds 表）下降 ≥20%"
2. **对照口径声明**：新旧 goal 分层非同任务随机分组，存在选择偏差——
   结论表述为分层观测而非因果；若信号模糊，升级为同任务对（workItems 开/关）
3. **预算匹配**：对比控制模型/maxRounds 相同（SKILL.state 同预算纪律）
4. **归因分流**：review FAIL 记录是 reconcile 违规（门拦住非法状态）还是真实
   未完成——前者多说明证据解析器太严，调 kind 白名单

## 8. 非目标（本期不做）

- 不改 LoopState/graph 边/nextAction 轮询协议
- 不做 live steering、失败锚点重放（独立 spec；workItems 为其预留 item 级定位粒度）
- 不做 call-time recall（memory-skill spec 范畴）
- legacy skill entry（core/skills/mafw-*/entry.ts）不改造不删除——另行决定
  （评审 minor 6 顺带发现 mafw-plan/entry.ts:100 `(loadState as any)?.loop` 恒
  undefined → reflection 注入从未生效，legacy 描述与实际不符，记录备查）
- workItems 不进谐波记忆、不参与 BM25 索引

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 弱模型写不出合法 patch/review JSON（LoopArena 实测 10% 输出打满上限） | patch 拒绝返回全部错误供重试；patch 拒绝率、review ERROR 率作为新观测指标；拒绝率 >30% 降级回旧路径并告警 |
| 防线非密闭（agent bash 直写） | 承认 advisory 本质；node reconcile 隔离+违规率观测；SKILL.md 统一引导 |
| 证据解析器太严 done 提交不了 | commit/observation 双 kind 兜底（commit 在 execute 内立即可用）；R4 错误信息写明解析方式 |
| Phase 0 后 FAIL/ERROR 率虚升 | 视为修正——此前部分 PASS 是误判（"did not pass"→PASS 反向 bug 同时消除，FAIL 率升降皆有可能，以 ERROR 率单独观测解析失败） |
| workItems 与 receipts 双写不一致 | workItems 只存状态+引用，内容仍在 receipts（单一内容源） |
| plan-init 被滥用绕过 R2 | `planInit: true` 仅写入 plan SKILL.md，不进通用工具描述；reconcile 对非 plan 边界的整表替换记违规 |
