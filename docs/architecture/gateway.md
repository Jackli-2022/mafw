# MAFW Gateway 架构

> 常驻进程：Goal 编排（LangGraph 循环）+ 谐波记忆 + 自动化引擎 + HTTP API（:3000）/ MCP / 事件流；并监管 opencode serve sidecar。
>
> 时效：2026-09-14 对照 `gateway@5.0.0` 源码重写；2026-09-16 增补统一插件包（§插件系统）。
> 更细的子系统说明以根 `AGENTS.md` 为准（本文与其同源，取面向架构读者的视角）。

## 目录

- [代码位置](#代码位置)
- [进程生命周期](#进程生命周期)
- [CLI（bin/mafw.js）](#clibinmafwjs)
- [Goal 编排：事件驱动 + LangGraph](#goal-编排事件驱动--langgraph)
- [MafwScheduler 关键子系统](#mafwscheduler-关键子系统)
- [插件系统（四类型 loader + 统一包宿主）](#插件系统四类型-loader--统一包宿主)
- [API 端点](#api-端点)
- [UI 服务](#ui-服务)
- [数据流全景](#数据流全景)
- [文件系统布局](#文件系统布局)
- [记忆维护管线（当前态）](#记忆维护管线当前态2026-09-14)
- [配置与环境变量](#配置与环境变量)

---

## 代码位置

```
gateway/
├── bin/
│   └── mafw.js                   # CLI 入口（进程管理、诊断、TUI）
├── src/
│   ├── index.ts                  # MafwScheduler — 主调度器（~6000 行）
│   ├── config.ts                 # 统一配置（三层优先级，MAFW_* 环境变量）
│   ├── automation-engine.ts      # cron/事件自动化引擎 + action 注册表
│   │
│   ├── core/
│   │   ├── langgraph/            # Goal 循环编排（现行）
│   │   │   ├── graph.ts          # StateGraph 定义 + routeAfterPlan/routeAfterReview
│   │   │   ├── loop-state.ts     # LoopState 元数据模型
│   │   │   ├── checkpointer.ts   # FileCheckpointer（BaseCheckpointSaver）
│   │   │   ├── review-parser.ts  # verdict 机器可读解析（```mafw-review 围栏 JSON）
│   │   │   ├── signature-detector.ts
│   │   │   └── nodes/            # plan / execute / review / archive_* + syncToDashboard
│   │   ├── manager/              # manager session、goal 快照、里程碑推送、/btw、new-topic
│   │   ├── memory/               # harmonic-index、energy-system、minhash-merger、review-scheduler…
│   │   ├── plugin.ts             # legacy 插件内记忆路径（废弃，仅兼容保留）
│   │   └── tools/                # record-feedback 等核心工具
│   │
│   ├── memory/                   # HarmonicUnitFileStore（OKF 读写）、GatewayDatabase、MemoryService、嵌入运行时
│   ├── recall/                   # 后台记忆召回与管线：
│   │   ├── turn-pipeline.ts      #   turnCompress（每小时）
│   │   ├── reflection.ts         #   reflection（每日）
│   │   ├── stale-verify.ts       #   stale 重验（每周）
│   │   ├── session-worker-pool.ts / memory-worker.ts   # curator worker 会话池
│   │   ├── index-scan.ts / recall-context.ts / time-anchor.ts / inject-format.ts
│   │   └── pipeline-rules.ts     #   管线 cron 规则幂等供给
│   ├── mcp/                      # MCP 工具注册表（40 工具）+ handlers（/mcp 双传输）
│   ├── runtime/                  # Runtime 能力契约、opencode 内置 runtime、pi 插件、热切换
│   ├── media/                    # A2A Media Agent、pi-adapter、插件引擎加载器
│   ├── python/                   # 持久 Python 内核（Jupyter wire 协议 + ZeroMQ）
│   ├── routes/                   # 独立路由模块（runtime-switch、model-config、embedding-config…）
│   ├── plugins/                  # 统一插件包宿主（package-host/context/types）+ hub（list/install）
│   ├── skills/                   # memory-curator agent 定义、manager agent 配置
│   ├── usage/                    # 用量 provider 插件系统（内置适配器 = 同接口 JS 文件）
│   ├── orchestration/            # RSI Phase 1 观测层（registry / policy）
│   ├── retrieval/  graph/        # guided retriever、锚点图谱
│   └── dashboard/api.ts          # 部分遗留 dashboard 端点（挂在 3000）
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
    ├── init SDK client                 → @opencode-ai/sdk
    ├── probe isServeHealthy()
    │     ├─ 通  → 收养已有 opencode serve（:4096）
    │     └─ 不通 → serve sidecar spawn（手写 spawn，windowsHide）
    │               就绪信号/健康轮询 watchdog（30s ×3 失败 → recoverServe：
    │               kill + respawn + 事件流重订阅；退避 0/5s/15s，≥4 次 → 5min）
    ├── recoverConfig / recoverRegistry → 恢复注册表
    ├── recoverState()                  → 恢复活跃 Goal（activeGoals + checkpoint）
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

## Goal 编排：事件驱动 + LangGraph

### 设计原则

Gateway 不做「业务判断」——路由决策委托给 LangGraph 的 `routeAfterPlan()` /
`routeAfterReview()` 纯函数。LangGraph 编排**至今是 Goal 循环的现行实现**
（`gateway/src/core/langgraph/`，非历史遗留）。

```
manager agent → mafw_set_goal (MCP)
  → POST /api/work/{goalId}/validate → handleValidate()
    → state/{goalId}.json (nextAction: GRAPH_INVOKED)
    → onGoalCreated(goalId, projectDir, mafwDir)
      → buildExecutionGraph() + FileCheckpointer(<project>/.mafw/checkpoints/)
      → graph.invoke(initialState, { thread_id: goalId, checkpointer })
```

### 图结构（现行）

```typescript
const workflow = new StateGraph(LoopState)
  .addNode("plan", options.plan, { retryPolicy: { maxAttempts: 2 } })
  .addNode("askUser", options.askUser)          // need_clarification 分支
  .addNode("execute", options.execute, { retryPolicy: { maxAttempts: 2 } })
  .addNode("review", options.review, { retryPolicy: { maxAttempts: 2 } })
  .addNode("archive_success", options.archiveSuccess)
  .addNode("archive_fail", options.archiveFail)
  .addNode("archive_max_retries", options.archiveMaxRetries)

  .addEdge("__start__", "plan")
  .addConditionalEdges("plan", routeAfterPlan, { /* execute | askUser | … */ })
  .addEdge("askUser", "plan")
  .addEdge("execute", "review")
  .addConditionalEdges("review", routeAfterReview, {
    plan: "plan",                    // FAIL 未超限 → 重试 Loop
    archive_success: "archive_success",
    archive_fail: "archive_fail",
    archive_max_retries: "archive_max_retries",
  })
  .addEdge("archive_success", END)
  .addEdge("archive_fail", END)
  .addEdge("archive_max_retries", END);
```

### 节点模式（interrupt）

每个 Agent 节点遵循同一模式（`nodes/plan.node.ts` 为例）：

```typescript
async function planNode(state, options) {
  syncToDashboard({ phase: 'PLANNING' });            // 写 state/{goalId}.json 视图
  const session = await client.session.create({ directory: projectDir });
  await client.session.promptAsync({ sessionID, parts: [{ type: 'text',
    text: `/skill mafw-plan ${goalId}` }] });
  interrupt('awaiting_plan');                        // 挂起，等 Plugin/agent 完成后事件恢复
  // resume 后：校验 waves.json（JSON.parse + 结构校验）
  // need_clarification → routeAfterPlan 进 askUser 节点
  return { wavePlanPath, ... };
}
```

review 节点的 verdict 解析统一走共享模块 `review-parser.ts` 的**机器可读契约**
（` ```mafw-review ` 围栏 JSON v2 格式，兼容纯 JSON；**无文本 fallback**——缺失机器可读块
即 verdict ERROR）。自由文本解析曾因 "did not pass" 含 "pass" 误判 PASS
（教训：解析契约与 agent SKILL.md 必须同批部署）。

### FileCheckpointer 与崩溃恢复

```
<project>/.mafw/checkpoints/{goalId}/
├── step_0000001.json       ← 节点执行后 checkpoint
├── step_0000002.json       ← interrupt 点
└── metadata.json           ← 当前 step / retries / error
```

`FileCheckpointer` 继承 LangGraph `BaseCheckpointSaver`。Gateway 重启后
`recoverState()` 重建 activeGoals，`resumeStaleThreads()` 遍历 checkpoints 目录
恢复孤儿线程。

---

## MafwScheduler 关键子系统

**文件**：`gateway/src/index.ts`（`class MafwScheduler`，~6000 行）。
除 LangGraph 编排外，主要子系统（细节见 AGENTS.md 对应章节）：

| 子系统 | 位置 | 说明 |
|---|---|---|
| serve sidecar 监管 | index.ts + 契约 | spawn/收养、watchdog、recoverServe、事件流重订阅 |
| Runtime 能力契约 | `runtime/` | Tier 0-2 能力自声明；opencode 内置 / pi 插件 / 热切换 |
| 谐波记忆 | `memory/` + `recall/` | OKF 存储、BM25/hybrid 检索、能量、MinHash 合并、ConsolidationService |
| 记忆管线 | `recall/` | turnCompress / reflection / stale 重验（见下文专节） |
| MCP 服务 | `mcp/` | 40 工具；/mcp 双传输（无状态 StreamableHTTP + legacy SSE） |
| 自动化引擎 | `automation-engine.ts` | cron/事件触发、triage 队列、action 注册表 |
| Manager 会话 | `core/manager/` | per-project manager、goal 快照、里程碑推送、/btw、new-topic |
| Media Agent | `media/` | A2A 协议、四模态、每模态可插拔引擎 |
| Python 内核 | `python/` | Jupyter wire 协议（ZeroMQ）、Mutex 队列、TTL 回收 |
| 用量插件 | `usage/` | 8 内置 provider 适配器 + 用户插件目录 |
| 统一插件包 | `plugins/` | PluginHost：一包多贡献（usage/media/runtime/uiTools），见下节 |
| 自更新 | self-update | pending-restart 令牌 → build → 子进程接力重启 |
| RSI 观测层 | `orchestration/` | goal_outcomes / goal_sessions / evolution_proposals（gateway.db） |

核心方法（与 LangGraph 衔接）：`handleValidate()` → `onGoalCreated()` →
`graph.invoke()`；`onEvent(goalId)` → `graph.invoke(new Command({}))` 恢复中断；
`patchState()` 原子写 state.json + SSE 广播；`archiveGoal()` 归档 + 记 outcome。

---

## 插件系统（四类型 loader + 统一包宿主）

Gateway 侧插件按能力分四种类型，各有 loader 与目录（**legacy 面，行为不变**），
2026-09-16 起由统一包宿主 **PluginHost** 收敛为"一包多贡献"：

```
~/.mafw/plugins/                     ~/.mafw/{usage,media,runtime}-plugins/     内置件
  my-vendor.js / my-vendor/            （legacy 目录，各 loader 自扫自 watch）    opencode / pi
  └─ activate(ctx) → 贡献                     │                                      │
        │                                     │                                      │
        ▼                                     ▼                                      ▼
  ┌───────────────── PluginHost ────────────────────┐   ┌──────── loader 内置注册 ────────┐
  │ 扫描 → 激活 → setPackageEntries() 推送 ──────────┼──▶│ RuntimePluginLoader / PluginLoader │
  │ 顶层 + 每包子目录双 watcher（跨面原子 reload）    │   │ / MediaPluginLoader                │
  └──────────────────────────────────────────────────┘   └────────────────────────────────────┘
```

| 优先级（同名） | 说明 |
|---|---|
| **包**（`~/.mafw/plugins/`） | PluginHost 推送（`setPackageEntries`），最高 |
| **legacy 目录文件** | 各 loader 自扫，用户同名文件覆盖内置（原有语义） |
| **内置** | usage：`dist/usage/builtin-plugins/*.js`（纯 JS 同接口）；runtime：`registerBuiltin('opencode'/'pi')`；media：`registerBuiltinEngine('pi')` |

- **包形态**：单文件 `name.js` 或目录 `name/plugin.json`（`{name, version?, main?}`）；
  模块形状为声明式 `{ name, usage?, media?, runtime?, uiTools? }` 或
  `async activate(ctx) → contributions`（`gateway/src/plugins/package-host.ts`）
- **统一 ctx**（`plugins/package-context.ts`）：三 legacy ctx 超集——`apiKey` / `fetch`(60s) /
  `log` / `pluginConfig`（读 `plugins.<name>.config`，回退 legacy 三段）/ `projectDir` /
  `gatewayPort` / `usage.modelStats`；`RuntimePluginContext` 亦补 `projectDir?`/`gatewayPort?`（pi 消费）
- **内置件 dogfood**：opencode 经 `registerBuiltin('opencode', …)` 注册（可被同名文件/包覆盖，
  `createRuntime` fallback 改走 loader）；media `pi` 经 `registerBuiltinEngine('pi', …)` 登记，
  `resolveMediaPrompt`（`media/resolve-prompt.ts`）先查 engines map——非 builtin 同名直接生效
- **hub**：`GET /api/plugins` 响应 `{ plugins, packages }`；`packages` 即 PluginHost `PackageState[]`
- **uiTools**：v1 仅登记展示（桌面侧工具卡加载仍在 desktop main 进程，`~/.mafw/ui-plugins/`）
- 限制：包 reload 只清主文件 `require.cache`（改包内 `lib/` 需 `mafw restart`）；
  env `MAFW_PLUGINS_DIR` 覆盖包目录（测试）

---

## API 端点

全部挂在 **:3000**（单端口；桌面/TUI/插件同源）。按组列举（完整清单见 AGENTS.md §5）：

| 组 | 代表端点 |
|---|---|
| 健康/事件 | `GET /health`、`GET /api/events`（SSE 订阅）、`POST /api/events`（发布：顶层扁平或 opencode_event 信封，全 UI 通道） |
| 项目/会话 | `POST /register`、`GET /api/projects`、`GET /api/sessions`、`GET /api/manager/session` |
| Goal 编排 | `POST /api/work/{goalId}/validate`、`POST /api/work/{goalId}/complete`、`POST /control`（PAUSE/ABORT） |
| 记忆 | `GET /api/recall/context`、`GET /api/recall/pinned`、`POST /api/obs/capture`、`POST /api/memory/add`、`GET /api/memory/search`、`GET /api/memory/stats` |
| MCP | `POST/GET /mcp`（双传输） |
| 运行时 | `GET /api/runtime`、`POST /api/runtime/switch`、`POST /api/runtime/restart-agent` |
| 媒体 | `POST /a2a`、`GET /a2a/artifacts/:id`、`GET /api/media/plugins` |
| Python | `POST /api/python/execute`、`POST /api/python/restart` |
| 用量/配置 | `GET /api/usage`、`GET/POST /api/model-config`、`GET/POST /api/memory/embedding-config` |
| 插件中心 | `GET /api/plugins`（含 `packages`）、`POST /api/plugins/install|enable|disable|delete` |
| 命令/融合 | `POST /api/mafw-commands/run`（/btw、new-topic）、`POST /api/merge-memory` |
| 观测 | `GET /api/orchestration/outcomes` |

> 历史注：曾有的独立 Web Dashboard（端口 3001/3111）已退役——`dashboard/server.ts`
> 启动代码已注释，UI 职责由 Desktop（Electron）与 `mafw tui` 承担。

---

## UI 服务

- **Desktop（packages/desktop，Electron）**：主 UI。Rail + TabStrip；经 `@mafw/sdk`
  走 `window.api.mafw.*` IPC → HTTP :3000；SSE 直连 gateway；自带 gateway bundle
  （adopt → bundle → cli 三级决策，见 AGENTS.md §5.5）
- **TUI（mafw tui）**：pi-tui 四 tab，纯 HTTP/SSE 客户端
- **Web Dashboard**：退役（见上注）

---

## 数据流全景

### Goal 从创建到完成

```
用户 /goal（或 manager mafw_set_goal）
  → POST /api/work/{id}/validate → handleValidate()
  → onGoalCreated → graph.invoke
  │
  ▼
LangGraph: plan ⟶ (askUser) ⟶ execute ⟶ review ⟶ routeAfterReview
  │  各节点：createSession → promptAsync('/skill mafw-*') → interrupt
  │  完成 → 事件 → onEvent → graph.invoke(new Command({})) 恢复
  ▼
PASS  → archive_success → END（记录 goal_outcomes）
FAIL  → 未超限 → plan 重试 / 超限 → archive_fail → END
```

### 记忆事件流（两条正交通道）

```
观察捕获：插件 hooks（用户消息/工具后/text.complete…）
    → POST /api/obs/capture → gateway.db t1_observations
    → turnCompress（每小时）→ curator worker → mafw_add_memory

边界 recall：messages.transform（每次 LLM 调用前）
    → GET /api/recall/context → <recall> 指针块注入
```

---

## 文件系统布局

两级数据根（goal 面在项目，记忆面在全局）：

```
<project>/.mafw/                     # per-project（Goal 与请求面）
├── state/{goalId}.json              # goal 状态视图（syncToDashboard 写）
├── checkpoints/{goalId}/            # LangGraph FileCheckpointer
├── waves.json                       # wave 计划（plan 节点校验）
├── tasks/  receipts/  reviews/      # execute/review 工件
├── requests/                        # 请求配置
├── logs/mafw.log                    # 插件侧文件日志
├── user-feedback/                   # thumbs 反馈 JSON
└── user-questions/                  # ask_user 记录

~/.mafw/                             # 全局数据根（config.resolvePath()）
├── memory/
│   ├── concepts/{semantic|episodic|procedural|global|knowledge}/
│   │                                # OKF 记忆（每条一个 Markdown：frontmatter+正文）
│   ├── .harmonic_index.json         # 检索索引（纯可推导产物）
│   ├── vectors-<model>.json         # dense 嵌入（opt-in，按 provider 打标）
│   └── gateway.db                   # 统一数据库：t1_observations、kv_store、
│                                    #   goal_outcomes、goal_sessions、evolution_proposals
├── automations/*.json               # 自动化规则（turn-compress / memory-reflect /
│                                    #   memory-decay / memory-review…）
├── logs/mafw.log                    # gateway 文件日志（5MB 轮转）
├── plugins/                         # 统一插件包（一包多贡献；PluginHost 扫描/watch）
├── runtime-plugins/  usage-plugins/  media-plugins/  ui-plugins/
│                                    # legacy 四目录（行为不变，优先级低于包）
├── pending-restart.json  last-restart.json   # 自更新控制面
└── fusion-log.jsonl                 # 跨 worktree 记忆融合记录

~/.config/mafw/
├── config.yaml                      # 配置（中间层，persistOverrides 落这里）
└── gateway.pid                      # CLI status/stop 依据
```

> 历史注：早期 `.opencode/mafw/` 目录与 `memory/tier2.json / tier3.json / tier4.json`
> 分层布局已废弃——记忆现为 OKF（`concepts/{type}/`）+ 纯可推导索引，Goal 数据在
> `<project>/.mafw/`。

---

## 记忆维护管线（当前态，2026-09-14）

### 管线与自动化规则

| 管线 | 规则（cron，UTC） | 职责 |
|---|---|---|
| turnCompress | `turn-compress`（每小时） | per-session 完成回合合并为 batch transcript → 持久 worker 会话自主 `mafw_add_memory` |
| reflection | `memory-reflect`（每日 3:00） | 跨回合高阶模式蒸馏（semantic/procedural） |
| 能量衰减 | `memory-decay`（每日 3:30） | 增量时间衰减——管"淡忘" |
| stale 重验 | `memory-review`（每周日 4:00） | `StaleVerifyPipeline` 重验高价值记忆——管"内容有效性" |

规则由 `gateway/src/recall/pipeline-rules.ts` 幂等供给；action handler 在
`index.ts registerMemoryPipelineActions()`（`memory:review` 覆盖 automation-engine
模块级的打日志桩）。

### 环境探测式记忆维护（Environment-Probing Curation，arXiv:2609.11060）

post-task curator 只看轨迹存在"回顾性证据边界"（错误答案、过度泛化、stale 知识）。落地四点：

- **只读探测面**：curator 即 `memory-curator` agent（持久 worker 会话）。工具白名单 = 三个记忆工具 + `read/grep/glob/ls`；`edit/bash/webfetch` 保持 deny——2026-08-31 transcript 执行事故的 mutation 防线不变
- **propose–probe–commit**：项目相关 procedural/semantic 记忆写入前 ≤3 次探测验证；transcript 与环境矛盾时以环境为准并 supersedes；只记可复用过程、不记实例答案
- **置信度约定**：探测验证过的记忆 cue_anchors 带 `verified:YYYY-MM-DD`（prompt 约定，零 schema 改动）
- **成败信号**：`TurnPipelineOptions.gradeFor` 经 `GatewayDatabase.getOutcomeForSession()`（goal_sessions ⋈ goal_outcomes 取最近 archived）把 goal verdict/thumbs 拼入 worker prompt
- **stale 刷新**：`StaleVerifyPipeline`（`gateway/src/recall/stale-verify.ts`）取 top-10 energy×salience 的 procedural/semantic（>14 天、未 superseded）交 `stale-verify` worker 只读重验，失真走 supersedes 链

### Worker 会话治理（session 风暴防线）

`SessionWorkerPool`（`gateway/src/recall/session-worker-pool.ts`）：lazy 创建（仅本小时有完成回合的 session）、pipeline 互斥（skip-once）、`runExclusive` per (session,kind) 防并发、TTL 24h 驱逐时 `session.delete` 物理删除、硬帽 64、idle 8h summarize 控 token；`internalSessionRoles` + 标题前缀过滤对 UI 隐藏；`/api/obs/capture` 白名单防 worker 输出回流 T1（递归风暴）。2026-09-14 已物理清理 2923 条历史垃圾 worker 会话（serve API 级联删除，验证后批量执行）。

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

热生效边界：`config.yaml` 变更 watcher 2s 防抖自动 reload，`runtime` 段变更触发热切换；
`server`/`paths` 段变更需重启。
