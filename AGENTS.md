# MAFW Gateway & Plugin 架构

## 1. 谐波记忆系统

### 3.1 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  goal_id: string | null;
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;    // 6-8 词核心摘要
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // v6.4: 0.5~1.5
  abstraction_level?: number;     // v6.4: 0=T1, 1=T2, 2=T3/T4, 3=L5
  review_count?: number;          // v6.4: 复习次数
  last_reviewed?: string;         // v6.4: 上次复习
  top_associations?: string[];    // v6.4: 联想预取
  merged_from?: string[];
  created_at: string;
  updated_at: string;
}
```

### 3.2 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → BM25 扫描 .harmonic_index.json（无视 memory_type）
     → 按 energy × BM25 排序
     → 按需从 tier 文件加载完整 memory_value
     → 联想预取 top_associations
```

### 3.3 压缩

`HybridCompressor.compress()` 输出 `HarmonicUnit` 并自动：
1. 计算显著度
2. 写入对应 tier 文件
3. 更新 `.harmonic_index.json`
4. 触发 MinHash 跨层合并检查

## 4. Tools 清单（v6.8 总共 14 个）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | BM25 + RRF 谐波检索 + 联想预取 |
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

## 5. v6.8 新增系统

### 5.1 统一配置管理
- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值
- 所有端口/URL/超时/路径集中在 `gateway/src/config.ts`
- 环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）

### 5.2 记忆与 Goal 解耦
- `HarmonicUnit.goal_id` 可选 —— 记忆不绑定任何 Goal
- 所有 Hooks 在无 goal 上下文时照常运行
- `askUser`/`recordFeedback` 存储路径扁平化（不再按 goal 分目录）
- `CostEstimator.ToolCallRecord.goalId` 改为可选

### 5.3 记忆融合系统（git worktree）
- `mafw_merge_memory` MCP 工具：MinHash 比对，提取独有记忆（energy=0.4）
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` 在 git merge 前调用 `mergeMemoryFromWorktree()`
- 融合记录写入 `.mafw/fusion-log.jsonl`
- CLI 命令：`/worktree-list`、`/worktree-prune`、`/merge-memory`

### 5.4 文件日志系统
- `installFileLogging()` 劫持全局 `console.log/warn/error`
- 所有插件/Hooks/Skills 输出自动写入 `.mafw/logs/mafw.log`
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
│  → 注入指针块到 messages 尾部│        │ → {pointers,constraints}│
│                             │        │                      │
│ experimental.chat.system    │        │ .mafw/constraints.json│
│  .transform                 │        │ (pinned 约束块)       │
│  → 注入约束块到 system 前缀  │        │                      │
└─────────────────────────────┘        └──────────────────────┘
```

四个 recall beat 通过官方 hook 覆盖（零 fork patch）：

| Beat | 时机 | Hook |
|------|------|------|
| ① | 用户消息到达 | `chat.message`（daemon 信号） |
| ② | LLM 推理→tool-call | `tool.execute.before`（并行执行） |
| ③ | 工具执行完毕 | `tool.execute.after`（结果合并） |
| ④ | 回合结束 | `event`（`session.idle`）（daemon） |

**职责分工：** Plugin = 两个 transform 注射口。Daemon = gateway 事件流订阅四拍信号。

### 5.12 注入点收敛

所有注入路径统一使用 `gateway/src/recall/inject-format.ts` 的 `formatRecallContext()` 渲染：

| 路径 | 注入物 | 格式 |
|------|--------|------|
| `experimental.chat.messages.transform` | pointer 块（`<mafw-recall>`） | 尾部，per-turn |
| `experimental.chat.system.transform` | constraint 块（`<mafw-constraints>`） | 前部，常驻 |
| `withMemoryInjection()` | deltas + facts + recall | 全量，每次 promptAsync |
| `/api/chat/enriched` | deltas + facts + recall | 全量，首次会话创建 |

所有路径通过同一 `formatRecallContext()` 渲染，格式收敛在 `inject-format.ts`。

### 5.13 Pinned 约束存储

用户约束独立存储在 `.mafw/constraints.json`，不经过谐波系统：

```
.mafw/constraints.json:
["user prefers self-hosted deployment over SaaS",
 "user is allergic to nuts"]
```

特点：
- 文件 JSON 数组，每条一个字符串
- 只读不自动操作（不受 MinHashMerger/EnergySystem/AbstractionDistiller 影响）
- 每次 `/api/recall/context` 请求时读取，注入 `<mafw-constraints>` 块
- 来源：④ 写回路捕获用户显式陈述

### api/recall/context endpoint

```
GET /api/recall/context?sessionID=xxx&query=xxx
Response: { pointers: string|null, constraints: string|null }
```

- v0：同步 HarmonicIndexManager.search(query, 3) → formatRecallContext()
- fail-open：超时/错误返回 `{ pointers: null, constraints: null }`，不阻塞 LLM 流程
- 未来：daemon 预计算好注入载荷，endpoint 读快照 ~1ms

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
