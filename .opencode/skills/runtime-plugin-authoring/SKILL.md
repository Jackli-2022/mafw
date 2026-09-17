---
name: runtime-plugin-authoring
description: 为 MAFW Gateway 编写 Runtime 插件的完整指南。覆盖能力契约（Tier 0/1/2）、CJS 插件格式、事件归一化、记忆系统接入（观察捕获/边界 recall/MCP 主动记忆）、可选接口、激活与测试。当需要接入新的 agent runtime（如 pi-coding-agent、claude、自定义 LLM 服务）时使用此 skill。
---

# MAFW Runtime Plugin 编写指南

## 概述

MAFW Gateway 通过**能力契约**（Runtime Capability Contract）与 agent runtime 解耦。插件是一个 CJS `.js` 文件，放在 `~/.mafw/runtime-plugins/` 目录下，声明自己支持的能力等级，gateway 按能力集自动开关功能。

**核心原则：**
- **能力自声明**：插件声明能力，gateway 按能力降级（缺能力 → 503 或跳过，永不崩溃）
- **Fail-open**：插件加载/运行失败 → 自动回退到内置 opencode runtime
- **运行时热切换**：`POST /api/runtime/switch` 可在进程内热切换 runtime（无需重启）；插件文件修改后需 `POST /api/runtime/reload` 重扫或重启 gateway

## 第一步：理解能力分级

### Tier 0（基线，所有插件自动获得）
| 能力 | 说明 |
|------|------|
| `sessionApi` | 会话 CRUD（create/prompt/messages/get/delete/abort/list） |
| `promptWhileBusy` | 会话忙碌时仍可追加输入（promptAsync） |

Tier 0 是 `minimalCapabilities()` 默认值，插件无需声明即可获得。

### Tier 1（自治执行）
| 能力 | 说明 | 缺省行为 |
|------|------|----------|
| `eventStream` | SSE 事件流订阅 | 跳过事件订阅，无自治触发 |
| `nativeApprovals` | 原生审批 UI | 4 个审批端点返回 503 |
| `providerConfigApi` | Provider 配置管理 | 4 个 provider 端点返回 503 |
| `perLlmCallTransform` | 每次 LLM 调用的 transform | 跳过 transform 注入 |

### Tier 2（桌面完整）
| 能力 | 说明 | 缺省行为 |
|------|------|----------|
| `sessionStorageApi` | 直读 runtime 私有存储列出会话 | 回退 `session.list` + 客户端过滤 |
| `agentConfigApi` | Agent 定义安装 | Manager agent 安装跳过（warn 日志） |

**选择指南：**
- 仅协作对话 → Tier 0 即可
- 需要自动化/事件驱动 → 加 `eventStream`（Tier 1）
- 桌面聊天完整体验 → 加 Tier 2 能力

## 第二步：编写插件文件

### 文件位置
```
~/.mafw/runtime-plugins/my-runtime.js
```

### CJS module.exports 形状

```javascript
// ~/.mafw/runtime-plugins/my-runtime.js
module.exports = {
  // 必需：唯一标识符（用于 config.yaml 激活）
  name: "my-runtime",
  
  // 可选：声明超出 Tier-0 基线的能力（与 minimalCapabilities() 合并）
  capabilities: {
    eventStream: true,        // Tier 1：需要事件流
    nativeApprovals: false,   // 不需要原生审批
    providerConfigApi: false, // 不需要 provider 管理
    perLlmCallTransform: false,
    // 可选能力（不在 Tier 分级内）：
    sessionStorageApi: false, // 无直读存储
    agentConfigApi: false,    // 无 agent 安装
  },
  
  // 可选：默认 true（gateway 不 spawn 进程）
  // 设为 false 仅当你需要 gateway 启动/监管 runtime 进程
  external: true,
  
  // 必需：工厂函数，接收 RuntimePluginContext，返回 AgentRuntime
  async createRuntime(ctx) {
    // ctx 提供的工具：
    // - ctx.fetch(url, opts)  — 带 60s 默认超时的 fetch
    // - ctx.log               — gateway 日志器
    // - ctx.pluginConfig(name) — 读取 config.yaml 的 pluginConfig 段
    
    return {
      name: "my-runtime",
      capabilities: { /* 同上 */ },
      
      // ─── 必需：会话 API（Tier 0）──────────────────────
      session: {
        async create(opts) {
          // opts: { directory?: string }
          // 返回: { id: string, ... }
          const res = await ctx.fetch('http://localhost:8080/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts),
          });
          return res.json();
        },
        
        async promptAsync(opts) {
          // opts: { sessionID, parts?, message?, agent?, model?, variant?, system?, noReply? }
          // 返回: void 或 { error?, response? }
          await ctx.fetch(`http://localhost:8080/sessions/${opts.sessionID}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts),
          });
        },
        
        async prompt(opts) {
          // 同步等待回复
          // 返回: { parts: any[], ... }
          const res = await ctx.fetch(`http://localhost:8080/sessions/${opts.sessionID}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts),
          });
          return res.json();
        },
        
        async messages(opts) {
          // opts: { sessionID, limit?, before? }
          // 返回: { data: any[], nextCursor?: string }
          const res = await ctx.fetch(
            `http://localhost:8080/sessions/${opts.sessionID}/messages?limit=${opts.limit || 50}`
          );
          return res.json();
        },
        
        async get({ sessionID }) {
          const res = await ctx.fetch(`http://localhost:8080/sessions/${sessionID}`);
          return res.json();
        },
        
        async delete({ sessionID }) {
          await ctx.fetch(`http://localhost:8080/sessions/${sessionID}`, { method: 'DELETE' });
        },
        
        async abort({ sessionID }) {
          await ctx.fetch(`http://localhost:8080/sessions/${sessionID}/abort`, { method: 'POST' });
        },
        
        async list(opts) {
          const res = await ctx.fetch('http://localhost:8080/sessions');
          return res.json();
        },
        
        async todo({ sessionID }) {
          // 返回: any[]（待办事项列表）
          return [];
        },
        
        async children({ sessionID }) {
          // 返回: any[]（子会话列表）
          return [];
        },
        
        async summarize(opts) {
          // opts: { sessionID, providerID?, modelID? }
          // 返回: 压缩后的会话摘要
          const res = await ctx.fetch(
            `http://localhost:8080/sessions/${opts.sessionID}/summarize`,
            { method: 'POST' }
          );
          return res.json();
        },
        
        // 可选：需要 sessionStorageApi 能力
        // async listByDirectory(directory, limit) { return []; },
      },
      
      // ─── 必需：事件流（Tier 1，若声明 eventStream）───
      global: {
        async event() {
          // 返回: { stream: AsyncIterable<RawRuntimeEvent> }
          // 见下方"事件归一化"章节
          return { stream: createEventStream() };
        },
      },
      
      // ─── 必需：Provider 与配置 ────────────────────────
      provider: {
        async list() {
          return { all: [], connected: [], default: {} };
        },
      },
      
      app: {
        async agents() {
          return [];
        },
      },
      
      config: {
        async get() { return {}; },
        async update(c) { return c; },
      },
      
      // ─── 必需：Base URL ──────────────────────────────
      getBaseUrl() {
        return "http://127.0.0.1:8080";
      },
      
      // ─── 可选：健康检查 ──────────────────────────────
      async healthCheck() {
        try {
          const res = await ctx.fetch('http://localhost:8080/health', {
            signal: AbortSignal.timeout(3000),
          });
          return res.ok;
        } catch {
          return false;
        }
      },
      
      // ─── 可选：凭据获取 ──────────────────────────────
      // credentials: {
      //   getApiKey(provider) { return process.env[`${provider.toUpperCase()}_API_KEY`] || null; }
      // },
      
      // ─── 可选：Agent 定义安装（需 agentConfigApi 能力）
      // agents: {
      //   async install(name, definition) { /* 写入配置文件 */ },
      //   async remove(name) { /* 删除配置 */ },
      // },
    };
  },
};
```

## 第三步：SSE 事件——产出契约与三方消费

> 事件链路全景：
>
> ```
> runtime 插件（global.event() 流）
>   → RawRuntimeEvent → normalizeOpencodeEvent() → EventFacets
>     ├─ isMalformedEvent 限频 warn（畸形防护）
>     ├─ gateway 内部消费（trajectory / step-inject 记忆注入 / BudgetGuard / turnCompress flush / 自更新定位）
>     ├─ Mode B：per-session chat 流（delta/complete/error → ChatPane/TUI Chat）
>     └─ Mode A：全局广播 opencode_event 信封 → desktop renderer / TUI
> ```

### 3.1 什么格式的事件被接受（输入契约）

`normalizeOpencodeEvent()` 接受两种信封形状（字段提取按序回退）：

```typescript
// 形状 A：GlobalEvent 信封（推荐——pi 的 PiEventStream 与 opencode 均此形状）
{ payload: { type: "string", properties: { sessionID, ...props }, sessionID? } }

// 形状 B：扁平
{ type: "string", properties: {...}, sessionID?, directory? }
```

**sessionID 提取优先级**：`properties.sessionID → properties.part.sessionID → properties.info.sessionID → payload.sessionID → 顶层 sessionID`。`directory` 只从信封顶层取（GlobalEvent wrapper 携带，session.created/updated/deleted 的消费方靠它定位项目）。

**畸形判定 `isMalformedEvent`**：type 与 properties **全空**的事件视为畸形——gateway 入口限频 warn（每 runtime 30s 一次，带原始载荷 200 字符摘要）后照常走 passthrough（fail-open）。**至少带一个真实 `type`** 是唯一的硬要求。

**接受的事件类型契约**（type → normalize 提取的必需字段）：

| type | 必需 properties | 提取结果 | 缺字段后果 |
|---|---|---|---|
| `message.part.updated` | `part.{sessionID,type:'text',text}` 或 `delta` | step（step-finish part 结算）+ chatSignal:'delta' + deltaText | 无 delta 文本则仅 step 判定 |
| `message.updated` | `info.{sessionID,role:'assistant',...完成消息}` | step（completed message）+ chatSignal:'complete' | 缺 info → 无 step |
| `session.idle` | `sessionID` | chatSignal:'complete' + broadcast:'idle' | 缺 sessionID → 不触发记忆注入 drain |
| `session.error` / `message.error` | `error`（可序列化） | chatSignal:'error' + broadcast:'error' | error 缺省为 'Unknown error' |
| `session.next.step.ended`（legacy 兜底） | `sessionID, assistantMessageID, finish` | step（旧版 opencode step 结算） | 仅做 step 判定，无 chatSignal |
| `session.created` / `session.updated` / `session.deleted` | `info.{id,title?,directory?,projectID?,parentID?,time.updated?}`（created/updated）| 直接 passthrough（desktop 靠它刷新 Rail） | 缺 info → desktop 判 none 忽略 |
| `session.compacting` / `session.compacted` | `sessionID` | compaction:'start'/'end' → 触发 turnCompress flush | — |
| `*tool*`（类型名含 "tool"） | `args.command`（string） | toolCommand → 自更新调用者定位 | 仅记账，无副作用 |
| `permission.asked` / `replied`、`question.asked` | `sessionID, requestId, toolName, args`（asked） | passthrough → desktop FlowCard | — |
| 任意其他 type | 无要求 | passthrough → Mode A 原样广播 | 未知 type 消费方忽略（合法） |

### 3.2 gateway 如何消费（内部矩阵）

| Facets 切面 | 消费者 | 行为 |
|---|---|---|
| 畸形（type+props 全空） | `isMalformedEvent` | 限频 warn（诊断），不阻断 |
| `internal` 会话（memory worker 角色） | internalSessionRoles 过滤 | token 级噪音丢弃；idle/error 仍广播并打 `internal:true` 标 |
| 任意 type+props+directory | TrajectoryCollector | 累积 SQLite；产出 `trajectory.event` / `trajectory.turn` 广播 |
| `step` 切面 | step-inject | 已结算 step → 高显著度记忆注入（markStepSeen 去重） |
| `step` + sessionID | BudgetGuard | goal 会话回合/成本计数，超限 abort |
| `compaction` 切面 | TurnPipeline | 压缩发生 → 该 session pending T1 回合立即 flush |
| `chatSignal` | Mode B chatSessions | delta/complete/error 推给订阅该 session 的 SSE 客户端 |
| `broadcast` 切面 | Mode A sseClients + wsClients + 移动端推送 | idle→`message.complete`、error→`message.error`、其余→`opencode_event` 信封原样 |
| `toolCommand` | 自更新定位 | 含 `pending-restart` 的命令钉住写令牌的会话 |

### 3.3 Mode A wire 契约（→ desktop / TUI）

广播信封（`event-broadcast.ts` 固化）：

```json
{ "type": "opencode_event", "data": { "type": "...", "properties": {...}, "sessionID": "...", "directory": "...", "internal": true? } }
```

- **可选字段缺失时不得出现在 data 上**（key 稳定性——消费方用 `'x' in data` 判定）
- 顶层非 `opencode_event` 广播（如 `runtime_switched`、`project_registered`、`user_question`、插件自定义事件）**必须扁平无 `data` 键**——desktop 剥壳 `event = raw?.data || raw` 会把 `data` 当内层载荷吞掉 `type`
- 信封出口有形状守卫：`data.type` 非字符串 → console.error 诊断（fail-open 照发）
- 插件包 / 外部程序发布：`ctx.emit(event)` 或 `POST /api/events`（顶层扁平或信封二选一）

### 3.4 desktop 如何消费

`MafwShell.tsx` 的 `es.onmessage`（**未用 `event:` 字段**——全部事件走默认 message 通道）：

1. `JSON.parse(e.data)`，失败静默丢弃
2. 剥壳：`event = raw?.data || raw`
3. 特判分发（其余未知 type **静默忽略——SSE 规范行为**，发送方随时可加新类型）：

| type | 消费行为 | 依赖字段 |
|---|---|---|
| `user_question` | AskCard 弹卡 + 通知 | goalId, questionId, question |
| `project_registered` | Rail 项目列表刷新 | projectDir |
| `runtime_switched` | invalidate 会话缓存 + 刷新菜单 + 重置工作区 | runtime |
| `session.created`/`updated`/`deleted` | `planSessionEvent` → Rail 缓存 invalidate/patch/remove | `properties.info`（见 3.1 契约表；`parentID` 或 legacy worker 标题前缀 → 隐藏会话判 none） |
| `question.asked` / `permission.asked` | FlowCard（AskCard/PermissionCard） | requestId, toolName, args |
| `question.replied`/`rejected`、`permission.replied` | FlowCard 收卡 | requestId, decision |
| `session.compacted` | 触发历史重拉 | sessionID |
| `trajectory.event` / `trajectory.turn` | RightDock 任务/轨迹 | (turnID, seq) 去重 |
| `message.complete` / `message.error` | ChatPane 回合收尾 | sessionID, error? |
| `todo.updated` | TaskList 实时刷新 | sessionID, todo |

### 3.5 TUI 如何消费

TUI 是**订阅白名单**模式（`connection.ts` 的 `KNOWN_EVENTS`）：`message.part.updated`、`session.idle`、`message.complete`、`message.error`、`session.error`、`permission.asked`、`question.asked`——白名单外的 type 不注册监听器（SSE 规范：无监听器即丢弃）。ChatStore 把 gateway 广播的 `message.complete` 与原生 `session.idle` 同等处理（回合收尾）。断线由 ConnectionStore 监督（BACKOFF 1/2/5/15s 阶梯重订阅）。

### 3.6 自定义事件（两条合法路径）

1. **runtime 内部事件**：直接向 `global.event()` 流里发任意 type——normalize 后走 passthrough 进 Mode A。想要 desktop 有反应就复用 3.4 的契约 type；全新 type 桌面会忽略（合法，但等于没发）
2. **插件包 / 外部程序**：`ctx.emit({ type: 'plugin:<name>:<event>', ... })` 或 `POST /api/events`（SDK `event.publish()`）——发布到全部 UI 通道，无需 runtime 参与通知类信息

### 3.7 事件发布检查清单

- [ ] 信封形状 A 或 B 之一；至少有非空 `type`
- [ ] 需要 desktop 有反应 → 对照 3.4 契约表选 type 并给全必需字段（尤其 `sessionID` 与 `properties.info`）
- [ ] 需要 ChatPane/TUI 跟随流式输出 → 必须产出 opencode 兼容的 `message.part.updated`（`part.text`）与 `session.idle`
- [ ] 新 type 用 `plugin:<name>:<event>` 命名空间；消费端（你自己的 renderer 逻辑）负责分发
- [ ] 不要依赖事件顺序（SSE 无序保证）；不要在事件里放大数据载荷（走 API 拉取）

## 第四步：接入记忆系统

记忆系统与 runtime 的接缝分两层：**gateway 侧**（实现契约即自动获得，零额外工作）与**宿主侧**（每个 runtime 自己的交付物，gateway 暴露的 HTTP 端点 runtime 中立）。

**鉴权**：gateway 默认监听 loopback，同机宿主**无需任何鉴权头**；跨机调用需带 `Authorization: Bearer <apiToken>`（或 `X-API-Token` 头 / `?token=` query，token 来自 config.yaml 的 `server.apiToken`；空 token + 远程 = 全拒）。

```
Gateway 侧（契约自动获得）                 宿主侧（runtime 自己实现，经 gateway HTTP）
├─ 步进注入 step-inject                    ① 观察捕获  POST /api/obs/capture
│   eventStream step 切面 + promptWhileBusy ② 边界 recall GET /api/recall/context
├─ turnCompress / 反思 / stale-verify       ③ system 注入 <memory-guide> + /api/recall/pinned
│   worker 会话经你的 session API 创建      ④ MCP 接线 runtime MCP client → /mcp
└─ Trajectory / goal outcomes（事件累积）
```

### 4.1 自动获得的部分（及其隐藏依赖）

| 功能 | 机制 | 你要做的 |
|---|---|---|
| 步进注入（per-step 记忆追加进会话） | 事件产出 step 切面（3.1 契约表）→ gateway markStepSeen 去重 → `promptAsync` 追加注入消息 | **依赖 `promptWhileBusy`**（Tier 0 已有）；`session.idle` 必须带 sessionID（触发 drain） |
| 记忆 worker 会话 | gateway 经你的 `session.create`/`promptAsync` 创建；自动注册 internal（递归防护，runtime 无需参与标记） | 无；`summarize` 缺失 → worker idle 后 dispose 轮换（fail-open 不阻塞） |
| Trajectory / 反思 / stale-verify | 事件累积 + worker 会话 | 无 |

**关键陷阱：turnCompress 的蒸馏素材不是 `session.messages`，是 t1_observations**（宿主经 `/api/obs/capture` 写入）。不接观察捕获 → hourly cron 与 compaction flush 照常触发但没有可蒸馏内容，回合蒸馏永远空转。

### 4.2 观察捕获（turnCompress 的唯一数据源）

在宿主侧的事件钩子里调 `POST /api/obs/capture`：

```json
{ "sessionID": "ses_xxx", "source": "user_input", "content": "用户输入文本", "failure": false }
```

- **source 四值**（对齐 opencode 宿主插件的捕获时机）：`user_input`（用户消息，**开新回合**）/ `tool_result`（工具执行后）/ `assistant_reply`（assistant 文本完成）/ `reasoning`（推理结束）。其余三个归入当前回合
- **响应**：`{ ok: true, id, turnId, deduped }`——`deduped: true` 且 `id: null` 表示被去重/递归防护/内容过滤吞掉（正常现象，无需重试）
- **gateway 负责**：turnID 分配（重启不会重编号）、DB UNIQUE 去重、入库前 `redactSecrets()`（sk-/ghp_/Bearer/JWT/key=value → `[REDACTED]`，宿主无需自行脱敏）、100KB 截断、递归防护（internal 会话与管线 prompt 内容自动过滤）、fail-open（错误也返回 200，不阻塞 agent，不重试）
- `user_input` 额外触发语义召回 prefetch（content 前 500 字符），加速下一次边界 recall

### 4.3 边界 recall（每次 LLM 调用前注入）

在你的 per-LLM-call transform（或 prompt 包装器）里调 `GET /api/recall/context?sessionID=&query=`（query = 最新用户输入前 500 字符），把返回的 `pointers`（string|null）拼到 messages 尾部：

- 返回物已含三块：`<recall>` 检索指针块（BM25 top-3，#mem-xxx 指针非全文）+ `<note-board>` 便签板 + `<goal-snapshot>`（仅 manager 会话）；step 注入已推送的记忆自动去重
- **同回合多次 LLM 调用**：agentic loop 内每个 step 都会经过你的注入点——宿主自己维护 per-session 增量游标（自上次注入后无新用户输入时跳过或只带 query 为空调用，返回物仍含 note-board/goal-snapshot），避免同 turn 重复注入（opencode 宿主插件即此做法）
- **fail-open 硬要求**：客户端 100ms abort；超时/失败拿不到 pointers 就直接调 LLM（null 是合法返回）。不做 fail-open = gateway 卡顿阻塞每次 LLM 调用
- 不要在宿主展开记忆全文——pointers 是指针（id + 一句话 gist），agent 需要全文时自己调 `mafw_get_memory`
- `perLlmCallTransform` 能力位是**信息性声明**（gateway 不消费）；注入实现完全在你的 runtime 内

### 4.4 system 注入（两块）

1. **`<memory-guide>`**：静态常驻 system 前缀（主动记忆引导——告诉 agent 学到新知识/偏好/教训时主动调 `mafw_add_memory`，需要旧记忆时主动调 `mafw_search_hybrid`）。文案参考 `src/hooks/memory-guide.ts`，直接复制嵌入
2. **`<user-profile>`**：`GET /api/recall/pinned` → 返回 `{ profile: string|null, entries: [], budget: { max: 20, maxChars: 2000, used } }`，`profile` 是渲染好的 `<user-profile>` 块，接在 memory-guide 之后（pinned 披露层，用户身份/长期偏好每轮必达；半稳定内容靠后保前缀缓存）；150ms fail-open

### 4.5 MCP 接线（agent 主动读写记忆的唯一通道）

40 个 `mafw_*` 工具（写 `mafw_add_memory`、查 `mafw_search_hybrid`、取 `mafw_get_memory` 等）经 gateway MCP server 暴露：

- runtime 的 MCP client 必须自己配置 remote HTTP 指向 `http://127.0.0.1:<gatewayPort>/mcp`（端口取 `ctx.gatewayPort`，缺省 3000；也读 `MAFW_SERVER_API_PORT`）
- opencode 有 self-wiring（激活时自动补配置）；**自定义 runtime 没有这层**——不接 MCP，被动注入照常，但 agent 主动写入/检索/取代（supersedes）全失效

### 4.6 事件形状对记忆质量的影响

- **用户文本必须以 text part 进 `message.part.updated`**（`part.{type:'text', text, sessionID, messageID}`）——trajectory curator 的回合 transcript 与成败信号（goal grade）都从 text parts 捕获；`message.updated` 的 summary/body 是空的，不能替代
- 工具事件类型名含 `tool` 且带 `args.command` 才能被自更新调用者定位（3.1 契约表）

### 4.7 记忆接入验证清单

- [ ] 发一条消息后 `mafw logs` 无 capture 报错；hourly cron 或 compaction flush 出现 `[TurnPipeline]` 行
- [ ] 对 agent 说"记住 X" → `mafw_search_hybrid` 能检索到（MCP 接线通）
- [ ] 新会话首条消息触发 recall（日志无阻塞；断开 gateway 后 agent 仍能正常回复 = fail-open 生效）
- [ ] pinned 一条记忆（`mafw_add_memory { pinned: true }`）→ 下一轮 agent 回答能引用

## 第五步：激活与测试

### 激活方式

**方式 A：config.yaml**
```yaml
# ~/.mafw/config.yaml
runtime:
  plugin: my-runtime          # 匹配 module.exports.name
  pluginConfig:
    my-runtime:
      baseUrl: "http://localhost:8080"
      apiKey: "xxx"           # 通过 ctx.pluginConfig("my-runtime") 读取
```

**方式 B：环境变量**
```bash
MAFW_RUNTIME_PLUGIN=my-runtime
```

### 测试流程

1. **编写插件** → 保存为 `~/.mafw/runtime-plugins/my-runtime.js`
2. **重启 gateway** → `mafw restart` 或前台 `mafw start`
3. **检查加载状态** → `GET http://localhost:3000/api/runtime`
   ```json
   {
     "active": { "name": "my-runtime", "capabilities": {...} },
     "plugins": [
       { "file": "my-runtime.js", "name": "my-runtime", "status": "ok", "capabilities": {...} }
     ]
   }
   ```
4. **测试功能** → 创建会话、发送消息、验证事件流

### 常见错误

| 现象 | 原因 | 解决 |
|------|------|------|
| `status: "error", error: "missing name"` | 未导出 `name` 字段 | 添加 `name: "my-runtime"` |
| `status: "error", error: "missing createRuntime(ctx)"` | 未导出工厂函数 | 添加 `async createRuntime(ctx) {...}` |
| `status: "error", error: "duplicate name"` | 多个文件导出相同 `name` | 检查重复插件 |
| Gateway 仍用 opencode | 插件加载失败 / 未配置 | 检查 `/api/runtime` 返回；确认 `config.yaml` 的 `runtime.plugin` |

## 第六步：参考实现

### 内置 opencode runtime

`gateway/src/runtime/opencode-runtime.ts` 是完整的 Tier 2 参考实现：
- **能力声明**：`fullCapabilities()`（全满）
- **凭据**：`credentials.getApiKey()` 从 opencode auth.json 读取
- **sessionStorageApi**：`session.listByDirectory()` 直读 SQLite
- **agentConfigApi**：`agents.install()` 写 frontmatter markdown
- **事件流**：`global.event()` 返回 SSE stream
- **健康检查**：`healthCheck()` 探测 `/global/health`

### 最小可用插件（Tier 0）

```javascript
// ~/.mafw/runtime-plugins/minimal.js
module.exports = {
  name: "minimal",
  // 不声明额外能力 → 仅 Tier 0（sessionApi + promptWhileBusy）
  async createRuntime(ctx) {
    const baseUrl = ctx.pluginConfig("minimal").baseUrl || "http://localhost:8080";
    return {
      name: "minimal",
      capabilities: {},  // Tier 0 only
      session: {
        async create(opts) {
          const res = await ctx.fetch(`${baseUrl}/sessions`, { method: 'POST', body: JSON.stringify(opts) });
          return res.json();
        },
        async promptAsync(opts) {
          await ctx.fetch(`${baseUrl}/sessions/${opts.sessionID}/prompt`, {
            method: 'POST', body: JSON.stringify(opts)
          });
        },
        async prompt(opts) {
          const res = await ctx.fetch(`${baseUrl}/sessions/${opts.sessionID}/prompt`, {
            method: 'POST', body: JSON.stringify(opts)
          });
          return res.json();
        },
        async messages(opts) {
          const res = await ctx.fetch(`${baseUrl}/sessions/${opts.sessionID}/messages?limit=${opts.limit || 50}`);
          return res.json();
        },
        async get({ sessionID }) {
          const res = await ctx.fetch(`${baseUrl}/sessions/${sessionID}`);
          return res.json();
        },
        async delete({ sessionID }) {
          await ctx.fetch(`${baseUrl}/sessions/${sessionID}`, { method: 'DELETE' });
        },
        async abort({ sessionID }) {
          await ctx.fetch(`${baseUrl}/sessions/${sessionID}/abort`, { method: 'POST' });
        },
        async list() { return []; },
        async todo({ sessionID }) { return []; },
        async children({ sessionID }) { return []; },
        async summarize(opts) { return {}; },
      },
      global: { async event() { return { stream: (async function*(){})() }; } },
      provider: { async list() { return { all: [], connected: [], default: {} }; } },
      app: { async agents() { return []; } },
      config: { async get() { return {}; }, async update(c) { return c; } },
      getBaseUrl() { return baseUrl; },
    };
  },
};
```

## 可选接口详解

### credentials（凭据获取）

```typescript
interface RuntimeCredentials {
  getApiKey(provider: string): string | null;
}
```

**用途：** Media Agent 等服务优先从 runtime credentials 获取 API key，回退到直读 opencode auth.json。

**示例：**
```javascript
credentials: {
  getApiKey(provider) {
    // 从环境变量、配置文件或密钥管理器读取
    return process.env[`${provider.toUpperCase()}_API_KEY`] || null;
  }
}
```

### agents（Agent 定义安装）

```typescript
interface AgentInstaller {
  install(name: string, definition: AgentDefinition): Promise<void>;
  remove?(name: string): Promise<void>;
}
```

**用途：** Manager agent 通过此接口安装自定义 agent 定义到 runtime。

**AgentDefinition 形状：**
```typescript
interface AgentDefinition {
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  model?: string;
  temperature?: number;
  color?: string;
  systemPrompt: string;
  permissions: AgentPermissions;
}
```

**示例：**
```javascript
agents: {
  async install(name, definition) {
    const configDir = path.join(os.homedir(), '.config', 'my-runtime', 'agents');
    fs.mkdirSync(configDir, { recursive: true });
    const filePath = path.join(configDir, `${name}.yaml`);
    fs.writeFileSync(filePath, serializeToYaml(definition));
    ctx.log.info(`Installed agent ${name} to ${filePath}`);
  },
  async remove(name) {
    const filePath = path.join(os.homedir(), '.config', 'my-runtime', 'agents', `${name}.yaml`);
    fs.unlinkSync(filePath);
  }
}
```

### session.listByDirectory（按目录列出会话）

```typescript
listByDirectory?(directory: string, limit?: number): Promise<SessionInfo[]>;
```

**用途：** 直读 runtime 私有存储（如 SQLite），按项目目录列出会话。解决 `session.list` 按 `project_id` 过滤时隐藏 worktree 会话的问题。

**SessionInfo 形状：**
```typescript
interface SessionInfo {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  metadata?: Record<string, unknown>;
  time: { created: number; updated: number };
}
```

**示例：**
```javascript
session: {
  // ...其他方法...
  async listByDirectory(directory, limit = 200) {
    // 直读 SQLite 或文件系统
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(
      `SELECT id, project_id, directory, title, metadata, time_created, time_updated
       FROM session WHERE directory LIKE ? ORDER BY time_updated DESC LIMIT ?`
    ).all(`${directory}%`, limit);
    return rows.map(row => ({
      id: row.id,
      projectID: row.project_id,
      directory: row.directory,
      title: row.title,
      metadata: row.metadata ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }));
  }
}
```

## 常见陷阱

### 1. 忘记刷新插件
修改 `.js` 文件后需要重扫或重启 gateway：
```bash
# 方式 A：热重扫（推荐，不中断服务）
curl -X POST http://localhost:3000/api/runtime/reload
# 然后切换到新插件
curl -X POST http://localhost:3000/api/runtime/switch -H 'Content-Type: application/json' -d '{"plugin":"my-runtime"}'

# 方式 B：重启 gateway
mafw restart
```

### 2. 能力声明与实际实现不匹配
声明了 `eventStream: true` 但 `global.event()` 未实现 → 事件订阅失败。

**规则：** 声明的能力必须有对应实现；未实现的能力声明为 `false`。

### 3. 事件形状不兼容
自定义事件形状与 `normalizeOpencodeEvent()` 不兼容 → 归一化产出空 facets（畸形限频 warn）或字段提取失败（desktop/TUI 静默忽略）。

**解决：** 
- 优先让事件形状接近 opencode（见"第三步：SSE 事件"的输入契约表 3.1）
- 逐 type 核对必需字段（sessionID / properties.info / part.text）——缺字段不报错，只是对应消费方无反应
- desktop/TUI 对未知 type 静默忽略是 SSE 规范行为；自写新 type 需配套自己的消费端

### 4. 忽略 external 字段
`external: true`（默认）→ gateway 不 spawn 进程，仅做健康探测。
`external: false` → gateway 尝试 spawn/kill 进程（仅内置 opencode 使用）。

**规则：** 自定义插件保持 `external: true`（或不声明）。

### 5. pluginConfig 路径错误
`ctx.pluginConfig("my-runtime")` 读取 `config.yaml` 的 `runtime.pluginConfig.my-runtime` 段。

**正确配置：**
```yaml
runtime:
  plugin: my-runtime
  pluginConfig:
    my-runtime:        # 键名必须与 name 匹配
      key: value
```

## 调试技巧

### 查看插件扫描状态
```bash
curl http://localhost:3000/api/runtime
```

返回示例：
```json
{
  "active": {
    "name": "my-runtime",
    "capabilities": {
      "sessionApi": true,
      "promptWhileBusy": true,
      "eventStream": true,
      "nativeApprovals": false,
      "providerConfigApi": false,
      "perLlmCallTransform": false,
      "sessionStorageApi": false,
      "agentConfigApi": false
    }
  },
  "plugins": [
    {
      "file": "my-runtime.js",
      "name": "my-runtime",
      "status": "ok",
      "capabilities": {...}
    }
  ]
}
```

### 查看 gateway 日志
```bash
mafw logs
```

关注：
- `[RuntimePluginLoader] Loaded my-runtime.js (my-runtime)` — 加载成功
- `[Runtime] using plugin runtime 'my-runtime'` — 激活成功
- `[Runtime] plugin 'my-runtime' createRuntime failed: ...` — 工厂函数异常

### 健康检查
```bash
curl http://localhost:3000/health
```

返回 `{"status":"ok"}` 表示 gateway 正常运行。若插件的 `healthCheck()` 返回 `false`，gateway 会记录警告日志。

## 完整示例：接入自定义 LLM 服务

```javascript
// ~/.mafw/runtime-plugins/custom-llm.js
const http = require('http');

module.exports = {
  name: "custom-llm",
  capabilities: {
    eventStream: false,        // 无实时事件流
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
    sessionStorageApi: false,
    agentConfigApi: false,
  },
  external: true,
  
  async createRuntime(ctx) {
    const cfg = ctx.pluginConfig("custom-llm");
    const baseUrl = cfg.baseUrl || "http://localhost:9000";
    const apiKey = cfg.apiKey || process.env.CUSTOM_LLM_API_KEY;
    
    const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
    
    // 内存会话存储（生产环境应持久化）
    const sessions = new Map();
    
    return {
      name: "custom-llm",
      capabilities: {
        eventStream: false,
        nativeApprovals: false,
        providerConfigApi: false,
        perLlmCallTransform: false,
        sessionStorageApi: false,
        agentConfigApi: false,
      },
      
      session: {
        async create(opts) {
          const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          sessions.set(id, { id, directory: opts.directory, messages: [], created: Date.now() });
          return { id };
        },
        
        async promptAsync(opts) {
          const sess = sessions.get(opts.sessionID);
          if (!sess) return { error: "session not found" };
          
          const message = opts.message || opts.parts?.[0]?.text;
          sess.messages.push({ role: 'user', content: message });
          
          try {
            const res = await ctx.fetch(`${baseUrl}/v1/chat/completions`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: cfg.model || 'custom-model',
                messages: sess.messages,
              }),
            });
            const data = await res.json();
            const reply = data.choices?.[0]?.message?.content || '';
            sess.messages.push({ role: 'assistant', content: reply });
          } catch (err) {
            ctx.log.error(`[custom-llm] prompt failed: ${err.message}`);
          }
        },
        
        async prompt(opts) {
          await this.promptAsync(opts);
          const sess = sessions.get(opts.sessionID);
          const lastMsg = sess?.messages[sess.messages.length - 1];
          return { parts: [{ type: 'text', text: lastMsg?.content || '' }] };
        },
        
        async messages(opts) {
          const sess = sessions.get(opts.sessionID);
          if (!sess) return { data: [] };
          return {
            data: sess.messages.map((m, i) => ({
              id: `${opts.sessionID}_${i}`,
              role: m.role,
              parts: [{ type: 'text', text: m.content }],
            })),
          };
        },
        
        async get({ sessionID }) {
          return sessions.get(sessionID) || null;
        },
        
        async delete({ sessionID }) {
          sessions.delete(sessionID);
        },
        
        async abort({ sessionID }) {
          // 无长时间任务，忽略
        },
        
        async list() {
          return [...sessions.values()].map(s => ({
            id: s.id,
            title: s.messages[0]?.content?.slice(0, 50) || 'New session',
            time: { created: s.created, updated: Date.now() },
          }));
        },
        
        async todo({ sessionID }) { return []; },
        async children({ sessionID }) { return []; },
        async summarize(opts) { return {}; },
      },
      
      global: {
        async event() {
          // 无事件流，返回空流
          return { stream: (async function*(){})() };
        },
      },
      
      provider: {
        async list() {
          return { all: ['custom-llm'], connected: ['custom-llm'], default: { chat: 'custom-llm' } };
        },
      },
      
      app: { async agents() { return []; } },
      config: { async get() { return {}; }, async update(c) { return c; } },
      
      getBaseUrl() { return baseUrl; },
      
      async healthCheck() {
        try {
          const res = await ctx.fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
          return res.ok;
        } catch {
          return false;
        }
      },
      
      credentials: {
        getApiKey(provider) {
          if (provider === 'custom-llm') return apiKey;
          return null;
        },
      },
    };
  },
};
```

**激活：**
```yaml
# ~/.mafw/config.yaml
runtime:
  plugin: custom-llm
  pluginConfig:
    custom-llm:
      baseUrl: "http://localhost:9000"
      apiKey: "sk-xxx"
      model: "custom-model-v1"
```

```bash
mafw restart
curl http://localhost:3000/api/runtime
```

## 架构文档

- **契约定义**：`gateway/src/runtime/contract.ts`
- **插件加载器**：`gateway/src/runtime/loader.ts`
- **事件归一化**：`gateway/src/runtime/normalize.ts`
- **记忆管线（turnCompress / worker 会话）**：`gateway/src/recall/turn-pipeline.ts`、`gateway/src/recall/session-worker-pool.ts`
- **记忆注入端点（runtime 中立 HTTP）**：`/api/obs/capture`、`/api/recall/context`、`/api/recall/pinned`（`gateway/src/index.ts` 路由段）
- **memory-guide 文案（宿主 system 注入用）**：`src/hooks/memory-guide.ts`
- **参考实现**：`gateway/src/runtime/opencode-runtime.ts`
- **Agent 定义模型**：`gateway/src/runtime/agent-definition.ts`
- **Gateway 激活逻辑**：`gateway/src/index.ts:814`（`createRuntime()` 方法）
- **能力守卫**：`gateway/src/index.ts:800`（`capGuard()` 方法）

## 总结

编写 MAFW runtime 插件的核心步骤：

1. **理解能力分级**（Tier 0/1/2），选择需要的能力
2. **编写 CJS 插件**（`module.exports`），声明能力 + 实现 `createRuntime(ctx)`
3. **处理事件归一化**（优先兼容 opencode 事件形状）
4. **接入记忆系统**（观察捕获 + 边界 recall + system 注入 + MCP 接线；见第四步）
5. **激活与测试**（config.yaml 或环境变量，热切换或重启 gateway，检查 `/api/runtime`）
6. **参考内置实现**（`opencode-runtime.ts` 是完整的 Tier 2 参考）

**关键原则：**
- 能力自声明 + fail-open 降级
- 插件文件修改后需 `POST /api/runtime/reload` 重扫或重启 gateway；运行时切换可热切换
- 插件失败自动回退 opencode
- 事件形状尽量兼容 opencode 归一化器

遵循这些原则，你的 runtime 插件可以无缝接入 MAFW gateway，享受记忆系统、自动化、桌面 UI 等全套功能。
