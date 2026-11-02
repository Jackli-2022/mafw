# Pod 协作式 Goal Loop：Lead / Tech Lead / Builder / Reviewer

- 日期：2026-11-02
- 状态：**已实施（2026-11-03，Tasks 1-22 完成）**；plan `docs/superpowers/plans/2026-11-02-pod-collaborative-goal-loop.md`，实施 commits `4c5275d6..332a319a` + Task 22 验证提交。端到端验证 `gateway/tests/integration/pod-collaboration-loop.test.ts`（direct Goal→Tech Lead→Probe→Plan/Eval→批准→实施→Review PASS→结果→打回→revision 2 + 迁移检查）。未部署、未发版。
- 前置调研：
  - `docs/research/2026-11-02-dsh-superagent-pod-v3-review.md`
  - `docs/research/2026-11-02-pod-lead-tech-lead-workflow-survey.md`
- 现有基础：`docs/superpowers/specs/2026-11-02-pod-v3-goal-attention-design.md`

## 1. 意图与为什么

当前 Pod 已能创建 Goal、执行 plan→execute→review、展示结果和处理人类 attention，但一件工作的前半段仍然断裂：

- 用户与 Agent 的技术讨论发生在普通聊天里；
- 用户的方向裁定没有成为 Goal 的正式事实；
- plan 节点更像一次性计划生成器，而不是可持续讨论的 Tech Lead；
- Goal acceptance 存在，但缺少独立的 Goal Eval 设计与 Goal 级验收；
- 完成后缺少“通知用户→用户打回→同一 Goal 继续讨论”的完整循环；
- Lead/Manager 仍以 Session 形式暴露，用户需要理解底层运行资源。

目标体验是：

> **用户表达观点 → Tech Lead 调研并与用户讨论 → 用户裁定 → Tech Lead 制定 Plan 与 Goal Eval → 用户批准 → Builder 实施 → Reviewer 验收 → Lead 通知结果 → 用户可打回并在同一 Goal 中继续。**

Session 是底层实现细节，不是用户需要管理的对象。

---

## 2. 用户已经确定的方向

1. Lead 替换现有 Manager，不再保留两个项目级协调角色；
2. Lead 是整个项目持续存在、统一对人的角色，用户不手动管理 Lead Session；
3. Lead 不做实质技术讨论，识别工作意图后直接建立 Goal，并引导用户进入 Tech Lead；
4. Tech Lead 负责调研、技术讨论、方向建议、Plan 与 Goal Eval；
5. Tech Lead 在不同 Goal 间的讨论上下文完全隔离；同一 Goal 的不同 revision 延续技术上下文；
6. Builder 可在规划期执行 Spike/探针，并在批准后正式实施；
7. Spike 的主要作用是让 Tech Lead 看清技术事实并形成详细计划；
8. 默认使用“Spike→正式 Plan/Goal Eval→用户批准→实施”的两段式授权；
9. 仅在假设、分支和失效条件明确时，允许一次批准 Spike→实施的条件式全链计划；
10. Reviewer PASS 后 Goal 报完成并通知用户，不强制用户再点一次验收；
11. 用户可打回，在同一 Goal 下开启新 revision，并先与 Tech Lead 讨论；
12. 打回 Goal 优先于其他 queued Goal；
13. Lead 决定为 Worker 拼装哪些上下文；跨 Goal 信息必须显式选入；
14. 任务、Goal、Eval、Spike 和交接以 Pod 文件产物保存，在节点 prompt 中显式携带；现有记忆系统正常检索，不自动保存任务状态；
15. ProbeRequest/ProbeReport 可使用 A2A 传输，但 Pod 文件产物仍是权威；
16. DIRECTION_REVIEW 只在存在方向选择、重大取舍或范围分歧时触发；用户已经把方向说清楚时直接记录决定，不增加一次确认。

---

## 3. 角色模型

| 角色 | 固定范围 | 责任 | 明确不负责 |
|---|---|---|---|
| Lead | 整个项目 | 接收意图、直接建 Goal、路由、上下文分配、状态与结果通知、打回接入 | 技术方案讨论、正式实施、独立验收 |
| Tech Lead | 项目级角色；每 Goal 隔离上下文 | 调研、追问、方案比较、技术判断、Spike 委托、Plan、Goal Eval、打回讨论 | 默认不直接实施，不自评 Goal |
| Builder | 每个 ProbeRequest / 实施 Assignment | 安全执行 Spike、提交证据、按批准计划实施 | 自行改变方向、Plan 或 Eval，自我验收 |
| Reviewer | 每 Goal revision 独立上下文 | 按 Goal Eval、任务 acceptance 和真实证据独立验收 | 修改实现、替 Builder 自圆其说 |

Pod roster 固定为 **Lead / Tech Lead / Builder / Reviewer 四个角色成员**。每 Goal、每 Assignment、每 revision 的 Session 是这些成员的隐藏运行上下文，不额外创建 roster 成员。Pod 消息按角色成员寻址，再由 Session Supervisor 映射到当前作用域。

Tech Lead 可以直接读代码、检索项目和查资料；需要运行命令、写实验或执行其他有副作用的技术验证时，委托 Builder Spike。

### 3.1 Lead 替换 Manager

- 用户界面、Pod roster 和新文档只使用 Lead，不再出现 Manager 角色；
- 现有 per-project Manager Session、身份注入、恢复和快照设施可以复用为 Lead 的隐藏实现；
- 现有 Manager Session 可以被 Lead 收养以保留连续性，但不作为用户需要理解或管理的对象；
- 兼容 API/存储字段可暂时保留旧名，必须在设计中标记 deprecated/internal，不能形成第二个协调身份。

### 3.2 Lead 的“持续存在”

持续存在指项目身份、职责、状态和记忆连续，而不是同一进程永不退出：

- 有事件时自动唤醒；
- 无事件时休眠，不持续调用模型；
- 底层 Session 自动压缩、轮换、恢复或重建；
- 用户没有新建、切换、选择或 rotate Lead Session 的入口。

---

## 4. 用户入口与页面关系

### 4.1 Lead 聊天页

用户表达工作意图后，Lead 直接建立 Goal，不要求先确认“是否变成工作”。

Lead 的回应是路由与建议，例如：

```text
已建立 Goal：「……」
建议先与 Tech Lead 讨论方向和实现方式。
[进入 Tech Lead 讨论]
```

Lead 不在这里展开技术方案讨论。项目状态、队列和结果通知仍由 Lead 负责。

默认一次工作意图建立一个 Goal；一句话含多个独立工作时，也先建立一个讨论入口，由 Tech Lead 在讨论中建议拆分，必要时进入按需方向裁定。误建或用户放弃的 Goal 标记 `discarded`，不计 FAIL、不产生执行 outcome，但保留最小审计记录。

### 4.2 Tech Lead 页面

点击卡片进入该 Goal 的 Tech Lead 页面。页面按 Goal 组织，而不是按 runtime Session 组织。

主要区域：

- 当前 Goal、revision、阶段和下一步；
- 用户与 Tech Lead 的讨论流；
- 调研报告、候选方向与风险；
- 用户的 Direction Decision；
- Spike/ProbeReport 与未验证假设；
- Plan 与 Goal Eval；
- 计划批准、驳回和打回入口。

用户不需要知道页面背后创建过多少 Session。

---

## 5. Goal 生命周期

```text
INTAKE（Lead）
  识别工作意图、直接建 Goal、分配 Tech Lead 上下文
        ↓
DISCUSSING（Tech Lead）
  调研、追问、方案比较；必要时委托 Builder Spike
        ↓
DIRECTION_REVIEW（用户，按需）
  有方向分歧时等待裁定；方向明确时直接记录 Direction Decision
        ↓
PLANNING（Tech Lead）
  形成 Plan + Goal Eval；可包含规划期 Spike
        ↓
PLAN_REVIEW（用户）
  批准或批注驳回；批准绑定具体内容版本
        ↓
IMPLEMENTING（Builder）
  按批准计划实施，提交 Receipt 与证据
        ↓
REVIEWING（Reviewer）
  独立按 Goal Eval 与任务 acceptance 验收
        ↓
COMPLETED / RESULT_NOTIFIED（Lead → 用户）
  报完成并通知查看结果，不强制用户再点验收
        │
        ├─ 无打回：保持完成
        │
        └─ 打回：同一 Goal 开启下一 revision
                  回到 DISCUSSING（Tech Lead）
                  后续实施优先于其他 queued Goal
```

### 5.1 方向讨论与按需裁定

- Tech Lead 的调研与讨论产物必须标明：已确认事实、候选方向、未验证假设和需要用户决定的分歧；
- 只有存在方向选择、重大架构/成本取舍或范围分歧时，Tech Lead 才提交 `DirectionReviewRequest`，Goal 进入持久的人类 attention；
- 用户已经把方向说清楚时，Tech Lead 直接记录决定并进入 PLANNING，不增加一次确认点击；
- 用户始终可以用自然语言裁定；系统追加保存结构化 `DirectionDecision`，可包含选中方向 id、用户原话、理由和来源消息，但不强迫用户从固定选项中选择；
- DirectionDecision 进入后续 Plan/GoalEval 的权威输入；语义是否一致由 Tech Lead 说明、用户在 Plan Review 中把关，代码不假装理解自然语言语义。

### 5.2 草稿与执行授权

- Goal 从讨论开始即存在，但讨论/规划态没有正式实施授权；
- 未经适用批准路径，Builder 不得正式实施；
- 讨论、规划和结果查看不应伪装成执行失败或执行 round；
- 用户可以放弃草稿，记录为 discarded，而不是 FAIL。

### 5.3 三类计数必须分开

- `revision`：用户打回后开启的一次完整交付循环；
- `round`：某 revision 内 plan→implement→review 的自主修复轮次；
- `attempt`：节点因技术失败产生的重试。

打回增加 revision，不得通过复用 round/attempt 混淆审计语义。

---

## 6. Spike / 技术验证

### 6.1 目的

Spike 用于消除关键技术不确定性，让 Tech Lead 能形成可信、详细的 Plan。主要产物是证据，不是可保留代码。

### 6.2 委托与报告

Tech Lead 生成 `ProbeRequest`：

- 要回答的问题；
- 当前假设；
- 允许的动作与范围；
- 时间/成本预算；
- 需要的证据；
- 对哪个方案、Plan 断言或 Eval 方法有影响。

Builder 返回 `ProbeReport`：

- 实际环境；
- 实际执行的命令/操作；
- 关键输出与复现步骤；
- 结论：支持 / 否定 / 尚不能判断；
- 仍存在的假设；
- 对 Plan 或 Goal Eval 的具体影响。

ProbeRequest/ProbeReport 可经 A2A 传递；写入 Pod 文件后才作为后续节点的权威输入。

### 6.3 默认模式 A：两段式

```text
ProbeRequest → Builder Spike → ProbeReport
  → Tech Lead 正式 Plan + Goal Eval
  → 用户批准
  → Builder 正式实施
```

适用于路线不清、风险高或 Spike 可能改变方案的 Goal。

安全、只读、隔离的 Spike 默认不单独打扰用户；高风险或越界 Spike 仍走人工审批。该默认值是本文的设计选择，用户可在 spec 审阅时修改。

### 6.4 可选模式 B：条件式全链批准

Tech Lead 在 Spike 前提交完整计划，必须包含：

- Spike 的目的和范围；
- 预期分支与对应实施路线；
- 后续实施步骤；
- Plan 与 Goal Eval；
- 可机械判断的继续条件和失效条件。

用户批准后：

- Spike 结果落在已批准假设、范围和成本内，才允许继续；
- 假设被否定、范围扩大、成本超限、Plan/Eval 实质变化时，旧批准自动失效；
- 失效后回到 Tech Lead 讨论/规划，并重新提交批准。

模式 B 不得被实现为“一次批准后无论发现什么都继续”。

### 6.5 隔离与安全

- Spike 默认在独立临时目录/worktree；
- 不修改主工作区；
- Spike 代码默认可丢弃，不混入正式实施 diff；
- 凭据、生产数据、联网和主工作区写入默认关闭，越界需显式批准；
- ProbeReport 写入前脱敏；
- Spike 有数量、时长和成本上限；
- ProbeRequest 的允许路径、命令类别、网络、凭据和预算必须是机器可读字段，不能只用自然语言约束；
- 审批策略在范围内可按身份自动放行，越界必须转人工；内部 Session 身份不得成为越过 ProbeRequest 范围的豁免；
- Spike 不占正式实施槽，但进入独立、受限的 Probe 调度队列；本批默认每 Pod 同时最多一个 Spike，避免与正式实施无限争抢资源。

---

## 7. Plan 与 Goal Eval

### 7.1 Tech Lead 同时设计两者

Plan 回答“怎样做”，Goal Eval 回答“怎样证明做对了”。两者都是计划审阅的一等产物。

`GoalEval` 至少包含：

- 目标结果与范围；
- 必须满足的整体验收条件；
- 每项条件需要的证据和验证方法；
- 明确的失败条件；
- 约束与非目标；
- Goal 条件到 waves task、Spike 和 artifact 的证据映射。

Goal Eval 是独立逻辑产物和独立 schema，但与 waves/Plan 组成同一个版本化 `PlanPackage`，使用同一内容 hash 提交批准，避免两份文件版本漂移。具体物理文件布局留给实现者。

### 7.2 Goal Eval 与任务 acceptance 不重复

- Goal Eval 判断用户托付的整体结果；
- 任务 acceptance 判断单个计划步骤；
- 所有任务完成不能自动推导 Goal PASS；
- 任一必需 Goal 条件失败或缺证据，Goal 不得 PASS；
- Reviewer 必须输出 Goal 级聚合判定和逐任务 rubric。

这条必须由代码强制，而不是只靠 Reviewer prompt：review 交卷增加 `goalResults[{conditionId,result,evidence}]`；解析器要求覆盖每条必需 Goal 条件、evidence 非空、条件 id 合法。必需条件失败或缺证据时判 FAIL，进入既有修复/轮次语义，不因此新增人类 attention；产物本身缺字段或不可解析仍按 artifact_invalid 处理。

### 7.3 批准绑定版本

- 计划批准绑定 Plan + Goal Eval + 适用 Spike 分支的具体内容版本；
- 推荐记录内容 hash、批准人和批准时间；
- 实质修改后旧批准失效；
- 用户可批准或批注驳回；驳回回到 Tech Lead 修订；
- Prompt 不能绕过代码中的批准门。

---

## 8. 完成、打回与 revision loop

### 8.1 完成通知

Reviewer 对 Goal Eval 判 PASS 后：

- 当前 revision 记录真实完成结果；
- Lead 向用户发送完成通知；
- 通知可直接打开结果、证据和实际产物；
- 用户不需要再点“验收通过”；
- 完成通知与未读状态不冒充人类阻塞 attention。

### 8.2 打回

用户可打回并自然语言说明不满意之处：

- 仍使用同一个 Goal；
- 开启下一 revision；
- 自动带上旧结果、证据和用户反馈；
- 首先恢复该 Goal 的 Tech Lead 讨论；
- Tech Lead 与用户判断需要改方向、Plan、Goal Eval，还是仅补充实施；
- 需要重新批准的内容必须重新进入 PLAN_REVIEW；
- 旧 revision 的 Plan、Eval、Receipt、ReviewReport、结果与打回反馈全部保留。

实现上不是“撤销旧归档”：Goal 根记录保持稳定 goalId，并指向 activeRevision；每个 revision 的状态、产物、outcome 和归档记录追加保存。打回只创建下一 revision，旧 revision 永远保持其真实 verdict。需要工作区时创建/恢复该 revision 自己的 Assignment，不依赖已归档 worktree 仍然存在。预算默认按 Goal 累计，打回不隐式重置；用户可显式追加预算。

### 8.3 优先语义

- 打回后 Tech Lead 讨论可以立即恢复；
- 后续实施排在其他 queued Goal 之前；
- 不硬中断另一 Goal 正在运行的节点；当前节点完成后按优先级调度；
- 讨论/规划不占正式实施槽；单 active 的执行约束本批仍保留。

---

## 9. 内部 Session 管理

### 9.1 稳定身份与运行资源分离

内部由 Session Supervisor 维护：

```text
(projectId, role, scopeId)
  → runtimeSessionId / lifecycle / generation / lastActiveAt
```

runtimeSessionId 只用于内部接线，不能成为 Goal ownership 或用户界面的主键。

| 角色/工作 | 内部作用域 | 管理策略 |
|---|---|---|
| Lead | 项目 | 固定逻辑身份；自动唤醒、恢复、压缩和轮换 |
| Tech Lead | Goal | 每 Goal 独立上下文；同 Goal 跨 revision 延续 |
| Builder Spike | ProbeRequest | 隔离临时 Session/工作区；报告后回收 |
| Builder 实施 | Assignment | 按批准 Plan 创建；支持失败、重试与恢复 |
| Reviewer | Goal revision | 新独立上下文，不继承 Builder 的自我判断 |

### 9.2 自动恢复

- 收到事件时按稳定 role/scope 查找健康 Session；
- 失效时从持久状态、ContextManifest 和产物恢复或重建；
- 长时间空闲可休眠或压缩；
- 崩溃恢复不需要用户操作；
- 会话 transcript 不是工作状态的权威来源。

正常 UI 不暴露内部 Session 管理；诊断页面如需展示，只能是只读技术详情。

---

## 10. 上下文、文件与记忆边界

### 10.1 Lead 决定 Worker 上下文

Lead 拥有每个工作委托的上下文选择责任，但由确定性代码装配和校验 `ContextManifest`：当前阶段必需的基础产物由代码自动纳入，Lead 通过结构化选择决定可选补充与跨 Goal 引用，不能靠自由文本绕过权限。清单至少包括：

- GoalId、revision、接收角色和 Assignment/ProbeRequest；
- 当前 Goal brief、Direction Decisions、Plan、Goal Eval；
- 项目规范和明确需要的项目决策；
- 指定的 ProbeReport、Receipt、ReviewReport；
- 显式跨 Goal 引用；
- 范围、权限和验收要求。

规则：

- 未显式选入的其他 Goal 讨论不得进入当前 Goal；
- 阶段必需的基础上下文不得被 Lead 漏选；可选引用必须存在、可读且通过相同范围校验；
- ContextManifest 是 Pod 文件产物，prompt 注入和 Session 恢复共用；
- Worker 只能提交结构化产物/消息，不能自行改变 Goal state；
- 具体目录布局由实现者按现有 `.mafw` 结构决定。

### 10.2 记忆保持不变

- Pod 项目记忆继续保存稳定规范、术语和项目级决策；
- Goal/任务/Spike/Eval/交接不自动写入谐波记忆；
- 现有谐波记忆正常检索，不改变其写读路径；
- 不用长期记忆代替 ContextManifest 或 Goal 文件。

---

## 11. 确定性控制与恢复

- NodeDriver 仍是 Goal 执行状态的唯一写方；Lead 不取代它；
- Lead 决定路由和 ContextManifest，但不能用 prompt 强制状态推进；
- Tech Lead/Builder/Reviewer 通过文件产物或结构化交卷提交事实；
- 人的 Direction Decision、Plan approval、打回和暂停都持久化；
- 等待人是合法驻留状态，进程重启后仍在；
- 节点产物必须可解析，不能以“Agent 说完成”为完成依据；
- 恢复时产物优先，不重复兑现已完成节点；
- 当前 pause 语义继续保留：当前节点可完成，不启动未经允许的后续节点；
- 任何 Eval/Plan 实质变化必须使旧批准失效。

---

## 12. 现有资产与目标差异

### 可复用

- per-project Manager Session、身份注册、恢复与快照；
- Goal intake、state v3、NodeDriver、watchdog；
- plan review、approvalId、批注驳回；
- Builder execute、Reviewer review、rubric、artifact gate；
- Pod roster、session binding、消息/A2A、Pod memory；
- Goal queue、pause/resume、result panel、attention 投影。

### 需要新增或改变

- Manager → Lead 的角色收口与 UI 隐藏 Session；
- Tech Lead 正式身份与每 Goal 讨论上下文；
- Goal 讨论、方向裁定、Spike、Goal Eval、结果打回等完整阶段；
- ContextManifest 与 Lead 的上下文装配责任；
- Goal 级 Eval 聚合判定，而非只有任务 rubric；
- revision 与既有 round/attempt 的分离；
- 打回 Goal 的优先调度与同 Goal 历史；
- 正式实施槽与讨论/规划活动的解耦。

---

## 13. 非目标与反目标

本设计不包括：

- 多 active 正式实施 Goal、多 Builder worktree fan-out；
- 动态 swarm 或无限增加角色；
- Lead 与 Manager 两套项目协调身份并存；
- Tech Lead 跨 Goal 自动共享完整讨论；
- 把 Spike 代码默认并入最终实现；
- 用 Builder 自报替代独立 Reviewer；
- 把任务状态自动写入长期记忆；
- 默认 proactive auto 找活；
- 云端 BYOM、模型型 Watchdog 或运行时重写；
- 让用户管理任何 Lead/Tech Lead 内部 Session。

反目标：为了流程完整而让每个小动作都产生人工审批，使用户陷入持续确认。

---

## 14. 交付面

- Desktop 提供完整的 Lead 路由、Tech Lead 讨论、Plan/Eval 审阅、结果通知与打回体验；
- Gateway 持有全部权威状态与产物，SDK/preload 同步所需 DTO、方法和事件；
- TUI 本批不实现完整 Tech Lead 工作页；
- 现有 MCP Goal/Pod 创建与查询保持兼容；新增讨论与打回交互以 Desktop 为主，不本批扩展一套等价的 MCP 交互；
- canonical 事件与读模型使用稳定角色和阶段词汇，不能泄漏 runtimeSessionId 作为业务身份。

## 15. 验收场景

1. 用户在 Lead 聊天表达工作观点，Lead 直接建 Goal 并显示 Tech Lead 入口，不进行技术讨论；
2. 用户点击进入该 Goal 的 Tech Lead 页面，自动加载正确 Goal，无 Session 选择；
3. 两个 Goal 的 Tech Lead 讨论互不可见，除非 Lead 显式加入跨 Goal 引用；
4. 模式 A 下，Builder Spike 后 Tech Lead 先形成 Plan/Eval，用户批准前不得正式实施；
5. 模式 B 下，Spike 超出已批准假设或改变 Plan/Eval 时，旧批准失效并停止继续实施；
6. 计划审阅同时显示 Plan、Goal Eval、Spike 证据与未验证假设；
7. Reviewer 必须给出 Goal 级 verdict 和逐任务证据，任务全完成但 Goal 条件未满足时不得 PASS；
8. Reviewer PASS 后 Lead 报完成并通知用户，无强制人工验收按钮；
9. 用户打回后仍打开同一 Goal，开启新 revision，恢复 Tech Lead 上下文并保留旧历史；
10. 打回 Goal 的后续实施优先于其他 queued Goal，但不硬中断当前在飞节点；
11. 底层 Lead/Tech Lead Session 失效后自动恢复，用户无需操作；
12. 重启后讨论、批准、打回和 revision 状态均可恢复；
13. 任务文件经 ContextManifest 显式进入 prompt，长期记忆行为保持现状；
14. 方向已经明确时不产生额外方向批准；存在方向分歧时才形成持久 attention，裁定后可恢复；
15. Goal Eval 必需条件缺证据或 Reviewer 交卷漏项时，代码拒绝 PASS；缺证据按 FAIL 修复，不冒充技术 ERROR 或人类问题。

---

## 16. 设计选择与实现者边界

### 16.1 本文做出、供用户审阅的设计选择

- 安全、只读、隔离的 Spike 默认不增加人工批准，高风险/越界仍问人；
- Spike 与正式实施使用不同调度池，本批默认每 Pod 同时最多一个 Spike；
- 预算默认按 Goal 累计，打回不隐式重置，用户可显式追加；
- 一次工作意图默认只建一个 Goal，拆分由 Tech Lead 讨论后建议；
- Lead 负责上下文选择，代码负责必需基础包、范围校验与确定性装配；
- Desktop 是完整交互面，TUI 本批不做完整 Tech Lead 页面；
- 旧 revision 不反归档，新 revision 以追加历史继续同一 Goal。

### 16.2 留给实现者的选择

以下不需要用户逐项决定，可在实施计划中按现有代码风格确定：

- 具体 TypeScript 类型名、表名、文件名和目录布局；
- REST/SSE/SDK 的具体字段命名与兼容别名；
- Tech Lead 页面复用哪些现有 Chat/Goal/Plan 组件；
- ContextManifest 的内容 hash 和版本序列化方式；
- 旧 Manager 数据的一次性迁移或收养细节；
- Spike 调度器的具体并发默认值与清理实现；
- 不改变上述语义的测试拆分与迁移步骤。

任何会改变角色权限、人工批准时机、Goal 隔离、结果/打回语义或记忆边界的实现选择，不属于实现者自由裁量。
