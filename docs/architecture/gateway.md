# MAFW Gateway 架构

> 常驻进程：Pod 协作循环（Lead → Tech Lead → Builder → Reviewer）+ Goal 编排（NodeDriver 状态机）+
> 谐波记忆 + 事件层/常驻存在感 + 自动化引擎 + HTTP API（:3000）/ MCP / 事件流；并监管 opencode serve sidecar。
>
> 时效：2026-11-05 对照源码更新（Pod 协作 Goal Loop、Plan Package / Goal Eval、事件层与 presence、
> Mobile P0、idle 归属与复用会话 grace）。NodeDriver 自 LangGraph 迁移与事件词汇 v2 见 2026-10-16 版。
> 2026-11-11 E1 止血波（14 项确定性缺陷修复）见「E1 止血（2026-11-11）」节；
> 交付记录 `docs/releases/2026-11-11-gateway-e1-stabilization.md`。
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
- [长效目标（Standing Goals）](standing-goals.md)
- [统一调度器（scheduler/，内核重构 Phase B）](#统一调度器scheduler内核重构-phase-b)
- [统一会话注册表（session/，内核重构 Phase C）](#统一会话注册表session内核重构-phase-c)
- [MafwScheduler 关键子系统](#mafwscheduler-关键子系统)
- [插件系统（四类型 loader + 统一包宿主）](#插件系统四类型-loader--统一包宿主)
- [HTTP 路由分发（内核重构 Phase D1 现状）](#http-路由分发内核重构-phase-d1-现状)
- [内核拆分（Phase D3 现状：entry / boot / kernel / HTTP）](#内核拆分phase-d3-现状entry--boot--kernel--http)
- [E1 止血（2026-11-11）](#e1-止血2026-11-11)
- [E4 资源台账（2026-11-11）](#e4-资源台账2026-11-11)
- [E7 部署前 deferred 收口（2026-11-13）](#e7-部署前-deferred-收口2026-11-13)
- [E8 剩余工程债收口（2026-11-13）](#e8-剩余工程债收口2026-11-13)
- [E9 交互补齐（2026-11-13）](#e9-交互补齐2026-11-13)
- [E10 契约覆盖第一批（2026-11-13）](#e10-契约覆盖第一批2026-11-13)
- [E10b 契约覆盖第二批（2026-11-13）](#e10b-契约覆盖第二批2026-11-13)
- [E10c 契约覆盖第三批（2026-11-14）](#e10c-契约覆盖第三批2026-11-14)
- [E10d 契约覆盖第四批（2026-11-14）](#e10d-契约覆盖第四批2026-11-14)
- [E10e 契约覆盖第五批（2026-11-14）](#e10e-契约覆盖第五批2026-11-14)
- [E10f 全量读表面收口（2026-11-14）](#e10f-全量读表面收口2026-11-14)
- [E10g 请求契约（P0 + W1 + W2/W3 + W4 + W5 + W6 + W7 + W8，2026-11-14）](#e10g-请求契约p0--w1--w2w3--w4--w5--w6--w7--w82026-11-14)
- [E10h 写响应契约（P0 + R1–R6，2026-11-15）](#e10h-写响应契约p0--r1r62026-11-15)
- [E10i 错误响应契约（P0 + E1 + E2 + E3，2026-11-15）](#e10i-错误响应契约p0--e1--e2--e32026-11-15)
- [E10j 交互与版本协商补齐（2026-11-16）](#e10j-交互与版本协商补齐2026-11-16)
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
│   ├── index.ts                  # 33 行入口：require.main bootstrap + `export { MafwScheduler }`（内核重构 D3）
│   ├── kernel.ts                 # class MafwScheduler — 组合根 + initServices（~6200 行；见「内核拆分」D3）
│   ├── boot.ts                   # bootKernel(kernel) + BOOT_STEPS（27 步启动序列，D3 Task 5）
│   ├── http-router.ts            # HTTP facade：re-export createRequestListener / createWsHub（D3）
│   ├── http/transport.ts         # createRequestListener — CORS → auth → registry → transport → 反代（D3 Task 3）
│   ├── http/ws-upgrade.ts        # createWsHub — /api/ws / voice / terminal / plugin WS + 心跳（D3 Task 3）
│   ├── server/event-hub.ts       # EventHub — broadcast / setupEventBus / sseClients / wsClients（D3 Task 7）
│   ├── subsystems/               # api-routes.ts（attachAllRoutes 编排）+ dashboard-legacy.ts（R5 兜底，D3 Task 4/6）
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
│   │   ├── neutral-runtime.ts / runtime-facade.ts / runtime-bus.ts   # 中性门面 / 总线
│   │   ├── adapter-bridge.ts     #   通用 legacy→neutral 桥（opencode 包内有本地副本）
│   │   ├── opencode-adapter.ts   #   唯一 `require('@mafw/adapter-opencode')` 入口（驱动已移出 gateway）
│   │   ├── pi-adapter.ts         #   唯一 `require('@mafw/adapter-pi')` 入口（pi 实现已移出 gateway）
│   │   ├── provider-transport.ts #   scan 路径 provider baseURL/key 优先级（credentials → driver → gateway 链）
│   │   ├── mafw-tools.ts         #   六件套单源（spec + execute factory + 激活助手）
│   │   ├── tool-classes.ts       #   工具语义类别层（并集表 + runtime 声明 overlay）
│   │   ├── host-adapter.ts       #   re-export `@mafw/runtime-core` 认知面契约（四动词，loopback HTTP）
│   │   ├── event-mapper.ts / canonical-facets.ts / mafw-vocabulary.ts   # 事件映射 + 词汇单源
│   │   ├── event-dispatch.ts     #   handleRuntimeEvent 的 23 段有序 stage 表（D2 起步 24 段；E3-2 删 Mode B）
│   │   └── identity-registry.ts / identity-state.ts        # agent 身份单一事实源
│   ├── mcp/                      # MCP 工具注册表 + handlers（/mcp 双传输）
│   ├── media/                    # A2A Media Agent、pi-adapter、插件引擎加载器
│   ├── python/                   # 持久 Python 内核（Jupyter wire 协议 + ZeroMQ）
│   ├── tts/                      # TTS 引擎注册表（mimo 流式 / kokoro 本地）
│   ├── routes/                   # 独立路由模块（40 个 attach* 入口 / 38 个文件 → RouteRegistry；见「HTTP 路由分发」）
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
MafwScheduler.start() → boot.ts bootKernel(kernel)
    ├── installFileLogging()            → ~/.mafw/logs/mafw.log
    ├── initServices()                  → Memory + Cost + MCP + Automation
    ├── startApiServer()                → HTTP API :3000（http/transport.ts + http/ws-upgrade.ts）
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

**opencode 驱动的物理边界（Plan 6）**：opencode 实现全部在 workspace 包
`adapters/opencode`（`@mafw/adapter-opencode`）：dialect 探测与 v1/v2/v21 事件表、canonical
消息、history wire→flat、MCP（运行时 + JSONC 编辑）、PTY、snapshot/checkpoint、后台任务、
serve 子进程监管、`auth.json` 凭据与 inline provider settings、legacy→neutral 组装
（`definition.ts` + 包内 `legacy-definition.ts` 副本）。gateway 只剩
`runtime/opencode-adapter.ts` 一个 fail-soft 包入口（缺包时一次性 warn + 能力全 false 的
静态回退，激活抛可诊断错误让组合根回退），因此 `gateway/src` 里不再有 opencode 驱动文件、
也不再有任何第二处 `require('@mafw/adapter-opencode')`（`neutral-runtime-boundaries` 守卫）。
包内不得 import `gateway/src`（只允许 `@mafw/runtime-contract` / `@mafw/runtime-core` /
`@opencode-ai/sdk` / `jsonc-parser` / `cross-spawn` / Node 内置 / 本地模块）。

组合根与驱动之间只有契约里声明的 host 接缝：`ctx.serve`（gateway 请求的 serve listener，
adapter 缺省 `127.0.0.1:4096`）、`ctx.rootDir`（serve cwd）、`ctx.credentials`（凭据快照）、
`proxyHeaders`（adapter 产出 serve Basic-auth 头，gateway 反代优先用它、`serveAuthHeaders()`
只作 fail-safe 兜底）与 `resolveProviderTransport`（scan 路径 provider 解析，gateway 保持
credentials 优先）。翻译归属保持「self-vs-declared」：驱动自报
`eventMappings`/`transformEvent`（声明式），gateway 只做校验、映射与 canonical passthrough，
不认识任何原生 payload 字段名。

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
| p1 | Goal 归档 PASS/UNREVIEWED（`goal.result`，audience human） | 结果通知 / inbox / presence |
| p1 | Goal 归档 FAIL/MAX_RETRIES/ERROR（`goal.failed`，audience lead） | Lead 唤醒 + `failed` attention；同时写 Tech Lead failure handoff |
| p2 | 成员 `request` / `escalation` 发给 Lead | Lead 唤醒（闸门：暂停/忙/预算/10min 去重） |
| p3 | 其他成员消息（note/decision/review） | 审计；已读 7 天后 prune |

`goal.result` 与 `goal.failed` 的 dedupe key 都带 event kind
（`goal.result:<goalId>:r<N>` / `goal.failed:<goalId>:r<N>`），互不顶账。

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
`mafw_list_pending_questions` 列出待决问题；**回答只能由人类做**（手机/桌面经
`/api/questions` 面 + human/device 凭据 → `goals.respondQuestion` / `questions.reply`）。
MCP 不提供 `mafw_answer_question`（E7 review 已删除，见下「human-only」小节）。

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
| kernel.ts 快照构建 | `midground` + `defer-to-idle`，`mutexKey: 'snapshot'`（Phase A 的 drop→queue 升级为 queue+idle 让位） |
| kernel.ts compaction flush | `background`，per-session `compact-flush:<sid>` key（与 cron action key 不同，互不阻塞） |

**AutomationEngine 注册表**（同批改造）：action 注册从模块级全局 Map 改为实例所有
（`registerAction` + taskOpts）；builtins（memory:decay/review/prune）在构造时注册并
遵守 live-instance 纪律（`setIndexManagerProvider`/`setGraphProvider` 缺席则 warn 跳过，
**绝不 new 临时副本**——2026-09 衰减冻结与 prune 图被 live 实例回写的教训）；
kernel.ts 的 7 个管线 action 经 `setActionsProvider` 注册，`start()`/`reloadRules()`
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
| `InternalRolesView`（kernel.ts） | overlay | `metadata.role`；自建记录 kind `internal`（delete 会整体注销），foreign 记录只清 role、owner 生命周期不动；kv 双写不变 |
| worker-origin（recall/worker-origin.ts） | overlay | `metadata.originSessionID`；默认注册表单例（`getDefaultSessionRegistry`），`clearWorkerOrigins` 区分自建记录与 owner 记录 |
| SessionWorkerPool | owner（worker 会话） | **pair 缓存留在 TtlMap**（以源会话为键——那是用户会话，不能标 kind worker）；**worker 会话**（w-* sid）在 onSessionCreated 注册（role+origin+TTL + per-record onEvict→evictPair）；`evictPair()` 是唯一的守卫式处置入口（TtlMap 访问逐出 / sweeper 记录逐出 / disposeAll 三路收敛，恰好一次）——60s sweeper 现在**独立兜住空闲 pair**，无需 getWorker 访问 |
| LeadSessionRegistry | owner（lead） | observe-only 镜像：bind/ensure 写 kind `lead` 记录（projectId + podId），dead-row 归档注销；全部 Lead 逻辑（kv 行/活性/快照）不动 |
| PodSessionSupervisor | owner（goal 域） | observe-only 镜像：ensure/retire 写 kind `goal` 记录（podId+memberId+goalId+revision，metadata leaseKind/runtime/generation）；租约逻辑（唯一索引兜底/单飞/冲突归因）不动 |

**统一 sweeper**：kernel.ts 60s `sessionRegistry.sweep()`（与 queueSweepTimer 并列；`sweepBusyAndQueue` 是活跃簿记非进程表状态，保留自己的间隔——spec §9 Key Ruling 7）。

**范围外（裁决）**：`PiSessionRegistry` 已随 neutral runtime driver 迁入 `adapters/pi/src/`（网关外，适配器自治）；`eventTaps`/`probeScopes` TTL 由 Phase A TtlMap 完成；`busySessions`/`recallCalledBySession`（活跃簿记）、memory-worker `compactIdleMs`（prompt 时策略检查）不属于进程表。CI 守卫按「已迁移文件不得回潮裸 Map」钉扎（regression-guard.test.ts）。

---

## MafwScheduler 关键子系统

**文件**：`gateway/src/kernel.ts`（`class MafwScheduler`，~6200 行；入口/启动/HTTP 拆分见「内核拆分」D3）。
主要子系统（细节见 `docs/architecture/*` 对应文档）：

| 子系统 | 位置 | 说明 |
|---|---|---|
| 统一调度器 | `scheduler/` | 优先级队列 + 冲突策略 + 预算准入（见专节，内核重构 Phase B） |
| serve sidecar 监管 | kernel.ts + 契约 | spawn/收养、watchdog、recoverServe、事件流重订阅 |
| Runtime 能力契约 | `runtime/` + `adapters/opencode` | Tier 0-2 + 必选工具通道；opencode 驱动在包内（`@mafw/adapter-opencode`）、gateway 只留 `runtime/opencode-adapter.ts` shim / pi 插件 / 热切换（见专节） |
| 事件映射注册 | `runtime/event-mapper.ts` + `canonical-facets.ts` | 纯数据表（原生→canonical）+ facet 规则表；`path-expr.ts` 安全求值；工具三原语合帧（`tool-part-assembler.ts`） |
| 谐波记忆 | `memory/` + `core/memory/` | OKF 存储、BM25/hybrid 检索、能量（ACT-R 检索加成）、巩固层语义合并 |
| 记忆管线 | `recall/` | turnCompress / reflection / reconsolidate / dream / stale 重验 / skill 物化 / 公理蒸馏（见专节） |
| MCP 服务 | `mcp/` | 40 工具；/mcp 双传输（无状态 StreamableHTTP + legacy SSE） |
| 审批三档 | `core/approval/` | read-only / auto / full-access + 持久规则沉淀（`~/.mafw/permission-rules.json`） |
| 回合预算 | `core/budget-guard.ts` | step 切面计数 + TrajectoryStore 成本 → 超限 abort + noReply 通知 |
| Lead 生命周期 | `core/manager/` + `core/pod/` | per-project Lead registry、goal 快照、里程碑推送、/btw、/waitwhat；人工 new-topic 已退役 |
| Pod 协作循环 | `core/pod/` + `core/goal/plan-package.ts` | Goal revisions、Tech Lead 讨论/方向、Plan+Goal Eval 批准、Probe、Assignment、rubric review |
| Pod 事件层 | `core/pod/pod-event-*.ts` + `routes/presence.ts` | `pod_events` 分级、`/api/presence` 跨项目聚合、Lead 唤醒闸门、托盘/任务栏/通知 |
| 长效目标（Standing Goals） | `core/standing/` + `routes/standing-goals.ts` | cron/event/manual 触发 → GoalRun 分流 → 复用普通 Goal；预算/并发/审批闸门（`MAFW_STANDING_GOALS=1`） |
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

## HTTP 路由分发（内核重构 Phase D1 现状）

> 2026-11-10 对照源码更新。设计：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md` §5.2；
> 交付记录：`docs/releases/2026-11-10-gateway-kernel-d1-routes-batch2.md`。

请求在 `startApiServer()` 的单个 `http.createServer` 回调里按**固定顺序**流动：

```
OPTIONS → CORS 预检 204
→ 鉴权（loopback 直通 / MAFW_SERVER_API_TOKEN bearer）          401
→ RouteRegistry dispatch（dispatchAuthorized）— attach 过 handler 的 (method, path) 接管
→ 插件 Web 通配面（ui/* 与 api/*；registry 只支持精确段数）
→ 文件级历史（loopback-only）
→ legacy if 链残量（transport + dashboard 兜底，见下表）
→ 反代 serve（其余一切）
```

**顺序是契约**：registry 必须在鉴权之后（内部路由不得绕过 token 门），也必须早于
legacy 链——`goals.sessions` 先于 dashboard 兜底、`memory/embedding-config` 先于
`/api/memory/*` 委托、`sessions.*/permissions` 先于会话兜底等顺序依赖，由 dispatch
位置一次性满足（替代 AGENTS §6.5 那类「靠分支顺序 + 正则锚定」的隐式契约）。

**路由模块**：`gateway/src/routes/` 下 38 个文件、40 个 `attach*` 入口，向 `RouteRegistry`
（`routes/registry.ts`；catalog = `routes/route-catalog.ts`，278 条 `operationId`）挂
**208 个 handler**。每个模块 = `attach<Domain>Routes(registry, deps)`，handler 体从
index.ts **逐字**搬迁（状态码 / 响应形状 / fail-open / 405-else 臂全保留；`session.get` 缺失的
200-not-404 已在 E10-3 改为 404），
`this.x` 一律换成 **live getter** `() => this.x`（boot 后重赋的字段不能捕快照）。
新增路由 = catalog 条目（`operationId` + method + path-template）+ `attachHandler`，缺一不可达；
path-template 里 `{id}` 是字面量、只有 `:param` 才是参数（registry 拆分后 decodeURIComponent）。

**委派契约（load-bearing）**：handler 委派给既有 handler 模块时必须 `return` 委派
promise：`return handleX(req, res, req.url!, deps)`。`dispatchAuthorized` 把 `undefined`
视为「已处理」，因此 `if (await handleX(...)) return;` 会吞掉委派方的 `false`
（fall-through 契约）——请求既不写响应也不落反代，客户端挂死。D1 期间这类 bug 出现 3 次
（`sessions.background` / `mcp.*` / `session.messages`），现各有回归测试逐条钉住。

**D1 结束后 legacy 链只剩四类**（`tests/unit/architecture/legacy-route-inventory.test.ts`
以 24 = 10 match + 14 equals 钉死，group 级逐组钉：transport 11 组 + `/api/memory` 4 +
`/api/goals` 3 + `/api/stats` 2）：

| 残量 | 分组 | 归属 |
|---|---|---|
| transport / 静态 / MCP / 根路径 | `/a2a`、`/.well-known`、`/a`、`/assets`、`/static`、`/`、`/index.html`、`/mcp`、`/register`、`/control`、`/health` | **D3**（`http-router.ts`：auth → registry → 404；不进 RouteRegistry） |
| dashboard 兜底（R5） | `/api/goals`、`/api/stats`、`/api/memory` 联合 `startsWith` + `handleDashboardAPI` | 保留：四个明确影子条目已 registry-first（`goals.list` / `dashboard.stats` / `memory.add` / `memory.setSticky`），其余路径行为不变 |
| `/api/goals/control`（原 R6 死臂） | `POST /api/goals/control` | **E1-4 已修复**：registry 的 `goals.control` handler 在 dispatch 阶段接管（与 `/control` 共用 `handleGoalControlCommand`）；dashboard 兜底只服务其余未实现形状（`/api/goals/:id/loops` 等，R5 保留） |
| runtime-config | `GET/PATCH /api/runtime-config` | **D3 Task 2 已迁**：`routes/runtime-config.ts` 挂 `runtime.config.get` / `runtime.config.update`（原幻影条目转实）；GET `{ config }` / PATCH `{ status:'ok', config }` 包络、`provider.config(.update)` 门与 503/500 语义逐字随迁，runtime / runtimeHost 走 live getter。analyzer 从不计数这段 helper 分发（R9 盲区），故 24 基线不变；`/api/ws` upgrade 仍归 D3 Task 3 |

`index.ts` 从 **10098 行（D1 起点 `ed2e998e`）降到 8204 行**（−1894 / −18.8%），减掉的
全是分支体；迁移留下的 tombstone 注释（`// <METHOD> <path> — Phase D1 Task <X>：已迁
registry dispatch。`）当时留在原位，D3 Task 3/9 已连同 `startApiServer` 搬入
`http/transport.ts` 并整体删除（历史见 `docs/releases/` + git）。

---

## 事件分发（内核重构 Phase D2 现状）

> 2026-11-10 对照源码更新。设计：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md`
> §5.3（拓扑）、§5.4（seq 空间，见 Ruling D2-R4）；交付记录：
> `docs/releases/2026-11-10-gateway-kernel-d2-event-dispatch.md`。

`handleRuntimeEvent`（原 `handleOpencodeEvent`，e46a75fa 改名）不再是 index.ts 里的
277 行顺序敏感 if 链，而是一条 **facet/state 门控的 stage pipeline**，表在
`gateway/src/runtime/event-dispatch.ts`：

```
kernel.ts handleRuntimeEvent(evt)
  = normalizeRuntimeEvent(evt) → runEventPipeline(f, evt, buildDispatchCtx())
```

- **数组位置就是执行顺序**（Ruling D2-R1）：`DISPATCH_STAGES` 是 **23 段**的有序数组
  （D2 原文 24 段；E3-2 删除 Mode B 转发段后为 23），没有冗余 `order` 字段；拓扑断言一律
  `stageIndex(name)` 比较（名字是稳定锚点）。
- **`matches` = legacy 块级 if，`run` = 块体逐字**（`this.x` → `ctx.x()`；ctx 全为
  **live getter**）：`DispatchCtx` **25 个成员** = 24 个 live getter + 1 个
  `setTokenWriterSession` 写回口；`buildDispatchCtx()` 在 kernel.ts 里 30 行。
- **只有三段可以 HALT**（legacy 的 `return`；HALT 停掉全部下游）：

| # | stage | 门 | 语义 |
|---|---|---|---|
| 1 | `nativeDrop` | `RUNTIME_NATIVE_DROPPED` | opencode v2 sync 信封等状态重同步噪声，边界丢弃 |
| 2 | `toolPrimitiveDrop` | `TOOL_PRIMITIVE_TYPES` | 工具三原语属 assembler 内部入口，漏到这里即丢弃 |
| 16 | `internalFilter` | memoryWorker 且非 turn 终态 | index-scan / extract / reflect 的 token 噪声不出站；**三终态放行**（`TURN_TERMINALS`） |

其余 20 段都是 add/observe（enrich、tap、审批、权限投影、checkpoint、终态清理、
trajectory、compaction flush、budget、回合聚合、passthrough）。

- **零 await**：整链同步；approval 的 `policy.evaluate` 保持同步契约
  （`policy-service.ts:10`），autoCheckpoint / compact flush / queue flush 仍
  fire-and-forget；**不新增 pipeline 级 try/catch**（legacy 没有，段内各自 fail-open）。
- **不在 D2 范围**（D3 材料）：`broadcast()`、`setupEventBus()`、`subscribeToEvents()`、
  `emitNodeEvent`、RuntimeBus。

**拓扑测试**（`tests/unit/runtime/event-dispatch.test.ts`，33 条；表位置 + 行为双钉）：

- 注释级次序契约变成断言（Ruling D2-R3）：`approvalPolicy < internalFilter`、
  `conformanceTap < internalFilter`、`autoCheckpoint < internalFilter`、
  `enrichToolIdentity < conformanceTap`、`internalFilter < trajectoryHandle`、
  `finalBroadcast` 恒为最后一段、`nativeDrop < toolPrimitiveDrop`。
- 内部会话 drop 语义（非终态无帧无 trajectory 无 last-active；终态仍出站且带
  `internal: true`）、派生广播先于 passthrough（`trajectory.event → trajectory.turn
  → usage.updated → turn.completed`）、终态 4 步微观次序（budget → busy →
  `runCoordinator.onTerminal` → queue flush）、审批同步评估、enrich 先于 tap 快照。
- **恰好三段可 halt**：按 `run` 函数体里的 halt 信号结构化断言为
  `{nativeDrop, toolPrimitiveDrop, internalFilter}`（不引入第二个名单常量）。
- 矩阵交叉校验（Ruling D2-R2）：两个丢弃门的命中集**恰好等于**矩阵声明的
  `RUNTIME_NATIVE_DROPPED` / `TOOL_PRIMITIVE_TYPES`；丢弃类型不进客户端矩阵但仍是
  「已知类型」（drop ≠ unknown 遥测）。
- 边界守卫 `tests/unit/runtime/architecture-boundaries.test.ts`：组合根（D2 时是 `index.ts`，
  D3 后是 `kernel.ts`）不再含链体（`enrichToolIdentity(` / `applyApprovalPolicy(` / 两个 `.has(`
  门缺席），只留 `normalizeRuntimeEvent → runEventPipeline` 接线点；链体内容在表模块里成对断言。

**Ruling D2-R4（spec §5.4 降级）**：broadcast seq 空间**已经统一**——`broadcast()`
是 EventStore 的唯一 sink（`server/event-hub.ts` 内同步 `eventStore?.append()` 分配 seq，
`part.delta` 不占号），eventBus 的扁平发射（`FLAT_EMITTERS` 注册表，10 类）与 canonical
`mafw_event` 信封共用同一条单调 seq；`tests/unit/events/broadcast-seq.test.ts` 对这个
混合序列（扁平 → 扁平 → 信封 = seq 1/2/3）直接钉扎。**eventBus 是内部 ingress**，不对外；
**全量消费者迁移**（automations / startGoal / advance 改为从 EventStore 回放消费）另立
spec —— 它需要幂等设计与不受 retention 裁剪的影子流（`event_log` 会 prune，今天这些
消费者不是幂等的），不在 D2 内承诺。

---

## 内核拆分（Phase D3 现状：entry / boot / kernel / HTTP）

> 2026-11-11 对照源码更新。设计：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md`
> §3 / §5.1 / §5.5 / §7；交付记录：`docs/releases/2026-11-10-gateway-kernel-d3.md`。

`gateway/src/index.ts` 从 **8120 行降到 33 行**，只剩入口职责（Ruling D3-R7；类名仍是
`MafwScheduler`，测试与文档依赖它）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.ts` | 39 | 日志 + `import { MafwScheduler } from './kernel'`；`export { MafwScheduler }`；`require.main === module` 时先 `registerCrashHandlers()`（E1-11）再 `new MafwScheduler().start()` |
| `kernel.ts` | 6345 | `class MafwScheduler`（组合根）：字段 / `initServices()` / 子系统方法；不再内联 HTTP 分发 |
| `boot.ts` | 1027 | `bootKernel(kernel)` = 原 `start()` 逐字（83 成员 `BootKernel` 视图）+ `BOOT_STEPS` 27 步有序声明（D3-R6：DB-open-before-migration 气味只记录不修） |
| `http-router.ts` | 42 | spec §5.1 HTTP facade：re-export `createRequestListener` / `TransportDeps` / `createWsHub` / `WsHub`（无逻辑、无分发） |
| `http/transport.ts` | 478 | `createRequestListener(deps)`：CORS/OPTIONS → auth → registry → plugin web → file history → transport 分支 → dashboard 兜底（顺序保留；`/api/goals/control` 自 E1-4 起由 registry 接管）→ `/register` → `/control` → `/health` → 反代 → 500 |
| `http/ws-upgrade.ts` | 203 | `createWsHub(server, deps)`：`/api/ws` / voice / terminal / plugin WS 上行 + 30s 心跳 + 60s push 维护；`dispose()` 由 `shutdown()` 收口 |
| `server/event-hub.ts` | 145 | `EventHub`：`broadcast()` / `setupEventBus()` / `sseClients` / `wsClients`（D3-R4；kernel 保留同名委托方法，70+ 闭包调用点未动） |
| `subsystems/api-routes.ts` | 820 | `attachAllRoutes(deps)`：47 条 attach（46 个 `attach*` + 1 条 typed route），顺序 46/46 原样；lead/pod 外来货物逐字 |
| `subsystems/dashboard-legacy.ts` | 248 | `handleDashboardAPI`（R5 兜底）逐字；transport 经 `dashboardDispatch` 依赖调用 |
| `runtime/event-dispatch.ts` | 615 | 23 段 stage 表（E3-2 删 Mode B 后；D2 历史为 24 段） |

**启动序列（`boot.ts BOOT_STEPS`，27 步，数组顺序即执行顺序）**：

| 阶段 | 步骤 |
|---|---|
| 身份 / 租约 / 服务 | `boot.metadata` → `instance.ownership` → `services.init` → `shipped.assets` → `eventbus.setup` → `question-ledger.reconcile` |
| HTTP / 发现 | `http.listen` → `instance.discovery` |
| runtime | `runtime.loader` → `plugin.host` → `runtime.activate` → `serve.ensure` → `serve.watch` |
| 注册表 / 迁移 | `registry.recover` → `datadir.migrate` → `gatewaydb.migrate` → `constraints.migrate` → `legacy-t1.archive` |
| Goal / 自动化 / 观察 | `identities.materialize` → `goal.driver` → `state.recover` → `lead.ensure` → `automation.start` → `worker.restore` → `backup.poll` → `watchers` |
| 自更新 | `self-update.watch` |

顺序是**抽取即原样**（D3-R6）：`requires` 只做声明，不在启动期断言；`registry.recover` 先于
`gatewaydb.migrate` 的「DB-open-before-migration」存量气味已记录，行为等价优先，不在 D3 修。

**路由残量**：`node scripts/analyze-routes.cjs` 对 `index.ts` 的 TOTAL = **0**（D1 收尾 24 →
D3 Task 3 的 5 → Task 4 的 0）。D3-R2 把 `.match` / `.startsWith` 纪律收口到
`index.ts` + `http-router.ts` + `http/*`：transport 的 19 个 dispatcher 由
`tests/unit/architecture/legacy-route-inventory.test.ts` 在 `http/transport.ts` **就地**钉扎
（exact 12 + prefix 6 + artifact slot 1），dashboard 的 5 个在 `subsystems/dashboard-legacy.ts`
钉扎；`/api/ws` 不在 HTTP 链上（`http/ws-upgrade.ts`）。

**WS 是 live-only 通道（E2-4）**：`connected` 帧携带 `headSeq`（event store 缺失时为 `null`），仅用于标识实时流的衔接位置；WS 本身**不回放**，重连恢复走 SSE 游标（`?since` / `Last-Event-ID`）、REST 快照，或（E5b 起）`GET /api/events/replay` 的 seq 游标补页——移动端默认「先 replay，补齐不了才全量重拉」。

**D3 验收（spec §7 字面）**：

| 条件 | 状态 |
|---|---|
| `index.ts < 1000 行` | ✅ 33 行 |
| `boot.ts` / `kernel.ts` / `http-router.ts` / `subsystems/` 存在 | ✅ |
| API routes registry-only | ✅ catalog 全量 handler 化；index/transport 零 `/api/*` 路由分发（transport 只留 transport 级分支） |
| transport 收口在 http-router | ✅ 分发只在 `http/transport.ts`；`http-router.ts` 仅 re-export |
| 守卫 | ✅ `kernel-split-guards.test.ts` 7/7（index < 1000、模块存在、零 dispatch、entry shape、无环） |

**合入 main（2026-11-11 merge reconciliation）**：D3 分支携带的是 lead/pod P2 早先快照，合入
主线（含 P2 最终线 + adapters phase4）时按类解决 32 个冲突面里的实际 10 个：
外来功能文件取主线版本；`gateway/src/index.ts` 取 D3 的 33 行入口；`route-catalog.ts` 两侧
改动集合逐字相等（无需并集，297 ops 无重复）；SDK `client.ts` 取主线类型导入超集
（192 个调用键 = 主线 ∪ 分支）。主线在 `index.ts` 上的功能增量（adapters phase4 的
`builtinAdapterRegistrations` 注册循环 / `proxyHeaders` / `resolveScanProviderTransport` /
T1 `searchT1` 家族 / goal pause-resume-retry 控制面 / 主题记忆提升 / provenance
`sourceTraceIds` 等 34 个 hunk）按 D3 抽取边界**逐段落位**：启动期注册循环 → `boot.ts`，
组合根状态与路由接线 → `kernel.ts`，反代头 → `http/transport.ts`（`deps.proxyHeaders()`），
dashboard `memory.add` 影子条 → `subsystems/dashboard-legacy.ts`，MCP `searchT1` →
`subsystems/api-routes.ts`。**（历史）** D2 抽取时的 24 段 stage 表与主线内联链体**逐段等价**
（无新增段）；E3-2 删除 Mode B 后为 23 段。

**合入 main P2.4 事件层（Round 2, 2026-11-11）**：主线 `901ed772..7ee50700` 的
`index.ts` 增量（+258/−71）同样逐段落位——事件层服务/字段/`initServices` 装配与
`ingestInternalEvent` / `processEventThread` → `kernel.ts`；`setupEventBus()` 的三条
internal 订阅 + memory 三类事件 → `server/event-hub.ts`（经 `deps.ingestInternalEvent`）；
`attachEventRoutes`（source/thread/subscription/delivery + GitHub webhook HMAC）→
`subsystems/api-routes.ts`；`skillsDir()` / `runtimeConfigDir()` 改由 adapter 声明
（`discovery.roots()`）；`DEFAULT_BUILTIN_RUNTIME` 取代 `'opencode'` 字面量与
`opencodeExternalMode()` 取代 env 直读（`boot.ts`）；凭据链收窄为 runtime credentials
（adapter 兜底移入包内）。事件层说明见 `docs/architecture/events.md`。

**D4 遗留**（Ruling D3-R1：spec §3 的 `index < 100` / `kernel ~400` / `subsystems ~300` 不在
D3 承诺内）：`initServices()`（1104 行）拆分到 `subsystems/*`、kernel 按注册面再分解、
`subsystems/` 粒度、`EventTapCallback` 类型化、三个 entry 负向 pin（`core-runtime-neutrality`
的剥离器样本等）。

### kernel-v2（2026-11-12，Phase 0/1/2/3 已交付）

路线 B：`gateway/src/kernel-v2/` **进程内并行模块**，不接 live gateway、不碰 `~/.mafw`；独立 v2 入口（`MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`）只提供 `/health`、`/api/tts/voices`、`/api/usage` 的只读 shadow。v1 `MafwScheduler` 仍是默认/fallback，直到 cutover gate 通过。

Phase 0/1 已交付：

- `manifest.ts`：纯 manifest 校验（plane/kind/provides/integrity）。
- `capability-registry.ts`：scope（global/project/session）、tier、priority、health、cache、diagnostics、LIFO dispose、单条 remove。
- `provider-lifecycle.ts`：load → validate → resolve → activate → drain → dispose；safe mode/degraded；untrusted fail-closed。
- `providers/tts.ts`、`providers/usage.ts`：只读 adapter。
- `main.ts` / `facade.ts`：独立 v2 入口，缺失 env 拒绝启动；`usage.json` record/replay，不 live fetch。
- `scripts/kernel-v2-shadow.mjs`：v1/v2 normalized JSON 对比。

Phase 2 叶子 provider（S3 → media → ASR → commands → notifications → automation action）：

- `subprocess-ledger.ts`：子进程所有权（provider/external）、状态、LIFO dispose、失败隔离。
- `probes/asr-subprocess.ts`：S3 证明 provider 可以拥有 sidecar；失败启动无 orphan、adopted 进程不 kill、health 缓存。
- `providers/media.ts`：media engine 解析；unknown/unsupported/unhealthy fallback 与 v1 `resolveMediaPrompt` 一致。
- `providers/asr.ts` / `providers/asr-sidecar.ts`：ASR engine registry + sidecar provider 绑定；health 失败自动回退 package tier。
- `providers/commands.ts`：command source 合并（builtin → legacy → package），坏 source fail-open。
- `providers/notifications.ts`：出站通知 fan-out；核心 `broadcast()` 不变，单 channel 失败隔离。
- `providers/automation.ts`：automation action provider；cron/规则校验仍在核心 `AutomationEngine`。
- 5 个 conformance kit + 5 个测试包 fixture：`gateway/tests/helpers/kernel-v2/*`、`gateway/tests/fixtures/kernel-v2/*`。

Phase 3 agent tools + observer（S5 → tools → G3 harness）：

- `observer.ts`：只读 canonical observer registry；`dispatch()` 同步入队、`setImmediate` 调度、per-observer timeout、bounded queue、fail-open。
- `canonical-event.ts`：EventFacets → 脱敏快照；剔除 token/secret/password/prompt/credential，深度/长度/数组上限。
- `tools.ts`：`ToolContributionRegistry`；命名空间 `plugin:<package>:<tool>`、global/session scope、timeout、unknown/unhealthy/handler throw 全部转 tool error，输出 `MafwToolRegistration`。
- `packages/plugin-contract`：`PluginGatewayContributes.tools` + `PluginToolDescriptor` 校验（additive）。
- 2 个 conformance kit + 2 个测试包 fixture；G3 harness 用 fake runtime 证明工具可调用、observer 收到 tool 事件且坏 observer 不阻塞。

Phase 3.5 live wiring（2026-11-12，默认关闭）：

- 唯一 bridge `runtime/v2-live.ts`：live 代码中只有它能 import `kernel-v2/**`；`kernel.ts` / `boot.ts` 只 import bridge。
- `MAFW_KERNEL_V2_OBSERVERS=1`：`event-dispatch.ts` 在 `conformanceTap` 之后、`internalFilter` 之前增加 `canonicalObserverTap` stage；事件经 `toCanonicalEvent` 脱敏后进入 observer registry。`dispatch()` 同步返回，失败 fail-open。
- `MAFW_KERNEL_V2_TOOLS=1`：`activateRuntimeTools` 在 builtin 六件套之后合并 `ToolContributionRegistry.factory()` 的 `plugin:<package>:<tool>`；merge 抛错只回退 builtin。
- `MafwScheduler.registerCanonicalObserver()` / `registerPluginTool()` 暴露显式注册口；flag 关闭时抛带 env 名称的错误。
- 两个 flag 都关闭 → bridge 为 `null`，v1 事件链/tool factory 与 Phase 3 一致。
- 仍未开放 interceptor。

Phase 3.6 plugin host 自动注册（2026-11-13，默认关闭）：

- 统一插件包 `activate()` 可返回 `tools` / `observers`；`package-validator` 校验后进入 `ActivatedContributions`，不再留在 `legacy`。
- `PluginHost.bindKernelV2(cb)` 在 commit 后发布 `PluginToolEntry[]` / `PluginObserverEntry[]`（含 revision）；remove/disable/stop 发布空数组。
- `runtime/v2-live.ts` 的 `syncPluginContributions()` 按 `package:name` / `package:id` diff：新 revision 替换旧 handler，消失的条目退订。
- Tool 命名空间 `plugin:<package>:<tool>`；observer id `plugin:<package>:<observer>`；handler 永不进入 client descriptor。
- 包 tool 本阶段只允许 `scope: 'global'`；`scope: 'session'` 在校验阶段失败。
- 仍不自动交叉校验 `plugin.json` 的静态 `contributes.gateway.tools` 与 `activate()` 返回；静态声明目前只用于未来 client 诊断。

门禁：Phase 3.6 定向 **531 / 531**；gateway 全量 **7005 passed / 1 skipped / 7006 total**，run 4/5 连续 clean（run 1/3 的 worktree 5s timeout 在负载下偶发，单文件重跑通过）；typecheck 通过。各 phase 交付记录见 `docs/releases/2026-11-12-capability-kernel-phase{1,2,3,3-5}.md` 与 `docs/releases/2026-11-13-capability-kernel-phase3-6.md`。runbook 见 `docs/guides/kernel-v2-cutover.md`。

- 架构 spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Phase 0/1 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase0-1.md`
- Phase 2 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md`
- Phase 3 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-agent-tools-observer.md`
- Phase 3.5 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-5-live-wiring.md`
- Phase 3.6 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-plugin-host-auto-registration.md`
- 不变量 → 守卫：`docs/research/2026-11-12-kernel-v2-invariant-map.md`
- S5 结论：`docs/research/2026-11-12-s5-canonical-event-observer-probe.md`
- 交付记录：`docs/releases/2026-11-12-capability-kernel-phase1.md`、`docs/releases/2026-11-12-capability-kernel-phase2.md`、`docs/releases/2026-11-12-capability-kernel-phase3.md`、`docs/releases/2026-11-12-capability-kernel-phase3-5.md`、`docs/releases/2026-11-13-capability-kernel-phase3-6.md`

---

## E1 止血（2026-11-11）

> 14 项确定性缺陷（三份评估合并清单的 A 类 + C7/B17），只修「行为与既定契约不符」，
> 不动路由契约 / 响应信封 / 协议；每项 = 一个 RED 测试 → 最小修复 → 一个 commit。
> spec：`docs/superpowers/specs/2026-11-11-gateway-e1-stabilization-design.md`；
> 交付记录：`docs/releases/2026-11-11-gateway-e1-stabilization.md`。

| # | 现状 | 边界 / 后续 |
|---|---|---|
| E1-1 | 实例锁有心跳：`boot.ts` 拿到 `gateway.lock` 后起 10s `setInterval` 调 `InstanceLock.heartbeat()`（unref），`releaseInstanceOwnership()` 先停心跳再释放锁。活进程不再因 >30s 未写被判定可回收。 | **无 fencing**：仍是协作租约，被抢占后旧 owner 的心跳按 nonce 失败→`log.warn`，不中止在飞写入；per-owner fencing 属 E5（身份闭环）。stale 判定本身（pid 存活 + heartbeat>30s）未改。 |
| E1-2 | `POST /api/events` 只服务**外部发布**：`mafw_event`（含 `mafw_event.*` 前缀）、`EVENT_FLOW_MATRIX` canonical/扁平事件、`MAFW_FLAT_EVENT_NAMES`、runtime 原生 `sync` 一律 400（不广播、不落库、不计遥测）；外部只允许自定义命名空间（推荐 `plugin:<name>:<event>`）。`mafw_event` HTTP 信封——伪造 canonical 事件的入口——已关闭。 | 内部发布走 `EventHub.broadcast()`（不经此路由）；统一插件的 `ctx.emit` 同样直连 hub。 |
| E1-3 | WS `send` 帧省略 `sessionID` 时在**当前项目**（`resolvedProjectDir()`，与 promptAsync 同源）建会话；没有注册项目 → `ws_error`，不再落"第一个注册项目"或默认目录。 | delivery/idempotencyKey 对齐属 E2（B15）。 |
| E1-4 | `GET /api/goals/:id` 返回**单个 Goal**（`goalId/phase/loop/currentWave/totalWaves/nextAction/error/updatedAt`；未知 → 404），不再落 dashboard 兜底返回列表。`POST /api/goals/control` 由 registry `goals.control` 接管，与 `/control` 旧路径共用 `handleGoalControlCommand`（PAUSE / ABORT / FORCE_PHASE / RESET_PARAMETRIC）。**R6 死臂已修复**（自 cdf678db2 起被 dashboard 前缀兜底遮蔽）。 | `/api/goals/:id/loops` 等未实现形状仍由 dashboard 兜底（R5 保留）。 |
| E1-5 | `POST /api/session` 的 `directory` **必填绝对路径**（缺失 / 相对 → 400 `{error:'directory must be an absolute path'}`）；worktree 分支不再回退 `'.'`；不再用 `resolvedProjectDir` 猜项目。desktop 新会话入口随本项改为传当前项目。 | SDK `session.create(params.directory)` 仍是 optional（类型层随后收紧）；runtime-core 的适配器兜底不动（E2）。 |
| E1-6 | `memory.maxMemoriesPerTier` 死配置已从 `core/types/config.d.ts` 与 config-loader 默认值删除（零消费者）；旧配置带该键仍能加载（忽略、不报错）。 | 归档文档保留历史原文。 |
| E1-7 | 移动端广播单投：WS 为主通道。`EventHub.broadcast` 只把**发送成功**的 `deviceId` 集合传给 `PushGateway.onBroadcast(event, { excludeDeviceIds })`；WS 写失败会移除 socket 且不进入排除集，push 仍兜底该设备。1 msg/s 全局 + 每设备限流不变。 | gateway 仍无 FCM 发送器：注册但离线的设备实际收不到；`onBroadcast` 是将来接 FCM 的单点。 |
| E1-8 | TUI `ConnectionStore` 状态**边沿触发**：health tick 仍每秒执行并调度心跳，但 `onState` 只在 ok / reconnecting / down 真正变化时回调；稳定连接不再每秒重载 Experience + gateway queue。 | — |
| E1-9 | desktop SSE 连接管理抽到 `renderer/mafw/sse/sse-connection.ts`（deps 注入，可单测）：in-flight promise 守卫让并发 `connect()` 共享同一次打开；`dispose()` 关闭并清空、之后可重建。onMount + gateway-ready 竞态不再双开 EventSource。 | `dispose()` 非终态（重挂载 / 致命关闭需要重建）。 |
| E1-10 | 设备库持久化的是客户端上报的 **FCM push token**（`mobile/lib/src/services/push_service.dart` 把它放在 `body.token`），`apiTokenHash` 由服务端从该 token 派生；网关 bearer token 只走 `Authorization` 头，从不进入设备记录、也没有任何"校验 body.token == 网关 token"的门禁。**2026-11-11 review 更正**：原「网关 token 被明文写进 fcmToken」前提不成立，初版修复引入的 401 门槛与 fcmToken 置空已回退。旧格式记录（无 `apiTokenHash`）仍可读。 | 真正的 per-device 凭据（设备级 token + 校验）属 E5（A13 完整形态）。 |
| E1-11 | 进程级 `uncaughtException` / `unhandledRejection` 兜底：`runtime/crash-handlers.ts` 写 `[FATAL] <kind>: <stack>`（`log.error` + 同步 fd 2，`fs.writeSync` 保证 exit 前不丢）后 `process.exitCode = 1; process.exit(1)`；`index.ts` 在构造 scheduler 之前注册。 | 退出码 **1**，与自更新约定 **75** 严格区分；不吞异常、不"继续运行"（supervisor 重启）。 |
| E1-12 | `SessionRegistry.register` 的 TTL 三态：`undefined` = 保持现有 TTL（重注册 = 续租，从当刻重新计时）；`null` = 显式永久；数字 = 覆盖（0 / 负数仍为永久，既有语义）。 | 结束/退休记录重建 generation 时按首次注册语义（`undefined` = 永久）。 |
| E1-13 | Mode A 全局 SSE 卫生：响应头 `X-Accel-Buffering: no`；首帧同一事件块带 `retry: 3000`（不新增帧，既有帧数契约不变）；15s `: ping` 注释帧（unref，`res close` / 写失败清理）。CORS 默认值补 `PUT/PATCH/DELETE` 与 `Authorization` / `X-API-Token`。 | **显式 `server.cors` 优先**（深合并）：`~/.mafw/config.yaml` 里钉死旧 methods/headers 的部署必须手动更新，否则预检仍按旧值。 |
| E1-14 | 收口：本节 + release 记录 + 全量门禁（gateway / TUI / desktop / SDK contract / route analyzer）。 | deferred 清单见 release 记录（A2 → E5、A7 → E3、A13 完整 → E5、B15 → E2、SDK directory 类型）。 |

## E2 恢复闭环（2026-11-11）

> 「重连后状态可恢复」从网关单方能力变成端到端协议：greeting 纪元 + 显式 reset →
> SDK/desktop 游标持久化与 `?since` → 按 truncated/reset 分级重同步 → WS 正式降级为
> live-only → append 失败可观测。不动回放机制本身（`event_log` / seq / 保留策略）。
> spec：`docs/superpowers/specs/2026-11-11-gateway-e2-recovery-design.md`；
> 交付记录：`docs/releases/2026-11-11-gateway-e2-recovery.md`。

| # | 现状 | 边界 / 后续 |
|---|---|---|
| E2-1 | Mode A SSE greeting 增加 `instanceId` / `schemaEpoch`（来自 `releaseMetadata` / `runtimeIdentity`，`releaseIdentity` live getter 注入）与显式 `reset`。`since > headSeq`（DB 重置 / 旧纪元）→ `reset:true` 且**零回放帧**（此前静默回放 0 条）；reset 与 truncated 互斥且优先。reset 时 `maxReplayed` 归零，新纪元直播 seq 不被陈旧 since 过滤。 | 客户端对 reset 的处理在 E2-2/E2-3；网关不做自动重放。 |
| E2-2 | SDK `SSEConnection.subscribe(baseUrl, opts?)` / `MafwClient.event.subscribe(opts?)` 支持可选 `cursor { get/set }` 与 `onReplayInfo(info)`：`cursor.get()` 非空 → URL `?since=N`；仅带 SSE `id:` 的帧写回 cursor；connected greeting 回调 `headSeq/firstReplayedSeq/truncated/reset/instanceId/schemaEpoch`。不传 opts 时行为逐字不变。类型 `SseCursor/SseReplayInfo/SseSubscribeOptions` 从 `@mafw/sdk` 导出。 | TUI 启用游标属后续接线；mobile（Dart）游标 deferred。 |
| E2-3 | desktop SSE 持久化游标：`localStorage['mafw-sse-seq']` + `['mafw-sse-instance']`；重连带 `?since=`。greeting 分级：`reset` / `truncated` / `instanceId` 变化（含旧网关缺失 instanceId）→ 全量重同步（列表 + experience invalidate 及既有 onOpen 块）；干净 resume → **不 invalidate**。每次非首次连接强制补拉活跃会话消息并按 REST 对账状态（`part.delta` 不入 journal，游标回放无法恢复实时文本）。无 localStorage → 退化为每次 open 全量同步。 | reset/instance 变化清游标但保留当前 EventSource；浏览器内部自动重连可能用旧 URL 再次触发（幂等）。 |
| E2-4 | WS 正式**降级为 live-only**：`connected` 帧携带 `headSeq`（deps getter，无 event store 时 `null`），既有 `type/timestamp/vocab` 不变；WS 本身不回放，重连恢复走 SSE 游标（`?since` / `Last-Event-ID`）或 REST 快照；**E5b 起** mobile 用 `GET /api/events/replay` + 持久化 seq 游标补齐，`reset`/`truncated`/失败才全量重拉；gateway 另有 `connected.instanceId` 标识事件日志纪元（E5b-3）。 | WS 总线化（WS 内建 cursor+replay）正式放弃。 |
| E2-5 | `EventStore.append` 失败保持 fail-open（返回 null），但失败计数进程级累计（`appendFailures()`），日志限频 30s 一条 `[Events] append failed (total=N): …`；`/api/stats` 在有持久 event store 时暴露 `eventAppendFailures`（无 store 时字段省略，旧 payload 形状不变）。 | 计数随进程重启归零；无独立指标端点。 |
| E2-6 | 收口：本节 + release 记录 + 全量门禁（gateway / SDK / desktop / TUI / analyzer / kernel-split）。 | deferred：mobile Dart cursor、event_log 作为恢复源与消费者幂等（C1 → E5）、定时器注册表（E4）。 |

## E3 契约硬化（2026-11-11）

> 修「契约层不一致」：catalog 里的不可达 op、幽灵测试、已死的 Mode B、六种错误方言、
> 动作描述符无绑定、318 ops 仅 11 个有 response schema。**不改变正常路径的响应形状**
> （错误仅增加字段；删除的都是不可达/已死面）。
> spec：`docs/superpowers/specs/2026-11-11-gateway-e3-contract-hardening-design.md`；
> 交付记录：`docs/releases/2026-11-11-gateway-e3-contract.md`。

| # | 现状 | 边界 / 后续 |
|---|---|---|
| E3-1 | `tests/unit/api-contract.test.ts` 的幻影源码字符串断言换成**可达性守卫**：catalog 每个 op 必须 attached（字面 / 动态循环数组 / typed attach）或在 allowlist（`TRANSPORT_ALLOWLIST` 9 项、`RUNTIME_PROXY_ALLOWLIST` 1 项，每项带 reason；`DASHBOARD_RESIDUE_ALLOWLIST` 在收口修复轮清空）；allowlist 只减不增。删除 **14 个不可达 op**：E3-1 的 12 个（spec 的 11 个 + `memory.getL5Heuristics`）+ 收口修复轮删除的 `goals.loops` / `goals.loopsAt`（dashboard catch-all 实际返回 goals 列表，形状不对）。死模块 `gateway/src/dashboard/{api,server,types}.ts` 删除（SPA `public/` 保留，仍由 transport 服务）；catalog 318 → 304 ops。 | 请求 `/api/goals/:id/loops(:n)` 仍由 dashboard catch-all 兜底（只是不再登记为 catalog op）；spec 的 307/296 计数与实际基线（318）不符。 |
| E3-2 | **Mode B 删除**：`?sessionID=` 的 per-session SSE 分支与 `ChatSessionManager` 移除；`event.subscribe` 现在忽略该参数、一律走 Mode A 全局流（SSE 头 + greeting + 回放 + `sseClients`）。`event-dispatch` 24 → 23 段（删 `modeBDelta`），kernel/api-routes 的 `chatSessions` 接线删除。**Breaking**：SDK `event.subscribeToSession` 删除（`?sessionID` 仍被接受并降级为 Mode A）。 | ~~SDK `sessions.events()` 与 `event.url(sessionID?)` 仍构造 `?sessionID`~~（E7-2 已清理：两者与 `SSEConnection.connectToSession` 全部删除）。 |
| E3-3 | 框架边界错误带机器码：`core/http/api-error.ts` 的 `API_ERROR_CODES` / `errorBody()`（`unauthorized` / `forbidden` / `capability_unavailable` / `internal`，预留 `schema_epoch_mismatch` / `not_found`）。应用点：transport 401/403/outer 500、registry-dispatch 401、kernel `capGuard`/`capGuardQuestion` 503。既有 `error` 字符串逐字保留。 | 路由内业务错误继续用原信封（错误格式按层）；客户端必须容忍可选 `code`。A2A/MCP 分支内 500 未迁移。 |
| E3-4 | Experience `ActionDescriptor` 新增可选 `operationId`；projector 用 `EXPERIENCE_ACTION_OPERATIONS` 把 20 个动作绑定到 catalog op（复合动作取入口路由，如 `run.control → session.suspend`）。无路由动作省略该字段。 | 单 operationId 不是完整 verb 集合（run.control 也含 resume/discardRun）；路由改名时绑定测试会红。 |
| E3-5 | **opt-in schema epoch**：所有响应带 `X-MAFW-Schema-Epoch`（`releaseMetadata.schemaEpoch`，未加载时省略）；客户端**主动携带**且不匹配 → 409 `{error, code:'schema_epoch_mismatch'}`（auth 之后、registry 之前）。不携带 / 匹配 / 服务端未知 → 正常放行。**E10j-J2 客户端侧已闭合**：SDK `MafwClientOptions.schemaEpoch?: number \| 'auto'` —— 数字恒带且从不重试；`'auto'` 从**每个**响应学习 epoch、之后请求自动携带，**已在请求中携带本地 epoch** 且收到「响应 epoch 不同」的 409 时刷新并**重试一次**（同 path/init；transport 前置拒绝，重放安全）；未知 epoch 的首请求 409 不重试，同值/无 epoch 的 409 直接抛；未配置维持旧行为（不带头、不重试）。`fetchPath`（SSE/二进制/裸 Response）不带头、不重试。desktop `createGatewayClient` 与 TUI `createTuiClient` 均 opt-in `'auto'`。 | 不引入强制拒绝；gateway 侧行为未变（仍是 opt-in 校验）。`'auto'` 的 409 判定只按**状态码 + 响应 epoch 不同于已知值**，不解析响应体 `code`；服务端不回声 epoch 时（metadata 未加载）无法协商，错误原样上抛。 |
| E3-6 | 四个读 op 的 200 response schema（`routes/schemas/read-models.ts`，只加 OpenAPI 元数据，不改 handler）：`goals.get`、`project.list`、`presence.get`、`session.usageSummary`。`emit:openapi` 后 272 paths / 304 operations。 | 其余 ~300 ops 仍无 response schema（渐进补齐）。 |
| E3-7 | 收口：本节 + release 记录 + 全量门禁（gateway / SDK / desktop / TUI / analyzer / kernel-split）。收口修复轮：SDK `Goal` DTO 对齐 `projectGoalView`（phase/error/updatedAt 可空），`goals.list` override 同步、删除陈旧 `goals.get` override；删除 dashboard-residue 两个 phantom op；同步 23 段/25 DispatchCtx 成员的文档漂移。 | ~~deferred：SDK `sessions.events()`/`event.url(sessionID?)` 清理~~（E7-2 已清理）。剩余 op 的 response schema 覆盖仍渐进补齐（E7 后仍约 300 ops）。 |

## E4 资源台账（2026-11-11）

> 给常驻 gateway 的磁盘/堆/连接/出站缓冲/子进程/项目与会话配额一个单一账本：
> `ResourceGovernor` 采样 + 各 provider 记账 + `GET /api/kernel/stats` 出口 + 压力降级。
> 所有上限显式、可配置、可观测；**正常路径响应形状不变**，新增的只有拒绝路径
> （429 配额/连接、503 补建、200 壳 `disk_low`）。不新增 SDK-facing op，不做 E5
> 身份/交互模型，也不追求全进程 timer 清点。
> spec：`docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md`；
> 交付记录：`docs/releases/2026-11-11-gateway-e4-resource-ledger.md`。

| # | 现状 | 边界 / 后续 |
|---|---|---|
| E4-1 | `config.resources`（采样间隔 / 磁盘·堆阈值 / 连接·进程·配额上限 / 缓冲上限）深合并进默认配置；`core/timer-service.ts` 提供命名 timer 台账（同名 `every` 抛错、默认 unref、`clear` 幂等、`disposeAll`）。`resources/` 只放台账（`sdk-session.ts` 移到 `runtime/`）。长驻 interval 迁入：`governor:sample`、`ws:ping`、`ws:device-cleanup`、`sse:ping:<uuid>`、`python:sweep`。 | **不是全进程 inventory**：短命 retry/超时仍在各自模块；E8-1 已把 kernel/boot 的 `pod:event-prune` / `pod:event-wake` / `heartbeat:sweep` / `queue:sweep` / `session:sweep` / `serve:watchdog` / `discovery:heartbeat` 全部迁入（见「计时器台账」）。插件 loader / self-update / 第三方 transport 的本地 interval 不在命名台账范围。 |
| E4-2 | `resources/disk.ts` 异步 `fs.statfs` 采样数据根（`config.resolvePath()`）：默认 warn 2 GiB / critical 512 MiB，30s 一次且启动立即采一次。回滞：critical→warn 需回到 **1.5× critical**（768 MiB），warn→ok 需回到 **1.1× warn**（2.2 GiB）；升级按阈值立即。`statfs` 失败 → `unknown` 且不降级（fail-open）。 | critical 动作见「降级矩阵」；media artifact 已有内存回退，不额外拦截。 |
| E4-3 | `resources/heap.ts`：`memoryUsage()` + `v8.getHeapStatistics().heap_size_limit`，默认 warn 0.75 / critical 0.9，回滞 **0.05**（critical <0.85 才回 warn，warn <0.70 才回 ok）。与磁盘共用 `governor:sample`；采样抛错保留上一份样本/状态（fail-open）。 | 不在 E4 强制 GC；堆压力不阻断 `memory.add`（与写盘危险无关）。 |
| E4-4 | `ConnectionTable`：HTTP socket 计数（`httpOpen`，仅观测）+ SSE/WS/voice/terminal 逻辑连接 lease（`release` 幂等）。HTTP **256** 走 `server.maxConnections` 硬帽；软帽 SSE/WS 各 64、voice/terminal 各 16；超限 SSE 503 `{code:'connection_limit'}`，WS/voice/terminal 在 upgrade 阶段 503（不升级）；`refused` 按 kind 计数；连接上限 `0`/负数 = 不限。`connections.sse` 只覆盖 `/api/events` 与 plugin-web SSE（`/api/plugins/:name/events`）；**TTS `/api/tts/stream` 与 MCP SSE keepalive 不在连接表内**。 | HTTP 无软拒绝路径；FD 不设硬上限（`handles.fdCount` 仅 Linux 观测）。 |
| E4-5 | `SseBoundedWriter`：`res.write` 返回 false → paused 入队，`drain` 按序 flush；队列超 `sseMaxFrames`（256）或 `sseMaxBytes`（1 MiB）→ `destroy()` + overflow 计数。WS 广播前 `bufferedAmount > wsMaxBufferedBytes`（1 MiB）→ `terminate()` + 移出广播集。计数聚合为**平铺** `buffers`（含 `sseWriteErrors`）。 | 断开慢客户端是安全动作：SSE 用 `since`/Last-Event-ID 回放，WS live-only 重连走 REST 快照；E5b 起还可走 `GET /api/events/replay` 的 seq 游标补页。缓冲上限的 `0` = 回退默认值，不是不限。 |
| E4-6 | `ProcessLedger`：python / llamacpp / serve 三类条目，`release` 幂等，`disposeAll` 走 close 钩子（best-effort）。Python 槽位是**会话作用域逻辑条目**（`owned:true`，gateway 托管内核），并发帽默认 4：满帽先驱逐超过 10 分钟未用且非 busy 的内核，仍满抛 `QuotaExceededError('python_kernels')` → 429；busy 内核永不驱逐，崩溃条目留到 sweep/TTL 1h。llamacpp 记录真实 child pid 且 `owned:true`。serve 只在 `serveInstance` 真存在时登记一条 `owned:false` 逻辑条目。 | 条目数 ≠ 子进程数（python 可能无 pid）；serve 无 close 钩子，gateway **不声称**能 kill adapter 的进程；`serve.running` 就是 `!!serveInstance`（不额外探测进程存活）。 |
| E4-7 | `QuotaService`：projects 128（`/register`，同目录重复注册放行）、sessions 1000 与 `sessionRecordsPerProject` 200（`SdkSessionResource.create` / `registerExternal`，按 `projectID` / `directory` 分组）。超限统一 429 `{code:'quota_exceeded', resource, limit, current}`；watcher 自动注册超限只 log + skip。 | **worktree-before-quota 已收口（E7-3）**：`createSessionWithWorktree` 在 session 创建被拒（含 429 `quota_exceeded`）时 best-effort `manager.remove(dir, branch)` 回滚 worktree/branch，原错误原样抛出，不写 kv 映射；remove 失败不吞原错。内部 manager/lead 会话失败仍按既有 catch 语义降级为 log。`activeGoals` 不进配额。 |
| E4-8 | `GET /api/kernel/stats`（catalog `kernel.stats`，internal、带 200 schema）：pressure/disk/heap/connections/buffers/timers/processes/quotas/handles/scheduler/events/serve。provider 缺席时 fail-open（`heap:null`、disk `unknown`、events 零值、handles 空表），只有 provider 自身抛错才 500。 | 新的 wire 契约：`buffers` 平铺、quotas 三键必填、`limit 0 = 不限`、`fdCount` Linux-only、`serve.owned` 与 entries 的 `owned` 两个口径；其余 op 仍无 response schema。 |
| E4-9 | 收口：本节 + release 记录 + 全量门禁（gateway / SDK / desktop / TUI / analyzer / kernel-split / 契约产物新鲜度）。 | deferred：见下「已知延后」。 |

### 配置 `config.resources`

```yaml
resources:
  sampleIntervalMs: 30000          # <1000ms / 非有限 → 回退 30s
  disk: { warnFreeBytes: 2147483648, criticalFreeBytes: 536870912 }   # 2 GiB / 512 MiB
  heap: { warnRatio: 0.75, criticalRatio: 0.9 }                       # clamp 到 (0,1)
  limits:
    httpConnections: 256
    sseClients: 64
    wsClients: 64
    voiceClients: 16
    terminalClients: 16
    pythonKernels: 4
    projects: 128
    sessions: 1000
    sessionRecordsPerProject: 200
  buffers: { sseMaxFrames: 256, sseMaxBytes: 1048576, wsMaxBufferedBytes: 1048576 }
```

- 归一化单点在 `resources/settings.ts`：`limitOf`（连接/配额，`0`/负数/非有限 = 不限）、
  `resolveCap`（缓冲区，`0` = 回退默认，绝不无界）、`resolveSampleIntervalMs`、`clampRatio`；
  配额出口另走 `sanitizeLimit`（有限正值向下取整、负数/非有限 → `0`，wire 上统一表达"不限"）。
- 所有组件通过 **live getter** 读配置，不缓存配置对象；`config.reload()` 后下一次检查/采样即生效。
  唯一延迟是 governor 的采样间隔：新 `sampleIntervalMs` 在**下一次采样**时才重注册 timer，
  因此最长滞后一个旧间隔（默认 30s）。
- 不新增专用环境变量；沿用 `MAFW_<SECTION>_<KEY>` 覆盖与 `config.yaml` 深合并（缺省键自动补全）。

### 计时器台账（TimerService）

| 名字 | 周期 | 归属 |
|---|---|---|
| `governor:sample` | `resources.sampleIntervalMs`（默认 30s） | `ResourceGovernor` |
| `ws:ping` | 30s | `http/ws-upgrade.ts`（缺失 TimerService 时回退本地 interval） |
| `ws:device-cleanup` | 60s | 同上 |
| `sse:ping:<uuid>` | 15s | `events/sse-attach.ts`，连接 dispose 即 clear |
| `python:sweep` | 5min | `python/kernel-service.ts` 的 `SessionKernels` |
| `pod:event-prune` | 24h | `kernel.ts`（启动立即跑一次） |
| `pod:event-wake` | 60s | `kernel.ts` |
| `heartbeat:sweep` | 30min | `kernel.ts` |
| `queue:sweep` | 60s | `kernel.ts`（busy 15min / 队列项 24h TTL） |
| `session:sweep` | 60s | `kernel.ts`（`SessionRegistry`） |
| `serve:watchdog` | 30s（`serveWatchdogIntervalMs`） | `kernel.ts`，`stopServeWatchdog()` 清本 handle |
| `discovery:heartbeat` | 10s | `boot.ts`（`publishInstanceDiscovery`；`releaseInstanceOwnership` 清） |

`/api/kernel/stats.timers` 是**这张表**的视图（`sse:ping:*` 按 family 折叠），不是进程全部 timer：
E8-1 之后 kernel/boot 的长驻 interval 已全部在台账内；短命 retry/超时、插件 loader interval
与第三方 transport 的本地 interval 仍留在各自模块。

### 降级矩阵（as shipped）

| 压力 | 前台 chat/health/SSE | 后台 scheduler | memory.add | event_log | 连接/缓冲 |
|---|---|---|---|---|---|
| warn | 正常 | 正常 | 正常 | 正常摊销裁剪 | 正常 |
| disk critical | 正常 | **拒绝全部非 foreground submit** | HTTP 200 壳 `{success:false, error:'disk space critical', code:'disk_low'}` | 进入边沿裁剪一次到 `max(100, floor(events.logRetention × 0.1))` | 正常 |
| heap critical | 正常 | 拒绝全部非 foreground submit | 正常 | 不触发裁剪 | 正常 |

- 准入接缝是 `SchedulerOpts.admissionChecker`（**每次 submit 都问**，budgeted 与否；在 coalesce 之前），
  `budgetChecker` 仍是 budget-only 语义；降级拒绝的 reason 是 `resource pressure`。
  **E4 时点是 submit-time only**（降级前已入队的任务仍会启动，不做回撤/抢占）；**E11-3 已补上 start-time
  复检**：`SchedulerOpts.resourceAdmission`（只读压力，非 budget）在 `pump()` 里把非前台候选留在队列，
  恢复边沿由 governor 触发 `scheduler.sweep()` 续跑——不拒绝、不丢任务，见「E11 身份 / 配额硬化」E11-3。
- `event_log` 裁剪只看 **disk 进入 critical 的边沿**（`next.disk === 'critical' && prev.disk !== 'critical'`）；
  critical 期间 heap 变化/恢复边沿不重复裁剪，`pruneNow` 不动摊销计数。
- `memory.add` 的判压在 authority 校验之后、exact-hash dedup 之前（非法 authority 仍回既有错误；
  被拒写入不推进 dedup 状态）；embedding backfill 返回 503 `{error, code:'disk_low'}`。
- **MCP `mafw_add_memory` 同受磁盘门约束（E7-4）**：`Services.pressure()` 是 governor 的 live 窄面
  （缺席 → `null`），handler 在 authority 校验之后、任何 store/embedding 写之前检查；`disk === 'critical'`
  或 `degraded` 含 `disk_critical` → `{success:false, error:'disk space critical', code:'disk_low'}`，
  `isError:true`。HTTP 面（`POST /api/memory/add`）的既有门逐字不变。
- 恢复：状态按回滞回到 ok 后自动重新接纳；不补跑被拒任务。前台/health/SSE 在任何压力下都不被拒。

### `/api/kernel/stats` 口径

- 顶层：`timestamp`、`uptimeSec`、`pressure{disk,heap,degraded[]}`、`disk{totalBytes,freeBytes,state,error}`、
  `heap`（首个样本前为 `null`）、`connections{httpOpen,sse,ws,voice,terminal,limits,refused}`、
  `buffers`（平铺：`sseOverflows/sseDropped/sseWriteErrors/sseQueuedFrames/sseQueuedBytes/wsDropped`）、
  `timers{active,byName}`、`processes{total,byKind,entries}`、`quotas`、`handles{total,byType,fdCount?}`、
  `scheduler{queued,running,byPriority}`、`events{headSeq,appendFailures}`、`serve{running,owned}`。
- `disk.error` 是**机器码**（有 `err.code` 用 `err.code`，如 `ENOENT`；否则 `'statfs_failed'`），
  不是原始 message——后者带数据根路径，不得出现在 stats wire 上。
- `quotas` **三键必填**（`projects` / `sessions` / `sessionRecordsPerProject`），builder 为缺键 provider 补齐；
  `limit` 只输出有限非负整数（正值向下取整），`0` = 不限（`Infinity`/`NaN`/负数在 JSON 里不可用，出口统一归一化）。
- `buffers` 未来只许加键，客户端必须忽略未知键；`handles.fdCount` 只在 Linux 出现（读 `/proc/self/fd` 失败静默）。
- `serve.owned` 回答"gateway 是否拥有 serve 进程"（`serveOwned`，取决于本进程是否 spawn 了 serve），
  `processes.entries[].owned` 回答"该台账条目是否由 gateway 托管关闭"（python/llamacpp `true`，serve 逻辑条目 `false`）；
  两者不得互相推导。`processes.byKind.serve` 只在确有 serve 实例时出现。
- 鉴权沿用 internal token/loopback 规则；只返回计数/比率/pid，不返回路径或内容。

### 已知延后（不在 E4 范围）

- ~~降级前已入队任务的二次校验（pump 处回撤/抢占）与跨压力恢复补跑~~（E11-3 已收口：`pump()` 的
  `resourceAdmission` 只把非前台候选留在队列、不拒绝，governor 恢复边沿触发 `scheduler.sweep()`
  自动续跑；见「E11 身份 / 配额硬化」）。
- ~~全进程 timer inventory~~（E8-1 已把 kernel/boot 的长驻 interval 全部迁入命名台账；
  插件 loader / self-update / 第三方 transport 的本地 interval 属于各自模块边界，不在台账范围）。
- ~~插件/manager 会话的配额副作用（内部会话失败当前降级为 log；未给 UI 明确 429 文案）~~（E11-2 /
  E11-2b 已收口：失败回滚内部身份、广播 `session.registration_failed`、轮换路径清槽并抛错）。
- ~~MCP `mafw_add_memory` 的磁盘门~~（E7-4 已收口，见「E7 部署前 deferred 收口」）。
- ~~review-items 的 SDK 债务~~（E7-2 已收口：`DEAD_CONTRACT_TODO` 删除，4 个 op 由
  `pods.goals.reviewItems*` 方法覆盖）。

## E5a 身份闭环（2026-11-12）

> 把「人类专属动作」从隐式约定（**没带 `actorSessionID` 就算人类**）升级为**显式 human/device 凭据**；
> 移动端从共享网关 token 升级为**可撤销的 per-device token**；desktop/TUI 在主进程读
> `~/.mafw/human.token` 并以 `X-MAFW-Human-Token` 注入。普通 API 的 loopback / 共享 token
> 行为逐字不变，只有 human-only 判定收紧（**breaking**，按安全修复记录）。
> spec：`docs/superpowers/specs/2026-11-12-gateway-e5a-identity-closure-design.md`；
> 交付记录：`docs/releases/2026-11-12-gateway-e5a-identity.md`。

### Principal 矩阵

| principal | 凭据 | 普通 API | human-only |
|---|---|---|---|
| `human` | `X-MAFW-Human-Token: <64 hex>`（`~/.mafw/human.token`） | 放行（method `human-token`） | **放行** |
| `human` | `X-MAFW-Device-Token: dev_…` 或 `Authorization: Bearer dev_…` | 放行（method `device-token`，带 `deviceId`） | **放行**（`deviceId` 同时供 push presence 用） |
| `service` | 共享 `server.apiToken`：`Authorization: Bearer` / `X-API-Token` / `?token=` | 放行 | 403 |
| `local` | loopback（127.0.0.0/8、`::1`）且无凭据 | 放行 | 403 |
| `anonymous` | 非 loopback 且无有效凭据 | 401 | 401 |

解析顺序（`core/auth.ts` 的 `resolvePrincipal`，顺序本身是契约）：

1. human token 命中 → `human`（长度相等后 `crypto.timingSafeEqual`；空 token / 文件不可读永不匹配）；
2. device token（显式头优先，其次 `Bearer dev_…`）命中 DeviceStore → `human`；**验证失败不中止**，继续往下走——过期/已撤销的设备头不会压掉合法共享 token（只是不再授予 human）；
3. 共享 apiToken 命中 → `service`；
4. loopback → `local`；其余 → `anonymous`（transport / WS upgrade 直接 401）。

- principal 由 transport / WS upgrade 挂在 `req.mafwPrincipal`（`core/auth.ts` 的 `http.IncomingMessage` module augmentation）；WS 连接在 socket 上暴露 principal，且**凭据里的 `deviceId` 覆盖 `?deviceId=` 查询串**（query 仅兼容保留）。
- 反向代理（`/api/*` → agent backend）**剥掉** `x-mafw-human-token` / `x-mafw-device-token`，凭据不外溢给 runtime。
- `redactLog` 覆盖 `Bearer` / `?token=` / 两个新头（header 与 JSON 两种形状）与任意 `dev_…`；64 hex **不**做泛化脱敏（hash/commit 常见），human token 只经具名头泄漏。
- `registry-dispatch` 只接受 transport 已解析的 principal kind（`human|service|local`）；畸形/未知 kind fail-closed 回既有 `authorizeRequest`。`POST /api/mobile/pairing/verify` 是唯一免凭据路由，且必须由 transport 打上 `mafwPairingVerify` 标记（nonce 即凭据，直调 dispatcher 不能自我授权）。
- `authorizeWsUpgrade` **已删除**（E8-5；WS upgrade 只走 `resolvePrincipal`，没有第二套凭据矩阵）；`authorizeRequest` 仍服务只需 service/local 判定的既有调用，`WS_UNAUTHORIZED_RESPONSE` 保留为 upgrade 401 的唯一字节源。

### human token

- 固定 `~/.mafw/human.token`（数据根，不随 cwd）；**32 字节随机 = 64 位小写 hex**。不存在则生成；格式不合法则重生成；合法则**稳定复用**。
- 原子写：`.tmp`（`open(w, 0o600)`）→ `write` → `fsync` → `rename` → `chmod 0600`（POSIX 尽力）；Windows 依赖用户目录 ACL。写失败抛错，kernel `initServices` `log.warn` 后以**空 token** 继续——human-only fail-closed（403），普通 API 不受影响。
- desktop：`packages/desktop/src/main/human-token.ts` 的 `readHumanToken()`（trim + 64 hex 校验，失败返回 `''`，不抛不日志）+ `createGatewayClient()` 统一构造 `MafwClient({ clientToken })`；token **不进入 renderer / preload / 插件 web / 日志**。`MAFW_HUMAN_TOKEN_FILE` 只是测试/隔离 dev 的路径覆盖。
- TUI：`packages/tui/src/store/human-token.ts` 同语义 + `createTuiClient()`；human-only 动作失败时直接显示 gateway 403。
- SDK：`MafwClientOptions.clientToken?` / `headers?`；`request()` 合并顺序 `Content-Type` → `options.headers` → `clientToken` → schema epoch → 调用点 headers；空/空白 `clientToken` 不发头；`fetchPath`（SSE / 二进制 / 媒体流）**不带** token 与 base headers。
- **schema epoch 协商（E10j-J2）**：`MafwClientOptions.schemaEpoch?: number | 'auto'`。数字 = 请求恒带该值、响应不改写、409 直接抛；`'auto'` = 首个响应前不带头，之后从**每个**响应（成功或失败）缓存 `X-MAFW-Schema-Epoch` 并在后续请求携带；`!res.ok && status === 409` 且**本次请求已携带已知 epoch**、响应 epoch 与之**不同** → 采用新值并**重试一次**（同 path/init；只有这类请求会被 transport 前置拒绝，重放安全）；未知 epoch / 同值 / 无 epoch / 非数字 → `httpError(res)`（不重试，避免重放已分发的请求）。未配置 = 旧行为（不带头、不重试）。重试上限是一次，不存在循环。desktop `createGatewayClient`、TUI `createTuiClient` 均 opt-in `'auto'`（gateway 升级后自动重新协商，不静默沿用旧契约）。
- **轮换（E11-1）**：`POST /api/human-token/rotate` 是唯一能把该凭据原地换掉的入口——只认
  `method === 'human-token'` 的 human principal（device token / service / loopback 一律 403
  `human_principal_required`）。成功即写盘并 live rebind kernel `this.humanToken`，**旧 token 立刻失效**；
  CLI 是 `mafw rotate-human-token`，桌面遇 403 自动重读重试一次、TUI 需重启。细节见
  「E11 身份 / 配额硬化」E11-1。

### 设备凭据（A13）

- 配对码 v2：`orcalore://pair?url=<base>&v=2&exp=<ms>&nonce=<hex>`，**不含任何网关凭据**；nonce 一次性、TTL 5min、5/min/IP（loopback 免限频），只存 sha256。`PairingConfig.apiToken` 保留为 deprecated 参数，不再出现在链接/响应里。
- `POST /api/mobile/pairing/verify` body `{ nonce, deviceId?, platform?, deviceName?, rotate? }`：
  - 先校验 deviceId / platform / deviceName 边界（128 / 40 / 100 字符，deviceId `[A-Za-z0-9._:-]`）→ 400；body 上限 **8192 B** → 413 `payload_too_large`；pairing/push 服务不可用 → 503（nonce 未消费，可重试）；
  - `deviceId` 已持有凭据且 `rotate !== true` → **409** `{ code:'device_already_paired' }`，nonce **不消费**；
  - 消费 nonce → 生成 `dev_` + 32 字节 base64url → DeviceStore 只写 `sha256(token)` 与 `tokenIssuedAt` → `200 { ok:true, token, deviceId }`。
- 认证：`Authorization: Bearer dev_…` 或 `X-MAFW-Device-Token: dev_…`；验证成功 principal 为 `human` + `deviceId`（`X-MAFW-Device-Token` 不是网关共享 token 的别名）。
- 设备记录：`deviceTokenHash` / `tokenIssuedAt` / `deviceName` 均可选；列表与注册响应一律走 `listPublicDevices()`（`deviceTokenHash`、`apiTokenHash` 不出网关，含 legacy `GET /api/devices`）；`MAX_DEVICES` 600。
- 轮换 / 撤销：同 `deviceId` 再签发即轮换（旧 token 立即失效）；`DELETE /api/mobile/devices/:id` 与 legacy `DELETE /api/devices/:id` 删条目即撤销，并 **terminate 该设备的在线 WS**（`PushGateway.removeOnlineWs`）；`revokeDeviceToken` 只清凭据、保留推送注册。
- 推送注册不吊销凭据（`DeviceStore.register` 保留 `deviceTokenHash` / `tokenIssuedAt` / `deviceName`）；凭据使用会刷新 `lastSeen`，落盘 ≤1 次/小时（避免每请求重写，同时让 REST-only 设备不被 stale 清理误删）。
- 旧记录（无 `deviceTokenHash`）仍可列出/推送，但**不能**作为 human 凭据；重新配对补齐。`deviceId` 已存在但无凭据（push-only）的条目可免 `rotate` 直接配对。

### human-only 路由

统一 helper：`isHumanPrincipal(p)` / `humanOnlyDenied()`；403 body `{ error:'human principal required', code:'human_principal_required' }`。

| 路由 | 动作 |
|---|---|
| `POST /api/pods/:podId/goals/:goalId/accept` | 验收（merge） |
| `POST /api/pods/:podId/goals/:goalId/review-items`（create / resolve / reopen） | review item 写 |
| `POST /api/decisions/:id/confirm` / `shelve` / `reopen` | decision 状态变更 |
| `POST /api/goal-runs/:id/approve` | 长效目标 run 批准 |
| `GET /api/mobile/pairing-code` | 生成配对 nonce（否则 service/local 可铸 nonce → 未认证 verify 换 device token 越权） |
| `POST /api/goals/:id/plan-approval`（E7-1） | 计划批准（GET plan 只读不拦） |
| `triage.confirm` / `triage.reject` / `triage.dismiss`（E7-1） | triage 决策（list / propose 不拦） |
| `lead.boundaries.accept` / `merge` / `undo`（E7-1） | Lead 边界动作（list / observe 不拦） |
| `approvals.respond`（E7-1） | 审批应答（list 与 rules CRUD 不拦） |
| `permissions.reply`（E7-1） | 权限应答（`permissions.replyRuntime` 是 runtime 内部路径，不拦；list 不拦） |
| `goals.respondQuestion`（E7-1 review） | 目标问题回答 / 取消（`GET /api/questions` 等只读面不拦） |
| `questions.reply` / `questions.reject`（E7-1 review） | runtime 问答应答（`questions.list` 不拦） |

- 判定 **fail-closed**：缺失 principal（直调 handler 的测试路径）、`service`、`local`、`anonymous` 一律 403。
  注意 **E7-1 的 `requireHumanPrincipal` 路由没有 actor 检查**——human/device 凭据即放行，不因请求带
  `actorSessionID` 再拒。
- `human` + `actorSessionID` 仍 403 只适用于 **pod 验收（`pods.goals.accept`）与 decisions 写**（E5a 的既有审计检查，防人类 UI 误用 agent 上下文），不是 E7 路由的通用规则。
- `pairing-code` 的 human 检查在调用 pairing service **之前**，被拒请求不消耗限频额度；`POST /api/mobile/pairing/verify` 仍是唯一免凭据路由（nonce 即凭据，见上）。
- **MCP 面不提供 human 工具**：代答工具 `mafw_answer_question` 已删除（E7 review 后续
  `ba8ac0e7`）——loopback MCP 调用无人类凭据，保留只会是一条恒 403 的 impersonation 入口。
  删除面：工具定义 / handler / registry entry / `runtime/tool-classes.ts` 注解 / manager
  allowlist；`tool-registry-annotations.test.ts` 有缺失断言防回填。人类回答走
  human/device 凭据的 `goals.respondQuestion` / `questions.reply|reject`（桌面 / 手机 UI）。
- 普通写路径（goal create / task / memory / …）**不要求** human，继续使用 service/local。

### 兼容 / 威胁模型

- **普通 API 不变**：loopback 与共享 apiToken 的既有三通道、401/403 语义逐字保留；新增的只有 human-only 的收紧与 403 的 `code` 字段。
- **Breaking（安全修复）**：human-only 从「缺省即人类」变为「必须 human/device 凭据」。旧 desktop/TUI 不读 token → 这些动作 403；旧 mobile 用共享 token → 普通 API 可用，human-only 需重新配对。
- **发布顺序**：v2 gateway 必须与支持 v2 的 mobile 同批发布（旧 app 解析不了无 token 的 v2 链接）。网关先上时，已配对设备要在下一次重配对拿到 device token 后才能做 human-only；删除设备会立即断开其在线 WS，客户端按断线退避重连，但不会自动重配对。
- **威胁模型**：human token 与 gateway 同一 OS 用户，本机恶意进程可读；E5a 防的是 **agent/自动化误调用、误审批被当成人类**，不是本机隔离。device token 可撤销；共享 apiToken 仍是全权 service 凭据（本波不轮换）。

### E11-4 身份边界决策（2026-11-13）

- **MCP human 工具 = won't do。** MCP 永远是 service principal（loopback 或共享 apiToken，调用不携带
  human/device 凭据），所以不新增任何「代替人类」的工具：验收（accept + merge）、计划批准、
  triage confirm/reject/dismiss、decision confirm/shelve、Lead 边界 accept/merge/undo、
  `approvals.respond`、`permissions.reply`、`goals.respondQuestion` 一律只走 human/device 凭据的
  HTTP/UI 路由（见上「human-only 路由」）。三条例外各有明确语义：`mafw_pod_review_respond`
  （Tech Lead 回应，只有人类能 resolve/reopen）、`mafw_decision_draft`（只草稿，人类在 UI 确认）、
  `mafw_ask_user`（提问，绝不代答）。守卫是机器化的：`gateway/tests/unit/mcp/human-boundary.test.ts`
  固定 47 条工具名快照（新增/改名必须显式更新才通过）、扫描名称与描述里的 human-only 动词
  （accept/approve/confirm/shelve/reject/dismiss/merge/undo/rotate；描述侧收窄到「动词 + 人类专属对象」
  且允许描述人类自己的动作）、并静态扫描 `gateway/src/mcp/**` 不得出现 `requireHumanPrincipal` /
  `confirmDecision` / `shelveDecision` / `acceptGoal` / `replyPermission` / `rotateHumanToken` /
  `human.token`。快照 + 扫描合起来保证「新增 human 工具」必然出现在评审 diff 里。
- **OS keychain / 进程签名 = won't do（本阶段）。** 威胁模型是**同一个 OS 用户**：本机恶意进程本就
  能以该用户身份读取解锁后的 keychain 条目，收益有限；而代价是三平台原生依赖（Windows 凭据管理器 /
  macOS Security.framework / Linux Secret Service），并且要接进打包与签名链路（签名会改变 payload
  哈希与 self-update 校验）。缓解措施沿用现状且都可验证：固定路径 `~/.mafw/human.token`（原子写、
  POSIX 0600、Windows 用户目录 ACL）、只服务 loopback（非 loopback 必须凭据）、
  `POST /api/human-token/rotate` 立即换发且 kernel 实时生效（E11-1，桌面遇 403 自动重读重试一次）、
  `redactLog` 覆盖凭据头与 `dev_…`、轮换只记时间戳不记 token、device token 可单独撤销。
  跨用户隔离要靠 OS 账户 / per-owner fencing，仍留在后续。

### 已知延后（不在 E5a 范围）

- ~~计划批准（plan-approval）、triage、Lead 边界、permission approvals 仍是 service/local 可调~~
  （E7-1 已收口；统一 helper `requireHumanPrincipal` 接入，见「E7 部署前 deferred 收口」）。
- MCP 工具集**没有** human 工具（也不提供验收/批准工具）；human-only 动作只走 HTTP（desktop/TUI/移动）。
  该边界自 E11-4 起由 `gateway/tests/unit/mcp/human-boundary.test.ts` 机器化守卫（名称快照 + 动词扫描 + 源码扫描）。
- ~~`authorizeWsUpgrade` 仅标记 deprecated，未删除（测试与旧调用方仍引用）~~（E8-5 已删除：无生产调用，测试迁移到 `resolvePrincipal` / `WS_UNAUTHORIZED_RESPONSE`）。
- ~~human token 的 OS keychain / 进程签名、per-owner fencing 留给后续。~~（E11-4 已裁决：OS keychain / 进程签名 **won't do 本阶段**，理由与缓解见上；per-owner fencing 仍留在后续。）
- E5b（C1 event_log 恢复源 / mobile 游标）与 E6（单点扇出 / 实体缓存 / 事件增量）不在本波。

## E5b 事件恢复源（2026-11-12）

> `event_log` 从「只有 live 轨道 + SSE newest-window 回放」升级为**按 seq 升序、可分页、
> 可检测缺口**的 REST 恢复源；移动端持久化游标，重连先补事件再刷新，补齐不了才全量重拉。
> SSE 的 newest-window/`reset`/`truncated` 语义与 WS 的 live-only 定位都不变（E2 裁决），
> 桌面接入 replay 属 E6。
> spec：`docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md`；
> 交付记录：`docs/releases/2026-11-12-gateway-e5b-event-recovery.md`。

### `GET /api/events/replay`（internal，非 SDK-facing）

| 项 | 契约 |
|---|---|
| 参数 | `since`：非负十进制整数，缺省 `0`；符号 / 小数 / 科学计数 / 空串 / 前后空格 → 400 `{error:'invalid since'}`。`limit`：整数 1..1000，缺省 `500`；非数字 / `<=0` / 小数 → 400 `{error:'invalid limit'}`；`>1000` **clamp** 到 1000（不报错，客户端不必预知上限）。 |
| 排序 | `seq > since`，**升序**，单页最多 `limit` 条。 |
| 返回 | `{ events:[{seq,ts,type,sessionId,envelope}], headSeq, oldestSeq, hasMore, nextSince, reset, truncated }`；`envelope` 是 event_log 原始事件对象，`type` / `sessionId` 是列投影。 |
| `headSeq` / `oldestSeq` | 当前事件日志的 MAX / MIN seq；空表 `0/0`。 |
| `hasMore` | `rows.length === limit && lastSeq < headSeq` → 用 `nextSince` 继续翻页。 |
| `nextSince` | 末行 seq；**`reset` 时固定为 `headSeq`**（不回显 `since`，否则盲目持久化它的客户端每次重连都 reset-loop）。 |
| `reset` | `since > headSeq`（DB 重置 / 新纪元）→ 强制 `events:[]`；客户端应全量重拉并把游标置 `headSeq`。 |
| `truncated` | `!reset && since + 1 < oldestSeq`（缺口在保留窗口之外）→ 仍返回能读到的行，但客户端应全量重拉；与 `reset` 互斥且 `reset` 优先。 |
| store 缺失 | `EventStore` 为 `null`（初始化失败降级）→ **503** `{error:'event store unavailable'}`，不伪装成空页（否则客户端误判「已追平」）。 |
| 鉴权 | 普通 API（loopback / human token / device token / service apiToken）；**不要求 human**。 |
| 契约 | catalog `event.replay`（`tags:['internal']`）+ TypeBox `EventReplayResponse`；SDK 无调用方（internal，不进 SDK 面）。 |

### EventStore.replayAfter

- `replayAfter(since, limit) → { rows, headSeq, oldestSeq }`：一条
  `SELECT … WHERE seq > ? ORDER BY seq ASC LIMIT ?` + 同次 `MAX(seq)/MIN(seq)`；`since`/`limit`
  非有限值做防御性夹取（`limit` 至少 1，避免 `LIMIT -1` 读全表）。
- **fail-open**：任何 DB 异常 → `{rows:[],headSeq:0,oldestSeq:0}`（与 `replaySince` 同 stance）；
  恢复链路失败不拖垮 live 广播。
- 不重置 `appendCount`、不触发裁剪；`part.delta` 等非持久帧本就不入库、不占 seq，
  因此**不会出现在恢复页**（其丢失由会话消息 REST 对账补齐）。

### WS greeting（E5b-3，additive）

`/api/ws` 的 `connected` 帧新增 `instanceId`（event-log 纪元，来自 `releaseMetadata` /
`runtimeIdentity`），与既有 `headSeq` 并存；两者都是**连接时实时读取的 live getter**，
无 event store / 无 release metadata 时为 `null`（字段仍存在，老解析器忽略未知字段即可）。
WS **仍不回放**：greeting 只告诉客户端「实时流从哪个 seq 接上、属于哪个事件日志纪元」；
重连补齐由客户端走 `GET /api/events/replay`（mobile 默认）、SSE 游标（`?since` /
`Last-Event-ID`）或 REST 快照。SSE 的 greeting / 回放 / `reset` / `truncated` **零改动**；
鉴权仍在 upgrade 阶段完成，新增字段不影响 401 路径。

### 消费者契约（mobile 已接入；desktop 留 E6）

1. 按 `seq` 升序应用；`seq <= 本地游标` 直接丢弃——replay 不会重复应用 live 已推进的 seq。
   但消费面是 **at-least-once**：持久化节流窗口（50 条 / 250ms）内进程被杀，冷启动可能重放少量
   已应用 seq；消费者必须容忍重复（当前均为幂等刷新，REST 对账吸收）。
2. `hasMore` → 用最后已应用 seq（与 `nextSince` 在服务端契约下相等）继续拉直到 `false`；客户端设页数上限（mobile 100 页）并把触顶当作**未补齐**（`pageCap` fallback，不伪装成功）。`hasMore` 页的 `nextSince` 不能前进（`nextSince <= since`）= 契约违约 → **`protocol` fallback**（E7-5），游标停在最后已应用 seq，由调用方全量重拉，绝不报 `recovered`。
3. `reset` / `truncated` / replay 请求失败 / 旧网关 404·503 → **全量重拉**；`reset`/`truncated` 把游标置 `headSeq`，临时失败保留旧游标下次重试。`protocol` 违约与 `pageCap` 一样按「补齐失败」处理。
4. `part.delta` 等 seq 缺失的瞬态帧**不推进游标、也不在 replay 里**。
5. 重连顺序：replay 完成后再刷新页面；首次连接（无游标）用 greeting `headSeq` 建立 baseline，不 replay。
6. 纪元变化：持久化游标同时记录 `instanceId`；greeting 的 instance 与存档不同 → 丢弃游标、按新 head 重建并全量重拉。

移动端细节见 `docs/architecture/mobile.md` §7.5；桌面 replay 接入与事件→增量补丁属 E6。
`nextSince<=since` 短缺口由 E7-5 的 `protocol` fallback 收口；E5b 的同实例 reset 低 head
（显式 reset 现在允许把游标降到 head）与 busy greeting 丢弃（改为排队重跑一次）由 E8-4 收口，
不再静默跳过或整段生命周期不恢复。

---

## E7 部署前 deferred 收口（2026-11-13）

> 把 E1–E6 里影响**部署安全 / 资源 / 契约门禁**的 deferred 收口；大范围 schema 覆盖、
> mobile 工作 tab 重做等不阻塞部署的项继续保留（timer 台账已由 E8-1 收口）。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e7-deferred-cleanup-design.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e7-deferred.md`。

| # | 现状（收口后） |
|---|---|
| E7-1 | **剩余 human-only 路由**：统一 helper `gateway/src/core/http/human-guard.ts#requireHumanPrincipal(req, res)`（`isHumanPrincipal` → 放行；否则 403 `{error:'human principal required', code:'human_principal_required'}`，缺失 principal fail-closed）。接入 `POST /api/goals/:id/plan-approval`、`triage.confirm` / `triage.reject` / `triage.dismiss`、`lead.boundaries.accept` / `merge` / `undo`、`approvals.respond`、`permissions.reply`，review 轮补 `goals.respondQuestion`、`questions.reply` / `questions.reject`；只读 / 建议面（GET plan、triage list/propose、lead list/observe、approvals list、permissions list、questions list、`permissions.replyRuntime`）不拦。旧 pods/decisions/standing-goals 的 helper 不重构。 |
| E7-2 | **SDK 死面清理**：`contract.test.ts` 删除 `DEAD_CONTRACT_TODO`、过滤与陈旧守卫（review-items 4 op 由既有 `pods.goals.reviewItems*` 覆盖，契约 **4/4 无豁免**）；删除 `session.events()`、`event.url(sessionID?)` 参数（恒为 `${base}/api/events`）、`SSEConnection.connectToSession()`。全仓无生产调用方；**breaking** 见 release。 |
| E7-3 | **worktree 配额回滚**：`createSessionWithWorktree` 在 `deps.createSession` reject（429 / runtime 失败）时 best-effort `manager.remove(dir, branch)`，不写 kv 映射，并**原样 rethrow** 原错误；remove 失败不掩盖 429/500。**只有 `createSession` 在回滚作用域内**：`kvSet` 映射写在 try 之后（review 轮 F1），它失败时错误照样上抛，但绝不回滚一个**已存在会话**的 worktree。成功路径不变。 |
| E7-4 | **MCP 磁盘门**：`Services.pressure?: () => {disk, degraded} \| null` 由 kernel 注入 governor live getter（无 governor → `null` fail-open）；`handleAddMemory` 在 authority 校验后、写盘前检查，critical → `{success:false, code:'disk_low'}`（`isError:true`），store/embedding 零调用。 |
| E7-5 | **客户端小残留**：mobile `MafwSession.timeUpdated`（`fromJson` 读 `time.updated`、`copyWith` 透传、`applySessionListEvent` 更新并**按 `timeUpdated ?? timeCreated` 重排**，Lead 仍最前；title-only patch 不重排）；mobile `EventRecoveryService` 对 `hasMore && nextSince <= since` 返回 `fellBack('protocol')`（游标停在最后已应用 seq，不再假 `recovered`）；desktop `SseConnection` 在 replay `reset` / `truncated` 后 `writeSeq(headSeq)`，下次冷启动只补新缺口、不重复全量重同步。 |

### Review 补丁轮（E7-1 / E7-3）

- **F4 问题应答全部 human-only**：`goals.respondQuestion`（目标问题回答 / 取消）与
  `questions.reply` / `questions.reject`（runtime 问答应答）补上 `requireHumanPrincipal`；
  门在 **body 读取之前**，被拒请求不消费请求体、不碰 ledger / driver。
  `questions.list`、GET timeline 等只读面不变。
- **副作用（intended）**：MCP 工具 `mafw_answer_question` 走 loopback 无凭据 → principal 为
  `local` → 现在拿到 403 `human_principal_required`。即 agent 不能再「代用户回答」目标问题。
  **处置（E7 review 后续，`fix(mcp): remove agent impersonation question tool`）**：定义 /
  handler / registry entry / `runtime/tool-classes.ts` 注解 / manager allowlist 全部删除，
  `handlers/manager-answer-question.ts` 删除；`tool-registry-annotations.test.ts` 加缺失断言
  防止回填（与「MCP 不提供 human 工具」不变量一致）。人类回答只走 human-token HTTP / UI。
- **F1 回滚边界**：`createSessionWithWorktree` 里 `kvSet` 移到 `createSession` 的 try 之外；
  kv 失败不再删掉活会话的 worktree / branch，错误照原样上抛。

### 残余（E10b 后仍 deferred）

> 现行清单以「E11 身份 / 配额硬化 · 残余」为准（E11 已收口插件 / manager 配额副作用与 admission 复检，
> 并把 OS keychain / MCP human 工具定为 won't do）。此处只保留 E10b 时点的历史口径。

- 剩余约 273 个 op 的 response schema 覆盖（317 operations 中 44 个已带 200 schema，13.9%；
  台账 `npm run schema:coverage`，见「E10 契约覆盖」/「E10b 契约覆盖第二批」节）。
- ~~插件 / manager 会话的配额副作用（内部会话失败只 log）~~、~~调度准入复检（admission re-check）~~、
  ~~OS keychain / 进程签名、MCP human 工具~~：E11 已收口 / 裁决，见「E11 身份 / 配额硬化」。
- 强制版本协商 / SDK 全量 schema 类型化。
- POST/PUT/PATCH/DELETE 的请求/响应 schema（E10 / E10b 只建模读接口的 200 成功体）。
- **won't do**：`pod.updated` 记录级实体 payload（E9-3，理由见下节）、mobile 工作 tab 的其余增量渲染
  （E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- E10 有意保留的松口：`PodGoal` 的可选性（`bucket` / `accepted` / `progress` / `revision` / `priority`…）
  仍比 handler 实际输出宽（收紧要动约 12 个 DTO 字段并打破桌面测试夹具，E8 先例）；`FileDiffInfo.file`
  仍可选，而 `session.diff` schema 的 `MafwDiff.file` 必填。

---

## E8 剩余工程债收口（2026-11-13）

> 清 E1–E7 里**纯工程债**的剩余 deferred：timer 台账、preload 死参数、6 个核心读 op 的
> response schema、E5b 两个恢复残留、删除死 `authorizeWsUpgrade`。不改 wire shape、
> 不扩产品面（schema 只加 OpenAPI 元数据）。大范围 schema 覆盖、mobile 工作 tab、
> OS keychain / MCP human 工具等产品级项继续保留。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e8-residual-engineering-design.md`；
> plan：`docs/superpowers/plans/2026-11-13-gateway-e8-residual-engineering.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e8-residual-engineering.md`。

| # | 现状 | 边界 |
|---|---|---|
| E8-1 | **kernel/boot 长驻 interval 全部进 `TimerService`**：`kernel.ts` 新增 `startPodEventTimers()`（`pod:event-prune` 24h、启动立即跑一次；`pod:event-wake` 60s）与 `startHousekeepingTimers()`（`heartbeat:sweep` 30min、`queue:sweep` 60s、`session:sweep` 60s）；`serve:watchdog` 改 `timers.every` + `timers.clear`；`boot.ts` 注入 `timers`，`discovery:heartbeat`（10s）同样注册、`releaseInstanceOwnership` 清。handle 字段改 `TimerHandle`；`stop()` 先 `disposeAll()` 再把 handle 归零，再次 `start()` 会重建而不是被幂等 guard 跳过。unref 语义不变。 | 5s 启动 Pod 扫描仍是短命 `setTimeout`（不属于命名长驻台账）；插件 loader / self-update / 第三方 transport 的本地 interval 留在各自模块（非长驻台账范畴）。`/api/kernel/stats.timers` 新增这 7 个名字，纯观测。 |
| E8-2 | **desktop preload 死参数清理**：`mafw-types.ts` `EventApi.url(): Promise<string>`、`mafw-api.ts` `url: () => invoke("event","url")`——不再转发可选的 `sessionID` 第三参；唯一生产调用方 `MafwShell.tsx` 本就零参。 | 本仓库没有 `event/url` 专用 main handler：统一入口是 `mafw-invoke` → `resolveIpcMethod` → SDK `events.url()`（E7-2 起已零参）。运行时行为不变，只是删掉已无意义的形参。 |
| E8-3 | **6 个核心读 op 的 200 response schema**（只加 OpenAPI 元数据，handler 零改动）：`session.get`（复用 `schemas/session.ts#SessionSchema`）、`session.messages`（flat `{data, nextCursor}`）、`decisions.list`、`attention.list`、`memory.stats`（internal diagnostics bag）、`pods.get`。catalog 从来没有 Pod 列表 op（`pods.ensure/lookup/create` 都返回单 Pod，单 Pod detail 是 `pods.get`），第 6 个按 plan 允许的替换取 `pods.get`。`overrides.json` 删除重复的 `session.get` / `session.messages` responseSchema（catalog 成为单一来源，`session.messages` 仅保留 prose description）；重生成 `gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`。 | `pods.get` 是 **exact DTO 等值**（SDK `PodDetail` ↔ schema，含 `PodAttentionItem.revision` / 六种 kind）：未来任何 additive Pod 字段必须同改 `types.ts` 与 `schemas/pods.ts`。`session.messages` 的 part 变体仍由 `contract/view-dto.json` 拥有，schema 只承诺 `type` + open fields。emit 后 **282 paths / 316 operations**，带 200 schema 的 op 从 **16 → 20**（`session.get` / `session.messages` 此前由 `overrides.json` 提供，本次迁到 catalog，净增 4 个）；其余约 296 个 op 仍无 response schema。 |
| E8-4 | **E5b 恢复残留（mobile）**：`EventRecoveryService` 的 `reset` / `truncated` 分支改为**显式权威**——无条件 `_cursor = headSeq`，同实例事件日志重启后新 head **低于**旧游标也照落（旧游标属于死 seq 空间，只抬不降会 reset-loop）；非 reset 的 live 帧 `observe` 仍单调。新增 `isRecovering` / `settled`，`recover()` 在完成 completer 之前清 `_recovering`。`RecoveryCoordinator` 把 replay 在途时到达的 greeting 挂起**一个**，`settled` 后立即重跑一次（`busy:true, queued:true`）；第二个并发 greeting 直接丢弃（`queued:false`）；**epoch change 不排队**（在途 replay 属于旧纪元，直接重建 baseline + 全量重拉）；intentional disconnect / 后台交接仍在上游 `WsClientV2._notifyGatewayReady` 丢弃。 | 排队重跑会再 refresh 一次（幂等 REST 对账，最多两个快速 greeting 两次刷新）；epoch-change greeting 仍会观察到旧 epoch 在途 replay 的游标变更（既有 E5a/E5b 行为，调用方总是全量重拉）。 |
| E8-5 | **删除死 `authorizeWsUpgrade`**：`gateway/src/core/auth.ts` 的 `authorizeWsUpgrade`、`WsAuthRequest`、`WsAuthResult`、`WS_401_BYTES` 删除；WS upgrade 只走 `http/ws-upgrade.ts` 的 `resolvePrincipal`，不存在第二套凭据矩阵。`WS_UNAUTHORIZED_RESPONSE` 保留（byte-identical，upgrade 两个 401 站点共用）；`authorizeRequest` 保留（registry-dispatch 的 service/local 判定）。原 7 条重复测试删除，新增 1 条 pin upgrade 401 字节。 | 无生产调用方（grep 只命中注释 / 测试 / 文档）。删除是**编译期 breaking**（内部导出面），wire 不变。 |
| E8-6 | 收口：本节 + `docs/architecture/{desktop,mobile}.md` 现状 + release 记录 + 全量门禁 + ledger（docs-only）。 | 剩余 deferred 见上「残余」。 |

---

## E9 交互补齐（2026-11-13）

> 清 E6 后剩下的三个交互 deferred：mobile 工作 tab 不响应 pod/run flat 事件、attention 无 decision
> 投影、`pod.updated` payload 过薄。前两项落地，第三项明确 **won't-do**。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e9-interaction-completion-design.md`；
> plan：`docs/superpowers/plans/2026-11-13-gateway-e9-interaction.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e9-interaction.md`。

| # | 现状 | 边界 |
|---|---|---|
| E9-1 | **mobile 工作 tab 吃 flat pod/run 事件**：`pod.updated` / `pod.event` / `run.updated` 是 gateway 顶层 flat 广播（名字同时是 canonical 词汇），mobile 现在按 dual-shape 解析（`kMafwDualShapeEventTypes` spread 进 `kMafwFlatEventTypes`）、`shouldRefreshWork` 命中，并从 `properties.goalId`（回退 `data.goalId`）取 goal id，命中 `WorkRefreshBus` 的按 Goal 局部 patch。 | gateway 与 SDK 契约零改动（三个名字本就是 gateway 的顶层广播；parity 测试用「契约前缀 + 固定 dual-shape 尾巴」钉住）。消费细节见 `mobile.md` §7.10。 |
| E9-2 | **attention 投影 draft decision**：`AttentionKind` 新增 `'decision'`（`PRIORITY.decision = 85`，介于 `direction_review` 90 与 `answer` 80）；`decisionAttentionInput` / `appendDecisionAttention` 只投影 `status === 'draft'` **且带 `goalId`** 的记录（id / coalesceKey `decision:<recordId>`，action `{type:'open_decision', goalId, itemId}`，detail 取 `rationale ?? consequences`）；`AttentionRouteDeps.decisions?(projectDir)` 在 reviews 之后追加，kernel 注入 `decisionRecords.list(projectDir)` 且 **fail-open**（读失败 → `[]`，不拖垮 attention）；SDK `AttentionKind` 与生成契约（`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`）同步。 | **goal-less draft 不进 attention**：`AttentionItem.goalId` 是 string，无法表达无 Goal 的记录——它们不进 attention（chat 决定板已于 2026-11-16 移除，由 Lead 消息转达）；`decided` / `shelved` 已结算，永不投影。桌面侧映射与去重见 `desktop.md` §「Attention decision 投影与决定板去重」。 |
| E9-3 | **`pod.updated` 记录级 payload —— won't do**。维持 `{podId, kind}` 级刷新：desktop `podStore.ingest` 对当前 Pod 全量 `refresh()`，`kind:'review'` 已 bump `reviewRevision`；`goalId` 在 goal/revision/result 事件上已有，消费侧需要时可自行按 Goal 收敛（当前 desktop 仍整 Pod refresh）。 | 不引入完整 PodDetail / 实体 payload：member/task 高频广播下事件体积过大，且「事件快照 vs REST 权威」的一致性风险不划算；kind 级刷新 + 可用时 `goalId` 已足够。E9-1 修复后 mobile 至少能消费这些 flat 帧。 |

---

## E10 契约覆盖第一批（2026-11-13）

> 把 desktop / mobile 实际消费的**读接口**从「无 schema」变成可校验契约，并建立可重复的覆盖率台账。
> 本波只做 16 个读 op + 台账 + `session.get` 404；handler 输出零改动（404 除外），不改路由集合。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e10-contract-coverage-design.md`；
> plan：`docs/superpowers/plans/2026-11-13-gateway-e10-contract-coverage.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e10-contract-coverage.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10-1 | **session 读接口 8 ops** 的 200 response schema（`routes/schemas/session-read.ts`，new）：`session.queue.list`（`{items: QueueItem[]}`）、`session.config`（`SessionConfigState`）、`session.todo`（`{data: Todo[]}`）、`session.children`（`{items: 子会话[]}`）、`session.tokenSummary`（4 字段）、`session.checkpoints`（`{checkpoints: SessionCheckpointListItem[]}`）、`session.subagents.list`（`{items: SubagentRecord[]}`）、`session.diff`（`{files: MafwDiff[]}`）。 | `session.children` 是唯一 schema-only：wire 的 item 由 runtime 拥有（opencode 原生 `/session?parentID=` / pi 的 `AdapterSession`，只有 `id` 必填），因此**不**组合 `SessionSchema`（会要求 pi 不保证的 title/directory/time），改用带 owner 注释的边界对象，只承诺 `id` + `depth`。queue 的 `parts` 是客户端 prompt payload 边界（owner = view-dto part 联合），AssertEq 拆成「其余字段等值 + part 边界」，与 `session.messages` 先例一致。 |
| E10-2 | **Pod / Work 读接口 8 ops**：`work.overview`（`routes/schemas/work.ts`，new：5 桶 × `PodGoalSchema` + 同源 `counts` + `total`）、`pod.events.list`、`pods.tasks.list`、`pods.messages.list`、`pods.goals`、`pods.goals.result`、`pods.goals.reviewItems`、`pods.cost`（`routes/schemas/pods.ts` 扩展）。 | `groups[bucket]` 与 `counts[bucket]` 是同一 `goals.views()` 数组的两个投影（handler 不截断），按严格五桶建模，不做 `additionalProperties` 放宽；`PodGoalResult.receipt` 是 goal driver 拥有的不透明 receipt JSON（`unknown \| null`，带 owner 注释）。 |
| E10-3 | **覆盖率台账 + `session.get` miss 语义**：`gateway/scripts/schema-coverage.cjs`（文本解析 catalog，输出 total / covered / byTag / uncovered，`--json` 机器可读）+ `npm run schema:coverage`；测试 `tests/unit/architecture/schema-coverage.test.ts` pin 住 29 个覆盖 op、`total === 316`、脚本与 `buildRouteCatalog()` 一致。`session.get` 对不存在会话由 `200 {error:'not found'}` 改为 **404 `{error:'not found'}`**（body 逐字不变，与 `SessionSchema` 对齐）。 | 脚本是**文本扫描器**：catalog entry 必须保持 `method` / `path` / `operationId` 字面量形态，解析漂移会由 catalog↔脚本一致性断言立刻打红。404 是**唯一 wire 变化**；旧 desktop 构建产物若依赖 200 信封需升级（见 release 的 breaking 节）。桌面侧处理见 `desktop.md` §「缺失会话 404（E10-3）」。 |

### 台账口径与推进方式

- **基线 13/316，本波终值 29/316（9.2%）**，剩余 287 个 op。基线口径以脚本实测为准
  （E8 release 里「20/316」是含非 catalog 统计的旧口径）；`schema:coverage` 的 by-tag 分区和恒等于 covered。
- **每批 8 ops**：先按「谁在消费」挑一组同族读接口（本波 = session 读 8 + pod/work 读 8 / 2 个 commit），
  写 TypeBox schema → catalog 挂 `RouteDef.response` → `npm run emit:openapi`（gateway）→
  SDK `npm run gen:api`（`merge-contract.mjs` + `openapi-typescript`）→ 生成物入库（
  `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts`）。
- **schema 是 handler 的投影，不是 wish-list**：字段以 handler 实际 wire 为准，不得为了好写把响应放宽成
  `Unknown` / `additionalProperties: true`；边界对象只允许用于 runtime / 外部拥有的 payload，且必须在注释里
  写明 owner（先例 `MafwPartBoundary`、`session.children`、`PodGoalResult.receipt`）。
- **有 SDK DTO 的 op 必须 `AssertEq`**（`packages/gateway-sdk/src/contract-compat.checks.ts`，编译期）：
  本波 16 op 中 15 个有等价断言（仅 `session.children` 因 item 归 runtime 所有而只能 schema-only；
  `tokenSummary` / `pods.cost` 借 client 的内联返回类型，不新增命名 DTO）。
  schema 与 DTO 冲突时**以 handler 为准修 DTO**，并在批次报告里列出受影响消费者（本波 5 处收紧、0 破坏性消费者）：
  `SessionConfigState.thinkingLevelSupported` 改必填、`SessionCheckpointListItem` 拆分列表条目、
  `PodMessage` 4 个字段改必填可空、`PodGoalResult`（含 `PodGoalCondition` / `PodGoalResultFailure`）与
  `PodEventItem` 的 `reason` / `audience` / `severity` 收紧成联合类型。
- 每个 op 只建模 **200 成功体**，错误体不建模；请求体 schema 仍 deferred。

---

## E10b 契约覆盖第二批（2026-11-13）

> 承接 E10（13 → 29/316）。本批覆盖 **15 个读接口**：Goal / Pod Goal 8 + human-gate / 权限 7；
> 同时把 5 个历史 override 转成 code-first（override 条目删除，catalog 成为单一来源）。
> handler 输出零改动、路由集合不变；规则与生成链沿用 E10。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e10b-contract-coverage-design.md`；
> plan：`docs/superpowers/plans/2026-11-13-gateway-e10b-contract-coverage.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e10b-contract-coverage.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10b-1 | **Goal / Pod Goal 读接口 8 ops** 的 200 response schema：`routes/schemas/goals.ts`（new）承载 `goals.list` / `goals.plan` / `goals.sessions` / `goals.timeline` / `goals.source`，`routes/schemas/pods.ts`（扩展）承载 `pods.goals.techLead` / `pods.goals.probes` / `pods.goals.revisions`；catalog 逐条挂 `response`。`AssertEq`：`Goal` / `GoalSessionInfo` 保持，新增 `GoalPlanInfo` / `GoalTimeline` / `GoalNodeRunInfo` / `GoalSource`（借 client 内联返回类型）/ `PodTechLeadHistory` / `PodProbe` / `PodGoalRevision`。 | `goals.list` 的 activeGoals 投影只发 `goalId/phase/loop/nextAction/error/updatedAt`，从不发波次计数 → 同一个 `Goal` DTO 的 `currentWave` / `totalWaves` 由 required 放宽为 **optional**（`goals.get` 的 `GoalViewSchema` 同步放宽以保持精确等价）。`GoalPlanInfo` 按 handler 实际 wire 扩展（`revision` / `wavesPath` / `goalEval*` / `planHash` / `evalHash` / `stale`，`waves` 是 **plan 文档边界**（`PlanDocumentBoundary`：`status` / `taskType` / `strategy` / `waves[]` / `ambiguities` + `additionalProperties: true`），**不是** `GoalPlanWave[]`——数组在 `waves.waves`，与 handler 原样透传 `wavesPath` 文件一致；E10b-5 修正）；`GoalTimeline` 的 `planReview` / `planApproval` 改 required（后者带 revision/planHash/evalHash），`artifacts.receipts` 为 `(string \| null)[]`。消费面：TUI 只做模板字符串展示、desktop 只 re-export 类型 → **0 破坏**。 |
| E10b-2 | **Human-gate / 权限读接口 7 ops**：`routes/schemas/human-gate.ts`（new）承载 `approvals.list` / `questions.list` / `triage.list` / `permissions.list` / `permissions.getMode` / `permissions.listAllowlist` / `permissions.listRules`。`AssertEq`：`Approval` / `QuestionRequest` / `TriageItem` 保持（DTO 同步到 handler truth），新增 4 条 permissions 断言。`contract/overrides.json` 删除 5 条（`goals.list` / `goals.sessions` / `approvals.list` / `questions.list` / `triage.list`），`$comment` 记录迁移原因。 | **「catalog response wins」语义**：`merge-contract.mjs` 先取 catalog `RouteDef.response`，overrides 只在 catalog 缺失时兜底；这 5 个 op 的 override responseSchema 与 handler 长期漂移，转 code-first 后删除条目，生成物只对本批 op 变化。**DTO 以 handler 为准修正**（consumer-relevant）：`Approval.goalId` / `createdAt` required → optional、`status` 只 `pending \| answered`（`expired` 无 writer）；`QuestionRequest` 新增 `time?: { created?: number }`；`TriageItem` 从 override 遗留的 phantom 形状（`goalId/reason/severity/createdAt`）重塑为磁盘 wire `{ id, automationId, discoveredAt, source, summary, state, userAction, deadline, proposedGoal?, llmSuggestions?, updatedAt? }`；`permissions.list()` 返回 canonical `MafwPermissionRequest`。无 handler 改动；桌面 `TriagePage` 的 phantom 字段读取由 E10b-3 收口。 |
| E10b-3 | **桌面消费面收口**：`renderer/mafw/triage-model.ts`（new）把 wire 记录映射成 `{title, meta, badge}`；`TriagePage` 改用 `TriageItem[]`（去 `as any[]`），趋势色改走既有 token 类 `.mafw-tool-badge[data-tone]`；preload `permissions.list()` 声明 canonical `MafwPermissionRequest[]`。详见 `desktop.md` §「Triage 渲染对齐真实 wire（E10b-3）」。 | 菜单 target 只保留 `{ id }`；`triage.viewGoal` 不再猜 Goal id（打开 Goal 面）。不展示 `proposedGoal.boundaries` / `estimatedLoops`，也不凭空造 severity。 |

### 台账口径（E10b）

- **29 → 44/317（13.9%）**，剩余 **273** 个 op；by-tag 分区和恒等于 covered
  （`npm run schema:coverage` 为准，本轮 `goals 6/15`、`approvals 1/2`、`permissions 4/10`、
  `questions 1/3`）。合并 main 后 catalog 316 → **317**：main 新增
  `session.discoverySkillInvoke`（无 `response`，covered 不变，E10b-6 重算）。
- **override 18 → 13**：本批 5 个转 code-first 后删除条目；`merge-contract` 仍提示
  `session.list: catalog response schema wins over overrides`（该条 override 元数据的历史遗留，
  非本批范围）。
- 本批 15 op 的输出全部是 **exact DTO 等值或 handler 投影**，但有 **4 类边界对象**（都有 owner 注释；
  E10b-5 修正了此处原先「没有新增边界对象」的错误说法）：
  1. `goals.plan` 的 `waves` = **plan 文档边界**（`PlanDocumentBoundary`，owner = goal-plan protocol
     artifact，产出契约 `core/goal/node-prompts.ts` 的 `PLAN_OUTPUT_SCHEMA`）：`status` / `taskType` /
     `strategy` / `waves[]`（数组在文档内）/ `ambiguities` + `additionalProperties: true`，
     driver 演进字段原样透传；`null` arm 保留（文件缺失/损坏）。
  2. `triage.list` 的 `TriageItem` **磁盘 wire 重塑**（owner = automation-engine triage JSON，
     `summary` 是草稿袋，`proposedGoal` optional）。
  3. `permissions.getMode` / `permissions.listAllowlist` / `permissions.listRules` 的**扩展投影**
     （无独立 SDK DTO，借 `PermissionsNamespace` 返回类型做 `AssertEq`）。
  4. `questions.list` 的 `QuestionRequest.time` **残留可选**（只读面只在源带 `createdAt` 时补齐）。

---

## E10c 契约覆盖第三批（2026-11-14）

> 承接 E10b（44/317 → 45/318，E11-1 新增的 `humanToken.rotate` 占 1）。本批覆盖 **8 个读接口**：
> memory 2 + recall 4 + lead 2，并把 `memory.search` 从 override 转成 code-first。
> handler 输出零改动、catalog 仍是 318 ops（不新增路由）；规则与生成链沿用 E10 / E10b。
> spec：`docs/superpowers/specs/2026-11-14-gateway-e10c-memory-recall-coverage-design.md`；
> plan：`docs/superpowers/plans/2026-11-14-gateway-e10c-memory-recall-coverage.md`；
> 交付记录：`docs/releases/2026-11-14-gateway-e10c-memory-recall-coverage.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10c-1 | **memory / recall / lead 读接口 8 ops** 的 200 response schema：`routes/schemas/memory.ts`（new，`memory.search` / `memory.get`）、`routes/schemas/recall.ts`（new，`recall.context` / `recall.pinned` / `recall.instructions` / `recall.priors`）、`routes/schemas/lead.ts`（new，`lead.recall` / `lead.workingSet`）；catalog 逐条挂 `response`。`AssertEq`：`memory.search.results` 与 SDK `MemoryUnit` 保持（既有 `CHECK_memory_search`），新增 `CHECK_memory_search_t1_item`（`t1Results` item ↔ `T1SearchHit`）。`contract/overrides.json` 删除 `memory.search.responseSchema`（13 → 12），`merge-contract` 只剩 `session.list` 的历史提示。 | **`memory.search` override → code-first**：handler 三出口 `layer=gist → {results}`、`layer=t1 → {results:[], t1Results}`、`layer=both → {results, t1Results}`，故 `t1Results` optional、`results` 恒为数组；降级分支（index 有、OKF 文件缺失）补的 `tier` 是索引级字段，**不建模**（JSON Schema 未关 `additionalProperties`，多余键合法），MemoryUnit 精确等价优先。**`memory.get` 200 是三变体 union**（Harmonic unit 体 `{success, memory, latest?, source?}` / legacy `t1:<tail>:<turn>` / 永久 `t1:<traceId>`），不做「全 optional 宽松对象」；**404 体**（`{success:false, error, candidates?}`，含 ambiguous tail 候选）**不是 200 schema 的一部分**，由 api-contract 用例反向断言排除。`recall.*` 四面都是 **fail-open 200**（内存服务缺失 / 渲染异常 / 检索异常 → 中性空体），无 4xx/5xx 需建模；`recall.pinned.entries` 的 `salience` / `created_at` 按 legacy OKF 缺键保守设 optional。`lead.*` 两路由恒 200，`LeadTopicView` 是 `toView` 投影（不含 session id / 索引行，`summary` / `resumedFrom` 为 `string \| null`，`state` 是 `normalizeState` 四值闭词表）。 |

### 台账口径（E10c）

- **45 → 53/318（16.7%）**，剩余 **265** 个 op；by-tag 分区和恒等于 covered
  （`npm run schema:coverage` 为准，本轮 `memory 1/7`（`memory.get` 在 `internal` 组）、
  `lead 2/11`、`internal 11/73`（含 recall 4 + `memory.get`））。
- **override 13 → 12**：`memory.search` 转 code-first 后删除条目，`$comment` 记录 E10c-1；
  生成物 `gateway-paths.json` / `openapi.json` / `api-schema.gen.ts` 的 diff **恰好**落在本批 8 个 op
  （added 0 / removed 0），`gen:api` 二次运行幂等。
- 本批 8 op 全是**读诊断 / 宿主注入面**：`memory.search` 走 SDK DTO 精确等价，`memory.get` /
  `recall.*` / `lead.*` 无 SDK client（`internal` / `lead` tag），schema-only + api-contract 断言。
- **已知漂移风险（deferred）**：`memory.get` 的 `HarmonicUnitSchema` 是 `core/memory/harmonic-types.ts`
  **手工镜像**（`HarmonicUnit` 不是 SDK DTO，没有 `AssertEq` 可钉）→ 新增 harmonic 字段不会打红任何测试。
  缓解：schema 只做描述、未关 `additionalProperties`，多余键不会判非法；要强约束需在 gateway 侧加
  `AssertEq<typeof HarmonicUnitSchema, HarmonicUnit>` 编译期桥（本批范围外）。**E10f-E 已加该桥**
  （对称 `Omit<'created_at'>` 双向等值 + `created_at` 单独断言，`npx tsc` 即门禁）。`memory.get` 若将来开 SDK
  client，返回类型会是三变体 union 而非扁平 `{memory}`。

### 残余（E10c 后仍 deferred）

> 本节是 E10c 收口时的快照；其中 `memory.get` 的 HarmonicUnit 桥与 mobile triage phantom 已在
> **E10f-E** 关闭（见「E10f 全量读表面收口」）。

- 剩余约 **265** 个 op 的 response schema 覆盖（318 operations 中 53 个已带 200 schema，16.7%；
  台账 `npm run schema:coverage`，见「E10 契约覆盖」/「E10b 契约覆盖第二批」/「E10c 契约覆盖第三批」）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema（E10 / E10b / E10c 只建模读接口的 200 成功体，
  错误体不建模——`memory.get` 的 404 体只在测试里做反向断言，不进 schema）。
- 强制版本协商 / SDK 全量 schema 类型化。
- TUI / mobile 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 无这些字段）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- `memory.get` 的 HarmonicUnit 编译期 `AssertEq` 桥（见上「已知漂移风险」）。

---

## E10d 契约覆盖第四批（2026-11-14）

> 承接 E10c（53/318）。本批覆盖 **8 个读接口**：memory 扩展 4 + `lead.context` 1 + pod 读 3。
> handler 输出零改动、catalog 仍是 318 ops（无新增路由）、override 不变（12）；规则与生成链沿用 E10 / E10b / E10c。
> spec：`docs/superpowers/specs/2026-11-14-gateway-e10d-memory-pods-coverage-design.md`；
> plan：`docs/superpowers/plans/2026-11-14-gateway-e10d-memory-pods-coverage.md`；
> 交付记录：`docs/releases/2026-11-14-gateway-e10d-memory-pods-coverage.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10d-1 | **memory 扩展 / `lead.context` / pod 读接口 8 ops** 的 200 response schema：`routes/schemas/memory-extra.ts`（new，`memory.mergedSearch` / `memory.getEnergyDistribution` / `memory.getL5Axioms` / `memory.listSticky`）、`routes/schemas/lead.ts`（扩展，`lead.context`）、`routes/schemas/pods.ts`（扩展，`pods.transcript` / `pods.goals.worktree.diff`）、catalog 挂 `pods.lookup`。`AssertEq`：`mergedSearch.results` item ↔ `MemoryFact`、`getEnergyDistribution` ↔ `EnergyDistribution`、`getL5Axioms` ×2（`Axiom` / `L5Heuristic`）、`listSticky` ↔ client `memory.listSticky` 返回类型、`pods.lookup` ↔ `PodDetail`、`pods.transcript` ↔ client `pod.transcript` 返回类型、`worktree.diff` ↔ `PodWorktreeDiff`。 | **`pods.lookup` 复用 `PodDetailResponse`**：`handlePods` 的 lookup 分支与 `pods.get` 共用 `enrichPodDetail()`，字段面完全一致（非 lead 成员只是 `sessions: []`）→ 不另立 schema，api-contract 用 `schemaOf('pods.lookup') toEqual schemaOf('pods.get')` 钉住。**`pods.transcript.transcript` 是 runtime-owned 边界**（owner = runtime session history，`PodRouteDeps.transcript()` 直接透传；part 判别联合随 runtime 演进）→ 只承诺「外层仅此一键 + 值任意 JSON（`Type.Unknown()`）」，不整响应放宽。`memory.listSticky` 的 503 / catch 分支回**同形** fail-open 体 `{entries: [], budget}`，故 200 schema 恰好也描述两个降级体。`lead.context` 四出口同形（非 Lead / working set 关闭 / 无 projectDir → `EMPTY_CONTEXT`），`topicId` / `title` 只有 recalled-topic 块带 → optional。 |
| E10d-1b | **DTO 同步（仅类型面）**：`Axiom` 补 `source: 'manual' \| 'distilled'` 与 `created_at`；`L5Heuristic` 的 `success_rate` / `source_goal_ids` / `created_at` 由 optional 收紧为必填；`StickyNote.type` 从裸 `string` 收窄为 `MemoryUnit['type']`。三处都以 handler 写入面为事实源（`L5Store.addAxiom` / `addHeuristic` 恒写全列，note-board 条目来自 `HarmonicUnit`），零 handler 改动、wire 字节不变；desktop `NotesDock` 用自有 `type: string` 接口、TUI 只读 → 0 破坏性消费者。 | **历史数据可能比契约短**：`~/.mafw` 下更早版本 / 手工编辑过的 `axioms.json` / `heuristics.json` 若缺列，读路径 `JSON.parse` 不校验、wire 仍会缺键——OpenAPI 只是**元数据**（不运行时拒绝），契约描述的是当前 store 写入面。`memory.mergedSearch` 的 `MemoryFact.type` 仍是 `string`（接口未收窄：parametric 行恒 `'delta'`，harmonic 行取记忆词表），不枚举以免把开放度写进契约。 |

### 台账口径（E10d）

- **53 → 61/318（19.2%）**，剩余 **257** 个 op；by-tag 分区和恒等于 covered
  （`npm run schema:coverage` 为准：`memory 5/7`、`lead 2/11`（`lead.context` 挂 `internal`）、
  `pods 13/39`、`internal 12/73`）。
- **override 12 → 12**（本批不涉及）；生成物 `gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`
  的 diff **恰好**落在本批 8 个 op（added 0 / removed 0），`gen:api` 二次运行幂等。
- **AssertEq 拆分**：8 op 中 7 个有编译期断言（`getL5Axioms` 贡献 2 条——axiom + heuristic；
  `listSticky` / `pods.transcript` 借 client 内联返回类型，不新增命名 DTO）；`lead.context` 是
  **schema-only**（`internal` tag，host 每轮注入面，SDK 无 client / 无 DTO），等价性由 api-contract 钉住。

### 残余（E10d 后仍 deferred）

> 本节是 E10d 收口时的快照；其中 note-board `perNoteCap`、`memory.get` 的 HarmonicUnit 桥、
> mobile triage phantom 已在 **E10f-E** 关闭（见「E10f 全量读表面收口」）。

- 剩余约 **257** 个 op 的 response schema 覆盖（61/318，19.2%；台账 `npm run schema:coverage`，
  见「E10 契约覆盖」/「E10b 契约覆盖第二批」/「E10c 契约覆盖第三批」/ 本节）。
- **note-board budget 的 `perNoteCap` 未建模**（E10c `recall.pinned` / E10d `memory.listSticky` 同一选择）：
  wire 是 `{...NOTE_BOARD_BUDGET, used}`（含 `perNoteCap: 240`），schema / SDK `StickyNoteBudget` 只声明
  `max` / `maxChars` / `used`；补全会连带改 SDK 类型。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema；错误体仍不建模（`memory.get` 404 只在测试里反向断言）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **`memory.get` 的 HarmonicUnit 手工镜像漂移**（E10c 遗留）：`HarmonicUnitSchema` 仍无 gateway 侧
  编译期 `AssertEq` 桥，新增 harmonic 字段不会打红任何测试；要强约束需加 `AssertEq<typeof HarmonicUnitSchema, HarmonicUnit>`。
- TUI / mobile 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 只有
  `summary` / `source` / `state` / `proposedGoal`）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。

---

## E10e 契约覆盖第五批（2026-11-14）

> 承接 E10d（61/318）。本批覆盖 **8 个元数据 / 注册面读接口**，且**不新增 SDK DTO、不迁移 override**：
> handler 输出零改动、catalog 仍是 318 ops（无新增路由）、override 不变（12）；
> 规则与生成链沿用 E10 / E10b / E10c / E10d。
> spec：`docs/superpowers/specs/2026-11-14-gateway-e10e-meta-coverage-design.md`；
> plan：`docs/superpowers/plans/2026-11-14-gateway-e10e-meta-coverage.md`；
> 交付记录：`docs/releases/2026-11-14-gateway-e10e-meta-coverage.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10e-1 | **元数据 / 注册面 8 ops** 的 200 response schema：`routes/schemas/meta.ts`（new，329 行）承载 `agents.list`（`{items: MafwAgent[]}`）、`providers.list`（`{items, connected?, default?}`）、`mcp.servers`（`{servers: McpServerEntry[]}`）、`plugins.list`（`PluginsListResult`：`plugins[]` + `packages?` + `revision?`）、`skills.list`（`{skills: SkillRegistryItem[]}`，DB 行 + 零行补齐的 `stats`）、`tools.list`（`{tools: MafwToolSpec[]}`）、`config.get`（`GatewayConfig` 26 section 视图）、`scheduler.status`（`{active, queued, capacity, plan}`，`plan` 四键恒在）；catalog 逐条挂 `response`。`AssertEq`：`agents.list.items` item ↔ `MafwAgent`、`providers.list.items` item ↔ `MafwProvider`（另加信封残余 `connected` / `default` 两条 ↔ client 返回类型）、`mcp.servers.servers` item ↔ `McpServerEntry`、`plugins.list` ↔ `PluginsListResult`。 | **`config.get` 是「外层信封封闭 + section 内容边界」的组合**：200 body = `config.raw`（内置 defaults + `config.yaml` 深合并 + env 覆盖），`deepMerge` 对未知键同样写入 → section 内键集是**运维可扩展的**，逐字段转写等于把 `GatewayConfig` 手抄成无编译期链接的第二副本（静默漂移）。因此 26 个 section 名 **required 且由编译期断言钉死 ≡ `keyof GatewayConfig`**（新增 / 改名 section 直接红 tsc），每个 section 的值是 owner = gateway config loader（`Config.buildData`）的**边界对象**；**不整响应放宽**（顶层无 `additionalProperties`）。若后续要 section 级精度，应从 `GatewayConfig` 单点派生而非手写第二份。**`tools.list.parameters` / `outputSchema` 同样是工具作者拥有的 JSON Schema 边界对象**（owner = 各 tool spec 声明），不逐键建模；`providers.list` 的 `connected` / `default` 是 runtime provider channel 的原生信封残余（gateway 只透传），显式建模（composer 默认模型唯一来源）。 |
| E10e-1b | **零 DTO 改动**：4 个 SDK DTO（`MafwAgent` / `MafwProvider` / `McpServerEntry` / `PluginsListResult`）已与 handler wire 一致，`AssertEq` 一次通过；新增 **6 条编译期断言**（`CHECK_agents_list_item`、`CHECK_providers_list_item`、`CHECK_providers_list_connected`、`CHECK_providers_list_default`、`CHECK_mcp_servers_item`、`CHECK_plugins_list`）。 | 断言不是空转：负向探针把 `CHECK_agents_list_item` 改成 `AssertEq<GenAgentItem, { id: string }>` → tsc 报 `["MISMATCH", 生成形状, 手写形状]`（已还原）。`MafwAgent.extensions` / `MafwProvider.extensions` 当前投影不产出，但 DTO 声明 optional（AssertEq 要求等价）→ 契约面保留为可选扩展槽。 |

### 台账口径（E10e）

- **61 → 69/318（21.7%）**，剩余 **249** 个 op；by-tag 分区和恒等于 covered
  （`npm run schema:coverage` 为准：`agents 1/1`、`config 1/2`、`mcp 1/8`、`plugins 1/12`、
  `providers 1/1`、`internal 15/73` 含本批 +3：`skills.list` / `tools.list` / `scheduler.status`
  三个 op 都挂 `internal` tag）。
- **override 12 → 12**（本批不涉及）；生成物 `gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`
  的 diff **恰好**落在本批 8 个 op（added 0 / removed 0，318 ops / 284 paths 不变），`gen:api` 二次运行幂等；
  `merge-contract` 仍只提示历史的 `session.list: catalog response schema wins over overrides`
  （该 inert 条目已由 **E10f-E** 删除，命中 12 → 10）。
- **AssertEq 拆分**：4 个 DTO op 全部有编译期断言（`providers.list` 贡献 3 条：item + 信封两键）；
  `skills.list` / `tools.list` / `config.get` / `scheduler.status` 是 **schema-only**（`internal` tag；
  skills / tools / scheduler 无 SDK client，`config.get()` 在 SDK 只回 `any`），等价性由 api-contract 的
  8 例属性 / 线样断言钉住。

### 残余（E10e 后仍 deferred）

- 剩余约 **249** 个 op 的 response schema 覆盖（69/318，21.7%；**E10f 已把剩余 56 个 JSON GET 全部补齐，
  终值 125/318，见下节**；台账 `npm run schema:coverage`，
  见「E10 契约覆盖」/「E10b 契约覆盖第二批」/「E10c 契约覆盖第三批」/「E10d 契约覆盖第四批」/ 本节）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema；错误体仍不建模（`memory.get` 404 / `scheduler.status` 404
  只在测试里反向断言，不进 schema）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **TUI** 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 只有
  `summary` / `source` / `state` / `proposedGoal`）。~~mobile 侧~~ **E10f-E 已收口**
  （`mobile/lib/src/models/triage_card_model.dart`）。
- ~~**`memory.get` 的 HarmonicUnit 手工镜像漂移**（E10c 遗留）~~ **E10f-E 已关闭**：
  `schemas/memory.ts` 加 gateway 侧 `AssertEq` 桥（对称 `Omit<'created_at'>` + `created_at` 单独断言），
  tsc 即门禁。
- ~~**note-board budget 的 `perNoteCap` 未建模**（E10c `recall.pinned` / E10d `memory.listSticky` 同一选择）~~
  **E10f-E 已关闭，但两个 budget 的处理不同**：`memory.listSticky` 补 required `perNoteCap`（SDK
  `StickyNoteBudget` 同步）；`recall.pinned` **有意不补**——它走 `PINNED_BUDGET` 且不按条截断，
  加 required 字段会拒绝 handler 自己的体（详见 E10f 节「残余」）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。

---

## E10f 全量读表面收口（2026-11-14）

> 承接 E10e（69/318）。本波把 catalog 里**剩余全部 56 个 JSON GET** 补齐 200 response schema
> （**JSON GET 125/131 = 100% 覆盖**），并清掉 E10 系列遗留的 4 个工程尾巴。
> handler 输出零改动（唯二例外：`memory.listSticky` 降级体补发 `perNoteCap`、mobile triage 改读真实 wire），
> catalog 仍是 318 ops、无新增路由；规则与生成链沿用 E10 / E10b / E10c / E10d / E10e。
> spec：`docs/superpowers/specs/2026-11-14-gateway-e10f-read-completion-design.md`；
> plan：`docs/superpowers/plans/2026-11-14-gateway-e10f-read-completion.md`；
> 交付记录：`docs/releases/2026-11-14-gateway-e10f-read-completion.md`。

| # | 现状 | 边界 |
|---|---|---|
| E10f-A | **会话 / 任务 / 终端 / usage 16 ops** 的 200 response schema：`routes/schemas/session-runtime.ts`（new：`session.structured` / `session.trajectory` / `session.run` / `session.discovery` / `session.discoverySkill`）、`routes/schemas/experience.ts`（new：`experience.actions` / `cognition.rules`）、`routes/schemas/tasks.ts`（new：`tasks.list` / `tasks.get` / `tasks.output`）、`routes/schemas/background.ts`（new：`background.jobs.list` / `background.jobs.output`）、`routes/schemas/terminal.ts`（new：`terminal.list`）、`routes/schemas/usage.ts`（new：`session.usage` / `session.usagePluginsList` / `session.usagePluginSourceGet`）。新增 **18 条**编译期断言：`tasks.list` item ≡ `TaskEntity`（`publicTask()` 旁路快照 `outputCursor` / `outputSize` / `outputTruncated` 用 `Omit` 剥离后各自单独断言）、`tasks.output` 只锁 SDK 认的四字段、`session.run` ≡ client 返回类型（run 可为 null）、`session.discovery` / `discoverySkill`、`experience.actions`（键集 ≡ `EXPERIENCE_ACTION_IDS`，描述符 `Omit<'operationId'>` 后 ≡ SDK DTO）、`background.jobs.*`、`terminal.list`。 | **`tasks.output` / `tasks.list` 的旁路快照是 runtime shell 的透传字段**：schema 发全量、SDK DTO 只声明稳定面 → 分别用 `Omit` + 单独类型断言，不做整响应放宽。`session.trajectory` 的 SDK `TrajectoryTurn` 是缺 `sessionID` / `provider` 的 legacy 子集 → schema 按 handler 全量建模，DTO 不追平。**三个 usage op 是 schema-only**：SDK `usage()` 把 summary/memory/providers 声明成 `any`、`usagePlugins()` 仍是 `{plugins:[{overridden}]}` 旧形状、`usagePluginSource()` 把 200/403/404 混成一个类型 → 无可信生成类型可对齐，等价性由 api-contract 线样钉住。`cognition.rules` / `session.structured` 同样 schema-only（internal 面）。 |
| E10f-B | **项目 / manager / runtime / 元数据 16 ops**：`routes/schemas/project-meta.ts`（new：`mafwCommands.list` / `manager.session` / `project.current` / `fileHistory.list`）、`routes/schemas/runtime-surface.ts`（new：`runtime.get` / `runtime.contract` / `runtime.config.get` / `plugins.client`）、`routes/schemas/media-voice.ts`（new：`models.get` / `media.plugins` / `tts.voices` / `voice.status` / `python.status` / `agent.capabilities` / `media.resolveTask` / `embedding.get`）。新增 **23 条**编译期断言：`mafwCommands.list` item ≡ `MafwCommandDef`；`manager.session` 双形态 200（带 `?projectDir=` 单对象 / 无过滤数组）取单对象分支后「键集 ≡ `ManagerSessionInfo` + `createdAt ≡ string \| null`」；`project.current` `Omit<'mafwDir'>` 后 ≡ `Project`；`runtime.contract` ≡ runtime-contract 包的 `RuntimeContractResponse`；`plugins.client` 只锁外层键集 + `revision`；`models.get` 五段（recall / media / available / goal.nodeModel / goal.techLeadModel）；`media.plugins` item ≡ `MediaPluginState`；`tts.voices` 按 SDK 返回子集锁 voices / models / defaultVoice / defaultModel；`voice.status` / `embedding.get` 整响应等价。 | **`runtime.get` 的 `capabilities` 与 `unknownEvents` 是 runtime 拥有的开放键集**（值域不锁，只锁 `Record<string, boolean>` / `Record<string, Record<string, number>>` 形状）；`plugins.client` 的描述符内部归 `@mafw/plugin-contract` → 边界对象，契约只承诺外层快照。**`manager.session` 的数组分支不单独建 schema**（同一 `ManagerSessionInfo` 条目，双形态是 handler 的 query 语义而非两种实体）。`fileHistory.list` / `runtime.config.get` / `python.status` / `agent.capabilities` / `media.resolveTask` 是 schema-only（internal tag 或 handler 直接回 `any`）。 |
| E10f-C | **Goal / Lead / Events / Standing / Automations / Pods 16 ops**：`routes/schemas/lead.ts`（扩展：`lead.topics.list` / `lead.topics.get` / `lead.boundaries.list`）、`routes/schemas/events.ts`（new：sources / threads / triggers / subscriptions / deliveries 五个读面）、`routes/schemas/standing.ts`（new：`standingGoals.list` / `standingGoals.runs`）、`routes/schemas/automations.ts`（new：`automations.list` / `automations.get` / `automations.history`）、`routes/schemas/pods.ts`（扩展：`pods.ensure` / `pods.memory.get`）、`routes/schemas/read-models.ts`（`orchestration.outcomes`）。新增 **11 条**断言：`LeadTopicView` / `LeadTopicIndexMessage` / `LeadBoundaryView`（DTO 补 `text`，wire 恒发）/ `StandingGoalView` / `GoalRunView` / `EventSourceView` / `PodDetail`（`pods.ensure` 复用 `pods.get` schema）/ pod memory 两个返回类型 / `AutomationRuleListItem`（list）/ `Omit<'nextTriggers'\|'history'>` 后的 `AutomationRule`（get）。**`automations.list` override → code-first**（删条目，12 → 11）。 | **SDK DTO 以 handler 为准修正**：`AutomationRule` 重写为 wire 真形（`trigger` 必填 cron/event 联合、无 `name`），新增 `AutomationTrigger` / `AutomationGoalDefaults` / `AutomationLedgerEntry` / `AutomationRuleListItem`，`AutomationsNamespace.list()` 改回 `AutomationRuleListItem[]`。事件四个读面是 **schema-only**：handler 原样下发存储列（`projectDir` / `createdAt` / `idempotencyKey` / `readAt`…），SDK `Event*View` 是手写收窄声明而非投影函数，等价断言会说谎。`automations.history` / `orchestration.outcomes` 是 internal（后者是 `gateway.db` 的 snake_case `SELECT *`）。`automations.list` 仍会把 `~/.mafw/automations/*.json` 的未知键透传（与 `triage.list` 同约定，schema 不关 `additionalProperties`）。 |
| E10f-D | **观测 / 设备 / A2A 8 ops**：`routes/schemas/observability.ts`（new：`dashboard.stats` / `health.root` / `session.subagents.result`）、`routes/schemas/devices.ts`（new：`mobile.devicesList` / `devices.list` / `mobile.pairingCode`）、`routes/schemas/a2a.ts`（new：`a2a.agentCard` / `pods.a2aCard`）；`read-models.ts` 导出 `TokenCountsSchema` / `TokenSummarySchema` 供 `dashboard.stats.tokens` 复用 `usage.summary` 投影。两条 **gateway 侧** `AssertEq`（tsc 即门禁）：`PublicDeviceEntrySchema` ↔ `PublicDeviceEntry`（`Omit<DeviceEntry, 'deviceTokenHash' \| 'apiTokenHash'>`）、`SubagentStatusSchema` ↔ `SubagentStatus`。 | 八 op 全是 `internal`（无 SDK client）→ 断言面是上面两个稳定 wire 类型。**A2A card 是协议文档**（owner = A2A protocol，`@a2a-js/sdk` `AgentCard`）：顶层必填信封钉死（name / description / url / version / provider / capabilities / default*Modes / skills / securitySchemes / securityRequirements / signatures），嵌套 skill / capability / interface 条目保留稳定键 + `additionalProperties: true`；v0.3 card 级 `protocolVersion` 与 v1.0 `supportedInterfaces` optional（只有 Pod card 发）。**`devices.list` 与 `mobile.devicesList` 共用同一 schema**（同一 `listPublicDevices()`）。`health.root` 只描述 transport arm（`http/transport.ts`，唯一接线到主 server 的 arm）。`dashboard.stats` 的 `eventAppendFailures` / `tokens` 在 fail-open 路径缺席 → optional。 |
| E10f-E | **四个工程尾巴收口**：① note-board budget 补 required `perNoteCap`（wire = `{...NOTE_BOARD_BUDGET, used}`；`emptyNoteBoardBudget()` 同步发该键，503 shell 与 200 同形；SDK `StickyNoteBudget` + desktop preload 内联返回类型跟进）；② `memory.get` 的 `HarmonicUnitSchema` 加 gateway 侧编译期桥（`Omit<…,'created_at'>` 双向 `AssertEq` + `created_at: string \| undefined` 单独断言）；③ 删除 `overrides.json` 中 inert 的 `session.list` 条目（11 → 10，`$comment` 更新，`merge-contract` 不再打印 "catalog wins"）；④ mobile triage 改读真实 wire（新 `mobile/lib/src/models/triage_card_model.dart`，`triage_page.dart` 不再读 `reason` / `type` / `origin` / `title` 等 phantom 字段）。 | **`recall.pinned` 有意不加 `perNoteCap`**：它渲染 `<user-profile>` 走 `PINNED_BUDGET`（20 / 2000），`formatPinnedProfile` **没有**按条截断（身份陈述必须完整）；加 required 字段会让 schema 拒绝 handler 自己的体。两个 budget 形状不同是**语义不同**，不是欠账（详见下「残余」）。桥用对称 `Omit`：`Omit<…> & { created_at?: string }` 交集形式不被条件类型恒等检查归一化，会产生假红（实测）。变异验证：`novelty` 改 `Type.String()` → `TS2322 ["MISMATCH", …]`。 |

### 台账口径（E10f）

- **69 → 125/318（39.3%）**，未覆盖 **193** = **187 个非 GET**（162 POST + 16 DELETE + 6 PATCH + 3 PUT）
  + **6 个非 JSON GET**（见下「明确排除」）。也就是说：**56 个 JSON GET 全部覆盖，JSON GET 125/131 = 100%**；
  剩余缺口全部是本节显式排除的面，不再有「同族读接口按 7–8 ops/批推进」的队列。
- by-tag 分区和恒等于 covered（`npm run schema:coverage` 实测；本波主要增量落在
  `internal 15→30/73`、`session 11→19/51`、`pods 13→15/39`、`events 0→5/10`、`lead 2→5/11`、
  `standing 0→2/9`、`automations 0→1/4`、`task 0→3/6`、`runtime 0→3/6`、`project 1→2/3`、
  `manager 0→1/2`、`mafwCommands 0→1/2`、`models 0→1/2`、`embedding 0→1/2`、`media 0→1/6`、
  `tts 0→1/4`、`voice 0→1/1`、`experience 0→1/1`、`terminal 0→1/4`、`cognition 0→1/3`、
  `background 1→2/3`、`plugins 1→2/12`）。仍为 **0** 的 tag 只有 `chat 0/2` 与 `event 0/2`
  （前者是写面 `chat.send` / `chat.sendEnriched`，后者是 `event.publish` POST + `event.subscribe` SSE）。
- **override 12 → 10**：`automations.list`（E10f-C：以 handler 为事实源重写 schema）与 `session.list`
  （E10f-E：catalog 早已提供 schema，override 是 inert 的——`merge-contract` 每次都打印
  `session.list: catalog response schema wins over overrides`）。删除后 `merge-contract` 命中 **10** 且
  不再出现该提示行，即**每条剩余 override 都真正生效**。剩余 10 条是 E10b 之前的历史手写 overlay
  （`session.messages` / `triage.dismiss` / `goals.control` / `event.subscribe` / `tts.speakStream` /
  `media.upload` / `media.uploadAndCreate` / `media.artifact` / `project.setCurrent` / `goals.respondQuestion`）。
- 生成物：`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts` 按批入库，四个 schema 批的 diff
  **各自恰好落在该批目标 op**（0 added / 0 removed；318 ops / 284 paths 不变）；`emit:openapi` + `gen:api`
  二次运行幂等（batches C/D/E 都用 blob hash 比对过）。
- **AssertEq 拆分**：A 18 条（10/16 op）、B 23 条（11/16 op）、C 11 条（10/16 op）落在
  `contract-compat.checks.ts`；D 2 条 + E 3 条是 **gateway 侧** `AssertEq`（internal op 无 SDK DTO，
  放在 schema 模块里由 `npx tsc --noEmit -p tsconfig.json` 守）。schema-only 的 op 都在源文件里写明原因
  （runtime 透传 / internal / 手写收窄 DTO / 协议文档）。
- **SDK DTO 改动只发生在 C 与 E**：C 重写 `AutomationRule` 家族（5 个类型 + `list()` 返回类型）并给
  `LeadBoundaryView` 补 `text`；E 给 `StickyNoteBudget` 补 `perNoteCap`。A / B / D 零 DTO 改动
  （生成物 + 编译期断言即可对齐）。

### 明确排除（不建模，原因入库）

- **6 个非 JSON GET**（不是 JSON 200 体，OpenAPI 的 `application/json` schema 不适用）：
  `media.artifact`（二进制 artifact）、`pods.a2aArtifact`（二进制）、`mobile.ttsArtifact`（音频）、
  `plugins.webAsset`（HTML / 静态资源）、`plugins.webEvents`（SSE）、`event.subscribe`（SSE）。
  它们由各自的 transport 契约（content-type / SSE 帧）约束，不进 JSON schema。
- **全部 POST / PUT / PATCH / DELETE 的请求体与响应**（187 ops）：本波只做读表面，写面 schema
  需要先定「请求校验发生在 transport 还是 handler」的产品口径（当前 handler 各自解析，没有一个统一入口）。
- **错误体不建模**（`memory.get` 404 / `scheduler.status` 404 / `usagePluginSource` 403/404 等只在测试里反向断言）。
  200 成功体之外的语义由 `error` 信封的历史约定承载。

### 残余（E10f 后仍 deferred）

- ~~**187 个写面 op** 的请求 schema~~ → **E10g 收口**：合并 main 后 **189/195** 已声明 + 6 个
  二进制 / multipart / A2A 显式排除（见「台账口径（E10g）」）。
  **写面 op 的 200 response schema 仍 deferred**（194 个非 GET 仍无 response）。
- **强制版本协商 / SDK 全量 schema 类型化**（`minClientVersion` 已在 `experience.actions` 暴露，
  但没有拒绝旧客户端的运行时策略；产品决策未定）。
- **TUI triage phantom**（`reason` / `goalId` / `severity`）：TUI 消费面未改——`@earendil-works/pi-tui`
  在本仓未安装，改了无法跑门禁验证（mobile 侧已在 E10f-E 收口，desktop 侧是 E10b-3）。
- **note-board 与 pinned 预算的差异是有意保留的**（不是欠账）：`memory.listSticky` 的 budget 含
  `perNoteCap: 240`（note-board 按条截断，防单条长记忆饿死整板）；`recall.pinned` 的 budget 只有
  `max` / `maxChars` / `used`（`PINNED_BUDGET = 20 / 2000`，`formatPinnedProfile` 不按条截断——
  身份陈述必须完整）。要对齐必须改披露层行为（把身份文本截到 240 字符），不在契约层解决。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- 6 个非 JSON GET 的 transport 级契约（content-type / SSE 帧格式）仍未声明为 OpenAPI 之外的机器可读产物。

---

## E10g 请求契约（P0 + W1 + W2/W3 + W4 + W5 + W6 + W7 + W8，2026-11-14）

> 承接 E10f（响应 125/318）。E10g 给 **188 个写 op** 补请求契约（main 合入 Phase 6 后分母变
> **195**，E10g-fix 再补 7 个 plugin 自愈面写 op，见「E10g-fix」）；本篇记录 P0 管线、
> 3 个 pilot、W1（session 写接口 35 个）、W2/W3（tasks/terminal/background/fileHistory 8 个 +
> pod 写接口 25 个）、W4（goals/decisions/lead/standing/goalRuns 29 个）、W5
> （events/automations/approvals/questions/triage/permissions 24 个）、W6
> （mcp/plugins/runtime/config/project/manager/commands 26 个）、W7
> （memory/media/tts/chat/python/obs/models/embedding/tools/eval/llm/mobile/devices/a2a 30 个）
> 与 W8（cognition gate/rewrite 2 个，写表面收口 182/188；合并 main 后 **189/195**）。
> spec：`docs/superpowers/specs/2026-11-14-gateway-e10g-request-contracts-design.md`；
> plan：`docs/superpowers/plans/2026-11-14-gateway-e10g-request-contracts.md`；
> 交付记录：`docs/releases/2026-11-14-gateway-e10g-request-contracts.md`。

- **`RouteDef` 新增三个声明位**：`request?: object`（TypeBox / JSON Schema，缺省 = 未建模）、
  `requestContentType?: string`（默认 `application/json`）、`requestRequired?: boolean`
  （默认 `true`；无 body 动作用 `request: Type.Object({})` + `false`，语义是「无字段」而不是「任意 body」）。
- **`toOpenApiPaths()`** 在 `def.request` 存在时投影
  `requestBody: { required, content: { [contentType]: { schema } } }`；**不生成运行时 body 校验**
  （与 response 同策略：声明式契约，handler 是事实源）。
- **台账**：`scripts/schema-coverage.cjs` 解析每个 catalog entry 的 `request:`，输出
  `requests: X/195 write operations`（分母 = 非 GET op；GET 不参与；E10g 时为 188），`--json` 增
  `requests` / `requestCovered` / `requestTotal` / `requestUncovered`。response 口径见下（合并后 127/327）。
  E10h 起同一脚本再切一刀写响应：`write responses: X/195`（`--json` 增 `writeResponses` /
  `writeResponseCovered` / `writeResponseTotal` / `writeResponseUncovered`），分母与请求台账同为 195。
- **P0 pilot（3）**：`session.create`（`directory` 必填绝对路径 + `worktree` / `metadata`）、
  `tasks.submit`（`kind` / `parentSessionID` 必填；shell→`command`、subagent→`prompt` 的条件必填由
  service 校验，schema 用 optional + description 表达）、`pods.tasks.create`（`title` 必填；
  plan 模式 `goalId` 必填，manual 可选 `goalId` / `ownerMemberId`，`actorSessionID` 是鉴权 actor）。
  生成物 diff 恰好这 3 个 op 从 `requestBody?: never` 变为请求体 schema，`gen:api` 幂等。
- **W1（session 写接口，35 个）**：schema 集中在 `routes/schemas/session-write.ts`，字段来自
  handler 读取面（config.set 的 `category` + 多态 `value`；prompt / promptAsync 的 `parts` /
  `delivery` / budget 字段；revertDiff 的 `patches` + `hunkIndices`；restoreCheckpoint 的
  `scope` + `confirm:true`；usage plugin create/source；subagents spawn/message）。
  **20 个 JSON body + 5 个可选 body + 15 个空对象动作**（abort / unrevert / delete /
  deleteLegacy / queue.clear / queue.cancel / subagents.cancel / discoveryRefresh / background /
  usage plugins reload/delete/test），空对象统一 `EmptyRequest` + `requestRequired:false`。
  E10g-fix 把 `session.suspend`（`reason`）/ `resume`（`runId`）/ `discardRun`（`runId`）从空对象
  改成**可选 body**（`routes/session-run.ts` 确实读这两个字段，空 body 仍合法）——
  W1 现为 20 JSON + 8 可选 + 12 空对象。
  `session.command` 无 gateway handler（尾部反代 runtime serve），按 `@opencode-ai/sdk`
  `SessionCommandData.body` 声明（body 可缺省，`command`/`arguments` 必填）。
- **W2/W3（33 个）**：schema 在 `routes/schemas/task-write.ts`（W2：8 个）与
  `routes/schemas/pod-write.ts`（W3：25 个，复用 `schemas/pods.ts` 的 status/probe 子 schema）。
  **18 个 JSON body + 6 个可选 body + 9 个空对象动作**。空对象（`requestRequired:false`）只给
  handler 完全不读 body 的动作：`tasks.cancel` / `terminal.remove` / `background.jobs.cancel`
  （三者的输入只在 path/query）、`pods.create`（按 projectId `ensure`）/ `pods.lead.ensure` /
  `pods.messages.read` / `pods.wake` / `pods.sleep` / `pod.events.seen`（只用路径 id）。
  可选 body（有字段但 `requestRequired:false`）是只用于 actor 鉴权或 query 回退的动作：
  `pods.tasks.delete` / `pods.goals.cancel` / `pods.messages.delivery.retry`（`actorSessionID`）、
  `pods.goals.reviewItems.resolve` / `reopen`（可选 `note`）、`terminal.connectTicket`
  （可选 `directory`，缺省回退 query）。逐 op 分类理由写在两个 schema 文件的头注释里。
  - `pods.a2a` **不在**本批：A2A 协议透传按 spec §1 排除（W7 的 `REQUEST_EXCLUDED`）。
  - `pods.update` 是 status-only PATCH：只有 `status`（active/idle/paused/archived，handler 400 收窄）。
  - `pods.tasks.update` 的 title/acceptance（计划面，Lead）与 status/ownerMemberId（状态面）在
    handler 里互斥（混用 400）；schema 全部 optional，不伪造 oneOf。
  - `pod.events.seenAll` 是 JSON body（`goalId` + `revision` 缺一 400），与 `pod.events.seen`
    的空 body 不同——以 handler 为事实源，没有按「seen 类一律空对象」硬套。
- **W4（goals / decisions / lead / standing / goalRuns，29 个）**：schema 在
  `routes/schemas/goal-write.ts`（11 个 op）、`decision-write.ts`（4）、`lead-write.ts`（7）、
  `standing-write.ts`（6，复用 `schemas/standing.ts` 的 trigger/template/budget 子 schema）。
  **10 个 JSON body + 6 个可选 body + 13 个空对象动作**。
  - 空对象（`requestRequired:false`）只给 handler 不读 body 的动作：`goals.pause` / `resume` /
    `stop`（pause/resume/stop/retry 共用一个 control handler，`runId` 只被 retry 使用）、
    `goals.complete`（kernel `handleComplete` 忽略 `score`）、`lead.boundaries.accept` / `merge` /
    `undo`（human-only 只看凭据）、`lead.topics.resume`（只读路径 id）、`standingGoals.pause` /
    `resume` / `stop` / `run`、`goalRuns.approve`（`actorSessionID` 携带即 403，属禁止字段不声明）。
  - 可选 body 的字段是补充信息/门禁：`goals.retry`（`runId` 缺省 = 最近失败 run）、
    `goals.retryNode`（`confirm` 只在 execute 节点需要）、`goals.validate`（`projectDir` 只是提示）、
    `decisions.confirm` / `reopen`（rationale / consequences / reviewAt / note）、
    `lead.topics.fork`（`goalTitle`）。
  - `goals.planApproval` 是批准/驳回联合体：`approve` + `feedback` 条件必填；`planHash` / `evalHash`
    是内容绑定（不匹配 409 `stale_plan`），`approvalId` 必须等于 pending 记录 id。
  - `goals.respondQuestion` 的 `type` 是闭集（answer/cancel），`answer` 在 answer 分支必填。
  - `goals.control` 与 `goals.controlLegacy`（`POST /control` 兼容别名）共用同一个
    `GoalControlRequest`（PAUSE/ABORT/FORCE_PHASE/RESET_PARAMETRIC）；handler 的历史 fail-open
    （未知/缺失动作仍 200）不当作「任意 body」。
  - `decisions.draft` 的 `kind` 八类闭集、`question`/`shelve.reviewAt` 条件必填由 service 400 事实源
    决定；`projectDir` 一律 optional（handler `projectDirOf` 回退 env/cwd）。
  - `standingGoals.create` 只有 `triggers` 必填（≥1；cron 需 schedule+timezone，event 需 eventKinds）；
    `title` / `objective` / `projectDir` 由 handler/service 兜底；`update` 是 PATCH，全字段 optional。
- **W5（events / automations / approvals / questions / triage / permissions，24 个）**：schema 在
  `routes/schemas/event-write.ts`（7 个 op）、`automation-write.ts`（3）、`human-gate-write.ts`（14）。
  **16 个 JSON body + 1 个协议透传边界 + 7 个空对象动作**。
  - 空对象（`requestRequired:false`）只给 handler 不读 body 的动作：`events.threads.close` /
    `events.subscriptions.delete`（只读路径 id）、`automations.remove`（只读路径 id）、
    `questions.reject`（只 requestID + workspace 回退链）、`triage.confirm` / `reject` / `dismiss`
    （confirm 的三分支由磁盘 item 的 `summary.skillDraft` / `axiomDraft` 决定，handler 不解析 body）。
  - `events.webhook.receive` 是 **协议透传边界**：body 由上游源定义（GitHub / generic webhook），
    gateway 只把 body + rawBody + headers 交给 source adapter 做签名/幂等；因此声明为
    `Type.Object({}, {additionalProperties:true})` + `requestRequired:false` —— 有意的开放对象，
    不是排除项（签名头不是 body 字段）。
  - `event.publish` 的 `type` 必填非空 + `additionalProperties:true`（扁平信封，其余键是插件负载）；
    保留名（gateway/runtime 自有事件）是运行时策略，不写进 schema（清单随事件矩阵演进）。
  - `events.sources.patch` 是 PATCH 但只支持 `enabled:boolean`（其余 body 键被 handler 忽略）。
  - `automations.draft` 的校验通道是**响应**（`draftRule` → `200 {valid:false, errors}`，不落盘），
    所以只有 `id` / `trigger` 必填，cron/event 子字段与 `skill`/`action`（至少一个）留 optional +
    description；`trigger.type` 缺省走 cron 分支，不能做成判别联合。
  - human-only 路由（`approvals.respond`、`questions.reply|reject`、`triage.confirm|reject|dismiss`）
    只声明人类提供的字段，**不声明** `actorSessionID`（携带即 403 的禁止字段）；
    `approvals.respond` 的 `decision` / `answer` 二选一用 description 表达（都缺 → 400）。
  - `permissions.reply` / `replyRuntime` 共用 `{reply, message, persist}`；直连入口额外接受
    legacy `approved:boolean`（`reply` 缺省时 true→once、false→reject）；`persist` 只在
    `reply:'always'` 生效，`'tool'|'prefix'` 决定沉淀规则的作用域。
  - `permissions.setMode` 的 `mode` 闭集含 legacy `'manual'`（`normalizeMode` 收敛为 read-only）；
    allowlist / rules 的删除同样走 **JSON body**（`tool` 必填，`prefix`/`pattern` 可选）。
- **W6（mcp / plugins / runtime / config / project / manager / commands，26 个）**：schema 在
  `routes/schemas/mcp-write.ts`（7 个 op）、`plugin-write.ts`（10）、`runtime-write.ts`（6）、
  `platform-write.ts`（4：config/project/manager/commands）。**16 个 JSON body + 2 个可选 body +
  6 个空对象动作 + 2 个所有权边界 + 1 个排除**。
  - 空对象（`requestRequired:false`）只给 handler 不读 body 的动作：`mcp.connect` / `mcp.disconnect`
    （路径 `:name` + query `directory`）、`plugins.apply` / `plugins.reload`（只读路径 `:name`）、
    `runtime.restartAgent` / `runtime.reload`。
  - 可选 body（有字段 + `requestRequired:false`）：`plugins.invoke`（空 body 合法，
    `{input,sessionID,revision}`；`input` 是插件自定义负载 → 开放对象边界）、
    `runtime.conformance`（`scenarios` / `timeoutMs`，缺省跑全部场景）。
  - 所有权边界（开放对象、body 必填）：`runtime.config.update`（runtime 原生 Config merge 文档，
    gateway 只 `JSON.parse` 转发）与 `runtime.dryEvent`（runtime 原生事件样本；顶层
    `additionalProperties:true` 以允许「直接事件对象」形态，`event`/`plugin` 信封字段声明为可选）。
  - `config.set` 只声明 `GatewayConfig` 的**顶层分区**（全部 optional + `additionalProperties:true`）：
    handler 不校验字段、未知键原样落盘，收窄会比 handler 更严。
  - `project.setCurrent`（`POST /register`）锚定 `projectDir` + `mafwDir` 必填；`setCurrent` 缺省
    false（插件自动注册只登记，不切换当前项目）。
  - **排除**：`plugins.install` —— 读原始 `.js` 字节（`readBodyBuffer`）+ query
    （`filename`/`type`/`overwrite`），没有 JSON body；按 spec §1.3 排除并进收口
    `REQUEST_EXCLUDED`。单文件插件仍可经 `plugins.installPackage`（JSON `{path}`）安装。
  - `mcp.config*` 的 `token` 来自 preview（文件内容哈希）；apply/remove/restore 强制
    `confirm:true`（否则 400）+ `token` 不匹配 409 `etag_mismatch`；`type:'remote'` 的 `url` /
    `type:'local'` 的 `command` 是适配器条件必填，契约只保留 optional + description。
  - `plugins.enable|disable|delete` 共用 `{package}` 或 `{type,filename}` 二选一形态：body 必填，
    字段全 optional 是**变体**而非自由形状（handler `assertBodyShape` 同时给两种 → 400）。
- **W7（memory / media / tts / chat / python / obs / models / embedding / tools / eval / llm /
  mobile / devices / a2a / skills，30 个已覆盖 + 5 个排除）**：schema 在
  `routes/schemas/memory-write.ts`（4 schema / 6 op）、`media-write.ts`（6 schema / 7 op）、
  `misc-write.ts`（14 schema / 17 op）。**23 个 JSON body + 1 个可选 body + 6 个空对象动作 +
  5 个排除**（空对象复用 `schemas/session-write.ts` 的 `EmptyRequest`）。
  - 空对象（`requestRequired:false`）只给 handler 不读 body 的动作：`memory.delete` /
    `devices.delete` / `mobile.devicesDelete`（DELETE 只读路径 `:id`）、
    `memory.embeddingsBackfill`（只读 `?limit=N`）、`media.pluginsReload`（handler `_req`）、
    `humanToken.rotate`（凭据在 `Authorization` 头，body 为空）。
  - 可选 body（有字段 + `requestRequired:false`）：`skills.deopt`（缺失/非法 body 回退默认
    reason `manual`）。
  - **排除（binary / multipart / A2A 透传）**：`media.upload` / `media.uploadAndCreate`
    （`for await (const chunk of req)` 原始字节 + query `type`/`question`）、
    `mobile.mediaTaskUpload`（`multipart/form-data` 文件部）、`media.createTask`（`POST /a2a`
    A2A JSON-RPC 透传，响应 `application/a2a+json`）、`pods.a2a`（raw body →
    `PodA2AAgent.handleJsonRpc`）。JSON 替代面都另有已覆盖路由（`media.createTaskApi` /
    `mobile.mediaTaskAsk`）。
  - `obs.capture` 是 **JSON body 而非原始二进制**：handler 手写 chunked reader（1MB 上限）后
    `JSON.parse`；`sessionID` + `source` 白名单失败 → 400，`content` 为空 → 200 `{deduped:true}`，
    其余异常 fail-open 200 `{ok:false}`（schema 描述里注明，`content` 不设必填）。
  - `models.update` 的 `recall` 是**扁平** `{providerID,modelID}`（响应才包 `recall.workerModel`）；
    `goal` 顶层对 = nodeModel、`goal.techLeadModel` 是 Tech Lead 覆盖（双空串 = 恢复默认，半空对
    → 400）；`media` 为顶层 provider/model + 逐模态覆盖。
  - `embedding.update` 反向收窄：`baseUrl` 被 handler **显式拒绝**（防止 DashScope key 外发），
    因此不写进契约；provider/engine/gpu 闭集与 llama.cpp 数值区间（threads 1..32、
    contextSize 256..32768、batchSize 32..32768）逐项与 handler 校验一致。
  - `tools.execute` 的 `params` 是工具自定义负载 → 开放对象边界（不枚举六件套参数）；
    `chat.sendEnriched.parts` 同理（runtime part：`type` 必填 + 开放字段）。
  - `eval.chatCompletions` 只钉 OpenAI 信封的 `messages`/`role`，content 是文本或 EvalScope
    媒体 part（开放 part 边界），顶层 `additionalProperties:true`。
  - `memory.add` 的 `content` 必填（trim 后为空 → 400）、`memoryType`/`authority` 闭集；
    `cueAnchors`/`sourceTraceIds` 的超限是截断（8 / 20）而非拒绝。
  - `mobile.pairingVerify` 的 `deviceId`/`platform`/`deviceName` 带上
    `device-store.ts` 的 pattern + 长度上限；`devices.register` 的 `id` 可缺省（transport
    注入 `principal.deviceId`），`fcmToken`/`platform`/`token` 恒必填。
- **W8（cognition gate / rewrite，2 个写表面收口）**：schema 在
  `routes/schemas/cognition-write.ts`。两个 op 都是 **JSON body（`requestRequired` 缺省 true）**；
  handler 在 body 缺失时直接 400，没有可省缺的信封。
  - `cognition.gate`：`sessionID` + `kind` 必填，`kind` 是闭集（`tool_call` / `prompt`，其余 400）。
    `tool` **条件必填**（`kind:'tool_call'` 缺失 → 400；`kind:'prompt'` 忽略），因此是
    optional + description，不伪造 oneOf；`input` 缺省 `{}`（规则引擎 `{{field}}` 插值），
    `text` 非字符串时 handler 按空串求值。
  - `cognition.rewrite`：`sessionID` / `tool` / `output` 必填，`output.content` 必为数组
    （否则 400；空数组合法 → 200 `{content: []}`）。内容部件只钉 `type` + `additionalProperties:true`
    （`applyToolResultRedact` 只改 `type:'text'`，其余原样透传）；`output.isError` 是宿主信封字段
    （gateway 不读），`input` 同理（`contract-cognition` 的 requiredFields 列了它，handler 不用）。
  - **收口算术**：W8 时 `requests: 182/188`（96.8%）= 182 covered + 6 excluded
    （W6 `plugins.install` + W7 `media.upload` / `media.uploadAndCreate` / `media.createTask` /
    `mobile.mediaTaskUpload` / `pods.a2a`）。W7 遗留的 2 个 cognition op 至此归位。
    **main 合入 Phase 6 后分母 195**：+7 个 plugin 自愈面写 op（P6，见「E10g-fix」），
    收口 **189/195（96.9%）= 189 covered + 6 excluded**，195 个写 op 全部有归属。

### 台账口径（E10g）

> 「累计」列的 `/188` 是**合并 main 之前**的分母；Phase 6 合并后写 op = 195，
> 最终收口见 P6 行与「E10g-fix」。

| 批次 | 范围 | 新增 request | 累计 |
|---|---|---|---|
| P0 | `RouteDef` 三字段 + `toOpenApiPaths()` requestBody + coverage 脚本 + 3 pilot | 3 | 3/188 |
| W1 | session 写接口（config/switch/prompt/queue/fork/revert/checkpoint/usage plugins/subagents） | 35 | 38/188 |
| W2/W3 | tasks / terminal / background / fileHistory（8）+ pod 写接口（25） | 33 | 71/188 |
| W4 | goals / decisions / lead / standing / goalRuns | 29 | 100/188 |
| W5 | events / automations / approvals / questions / triage / permissions | 24 | 124/188 |
| W6 | mcp / plugins / runtime / config / project / manager / commands | 26 | 150/188 |
| W7 | memory / media / tts / chat / python / obs / models / embedding / tools / eval / llm / mobile / devices / a2a | 30 | 180/188 |
| W8 | cognition gate / rewrite | 2 | **182/188（96.8%）** |
| **P6（merge main 后，E10g-fix）** | plugin 自愈面：doctorAll / doctor / kill / resume / quarantine / unquarantine / rollback | 7（6 空对象 + 1 JSON） | **189/195（96.9%）** |

- **请求 schema 分类**（每个写 op 恰好一类；106 + 59 + 23 + 1 + 6 = 195，其中 189 个声明 `request`、6 个显式排除）：

  | 类别 | 声明 | 数量 | 判据 |
  |---|---|---|---|
  | JSON body | `request` + `requestRequired` 缺省（true） | **106** | handler 读 body 字段；缺失 → 400（含 Phase 6 的 `plugins.quarantine`） |
  | 空对象动作 | `request: EmptyRequest`（`Type.Object({})`）+ `requestRequired:false` | **59** | 输入只在 path / query；语义是「无字段」，不是「任意 body」（12 session / 9 task-pod / 13 goal-lead-standing / 7 human-gate / 6 mcp-plugin-runtime / 6 memory-device-token / 6 Phase 6 plugin recovery） |
  | 可选 body | 有 `properties` + `requestRequired:false` | **23** | body 可缺省：有缺省值（`session.fork` / `session.checkpoint` / `session.command` / `session.summarize` / `session.discoverySkillInvoke` / `goals.retry` / `decisions.confirm` …）、run 乐观锁（`session.suspend.reason` / `session.resume.runId` / `session.discardRun.runId`）或只用于 actor 鉴权 / query 回退（`pods.tasks.delete` / `terminal.connectTicket`） |
  | 协议透传边界 | `Type.Object({}, {additionalProperties:true})` + `requestRequired:false` | **1** | `events.webhook.receive`：body 由上游源定义，adapter 校验签名 / 幂等 |
  | 显式排除 | `REQUEST_EXCLUDED`（不入 catalog `request`） | **6** | 见下表：原始字节 / multipart / A2A 透传 |

- **响应口径**：E10f 终值 125/318；Phase 6 合并后 E10g-fix 补了 `plugins.audit` /
  `plugins.lastGood` 两个 GET 的 200 schema → **127/327（38.8%）**。未覆盖 200 =
  **194 个非 GET 的 response** + **6 个非 JSON GET**（`event.subscribe` SSE、`media.artifact` /
  `pods.a2aArtifact` / `mobile.ttsArtifact` / `plugins.webAsset` / `plugins.webEvents`）。
  口径：**JSON GET 127/133 = 100%**（分母 = 127 covered + 6 非 JSON GET；127 里含
  `humanToken.rotate` 这个返回 JSON 的 POST）。`requests: 189/195` 与 responses 是两个独立分母。
- **收口守卫** `gateway/tests/unit/architecture/request-coverage.test.ts`（本波唯一新增测试文件）：
  ① 每个非 GET op **恰好**满足 `request` 或 `REQUEST_EXCLUDED` 之一（覆盖又排除 / 两者皆无都按 operationId 报错）；
  ② 排除项必须在 catalog 中、理由非空、且**不得**声明 `request`；
  ③ 算术 `189 + 6 = 195`；④ 空对象动作必须 `requestRequired:false`（59 个，开放对象边界 `additionalProperties:true` 不计入）；
  ⑤ GET 不得声明 request。逐批台账（`schema-coverage.test.ts` 的 `E10G_W*_REQUEST_OPS` / `E10G_W*_EMPTY_OPS` /
  `E10G_W*_OPTIONAL_OPS` / `E10G_P6_*`）继续钉住每批 op；`E10G_W1_OPTIONAL_OPS` 钉住 F1 的三个 run body。
- **生成物**：合并 main 后 **327 ops / 293 paths**；`gateway-paths.json` / `openapi.json` /
  `api-schema.gen.ts` 每批 diff 恰好是该批 op 的 `requestBody`（或 F1 的 body 形状）新增
  （0 added / 0 removed 路由），`emit:openapi` + `gen:api` 二次运行幂等。E10g-fix 的 diff = 7 个
  plugin POST 的 requestBody + 2 个 GET 的 response，另有 F1 的 3 个 run body 与 F2 的 3 处上限删除
  （共 6 个 op 被修改）。
- **运行时校验有意缺席**（spec §4 非目标）：`request` 只是声明式契约，gateway **不**在 transport 层校验 body；
  handler 仍是事实源（400 / 截断 / fail-open 的语义在 handler 里，schema 描述只做说明）。因此把 body 改坏不会在
  gateway 层被拒——这是与 response 相同的策略，不是遗漏。

### 明确排除（E10g：6 个，原因入库）

| op | transport | 排除原因 | JSON 替代面 |
|---|---|---|---|
| `plugins.install` | `POST /api/plugins/install` | 原始 `.js` 字节流（`readBodyBuffer`）+ query `filename`/`type`/`overwrite` | `plugins.installPackage`（`{path}`） |
| `media.upload` | `POST /api/media/upload` | 原始媒体字节流（`for await (const chunk of req)`）+ query `type` | `media.createTaskApi` / `media.analyzeAudio` |
| `media.uploadAndCreate` | `POST /api/media/upload-and-create` | 原始字节流 + query `type`/`question` | 同上 |
| `media.createTask` | `POST /a2a` | A2A JSON-RPC 透传（`agent.handleJsonRpc`，响应 `application/a2a+json`），信封归协议 | `media.createTaskApi` |
| `mobile.mediaTaskUpload` | `POST /api/mobile/media/tasks` | `multipart/form-data`（boundary 在 `mobile/media-proxy.ts` 手解） | `mobile.mediaTaskAsk` |
| `pods.a2a` | `POST /a2a/pods/:podId` | A2A JSON-RPC 透传（raw body → `PodA2AAgent.handleJsonRpc`），信封归协议 | `pods.a2aCard`（读）+ pod 写接口 |

- 六项都**不**声明 `request`（声明一个 gateway 从不解析的形状会虚增 `requests`）。
  二进制 / multipart 的 multipart schema 建模、A2A 信封的机器可读产物皆不在本波（spec §4 非目标）。

### E10g-fix（main Phase 6 集成，2026-11-14）

> main 合入 9 个 plugin 自愈面 op（`plugins.audit` / `plugins.lastGood` 两个 GET +
> `doctorAll` / `doctor` / `kill` / `resume` / `quarantine` / `unquarantine` / `rollback` 七个 POST，
> catalog 318 → **327**）。本修正轮把新增面纳入契约，并修掉三处 review blocker（F1 / F2 / F3）。

- **F1 session run body**：`session.suspend` 读 `body.reason`、`session.resume` /
  `session.discardRun` 读 `body.runId`（`routes/session-run.ts`），且都是
  `typeof x === 'string' && x` 守卫 → 空 body 合法。三个 op 从 `EmptyRequest` 改为**可选 body**
  （`SessionSuspendRequest` / `SessionResumeRequest` / `SessionDiscardRunRequest`，
  `requestRequired:false`）。台账：空对象动作 56 → 53（`CLOSED_EMPTY_TOTAL` 53，Phase 6 再加 6 → 59）。
- **F2 截断 ≠ 拒绝**：`memory.add.cueAnchors`（8）/ `sourceTraceIds`（20）、
  `fileHistory.snapshot.reason`（200 字符）、`pods.goals.techLead.messages.parts`（8 条）的上限
  全部由 handler **静默截断**（`dashboard-legacy.ts` 的 `slice(0, 8)` / `primary_abstraction` 截断、
  `normalizeSourceTraceIds`、`file-history.ts` 的 `reason.slice(0, 200)`、
  `normalizeTechLeadParts` 的 `slice(0, MAX_TECH_LEAD_PARTS)`）。schema 里声明 `maxItems` /
  `maxLength` 等于承诺一个不会发生的 400 → 删除硬上限，上限只写在 description。
- **Phase 6 契约**：`routes/schemas/plugin-recovery.ts`（new）
  - `plugins.audit` → `PluginsAuditResponse`：`{events: PluginAuditEvent[]}`，`action` 是
    `PluginAuditAction` 闭集，`detail` 只保留 allowlist 键但值形状随操作（开放对象）；
  - `plugins.lastGood` → `PluginLastGoodResponse`：`{name, lastGood:{version?,fingerprint,savedAt}}`，
    `fingerprint` 是 `LastGoodMeta` 的唯一硬字段；
  - `plugins.quarantine` → JSON body `{reason}`（缺失 / 空串 → 400）；
  - 其余 6 个（`doctorAll` / `doctor` / `kill` / `resume` / `unquarantine` / `rollback`）只读路径
    `:name` 与凭据头部（`principalOf(req)` / `assertHuman(req)` / `_req`）→ 空对象 +
    `requestRequired:false`（human-only 语义在头部，body 不出现 actor 字段）。
- **重编号（合并 main 后）**：responses **127/327（38.8%）**；requests **189/195（96.9%）**
  = 189 covered + 6 excluded；`emit:openapi` = **327 routes / 293 paths / 327 operations**；
  `node scripts/analyze-routes.cjs` = `TOTAL 0 (match 0, equals 0)`。
- **F3**：交付记录里 W6 行的 `api-contract +9 / coverage +4` 实为 **+11 / +5（+16）**，已更正。

---

## E10h 写响应契约（P0 + R1–R6，2026-11-15）

> 承接 E10g（请求 **189/195**）。E10h 给 **195 个写 op**（非 GET）补 200 响应契约：
> 写响应 **0 → 194/195（99.5%）+ 1 排除（`tts.speakStream`）**，total response
> **127 → 320/327（97.9%）**；GET 侧 126/132 已全部覆盖（6 个非 JSON GET 不进 JSON schema）。
> 注：E10g 段落里的「JSON GET 127/133」是混合口径（127 含 `humanToken.rotate` POST、133 含该 POST），
> E10h 起统一用 126/132。
> spec：`docs/superpowers/specs/2026-11-15-gateway-e10h-write-responses-design.md`；
> plan：`docs/superpowers/plans/2026-11-15-gateway-e10h-write-responses.md`；
> 交付记录：`docs/releases/2026-11-15-gateway-e10h-write-responses.md`。

| 批次 | 范围 | 写响应 | total response |
|---|---|---|---|
| P0 | 台账（`write responses: X/195`）+ pilot `session.create` / `tasks.submit` | +2 → 3/195 | 129/327 |
| R1 | session 写接口（usage plugins / subagents / queue / rename / delete …） | +35 → 38/195 | 164/327 |
| R2 | pods（含 `pod.events.*` / tasks / messages / goals / reviewItems / memory / a2a）+ task / terminal / background / fileHistory | +35 → 73/195 | 199/327 |
| R3 | goals / decisions / lead / standing / cognition | +31 → 104/195 | 230/327 |
| R4 | events / automations / approvals / questions / triage / permissions | +24 → 128/195 | 254/327 |
| R5 | mcp / plugins（含 Phase 6 自愈面 8 个）/ runtime / config / project / manager / commands / models | +35 → 163/195 | 289/327 |
| R6 | memory / media / tts / chat / python / obs / tools / eval / llm / mobile / devices / skills | +31 → 194/195 | 320/327 |

- **响应规则（三选一，handler 是事实源）**：
  1. **复用读侧 DTO**：写后读回或同一投影时直接指向既有 schema 对象（`tasks.submit` ≡ `tasks.get`、
     `pods.create` ≡ `PodDetailResponse`、`permissions.setMode` ≡ `permissions.getMode`、
     `models.update` 的 `recall|media|goal` ≡ `models.get`、`embedding.update` 的 `current|runtime`
     ≡ `embedding.get`、`devices.register` 的 `device` ≡ `devices.list` item …）。为此只给内部
     schema 加 `export`，**不改任何既有响应形状**。
  2. **按 handler wire 新写**（`routes/schemas/*-write-responses.ts`，按域拆文件）；常量回执直接用
     `Type.Literal` 声明 handler 的唯一写出值，不放宽到 SDK 的宽类型（`{success:true}` /
     `{status:'paused'}` / `{ok:true}` / `state:'TASK_STATE_WORKING'` / `mime:'audio/wav'`）。
  3. **排除**：200 不是单个 JSON 文档 → `WRITE_RESPONSE_EXCLUDED`（本波唯一项 `tts.speakStream`）。
- **声明式契约为界**：`toOpenApiPaths()` 只投影 `responses.200.content['application/json']`，
  **无运行时响应校验**（与请求面、E10f 同策略）。错误体（4xx/5xx）在 E10h 时不建模，
  **E10i 起统一建模**（`default` + 显式状态码，见「E10i 错误响应契约」）。
- **200 分支必须如实联合**：「未命中 / 失败也是 200」的 handler 事实用判别联合表达，不收敛成
  带 optional 的对象（`session.promptAsync` 三态、`memory.add` / `setSticky` / `merge`、
  `obs.capture`、`triage.confirm` 三分支、`plugins.enable|disable|delete` 的
  `UpdateResult`｜`PluginEntry` 双分支、`automations.*` / `triage.dismiss|reject` 的
  `not_found` 分支）。收敛会合法化 handler 永不发出的键组合。
- **空体 200（`Type.Object({})`）只有 4 个**：`session.revert` / `unrevert` / `summarize` /
  `background`（handler 逐字 `json(200, {})`），成功语义只在状态码上。
- **顶层开放对象 4 个**（body 不由 gateway 拥有）：`pods.a2a` / `media.createTask`（A2A JSON-RPC
  信封，协议边界，**不排除**——仍是 JSON 200）、`session.command`（无 gateway handler，尾部反代
  runtime serve）、`mafwCommands.run`（命令注册表可追加任意键）。`plugins.invoke.output`
  是**字段级**开放边界（owner = 包的 `outputSchema`），网关只承诺 JSON 可序列化 + ≤256KB。
- **非 JSON 请求 ≠ 非 JSON 响应**：`media.upload` / `media.uploadAndCreate` /
  `mobile.mediaTaskUpload`（原始字节 / multipart，E10g 请求排除）与 `plugins.install`
  （原始 `.js` 字节流）在本波补了闭合的 JSON 200。
- **收口守卫**：`tests/unit/architecture/write-response-coverage.test.ts`（7 tests）——每个非 GET op
  恰好「有 `response`」或「在 `WRITE_RESPONSE_EXCLUDED`」其一、排除项具名 + 带原因 + 不声明
  `response`、**195 = 194 + 1**、全量 **320/327** 且 7 个缺口逐个对账（6 个非 JSON GET + 1 排除）、
  写分母不含任何 GET、四条形状清单（空体 4 / 顶层开放 4 / 联合 10 / 其余闭合）钉死，外加
  **mutation test**（抽掉一个 `response` 或一个排除项 → 按 operationId 报错，恢复后归零）。
  GET 读表面仍由 `schema-coverage.test.ts#E10_COVERED_OPS` 独立锁定，本守卫不重复断言 GET。

### E10h-P0（写响应台账 + 2 个 pilot）

- 分母固定 **195 写 op**（E10g 的同一集合）；P0 只补两个响应 schema，写响应 **3/195**
  （存量 `humanToken.rotate` + 本批 2 个），total response 台账 127 → **129/327**。
- `session.create` → `routes/schemas/session.ts#SessionCreateResponse` =
  `Type.Composite([SessionSchema, { worktree?: {dir, branch} }])`：handler
  （`session-create.ts`）下发 `{...result.session, worktree}`，普通创建**没有 `worktree` 键**
  （`JSON.stringify` 丢 `undefined`），故 optional；`dir` 是 worktree 绝对路径、`branch` 是
  `mafw/<slug>`。
- `tasks.submit` → `routes/schemas/tasks.ts#TaskSubmitResponse` = `TaskEntitySchema`
  （`TaskService.submit` 直接返回 `publicTask(task)`，与 `tasks.get` 严格同形，无信封）。
- 生成物 diff 恰好这 2 个 op 从 `content?: never` 变为 200 JSON schema；SDK
  `contract-compat.checks.ts` 新增 `CHECK_tasks_submit`（≡ `GenTask`）与
  `CHECK_session_create_session_half` / `_worktree`（composite 会展平，按两半锁等价）。

### E10h-R1（session 写响应 35 个）

- 覆盖写响应 **38/195**（`humanToken.rotate` + P0 的 2 个 + R1 的 35 个），total response
  台账 129 → **164/327**。catalog 的 35 个 entry 只加 `response:`，请求契约与 handler 不动。
- 新文件 `routes/schemas/session-write-responses.ts`：复用读侧同形 schema（`session.config.set`
  ≡ `SessionConfigResponse`、`session.discoveryRefresh` ≡ `SessionDiscoveryResponse`、
  `session.suspend` / `resume` / `discardRun` 的 `run` 来自 `RunStateSchema`、
  `session.subagents.spawn` ≡ `SubagentRecordSchema`、`session.usagePluginsReload` ≡
  `UsagePluginsListResponse`），其余按 handler wire 字面新写。
- 复用所需的内部 schema 只加了 `export`（`SessionCheckpointSchema`、`SubagentRecordSchema`、
  `RunStateSchema`、`UsagePluginSummarySchema`），未改任何既有响应形状。
- 空体（handler 逐字 `json(200, {})`）：`session.revert` / `unrevert` / `summarize` /
  `background` → `Type.Object({})`；`session.command` 无 gateway handler（尾部反代 runtime
  serve），按协议边界 `additionalProperties:true` 开放。
- `session.promptAsync` 的 200 三态联合：`{status:'ok'}`（直发）、`{status:'ok', queued:true,
  itemId, position}`（队列短路）、`{status:'ok', queued:true, duplicate:true, itemId}`（幂等命中）。
- `session.checkpoint` 回 `SessionCheckpoint` 本体（无列表专属 `actions`，用 `Type.Omit`
  从列表条目骨架去掉）；`session.fork` 只有 `id` 是 gateway 契约保证的（runtime 记录开放）。
- 守卫：`schema-coverage.test.ts` 写响应下界 3 → **38**，新增 R1 逐 op 清单与空体分类断言；
  `api-contract.test.ts` 新增 9 条代表性断言（复用同形、checkpoint 无 actions、promptAsync
  三态、legacy `{status:'ok'}` 等）。生成物 diff 恰好这 35 个 op。

### E10h-R2（pod / task / terminal / fileHistory 写响应 35 个）

- 覆盖写响应 38 → **73/195**，total response 台账 164 → **199/327**（60.9%）。catalog 的
  35 个 entry 只加 `response:`，请求契约与 handler 零改动。
- 新文件 `routes/schemas/pod-write-responses.ts`（25 个 pod op）；task / terminal /
  background / fileHistory 的 10 个写响应就落在各自的读侧 schema 文件里
  （`schemas/{tasks,terminal,background,project-meta}.ts`）。
- 复用读侧 DTO：`pods.create` / `update` / `wake` / `sleep` ≡ `PodDetailResponse`
  （四个 handler 都过 `enrichPodDetail()`，非 lead 只把 `sessions` 清空）；`pods.tasks.create`
  / `update` 的 `task` ≡ `PodTaskSchema`；`pods.messages.create` / `read` 的 `message` ≡
  `PodMessageSchema`；review-items create/resolve/reopen ≡ `PodReviewItemSchema`；
  `pods.goals.probes.create` ≡ `PodProbesResponse`；`tasks.cancel` ≡ `TaskEntitySchema`；
  `background.jobs.cancel` ≡ list item（`BackgroundJobSchema`）。
- 按 handler wire 新写：`PodLeadEnsureResponse`（**小写 `sessionId`**，与 goals 面的
  `sessionID` 不同）、`pods.tasks.delete` 的 `{deleted:{goalId,externalTaskId}}`、
  `pods.goals.create` / `handoff` 的两分支（Tech Lead 讨论 vs legacy intake，只有
  `goalId/status/queueReason/goal` 四键恒在）、`pods.goals.accept`（`PodGoalAcceptResult`）、
  `pods.goals.reject`（`PodRejectResult`，含 `previous` 收尾结果）、`pods.goals.direction`
  （`PodDirectionResult` + `planningStarted` / `planningError`）、`pods.goals.techLead.messages`
  （`PodTechLeadPrompt`）、`pods.memory.write` 的 `{path}`。
- 三处「schema 比 SDK 类型更贴 handler」（故意，不绑 AssertEq）：`pods.goals.cancel` 的
  `goal` 是 `PodGoalRow` 行而不是 `PodGoal` 视图（无 `title/phase/stage/resultReady`）；
  `pods.messages.delivery.retry` 原样透传 `deliver()` 的 `skipped`（create 分支把它映射成
  `disabled`）；`terminal.remove` 的 `ok` 是字面量 `true`。
- `pods.a2a` 是 A2A JSON-RPC 信封：**不排除**，按协议边界声明 `additionalProperties:true`
  + owner 注释（仍是 JSON 200 schema）。本批无空体 200。
- 守卫：`schema-coverage.test.ts` 写响应下界 38 → **73**，新增 R2 逐 op 清单 + 「无空壳 /
  a2a 是唯一开放边界」断言；`api-contract.test.ts` 新增 13 条代表性断言；
  SDK `contract-compat.checks.ts` +23 条编译期等价。生成物 diff 恰好这 35 个 op（重跑幂等）。

### E10h-R3（goal / decision / lead / standing / cognition 写响应 31 个）

- 覆盖写响应 73 → **104/195**，total response 台账 199 → **230/327**（70.3%）。catalog 的
  31 个 entry 只加 `response:`，请求契约与 handler 零改动。
- 五个新文件按域拆（每个都只有十几到几十行）：`routes/schemas/goal-write-responses.ts`（11）、
  `decision-write-responses.ts`（4）、`lead-write-responses.ts`（7）、
  `standing-write-responses.ts`（7）、`cognition-write-responses.ts`（2）。
  `schemas/read-models.ts` 的 `DecisionRecordSchema` 加 `export`（无 wire 变化），
  decision 四个写响应直接复用列表 item，不写第二份转写。
- 复用读侧 DTO：`standingGoals.create` / `update` / `pause` / `resume` / `stop` ≡
  `{goal: StandingGoalSchema}`（list item），`standingGoals.run` / `goalRuns.approve` ≡
  `{run: GoalRunSchema}`（runs item）。
- **常量回执**按 handler 的终值声明（`Type.Literal`），不放宽到 SDK 的宽类型：
  `goals.planApproval` `{success:true}`、`goals.pause|resume|stop|retry`
  `{status:paused|resumed|stopped|retried}`、`goals.control` / `goals.controlLegacy`
  `{status:'ok'}`（同 handler 同一 schema 对象）、`goals.complete`
  `{success:true,nextAction:'SCHEDULED'}`、`goals.validate`
  `{success:true,goalId,nextAction:'GRAPH_INVOKED'}`、`goals.retryNode`
  `{success:true,runId}`、`goals.respondQuestion` `{status:'accepted',action?:'cancelled'}`。
- 领域对象：`decisions.{draft,confirm,shelve,reopen}` ≡ `{record: DecisionRecord}`；
  `lead.boundaries.accept` `{status:'accepted',toTopicId}`（只有 accept 拆分出新 topic）、
  `merge` `{status:'merged'}`、`undo` `{status:'undone'}`；`lead.boundaries.observe`
  `{proposed, proposal?:{trigger,confidence,reason}|null, error?}`（advisory，永不失败）；
  `lead.compact` ≡ `LeadCompactResult`；`lead.topics.resume` `{sessionID,resumedFrom|null}`；
  `lead.topics.fork` `{goalId,sessionID?:string|null}`。
- `cognition.gate` 是判别联合（`decision` ∈ allow/deny/ask/rewrite/transform；deny/ask 的
  `reason`/`rule` 可选，rewrite 带 `input`，transform 带 `text`）；`cognition.rewrite`
  `{content: Part[]}`，部件只承诺 `type` + runtime 其余字段（`additionalProperties:true`）。
- 本批无排除、无空体 200、无顶层开放对象。
- 守卫：`schema-coverage.test.ts` 写响应下界 73 → **104**，新增 R3 逐 op 清单（31）+
  「无空壳 / 无顶层开放对象」+「同 handler 共 schema / 复用读侧 DTO」断言；
  `api-contract.test.ts` 新增 11 条代表性断言；SDK `contract-compat.checks.ts` +14 条
  编译期等价（decision ×4、lead compact/resume/fork、standing goal ×5、run ×2）。
  生成物 diff 恰好这 31 个 op（重跑幂等）。

### E10h-R4（event / automation / approvals / questions / triage / permissions 写响应 24 个）

- 覆盖写响应 104 → **128/195**，total response 台账 230 → **254/327**（77.7%）。catalog 的
  24 个 entry 只加 `response:`，请求契约与 handler 零改动。
- 五个新文件按域拆：`routes/schemas/event-write-responses.ts`（7）、
  `automation-write-responses.ts`（3）、`approval-write-responses.ts`（3：approvals +
  questions）、`triage-write-responses.ts`（4）、`permission-write-responses.ts`（7）。
  `schemas/events.ts` 的 `EventSourceViewSchema` / `EventSubscriptionRowSchema` 与
  `schemas/human-gate.ts` 的 `AllowlistEntrySchema` / `PermissionRuleSchema` 加 `export`
  （无 wire 变化），写响应复用而不是二次转写。
- 复用读侧 DTO / 共享信封：`events.sources.create` ≡ `events.sources.list` item（同一个
  `sourceView()`）；`events.threads.subscriptions.create` ≡ 订阅列表 item（store 行本体，
  含 `threadId`/`expiresAt`/`droppedAt`）；`permissions.setMode` ≡ `permissions.getMode`
  （`PermissionModeResponse`，写入路径 `autoApprovals` 恒 0）。`{ok:true}` 复用 R1 的
  `OkResponse`（`event.publish` / `events.sources.patch` / `events.subscriptions.delete`），
  `{status:'ok'}` 复用 `StatusOkResponse`（`questions.reply|reject`、`permissions.reply`）。
- 本批的 200 大量是「未命中也是 200」，status 必须是联合而不是字面量：
  `automations.toggle` `{status:'toggled'|'not_found', enabled}`、`automations.remove`
  `{status:'deleted'|'not_found'}`、`triage.dismiss` / `triage.reject`
  `{status:'dismissed'|'rejected'|'not_found'}`。同理 `automations.draft`
  `{id,valid,errors}` 覆盖 `valid:false`（规则未落盘），`triage.propose`
  `{success:boolean,message}` 覆盖 `success:false`（条目不存在/已处理）。
- `triage.confirm` 是三条成功分支的判别联合：skill 物化 `{status:'confirmed',installed}`
  （`installSkillDraft` 返回 skill 名）、公理草稿 `{…,axioms}`（commit 成功条数）、
  默认 `{…,goalId}`——不把三键设成 optional，避免合法化 handler 不会发的组合。
- `approvals.respond` `{status:'ok', decision:'approve'|'reject'|'answered'}`：`decision`
  是归一化回显（文本回答 → `answered`）。`events.threads.close`
  `{closed:boolean,handedBack,dropped}`：唯一实现恒 `closed:true`，但路由端口类型与
  SDK `events.closeThread` 都声明 boolean，按端口/DTO 走。
- `permissions.reply` 与 `permissions.replyRuntime` **刻意不同形**（`{status:'ok'}` vs
  `{success:true}`）：两个 handler 事实不同，合并会掩盖差异。
- `events.webhook.receive`：**请求体**才是源定义边界（E10g 的
  `EventWebhookReceiveRequest`，`additionalProperties:true`）；200 是网关自己的回执
  `{accepted:true,duplicate:boolean}`，故按 handler 声明为闭合对象，不开放。
- 本批无排除、无空体 200、无顶层开放对象。
- 守卫：`schema-coverage.test.ts` 写响应下界 104 → **128**，新增 R4 逐 op 清单（24）+
  「无空壳 / 无顶层开放对象」+「复用读侧 DTO / 两个 reply 不同形 / 共享 `{ok:true}`」
  断言；`api-contract.test.ts` 新增 8 条代表性断言；SDK `contract-compat.checks.ts`
  +9 条编译期等价。生成物 diff 恰好这 24 个 op（重跑幂等）。

### E10h-R5（mcp / plugins / runtime / config / project / manager / commands / models 写响应 35 个）

- 覆盖写响应 128 → **163/195**，total response 台账 254 → **289/327**（88.4%）。catalog 的
  35 个 entry 只加 `response:`，请求契约与 handler 零改动。
- 四个新文件按域拆：`routes/schemas/mcp-write-responses.ts`（7）、
  `plugin-write-responses.ts`（17：含 Phase 6 自愈面 8 个）、`runtime-write-responses.ts`（6）、
  `platform-write-responses.ts`（5：config / project / manager / commands / models）。
  `schemas/meta.ts` 的 `PluginsEntrySchema`、`schemas/runtime-surface.ts` 的
  `RuntimeCapabilitiesSchema` / `RuntimePluginStateSchema`、`schemas/media-voice.ts` 的
  `ModelRefSchema` / `MediaConfigSchema` / `GoalModelConfigSchema` 加 `export`（无 wire 变化），
  写响应复用而不是二次转写。
- 复用读侧 DTO / 共享信封：`plugins.install` ≡ `plugins.list` item（同一个 `statEntry()`
  投影）；`runtime.reload` 的 `plugins` item ≡ `runtime.get`（同一 loader 状态）；
  `models.update` 的 `recall` / `media` / `goal` ≡ `models.get`（写后读回，同一批 schema）；
  `mcp.connect` / `mcp.disconnect` 复用 R1 的 `{ok:true}` 信封。
- mcp 面全部是 **runtime 适配器的已类型化 DTO**（owner = `@mafw/runtime-contract`
  `RuntimeMcpConfigChannel`），gateway 只透传：`mcp.configPreview` /
  `configPreviewRemove` ≡ `RuntimeMcpConfigPreview`（`token`/`target`/`diff` +
  `backup?`/`preserved?`/`warnings?`），`mcp.configApply` / `configRestore` /
  `configRemove` ≡ `RuntimeMcpConfigResult`（`applied` 与 `runtimeApplied` 是两个独立
  布尔：写盘成功但热载失败是合法组合）。
- plugin 面有三处**判别式双分支**（handler `assertBodyShape` 收窄 `{package}` vs
  `{type,filename}`）：`plugins.enable|disable` → `UpdateResult` ｜ `PluginEntry`，
  `plugins.delete` → `UpdateResult` ｜ `{ok:true}`。两个分支公共键只有 `name`，
  所以必须是联合，收敛成一份会合法化 handler 永不发出的字段组合。
- `plugins.apply` 在 `UpdateResult` 之上补运行时切换三态：
  `runtimeSwitch:'required'|'applied'|'failed'`（无 switch 接线 / 成功 / 失败），
  成功带 `active:{name,capabilities}`，失败带 `runtimeError`。
- `plugins.invoke` 的 200 是网关信封 `{package,action,revision,output?}`；`output`
  是**插件定义**边界（owner = 包的 `outputSchema`，gateway 只要求 JSON 可序列化 + ≤256KB），
  因此声明为「开放对象 + 其余 JSON 形态」的联合，不枚举业务字段。
- `plugins.doctor` / `doctorAll` 复用同一份 `PluginDoctorReport`
  （`ok` 只看 `fail`；`{ok:false}` 检查报告仍可能是 200）；`plugins.check` 的
  `{ok:false}` 也是诊断结果（200）。`plugins.kill` / `resume` 的 `safeMode`
  是字面量 `true`/`false`，`quarantine` / `unquarantine` 的 `quarantined` 同理。
- `runtime.dryEvent` 一个 schema 覆盖三条成功分支：映射丢弃（`type:null` +
  `facets:null`）、工具三原语（`facets:null` + `assembled` 是 runtime 事件数组）、
  普通事件（`facets` 对象 + 可选 `flow`）。`assembled` 归 `RawRuntimeEvent` 所有，
  按开放对象数组建模。
- `runtime.config.update` 回 `{status:'ok',config}`：`config` 是 merge 后的整份 runtime
  Config（owner = runtime，可为 `null`），与 `runtime.config.get` 同口径。
- `mafwCommands.run` 的 200 就是命令 handler 的 `MafwCommandResult`（`ok` + 常见三键），
  自定义命令可追加任意键 → **本批唯一开放顶层对象**（owner = 命令注册表）。
- `project.setCurrent`（`POST /register`）回 `{status:'ok',registered}`（目录回显，
  不是 `Project` DTO）；`manager.rotate` 回 `{success:true,...ManagerRotateResult}`
  （`created:'initial'|'rotated'`）；`config.set` 回 `{success:true,restartRequired[]}`。
- 本批**排除 0、空体 200 为 0**；与 E10g 请求台账的两处具名例外：`plugins.install`
  （请求是原始 `.js` 字节流被排除，响应仍是 JSON）与既有的 `pods.a2a`。
- 守卫：`schema-coverage.test.ts` 写响应下界 128 → **163**，新增 R5 逐 op 清单（35）+
  「只有命令结果是开放顶层对象」+「复用读侧 DTO（同 DTO 指向同一 schema 对象）」+
  「action output 是开放边界」+「handler 字面量」断言；`api-contract.test.ts` 新增 13 条
  代表性断言；SDK `contract-compat.checks.ts` +22 条编译期等价。生成物 diff 恰好这 35 个 op
  （重跑幂等）。

### E10h-R6（memory / media / tts / chat / python / obs / tools / eval / llm / mobile / devices / skills 写响应 31 个）

- 覆盖写响应 163 → **194/195**，total response 台账 289 → **320/327**（97.9%）。catalog 的
  31 个 entry 只加 `response:`，请求契约与 handler 零改动。
- 六个新文件按域拆：`routes/schemas/memory-write-responses.ts`（6：memory + embedding）、
  `media-write-responses.ts`（7：含 `/a2a`）、`tts-write-responses.ts`（2）、
  `internal-write-responses.ts`（8：chat / python / obs / tools / eval / llm）、
  `devices-write-responses.ts`（7：devices + mobile）、`skills-write-responses.ts`（1）。
  `schemas/media-voice.ts` 的 `EmbeddingConfigStateSchema` / `EmbeddingRuntimeStateSchema`
  加 `export`（无 wire 变化）：`embedding.update` 的 `current` / `runtime` 就是写后读回的
  同一投影。
- **唯一排除：`tts.speakStream`** —— 200 是 `text/event-stream` 的 PCM16 分块流
  （`data: {data,voice}` … + `{"done":true}`），不是单个 JSON 文档；请求仍是已覆盖的 JSON
  body。收口 `WRITE_RESPONSE_EXCLUDED` 以它为唯一来源项。
- 复用读侧 DTO / 兄弟 op：`media.pluginsReload` 的 `plugins` ≡ `media.plugins` 列表段
  （同一 `getState()` 五键投影）；`devices.register` / `mobile.devicesRegister` 共一份回执，
  `device` ≡ `devices.list` item（`PublicDeviceEntrySchema`，两个 hash 永不出现）；
  `devices.delete` / `mobile.devicesDelete` 共用 `{ok:true}`；`chat.send` /
  `sendEnriched` 严格同形（`{sessionID}`）；`embedding.update` 的 `current`/`runtime` ≡
  `embedding.get`。
- **「未命中 / 失败也是 200」的分支必须进 schema**：`memory.add`（`{success:false,
  error, code?:'disk_low'}` 与 exact-hash dedup 回执）、`memory.setSticky`（便签 / pin /
  失败三支）、`memory.merge`（MCP handler 的 `{success:false,error}` 也走 200）、
  `obs.capture`（fail-open `{ok:false,error}`）都是 2 支或 3 支联合，不收敛成一份带
  optional 的对象（否则「两个模式都给」的 body 会被合法化）。
- 常量回执按 handler 的唯一写出值：`memory.delete` `{status:'deleted'}`、
  `media.uploadAndCreate.state:'TASK_STATE_WORKING'`（后台分析，先回 working）、
  `tts.speak.mime:'audio/wav'`、`python.restart` / `tts.interrupt` / 设备删除的 `ok:true`、
  `eval.chatCompletions.object:'chat.completion'` + `finish_reason:'stop'`。
- 三个 op 的**请求**是原始字节 / multipart（E10g 已排除），**响应**仍是 JSON，故本波补
  200：`media.upload`（`{artifactId,mediaType,size,url}`）、`media.uploadAndCreate`、
  `mobile.mediaTaskUpload`（`{id,contextId,state,artifactId}`）。
- `media.createTask`（`POST /a2a`）与 `pods.a2a` 同口径：**不排除**，按 A2A 协议边界声明
  `additionalProperties:true` + owner 注释（仍是 JSON 200 schema）。
- `media.analyzeAudio` 的 `result` 是 media-service 的叙述文本（`analyze()` /
  `analyzeAudioNarrative()` 的真实返回 `Promise<string>`；路由 deps 为了可单测写宽成
  `unknown`，契约按真实 service 声明）。
- `obs.capture` 的 `id` 是 `number|null`（三种「不落盘」路径都为 null）、`deduped` = `id
  === null`，`internal` / `filtered` 是两个递归守卫各自的字面量 true 标记。
- `python.execute` 回 `PythonExecuteResult` 本体（`status:'ok'|'error'|'aborted'`，
  `error` 只在 Python 异常时出现，`truncated` 时 handler 已把说明追加到 `stdout`）。
- `llm.compress` 的 `facts` / `concepts` 是模型定义的元素（gateway 只保证数组 →
  `Type.Array(Type.Unknown())`），`narrative` / `energy` 由 `parseLLMResponse` 兜底。
- 本批**排除 1（`tts.speakStream`）、空体 200 为 0、顶层开放对象 1（`media.createTask`
  的 A2A 信封，与 `pods.a2a` 同形）**。
- 守卫：`schema-coverage.test.ts` 写响应下界 163 → **194**，`E10_COVERED_OPS` +31
  （289 → 320），新增 R6 逐 op 清单（31）+「只有 A2A 信封是开放顶层对象」+
  「复用读侧 DTO / 两个模式回执」+「排除项有原因且不声明 response」断言；
  「写响应必有请求」「写响应 ⊆ 请求台账」两处具名例外扩到 6 个
  （`pods.a2a` / `media.createTask` / `plugins.install` / `media.upload` /
  `media.uploadAndCreate` / `mobile.mediaTaskUpload`）。`api-contract.test.ts` 新增 12 条
  代表性断言 + 台账 194；SDK `contract-compat.checks.ts` +11 条编译期等价
  （chat ×2、tts speak ×2、media upload/uploadAndCreate ×3、pluginsReload、
  embedding.update ×2）。生成物 diff 恰好这 31 个 op（重跑幂等）。

### E10h-close（收口守卫 + 门禁，2026-11-15）

- **写入收口**：写响应 **194/195（99.5%）**、total response **320/327（97.9%）**；catalog 仍
  **327 ops / 293 paths**，请求台账仍 **189/195**，handler / 路由 / wire 字节零变化。
- **新守卫 `tests/unit/architecture/write-response-coverage.test.ts`（7 tests / 1 suite）**：
  1. 每个非 GET op 恰好「声明 `response`」或「在 `WRITE_RESPONSE_EXCLUDED`」其一（按 operationId 点名）；
  2. 排除项是写 op + 带原因 + 不声明 `response`，键集恰为 `['tts.speakStream']`；
  3. **195 = 194 + 1**（去重 + 无未记账 op）；
  4. **327 = 320 + 7**，7 个缺口逐个对账（6 个具名非 JSON GET + 1 个写排除）；
  5. 写分母不含任何 GET、GET 不进排除表（**GET 读表面不在本守卫重复断言**，仍在
     `schema-coverage.test.ts#E10_COVERED_OPS`）；
  6. 200 形状清单：空体 **4** / 顶层开放 **4** / 联合 **10**，其余闭合；
  7. **mutation test**：抽掉一个 `response`、或临时删掉唯一排除项 → 审计按 operationId 报错，
     恢复后归零（审计是纯函数 `auditWriteResponses()`，源文件不动）。
- **门禁（worktree @ `86a4ba5a` + 本收口）**：gateway `tsc -p tsconfig.json` **0**；全量 jest
  `--runInBand --forceExit --no-coverage` **7624 tests（7612 passed / 9 failed / 3 skipped）**，
  3 个失败 suite 全是已知 env-red（`plugin-package-e2e` + `claude-adapter-acceptance` +
  `claude-adapter-coverage`，9 条），零契约红；
  `schema:coverage` **responses 320/327 + write responses 194/195 + requests 189/195**；
  `analyze-routes.cjs` **TOTAL 0**；`emit:openapi` **327 routes / 293 paths / 327 operations** 无 diff；
  SDK `tsc` **0** + 全量 **226** + `contract.test.ts` **4/4** + `gen:api` 幂等；
  desktop 全量（仅 resolver 1 条 env-red）+ `tsgo -p`（`node:tls` 2 条）；
  mobile 定向 **31** + `flutter analyze` **0**；TUI env-red（`pi-tui` 未安装）；
  `kernel-split-guards` **7/7**（定向四套 297 passed：api-contract 231 + coverage 52 + 本守卫 7 + 7）。
  明细见 `docs/releases/2026-11-15-gateway-e10h-write-responses.md`。
- **残余**：见「残余（E11 后仍 deferred）」——写响应只剩 `tts.speakStream`；错误体由 **E10i** 收口
  （统一 `default` + 高价值显式状态码）；**版本协商的客户端侧与 TUI triage phantom 由 E10j 收口**，
  mobile 工作 tab 的任务 / 消息级 patch 在 E10j 定为 won't do。

---

## E10i 错误响应契约（P0 + E1 + E2 + E3，2026-11-15）

> 承接 E10h（写响应 **194/195**、total **320/327**）。E10i 补**非 2xx 错误体**：此前 327 op 只建模 200，
> 客户端无法从 OpenAPI 得知错误形状。收口账：**`default` 327/327**、**`/api/*` 的 401/403 各 318 个 op**、
> **显式状态码 157 op / 356 条状态条目**（400×124 / 404×78 / 409×54 / 413×6 / 429×3 / 503×91）。
> spec：`docs/superpowers/specs/2026-11-15-gateway-e10i-error-contracts-design.md`；
> plan：`docs/superpowers/plans/2026-11-15-gateway-e10i-error-contracts.md`；
> 交付记录：`docs/releases/2026-11-15-gateway-e10i-error-contracts.md`。

| 批次 | 范围 | 显式 op | 状态条目 |
|---|---|---|---|
| P0 | `ErrorEnvelope` + `RouteDef.errors/errorSchemas/errorDescription` + `toOpenApiPaths()` 投影（全局 `default` + `/api` 401/403） | 0 | 0 |
| E1 | session（create/fork/checkpoint/prompt/queue/config/delete/rename/subagents）+ pods（create/tasks/messages/goals/reviewItems/accept） | 43 | 98（400×24 / 404×27 / 409×16 / 429×1 / 503×30） |
| E2 | goals / decisions / lead / standing + events / automations / approvals / questions / triage / permissions | 51 | 127（400×50 / 404×32 / 409×20 / 503×25） |
| E3 | plugins / runtime / config / mcp + memory / media / tts / mobile / devices / skills + chat / python / obs / tools / eval / llm | 63 | 131（400×50 / 404×19 / 409×18 / 413×6 / 429×2 / 503×36） |

- **统一信封**（`routes/schemas/errors.ts#ErrorEnvelope`）：
  `{ error: string, code?: string, message?: string, success?: false }`，`additionalProperties: true`。
  `error` 必填（既有客户端按字符串消费），`code` 是 additive 机器可读字段，与 `core/http/api-error.ts`
  的 `API_ERROR_CODES` 同源。**只声明不校验**：handler 仍是错误形状的事实源，无运行时校验。
- **三层投影**（`registry.ts#errorResponsesFor()`，由 `toOpenApiPaths()` 逐 op 写入 `responses`）：
  1. **所有 op** 恒有 `default`（`ErrorEnvelope`）——未列出的 4xx/5xx 兜底；
  2. **`/api/*` 的 op** 自动获得 **401 / 403**（transport 鉴权层，与 tag / 权限语义无关）；
  3. catalog 的 `errors: [status…]` 逐项追加，`errorSchemas[status]` 覆盖该状态形状、
     `errorDescription[status]` 覆盖描述；显式状态排在 401/403 之后，故可自定义同名状态。
- **显式状态码按域取「handler 真有的分支」**，不是按状态码调色板穷举：session 400/404/409/429/503、
  pods 400/404/409/503、goals/decisions/lead/standing 400/404/409/503、plugins/runtime/config/mcp
  400/404/409/413/429/503、memory/media/tts/mobile/devices 400/404/409/413/429/503、
  events/automations/approvals/questions/triage/permissions 400/404/409/503。
  403 只由 transport 全局（所有 `/api/*`）与 human-only 业务面覆盖，**不逐个显式声明**（显式 403 条目为 0）。
- **特殊形状只有一类是具名豁免**：`goals.respondQuestion` 的 404/409 用
  `QuestionLedgerErrorSchema`（`{status:'not_found'|'conflict', currentState?}`，**没有 `error` 字段**）——
  handler（`routes/goals-inline.ts`）直接写 question ledger 状态体，套 `ErrorEnvelope` 会宣称一个
  不存在的 `error`。其余非信封形状仍兼容信封：429 用 `QuotaExceededErrorSchema`
  （`{error, code:'quota_exceeded', resource, limit, current}`，`session.create` / `project.setCurrent` /
  `python.execute` 三处），`error` 仍在必填集里。
- **非 `/api` 路径不带 401/403**（P0 守卫反向约束）：9 个 op —— `health.root`（`/health`）、
  `a2a.agentCard`（`/.well-known/agent-card.json`）、`project.setCurrent`（`/register`）、
  `media.createTask` / `media.artifact` / `pods.a2a` / `pods.a2aCard` / `pods.a2aArtifact`（`/a2a/*`）、
  `goals.controlLegacy`（`/control`）。这些入口没有 transport 鉴权层（loopback / A2A / CLI 专用），
  声明 401/403 会广告一扇不存在的门；它们的业务错误（如 `/a2a` 的 loopback 403）落 `default`。
- **500 / 502 / 405 等仍留在 `default`**（有意）：`mcp.connect|disconnect` 502、`tts.*` / `media.*` 502、
  `plugins.invoke` 408/502、`media.upload|uploadAndCreate` 415、各 handler 的 500 catch-all 都是
  **实现故障面**而非可承诺的契约分支——逐个建模只会把「网关崩了」写成 API；`default` 已保证
  「任何未列出状态至少带 `error: string`」。同理 `405` 属路由层，不进 op 契约。
- **收口守卫**：`tests/unit/architecture/error-coverage.test.ts`（**8 tests / 1 suite**）——
  ① 327/327 `default` 信封（含 `required:['error']` / 开放体）；② 全量 `toOpenApiPaths()` 投影与
  `errorResponsesFor()` 逐 op 一致（327 唯一 method+path）；③ `/api` op **318** 全部有 401+403、
  非 `/api` op 一个都没有；④ 9 个非 `/api` op 的 id+method+path 钉死；⑤ `errors` 中每个状态都投影为
  `errorSchemas[status] ?? ErrorEnvelope`（无「有状态无 schema」，也无「有 `errorSchemas` 却不在
  `errors`」的死配置）；⑥ 账目 **157 op / 356 条目** +
  逐状态分布钉死；⑦ 非信封形状 = 三处 quota 429 + `respondQuestion` 豁免（豁免双向：列出的状态必须
  用该 schema、无 `error` 的体必须有豁免 + 原因）；⑧ **mutation test**（抽掉一个 `default`、抽掉一个 401、
  给 `health.root` 加 401 → 各按 operationId 报错；恢复后归零，审计是纯函数）。
- **台账**：`npm run schema:coverage` 新增 `errors: default 327/327 operations …; explicit ops 157
  (356 status entries: 400x124 / 404x78 / 409x54 / 413x6 / 429x3 / 503x91)`。
- **客户端可见**：`openapi.json` / `gateway-paths.json` / `api-schema.gen.ts` 每个 op 多了 `default`
  （+ `/api` op 的 401/403 + 显式状态码）；wire 字节、handler、路由集合、SDK 手写类型零变化。
- **门禁**：见交付记录（gateway tsc **0**；全量 jest **7669 tests / 7657 passed / 9 条已知 env-red / 3 skipped**，
  零契约红；`schema:coverage` responses 320/327 + write responses 194/195 + requests 189/195 +
  errors default 327/327 / explicit 157；`analyze-routes` **TOTAL 0**；`emit:openapi` + `gen:api` 幂等无 diff；
  SDK 226 + contract 4/4 + tsc 0；desktop 3868 tests 仅 resolver env-red + `tsgo` 2 条 `node:tls`；
  mobile 31 + analyze 0；TUI env-red；定向 381 passed / 13 suites，kernel-split 7/7）。

---

## E10j 交互与版本协商补齐（2026-11-16）

> 承接 E10i：E10 的三层契约（请求 / 200 / 错误体）闭合后，还剩两处**可执行**缺口——
> TUI triage 仍在渲染已退役的 phantom 字段；transport 的 `X-MAFW-Schema-Epoch` 只有服务端一半
> （客户端从不发送 → gateway 升级后静默按旧契约说话）。本波各补一半，其余三项明确 won't do。
> spec：`docs/superpowers/specs/2026-11-16-gateway-e10j-interaction-version-design.md`；
> plan：`docs/superpowers/plans/2026-11-16-gateway-e10j-interaction-version.md`；
> 交付记录：`docs/releases/2026-11-16-gateway-e10j-interaction-version.md`。

| 批次 | 范围 | 边界 |
|---|---|---|
| J1 | **TUI triage 对齐真实 wire**：新增纯函数 `packages/tui/src/ui/triage-view-model.ts#triageView(t)`（与桌面 `triage-model.ts` 同构，title / meta / badge 一套规则），`ui/triage-tab.ts` 的行渲染与 Enter 详情都改用它 | 纯 UI 渲染；无 wire / SDK 类型改动，布局、行映射、键位（`a/r/c/d/Enter`）不变 |
| J2 | **自动 schema epoch 协商**：SDK `MafwClientOptions.schemaEpoch?: number \| 'auto'`；desktop `createGatewayClient` 与 TUI `createTuiClient` opt-in `'auto'` | gateway 侧零改动（仍是 opt-in 校验，不引入强制拒绝）；`fetchPath` 不参与 |
| J3 | 收口：本节 + `desktop.md` / `tui.md` / `mobile.md` 现状 + release 记录 + 全量门禁 | docs-only |

- **transport epoch 契约现由客户端自动协商（opt-in）**：gateway 行为**未变**——响应恒带
  `X-MAFW-Schema-Epoch`（metadata 未加载时省略）；客户端主动携带且不匹配 → 409
  `{error, code:'schema_epoch_mismatch'}`（auth 之后、registry 之前）；未携带 / 匹配 / 服务端未知 → 放行。
  客户端侧：数字 = 钉死契约（恒带、不重试）；`'auto'` = 从**每个**响应学习、之后自动携带，收到
  「epoch 与本地已知值不同」的 409 时刷新并**重试一次**（同 path/init）；未配置 = 旧行为（不带头、不重试）。
  桌面与 TUI 均已 opt-in，因此 **gateway 升级后两端会自动重新协商**，不再静默沿用旧契约。
  `fetchPath`（SSE / 二进制 / 裸 Response）不带头、不重试 —— SSE 订阅维持「不发头 = 放行」，不会因
  epoch 漂移反复重连。详见 `desktop.md` §「自动 schema epoch 协商」与 `tui.md`。
- **明确 won't do（本阶段定案，均非欠账）**：
  - **mobile 工作 tab 的任务 / 消息级增量 patch**：work overview 只有「整页快照」一个接口，没有
    「按 goal 取 task/message 增量」的端点；为局部 patch 新增端点属新 API 设计。现行一致性策略
    （flat 帧带 `goalId` → 只替换该 Goal 卡；其余变化 15s 全量兜底）已满足需要，见 `mobile.md` §7.11。
  - **`tts.speakStream` 的响应 schema**：wire 是 `text/event-stream`（PCM16 分块事件），不是 JSON；
    当前 OpenAPI 3.1 投影只描述 JSON content，硬塞会产出错误的 `application/json` 声明。错误面已由
    E10i 覆盖（400 + `default`）。
  - **500 / 502 / 408 / 415 显式状态**：与 `default` 同形（实现故障面），逐 op 展开只是 description
    噪声；继续留在 `default`（`ErrorEnvelope`）。
- **门禁**（worktree @ `21e4b850`）：gateway `tsc` **0**；全量 jest **7675 tests / 7663 passed /
  9 条已知 env-red（3 suites）/ 3 skipped**，零契约红；`schema:coverage` **逐字不变**
  （responses 320/327 + write responses 194/195 + requests 189/195 + errors default 327/327 /
  explicit 157）；`analyze-routes` **TOTAL 0**；`emit:openapi` **327 routes / 293 paths / 327 ops** +
  `gen:api`（overrides 10）幂等无 diff；SDK `tsc` **0** + 全量 **237**（+11）+ contract **4/4**；
  desktop 全量 **3875（3874 passed / 1 条 resolver env-red）** + `tsgo -p` 只剩 `node:tls` **2** 条；
  mobile 定向 **31** + `flutter analyze` **0**；TUI 纯函数 **6/6** + human-token **9/9**，
  整包 208（188/19/1）仍 env-red（`pi-tui`）；`kernel-split-guards` **7/7**。明细见交付记录。

---

## E11 身份 / 配额硬化（2026-11-13）

> E11 原清单里的设备生命周期（deviceName 校验、WS `?deviceId=` 凭据优先、`pruneStale`、rotate/revoke）
> 已在 E5a 完成；本波只做四个真实缺口：human token 轮换、内部会话配额账实、admission 二次校验、
> MCP human 边界审计（+ keychain 明确 won't do）。
> spec：`docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md`；
> plan：`docs/superpowers/plans/2026-11-13-gateway-e11-identity-hardening.md`；
> 交付记录：`docs/releases/2026-11-13-gateway-e11-identity-hardening.md`。

| # | 现状 | 边界 |
|---|---|---|
| E11-1 | **human token 轮换**：`core/human-token.ts#rotateHumanToken(dir)` 生成新的 32 字节 hex 并复用既有原子写（`.tmp` + fsync + rename + `chmod 0600`）；新路由 `routes/human-token.ts#attachHumanTokenRoutes` 挂 `POST /api/human-token/rotate`（catalog `humanToken.rotate`，POST / tag `auth`，response `{token, rotatedAt}`）。**只接受 `principal.kind === 'human' && principal.method === 'human-token'`**——轮换必须证明持有被替换的凭据，所以比 human-only 路由更严：device token（已配对手机可以借此作废桌面）、service（agent / MCP / 自动化永不轮换人类凭据）、loopback（无凭据本机客户端不是人类）→ 403；anonymous 在 transport 层已是 401（直调 route 时同为 403）。被拒 principal 统一返回稳定体 `{error:'human principal required', code:'human_principal_required'}`（`humanOnlyDenied`），**在任何文件访问与 body 读取之前**。成功 `200 {token, rotatedAt}`，kernel dep `rotateHumanTokenNow()` 写文件后 `this.humanToken = token`（既有 `() => this.humanToken` live getter）→ 新 token 立即生效、**旧 token 立刻失效**，无需重启、不拆会话；写失败 `500 {error}` 且旧 token 仍可用（赋值在写成功之后）。`log.warn('[Auth] human token rotated')` 是常量，token 永不进日志 / 错误体（`redactLog` 另遮 `X-MAFW-Human-Token`）。 | 契约 `45/318`（新 op 使 catalog 317 → **318**；spec 写的 45/317 是分母算错，台账以脚本实测为准）。SDK **不提供该方法**：`contract.test.ts` 的 `NON_SDK_EXEMPT` 按 operationId 具名豁免（唯一调用方是 `bin/mafw.js` 的裸 HTTP），另有 stale-exemption 守卫防豁免腐烂。桌面 Config UI 的轮换按钮不做（CLI + 自动重读已覆盖）。`MAFW_HUMAN_TOKEN_FILE` 只是测试 / 隔离 dev 的路径覆盖。 |
| E11-2 | **内部会话配额账实**：Lead 会话被登记两次（先 internal identity `internal-session` kv + identity bind，再 `SdkSessionResource.registerExternal` 走 E4-7 会话配额），第二步可能被拒。新 helper `core/session/internal-registration.ts#registerLeadSessionRecord` 保持原顺序，失败时**先回滚** `unregisterInternalSession(sessionId)`（身份不得比记录活得久），再 `log.warn`（`[Sessions] <role> session registration failed for <id> (<code>): <msg>`），再广播 **`session.registration_failed`** `{sessionId, role, code:'quota_exceeded'\|'error', message}`，最后 resolve `{ok:false, code, message}`——**从不 throw**（配额满不能把 Lead 启动路径打挂，runtime 会话仍可用）。两条 Lead 路径（`registerLead` dep 与 `rotateCreateManagerSession`）都走 kernel 私有的 `registerLeadRecord`，E11-2 之前那个静默 `.catch(() => {})` 已删除。回滚失败只额外告警，不掩盖原始失败。 | 配额**政策**不变：内部会话仍占一个 session 名额。`session.registration_failed` 是**新增事件**（消费者忽略未知事件即可；event_log 会持久化，属 additive wire）。 |
| E11-2b | **manager slot 回滚**：`rotateCreateManagerSession` 必须在注册前就持久化 `manager-session` 槽（否则并发 `ensure()` 会造出第二个 Lead），配额拒绝时槽会指向「有 runtime 会话、无本地记录」的 id。新增 `core/manager/manager-session-runtime.ts#clearManagerSlotsForSession(store, sessionId, runtime)`（`kvAll` + `kvSet` 的读改写包装，返回被清 key）与 `internal-registration.ts#rollbackRejectedLeadRegistration(...) → Error('<code>: <message>')`：**清槽 + 抛错**，拒绝的 session id 绝不出网关。槽行保留为 `{byRuntime:{}}`，其他 runtime 与 `unattributed` 历史槽不动；store 失败照常上抛（调用方仍拿不到死 id）。`archiveLeadSession` 复用同一 helper（一份实现，不再重复读改写循环）。 | 被拒的 runtime 会话**不删除**：轮换失败是调用方可见错误，不是会话删除路径（后续可 best-effort `session.delete()`）。`registerLead`（ensure 路径）保持 E11-2 语义：失败经事件可观测，已建好的 Lead 继续可用，没有要回滚的指针。 |
| E11-3 | **admission 二次校验**：`SchedulerOpts.resourceAdmission?: () => boolean`（**只**表达资源压力，不复用 `budgetChecker`，避免二次预算语义）；`pump()` **每次调用求值一次**并把 `nonForegroundBlocked` 传给 `pickEligible(...)`——压力下跳过 `priority !== 'foreground'` 的候选（留在队列，**不拒绝、不丢、不重复启动**），前台仍被考虑（key-blocked 的前台在 key 释放时照常启动），没有候选时循环终止。kernel 注入 `() => !(this.governor?.isDegraded() ?? false)`；`resources/degradation.ts#shouldResumeScheduler(prev, next)` = `prev.degraded.length > 0 && next.degraded.length === 0`（只看恢复边沿，降级中换 code 不触发），governor `onChange` 命中即 `void this.scheduler.sweep()`。 | submit-time `admissionChecker` **不变**（压力下新的非前台 submit 仍被拒）；本波只补「降级前已入队」的回撤。恢复续跑延迟由 governor 采样间隔决定，不保证即时（backfill / midground 可接受）。`resourceAdmission` 每 pump 只求值一次是刻意的（同步循环内不 thrash），压力在半途翻转由下一次 settle/sweep 再判。 |
| E11-4 | **MCP human 边界 + keychain 裁决**：机器化守卫 `gateway/tests/unit/mcp/human-boundary.test.ts`（47 工具名快照 + 3 条具名白名单 + `gateway/src/mcp/**` 源码扫描），决策与理由见下「E11-4 身份边界决策」。 | MCP human 工具 = won't do；OS keychain / 进程签名 = won't do（本阶段）。 |

### 运维面

- `mafw rotate-human-token`（`bin/mafw.js`）：读 `~/.mafw/human.token`（或 `MAFW_HUMAN_TOKEN_FILE`）→
  校验 64 hex → 带 `X-MAFW-Human-Token` POST `/api/human-token/rotate` → **只打印 `rotatedAt`**
  （新 token 只落盘，绝不回显终端 / 日志）。文件缺失 / 格式非法 / 非 200 → 明确报错 + exit 1。
  `httpRequest(...)` 因此多了可选 `headers` 参数（向后兼容）。用法与客户端影响见 `docs/guides/operations.md`。

### 残余（E11 后仍 deferred）

- 剩余 op 的 response schema 覆盖：E11 收口时 **273 未覆盖 / 45 已覆盖（14.2%）**，
  E10c 后为 265 / 53（16.7%），E10d 后为 257 / 61（19.2%），E10e 后为 249 / 69（21.7%），
  **E10f 后为 193 未覆盖 / 125 已覆盖（39.3%；JSON GET 已 100% 覆盖）**
  （台账 `npm run schema:coverage`，见「E10 契约覆盖」/
  「E10b 契约覆盖第二批」/「E10c 契约覆盖第三批」/「E10d 契约覆盖第四批」/「E10e 契约覆盖第五批」/
  「E10f 全量读表面收口」/ 本节 E11-1）。
  **E10g（+E10g-fix）后**：**读表面已收口**（127/327 response，JSON GET 127/133 = 100%）、
  **请求表面已收口**（189/195，剩余 6 个二进制 / multipart / A2A 显式排除）。
  **E10h 后（终态）**：**320/327（97.9%）** = GET **126/132** + 写响应 **194/195（99.5%）**；
  剩余 7 个缺口 = **6 个非 JSON GET**（`event.subscribe` SSE / `media.artifact` /
  `mobile.ttsArtifact` / `pods.a2aArtifact` / `plugins.webAsset` / `plugins.webEvents`，
  传输层内容类型不进 JSON schema）+ **1 个非 JSON 写**（`tts.speakStream`：PCM16 分块流，
  `WRITE_RESPONSE_EXCLUDED` 的唯一项；要建模只能换 `text/event-stream` 帧 schema，
  当前 OpenAPI 3.1 投影只描述 JSON content）。请求面维持 **189/195**（6 个二进制 /
  multipart / A2A 显式排除）。
- 强制版本协商 / SDK 全量 schema 类型化。**协商的客户端侧已由 E10j-J2 收口**：SDK
  `schemaEpoch: 'auto'` + desktop/TUI opt-in（学 epoch、epoch 漂移的 409 刷新后重试一次）。
  仍未做的是**强制拒绝**模式（gateway 只校验客户端主动携带的头，未携带永远放行）与 SDK 全量 schema 类型化。
- **错误体（4xx/5xx）：已收口（E10i）**：**`default` 327/327** + `/api/*` 的 **401/403 各 318** +
  **显式状态码 157 op / 356 条**（400/404/409/413/429/503；特殊形状只有
  `QuestionLedgerErrorSchema` 与 quota 429）。仍留在 `default` 的是**实现故障面**
  （500 catch-all / 502 / 408 / 415 / 405）与 9 个非 `/api` 入口的业务错误 —— 有意不建模，
  理由见「E10i 错误响应契约」。仍是声明式契约：handler 是事实源，无运行时校验。
  台账 `npm run schema:coverage` 的 `errors:` 行。
- ~~**TUI** triage phantom 字段渲染（`reason` / `goalId` / `severity`）~~ ——**E10j-J1 已收口**：
  `packages/tui/src/ui/triage-view-model.ts#triageView()` 只读真实 wire 形状，`triage-tab.ts` 的
  行与详情都不再引用 phantom 字段（mobile 是 E10f-E，desktop 是 E10b-3）。TUI 整包仍缺
  `@earendil-works/pi-tui`，门禁 env-red。
- **won't do（本阶段，已有决策与缓解）**：OS keychain / 进程签名、MCP human 工具（E11-4）；
  `pod.updated` 记录级实体 payload（E9-3）；**mobile 工作 tab 的任务 / 消息级增量 patch**
  （E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照；E10j §3 定案 won't do：
  work overview 只有整页快照接口，没有「按 goal 取 task/message 增量」的端点，新增端点属新 API 设计，
  当前 `goalId` 局部 patch + 15s 全量兜底已满足一致性）；`tts.speakStream` 的响应 schema（SSE 帧，
  E10j §3 再次确认排除）。
- E10 有意保留的松口：`PodGoal` 的可选性（`bucket` / `accepted` / `progress` / `revision` / `priority`…）
  仍比 handler 实际输出宽（收紧要动约 12 个 DTO 字段并打破桌面测试夹具，E8 先例）；`FileDiffInfo.file`
  仍可选，而 `session.diff` schema 的 `MafwDiff.file` 必填。

---

## API 端点

全部挂在 **:3000**（单端口；桌面/TUI/插件同源）。按组列举（完整清单见 `docs/reference/tools.md`）：

| 组 | 代表端点 |
|---|---|
| 健康/事件 | `GET /health`、`GET /api/events`（SSE 订阅）、`POST /api/events`（**外部发布**：只接受自定义命名空间，推荐 `plugin:<pkg>:<event>`；`mafw_event`/canonical/扁平保留名/`sync` 一律 400，见 E1-2，全 UI 通道） |
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

opencode serve（4096）由 opencode 驱动以 **sidecar 子进程**方式监管
（`adapters/opencode/src/serve-sidecar.ts`，替换 SDK `createOpencodeServer` 封装）；
gateway 只保留中性编排（watchdog / recoverServe / 事件流重订）：

- **spawn 契约与 SDK 完全一致**：`createOpencodeServer` 内部使用 cross-spawn、
  `opencode serve --hostname=127.0.0.1 --port=4096`、env `OPENCODE_CONFIG_CONTENT="{}"`、
  就绪信号 stdout `opencode server listening on <url>`（超时 5s 树杀报错）
- **认证密码稳定化（2026-11-10）**：`resolveServePassword()` 优先级 = env
  `MAFW_RUNTIME_PASSWORD` / `MAFW_OPENCODE_PASSWORD` / `OPENCODE_SERVER_PASSWORD` → 持久文件
  `~/.mafw/serve-password`（`MAFW_SERVE_PASSWORD_FILE` 可覆盖，0600，原子写）→ 生成
  `mafw-<uuid>` 并落盘。gateway 重启/外部 CLI daemon 重启后可用同一密码收养仍在运行的旧
  serve；旧实现每进程随机密码，重启后必然 401 并把旧 serve 留成孤儿。
- **孤儿 serve 清场（2026-11-10）**：启动时 `healthCheck` 失败 → `killServe()`；Windows 必须
  `taskkill /F /T /PID`（裸 `process.kill` 不足以杀掉实际监听子进程），PID 取
  `Get-NetTCPConnection ... | Where-Object RemotePort -eq 0`（本机 netstat 对监听 socket 报
  PID 0，无法用于清场），随后等待 500ms 再 spawn。否则旧 serve 占着 4096，新 gateway
  只能退化为 MCP-only，所有 native 调用 401。
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
## Phase 4 seams（2026-11-11）

- 内置 adapter 注册走 `runtime/builtin-adapters.ts` 的描述符聚合；`runtime/opencode-adapter.ts` 是唯一包绑定入口。
- reverse proxy 只使用 `runtimeHost.proxyHeaders()`；gateway 不再回退到 adapter 的 `serveAuthHeaders()`。
- 凭据：`runtimeGetApiKey`/`createPluginCredentials` 只使用 active host；scan 解析为 credentials → `resolveProviderTransport`，无 gateway config/provider-list fallback。
- `runtime/legacy-plugin-bridge.ts` 为 Phase 4.1 旧插件 shim；`adapter-bridge.ts` 仅保留 deprecated re-export。
- 协议守卫：`gateway/tests/unit/runtime/runtime-protocol-guards.test.ts`（G1–G4）。

## 领域事件层（P2.4）

`gateway/src/core/events/` 提供 Source → Trigger → Thread → Subscription → Decision → Delivery
领域事件层；默认开启，`MAFW_EVENT_LAYER=0` 关闭。AutomationEngine 通过 `event:github_poll` /
`event:cron_tick` 动作把事件交给 `EventLayerService`；GitHub 第一版轮询 issues/PRs + comments，
reviews/CI 归 follow-up。完整表、API、背压与测试见 `docs/architecture/events.md`。
