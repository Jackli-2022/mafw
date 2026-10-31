# 「鲸群 / Pod」的定义调研

- 日期：2026-10-31
- 目的：把「鲸群」从隐喻变成可判定的术语，收进 `CONTEXT.md`（项目共享语言）
- 前置：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`（塔/蜂群/鲸群三原型）

## 0. 一句话

**鲸群（Pod）= 一个项目上的固定三人 agent 编队**：Lead 编排、Builder 执行、Reviewer 独立验收；身份持久、同一时刻只跑一个 goal、成员间用协调日志交接、共享 Pod 记忆。

## 1. 词从哪来：三条互不相干的来源

| 来源 | "pod" 的含义 | 关键特征 |
|---|---|---|
| **生物学**（本义） | 鲸/海豚的**群体**（BBC Earth、NOAA 都把 whale 的 group 写作 *pod*） | 小、稳、有方言、母子相传 |
| **容器编排**（k8s, 2014–） | 一个 Pod = 1..n 个容器，共享网络命名空间与卷 | 调度单位、**ephemeral**、坏了重建 |
| **Agent 团队**（2026） | CrewAI `Crew`、Claude Code Agent Teams、Cursor/Codex 的并行小队 | 角色 + 任务 + 消息 |

中文「鲸群」直接对应第一义——**英文 pod 本来就是鲸群的量词**。也就是说我们不是"把 k8s Pod 翻译成鲸群"，而是**回到 pod 的原义**，再借它描述 agent 团队。

## 2. 生物学语义（我们真正借的那层）

据 WDC / Center for Whale Research / Whale Sanctuary Project：

| 层级 | 生物学 | 说明 |
|---|---|---|
| matriline | 母系小群 | 由年长雌性带领的母子/母女/姐妹 |
| **pod** | **若干近亲 matriline 组成的稳定群** | 共享较近的共同母系祖先；**成员大多终生不散**；有**群体专属方言** |
| clan | 若干 pod | 共享更古老的母系与相似方言 |
| community | 共享活动范围的最大社群 | 按互动模式而非血缘界定 |

三个可直接迁移的特征：

1. **小而稳**：不是"越多越强"，条数受食物与社会结构限制
2. **终生/长期成员关系**：不是一次任务就散伙（对比 swarm 的短生命周期 worker）
3. **方言**：每个群有自己的叫声系统——对应我们的**项目级约定**（`POD.md` / `GLOSSARY.md` / AGENTS.md / 记忆）

## 3. 我们的定义（可判定）

> **鲸群（Pod）** 是绑定在**一个项目目录**上的固定三人 agent 编队：`Lead`（编排/规划）、`Builder`（执行）、`Reviewer`（独立验收）。它拥有持久身份、单活跃 goal 队列、成员间协调日志与共享记忆。

判定一个东西是不是 Pod，看五条**同时成立**：

| # | 条件 | 实现 |
|---|---|---|
| 1 | **绑定项目目录**，不是会话、不是进程 | `project_pods(project_dir)` + `PodService.ensure(projectDir)` |
| 2 | **固定三人 + 持久身份** | `pod_members`（lead/builder/reviewer）+ `IdentityRegistry` 物化 `mafw-plan/execute/review` |
| 3 | **同一时刻一个活跃 goal**，其余排队 | `pod_goals`（active/queued）+ 归档时 promote |
| 4 | **成员间走协调日志**（不是共享上下文） | `pod_messages` + A2A `message/send`，注入 `[POD HANDOFF]` |
| 5 | **共享记忆** | `~/.mafw/pods/<id>/memory/{POD,MEMORY,GLOSSARY}.md` + 谐波记忆检索 |

## 4. 边界：Pod 不是什么

| 术语 | 与 Pod 的区别 |
|---|---|
| **Team**（泛称） | 任何多 agent 组合；Pod 是它的一个**具体形态**（项目级、固定三人、单 goal） |
| **Swarm**（Kimi 式） | 无固定角色、规模可达数百、生命周期短；Pod 恰好相反 |
| **Tower**（层级委派） | 层层上报的治理结构；Pod 只有一层，Lead 不做逐级汇报 |
| **Crew**（CrewAI） | 一次性 `kickoff()` 的自主协作；Pod 是**项目级常驻** |
| **Session** | 一次对话；Pod 跨会话存在（成员会话可以新建/销毁，Pod 不随之消失） |
| **k8s Pod** | 调度单位、ephmeral、共享网络命名空间；我们的 Pod 不含进程语义 |

## 5. 命名判断：鲸群合适吗？

**合适的地方**
- 与英文 pod 原义一致，不是硬造词
- 「小而稳 + 方言 + 长期成员」正好对应我们的三个设计选择（固定三人 / 项目约定 / 项目级持久）
- 与「蜂群」形成清晰对照：一个是规模弹性，一个是长期协作

**要小心的地方**
1. **别把它当"团队"的同义词**：仓库里所有 Pod 都应满足 §3 五条；只是"几个 agent 一起干"不叫 Pod。
2. **别混用 k8s 语义**：Pod 里没有"容器/调度/重启"这些含义；我们的重启是 goal 的 attempt，不是 Pod 的生命周期。
3. **中文单复数**：代码里用 `Pod`（单数标识符）、文档里「鲸群」可指代整体；不要写"一个鲸群里有很多鲸群"。

## 6. 落地：写进 CONTEXT.md

已在该文件新增 `## 鲸群（Pod）` 一节（canonical 定义 + 五条判定 + 不是什么），因为 `CONTEXT.md` 是项目共享语言，`/waitwhat` 与 manager 重述都依赖它。

## 7. 来源
- 生物学：BBC Earth「group: Pod」、NOAA Fisheries「Pod of killer whales」、WDC「What is an orca pod?」、Center for Whale Research「Social Circles」、Whale Sanctuary Project（matriline/pod/clan/community + 方言）
- 计算：Kubernetes Pod Lifecycle 文档
- Agent 团队：`docs/research/2026-10-31-pod-vs-industry.md`、`2026-10-31-pod-vs-codex-kimi-grok.md`
- 内部：`docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`、`gateway/src/core/pod/*`
