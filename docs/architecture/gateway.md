# MAFW Gateway 架构

> 常驻进程：Pod 协作循环（Lead → Tech Lead → Builder → Reviewer）+ Goal 编排（NodeDriver 状态机）+
> 谐波记忆 + 事件层/常驻存在感 + 自动化引擎 + HTTP API（:3000）/ MCP / 事件流；并监管 opencode serve sidecar。
>
> 时效：2026-11-05 对照源码更新（Pod 协作 Goal Loop、Plan Package / Goal Eval、事件层与 presence、
> Mobile P0、idle 归属与复用会话 grace）。NodeDriver 自 LangGraph 迁移与事件词汇 v2 见 2026-10-16 版。
> 更细的子系统说明见 `docs/architecture/*` 与 `docs/guides/*`（2026-11-10 起根 `AGENTS.md` 只保留索引；
> 本文末尾的「AGENTS.md 归档」是迁移前的原文）。

## 目录

- [代码位置](#代码位置)
- [进程生命周期](#进程生命周期)
- [CLI（bin/mafw.js）](#clibinmafwjs)
- [Runtime 能力契约（多 runtime 接缝）](#runtime-能力契约多-runtime-接缝)
- [Pod 协作 Goal Loop](#pod-协作-goal-loop)
- [Goal 编排：NodeDriver 状态机](#goal-编排nodedriver-状态机)
- [事件层与常驻存在感](#事件层与常驻存在感)
- [统一调度器（scheduler/，内核重构 Phase B）](#统一调度器scheduler内核重构-phase-b)
- [统一会话注册表（session/，内核重构 Phase C）](#统一会话注册表session内核重构-phase-c)
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
│   ├── concurrency/              # 并发原语：Singleflight/MutexQueue/Guard/TtlMap/Watermark（内核重构 Phase A）
│   ├── scheduler/                # 统一调度器：优先级队列 + 冲突策略 + 预算准入（内核重构 Phase B）
│   ├── automation-engine.ts      # cron/事件自动化引擎（action 注册表为实例所有，经 scheduler 提交）
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
│   │   ├── host-adapter.ts       #   re-export `@mafw/runtime-core` 认知面契约（四动词，loopback HTTP）
│   │   ├── event-mapper.ts / canonical-facets.ts / mafw-vocabulary.ts   # 事件映射 + 词汇单源
│   │   ├── identity-registry.ts / identity-state.ts        # agent 身份单一事实源
│   │   └── pi-adapter.ts         #   唯一 `require('@mafw/adapter-pi')` 入口（pi 实现已移出 gateway）
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

**认知面契约（HostAdapter，`@mafw/runtime-core` 的 `host-adapter.ts`）**：跑在 runtime 进程/会话内的
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

## 统一调度器（scheduler/，内核重构 Phase B）

**文件**：`gateway/src/scheduler/`（`task-descriptor.ts` + `scheduler.ts` + barrel）。
设计 spec：`docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md`；
并发原语（Phase A）见 `gateway/src/concurrency/`。

一个优先级任务队列统一管理后台/管线任务的准入与排序（Node 单线程，无可抢占——
调度 = 排队顺序 + 提交时准入 + 启动时资格判定）：

- **优先级**：`foreground > midground > background > idle`。foreground 立即执行、
  永不排队、不受并发帽限制；其余经 pump 按 (优先级, 提交序) 挑选启动。
- **策略**（同 `mutexKey` 冲突时）：`skip`（reject `TaskSkippedError`）、`coalesce`
  （join 在飞任务的 promise，fn 只跑一次）、`queue`（FIFO）、`defer-to-idle`
  （排队但等 foreground 清零才启动）。
- **并发帽**：非 foreground 任务默认最多 4 个同时在飞（`maxConcurrent` 可配）；
  mutex 被占的任务被跳过让位（work-conserving），保持队列位。
- **预算准入**：`submit` 时对带 `budget` 的任务调注入的 checker；`kind:'pipeline'`
  用管线自己的 `PipelineBudget.allow()` 名（extract/reflect/review/reconsolidate/
  dream/axiomDistill），与管线内部 per-LLM-call 检查同源——只是把「跑起来才拒绝」
  提前为「不启动」。拒绝 reject `BudgetExceededError`（AutomationEngine 捕获后
  warn 日志，不向上传播——cron 回调是 fire-and-forget）。
- **watchdog**：`timeoutMs` 从**开始执行**起算（排队等待不烧）；超时 reject
  `TaskTimeoutError` + 释放 key，被弃 fn 继续后台跑（release 语义）。
- **统计**：`stats()` → `{ queued, running, byPriority }`（queued per priority）。

**消费方**：

| 消费方 | 提交形态 |
|---|---|
| AutomationEngine `executeAction` | `background`（cron/event 触发）或 `foreground`（user/llm 触发——交互方在等），`mutexKey: action:<type>`，`skip` + 30min watchdog + taskOpts 预算 |
| index.ts 快照构建 | `midground` + `defer-to-idle`，`mutexKey: 'snapshot'`（Phase A 的 drop→queue 升级为 queue+idle 让位） |
| index.ts compaction flush | `background`，per-session `compact-flush:<sid>` key（与 cron action key 不同，互不阻塞） |

**AutomationEngine 注册表**（同批改造）：action 注册从模块级全局 Map 改为实例所有
（`registerAction` + taskOpts）；builtins（memory:decay/review/prune）在构造时注册并
遵守 live-instance 纪律（`setIndexManagerProvider`/`setGraphProvider` 缺席则 warn 跳过，
**绝不 new 临时副本**——2026-09 衰减冻结与 prune 图被 live 实例回写的教训）；
index.ts 的 7 个管线 action 经 `setActionsProvider` 注册，`start()`/`reloadRules()`
调用 `refreshActions()` 确定性重建。

**本批有意不迁移**（Phase B2 跟进）：
- **NodeDriver 节点执行**：B2 已把其 raw promise-chain mutex 迁到 `MutexQueue`（`advance`/
  `withGoalMutex` 统一 per-goal FIFO）；**scheduler 提交裁决不做**——节点完成是事件驱动
  （turn.completed + 产物文件 + idle 归属 + grace + watchdog），fire-and-forget 派发不适配
  「promise 落定 = 任务完成」的任务模型；per-goal 互斥已由 MutexQueue 提供。
- **RunCoordinator suspend/resume**：不迁——`pendingSuspend` 是 **409 冲突契约**
  （HTTP 显式拒绝），不是调度闸门；`awaitingStart`/`settled`/`suspended` 是运行状态机
  转移，换掉会破坏 API 契约。
- **serve 健康轮询**：不迁——探针循环不可能堆叠（healthCheck 有适配器层超时 + 自带
  `serveRecovering` 标志），是探针循环不是任务闸门。
- **SessionWorkerPool.runExclusive**：per-session promise-dedup（Phase A 已统一到
  Singleflight），不是调度闸门。
- **PodEventWake**：B2 已迁移——scan 经 scheduler `midground` + `coalesce`
  （`mutexKey: 'pod-event-wake'`），定时器 + notify 并发合流，关闭双投递竞态。
- **边界 recall 100ms 路径**：最敏感延迟路径零改动（零新增延迟风险）；foreground 通道
  在生产中由 user/llm 触发的 automation 消费。
- HTTP 诊断端点（`/api/scheduler/stats`）留给 Phase D 诊断面合并。

---

## 统一会话注册表（session/，内核重构 Phase C）

**文件**：`gateway/src/session/`（`scope.ts` + `registry.ts` + `views/`）。
设计 spec：`docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md`（§9 为落地注记）。

网关的**进程表**：一个 sessionID 一条记录，回答「归属 / 状态 / TTL / 世代」。

- **记录**：`SessionRecord { sessionID, scope, status, runtimeName, generation, createdAt, lastActiveAt, ttlMs, expiresAt, metadata }`；`scope.kind ∈ project|goal|probe|worker|lead|internal`。
- **生命周期**：TTL 过期是**惰性**的（lookup/byScope 物化 `ended`，不删记录）；`sweep()` 收集过期记录并触发 **per-record onEvict**（显式 unregister 不触发）。`touch()` 刷新 `expiresAt`（对齐 pool 的按用续期）。世代：active 上重注册=原地更新（scope 可被新 owner 接管、metadata 合并）；ended/回收后重注册 `generation+1`（`retiredGenerations` 有界 stash 10k FIFO）。
- **视图模型**：记录的 **owner**（决定生命周期）vs **overlay**（只在 metadata 上打补丁）。

| 视图 | 角色 | 说明 |
|---|---|---|
| `InternalRolesView`（index.ts） | overlay | `metadata.role`；自建记录 kind `internal`（delete 会整体注销），foreign 记录只清 role、owner 生命周期不动；kv 双写不变 |
| worker-origin（recall/worker-origin.ts） | overlay | `metadata.originSessionID`；默认注册表单例（`getDefaultSessionRegistry`），`clearWorkerOrigins` 区分自建记录与 owner 记录 |
| SessionWorkerPool | owner（worker 会话） | **pair 缓存留在 TtlMap**（以源会话为键——那是用户会话，不能标 kind worker）；**worker 会话**（w-* sid）在 onSessionCreated 注册（role+origin+TTL + per-record onEvict→evictPair）；`evictPair()` 是唯一的守卫式处置入口（TtlMap 访问逐出 / sweeper 记录逐出 / disposeAll 三路收敛，恰好一次）——60s sweeper 现在**独立兜住空闲 pair**，无需 getWorker 访问 |
| LeadSessionRegistry | owner（lead） | observe-only 镜像：bind/ensure 写 kind `lead` 记录（projectId + podId），dead-row 归档注销；全部 Lead 逻辑（kv 行/活性/快照）不动 |
| PodSessionSupervisor | owner（goal 域） | observe-only 镜像：ensure/retire 写 kind `goal` 记录（podId+memberId+goalId+revision，metadata leaseKind/runtime/generation）；租约逻辑（唯一索引兜底/单飞/冲突归因）不动 |

**统一 sweeper**：index.ts 60s `sessionRegistry.sweep()`（与 queueSweepTimer 并列；`sweepBusyAndQueue` 是活跃簿记非进程表状态，保留自己的间隔——spec §9 Key Ruling 7）。

**范围外（裁决）**：`PiSessionRegistry` 已随 neutral runtime driver 迁入 `adapters/pi/src/`（网关外，适配器自治）；`eventTaps`/`probeScopes` TTL 由 Phase A TtlMap 完成；`busySessions`/`recallCalledBySession`（活跃簿记）、memory-worker `compactIdleMs`（prompt 时策略检查）不属于进程表。CI 守卫按「已迁移文件不得回潮裸 Map」钉扎（regression-guard.test.ts）。

---

## MafwScheduler 关键子系统

**文件**：`gateway/src/index.ts`（`class MafwScheduler`，~7500 行）。
主要子系统（细节见 `docs/architecture/*` 对应文档）：

| 子系统 | 位置 | 说明 |
|---|---|---|
| 统一调度器 | `scheduler/` | 优先级队列 + 冲突策略 + 预算准入（见专节，内核重构 Phase B） |
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
| **内置** | usage：`dist/usage/builtin-plugins/*.js`；runtime：`registerBuiltinDefinition('opencode'/'pi')`（`defineRuntime` 定义 + `RuntimeBus`）；media：`registerBuiltinEngine('pi')` |

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

全部挂在 **:3000**（单端口；桌面/TUI/插件同源）。按组列举（完整清单见 `docs/reference/tools.md`）：

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

---

## AGENTS.md 归档：Gateway / 运行 / 运维（2026-11-10 迁移）

> 原文搬迁（未改写），保留当时的决策与验证记录。

#### 统一配置管理

- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值
- 所有端口/URL/超时/路径集中在 `gateway/src/config.ts`
- 环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）

#### 记忆与 Goal 解耦

- `HarmonicUnit.goal_id` 可选 —— 记忆不绑定任何 Goal
- 所有 Hooks 在无 goal 上下文时照常运行
- `recordFeedback` 存储路径已扁平化（`.mafw/feedback/`）；`askUser` 已扁平化（`.mafw/user-questions/{id}.json`，legacy 按 goal 分目录读取兜底）
- `CostEstimator.ToolCallRecord.goalId` 改为可选

#### 记忆融合系统（git worktree）

- `mafw_merge_memory` MCP 工具：MinHash 签名比对（相似度阈值 **0.6**），提取独有记忆（energy=0.4）
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` 在 git merge 前调用 `mergeMemoryFromWorktree()`（读源 worktree 的 harmonic index + OKF，非 legacy memories.json）
- 融合记录写入 `~/.mafw/fusion-log.jsonl`
- HTTP 端点：`POST /api/merge-memory`（插件 `/merge-memory` 命令用，复用 MCP handler）
- CLI 命令：`/merge-memory`；`/worktree-list`、`/worktree-prune` 仅存在于 deprecated legacy 插件路径

#### 文件日志系统

- 插件侧 `installFileLogging()` 劫持全局 `console.log/warn/error`，写入 `<project>/.mafw/logs/mafw.log`（`src/utils/logger.ts`）
- gateway 侧日志写 `~/.mafw/logs/mafw.log`（`gateway/src/core/utils/logger.ts`）
- 格式：`[ISO时间戳] [LEVEL] 原始消息`
- 5MB 自动轮转

#### Gateway 启动顺序

```
start()
  ├─ installFileLogging()              → ~/.mafw/logs/mafw.log
  ├─ claimGatewayInstance()            → ~/.mafw/runtime/gateway.lock
  │   ├─ 拿到锁 → 继续
  │   └─ 已有活实例 → stdout {"mafw":"deferred","instance":…} → exit 0
  ├─ initServices()                    → Memory + Cost + MCP + Automation
  ├─ startApiServer()                  → HTTP API on port 3000
  ├─ publishGatewayDiscovery()         → ~/.mafw/runtime/gateway.json + 10s heartbeat
  ├─ init SDK client                   → @opencode-ai/sdk
  ├─ probe isServeHealthy()            → 先探已有 opencode server
  │   ├─ 通 → 直接复用
  │   └─ 不通 → startServe() → waitForServeReady() ×60s
  │       └─ 超时 → MCP-only mode
  ├─ recoverConfig / recoverRegistry   → 恢复注册表
  ├─ recoverState                      → 恢复活跃 Goal
  └─ automationEngine.start()          → 轮询 + 事件监控
```
Server 启动失败不崩溃，优雅降级到 MCP-only 模式。

#### 单实例所有权与发现

`~/.mafw` 是单写者资源：一个数据目录同时只能有一个 gateway。

- **锁**：`~/.mafw/runtime/gateway.lock`，`O_EXCL` 创建；内容
  `{pid, processStartTime, startedAt, heartbeatAt, nonce}`。陈旧判据 = pid 不存在 /
  同 pid 但启动时间不符 / 心跳超过 30s；绝不靠“端口是否被占”。
- **发现**：`listen` 成功后由 gateway 自己写 `~/.mafw/runtime/gateway.json`
  （实际 `port`、`pid`、`instanceId`、版本、schema、`origin`、`heartbeatAt`），
  每 10s 心跳，退出删除。`origin` 只用于诊断（`standalone` / `desktop-dev` /
  `desktop-packaged`），不参与数据分区。
- **退让**：拿不到锁且发现文件指向活实例时，输出 `deferred` JSON 并 `exit 0`；
  不再用 `GET /health` 200 作为互斥判据。
- **自更新**：`MAFW_TAKEOVER=1` 等待旧实例释放锁（最长 45s），不抢占活锁。

#### Desktop → Gateway 探测连接

`mafw-sidecar.ts:startGateway()` 按 `mafw-gateway-plan.ts` 的优先级决策：
```
probeRunningGateway()
  ├─ 读 ~/.mafw/runtime/gateway.json
  │   └─ 心跳新鲜 → GET <port>/health → pid/instanceId 必须与发现文件一致
  ├─ 没有/过期 → 回落 3000 + GET /health（旧实例迁移期）
  └─ 有候选 → negotiateGateway
       ├─ 兼容 → attach（state="ready"，不 spawn；版本不同只警告）
       ├─ 旧于期望 / schema 不符 → conflict + 「用当前构建重启」
       ├─ 没有 → packaged 且有 resources/gateway/dist/index.js
       │         → bundle：spawn(process.execPath, [entry], ELECTRON_RUN_AS_NODE=1)
       │         → dev：spawn 仓库 gateway/dist
       │         → will-quit 时 taskkill /F /T 树杀（Windows）
       └─ 否则 → cli：execFile("mafw", ["daemon"])（CLI 缺失则 failed）
```
Desktop 不再写 `desktop-gateway/<channel>/*.json`；gateway 自己的发现文件是唯一事实源。
「用当前构建重启」只停止 discovery pid + `/health` 身份都匹配的实例；
legacy 实例只显示 `mafw stop` / `mafw restart` 提示。

运行时健康检查每 30s 一次，连续 5 次失败后自动 restart。

#### Client SDK → Gateway IPC 通道

```
Renderer (SolidJS)                    Main Process                    Gateway
window.api.mafw.{sessions}.{list}()
  └─ ipcRenderer.invoke("mafw-invoke")
       └─ mafw-ipc.ts
            └─ mafwClient[ns][m](...args)
                 └─ fetch("http://localhost:<port>/api/...")
                      └─ Gateway HTTP API
```
Renderer 调用静态类型 API（`window.api.mafw.sessions.list()`），不再用 `invoke(ns, m, args)` 字符串派发。
SSE 事件直接从前端 EventSource 连 gateway，不走 IPC。

`@mafw/sdk` 包位于 `packages/gateway-sdk/`，提供 `MafwClient` 类 + 全部 DTO 类型。

##### Slash 命令注册表（2026-09-18）

`/api/mafw-commands/run` 由硬编码 if 链收敛为注册表（`gateway/src/commands/`）：

- **registry.ts**：`MafwCommandDef`（name/aliases/description/argumentHint/category/destructive/kind）+ `MafwCommandRegistry`（别名解析、重注册覆盖）；5 条内置元数据见 `BUILTIN_COMMAND_DEFS`（new-topic 已退役）
- **builtin-handlers.ts**：6 条内置 handler（deps 注入可单测），语义与原 if 链逐字一致；**custom-exec.ts**：自定义命令执行 = 渲染模板 → promptAsync 到 sessionID（缺省 manager session 兜底）
- **custom-commands.ts**：用户自定义命令——`~/.mafw/commands/`（用户级）+ `<project>/.mafw/commands/`（项目级，同名覆盖用户级），markdown + frontmatter（description/argument-hint），子目录即命名空间（`git/commit.md`→`git:commit`）；模板语法 `$ARGUMENTS`/`$1..$N`/`` !`shell` ``（块内参数 shell 转义防注入，cwd=projectDir、30s 超时、1MB cap）/`@file`（≤100KB，相对 projectDir，防路径逃逸）；`fs.watch` 300ms 防抖热重载，变更广播 `mafw_commands_changed`（扁平顶层事件）
- **GET /api/mafw-commands**：元数据清单（SDK `mafwCommands.list()`）；TUI/Desktop 拉取合并——**本地命令优先**（远端 name/alias 撞本地 name/alias 时隐藏远端，远端 `new-topic` 一律过滤、远端 `status` 在 TUI 隐藏让位本地 recap）；TUI 未命中本地时 fallback 到 `mafwCommands.run` 派发，远端 destructive 命令同样过确认门
- 插件侧 5 个 opencode command 维持静态注册（`/goal` 插件走 requests 文件 skill 流程，与 gateway goal 的 manager-prompt 语义不同——刻意保留两条路径）

#### OpenCode Serve Sidecar（自监管）

opencode serve（4096）由 gateway 以 **sidecar 子进程**方式直接监管
（`gateway/src/serve-sidecar.ts`，替换 SDK `createOpencodeServer` 封装）：

- **spawn 契约与 SDK 完全一致**：`createOpencodeServer` 内部使用 cross-spawn、
  `opencode serve --hostname=127.0.0.1 --port=4096`、env `OPENCODE_CONFIG_CONTENT="{}"`、
  就绪信号 stdout `opencode server listening on <url>`（超时 5s 树杀报错）
- **认证密码稳定化（2026-11-10）**：`resolveServePassword()` 优先级 = env
  `MAFW_RUNTIME_PASSWORD` / `MAFW_OPENCODE_PASSWORD` / `OPENCODE_SERVER_PASSWORD` → 持久文件
  `~/.mafw/serve-password`（`MAFW_SERVE_PASSWORD_FILE` 可覆盖，0600，原子写）→ 生成
  `mafw-<uuid>` 并落盘。gateway 重启/外部 CLI daemon 重启后可用同一密码收养仍在运行的旧
  serve；旧实现每进程随机密码，重启后必然 401 并把旧 serve 留成孤儿。
- **孤儿 serve 清场（2026-11-10）**：启动时 `healthCheck` 失败 → `killServe()`；Windows 必须
  `taskkill /F /T /PID`（裸 `process.kill` 不足以杀掉实际监听子进程），随后等待 500ms 再
  spawn。否则旧 serve 占着 4096，新 gateway 只能退化为 MCP-only，所有 native 调用 401。
- **健康轮询监督**：SDK 不暴露子进程/exit 回调，**owned 与 adopted serve 都走 watchdog**：
  每 30s 探测 `/global/health`，连续 3 次失败 → `recoverServe()` 重启并**重订阅事件流**
  （SSE 建立在 serve 之上，进程重启后必须重连，否则自动化触发器和桌面 SSE 转发全部静默失效）
- **windowsHide 必须显式传**（2026-09-07 黑窗事故）：gateway 以 detached（无控制台）运行时，
  无 `windowsHide: true` 的 spawn 每次都会创建**可见控制台窗口**——用户关窗 = 杀掉 serve，
  watchdog 重启又弹新窗，形成"黑色弹窗关掉还会弹"的循环。SDK `createOpencodeServer` 不传
  windowsHide，故 `serve-sidecar.ts` 已改回**手写 spawn**（保留 SDK 契约：参数、
  `OPENCODE_CONFIG_CONTENT`、ready 行解析、taskkill /F /T 树杀）
- **退避策略**：连续崩溃 streak 1/2/3 次 → 0/5s/15s 快速重试；≥4 次 → 5min 间隔；
  streak 仅在 serve 稳定运行 60s 后清零（防 flapping 热重启）
- **adopted 场景**：gateway 崩溃后孤儿 serve 存活，新 gateway 启动时
  `isServeHealthy()` 探到则**收养**（不重新 spawn），watchdog 同上
- **恢复动作收敛**：共用 `recoverServe()` = `killProcessOnPort(4096)` + `startServe()` + `subscribeToEvents()`
- **手动恢复入口**：`POST /api/runtime/restart-agent`（SDK `runtime.restartAgent()` / Config 页按钮 /
  MCP `mafw_restart_agent`）触发与 watchdog 相同的编排（kill+respawn+事件流重订）；external 模式 503
- 外部 serve 模式（`MAFW_SERVER_SERVE_URL`）不监管（用户管理的进程）
- serve 的 stdout/stderr 由手写 spawn 经 `onOutput` 转发（index.ts 以 `[Serve]` debug 日志记录），
  serve 崩溃原因不再静默；诊断同时依赖 watchdog 的 "Serve unhealthy" / recovery 日志
- **server 启动根（2026-10-29）**：serve 的 cwd **固定 `~/.mafw/runtime-root`**（`runtime/runtime-root.ts`），不再继承 gateway/Electron 的启动目录；`serve-sidecar` 缺省也落到该根。gateway 经 `agentProcess.spawnServe({ rootDir })` 传入，runtime 插件经 `ctx.rootDir` 拿到同一路径（绝对、已确保存在）。该 root **只用于 server/插件初始化**，session cwd 仍只认 `opts.directory`；opencode 会把 root 注册成一个 project（专用目录，非主目录）。gateway **3044/3044（427 suites）**、tsgo/build rc=0；调研 `docs/research/2026-10-29-runtime-server-root-dir-research.md`。
- 经验：子进程型依赖必须配监督（检测点不能在启动时一次完事）；恢复动作必须完整
  （重启进程 ≠ 恢复连接，事件订阅要一并重连）；
  **detached 环境下所有子进程 spawn 必须带 `windowsHide: true`**（python kernel / llamacpp 均已带）

#### 自更新（Self-Update，不依赖 desktop）

gateway 可自行构建新代码并**子进程接力重启**（`gateway/src/self-update.ts`）：

- **触发协议**：`~/.mafw/pending-restart.json`（homedir 控制面）——
  `{ target: "gateway", action: "update"|"restart", reason?, delayMs?, commit? }`；
  原子写（`.tmp` + rename）；gateway 2s 轮询，先删令牌防循环，坏 JSON 连续 5 次后删除
- **更新动作**：`action: update` → 包根 `npm run build`（exit 0 + dist 校验）→ 顺带
  `npm pack` + `npm install -g`（尽力而为，失败不阻塞）；`restart` 跳过构建
- **接力重启**：spawn 新进程（`MAFW_TAKEOVER=1`，同入口 dist）→ 2s 确认存活 →
  优雅 `stop()` + exit；新进程 2s 内崩溃则**取消重启**，旧进程继续服务；
  失败安全：build 失败/坏令牌均不重启
- **TAKEOVER 分支**：跳过单实例守卫 → 等 3000 释放（≤30s）→ 接管 → 更新
  `~/.config/mafw/gateway.pid`（CLI status/stop 继续有效）
- **调用者定位**：事件流中 bash 工具命令含 `pending-restart` 的会话 = 写令牌者
  （确定性）；兜底最近活跃会话
- **完成通知**：新 gateway 启动完成 + recoverState 后，向调用者会话 `promptAsync`
  注入 `[MAFW SYSTEM] 自更新已完成...`（同会话自动续跑）；调用者未知时兜底通知
  **主项目** manager session（不做全项目广播——其他项目 manager 收到只烧 token，
  2026-09-08 修复）；失败 → `notified:false` + 被动续跑（agent 读 last-restart.json）
- **记录**：`~/.mafw/last-restart.json`（reason/commit/requestedAt/sessionID/notified）
- 等价入口：`mafw update` CLI（写同一令牌；无会话上下文 → manager 兜底通知）
- 非目标：git 远端拉取（无 remote）、定时自动更新、进程内热替换（重启 ~2-3s，
  文档声明中断窗口）；dev 模式自举以 dist 为准
- agent 操作手册：`.opencode/skills/mafw-gateway-restart/SKILL.md`（七步流程）

#### Desktop 受管 Gateway（2026-11-09，取代 NSIS npm 更新）

spec `docs/superpowers/specs/2026-11-09-desktop-gateway-managed-runtime-design.md`，plan
`docs/superpowers/plans/2026-11-09-desktop-gateway-managed-runtime.md`。§5.5 中旧的
「adopt → CLI → bundle」启动顺序和 `2026-09-17-desktop-installer-gateway-update-design.md`
的 NSIS 全局 npm 更新已失效。

- **来源**：packaged Desktop 默认 `managed`；只有显式切到 `external` 才使用全局 CLI/已运行
  gateway。旧的无版本 external 只能在 Config 点「仅本次使用未验证外部 gateway」，不持久化。
- **身份/握手**：`/health` 增加 `gatewayVersion`、`experienceVersion`、
  `minimumClientExperienceVersion`、`schemaEpoch`、`channel`、`instanceId`、
  `distribution`。`gateway/dist/release.json` 由 `gateway/scripts/write-release-manifest.mjs`
  从 root version + Experience 常量生成；`gatewayVersion === productVersion`，不再信任
  `gateway/package.json.version`。
- **supervisor**：managed spawn 固定 `MAFW_SERVER_API_PORT=3000`，注入
  `MAFW_DESKTOP_MANAGED/CHANNEL/INSTANCE_ID`，清除 inherited `MAFW_TAKEOVER/GATEWAY_PORT`；
  不写 `~/.config/mafw/gateway.pid`。实例登记在
  `~/.mafw/runtime/desktop-gateway/<channel>/<instanceId>.json`。未登记运行进程显示 conflict，
  绝不静默收养或杀死。`GatewayState` 增加 `conflict`；managed newer/schema/channel 冲突拒绝降级。
- **受管重启**：`pending-restart.json` 在 managed 下只让进程以退出码 **75** 退出，由 Desktop
  child-exit supervisor 拉起当前 payload；不得 detached takeover。source checkout 仍保留原
  build + takeover。
- **版本目录**：`<userData>/gateway/versions/<gatewayVersion>-<payloadDigest前12位>/`，
  `current.json`/`previous.json`/`quarantine.json` 为原子指针。payload 安装先 staging + 逐文件
  SHA-256，再写 `.install-complete.json` 并 rename；同版本不同 digest 不会覆盖运行中的目录。
  启动校验 marker + release/payload manifest + entry/native 文件，全量 hash 只在安装/修复时做。
  坏 payload 写隔离；同 version+digest 不自动重试，Config「重试已隔离版本」才 force；新 digest
  自动放行。`schemaEpoch` 变化失败时不自动回滚，进入阻塞恢复。
- **Desktop 退出/更新**：`autoUpdater.autoInstallOnAppQuit=false`，由 `quit-coordinator` 在
  `before-quit` preventDefault，先等待受管 gateway 退出与端口释放，再 `quitAndInstall` 或退出。
  updater channel 跟随 prod/beta；`allowDowngrade=false`；Windows
  `verifyUpdateCodeSignature=true`。签名证书尚未配置，因此生产自动安装保持 gated。
  Linux 只有 AppImage 支持应用内更新，deb/rpm 交给包管理器。
- **打包**：`scripts/gateway-package-assets.mjs` 是 Desktop/global 共享资产清单（dist、voice、
  root skills、Office scripts、CLI 仅 global）。Desktop staging 原样复制 gateway package.json +
  package-lock，执行 `npm ci --omit=dev`，保留 optionalDependencies；再重建 Electron ABI
  better-sqlite3，生成 `payload-manifest.json` / `release-manifest.json`。Node 基线 `>=22`。
- **验证**：`packages/desktop` 新增 pure manifest/installer/store/lifecycle/handshake/supervisor/
  updater/config 测试与 packaged smoke；CI 在 Win/Linux 打包后分别跑
  `npm run smoke:packaged-gateway -- --app-root dist/<unpacked>`。本地可用
  `npm run smoke:packaged-gateway -- --payload-only`（Electron ABI staged gateway）。
- **Dev 与已运行 gateway**：源码 checkout（`!app.isPackaged`）默认仍走 managed，但发现 3000 上已有
  健康 gateway（通常是全局 `mafw daemon` 或旧 dev 实例）时**直接采纳**（`devAdoptRunningGateway`，
  不登记、不接管所有权、退出时不杀它），避免 dev 与全局 daemon 抢端口。打包版保持原语义：未登记
  进程一律 conflict，绝不静默采纳。要测仓库内 gateway 时设 `MAFW_DEV_ADOPT=0` 强制自己起。
- **本地自签名**（`npm run sign:dev` / `sign:dev:clean`，`scripts/win-self-sign.ps1`）：仅在
  `MAFW_WIN_SELF_SIGN=1` 时启用 `win.signtoolOptions`（`certificateSubjectName` / `publisherName` /
  仅 SHA-256）+ `forceCodeSigning`；`publisherName` 写进 `app-update.yml` 供 electron-updater 校验。
  自签名**只**用于本机验证签名与更新链路，不解决 SmartScreen、不可对外分发；不设该变量时发布构建
  仍为未签名。
- **安装器**：`gateway-update/` 与 `resources/installer.nsh` 已删除；安装器不再要求 Node/npm/
  网络，改用 electron-builder 内建 `CHECK_APP_RUNNING`。
- **安装包冒烟（2026-11-10）**：Windows NSIS 静默安装 → 对安装目录跑
  `smoke:packaged-gateway` → 启动 GUI（隔离 HOME/userData）→ 静默卸载，全绿。修复三处：
  ① electron-builder 的 app-builder 对 **>MAX_PATH 路径**和**非目标平台/架构原生库**是
  **静默丢弃**，而 `payload-manifest.json` 按 stage 目录生成 → 首启校验必然失败。`stage-gateway.ts`
  现在先裁剪 `node_modules` 的 `.d.ts/.d.ts.map/*.js.map/.ts`、`test|tests|__tests__`、非目标
  `onnxruntime-node/bin/*/{platform}/{arch}`，以及无人引用的 `@mistralai/mistralai`
  （shrinkwrap 深路径；裁剪前扫描 `dist/**` 与 `pi-coding-agent/dist/**` 确认无引用），**裁剪后**再生成
  manifest，并加 170 字符相对路径预算（超出直接构建失败）。payload 37,129→17,581 文件，安装包
  444→333MB，首启受管安装约 33s。② `package:win` **不会**重建 `out/`：必须先
  `OPENCODE_CHANNEL=prod npx electron-vite build` 再打包（CI 已如此），否则安装包是 dev 通道 +
  旧主进程（`distribution` 永远 `standalone`）。③ `smoke:packaged-gateway` 新增
  `assertPackagedPayload`：按 manifest 逐文件核对存在性与大小，打包丢文件时 CI 立刻失败。
  实机证据：`versions/5.1.0-fbdbee783d70/.install-complete.json`、
  `~/.mafw/runtime/desktop-gateway/prod/<instanceId>.json`、health `distribution=desktop-managed`。

