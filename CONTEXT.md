# CONTEXT.md — MAFW 项目共享术语表（Ubiquitous Language）

给 agent 和人共用的项目词汇表。说话、命名、写代码时用这里的词，一个概念一个词，
不要另造同义词。术语变了就改这个文件（配合 ADR 记录难解释的决定）。

## 系统分层

- **Gateway**：`gateway/` 的后台守护进程（端口 3000），所有记忆/编排/API 的中枢。
- **插件（plugin）**：`src/` 的 opencode 宿主插件，两个 transform 注射口 + 4 个原生工具。
- **Runtime 契约**：gateway 与 agent runtime（opencode / pi）之间的能力自声明接口
  （`gateway/src/runtime/contract.ts`）；缺能力降级不崩。
- **Sidecar**：gateway 拥有并监管的子进程（opencode serve、llama-server、python kernel）。
  铁律：detached 环境下 spawn 必须 `windowsHide: true`。

## 记忆系统（谐波记忆）

- **HarmonicUnit**：统一记忆单元（id/type/primary_abstraction/cue_anchors/memory_value/energy/salience）。
- **能量（energy）**：记忆的分值，0.005/天基础衰减；检索按 得分×energy×salience 排序。
- **T1 / 观察（observation）**：回合级原始观察，插件经 `/api/obs/capture` 写入
  `t1_observations`，是压缩管线的原料。
- **turnCompress**：每小时聚合压缩管线，把完成回合交给持久 worker 会话，
  由它自主 `mafw_add_memory`；内部 worker 输出**永不回流 T1**（防递归）。
- **pinned（披露层）**：每轮注入 `<user-profile>` 的永久可见记忆（用户画像/长期偏好）。
- **sticky（便签板）**：有保质期的保证送达层（`<note-board>`），到期下架不删除。
- **soft supersede**：知识更新方式——新条目取代旧条目（`superseded_by` 指针 +
  能量减半），历史保留不物理删除。
- **指针记忆**：内容已被 repo artifact 承载时，记忆只存"路径 + 一句话 gist"——
  文件是真相源，记忆是索引。procedural 记忆结尾带"→ 下次用：<skill/工具>"。

## Goal 编排

- **Goal / charter**：一个可委派的工作单元；charter 全文在 `.mafw/goals/<id>.md`，
  request.json 只存指针。
- **Manager**：不写代码的编排 agent（edit deny、task deny），经 `mafw_set_goal` 委派。
- **决策地图**：charter 的五段约定——Destination / Plan / Decisions so far（决策索引：
  gist + 记忆 id）/ Not yet specified（fog，已知的未知）/ Out of scope（排除项）。
- **Frontier**：当前可推进的条目集（前置已决）；fog 中不能精确陈述的问题不成条目，
  frontier 推进后"毕业"。
- **Wave / loop**：goal 执行的一轮迭代；`maxLoops` 是预算上限。
- **里程碑推送（milestone push）**：phase 转换/归档时给 manager 的 `noReply` 通知。

## 召回与注入

- **边界 recall**：每次 LLM 调用前经 `GET /api/recall/context` 注入 `<recall>` 指针块。
- **memory-guide**：常驻 system 的主动记忆操作引导（OptMem 式）。
- **goal-snapshot**：manager 会话每轮 recall 尾部注入的活跃 goal 快照——
  按名引用（标题在前，id 在括号里），不用裸 id 刷屏。

## 客户端

- **Desktop**：`packages/desktop/`（Electron + SolidJS），Rail + TabStrip + RightDock。
- **TUI**：`packages/tui/`（pi-tui），四 tab：Chat/Goals/Memory/Triage。
- **immediate 命令**：busy 时立即执行的 slash 命令（COMMAND_REGISTRY 元数据）。
- **/btw**：一次性支线问答会话（内部角色，不回流 T1）。
- **/waitwhat**：用户发"没听懂"→ agent 用简明语言 + 本文件术语重述上一条回复。

## 运维

- **自更新（self-update）**：gateway 写 `~/.mafw/pending-restart.json` 令牌 →
  构建 → 子进程接力重启（TAKEOVER），失败安全不重启。
- **TAKEOVER**：新进程接管分支：等旧进程释放 3000 端口后上线。
