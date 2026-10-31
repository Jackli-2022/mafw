# 业界的 "Pod" vs MAFW 的 Pod

- 日期：2026-10-31
- 触发：用户问「对比一下业界的 pod 逻辑和我们的 pod 逻辑」
- 结论摘要在 §5

## 1. 先说术语：业界 "Pod" 至少有三个所指

| 所指 | 代表 | 核心语义 |
|---|---|---|
| **基础设施调度单元** | Kubernetes | 一个 Pod = 1..n 个容器，**共享网络命名空间与 IP**、共享卷；生命周期 `Pending → Running → Succeeded/Failed`；`restartPolicy` 决定容器失败后是否重启；startup/liveness/readiness 三种探针；**刻意 ephemeral**，坏了通常重建而不是原地修 |
| **Agent 团队（预设编队）** | CrewAI `Crew`、MetaGPT SOP、ChatDev | agents + tasks + process；任务带 `description` / `expected_output`；`hierarchical` 模式有一个 manager 委派并校验产出 |
| **Agent 团队（动态集群）** | Claude Code Agent Teams | lead + 若干 teammate（每个是完整 session）；共享任务列表 + 每个 agent 一个 inbox JSON；谁干活由 lead 动态决定，成员可随时加/减 |

三者共享的只有「一小撮协作者被当成一个整体来调度」这个直觉，其余完全不同。

## 2. MAFW 的 Pod（实读）

- **编队**：项目级固定三人 —— `lead`（manager 身份）、`builder`（mafw-execute）、`reviewer`（mafw-review）；`pod_members` 持久化，session 按角色绑定（coordination / plan / execute / review）。
- **目标**：`pod_goals` 单活跃 + queued，archived 时自动 promote 下一个。
- **任务**：由 plan 节点的 `waves.json` 投影成 `pod_tasks`；execute 回执 → `review`；Reviewer FAIL → `reopened`；归档 reconcile 收口。
- **通信**：`pod_messages`（协调日志）+ A2A `message/send` 交接；协调会话 push（`delivery:'queue'`），节点会话 pull（下次 prompt 注入 `[POD HANDOFF]`）。
- **记忆**：Pod 文件（`POD.md` / `POD_MEMORY.md` / `GLOSSARY.md`）+ 谐波记忆（跨 Pod 通用）。
- **编排**：`NodeDriver` 状态机 plan → execute → review → (loop) → archive；**产物双门**（turn.completed + 产物文件存在且可解析）；watchdog 按 attempt 重试。
- **生命周期**：`pod.activeGoalId` + `pod.status`（active/idle/paused/archived），与会话/进程无关。

## 3. 对比表

| 维度 | k8s Pod | CrewAI Crew(hi.) | Claude Teams | **MAFW Pod** |
|---|---|---|---|---|
| 成员是否固定 | 固定（一个 spec） | 固定（agents 列表） | 动态（lead 决定） | **固定三名** |
| 谁决定下一步 | 调度器 + 控制器 | manager agent | lead agent | **NodeDriver 状态机**（非 LLM） |
| 任务对象 | 无（容器进程） | `Task` + `expected_output` | 共享任务列表 | `pod_tasks`（waves 投影 + 回执） |
| 完成判定 | 探针 + exit code | manager 判定 | lead 判定 | **产物文件双门** + verdict |
| 通信 | 共享 network ns | 委派工具（无 DM） | inbox JSON DM/broadcast | `pod_messages` + A2A |
| 记忆 | 卷 | 无内建共享记忆 | 各 session 上下文 | Pod 文件 + 谐波记忆 |
| 失败恢复 | restartPolicy + 重建 | 重派任务 | lead 重试 | attempt+1 + watchdog + `archive_fail` |
| 生命周期 | Pending/Running/Succeeded/Failed | 一次 `kickoff()` | 会话存续 | goal 队列 + pod.status |
| 可观测 | events/probes/logs | 日志 | 面板/inbox 文件 | `goal_node_runs` + timeline + pod.updated |

## 4. 我们和谁最像、和谁最不像

- **最像 CrewAI hierarchical + MetaGPT SOP 的混合**：固定角色 + 显式产出契约。差别在于我们把「完成判定」从 manager 的自由判断换成了**确定性状态机 + 产物门**——这是刻意的：LLM 判定"够好了"不可复现，文件在不在是可复现的。
- **不像 k8s Pod**：k8s 的 Pod 是调度单位，成员可以死掉重建、IP 会变；我们的 Pod 是**项目上的一个长期编队**，人（用户）对它有稳定心智（Lead/Builder/Reviewer 一直在）。所以 `pod.status` 是 active/idle 这类业务状态，不是 Pending/Running。
- **不像 Claude Teams**：他们是动态集群 + mailbox 驱动，没有产物门、没有固定角色；好处是灵活，坏处是「谁该做什么」完全靠 lead 的 prompt 质量。

## 5. 值得借的三件事（按收益/成本排序）

1. **k8s 的 readiness 概念 → 节点/成员"就绪"信号**
   我们只有 `idle`（回合结束）和错误，没有"这个成员准备好接活了"的显式信号。Devin 的 agent sidebar 会把"正在跑"置灰只读，本质就是 readiness。低成本版：`pod_members.status` 已有 `available/working/waiting/sleeping`，把它真正接成 UI 与投递的前置条件（现在只有 UI 显示）。
2. **CrewAI 的 `expected_output` → review 的结构化 rubric**
   我们 execute 有 `acceptance[]`，但 review 产出仍是自由文本 `reviews/*.md`。把 review 的判据结构化成「每条 acceptance → pass/fail + 证据」会让人工复核和自动门都更硬。
3. **Claude 的 mailbox 回执 → 已读回执给发送方**
   我们有 `readAt`/`deliveredAt`，但发送方（Lead）不知道对方是否读过。Claude 的 agent inbox 在 markRead 时会回一条 receipt。可以低成本加：消息被 `markRead` 时，若发送方是成员，则投递一条 `note` 级回执（或只在 UI 显示"已读"）。

## 6. 不建议借的

- **动态创建/销毁成员**（k8s 弹性 / Claude 动态加 teammate）：会打破"项目固定班底"的心智，且我们的人格身份是持久化的（IdentityRegistry 物化），动态化收益不抵复杂度。
- **群聊式广播**（AutoGen group chat）：成本随人数线性涨，且会把 `[POD HANDOFF]` 注入膨胀——这正是我们选择"默认贴条、广播昂贵"的原因。
- **让 LLM 判定任务完成**（CrewAI manager）：不可复现；我们已有的产物双门是更强的约束，不该退回。

## 7. 一句话总结

**业界叫 Pod 的东西是"可丢弃的调度单位"；我们的 Pod 是"项目上的固定编队 + 确定性流水线"。** 名字借得不严谨，但设计上我们更接近 CrewAI/MetaGPT 的"角色 + 产出契约"，并用 k8s 式的确定性（状态机、重试、产物门）替代了 LLM 自由裁量。
