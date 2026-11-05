# MAFW Gateway 架构

> 常驻进程：Pod 协作循环（Lead → Tech Lead → Builder → Reviewer）+ Goal 编排（NodeDriver 状态机）+
> 谐波记忆 + 事件层/常驻存在感 + 自动化引擎 + HTTP API（:3000）/ MCP / 事件流；并监管 opencode serve sidecar。
>
> 时效：2026-11-05 对照源码更新（Pod 协作 Goal Loop、Plan Package / Goal Eval、事件层与 presence、
> Mobile P0、idle 归属与复用会话 grace）。NodeDriver 自 LangGraph 迁移与事件词汇 v2 见 2026-10-16 版。
> 更细的子系统说明以根 `AGENTS.md` 为准（本文与其同源，取面向架构读者的视角）。

## 目录

- [代码位置](#代码位置)
- [进程生命周期](#进程生命周期)
- [CLI（bin/mafw.js）](#clibinmafwjs)
- [Runtime 能力契约（多 runtime 接缝）](#runtime-能力契约多-runtime-接缝)
- [Pod 协作 Goal Loop](#pod-协作-goal-loop)
- [Goal 编排：NodeDriver 状态机](#goal-编排nodedriver-状态机)
- [事件层与常驻存在感](#事件层与常驻存在感)
- [MafwScheduler 关键子系统](#mafwscheduler-关键子系统)
- [插件系统（四类型 loader + 统一包宿主）](#插件系统四类型-loader--统一包宿主)
- [API 端点](#api-端点)
- [UI 服务](#ui-服务)
- [数据流全景](#数据流全景)
- [文件系统布局](#文件系统布局)
- [记忆维护管线（当前态）](#记忆维护管线当前态)
- [配置与环境变量](#配置与环境变量)
- [Legacy 附录（LangGraph 编排，已退役）](#legacy-附录langgraph-编排已退役)

---

## 代码位置

```
gateway/
├── bin/
│   └── mafw.js                   # CLI 入口（进程管理、诊断、TUI）
├── src/
│   ├── index.ts                  # MafwScheduler — 主调度器（~7500 行）
│   ├── config.ts                 # 统一配置（三层优先级，MAFW_* 环境变量）
│   ├── automation-engine.ts      # cron/事件自动化引擎 + action 注册表
│   │
│   ├── core/
│   │   ├── goal/                 # Goal 编排（NodeDriver，2026-10-08 P1）
│   │   │   ├── driver.ts         #   每 goal 一个互斥状态机实例（含 askUser 执行 / idle 归属 / grace）
│   │   │   ├── routing.ts        #   纯函数路由（下一节点判定）
│   │   │   ├── state-v3.ts       #   state.json v3（round/loop 双写、原子写）
│   │   │   ├── node-prompts.ts   #   节点 prompt + 产物路径（nodeArtifactPaths，按 revision 隔离）
│   │   │   ├── plan-package.ts   #   waves + goalEval 计划包（planHash / evalHash / packageHash）
│   │   │   ├── review-rubric.ts  #   逐任务 rubric + Goal 条件校验 + acceptance 提取
│   │   │   ├── probe.ts / assignment.ts / goal-identity.ts / wave-plan-edit.ts
│   │   │   ├── node-run-store.ts #   goal_node_runs 表（每次尝试一行）
│   │   │   └── starter.ts / recovery.ts   # goal_created 定位 + watchdog 恢复
│   │   │   # 三节点身份（mafw-plan/execute/review）在 runtime/identity-registry.ts 内置
│   │   ├── pod/                  # 项目鲸群（Pod 协作循环）
│   │   │   ├── pod-store.ts      #   SQLite 7+ 表：pods / members / sessions / goals / revisions /
│   │   │   │                     #     tasks / messages / events / probes / deliveries
│   │   │   ├── pod-service.ts / pod-goal-service.ts / pod-goal-revision-service.ts
│   │   │   ├── pod-tech-lead-service.ts / pod-direction-service.ts / pod-probe-service.ts
│   │   │   ├── pod-session-supervisor.ts / pod-session-lifecycle.ts / lead-session-registry.ts
│   │   │   ├── pod-task-service.ts / pod-message-service.ts / pod-memory-service.ts
│   │   │   ├── pod-event-model.ts / pod-event-service.ts / pod-event-wake.ts / pod-presence.ts
│   │   │   ├── pod-context-select.ts（mcp/handlers）  # 阶段基线 + 授权清单 manifest
│   │   │   └── pod-a2a-bridge.ts / pod-a2a-artifacts.ts  # 外部 Agent handoff
│   │   ├── manager/              # Lead 生命周期兼容（manager-session slot/registry）、goal 快照、/btw
│   │   ├── memory/               # harmonic-index、energy-system、retrieval-events…
│   │   ├── approval/             # 审批三档预设（read-only/auto/full-access）+ 规则沉淀
│   │   ├── budget-guard.ts       # 回合预算硬停（step 切面计数 + 成本）
│   │   ├── diff/                 # 会话 diff hunk 级反转（diffApi）
│   │   └── skills/               # memory-curator agent 定义、Lead agent 配置（manager 为历史别名）
│   │
│   ├── events/                   # 事件日志 / SSE attach / 广播信封（mafw_event + seq）
│   ├── experience/               # Experience Contract（版本化 Action Descriptor，中性 UI 面）
│   ├── mobile/                   # 配对（一次性深链）、设备存储、mDNS、Tailscale URL、
│   │                             #   推送网关、媒体代理、TTS 工件
│   ├── memory/                   # HarmonicUnitFileStore（OKF 读写）、GatewayDatabase、
│   │                             #   ConsolidationService、嵌入运行时（ONNX/llamacpp）
│   ├── recall/                   # 后台记忆召回与管线：
│   │   ├── turn-pipeline.ts      #   turnCompress（每小时）
│   │   ├── reflection.ts         #   reflection（每日，蒸馏 + tentative 验证）
│   │   ├── reconsolidate-pipeline.ts / dream-prefetch.ts   # 再巩固 / 做梦预取
│   │   ├── stale-verify.ts       #   stale 重验（每周）
│   │   ├── fok-gate.ts / parametric-arbiter.ts             # FOK 三区门 / 检索仲裁
│   │   ├── session-worker-pool.ts / memory-worker.ts       # curator worker 会话池
│   │   └── pipeline-rules.ts / pipeline-heartbeat.ts / pipeline-budget.ts
│   ├── runtime/                  # Runtime 能力契约（见专节）：
│   │   ├── contract.ts / validate.ts / loader.ts           # 契约 + 激活校验 + 插件加载
│   │   ├── opencode-runtime.ts   #   内置恒等实现（全能力）
│   │   ├── mafw-tools.ts         #   六件套单源（spec + execute factory + 激活助手）
│   │   ├── tool-classes.ts       #   工具语义类别层（并集表 + runtime 声明 overlay）
│   │   ├── host-adapter.ts       #   认知面契约（四动词，loopback HTTP）
│   │   ├── event-mapper.ts / canonical-facets.ts / mafw-vocabulary.ts   # 事件映射 + 词汇单源
│   │   ├── identity-registry.ts / identity-state.ts        # agent 身份单一事实源
│   │   └── pi/ + plugins/        #   pi runtime 实现 + 适配层
│   ├── mcp/                      # MCP 工具注册表 + handlers（/mcp 双传输）
│   ├── media/                    # A2A Media Agent、pi-adapter、插件引擎加载器
│   ├── python/                   # 持久 Python 内核（Jupyter wire 协议 + ZeroMQ）
│   ├── tts/                      # TTS 引擎注册表（mimo 流式 / kokoro 本地）
│   ├── routes/                   # 独立路由模块（runtime-switch、tools、model-config…）
│   ├── plugins/                  # 统一插件包宿主（package-host/context/types）
│   ├── commands/                 # slash 命令注册表（内置 + 用户/项目自定义）
│   ├── usage/                    # 用量 provider 插件系统（内置适配器 = 同接口 JS 文件）
│   └── orchestration/            # RSI 观测层（capability ledger / failure taxonomy）
```

---

## 进程生命周期

```
mafw start / daemon / desktop adopt
    │
    ▼
MafwScheduler.start()
    ├── installFileLogging()            → ~/.mafw/logs/mafw.log
    ├── initServices()                  → Memory + Cost + MCP + Automation
    ├── startApiServer()                → HTTP API :3000（含 /mcp、SSE）
    ├── createRuntime()                 → runtime 选择 + 激活期校验：
    │     ├── applyRuntimeValidation()  #   声明 vs 实现（hard → 插件回退 opencode）
    │     ├── activateRuntimeTools()    #   推送六件套 factory + nativeTools → 类别 overlay
    │     └── wrapGlobalEventStream()   #   强制翻译接线（原生事件 → canonical 词汇）
    ├── probe isServeHealthy()
    │     ├─ 通  → 收养已有 opencode serve（:4096）
    │     └─ 不通 → serve sidecar spawn（手写 spawn，windowsHide）
    │               就绪信号/健康轮询 watchdog（30s ×3 失败 → recoverServe：
    │               kill + respawn + 事件流重订阅；退避 0/5s/15s，≥4 次 → 5min）
    ├── materializeIdentities()         → IdentityRegistry → runtime agents.install
    ├── recoverConfig / recoverRegistry → 恢复注册表
    ├── recoverState() + recoverGoals() → 恢复活跃 Goal（产物优先 → 会话探测 → 重试）
    ├── Pod 服务                        → PodStore / PodEventService（p3 prune）/ EventWake（5s 首扫 + 60s）
    ├── automationEngine.start()        → cron 轮询 + 事件监控
    └── 自更新轮询                      → ~/.mafw/pending-restart.json（2s，子进程接力重启）
```

Server 启动失败不崩溃——优雅降级到 MCP-only 模式。serve 崩溃/重启由 watchdog 全程监管
（owned 与 adopted 一视同仁）；外部托管模式（`MAFW_SERVER_SERVE_URL`）不监管。

---

## CLI（bin/mafw.js）

| 命令 | 描述 |
|---|---|
| `mafw start` / `daemon` / `stop` / `restart` | 前台 / 后台启动、停止、重启 |
| `mafw status` / `health` / `stats` | 运行状态、HTTP 健康检查、统计 |
| `mafw logs` | 最后 50 行日志 |
| `mafw projects` / `register <dir>` / `goals` | 项目注册表与活跃 Goal |
| `mafw restart-agent` | 重启 agent serve sidecar（POST /api/runtime/restart-agent） |
| `mafw config` / `dashboard` / `version` | 配置、打开 Web Dashboard、版本 |
| `mafw tui` | 终端 UI（pi-tui，四 tab：Chat/Goals/Memory/Triage） |
| `mafw update` | 写自更新令牌（等价 pending-restart.json 路径） |

---

## Runtime 能力契约（多 runtime 接缝）

gateway 与 agent runtime（opencode / pi / 第三方插件）之间是**能力自声明契约**
（`runtime/contract.ts`）：

**Tier 分级**（能力位声明，缺能力只降级不崩溃）：

- Tier 0 = sessionApi + promptWhileBusy + **工具注册通道** → 协作协议 + per-turn 记忆
- Tier 1（+ eventStream）→ 自治执行（Goal 节点）+ per-step 记忆
- Tier 2（+ 桌面 DTO）→ 桌面聊天面完整

**工具注册通道（`RuntimeClient.tools`，Tier-0 必选，无能力位）**：

```
gateway 激活期                              runtime 侧（如 pi）
────────────                              ────────────────
activateRuntimeTools()                     registerTools(factory)   ← stash
  ├─ registerTools(buildMafwToolFactory())   会话创建时 factory(sessionId)
  │    六件套 spec+execute 单源                → 逐条注册进原生工具面
  │    （runtime/mafw-tools.ts）                （parameters JSON Schema
  │                                             → T.Unsafe / MCP inputSchema）
  └─ nativeTools() → setToolClassOverlay()
       runtime 原生工具声明（read/write/agent…）优先于并集表
       （审批只读档 / 身份策略 / 事件 enrich 零改动受益）
```

- **execute 闭包随 spec 走**——执行逻辑全部封装在 gateway（loopback HTTP），第三方
  runtime 只做 ~15 行 plumbing；factory 按会话惰性调用（python 内核/记忆归因有会话亲和性）
- **缺实现 = `validate.ts` hard 拒绝** → 插件回退内置 opencode（激活期报错可见，非运行时深处才炸）
- **out-of-process 通道**：`GET /api/tools`（spec 清单）+ `POST /api/tools/execute`
  （agent 进程无法持有 in-process 闭包时经 HTTP 直达，loopback 门）
- **工具语义类别层**（`tool-classes.ts`）：工具名 → `readonly/search/file-edit/shell/
  subagent/web/plan/other` 并集单表 + runtime 声明 overlay；消费方 = 审批 `isReadOnlyTool`、
  身份 `resolveToolCategory`、事件 `enrichToolClass`（wire `part.toolClass`）
- **热切换**：`POST /api/runtime/switch` 进程内重建 runtime + 事件流重订阅，无需重启

**事件词汇 v2 与强制翻译**：canonical 词汇归 MAFW 所有（`mafw-vocabulary.ts`，
`turn.completed/failed/aborted` 三元组、`part.*`、信封 `mafw_event`）；所有 runtime 的
原生事件流经 `wrapGlobalEventStream` 同一 wrap 序列——声明式映射表（`eventMappings`
纯数据 + `transformEvent` 逃逸口）→ canonical passthrough → 未知遥测；加载期校验 +
`POST /api/runtime/dry-event` 试衣间。

**认知面契约（HostAdapter，`runtime/host-adapter.ts`）**：跑在 runtime 进程/会话内的
宿主适配器对 gateway 的四动词（loopback HTTP，宿主无关）——observe（5s）/ injectContext
（100ms 游标增量）/ injectSystem（150ms）/ tools（六件套）。实现：v1 opencode 插件
（原生同语义）、pi host extension（消费本核心）、v2 待迁移。

**Agent 身份层（IdentityRegistry）**：lead / memory-curator / mafw-{plan,execute,review}（manager 为兼容别名）
收敛为 gateway 持有的 `IdentitySpec`（systemPrompt + policy 中立类别词汇），物化车道
（`agents.install` 渲染成原生格式）+ 绑定（回合/会话级）；网关策略层先于 internal
blanket-deny 评估身份维度（allowlist auto-approve / deny auto-deny）。

---

## Pod 协作 Goal Loop

> 2026-11-02 起，Goal 从「Manager 三节点」升级为项目级 4 人协同：**Lead / Tech Lead / Builder / Reviewer**。
> `core/pod/` 是业务事实源；NodeDriver 仍是执行状态机，但 plan/execute/review 节点由 Pod 角色承载。

### 角色与隐藏会话

| 角色 | 载体 | 职责 |
|---|---|---|
| **Lead** | 项目常驻会话（`coordination` node，可见） | 项目主对话、Goal intake、派工、结果通知 |
| **Tech Lead** | 按 `(goal, revision)` 隔离的隐藏会话 | 需求讨论、方向裁定、Plan + Goal Eval、Spike 探针 |
| **Builder** | 隐藏会话（`mafw-execute`） | 按 waves 实施，产出 receipt |
| **Reviewer** | 隐藏会话（`mafw-review`） | 独立 rubric 评审（逐任务 + Goal 条件） |

Lead/Builder/Reviewer/Tech Lead 都是内部会话（`session-visibility.ts`）：不出现在普通历史列表，
但可通过 Pod transcript 读取。Lead 的权威 = 当前 Pod 的 active `coordination` 会话；
`manager-session` kv 只作 gateway 内部恢复兼容。

### 生命周期

```
直接建 Goal（discussing）
  → Tech Lead 讨论（goal.md / request.json / direction.json）
  →（按需）方向裁定：request → 人类 attention → markClear / 选择后进 planning
  → planning：waves.json + goal-eval.json（Plan Package）
  → plan_review：人工批准（manual 时驻留 AWAIT_PLAN_APPROVAL，绑定 planHash/evalHash）
  → implementing：Builder 按 assignment 执行，产出 receipts
  → reviewing：Reviewer 逐任务 rubric + Goal 条件校验
  → completed：结果通知（p1）→ 用户可打回 → revision N+1（append-only）
```

- **revision 隔离**：`pod_goal_revisions` append-only；rev≥2 的 waves/eval/receipt/review 落在
  `revisions/<goalId>/rev-N/`，旧 revision 证据与产物永不重写；打回只开新 revision
- **Plan Package**：`planHash=computeWavesHash`、`evalHash=computeGoalEvalHash`、
  `packageHash=computePlanPackageHash`；任务板编辑计划会自动作废旧批准（`stale_plan` 409）
- **quick vs collaborative**：quick 只允许一个 task、可免人工批准、不进独立 Reviewer
  （`archive_unreviewed`）；但与 collaborative 一样必须有 `goal-eval.json`——quick 的 eval 由
  driver 从 `waves.tasks[].acceptance` **确定性派生**，不额外消耗模型输出
- **Context Manifest**：`PodContextSelectionService.renderForNode` 强制阶段基线
  （goal/request/direction/waves/goal-eval），Lead 只能追加已授权的跨 Goal 引用；
  清单落 `manifests/rev-<n>-<stage>.md` + sha256，缺失/越权 fail-closed（`context_invalid`）
- **Assignment**：每次派工写不可变 Assignment JSON + `attempt-N.prompt.md`（不覆盖旧 prompt），
  prompt 顺序 `CONTEXT MANIFEST → POD HANDOFF → ASSIGNMENT → 节点正文`
- **Probe / Spike**：单 Pod 单 running、队列上限；探针在隔离 workspace + Builder 会话执行，
  报告原子写 `probes/*.json` 并镜像 `pod_probes`；模式 B（`full_chain`）批准绑定 `packageHash`，
  探针 refutes/未覆盖/计划改写 → 批准作废回 planning
- **Review rubric**：逐任务 `pass|fail|skipped` + evidence，必须覆盖每条必需 Goal 条件；
  漏项/自相矛盾/证据空 → 强制 FAIL（reviewFix/round 修复），只有 JSON 不可解析才走 `artifact_invalid`
- **结果与打回**：PASS 归档后 `notifyResult` 只广播一次 `pod.updated {kind:'result'}`；
  `rejectResult` 先读真实结果证据，再 `finishRevision` + `openNextRevision`（并发打回 409）

### 事件层与 presence（与 Pod 同源）

`pod_events` 是运行时真相（`UNIQUE(pod_id,dedupe_key)` 幂等），`~/.mafw/pods/<id>/events/*.json`
是创建时写一次的审计快照。写点收敛在 `finishPodGoal`（全 verdict）与 `PodStore.insertMessage`
（REST / decision / A2A 三路唯一收口）。

| 分级 | 触发 | 去向 |
|---|---|---|
| p1 | Goal 归档（PASS/FAIL/MAX_RETRIES/ERROR/UNREVIEWED） | 结果通知 / inbox / presence |
| p2 | 成员 `request` / `escalation` 发给 Lead | Lead 唤醒（闸门：暂停/忙/预算/10min 去重） |
| p3 | 其他成员消息（note/decision/review） | 审计；已读 7 天后 prune |

`GET /api/presence` 跨项目聚合 running / attention / unreadResults；worktree Pod 折叠到父项目并
按 `(projectId, goalId, revision)` 去重。桌面 main 15s 轮询（`pod.event` 到达即时催一次），
驱动托盘三态、任务栏进度、OS 通知；通知点击经 `mafw-navigate-goal` 回到 Goal 详情。

---

## Goal 编排：NodeDriver 状态机

> 2026-10-08 P1 起，LangGraph 三件套（graph/checkpointer/interrupt/Command-resume）
> **退役**——换为 state 文件 + 事件驱动的 `NodeDriver`（`gateway/src/core/goal/`）。
> 旧设计见文末 Legacy 附录。

### 设计原则

- **无图引擎**：每 goal 一个互斥状态机实例；`routing.ts` 纯函数定下一节点；
  state.json v3 是唯一持久化（原子写 .tmp+rename）
- **事件驱动完成 + idle 归属**：`void promptAsync`（不 await）+ per-session 完成监听；
  派发时记活动水位（`dispatchSeq`），只有「派发后有过本回合活动（turn.started / part.* /
  message.updated）」的 idle 才收账——陈旧 idle 直接忽略且不消耗 grace
- **双门完成判定**：`turn.completed` **且**（产物文件存在且可解析 **或** Batch 1 结构化交卷）。
  产物缺失/非法 → `failNode(artifact_missing/invalid)` → archive_fail
- **复用会话 grace**：plan 复用 Tech Lead 讨论会话时，讨论回合的迟到 idle 与新节点竞态；
  宽恕一次 + `reuseGraceMs`（默认 90s）兜底——「有活动却迟迟没有 idle」不会卡到 30 分钟 watchdog
- **三节点身份**：`mafw-plan`（deny file-edit/shell/web）/ `mafw-execute`（全开）/
  `mafw-review`（deny file-edit/web，allowlist 含 shell）——复用 IdentityRegistry 物化车道
- **W4 先验注入**：plan 节点 prompt 注入能力账本（同类任务 PASS 率/均轮数/成本）+
  失败模式谱（`cat:failure`/`cat:correction` 蒸馏产物聚类）+ 反事实 pre-mortem
  （D4b：同类失败率/riskNote 要求）

> 2026-11-02 起，plan 的产物升级为 Plan Package（waves + goal-eval，见 Pod 协作 Goal Loop）；
> askUser 的回答/取消由 `PodGoalService`/driver 共同收口，Lead 可经 MCP 自治代答。

```
goal_created 事件 → startGoal（hint > request 扫描 > 首项目）
  → ensureGoalState(state v3) → advance(goalId)
      │  读 state → routing 定下一节点 → 复用/新建角色会话（Tech Lead / Builder / Reviewer）
      │  → promptAsync（不 await）→ writeGoalState(nodeSession) + 活动水位
      ▼
节点完成（idle/error 事件分发 onSessionIdle/onSessionError）
  ├─ idle 归属：没有本回合活动 → 忽略（陈旧 idle，不消耗 grace）
  ├─ 双门判定（turn.completed + 产物 / 结构化交卷）
  │    ├─ 通过 → completeNode → advance（下一节点）
  │    └─ 缺失/非法 → failNode(artifact_missing/invalid) → archive_fail
  └─ watchdog（周期扫描）：产物优先 → 会话探测 → abort + 重试 attempt+1
       （≥maxAttempts → archive_fail；goal_node_runs 每次尝试一行，保留失败历史）
```

### askUser（state 驱动）

`executeAskUser` 写 `QuestionLedger` asked + state.pendingQuestion；回答/取消经
`handleAnswer/handleCancel` 写 state.userResponse/nextNode → advance。Lead 可经
`mafw_list_pending_questions` / `mafw_answer_question` 自治代答；手机/桌面共享同一
`/api/questions` 面（「需要你」应答）。

### Trace 与观测

- `goal_node_runs` 表（gateway.db：goal/loop/node/attempt/session/status/outcome/
  tokens/cost）——watchdog 重试 = 新行新 attempt
- `goal_node` SSE 事件（扁平顶层广播：goalId/projectDir/loop/node/transition/verdict…）
  → desktop 泳道图实时刷新（行=plan/execute/review，列=loop）
- `GET /api/goals/:id/timeline`（node_runs ⋈ state 聚合）、
  `POST /api/goals/:id/nodes/:runId/retry`（confirm 门）
- legacy 并存：`core/skills/mafw-*/entry.ts` + 插件 `/goal` 命令链保留
  （`state_change` 唤醒走 driver.advance 幂等）；旧 langgraph 代码已标 deprecated

---

## MafwScheduler 关键子系统

**文件**：`gateway/src/index.ts`（`class MafwScheduler`，~7500 行）。
主要子系统（细节见 AGENTS.md 对应章节）：

| 子系统 | 位置 | 说明 |
|---|---|---|
| serve sidecar 监管 | index.ts + 契约 | spawn/收养、watchdog、recoverServe、事件流重订阅 |
| Runtime 能力契约 | `runtime/` | Tier 0-2 + 必选工具通道；opencode 内置 / pi 插件 / 热切换（见专节） |
| 事件映射注册 | `runtime/event-mapper.ts` + `canonical-facets.ts` | 纯数据表（原生→canonical）+ facet 规则表；`path-expr.ts` 安全求值；工具三原语合帧（`tool-part-assembler.ts`） |
| 谐波记忆 | `memory/` + `core/memory/` | OKF 存储、BM25/hybrid 检索、能量（ACT-R 检索加成）、巩固层语义合并 |
| 记忆管线 | `recall/` | turnCompress / reflection / reconsolidate / dream / stale 重验 / skill 物化 / 公理蒸馏（见专节） |
| MCP 服务 | `mcp/` | 40 工具；/mcp 双传输（无状态 StreamableHTTP + legacy SSE） |
| 审批三档 | `core/approval/` | read-only / auto / full-access + 持久规则沉淀（`~/.mafw/permission-rules.json`） |
| 回合预算 | `core/budget-guard.ts` | step 切面计数 + TrajectoryStore 成本 → 超限 abort + noReply 通知 |
| Lead 生命周期 | `core/manager/` + `core/pod/` | per-project Lead registry、goal 快照、里程碑推送、/btw、/waitwhat；人工 new-topic 已退役 |
| Pod 协作循环 | `core/pod/` + `core/goal/plan-package.ts` | Goal revisions、Tech Lead 讨论/方向、Plan+Goal Eval 批准、Probe、Assignment、rubric review |
| Pod 事件层 | `core/pod/pod-event-*.ts` + `routes/presence.ts` | `pod_events` 分级、`/api/presence` 跨项目聚合、Lead 唤醒闸门、托盘/任务栏/通知 |
| Mobile 接入 | `mobile/` + `routes/mobile` | 一次性配对深链、设备存储、mDNS、Tailscale URL、推送网关、媒体/TTS 代理 |
| Media Agent | `media/` | A2A 协议、四模态、每模态可插拔引擎 |
| Python 内核 | `python/` | Jupyter wire 协议（ZeroMQ）、Mutex 队列、TTL 回收 |
| TTS | `tts/` | 引擎注册表（mimo 云流式 / kokoro 本地 ONNX）+ 打断传播 |
| 语音管道 | desktop `voice/` | Silero VAD + barge-in + AudioWorklet 流式播放 |
| 用量插件 | `usage/` | 8 内置 provider 适配器 + 用户插件目录 |
| 统一插件包 | `plugins/` | PluginHost：一包多贡献（usage/media/runtime/uiTools/tts），见下节 |
| 命令注册表 | `commands/` | slash 命令（内置 6 条 + 用户/项目自定义 markdown 模板，热重载） |
| 自更新 | self-update | pending-restart 令牌 → build → 子进程接力重启 |
| RSI 观测层 | `orchestration/` | goal_outcomes / goal_sessions / capability ledger / failure taxonomy |

---

## 插件系统（四类型 loader + 统一包宿主）

Gateway 侧插件按能力分四种类型，各有 loader 与目录（**legacy 面，行为不变**），
由统一包宿主 **PluginHost** 收敛为"一包多贡献"：

```
~/.mafw/plugins/                     ~/.mafw/{usage,media,runtime}-plugins/     内置件
  my-vendor.js / my-vendor/            （legacy 目录，各 loader 自扫自 watch）    opencode / pi
  └─ activate(ctx) → 贡献                     │                                      │
        │                                     ▼                                      ▼
        ▼                              ┌──────── loader 内置注册 ────────────────┐
  ┌───────────────── PluginHost ────────────────────┐   │ RuntimePluginLoader / PluginLoader │
  │ 扫描 → 激活 → setPackageEntries() 推送 ──────────┼──▶│ / MediaPluginLoader                │
  │ 顶层 + 每包子目录双 watcher（跨面原子 reload）    │   └────────────────────────────────────┘
  └──────────────────────────────────────────────────┘
```

| 优先级（同名） | 说明 |
|---|---|
| **包**（`~/.mafw/plugins/`） | PluginHost 推送（`setPackageEntries`），最高 |
| **legacy 目录文件** | 各 loader 自扫，用户同名文件覆盖内置（原有语义） |
| **内置** | usage：`dist/usage/builtin-plugins/*.js`；runtime：`registerBuiltin('opencode'/'pi')`；media：`registerBuiltinEngine('pi')` |

- **包形态**：单文件 `name.js` 或目录 `name/plugin.json`（`{name, version?, main?}`）；
  声明式 `{ name, usage?, media?, runtime?, uiTools?, tts? }` 或
  `async activate(ctx) → contributions`
- **统一 ctx**：三 legacy ctx 超集——`apiKey` / `fetch`(60s) / `log` / `pluginConfig` /
  `projectDir` / `gatewayPort` / `usage.modelStats` / `emit`（全 UI 通道广播自定义事件）
- **runtime 插件开发**：`.opencode/skills/runtime-plugin-authoring/SKILL.md`（Tier 分级、
  事件映射表、工具注册通道、conformance 场景四件套）
- 限制：包 reload 只清主文件 `require.cache`（改包内 `lib/` 需 `mafw restart`）；
  env `MAFW_PLUGINS_DIR` 覆盖包目录（测试）

---

## API 端点

全部挂在 **:3000**（单端口；桌面/TUI/插件同源）。按组列举（完整清单见 AGENTS.md §5）：

| 组 | 代表端点 |
|---|---|
| 健康/事件 | `GET /health`、`GET /api/events`（SSE 订阅）、`POST /api/events`（发布：顶层扁平或 `mafw_event` 信封，全 UI 通道） |
| 项目/会话 | `POST /register`、`GET /api/projects`、`GET /api/sessions`、`GET /api/manager/session`、`POST /api/manager/session/rotate` |
| Pod / 工作 | `GET /api/projects/:id/work`（五桶 overview）、`GET/POST /api/pods/:id/goals`、`/tech-lead`、`/direction-decision`、`/probes`、`/revisions`、`/result`、`/reject`、`POST /api/pods/:id/goals/handoff` |
| 事件/存在感 | `GET /api/presence`、`GET /api/pods/:id/events`、`POST /api/pods/:id/events/:eventId/seen`（单条）、`POST /api/pods/:id/events/seen`（body `{goalId, revision}` 清当前 revision） |
| Experience | `GET /api/experience/actions`（版本化 Action Descriptor，客户端不硬编码 runtime 名） |
| Goal 编排 | `POST /api/work/{goalId}/validate`、`POST /api/control`（PAUSE/ABORT）、`GET /api/goals/:id/timeline`（节点泳道）、`POST /api/goals/:id/nodes/:runId/retry`、`POST /api/goals/:id/plan-approval` |
| Mobile | `GET /api/mobile/pairing-code`、`POST /api/mobile/pairing/verify`、`GET /api/mobile/tts/artifacts/:id` |
| 记忆 | `GET /api/recall/context`、`GET /api/recall/pinned`、`GET /api/recall/priors`、`POST /api/obs/capture`、`POST /api/memory/add`、`GET /api/memory/search`、`GET /api/memory/stats`（含管线心跳） |
| 基础工具 | `GET /api/tools`（六件套 spec 清单）、`POST /api/tools/execute`（通用执行，loopback 门） |
| MCP | `POST/GET /mcp`（双传输） |
| 运行时 | `GET /api/runtime`、`POST /api/runtime/switch`、`POST /api/runtime/restart-agent`、`POST /api/runtime/dry-event`（事件试衣间）、`POST /api/runtime/conformance`（场景一致性） |
| 会话分支/diff | `POST /api/sessions/:id/fork`、`POST /api/sessions/:id/revert`、`GET /api/sessions/:id/diff`（diffApi 门） |
| 媒体/TTS | `POST /a2a`、`GET /a2a/artifacts/:id`、`POST /api/tts/stream`、`POST /api/tts/interrupt` |
| Python | `POST /api/python/execute`、`POST /api/python/restart` |
| 审批/权限 | `GET /api/approvals`、`POST /api/permissions/:id/reply`、`GET/POST /api/permission-mode`、`GET/POST/DELETE /api/approvals/rules` |
| 用量/配置 | `GET /api/usage`、`GET/POST /api/model-config`、`GET/POST /api/memory/embedding-config` |
| 插件中心 | `GET /api/plugins`（含 `packages`）、`POST /api/plugins/install|enable|disable|delete` |
| 命令 | `GET /api/mafw-commands`（清单）、`POST /api/mafw-commands/run`（注册表派发：内置 + 用户/项目自定义） |
| 观测 | `GET /api/orchestration/outcomes`、`GET /api/agent/capabilities`（能力账本 + 失败谱） |

---

## UI 服务

- **Desktop（packages/desktop，Electron）**：主 UI。左侧 Rail + 右侧 **Agent 工作台**
  （工作 / 工作台 / 执行 / 审阅）+ 可拖拽聊天列（520/640/760 档位）+ Focus 模式；
  经 `@mafw/sdk` 走 `window.api.mafw.*` IPC → HTTP :3000；SSE 直连 gateway；
  自带 gateway bundle（adopt → bundle → cli 三级决策）；托盘三态/任务栏进度/OS 通知（点击
  经 `mafw-navigate-goal` 直达 Goal）；Goal 详情 = 统一结果/计划审阅/方向/时间线
- **Mobile（mobile/，Flutter）**：Tailscale 直连（`http://<machine>.<tailnet>.ts.net:3000`）；
  工作五桶、Goal 详情、Tech Lead 讨论、「需要你」应答；一次性配对深链
  （`GET /api/mobile/pairing-code`）；v1 不做息屏离线推送（打开才看）
- **TUI（mafw tui）**：pi-tui 四 tab，纯 HTTP/SSE 客户端（markdown 渲染、鼠标点选、
  远端命令合并）
- **Web Dashboard**：退役——UI 职责由 Desktop 与 `mafw tui` 承担

---

## 数据流全景

### Goal 从创建到完成（Pod 协作 + NodeDriver）

```
用户 / Lead → 建立讨论型 Goal（pod_goals + revision 1）
  → Tech Lead 讨论 →（按需）方向裁定 → Plan Package（waves + goal-eval）
  →（manual）人工批准 planHash/evalHash → AWAIT_PLAN_APPROVAL 放行
  │
  ▼
NodeDriver: plan ⟶ (askUser) ⟶ execute ⟶ review ⟶ routing 判定
  │  各节点：复用 Tech Lead 会话 / Builder / Reviewer → promptAsync → idle 归属判定
  │  双门判定：turn.completed + 产物/结构化交卷
  ▼
Reviewer rubric：
  PASS → archive_success（pod_events p1 → 通知/inbox；goal_outcomes + 记忆能量奖励）
  FAIL → 未超限 → plan 修复/重试（loop+1）/ 超限 → archive_fail（同样 p1）
用户打回 → openNextRevision（append-only）→ revision 2 从 discussing 重走
```

### 记忆事件流（两条正交通道）

```
观察捕获：宿主适配器 / 插件 hooks（用户消息/工具后/text.complete…）
    → POST /api/obs/capture（脱敏入库）→ gateway.db t1_observations
    → turnCompress（每小时）→ curator worker → mafw_add_memory

边界 recall：injectContext（每次 LLM 调用前）
    → GET /api/recall/context（100ms 契约，预取快照优先）
    → <recall> 指针块注入（synthetic 标记防回流）
```

---

## 文件系统布局

两级数据根（goal 面在项目，记忆面在全局）：

```
<project>/.mafw/                     # per-project（Goal 与请求面）
├── state/{goalId}.json              # goal 状态视图 v3（NodeDriver 唯一写入方）
├── state/revisions/<goalId>/rev-N.json   # 旧 revision 状态快照（打回后归档）
├── waves.json                       # wave 计划（plan 产物）
├── goal-eval.json                   # Goal Eval（plan 产物；quick 由 acceptance 派生）
├── manifests/rev-<n>-<stage>.md     # Context Manifest（sha256 记录）
├── revisions/<goalId>/rev-N/        # rev≥2 的 waves/goal-eval/receipts/reviews 隔离目录
├── probes/*.json                    # Spike 探针报告（原子写）
├── tasks/  receipts/{goalId}/       # execute 产物（per-loop receipt）
├── reviews/{goalId}-loop{N}.md      # review 产物（per-loop；含 rubric JSON）
├── requests/                        # 请求配置
├── commands/                        # 项目级自定义 slash 命令（markdown 模板）
├── logs/mafw.log                    # 插件侧文件日志
└── user-questions/                  # ask_user 记录（flat）

~/.mafw/                             # 全局数据根（config.resolvePath()）
├── memory/
│   ├── concepts/{semantic|episodic|procedural|global|knowledge}/
│   │                                # OKF 记忆（每条一个 Markdown：frontmatter+正文）
│   ├── .harmonic_index.json         # 检索索引（纯可推导产物）
│   ├── vectors-<model>.json         # dense 嵌入（opt-in，按 provider 打标）
│   └── gateway.db                   # 统一数据库：t1_observations、kv_store、pod_*、
│                                    #   goal_outcomes、goal_sessions、goal_node_runs…
├── pods/<podId>/
│   ├── memory/{POD.md,POD_MEMORY.md,glossary.md}   # 项目鲸群共享记忆
│   └── events/*.json                # 事件审计快照（DB 为真相；p3 已读 7 天 / 文件 30 天 prune）
├── automations/*.json               # 自动化规则（管线 cron 幂等供给）
├── commands/                        # 用户级自定义 slash 命令
├── skill-staging/                   # skill 物化草稿（SKILL.md 人审区）
├── permission-rules.json            # 审批持久规则（always 沉淀）
├── logs/                            # mafw.log（5MB 轮转）+ consolidation-pairs /
│                                    #   approval-decisions / arbiter-samples / fok-samples .jsonl
├── plugins/                         # 统一插件包（一包多贡献；PluginHost 扫描/watch）
├── runtime-plugins/  usage-plugins/  media-plugins/  ui-plugins/  tts-plugins/
│                                    # legacy 目录（行为不变，优先级低于包）
├── pending-restart.json  last-restart.json   # 自更新控制面
└── fusion-log.jsonl                 # 跨 worktree 记忆融合记录
```

> 历史注：LangGraph 时代的 `<project>/.mafw/checkpoints/` 已随编排引擎退役；
> 早期 `.opencode/mafw/` 与 `memory/tier2|3|4.json` 分层布局亦废弃。

---

## 记忆维护管线（当前态）

### 管线与自动化规则（全部走 PipelineBudget 日预算门 + heartbeat 记账）

| 管线 | 规则（cron，UTC） | 职责 |
|---|---|---|
| turnCompress | 每小时 | per-session 完成回合 → 持久 worker 自主 `mafw_add_memory`（交错回放对照） |
| reflection | 每日 3:00 | 跨回合模式蒸馏（semantic/procedural）+ tentative 草稿验证（快慢系统） |
| 能量衰减 | 每日 3:30 | 增量时间衰减 + ACT-R 检索访问结算 + CATD 拓扑半衰期 |
| reconsolidate | 每日 4:30 | 被检索记忆进入 24h labile 窗口，与更新同 cue 记忆对照重写 |
| dream | 每晚 2:00 | 近 24h 活跃会话生成"下次可能问" → 预取快照 |
| stale 重验 | 每周日 4:00 | 高价值记忆只读重验（环境探测式，失真走 supersedes） |
| skillPromotion | 每周日 5:00 | 高频 procedural 记忆五闸门 → SKILL.md 物化草稿（人审） |
| axiomDistill | 每周日 6:00 | 高 need insights 蒸馏为 L5 公理候选（triage 人审） |

### 环境探测式记忆维护（arXiv:2609.11060）

post-task curator 只看轨迹存在"回顾性证据边界"。落地四点：

- **只读探测面**：curator 工具白名单 = 三个记忆工具 + `read/grep/glob/list/ls/find`
  并集；`edit/bash/webfetch` 保持 deny——mutation 防线不变
- **propose–probe–commit**：项目相关记忆写入前 ≤3 次探测验证；矛盾以环境为准并
  supersedes；只记可复用过程、不记实例答案
- **置信度约定**：探测验证过的记忆 cue_anchors 带 `verified:YYYY-MM-DD`
- **成败信号**：goal verdict/thumbs 经 `getOutcomeForSession()` 拼入 worker prompt

### Worker 会话治理（session 风暴防线）

`SessionWorkerPool`：lazy 创建、pipeline 互斥、per (session,kind) 防并发、TTL 24h
物理删除、硬帽 64、idle 8h summarize 控 token；`internalSessionRoles` 对 UI 隐藏；
`/api/obs/capture` 白名单防 worker 输出回流 T1（递归风暴）。

---

## 配置与环境变量

三层优先级：**环境变量 > `<project>/.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值**。
所有端口/URL/超时/路径集中在 `gateway/src/config.ts`；环境变量以 `MAFW_` 为前缀，
路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）。

| 变量 | 作用 |
|---|---|
| `MAFW_SERVER_API_PORT` / `MAFW_GATEWAY_PORT` | API 端口（默认 3000 / 探测链） |
| `MAFW_SERVER_SERVE_URL` | 外部托管 opencode serve（不 spawn、不监管） |
| `MAFW_RUNTIME_PLUGIN` | 激活 runtime 插件（如 `pi`；覆盖 config.runtime.plugin） |
| `MAFW_PLUGINS_DIR` | 覆盖统一插件包目录（默认 `~/.mafw/plugins/`；测试隔离） |
| `MAFW_SEARCH_RETRIEVER` | 检索器回退（`token`；默认 bm25） |
| `MAFW_PYTHON_BIN` | 覆盖 Python 内核解释器 |
| `MAFW_TAKEOVER` | 自更新接力分支（跳过单例守卫，等端口释放） |
| `MAFW_TUI_PORTS` | TUI 探测端口覆盖（测试隔离） |

可能落在 `config.yaml` 的移动/编排键：

- `mobile.tailscaleUrl`：配对深链优先使用的 tailnet URL（env > config > 自动探测；热更配对服务）
- `goal.techLeadModel`：Tech Lead 会话模型（provider/model 对）；建会话后 fail-open `bindModel`，
  lazy getter 热生效
- `mobile.push` / `mobile.mediaProxy`：推送网关与媒体代理（实验/可选）

热生效边界：`config.yaml` 变更 watcher 2s 防抖自动 reload，`runtime` 段变更触发热切换；
`server`/`paths` 段变更需重启。

---

## Legacy 附录（LangGraph 编排，已退役）

2026-09-14 ~ 2026-10-08 期间，Goal 编排采用 LangGraph StateGraph + FileCheckpointer
+ interrupt/Command-resume 三件套（`gateway/src/core/langgraph/`）：

- **图结构**：`plan → (askUser) → execute → review → routeAfterReview`，
  节点 `interrupt('awaiting_*')` 挂起，插件完成事件经 `graph.invoke(new Command({}))` 恢复
- **FileCheckpointer**：继承 `BaseCheckpointSaver`，checkpoint 落
  `<project>/.mafw/checkpoints/{goalId}/step_*.json`；重启后 `resumeStaleThreads()` 恢复
- **verdict 机器可读契约**（`review-parser.ts` 的 ` ```mafw-review ` 围栏 JSON，无文本
  fallback）——该契约沿用至今（review 节点产物解析）

退役原因：图引擎与 state 文件双源真相、interrupt/Command 恢复链在事件流重启后脆弱、
checkpoints 与产物文件语义重叠。NodeDriver 以 state v3 + 产物双门判定 + goal_node_runs
取代（见正文专节）；`chat/graph-runner.ts` / `core/mcp/tools.ts` / `poll.ts` 等标注
deprecated，物理删除待后续 PR。历史细节见 git 历史中的本文旧版（≤ 2026-10-08）。
