# Goal 工作状态层（Working State Layer）设计

- 日期：2026-08-31
- 状态：草案 v1
- 上游调研：Recuris (2608.24876)、SKILL.state (2608.26263)、GCPC (2608.27487)、LoopArena (2608.28281)、Repair-or-Resample (2608.25920)
- 关联 spec：2026-08-27-goal-loop-rsi-design.md（Phase 2.5/3.5）、2026-08-27-memory-skill-rsi-design.md

## 0. 问题陈述

当前 goal 状态（`.mafw/state/{goalId}.json`）只有**编排进度**（phase/nextAction/loop/wave），
没有**经验证的工作状态**。三个具体缺陷（代码实证）：

1. **覆盖式更新**：`updateState` 是 `{...current, ...patch}` 全值浅合并（state.ts:86-90），
   模型直写、无校验——SKILL.state 实测小模型 68% 的状态错误是覆盖式更新，我们同构
2. **模型自述即完成**：review verdict 的 fallback 是"文本含 pass 即 PASS"（mafw-review/entry.ts:211）；
   `checkMetrics` 指标缺失直接跳过（entry.ts:189 `if (actual === undefined) continue` → 缺指标=通过）
3. **verdict 二值化**：PASS/FAIL 无部分信用——GCPC 实测 879 对二值不变的匹配对中
   20.9% 实质提升、18.7% 实质回退，RSI 演化信号从根上漏 40%

调研的核心收敛结论：**长期记忆（EM）几乎不单独产生收益，收益来自"知道当前处于什么
已验证状态"的工作记忆层**（Recuris 消融 WM-only +23.9 vs EM-only +2.0）。
MAFW 的 EM 半边（谐波记忆）已是强项，本 spec 补 WM 半边。

## 1. 设计原则

1. **提议-提交分离**：模型产出状态补丁提议，gateway 确定性校验后才提交（SKILL.state 纪律）
2. **证据门控**：状态迁移到 `done` 必须挂可解析的证据引用（工具回执/git commit/工件文件），
   模型自述不算数（Recuris checker 纪律）
3. **checklist 冻结先于执行**：验收项在 plan 阶段冻结并 grounding 到 goal 原文，
   防轨迹自适应（GCPC 纪律）
4. **弃权是合法答案**：证据不足判 Abstain 并从分母剔除，不把"不知道"当失败（GCPC 纪律）
5. **加一层不重写**：保留 nextAction 文件轮询协议、原子写、现有 skill entry 流程

## 2. 数据模型

### 2.1 WorkItem（per-subgoal 工作状态条目）

```typescript
// state.ts 扩展
export type WorkItemStatus = 'pending' | 'done' | 'blocked';

export interface EvidenceRef {
  kind: 'receipt' | 'commit' | 'artifact' | 'observation';
  ref: string;              // receipt 文件路径 / commit hash / 工件路径 / t1_observations turnID
  note?: string;            // 一句话说明该证据支持什么
}

export interface WorkItem {
  id: string;               // 来自 plan 阶段 waves.json 的 task id
  content: string;          // 该子目标要做什么（plan 冻结）
  status: WorkItemStatus;
  evidence: EvidenceRef[];  // status=done 时必填且须可解析（见 §3.3）
  blocker?: string;         // status=blocked 时必填
  updatedAt: string;
}

export interface StateFile {
  // ... 现有字段不变 ...
  workItems?: Record<string, WorkItem>;   // 新增；缺失视为"未启用工作状态层"（向后兼容）
  checklist?: ChecklistItem[];            // 新增，见 §4.1
}

export interface ChecklistItem {
  id: string;
  requirement: string;      // 验收要求
  quote: string;            // goal charter 原文逐字引用（grounding，机械校验）
  route: 'assertion' | 'generated' | 'judge';  // 验证路由（GCPC 三分）
}
```

初始化时机：**plan skill entry** 在写完 waves.json 后，把全部 task 转为
`workItems`（status=pending）+ 按 goal charter 生成 `checklist`（见 §4.1），
一次 `updateState` 提交。此后 checklist 冻结（gateway 拒绝运行时修改，见 §3.2）。

### 2.2 与既有层的关系（不重叠）

| 层 | 管什么 | 载体 |
|---|---|---|
| **工作状态层（本 spec）** | 现在进行到哪、什么被证据证实 | state.json `workItems` |
| 编排控制 | 下一步建什么 session | state.json `nextAction`（不动） |
| 谐波记忆（EM） | 过去学到什么、跨 goal 复用 | tier 文件 + index（不动） |
| 观测层 | 失败归因、RSI 信号 | gateway.db `goal_outcomes`（§4.3 扩展字段） |

goal 归档时 workItems 随 state.json 一并归档，不进谐波记忆（值得长期记忆的教训
仍走 review → mafw_add_memory 既有路径）。

## 3. 补丁语义与校验门

### 3.1 新的写路径：`updateStatePatch()`

```typescript
// state.ts 新增；旧 updateState() 保留给编排字段（phase/nextAction/sessions），
// 但 workItems/checklist 只允许走本函数
export interface StatePatch {
  workItems?: Record<string, WorkItemPatch | null>;  // null = 删除该条目
  // WorkItemPatch = Partial<WorkItem>，item 级合并，禁止整表替换
}

export interface PatchResult {
  ok: boolean;
  state?: StateFile;
  errors?: PatchError[];      // 拒绝时返回全部错误（供模型 retry）
}
export interface PatchError {
  itemId: string;
  rule: string;               // 触发的校验规则名
  message: string;
}
```

- **item 级合并**：`workItems: { "task-3": { status: "done", evidence: [...] } }`
  只改 task-3，其他条目不动——杜绝覆盖式整表替换
- **null 删除**：`{ "task-3": null }` 显式删除（SKILL.state 的 null-deletion 语义）
- **原子提交**：全部校验通过才写盘（tmp+rename 沿用）；任一校验失败 → 整个 patch
  拒绝、state 不变、返回 errors——模型收到结构化错误后修正重提（rollback-retry）

### 3.2 确定性校验规则（gateway 侧，无 LLM）

| 规则 | 内容 | 拒绝示例 |
|---|---|---|
| R1 schema | 字段名/类型合法，未知 key 拒绝 | `{ stats: "done" }` 拼写错误 |
| R2 未知条目 | patch 引用的 itemId 必须已存在（plan 初始化集合之外不允许自创） | 执行中凭空新增 task |
| R3 done 需证据 | `status→done` 时 evidence 非空 | 自称完成无证据 |
| R4 证据可解析 | 每条 EvidenceRef 按 kind 确定性解析（见 §3.3） | 伪造 commit hash |
| R5 blocked 需理由 | `status→blocked` 时 blocker 非空 | 无说明的停滞 |
| R6 checklist 冻结 | plan 完成后 checklist 任何字段不可变 | 执行中降低验收标准 |
| R7 状态单调（软） | done → pending/blocked 允许但记录 `reopen` 事件到 metrics | review 打回重开 |

### 3.3 证据解析器（checker，确定性）

| kind | 解析方式 |
|---|---|
| `receipt` | `.mafw/receipts/{goalId}/` 下文件存在且 JSON 可解析 |
| `commit` | `git cat-file -t <hash>` 在 goal worktree 存在（execute 完成后校验） |
| `artifact` | 工件路径存在且 mtime ≥ workItem 进入执行的时间 |
| `observation` | turnID 存在于 gateway.db `t1_observations`（工具真实执行过的回执） |

校验失败即 R4 拒绝。** checker 只看环境/工具事实，不看模型文本**（Recuris：
"调了技能、发了工具调用都不算完成证据；观测不支持 → 保持 pending"）。

### 3.4 MCP 工具面变更

`mafw_update_state` schema 扩展（向后兼容）：

```
{ goalId, patch: { ...编排字段 }, workItemPatch?: Record<string, WorkItemPatch|null> }
```

- `workItemPatch` 走 §3.1–3.3 校验门，拒绝时 ToolResult 携带全部 PatchError
- 旧 `patch` 字段行为不变（编排字段仍由 skill entry 全值更新——这些字段是
  gateway 自己写的，非模型自由文本，风险低）
- 工具描述强化：**禁止**在 patch 里传 workItems 整表

## 4. Verdict 证据化与部分信用

### 4.1 Checklist 生成（plan 阶段，一次冻结）

plan skill entry 增加一步：按 goal charter + requests/{goalId}.json 的
metrics/boundaries 生成 checklist（每 goal 4–15 项，GCPC 实测中位 8）：

1. LLM 生成候选项，每项必须携带 charter **逐字引用**（quote）+ 验证路由
2. **机械校验**（无 LLM）：quote 必须逐字出现在 charter 原文中；
   route=assertion 的项必须指向 requests.metrics 中真实存在的指标
3. 校验不过的项丢弃（不降级为自由文本项）；全部不过 → checklist 为空，
   该 goal 退回旧二值 verdict（fail-open，不阻塞主流程）
4. 写入 state.json 后冻结（R6）

### 4.2 Review 评分（逐项 + 弃权）

review skill entry 的 LLM 调用改为两段式输出：

```json
{
  "items": [
    { "id": "c1", "verdict": "yes" },
    { "id": "c2", "verdict": "no" },
    { "id": "c3", "verdict": "abstain", "reason": "日志中无测试输出" }
  ],
  "verdict": "FAIL",
  "reason": "...",
  "metrics": {...}
}
```

评分纪律（写进 review prompt 且 gateway 侧复核）：
- **只认执行日志/工件证据**：receipts、git diff、远程测试结果；agent 在
  review 文本里的声称不算证据（GCPC 核心规则，防 reward hacking）
- **Abstain 从分母剔除**：证据不足不算失败
- `partial_credit = yes数 / (yes+no数)`；checklist 为空时 partial_credit 缺省

### 4.3 落库与硬门槛

- `goal_outcomes` 表加列：`partial_credit REAL NULL`、`evidence_coverage REAL NULL`
  （可判定项比例 `|yes+no| / |checklist|`——低覆盖说明观测捕获有盲区，
  反馈给 /api/obs/capture 机制）
- **PASS 硬门槛不变**：`verdict==='PASS' && metricsOk && perfect`（无 no 项）才算
  PASS；partial_credit 是软信号，供 RSI Phase 2 演化提议排序，不放宽完成定义
- **废除两个 fallback**：
  - `parseReviewResponse` 文本含 "pass" 即 PASS → 改为解析失败记 `verdict: 'ERROR'`
    （重试一次 review，再失败按 FAIL 处理，永不默认 PASS）
  - `checkMetrics` 指标缺失跳过 → 缺失即 `metricsOk=false`（fail-closed）
    （注：review 未返回某指标与指标不达标同等对待；charter 写明的指标必须被测量）

## 5. 实施分阶段

### Phase A：补丁语义 + 校验门（纯 gateway，无行为变化）

- state.ts：`updateStatePatch()` + R1–R7 校验 + 证据解析器框架
- `mafw_update_state` 加 `workItemPatch` 通道
- 单测：覆盖式更新被拒、拼写错误被拒、非法 EvidenceRef 被拒、null 删除、
  部分拒绝整批回滚
- **门禁**：新测试全绿 + 既有 43 套件无回归 + tsc

### Phase B：workItems 初始化与执行回写

- plan entry：waves → workItems 初始化（status=pending）
- execute entry：每个 task 完成/失败后回写 workItemPatch（done 挂 commit+receipt 证据；
  failed → blocked + blocker）
- review 打回时 R7 reopen（done → pending 记录 metrics.reopen 计数）
- 单测：plan→execute→review 全链状态机；证据解析器三种 kind
- 旧 state.json 无 workItems 字段 → 跳过工作状态层（向后兼容，新 goal 才启用）

### Phase C：verdict 证据化 + partial_credit

- checklist 生成 + 机械校验（plan entry）
- review 两段式输出 + 逐项评分 + Abstain
- 废除两个 fallback（改默认 PASS 为默认 ERROR/FAIL）——**这是行为变更**，
  需在 AGENTS.md 与 review prompt 同步声明
- gateway.db 迁移：goal_outcomes 加两列（ALTER TABLE，幂等）
- 单测：checklist 机械校验（伪造 quote 拒收）、partial_credit 计算、
  Abstain 剔出分母、缺失指标 fail-closed、解析失败不默认 PASS

### 依赖与排序理由

A 先行（校验门是 B/C 的基础设施）；B 独立于 C 可并行；C 依赖 A 的校验框架
做 checklist 机械校验复用。**C 的 fallback 废除可单独拆出紧急合入**——
"文本含 pass 即 PASS"是现存正确性 bug，不必等全链路。

## 6. 验证口径（沿用 RSI 纪律）

1. **事前 declared_prediction**：Phase B 上线前声明预期——
   "execute→review 间因状态不明导致的 review 打回率下降 ≥20%"
2. **对照**：同项目分层，新旧 goal 各 n≥10（新 goal 启用 workItems，
   旧 goal 为对照臂——天然成立，因为旧 state.json 无该字段）
3. **预算匹配**：对比时必须控制模型/预算相同（SKILL.state 同预算对照纪律——
   证明收益来自状态层而非 context 更短）
4. **失败归因**：review 打回的 case 记录是"证据不足被拒"（校验门拦住）
   还是"真实未完成"——前者多说明证据解析器太严，需调 kind 白名单

## 7. 非目标（本期不做）

- 不改 nextAction 文件轮询协议与 scheduler（编排控制面不动）
- 不做 live steering（PILOT 式执行中介入）——独立 spec
- 不做失败锚点重放（Repair-or-Resample）——独立 spec，但 R7 reopen 事件
  为其预留了定位锚点（workItem 级）
- 不做 call-time recall（Recuris ρ）——属记忆检索侧，memory-skill spec 范畴
- workItems 不进谐波记忆、不参与 BM25 索引（WM 与 EM 分层，防角色混淆）

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 弱模型写不出合法 patch（LoopArena 实测 10% 结构化输出打满上限） | PatchResult 返回全部错误供重试；统计 patch 拒绝率作为 manager 协议失败率新指标；拒绝率 >30% 时降级回旧路径并告警 |
| 证据解析器太严导致 done 永远提交不了 | R4 失败的 errors 明确写出解析方式；observation kind 兜底（t1_observations 全量捕获） |
| checklist 生成质量差 | 机械校验兜底（quote 逐字匹配）；全废则 fail-open 回旧 verdict |
| 废除 fallback 后 FAIL 率虚升 | 视为修正而非回退——此前部分 PASS 本就是假的；验证口径 §6.1 的预测应声明此效应 |
| workItems 与 receipts 双写不一致 | workItems 只存状态+引用，内容仍在 receipts（单一内容源，状态层只是索引） |
