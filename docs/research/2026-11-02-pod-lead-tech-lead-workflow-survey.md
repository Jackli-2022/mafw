# Pod Lead / Tech Lead / Builder / Reviewer 业界工作流调研

- 日期：2026-11-02
- 状态：一手资料调研与关键文档复核完成；仅为设计输入，未改产品代码
- 前置：`docs/research/2026-11-02-dsh-superagent-pod-v3-review.md`

## 0. 用户已经确定的协作要求

1. 用户不在 Lead 处手动管理 Session；
2. Lead 是整个项目持续存在、统一对人的角色；
3. 增加 Tech Lead，负责调研、讨论技术方向与实现计划；
4. Tech Lead 可以在讨论/规划阶段让 Builder 执行探针、复现、基准或其他技术验证；
5. 整体体验是：表达方向 → 调研讨论 → 用户裁定 → 规划 → 用户审阅计划 → 实施 → 查看结果 → 反馈循环；
6. Tech Lead 同时负责设计 Goal Eval：定义 Goal 如何被客观验证、需要哪些证据、怎样算失败；
7. 任务、Goal、Eval、探针与交接以 Pod 文件产物保存，在节点 prompt 中显式携带；长期记忆仍走现有检索，不自动保存任务状态；
8. Reviewer PASS 后 Goal 报完成并通知用户查看，不要求用户再点一次验收；用户可以打回，并重新与 Tech Lead 讨论；
9. Tech Lead 在不同 Goal 间的技术讨论上下文完全隔离，只共享显式沉淀的项目规范、决策与产物；现有记忆检索保持不变；
10. 打回后继续同一个 Goal 并开启新 revision，保留全部历史；
11. Lead 决定为 Worker 拼装哪些上下文；跨 Goal 信息只有经 Lead 显式选入才可进入另一 Goal 的工作上下文；
12. 打回的 Goal 优先于其他 queued Goal；
13. Goal 阶段显式覆盖 Lead 协调、Tech Lead 讨论/规划、Builder 探针/实施、Reviewer 验收，以及完成打回后的同 Goal revision loop；
14. 用户表达工作意图时 Lead 直接建立 Goal，不再先确认是否转为工作目标；
15. Lead 不做实质技术讨论，只接收、建 Goal、给建议与路由；Tech Lead 才负责技术讨论；
16. Lead 聊天页可以提供“拉 Tech Lead / 进入 Tech Lead 讨论”的卡片，用户点击后进入该 Goal 的 Tech Lead 页面，底层上下文自动接续；
17. Spike 主要用于让 Tech Lead 看清技术事实并形成详细 Plan；Builder 执行后先向 Tech Lead 汇报，Tech Lead 再出正式计划；
18. 用户批准默认采用 Spike 后展示 Plan 再批准实施；仅当假设和失效条件明确时，允许一次批准 Spike→实施的条件式完整计划；
19. Lead 替换现有 Manager，不再保留两个项目级协调角色；现有 Manager 的会话与恢复设施可作为隐藏实现资产复用。

## 1. 总结论

这套分工与业界几类成熟模式相容：

- DeepSeek Super-agent 支持 **Lead/Router 与执行 Worker 分离**；
- MetaGPT 支持 **独立 Architect 先产技术设计，再交 Engineer 实施**；
- Microsoft Magentic 与 Claude Code 支持 **计划在执行前由人批准或驳回修改**；
- Anthropic 的 evaluator-optimizer 支持 **独立角色依据证据反馈和迭代**；
- 传统 XP spike 支持 **在正式实施前用可丢弃实验降低技术风险**。

因此推荐的 Pod 不是“Lead 什么都管”，而是：

> **Lead 管项目关系与工作流，Tech Lead 管技术判断与计划，Builder 管探针和实施，Reviewer 管独立验收；Session 全部是隐藏的运行资源。**

---

## 2. 业界机制对照

| 系统/方法 | 已验证的核心机制 | 对 Pod 的意义 |
|---|---|---|
| DeepSeek Super-agent | Router 维护全局连续性、统一对人；Worker 隔离执行；Router 不深入单任务实施 | Lead 是项目级 Router，不应兼任所有技术工作 |
| MetaGPT | PM、Architect、Project Manager、Engineer、QA 按 SOP 和中间产物协作 | Tech Lead/Architect 可以是独立角色；规划不等于执行 |
| Microsoft Magentic | Manager 负责计划与协调；支持计划 approve/revise； stalled 时可重规划 | 计划批准应支持“批准/反馈修改”，不能只有放行按钮 |
| Claude Code plan mode | 批准前以只读调研为主；用户可批准或继续修改计划；批准后才进入编辑 | 计划门由 harness 执行，不靠 prompt 自觉 |
| Anthropic orchestrator-workers | 中央协调、Worker 执行、综合结果；强调简单与透明 | 不为了角色数量增加复杂度，职责边界比数量重要 |
| Anthropic evaluator-optimizer | 生成与评估分开，依据明确标准循环改进 | 保留独立 Reviewer，不让 Builder 自报代替验收 |
| LangGraph interrupt | 人工等待是持久状态；恢复后节点重入；副作用要幂等或后置 | 人的裁定/批准必须落库，进程重启不能丢失 |
| XP spike | 用最小实验回答技术问题，通常预期丢弃 | Builder 可在实施前探针；交付物是证据而不是残留代码 |

### 一个重要反例

DeepSeek Super-agent 刻意不让 Router 深入单任务拆解；很多学术多 Agent 系统则没有正式的人审计划门。Pod 不需要二选一：

- 用 DeepSeek 的 **项目级 Lead/Router**；
- 用 MetaGPT 的 **独立技术设计角色**；
- 用 Magentic/Claude Code 的 **人工计划审阅**；
- 保留 MAFW 已有的 **Reviewer + rubric + 产物门**。

---

## 3. 推荐的角色与生命周期

### 3.1 四角色

| 角色 | 生命周期 | 责任 |
|---|---|---|
| Lead | 项目级永久身份 | 统一对人、识别意图、路由新工作/旧工作反馈、呈现状态与结果 |
| Tech Lead | 项目级角色；每个 Goal 有独立工作上下文 | 调研、追问、方案比较、技术判断、设计 Goal Eval、实现计划、根据反馈修订 |
| Builder | 按 Goal/探针任务运行 | 执行技术探针、提交证据；计划批准后实施 |
| Reviewer | 独立验收上下文 | 按 Goal Eval、任务 acceptance 和真实证据独立验收，不能修改实现来凑通过 |

“永久 Lead”不意味着同一个进程或模型 Session 永不重启，而是：

- 项目身份、责任、状态和记忆持续；
- 底层 Session 自动压缩、轮换和恢复；
- 用户永远不执行新建/切换/rotate Lead Session；
- 没有工作时等待事件，不持续消耗模型调用。

### 3.2 Goal 从讨论开始，但尚未获得执行授权

用户已确定：Lead 识别到工作意图后直接建立 Goal，并引导用户进入 Tech Lead 讨论。Goal 从讨论开始就是**草稿/讨论态**，此时尚未获得执行授权：

```text
INTAKE（Lead）
  接收意图、建立 Goal、决定各 Worker 的上下文清单
        ↓
DISCUSSING（Tech Lead）
  调研、追问、方案比较；必要时申请 Builder 探针
        ↓
DIRECTION_REVIEW（用户）
  裁定方向，形成 DecisionRecord
        ↓
PLANNING（Tech Lead + 可选 Builder Probe）
  输出 Plan + Goal Eval + ProbeReport / assumption
        ↓
PLAN_REVIEW（用户）
  批准或批注驳回；批准绑定具体 Plan/Eval 版本
        ↓
IMPLEMENTING（Builder）
  按批准计划实施，提交 Receipt 与证据
        ↓
REVIEWING（Reviewer）
  独立按 Goal Eval + 任务 acceptance 验收
        ↓
COMPLETED / RESULT NOTIFIED（Lead → 用户）
  报完成并通知查看，不强制用户再点验收
        │
        ├─ 无打回：保持完成
        │
        └─ 打回：同一 Goal 开启下一 revision
                  优先于其他 queued Goal
                  回到 DISCUSSING（Tech Lead），继续 loop
```

阶段词汇需要分开：

- `revision`：用户看到的一次完整讨论→交付→打回循环；
- `round`：某 revision 内 plan→implement→review 的自主修复轮次；
- `attempt`：一个节点的技术重试，不改变 round 或 revision。

打回优先的推荐解释是：Tech Lead 讨论立即恢复；需要实施时排到 queued Goal 前面，但不硬中断另一 Goal 正在运行的节点。该调度细节是本文建议，仍可在 spec 中单独裁决。

草稿 Goal：

- 不进入单 active Goal 执行队列；
- 不启动 Builder 正式实施；
- 不产生执行轮次和 goal outcome；
- 只保存讨论、调研、决策与产物；
- 用户可以放弃草稿，不把它伪装成失败 Goal。

Lead 聊天页与 Pod 入口共用同一路由：Lead 不做技术方案讨论，而是建立 Goal、给出“建议先与 Tech Lead 讨论”的卡片；用户点击后进入该 Goal 的 Tech Lead 页面。页面按 Goal 进入，不向用户暴露 Session 创建或选择。

---

## 4. 规划期探针的正确边界

### 4.1 Tech Lead 提问题，Builder 取证

建议将探针显式建模为一个小委托：

```text
ProbeRequest
- 要回答的问题
- 当前假设
- 允许的动作和范围
- 时间/成本预算
- 需要的证据
- 对哪个方案或计划断言有影响
```

Builder 返回：

```text
ProbeReport
- 实际环境
- 实际执行的命令/操作
- 关键输出与可复现步骤
- 结论：支持 / 否定 / 尚不能判断
- 仍存在的假设
- 对计划的具体影响
```

Tech Lead 用报告修改方案或计划，用户能在计划审阅时看到“技术断言 ↔ 探针证据”。没有探针验证的关键假设必须明确标成 assumption，不能包装成事实。

### 4.2 探针不等于正式实施

- 探针代码默认可丢弃；
- 探针不修改主工作区；
- 需要写代码时放独立临时目录/worktree；
- 探针产物不直接混进最终实现 diff；
- 只读探针和安全命令可走现有审批策略；
- 联网、凭据、生产数据、主工作区写入等越界行为仍需显式批准；
- 探针有数量、时间和成本上限，避免为了规划无限验证。

### 4.3 为什么不让 Tech Lead 自己跑

不是能力问题，而是职责和可审计性：

- Tech Lead 对“要验证什么、证据意味着什么”负责；
- Builder 对“怎样安全执行、实际发生了什么”负责；
- 两者分开后，计划中的技术断言有明确来源；
- 正式实施仍必须等计划批准，探针不能成为绕过审批的后门。

### 4.4 Spike 与计划批准的两种模式

#### 模式 A：Spike 后再批准实施（两段式，推荐默认）

```text
Tech Lead 提出调查问题 / ProbeRequest
  → Builder 执行 Spike
  → ProbeReport 回到 Tech Lead
  → Tech Lead 形成正式 Plan + Goal Eval
  → 用户查看计划和证据并批准
  → Builder 正式实施
```

适用于技术路线不清、风险高、Spike 可能改变方案的情况。此时 Spike 之前还不存在足够详细的实施计划，不能假装用户能提前批准一个未知方案。安全 Spike 可不单独增加人工批准；高风险 Spike 仍需单独审批。

#### 模式 B：一次批准 Spike + 后续实施（条件式一段式）

```text
Tech Lead 先提交完整计划草案
  其中包含 Spike、预期分支、后续实施、Goal Eval、停止/重批条件
  → 用户批准这个完整计划版本
  → Builder 执行 Spike
  → Tech Lead 检查结果
       ├─ 结果落在已批准假设和范围内：继续实施
       └─ 假设被否定、范围/成本/Eval 改变：计划失效，重新提交批准
```

适用于路线已基本明确，Spike 只是验证已知假设的情况。它不是“一次点击后无论发现什么都继续做”，而是带明确失效条件的条件批准。

#### 推荐判断

默认使用模式 A；只有计划已足够具体、Spike 只是验证且失效条件可机械判定时才允许模式 B。两种模式都必须把 Plan、Goal Eval、ProbeReport 和批准绑定到具体内容版本，任何实质变化都使旧批准失效。

ProbeRequest / ProbeReport 可以使用 A2A 作为 Tech Lead 与 Builder 的传输，但 Pod 文件产物仍是权威，节点 prompt 仍需显式携带当前上下文清单。

---

## 5. Tech Lead 必须设计 Goal Eval

### 5.1 设计 Eval 与执行 Eval 必须分开

| 角色 | 对 Eval 的责任 |
|---|---|
| Tech Lead | 定义 Goal 的成功标准、失败条件、所需证据、验证方法和任务映射 |
| Builder | 提供实施证据，可运行测试/探针，但不能凭自述让 Goal 通过 |
| Reviewer | 独立运行或复核验证，按 Goal Eval 和任务 acceptance 判定 |
| 用户 | 收到完成通知并查看客观结果；可以打回，重新与 Tech Lead 讨论方向或计划 |

因此 Tech Lead 不能“自己设计标准、自己实施、自己判过”，Reviewer 也不能在实施完成后才临时发明验收标准。

### 5.2 Goal Eval 是计划的一等产物

```text
GoalEval
- 目标结果与范围
- 必须满足的验收条件
- 每项条件需要的证据与验证方法
- 明确的失败条件
- 约束与非目标
- Goal 条件到 waves task / probe / artifact 的证据映射
```

它与任务 acceptance 不重复：

- **Goal Eval** 判断用户托付的整体结果是否达成；
- **任务 acceptance** 判断某个实施步骤是否完成；
- 所有任务完成不能自动推导 Goal PASS，Reviewer 必须另做 Goal 级聚合判定；
- 任一必需 Goal 条件缺证据或失败，Goal 不得 PASS。

当前 Pod 已有 Goal acceptance 输入和逐任务 rubric，但还缺“Goal Eval 作为独立产物 + Reviewer 的 Goal 级聚合判定”这一层。

### 5.3 Eval 与计划一起批准

- Tech Lead 在规划期同时提交 Plan 和 Goal Eval；
- 探针可以验证 Eval 是否可执行、证据是否能获取；
- 用户审阅计划时也审阅“怎样算做对”；
- 执行开始后若改变 Goal Eval 或必需 acceptance，必须形成新版本并重新批准；
- 结果页同时展示 Goal 级 verdict、逐任务 rubric 和证据链接。

### 5.4 完成通知与打回

- Reviewer 判定 Goal Eval PASS 后，Goal 即可报告完成并进入结果通知；
- 用户不需要再点一次“验收通过”才能让 Goal 完成；
- 结果通知必须能直接打开 Goal 结果、证据和实际产物；
- 用户可以选择“打回”，填写或讨论不满意之处；
- 打回后首先回到 Tech Lead 的讨论/方向/计划环节，而不是直接让 Builder 盲目修改；
- 打回必须保留旧计划、旧 Eval、旧结果与用户反馈，不能覆盖历史或伪造首次完成；
- 用户已确定：在同一 Goal 下开启新的 revision；同一 Goal 的 Tech Lead 技术上下文继续保留，Reviewer 使用新 revision 的独立验收上下文。

---

## 6. Session 隐藏后的状态与产物

### 6.1 内部 Session 管理（推荐方案，待批准）

用户面对的是稳定的角色与工作对象，不是 runtime Session：

| 用户看到的角色 | 内部作用域 | Session 策略 |
|---|---|---|
| Lead | 整个项目 | 固定逻辑身份；有事件时自动恢复/创建，空闲时休眠；压缩和轮换自动完成 |
| Tech Lead | 项目角色 + 每 Goal 技术上下文 | 同一 Goal 的讨论自动回到对应上下文；跨 Goal 只共享项目规则、决策与显式产物 |
| Builder / 探针 | 每个 ProbeRequest 或实施 Assignment | 按任务创建隔离 Session/工作区；结束后可回收，报告与证据永久保留 |
| Reviewer | 每 Goal revision 的独立验收 | 使用新的独立上下文，只加载 Goal Eval、计划、产物和证据，避免继承 Builder 自述 |

内部可由一个 Session Supervisor 维护映射：

```text
(projectId, role, scopeId) → 当前 runtimeSessionId / 状态 / 代数 / 最近活跃时间
```

但 runtimeSessionId 只用于内部接线，不作为 Goal ownership 或用户界面的主键：

- Lead 收到消息时，自动找到项目 Lead 的健康 Session；不存在或失效时自动恢复/重建；
- Tech Lead 收到某 Goal 的反馈时，自动恢复该 Goal 的技术上下文；
- Builder 的探针与正式实施使用不同 Assignment，权限和产物不混用；
- Reviewer 每次验收以独立上下文启动，验收后只保留报告；
- Session 崩溃、长时间空闲或需要压缩时，由系统自动处理；
- 正常 UI 不提供新建、切换、轮换或选择内部 Lead Session 的入口；
- Lead 为每个 Tech Lead / Builder / Reviewer 工作委托决定上下文清单，包括当前 Goal 文件、项目规范、显式跨 Goal 引用与必要产物；
- 上下文清单本身作为 Pod 文件产物保存，Session 恢复时按同一清单重建输入；不能让 Worker 隐式读取其他 Goal 的完整讨论；
- 现有谐波记忆检索保持独立，不把上下文清单复制为任务记忆。

“Lead 一直存活”因此是 **项目身份可持续、随时可唤醒**，不是同一进程永远在线。

### 6.2 产物是唯一可见审计面

Lead/Tech Lead Session 对用户隐藏后，用户可见和可审计的真相必须是产物：

| 产物 | 记录什么 |
|---|---|
| Goal brief | 原始意图、目标、非目标、约束 |
| Research report | 调研发现、候选方向、风险与未知 |
| DecisionRecord | 用户实际裁定了什么，以及对应讨论来源 |
| GoalEval | 整体成功/失败条件、验证方法、证据要求与任务映射 |
| Plan | 实施步骤、acceptance、假设、探针证据 |
| ProbeReport | 技术验证的命令、输出与结论 |
| Receipt | Builder 实际完成了什么 |
| ReviewReport | Reviewer 对每个 acceptance 的判定与证据 |
| Result | Lead 向用户交付的结果与后续入口 |

关键原则：

> **对话是交互方式，DecisionRecord 和计划才是后续执行的权威输入。**

这样即使底层 Session 压缩、轮换或崩溃，用户的裁定也不会消失。

---

## 7. 不建议照搬的做法

1. 不让 Lead 深入所有技术细节，避免成为全局瓶颈；
2. 不把 Tech Lead 降成一次性 waves.json 生成器；
3. 不让 Builder 自己规划、自己批准、自己验收；
4. 不把探针残留代码直接当最终实现；
5. 不把用户等待做成内存 Promise，必须是可恢复状态；
6. 不给每个普通讨论都创建执行中的 Goal；
7. 不为“像人团队”而增加更多角色，四角色已覆盖当前闭环。

---

## 8. 仍需用户决定的问题

无必须在正式 spec 前回答的问题。安全 Spike 默认不单独批准、越界 Spike 必须问人，已作为 spec 的设计选择提交用户审阅。

---

## 9. 一手来源

- [DeepSeek Super-agent 设计文章](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)
- [dsh-superagent-prototype Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- [MetaGPT 论文](https://arxiv.org/abs/2308.00352)
- [Microsoft Agent Framework：Magentic orchestration 与计划审阅](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic)
- [Claude Code：Permission modes 与 plan approval](https://code.claude.com/docs/en/permission-modes)
- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [LangGraph：Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [XP：Spike](http://www.extremeprogramming.org/rules/spike.html)
- [ADR 原始定义](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions.html)
