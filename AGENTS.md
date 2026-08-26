# MAFW Gateway & Plugin 架构

## 1. 谐波记忆系统

### 3.1 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';  // 字段名是 type（非 memory_type）
  primary_abstraction: string;    // 6-8 词核心摘要（实际各写路径放全文/摘要不等）
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // 参与排序（写路径计算并存 OKF，检索 ×energy×salience，缺失按 1）
  abstraction_level?: number;     // 0=T1, 1=T2, 2=T3/T4, 3=L5；写路径统一映射（episodic→1，semantic/procedural→2，global→3）
  review_count?: number;          // 休眠：类型声明，无写路径，复习队列无消费者
  last_reviewed?: string;         // 休眠：同上
  top_associations?: string[];    // 未实现：类型声明，全仓库零读写（联想预取不存在）
  merged_from?: string[];         // MinHash 合并来源 id（写路径 merge 时填充）
  created_at: string;
  updated_at: string;
}
```

> 注：`goal_id` 为历史兼容字段，当前写路径不填充。
> MinHash 合并采用 **soft supersede**：相似旧条目标记 `superseded_by` 并降低 energy（×0.5），不物理删除，便于 knowledge-update 场景保留历史版本；检索排序时 superseded 条目再 ×0.5 惩罚。

### 3.2 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → 加载 .harmonic_index.json（无视 memory_type 与层级）
     → 按 energy × 检索得分排序
     → 按需从 tier 文件加载完整 memory_value
```
两种检索器（`gateway/src/core/memory/harmonic-index.ts`）：
- **bm25（默认）**：query 分词做 BM25（k1=1.2, b=0.75）× energy × salience，tokenize 为小写单词（len≥2）+ CJK unigram；查询时现算，不持久化索引文件
- **token**：子串计数 × energy × salience，可通过 `mafw_search_hybrid` 的 `retriever:'token'` 或 `/api/memory/search?retriever=token` 显式回退

LongMemEval 基准（session 粒度 R@10）：token 0.474 → **bm25 0.949**（6/6 类提升；1000 entries 搜索 ~2-3ms）。`searchScored()` 同时返回原始 BM25/token 分数，供下游精排、截断与置信度展示使用。

### 3.3 压缩

`HarmonicUnitFileStore.write()` 输出 `HarmonicUnit` 并自动：
1. 计算显著度
2. 写入对应 tier 文件（`concepts/{semantic|episodic|procedural|global|knowledge}/`）
3. 更新 `.harmonic_index.json`
4. 触发 MinHash 跨层合并检查（`MinHashMerger.merge()`，阈值 0.6、4 签名、3-gram shingle；合并产物带 `merged_from` 防递归；`skipMerge` 选项供 LongMemEval 基准等确定性摄入场景关闭）

> 注：`HybridCompressor`（会话压缩管线）只挂在 deprecated legacy 插件路径，当前 gateway 运行时写路径是 `/api/memory/add` + MCP handler + turnCompress worker，均经 `HarmonicUnitFileStore.write()`。

### 3.4 能量衰减

- 基础衰减率 **0.005/天**（`EnergySystem.decayRatePerDay`，salience 越高衰减越慢——`HarmonicIndexEntry` 现在携带 `salience`，衰减 pass 已可读取）
- 默认自动化规则 `memory-decay`（每日 UTC 3:30，`recall/pipeline-rules.ts` 供给）：按 entry `created_at` 计算真实流逝天数做纯时间衰减（无事件加成）
- 事件加成（`retrieved` +0.02 / `useful_feedback` +0.1 等）由 `EnergySystem.calculateEnergy` 提供，属于检索/反馈路径的语义，**不在**衰减 pass 中混用
- 检索访问加成（search 时 +0.02）当前未接入检索路径（休眠）

## 4. Tools 清单（v6.8 总共 35 个）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | 谐波记忆检索（token 计数×energy 默认；`retriever:'bm25'` 用 BM25×energy） |
| `mafw_get_deltas` | 获取参数化约束（L3） |
| `mafw_update_state` | 更新状态文件 |
| `mafw_load_state` | 读取状态文件 |
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |
| `mafw_add_memory` | 写入记忆单元 |
| `mafw_commit_heuristic` | 提交 L5 启发式 |
| `mafw_get_axioms` | 获取 L5 公理 |
| `mafw_merge_memory` | ★ 跨 worktree 记忆融合 |
| `mafw_resolve_merge` | 解决记忆融合冲突 |
| `mafw_create_goal` | 创建 Goal（Manager 专用） |
| `mafw_set_goal` | 设置活跃 Goal |
| `mafw_get_goal_status` | 查询 Goal 状态 |
| `mafw_list_goals` | 列出 Goal |
| `mafw_answer_question` | 回答待决问题（Manager） |
| `mafw_get_evidence` | 获取 Goal 证据 |
| `mafw_cancel_goal` | 取消 Goal |
| `mafw_list_pending_questions` | 列出待决问题 |
| `mafw_list_automation_rules` | 列出自动化规则 |
| `mafw_get_automation_rule` | 查询自动化规则 |
| `mafw_get_automation_history` | 自动化历史 |
| `mafw_run_automation` | 手动运行自动化 |
| `mafw_validate_rule` | 校验规则 |
| `mafw_list_triage_items` | 列出 triage 项 |
| `mafw_get_triage_item` | 查询 triage 项 |
| `mafw_propose_triage_decision` | 提议 triage 决策 |
| `mafw_draft_automation_rule` | 起草自动化规则 |
| `mafw_desktop_screenshot` | 桌面截图 |
| `mafw_desktop_navigate` | 桌面导航 |
| `mafw_desktop_get_ui_state` | 桌面 UI 状态 |
| `mafw_desktop_click` | 桌面点击 |
| `mafw_desktop_type` | 桌面输入 |
| `mafw_desktop_scroll` | 桌面滚动 |

## 5. v6.8 新增系统

### 5.1 统一配置管理
- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值
- 所有端口/URL/超时/路径集中在 `gateway/src/config.ts`
- 环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）

### 5.2 记忆与 Goal 解耦
- `HarmonicUnit.goal_id` 可选 —— 记忆不绑定任何 Goal
- 所有 Hooks 在无 goal 上下文时照常运行
- `recordFeedback` 存储路径已扁平化（`.mafw/feedback/`）；`askUser` 已扁平化（`.mafw/user-questions/{id}.json`，legacy 按 goal 分目录读取兜底）
- `CostEstimator.ToolCallRecord.goalId` 改为可选

### 5.3 记忆融合系统（git worktree）
- `mafw_merge_memory` MCP 工具：MinHash 比对，提取独有记忆（energy=0.4）
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` 在 git merge 前调用 `mergeMemoryFromWorktree()`（读源 worktree 的 harmonic index + OKF，非 legacy memories.json）
- 融合记录写入 `~/.mafw/fusion-log.jsonl`
- HTTP 端点：`POST /api/merge-memory`（插件 `/merge-memory` 命令用，复用 MCP handler）
- CLI 命令：`/merge-memory`；`/worktree-list`、`/worktree-prune` 仅存在于 deprecated legacy 插件路径

### 5.4 文件日志系统
- 插件侧 `installFileLogging()` 劫持全局 `console.log/warn/error`，写入 `<project>/.mafw/logs/mafw.log`（`src/utils/logger.ts`）
- gateway 侧日志写 `~/.mafw/logs/mafw.log`（`gateway/src/core/utils/logger.ts`）
- 格式：`[ISO时间戳] [LEVEL] 原始消息`
- 5MB 自动轮转

### 5.5 Desktop 前端（opencode-dev/packages/desktop/）
- Electron + SolidJS + `@opencode-ai/ui`
- utilityProcess 侧车运行 Gateway
- 主 UI：左侧 Rail(200px) + 上部 TabStrip + 内容区

### 5.6 Rail 侧边栏数据流
Rail 通过 `window.api.mafw.{namespace}.{method}(...)` 静态类型 API 获取数据：
```
onMount → gateway.info() 等 ready
       → invoke("project", "list")       → GET /api/projects
       → invoke("project", "current")    → GET /api/projects/current
       → invoke("session", "list", pid)  → GET /api/sessions?projectID=...
```
注意：`projects.current()` 返回的是 `Project` 对象本身，不是 `{ project: Project }` 信封。
点击"All projects"里的其他项目时，同时调 `projects.setCurrent(path)` 同步到 gateway。

所有 data fetching 在组件内 inline 使用 `createEffect`，无独立 hook。
轮询间隔：Dashboard 15s / Approvals 10s / Triage 10s / Automations 10s。

### 5.10 UI 组件约定
- MAFW 禁止新增裸 `<button>`、`<input>`、裸 `title` 属性，一律用 `@opencode-ai/ui/v2/*` 组件
- 按钮用 `ButtonV2`（variant: contrast/outline/ghost）
- 文本输入用 `TextInputV2`
- 开关用 `SwitchV2`
- 提示用 `TooltipV2`（统一 `openDelay: 300`）
- 加载用 `LoaderV2`
- 通知用 `ToastV2`（统一 `toastStore` 入口）

### 5.7 Gateway 启动顺序
```
start()
  ├─ installFileLogging()              → ~/.mafw/logs/mafw.log
  ├─ initServices()                    → Memory + Cost + MCP + Automation
  ├─ startApiServer()                  → HTTP API on port 3000
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

### 5.8 Desktop → Gateway 探测连接
`mafw-sidecar.ts:startGateway()` 优先探测已有 gateway：
```
probeExistingGateway()
  → 探测顺序：MAFW_SERVER_API_PORT → MAFW_GATEWAY_PORT → 3000
  → 调用 GET /health 确认
  → 通 → 直接设置 state="ready"，不 spawn
  → 不通 → 走 resolve → findFreePort → utilityProcess.fork
```
运行时健康检查每 30s 一次，连续 5 次失败后自动 restart。

### 5.9 Client SDK → Gateway IPC 通道
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

`@mafw/sdk` 包通过 workspace 解析到 `opencode-dev/packages/gateway-sdk/`，提供 `MafwClient` 类 + 全部 DTO 类型。

### 5.11 后台记忆召回（Background Recall）

系统概述 — **边界 recall + 回合末 recall** 两个机制：

```
opencode server 进程                    Gateway 进程
┌─────────────────────────────┐        ┌──────────────────────┐
│ Plugin (两个 hook)          │        │ HarmonicIndexManager │
│                             │        │                      │
│ experimental.chat.messages  │        │ GET /api/recall/     │
│  .transform                 │ HTTP──▶│ context?query=...    │
│  → 边界 recall 触发         │◀───────│ → search → format    │
│  → 注入指针块到 messages 尾部│        │ → {pointers}          │
│                             │        │                      │
│ experimental.chat.system    │        │ (无独立通道：全部记忆  │
│  .transform                 │        │  都在谐波系统中)      │
│  → 注入 <memory-guide> 到   │        │                      │
│    system 前缀（OptMem 式）  │        │                      │
└─────────────────────────────┘        └──────────────────────┘
```

实际的 recall/观察机制由两部分组成（插件观察捕获 + daemon 事件驱动注入）：

| 环节 | 时机 | 实现 |
|------|------|------|
| ① 观察捕获 | 用户消息 / 工具执行后 / text.complete / reasoning.ended / tool.failed | 插件 hooks（`src/plugin.ts`）→ `POST /api/obs/capture` 写 t1_observations |
| ② 边界 recall | **每次 LLM 调用前**（messages.transform 在 agentic 循环内；增量游标使同 turn 后续 step 近似幂等） | 插件调 `GET /api/recall/context` → `<recall>` 指针块 |
| ③ 步进注入 | `message.part.updated` 中 `part.type === 'step-finish'` + `session.idle` 事件 | daemon（gateway `index.ts` StepInject）→ 高价值记忆注入 |
| ④ 聚合压缩 | cron 每小时（turn-compress 规则） | turnCompress pipeline → per-session worker → `mafw_add_memory` |

**职责分工：** Plugin = 两个 transform 注射口。Daemon = gateway 事件流订阅四拍信号。
聚合压缩/反思 worker 的 LLM 模型由 `config.recall.workerModel` 固定（默认 `xiaomi/mimo-v2.5`），per-message 传入；已存在的 worker session 下一次 prompt 即生效，无需重建。
- 为复用前缀缓存、降低 token 成本，worker session 在 idle 达到 `config.recall.workerCompactIdleMs`（默认 8h）后，下一次 prompt 会先调 opencode 的 `session.summarize` 做 compaction；summarize 失败则直接 dispose 轮换（下次 prompt 重建新会话）。
- xiaomi provider 可在 opencode 配置里开 `options.setCacheKey: true`，让请求带上 `promptCacheKey` 以便命中缓存（对端点是否生效取决于小米 API）。

### 5.12 注入点收敛

所有注入路径统一使用 `gateway/src/recall/inject-format.ts` 的 `formatRecallContext()` 渲染：

| 路径 | 注入物 | 格式 |
|------|--------|------|
| `experimental.chat.messages.transform` | pointer 块（`<recall>`） | 尾部，per-turn |
| `experimental.chat.system.transform` | 记忆操作引导（`<memory-guide>`，OptMem 式） | 前部，常驻 |
| `withMemoryInjection()` | deltas + facts + recall | 全量，每次 promptAsync |
| `/api/chat/enriched` | deltas + facts + recall | 全量，首次会话创建 |

pointer 块与全量内容块分别收敛在 `inject-format.ts` 的 `formatRecallContext()` / `renderMemoryBlocks()`。

### 5.13 主动记忆引导（OptMem 式）

**无独立于谐波记忆的通道**。所有记忆（含用户约束/偏好）都存谐波系统；`<memory-guide>` 常驻 system，让 agent **主动操作**记忆系统（参考 [OptMem](https://github.com/VictorTaelin/OptMem)）：

```
<memory-guide>
## 记忆
你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。
不主动记录，你将无法记得过去的决定、偏好与教训。

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的坑
  → 调用 mafw_add_memory（选择 semantic/episodic/procedural，附 cueAnchors）
- 不写冗余记忆

### 需要旧记忆：主动检索
- 新任务开始、或不确定此事是否已知 → 调用 mafw_search_hybrid 检索

### 子代理
子代理不得调用 mafw_add_memory / mafw_search_hybrid（防重复写入），由父会话统一管理
</memory-guide>
```

- 实现：`src/hooks/memory-guide.ts`，经 `experimental.chat.system.transform` 每轮注入（常驻）
- 被动注入（chat 开头 recall / tool-calls 增量 / step-ended 注入）保留，与主动引导互补：被动 = 系统帮你想起，主动 = agent 自己管理
- 旧 `.mafw/constraints.json`（pinned 约束独立通道）已废弃：启动时自动迁移为谐波记忆（semantic、energy 0.9）并改名 `constraints.migrated.json` 备份（幂等，`gateway/src/recall/constraints-migrate.ts`）

### 5.13a 数据目录与统一数据库

**MAFW 数据根固定为 `os.homedir()/.mafw`**（`config.resolvePath()`，与启动 cwd / MAFW_PROJECT_DIR 完全解耦；`paths.mafwDir` 配置覆盖失效）。启动时自动迁移 gateway 包目录旁的旧数据（`gateway/src/recall/data-dir-migrate.ts`，幂等，删除旧位置）——注意迁移源是 `<gateway包>/../.mafw`，**不是** project-relative `.mafw`；插件侧仍会在项目目录重建 `.mafw/`（日志与请求文件等）。

**统一数据库 `~/.mafw/memory/gateway.db`**（`GatewayDatabase`，`gateway/src/memory/gateway-db.ts`）：
- `t1_observations`：回合观察（插件经 `/api/obs/capture` 写入，turnID 网关分配，UNIQUE 去重）
- `kv_store`：易失关键小状态——
  - `manager-session`（key=projectDir，**per-project manager session**，替代旧 manager-session.json）
  - `reflect-cursor`（key=sessionID，反思增量游标）
  - `registry/snapshot`（注册表快照，权威仍在 `scheduler/registered-projects.json`）
- 旧 t1.db / manager-session.json / recall-reflect-cursor.json 启动时自动回填并入库后删除（`gateway/src/recall/gateway-db-migrate.ts`，幂等）
- `GET /api/manager/session` 返回全部项目的 manager session 列表（`?projectDir=` 过滤单条）

**聚合压缩（memory:turnCompress，每小时）**：每活跃 session 将本小时所有完成回合合并为一份 batch transcript，交给该 session 的**持久 worker 会话**，由 agent **自主调用 `mafw_add_memory`** 记录值得长期记忆的条目（类型按内容自选）。处理过的回合**一律删除**（空/失败不重试）。内部 worker 会话经 `/api/obs/capture` 的会话白名单过滤——**输出永不回流 T1**（防递归）。

### api/recall/context endpoint

```
GET /api/recall/context?sessionID=xxx&query=xxx
Response: { pointers: string|null }
```

- v0：同步 HarmonicIndexManager.search(query, 3) → formatRecallContext()
- fail-open：超时/错误返回 `{ pointers: null }`，不阻塞 LLM 流程
- 已推送记忆过滤：路径 1（step-ended 注入）登记过的记忆 ID 不再通过本端点重复暴露
- 未来：daemon 预计算好注入载荷，endpoint 读快照 ~1ms

### 5.14 Media 接入（A2A Media Agent，pi 引擎 · 多模态）

纯文本/多模态推理模型通过 **A2A 协议**（Agent2Agent v1.0）与 gateway 内置的
**Media Agent** 多轮协作分析 **图片 / 视频 / 音频**。**推理 Agent（LLM）主动驱动**，
MAFW 插件仅作为 A2A 客户端执行。媒体分析引擎是 **pi-coding-agent**
（`@earendil-works/pi-coding-agent`，进程内 SDK 嵌入），模型经每模态配置指定
（默认 `xiaomi/mimo-v2.5`，直连小米 API，认证复用 opencode auth.json 的凭据）。

```
MafwShell（桌面前端）                           Gateway 进程（3000）
  粘贴/上传图片/视频/音频 → POST /a2a SendMessage  gateway/src/media/media-agent.ts
    parts: [{raw: 媒体base64}, {text: 问题}]       ├─ A2A JSON-RPC（@a2a-js/sdk v1.0.1）
  → 消息只发文本指针                               ├─ POST /a2a、/.well-known/agent-card.json、
    [媒体附件 taskID: x contextID: y（媒体: 名）]   │  /a2a/artifacts/<id>（loopback-only）
                                                  ├─ TaskStore + ArtifactStore（LRU 500 + TTL 24h）
opencode LLM（推理 Agent）                       └─ MediaService → pi adapter → 模型（每模态可配）
  看到指针 → 自主调用 mafw_media_ask                └─ gateway/src/media/pi-adapter.ts
    src/tools/media-ask.ts（插件 tool，A2A client）    ├─ pi-coding-agent（ModelRuntime，进程内 SDK）
      ├─ GetTask { id: taskID } → contextId          ├─ 认证：opencode auth.json 的 provider key
      └─ SendMessage { contextId, referenceTaskIds:    │  （setRuntimeApiKey 运行时注入，不落盘）
           [taskID], parts: [{text: question}] } → 追问  └─ fixMediaPayload（onPayload 钩子）
    返回：媒体回答 + 新 taskID（继续追问用新 ID，媒体不重传）
```

要点：
- **纯 A2A，无 MCP、无 transform 自动转发**：追问由推理 Agent 自主决策（调用
  `mafw_media_ask` 工具）；媒体只上传一次（raw FilePart），追问经
  `referenceTaskIds` 引用前序任务，每轮是一个新任务（同步模型下任务即时终结）
- **多模态（image / video / audio）**：MediaAgent 的 `SUPPORTED_INPUT_MODES` 为
  `['text','image','video','audio']`，按 mediaType 白名单路由；大小上限：
  image ≤20MB / video ≤50MB / audio ≤25MB（超限显式失败）
- **媒体原生进入主模型**（非"描述注入文本模型"）：媒体作为 PiAiImage carrier
  （`{type:'image', data: base64, mimeType: video/mp4|audio/...}`）交给 pi；
  pi 的 openai-completions 序列化器输出 `image_url`，**fixMediaPayload**
  （`gateway/src/media/pi-adapter.ts`，派生自 pi-multimodal-proxy 的
  fixVideoAudioPayload，MIT）在 `onPayload` 钩子里重写 wire format：
  - `video/*` → `{type:'video_url', video_url:{url}}`（小米视频格式）
  - `audio/*` → `{type:'input_audio', input_audio:{data:url}}`（小米音频格式，
    data 为整串 data URI）
  主模型（如 xiaomi/mimo-v2.5）直接分析媒体，`video_tokens`/`audio_tokens`
  真实计入（实测验证）
- **每模态独立模型**：gateway `media:` 配置段——`provider`/`model`（默认
  xiaomi/mimo-v2.5）+ `image/video/audio` 每模态 `{provider?, model}` 覆盖；
  经 pi 的 `getModel(provider, modelId)` 解析；桌面 Config 页可编辑
- **认证复用 opencode**：key 从 `~/.local/share/opencode/auth.json` 按 provider
  读取（opencode 里 connect 即可），`setRuntimeApiKey` 运行时注入，无独立
  MAFW API key
- **CJS/ESM 桥**：gateway 编译为 CJS，pi-coding-agent 是 ESM——pi-adapter 通过
  `new Function('spec','return import(spec)')` 运行时动态导入（tsc 会把普通
  `import()` 降级为 require，require ESM 包会抛错）
- 工具描述强化 LLM 可读性：触发条件（会话存在 `[媒体附件]` 指针）、taskID 从
  指针提取、返回含新 taskID；`ToolResult` 结构化
  `{ title, output, metadata: { taskID, newTaskID } }`
- 错误处理：GetTask TaskNotFound / SendMessage 失败 / 任务 FAILED / gateway 不可达
  → 显式错误文本，不抛异常不崩会话
- **标准 opencode（无桌面端）完整可用**：
  - 入口 A：`src/hooks/media-ingest.ts`（transform）——粘贴图片/视频/音频
    自动建任务并替换为文本指针；`MEDIA_INGEST=off`（兼容 `VISION_INGEST=off`）可关
  - 入口 B：`mafw_media_upload` 工具——LLM 主动上传本地媒体路径建任务
  - 追问：`mafw_media_ask`；指针 `[媒体附件 taskID: x contextID: y（媒体: 名）...]`，
    幂等兼容旧 `[视觉附件` 前缀；参数 `mediaPath`
- 安全：`/a2a` 系列端点 loopback-only（403 拒绝非本机）；Artifact id 为 uuid 不可猜；
  FilePart `url` 只接受本 agent 工件引用（SSRF 防护）
- 前端（MafwShell）媒体附件 → `window.api.mafw.media.createTask` → 文本指针；
  图片走 canvas 下采样，视频/音频直读 dataUrl
- 工具清单：`mafw_media_upload`（建任务，返回指针 + taskID）、`mafw_media_ask`
  （追问，返回回答 + 新 taskID）；旧名 `mafw_vision_upload`/`mafw_vision_ask` 已移除
- 测试：`tests/unit/gateway/pi-adapter.test.ts`（fixMediaPayload 单测 + adapter 边界）、
  `media-service.test.ts`（PromptFn 抽象隔离）、`media-agent.test.ts`（A2A 四模态）

#### 5.14a Media Engine 插件系统

媒体分析引擎可插拔：用户往 `~/.mafw/media-plugins/` 丢 `.js` 文件即可替换/新增某模态的分析引擎。
`MediaPluginLoader`（`gateway/src/media/media-plugin-loader.ts`）扫描/热加载/fail-open，
`MediaService.resolvePrompt(kind, cfg)` 按模态路由到插件引擎或默认 pi。

**两种插件形态**（CJS `module.exports`）：

```js
// 形态 A：完全自定义引擎（不经 pi，直接 HTTP 调用）
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],
  async createPrompt(ctx) {
    return async (parts, opts) => { /* 返回分析文本 */ };
  },
};

// 形态 B：复用 pi 运行时，只换 wire 格式修复器
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) { /* 自定义改写，返回 undefined 表示不修改 */ },
};
```

**ctx**（`gateway/src/media/plugin-context.ts`）：`apiKey(name)` / `fetch(url, opts)`（60s timeout）/
`pluginConfig(name)`（读 `config.media.pluginConfig`）/ `log`。

**config 路由**（per-modality 覆盖全局）：
```yaml
media:
  engine: pi              # 默认引擎
  video:
    engine: qwen-vl       # video 模态走插件
  pluginConfig: {}        # 插件自定义配置
```

**HTTP API**：`GET /api/media/plugins`（状态列表）、`POST /api/media/plugins/reload`（手动重载）。
校验失败 fail-open（状态记 error，不影响其他插件与默认 pi）。
`pi-adapter` 的 `fixPayload` 现为可选 dep（默认 `fixMediaPayload` 小米格式），插件可覆盖。
缓存 key 含 engineName 防同模型不同引擎串缓存。
测试：`tests/unit/gateway/media-plugin-loader.test.ts`（11 例）、`media-service.test.ts` resolvePrompt 路由（4 例）。

### 5.15 OpenCode Serve Sidecar（自监管）

opencode serve（4096）由 gateway 以 **sidecar 子进程**方式直接监管
（`gateway/src/serve-sidecar.ts`，替换 SDK `createOpencodeServer` 封装）：

- **spawn 契约与 SDK 完全一致**：`createOpencodeServer` 内部使用 cross-spawn、
  `opencode serve --hostname=127.0.0.1 --port=4096`、env `OPENCODE_CONFIG_CONTENT="{}"`、
  就绪信号 stdout `opencode server listening on <url>`（超时 5s 树杀报错）
- **健康轮询监督**：SDK 不暴露子进程/exit 回调，**owned 与 adopted serve 都走 watchdog**：
  每 30s 探测 `/global/health`，连续 3 次失败 → `recoverServe()` 重启并**重订阅事件流**
  （SSE 建立在 serve 之上，进程重启后必须重连，否则自动化触发器和桌面 SSE 转发全部静默失效）
- **退避策略**：连续崩溃 streak 1/2/3 次 → 0/5s/15s 快速重试；≥4 次 → 5min 间隔；
  streak 仅在 serve 稳定运行 60s 后清零（防 flapping 热重启）
- **adopted 场景**：gateway 崩溃后孤儿 serve 存活，新 gateway 启动时
  `isServeHealthy()` 探到则**收养**（不重新 spawn），watchdog 同上
- **恢复动作收敛**：共用 `recoverServe()` = `killProcessOnPort(4096)` + `startServe()` + `subscribeToEvents()`
- 外部 serve 模式（`MAFW_SERVER_SERVE_URL`）不监管（用户管理的进程）
- serve 的 stdout/stderr **不被 SDK 暴露**，因此**不写入** `[Serve]` 前缀日志；诊断依赖 watchdog 的 "Serve unhealthy" / recovery 日志
- 经验：子进程型依赖必须配监督（检测点不能在启动时一次完事）；恢复动作必须完整
  （重启进程 ≠ 恢复连接，事件订阅要一并重连）

### 5.16 自更新（Self-Update，不依赖 desktop）

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
  注入 `[MAFW SYSTEM] 自更新已完成...`（同会话自动续跑）；兜底通知各项目
  manager session；失败 → `notified:false` + 被动续跑（agent 读 last-restart.json）
- **记录**：`~/.mafw/last-restart.json`（reason/commit/requestedAt/sessionID/notified）
- 等价入口：`mafw update` CLI（写同一令牌；无会话上下文 → manager 兜底通知）
- 非目标：git 远端拉取（无 remote）、定时自动更新、进程内热替换（重启 ~2-3s，
  文档声明中断窗口）；dev 模式自举以 dist 为准
- agent 操作手册：`.opencode/skills/mafw-gateway-restart/SKILL.md`（七步流程）

### 5.17 持久 Python 内核（Prime Agent 同款 Jupyter kernel）

给 agent 一个会话级持久 Python 环境（变量/导入/数据跨工具调用保持），Prime Agent
（`packages/coding-agent/src/core/kernel/`）同款架构：

```
opencode LLM                              Gateway（3000）                  .venv-pykernel
  mafw_python { code } ──→ POST /api/python/execute ──→ KernelService ──ZeroMQ──→ ipykernel_launcher
    （ToolContext.sessionID 定位内核）        ├─ session→kernel Map           ├─ 标准 Jupyter 协议 5.3
  mafw_python_restart    ──→ /restart        ├─ Mutex 串行队列（防并发踩踏）   ├─ allow_stdin:false
                                             ├─ 崩溃检测→自动重启+提示        └─ matplotlib 附件（display_data）
                                             └─ TTL 1h 闲置回收
```

要点：
- **`gateway/src/python/kernel-service.ts`**：Jupyter wire 协议（ZeroMQ Dealer/Subscriber，
  HMAC 签名按 jupyter_client 的 `json.dumps` 分隔符 + `ensure_ascii=False` 字节序列化）；
  `execute` 收集 stdout/stderr/execute_result/display_data（matplotlib 图→base64 附件）/
  error{traceback}；输出 cap 65536 + `truncated` 标记；超时→control 通道 interrupt；
  崩溃（exit 事件）→ 标记 dead → 下次调用自动重启并返回 `kernelRestarted: true`
- **Windows 陷阱**：`child.kill('SIGKILL')` 无效 → `taskkill /F /T` 兜底；zeromq receive
  用 `Promise.race` 超时会留下"幽灵 receive"吞消息 → 同一时刻只挂一个 receive、
  超时仅做检测（有 pending 才判死）；循环用 `socket === this.iopub/shell` 判断
  被替换（重启后旧循环静默退出）
- Python 环境：`.venv-pykernel`（专用，ipykernel/numpy/pandas/matplotlib），
  `MAFW_PYTHON_BIN` 可覆盖
- 安全：loopback-only；无沙箱（本机可信场景）；TTL 1h 回收 + 停机清理
- 引导：工具描述强化（数据分析/统计/多步计算 → 用 mafw_python 而非 bash python -c）+
  `bash-python-guide` hook 检测长 python 内联脚本注入温和提示（每会话一次）
- 测试：kernel 集成套件需 `--runInBand --forceExit`（真实内核 + zeromq handle 残留）

### 5.18 Manager Agent 权限（对齐 plan + gateway MCP 白名单）

manager agent 定义在 `~/.config/opencode/agent/manager.md`（`ensureManagerAgentConfig` 每次启动
覆盖写入，模板见 `gateway/src/skills/manager-agent-config.ts`）：

- **`edit: {"*": "deny"}`**：禁用 edit/write/apply_patch（不能直接改文件/代码）——与内置 plan 对齐
- **`task: {"general": "deny"}`**：不派发 opencode 子任务（委派走 `mafw_set_goal` MCP 工具）
- **bash 默认 allow**：执行命令不受限（自更新等流程经 bash 通道；与 plan 同级）
- **gateway MCP 工具显式 allow**：35 个 `mafw_*` 工具白名单（`mafw_set_goal`/`mafw_update_state`/
  `mafw_ask_user`/记忆/自动化/桌面控制等）——opencode 权限按工具名匹配，`edit` deny 不影响
  MCP 工具；显式 allow 防未来 defaults 收紧（如 `"*": "ask"`）时误伤
- 机制依据：opencode `permission/index.ts` 的 `disabled()`——仅 `edit/write/apply_patch` 映射到
  `edit` key，其余工具用工具名作 permission key
- 自更新影响：manager 不能 edit 文件 → SKILL.md 要求自更新全流程用 bash 命令执行（bash 默认允许）

### 5.19 Runtime 能力契约（多 runtime 接缝）

gateway 与 agent runtime 之间是**能力自声明契约**（`gateway/src/runtime/`）：

- `contract.ts` — `RuntimeCapabilities`（sessionApi/promptWhileBusy/eventStream/
  nativeApprovals/providerConfigApi/perLlmCallTransform/sessionStorageApi/agentConfigApi）
  + `RuntimeClient` 接口面 + `AgentRuntime`。能力分级：Tier 0（协作协议 + per-turn 记忆）
  → Tier 1（+ 自治执行 + per-step 记忆）→ Tier 2（+ 桌面完整，opencode 形状 DTO 归一化输出）
- `normalize.ts` — runtime 原生事件 → `EventFacets`（正交切面：step/chatSignal/
  broadcast/toolCommand）；opencode 版本知识（≥1.18 step-finish part 结算）只存在于
  本文件和 step-inject.ts 的两个 helper
- `opencode-runtime.ts` — 内置恒等实现（全能力，`external` 跟随 MAFW_SERVER_SERVE_URL）；
  内含 opencode 专属实现：SQLite session 存储（`sessionStorageApi`）、auth.json 凭据
  （`credentials`）、agent frontmatter 序列化（`agents.install`）
- `agent-definition.ts` — 运行时中立的 `AgentDefinition` 模型（description/mode/model/
  systemPrompt/permissions），各 runtime 翻译为自己的配置格式
- `loader.ts` — `~/.mafw/runtime-plugins/*.js` 插件加载（CJS `module.exports =
  { name, capabilities, createRuntime(ctx) }`，fail-open，无热加载；能力声明覆盖在
  Tier-0 基线之上）

**可选能力与接口扩展：**
- `external?: boolean` + `getBaseUrl(): string` — runtime 声明托管模式；`external=true`
  时 gateway 不 spawn/不 kill，watchdog 仅健康探测 + 事件流重连
- `credentials?: { getApiKey(provider): string | null }` — 凭据获取；media 服务优先走
  runtime credentials，回退直读 auth.json
- `sessionStorageApi?: boolean` + `session.listByDirectory?(dir, limit)` — 直读 runtime
  私有存储列出会话；缺失时回退 `session.list` + 客户端目录过滤
- `agentConfigApi?: boolean` + `agents?: { install(name, definition); remove?(name) }` —
  agent 定义安装；缺失时跳过 + warn 日志（manager 功能降级但不崩）

激活插件：`config.yaml` 的 `runtime.plugin: <name>`（或 `MAFW_RUNTIME_PLUGIN`）；
未配置/加载失败一律回退内置 opencode。可观测：`GET /api/runtime` 返回当前
runtime 能力集 + 插件扫描状态。能力门：缺能力的 runtime 对应端点 503、
事件订阅跳过，不崩溃。

宿主插件侧（runtime 进程内的 transform/工具注册）是每个 runtime 单独交付物，
不在本契约内；gateway 侧 HTTP（/api/obs/capture、/api/recall/context、/a2a）
对宿主插件保持 runtime 中立。

**内置插件：pi-coding-agent runtime（`gateway/src/runtime/plugins/pi-runtime.ts`）**
- `config.runtime.plugin: pi` 激活；进程内 SDK 嵌入（ESM 桥 `new Function('spec','return import(spec)')`）
- 能力：sessionApi/promptWhileBusy/eventStream/providerConfigApi true；nativeApprovals/sessionStorageApi/agentConfigApi false（Phase 3 待办）
- 认证链：`ctx.credentials.getApiKey` → auth.json 回退 → ModelRuntime.setRuntimeApiKey（单例共享）
- 会话：`PiSessionRegistry`（Map<sessionID, AgentSession>，忙时 followUp 队列）
- 事件：`PiEventStream`（subscribe → RawRuntimeEvent → normalize.ts 四信号 session.idle/session.error/message.part.updated/message.updated）
- external=true：gateway 不 spawn；外部 runtime 的事件订阅与 serveReady 解耦（不等 opencode serve）
- 媒体 agent 消费 AgentRuntime（Phase 2，见 `docs/superpowers/specs/2026-08-27-pi-runtime-design.md`）

## 6. Gateway 运维

### 6.1 CLI 命令
Gateway 唯一运维入口是 `mafw` CLI，用 `npm install -g` 全局安装或 `npx mafw` 使用：

```bash
# 进程管理
mafw status            # 查看运行状态
mafw start             # 前台启动
mafw daemon            # 后台启动
mafw stop              # 停止
mafw restart           # 重启前台（stop + 1s + start）

# 日志和诊断
mafw logs              # 看最后 50 行
mafw health            # HTTP 健康检查
mafw stats             # gateway 统计

# 项目/Goal 管理
mafw projects          # 已注册项目
mafw goals             # 活跃 Goal
mafw register <dir>    # 注册项目

# 其他
mafw config            # 当前配置
mafw dashboard         # 打开 Web Dashboard
mafw version           # 版本号
```

### 6.2 日志路径
Gateway 的 console.log/warn/error 自动写入文件：
- `~/.mafw/logs/mafw.log` — 文件日志（daemon 模式下也用这个）
- 5MB 自动轮转，格式 `[ISO时间] [LEVEL] 消息`
- Error 对象在日志中需要用 `err.message` 而非 `err`（JSON.stringify Error → {}）

### 6.3 重启注意事项
- Restart 前会自动 kill 旧进程（基于 PID 文件）
- 如果旧进程是非 CLI 启动的，先 `mafw stop` 再 `mafw start`

### 6.4 构建、安装与发布

```bash
npm run build                 # 构建 plugin + gateway
npm pack                      # 打包为 .tgz（324 kB）
npm install -g opencode-plugin-mafw-4.1.0.tgz    # 全局安装
mafw version                  # 验证安装
```

发布后用户只需 `npm install -g opencode-plugin-mafw` 即可使用 `mafw` CLI。

**完整重装流程（清旧 + 构建 + 安装）：**
```bash
npm run build
npm pack
npm install -g opencode-plugin-mafw-*.tgz     # 覆盖旧版本
```

**注意事项：**
- 全局安装路径可通过 `npm config get prefix` 查看
- 安装后 `mafw` 命令在 PATH 中，如果 shell 找不到请刷新 PATH（新开终端或重启 shell）
- `.npm-global` 路径下的文件名为 `mafw`（无后缀）、`mafw.cmd`、`mafw.ps1`，对应不同 shell

Desktop 构建需要先 `cd opencode-dev/packages/desktop && npm install`（workspace 解析 `@mafw/sdk` 到 `packages/gateway-sdk/`）。

### 6.5 HTTP 路由注意事项
Gateway API 路由使用正则匹配，query string 会导致 `$` 锚定不匹配：
- 正确：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)`
- 错误：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages$/)`（不匹配 `?limit=100`）

## 7. LongMemEval 记忆基准（evaluation/longmemeval/）

基于 LongMemEval (arXiv:2410.10813, ICLR 2025) S 集（500 题，6 类，~50 haystack sessions/题）的谐波记忆质量评测。TS runner 直接 import gateway 类，`fs.mkdtempSync` 隔离 HarmonicUnitFileStore，**不污染**真实 `~/.mafw`，不需启动 gateway 实例。

**两层**：
- **L1 检索层**：`ingest` 灌入 → `HarmonicIndexManager.search(question, k)` → `recall@k / ndcg@k`（per-session 对 `answer_session_ids`）
- **L2 阅读层**：L1 top-k 记忆 + reader LLM → judge LLM（per-type prompt，0/1）

**关键发现（baseline，48 题子集，session 粒度，frozen energy）**：
- Phase 2：总体 R@10 = 47.4% → **94.9%**（bm25 检索器）；R@5 = 28.1% → 93.2%；R@1 = 5.8% → **58.6%**
- **session 粒度优于 round**（0.474 vs 0.277）
- L2 QA accuracy：token+openrouter 基线 16.7% → bm25+mimo-v2.5(xiaomi) **58.3%**；Phase Q 加来源标记/排序 ablation 后进一步到 **64.6% (date order) / 66.7% (rank order)**
- multi-session / preference 仍是短板（0.375），需 Phase M 语义层
- 生产默认检索器已切为 **bm25**（Phase R），`token` 仍可通过 `MAFW_SEARCH_RETRIEVER=token` 回退

**设计决定（README 也写了）**：
- 能量默认冻结 0.8（保可复现），`realistic` 模式以 `question_date` 为基准算 0.005/天衰减
- 摄入时 haystack 全文入 `primary_abstraction`，对应"检索器只看 primary_abstraction + cue_anchors" 的事实
- judge prompts 是近似移植（GitHub / HF 直连不通，未拉取官方版），下次获取官方 prompts 请替换 `evaluation/longmemeval/src/judge-prompts.ts`

**运行**（详见 `evaluation/README.md`）：
```bash
# 数据下载（需 hf-mirror.com 可访问）
curl -L -o evaluation/longmemeval/data/longmemeval_s.json \
  https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

# L1 检索层
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session

# L2 阅读层（reader + judge）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l2-qa.ts \
  --l1Run evaluation/longmemeval/results/<ts>/l1-run.jsonl \
  --reader meta-llama/llama-3.1-8b-instruct \
  --judge meta-llama/llama-3.1-70b-instruct \
  --apiUrl https://openrouter.ai/api/v1/chat/completions \
  --apiKeyProvider openrouter
```
