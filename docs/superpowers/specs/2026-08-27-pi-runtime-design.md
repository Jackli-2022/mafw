# Pi Runtime 插件 + 媒体 Agent 统一设计（Design Doc）

> **Date:** 2026-08-27
> **Status:** Approved（用户确认 2026-08-27）
> **Plan:** 转入 `writing-plans` 生成实施计划

## 1. 目标

1. **pi-coding-agent runtime 插件**：把 pi 作为第二个 agent runtime 接入网关（进程内 SDK 嵌入），验证 runtime 能力契约（§5.19）在非 opencode runtime 上成立。
2. **媒体 agent 改为消费 `AgentRuntime`**：媒体 agent（A2A）不再是单次 `PromptFn` 调用，而是通过 runtime 契约使用完整 agent 会话（多轮记忆、模型切换、事件流），与其他 SDK 的接入 = 实现同一 runtime 契约。

## 2. 背景与现状

- 媒体分析引擎当前是 pi-coding-agent 进程内 SDK（`gateway/src/media/pi-adapter.ts`），用 `ModelRuntime.complete()` 单次补全 + `fixMediaPayload` wire 重写（video_url / input_audio）。
- 媒体引擎插件系统（§5.14a）允许 `~/.mafw/media-plugins/*.js` 替换引擎，但形态是"单次分析函数"（`PromptFn`），不是完整 agent。
- runtime 能力契约（§5.19）已就位：`contract.ts` / `loader.ts` / `normalize.ts` / `opencode-runtime.ts` / `agent-definition.ts`，全部债务已清偿（commit `5ca7d7df`）。

## 3. 关键决策（用户确认）

| 决策 | 选项 | 结论 |
|---|---|---|
| 嵌入形态 | 进程内 SDK vs 远程 RPC | **进程内 SDK**（复用媒体适配器 ESM 桥模式） |
| 能力分级 | Tier 0/1/2 | **Tier 2**（部分能力） |
| nativeApprovals | 声明 false vs 翻译层 | **声明 false + 后续待办**（pi 无原生审批 API） |
| providerConfigApi/agentConfigApi | 部分实现 vs 全 false | **部分实现**（provider.list 真实；app.agents → []；config 尽力而为；agentConfigApi false） |
| 会话模型 | 单例 Map vs 无状态重建 vs SessionManager 直连 | **单例 Map 映射**（Map<sessionID, AgentSession>） |
| 事件流映射 | 翻译成 opencode 形状 vs 独立 normalize | **翻译成 opencode 形状**（喂现有 normalize.ts） |
| 配置与认证 | pluginConfig + credentials 链 vs pi 自有认证 vs 硬编码 | **pluginConfig + credentials 链**（默认 xiaomi/mimo-v2.5；credentials.getApiKey → readOpencodeAuth 回退） |
| 媒体 agent 执行 | 保持单次函数 vs 消费 AgentRuntime | **消费 AgentRuntime**（用户拍板，架构统一） |

## 4. 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Gateway 进程                                                  │
│                                                               │
│  Runtime 契约层（已建好）                                       │
│  contract.ts / loader.ts / normalize.ts / opencode-runtime    │
│                                                               │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────┐  │
│  │ opencode     │    │ pi-runtime（新）  │    │ media agent  │  │
│  │ (identity)   │    │ 主 agent 后端     │    │ (A2A)        │  │
│  └─────────────┘    └──────────────────┘    └─────────────┘  │
│                              ▲                    │           │
│                     AgentRuntime 契约   消费 AgentRuntime     │
│                              └────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 组件划分

| 文件 | 职责 |
|---|---|
| `gateway/src/runtime/plugins/pi-runtime.ts` | 内置插件入口：能力声明 + `createRuntime(ctx)` → AgentRuntime |
| `gateway/src/runtime/pi/pi-session.ts` | `PiSessionRegistry`：Map 管理、create/promptAsync/messages/abort/delete |
| `gateway/src/runtime/pi/pi-events.ts` | subscribe() → opencode 形状事件翻译（AsyncIterable） |
| `gateway/src/runtime/pi/pi-messages.ts` | AgentMessage → opencode 形状 DTO 翻译 |
| `gateway/src/runtime/pi/pi-provider.ts` | ModelRuntime → provider.list 翻译 |
| `gateway/src/media/media-runtime-executor.ts` | A2A execute → runtime session 调用序列（Phase 2） |

### 4.2 装载链

```
config.runtime.plugin: pi
  → RuntimePluginLoader 先查内置注册表（新增 registerBuiltin）
  → 命中 'pi' 工厂 → createRuntime(ctx)
  → ESM 桥 new Function('spec','return import(spec)') 加载 @earendil-works/pi-coding-agent
  → 返回 AgentRuntime（capabilities 见 §5）
```

loader 改造：`RuntimePluginLoader` 加 `registerBuiltin(name, factory, capabilities, external)` 方法，`get()` 先查内置再查文件。内置注册在 `index.ts` 启动序列里调用（`registerBuiltin('pi', createPiRuntime, ...)`）。

### 4.2a 事件订阅与 serve 就绪解耦（外部 runtime 前置条件）

**现状问题**：`index.ts:354-383` 中 `external:true` 分支走 `waitForServeReady()` 探测 opencode serve(4096)，不通则 `serveReady=false` → `subscribeToEvents()` 在 `if (serveReady)` 门内永不执行。纯 pi 环境（无 opencode serve）下 pi 声明 `eventStream: true` 但步进注入/自动化/桌面 SSE 全部静默失效，且日志误报 "MCP-only mode"。

**改动**：外部 runtime 的事件订阅与 opencode serve 就绪**解耦**——`subscribeToEvents()` 移出 `serveReady` 门；`external=true` 且 runtime 声明 `eventStream: true` 时，事件订阅基于 `runtime.global.event()`（不依赖 serve 探测）。opencode（非 external）路径行为不变。此改动属于 Phase 1 范围（不是 Phase 3 待办），验收需覆盖纯 pi 环境下事件流实际工作。

### 4.2b shutdown 语义

gateway `stop()` 时：
- 遍历 `PiSessionRegistry` 全部 `AgentSession.dispose()`
- 事件订阅的 AsyncIterable 迭代器 `return()`（终止消费循环，触发退订）
- `ModelRuntime` 单例不销毁（gateway 进程退出即回收）

契约无 runtime 级 dispose 钩子——由 `createRuntime(ctx)` 返回的 AgentRuntime 上以自定义可选字段约定（如 `dispose?(): Promise<void>`），gateway stop 序列调用（存在则调）。Phase 1 实现。`PiSessionRegistry` 提供 `disposeAll()`。

### 4.3 pi 能力面（探索确认）

| pi API | 用途 |
|---|---|
| `createAgentSession({cwd, model, sessionManager, ...})` | 会话创建（进程内） |
| `AgentSession.prompt(text, options?)` / `followUp(text)` / `steer(text)` | 发消息（prompt 返回 void；isStreaming 时必须指定 streamingBehavior 或用 followUp/steer） |
| `AgentSession.isStreaming` / `isIdle` / `waitForIdle()` / `abort()` / `dispose()` | 状态与生命周期 |
| `AgentSession.messages` / `sessionId` / `sessionFile` | 消息与身份 |
| `AgentSession.subscribe(listener)` | 事件流（Tier 1） |
| `AgentSession.compact()` | 压缩 |
| `ModelRuntime.getProviders()` / `getModel()` / `setRuntimeApiKey()` | provider 映射 |
| `before_provider_request` extension 事件（mutate payload） | video/audio wire 重写钩子 |
| `SessionManager.create(cwd)` / 枚举 | 会话持久化（.pi/sessions） |
| `readStoredCredential` | pi 自有认证（不用，走 credentials 链） |

**关键验证点：**
- pi 内容模型是 `(TextContent | ImageContent)[]`——无 VideoContent/AudioContent。视频/音频复用 `PiAiImage carrier`（type:'image', data, mimeType）+ `before_provider_request` 挂 `fixMediaPayload`（已验证于 ModelRuntime.complete 的 onPayload 路径）。
- `AgentSession` 是否透出 `before_provider_request` 需要实现期验证（`bindExtensions` 或 factory 钩子）；若有出入，回退到 `createAgentSession({ modelRuntime })` 传预配置 ModelRuntime（media 适配器同款）。

## 5. 能力声明（pi 插件）

```ts
capabilities: {
  sessionApi: true,           // Map<sessionID, AgentSession> 映射
  promptWhileBusy: true,      // isStreaming 时自动路由到 followUp()（§6）
  eventStream: true,          // subscribe → opencode 形状翻译
  nativeApprovals: false,     // pi 无原生 question/permission API（Phase 3 待办）
  providerConfigApi: true,    // ModelRuntime.getProviders() 真实；app.agents → []
  perLlmCallTransform: true,  // 信息性声明
  sessionStorageApi: false,   // pi 无 listByDirectory 直读（Phase 3 待办）
  agentConfigApi: false,      // pi 无 agent 定义安装（跳过 + warn）
}
external: true                // 进程内嵌入，gateway 不 spawn
```

**AgentRuntime 必选/可选成员补齐：**
- `getBaseUrl(): string` — **必选**（contract.ts 强制，TS 编译即失败）。pi 无 serve 进程，返回 gateway 自身 HTTP base URL（`http://127.0.0.1:<apiPort>`，供桌面/健康面展示）。
- `healthCheck?(): Promise<boolean>` — 可选但 watchdog 依赖。实现为 `ModelRuntime` 单例存活探测（`mr` 存在即 true），不触发网络调用。
- `dispose?(): Promise<void>` — 自定义可选字段（§4.2b），gateway stop 时遍历会话 dispose + 终止事件流。
- `global.event()` — 见 §7 生命周期。

### 5.1 ModelRuntime 单例所有权（认证链接线）

**关键约束**：`createAgentSession` 缺省会自建自己的 ModelRuntime（sdk.d.ts），不传 `modelRuntime` 则 `setRuntimeApiKey` 注入到别的实例、会话请求认证静默失败。

**规定**：`createPiRuntime(ctx)` 创建**单例 ModelRuntime**（pi-adapter 同款：`ModelRuntime.create({ signal: AbortSignal.timeout(30_000) })`），并传入**每个** `createAgentSession({ modelRuntime, model: mr.getModel(provider, modelID) })`。认证链：`ctx.credentials?.getApiKey(provider)` → `readOpencodeAuth()` 回退 → `mr.setRuntimeApiKey(provider, key)`（写入单例，所有会话共享）。

## 6. 会话模型（单例 Map）

```ts
class PiSessionRegistry {
  private sessions = new Map<string, AgentSession>();

  async create(cwd: string): Promise<{ id: string }>
    // createAgentSession({ cwd, model, sessionManager }) + 登记
    // 返回 { id: session.sessionId }

  async promptAsync(id: string, text: string): Promise<void>
    // 忙时语义（pi API 验证）：
    //   session.prompt(text) 在 isStreaming 时抛异常（缺省无 streamingBehavior）。
    //   必须先检查 session.isStreaming：
    //     idle  → session.prompt(text) → await session.waitForIdle()
    //     busy  → session.followUp(text) → await session.waitForIdle()
    //   followUp 语义：排队等 agent 无 tool calls/steering 后投递（用户追问）。
    //   steer 语义：tool calls 结束后、下次 LLM 调用前插队（干预/纠偏）。
    //   gateway promptWhileBusy 走 followUp（与 pi 用户追问一致）。

  async prompt(id: string, text: string): Promise<{ parts: Part[] }>
    // 同 promptAsync 发 followUp/prompt + waitForIdle
    // prompt() 返回 void（pi 设计），响应从事件流/messages 取。
    // 取最新 assistant 消息：
    //   session.messages 是 getter → AgentMessage[]
    //   倒序找最后一条 role=assistant → pi-messages.ts 翻译成 opencode 形状 Part[]
    //   返回 { parts: translatedParts }

  async messages(id: string, opts?): Promise<{ data: SessionMessage[] }>
    // session.messages（getter, AgentMessage[]）→ pi-messages.ts 翻译成 opencode 形状

  async delete(id: string): Promise<void>   // session.dispose() + Map 移除
  async abort(id: string): Promise<void>    // session.abort()（Promise<void>）
  async list(): Promise<SessionInfo[]>      // SessionManager.list(cwd) 静态方法
  async todo(id: string): Promise<any[]>    // []（pi 无 todo 概念）
  async children(id: string): Promise<any[]> // []（pi 无子会话概念）
  async get(id: string): Promise<any>       // 元数据 { id, directory, title }
  async summarize(id: string): Promise<any> // session.compact(customInstructions?)
}
```

**关键 API 事实（pi-coding-agent v0.84.1 类型验证）：**

| pi API | 签名 | 说明 |
|---|---|---|
| `session.prompt(text, opts?)` | `Promise<void>` | 返回 void；opts 缺 streamingBehavior 时 isStreaming 抛异常 |
| `session.followUp(text, images?)` | `Promise<void>` | 排队：agent 空闲后投递 |
| `session.steer(text, images?)` | `Promise<void>` | 排队：tool calls 结束后、下次 LLM 调用前插队 |
| `session.isStreaming` | `boolean` getter | 正在 agent run 或 post-run continuation |
| `session.isIdle` | `boolean` getter | 无 run/retry/compaction/queued continuation |
| `session.waitForIdle()` | `Promise<void>` | 等到 idle（含 auto-compaction/retry 结束） |
| `session.messages` | `AgentMessage[]` getter | 全量消息含 custom types |
| `session.abort()` | `Promise<void>` | 中止当前 run |
| `session.dispose()` | `void`（同步） | 释放资源 |
| `session.compact(instructions?)` | `Promise<CompactionResult>` | 压缩上下文 |
| `PromptOptions.streamingBehavior` | `"steer" \| "followUp"` | isStreaming 时必传，否则抛 |
| `sendUserMessage(content, opts?)` | `Promise<void>` | opts.deliverAs: `"steer" \| "followUp"` |

**未实现映射（返回空/降级）：** `todo` → []、`children` → []、`get` → 元数据形状（id/directory/title）、`summarize` → `session.compact()`（映射到 pi 原生压缩，返回 `CompactionResult`）。

**并发约束（风险 5 修正）**：`createAgentSession` 每次调用建新 session（`SessionManager.create(cwd)` 默认每会话一个），Map<sessionID, AgentSession> 无同 cwd 冲突。真实约束是**每个 AgentSession 同时只有一个 agent run**（`isStreaming`）——`promptAsync` 必须先查 `isStreaming` 再决定走 `prompt()` 还是 `followUp()`。队列模式：`followUpMode: "all"`（缺省）排空全部排队消息；可切 `"one-at-a-time"` 每次只投递最旧一条。

## 7. 事件流翻译（pi-events.ts）

```
AgentSession.subscribe(event)
  → 翻译器：pi 事件 → opencode 形状事件
  → AsyncIterable 包装
  → global.event() 返回 { stream }
  → 现有 normalize.ts 消费（EventFacets）
```

**翻译目标（以 normalize.ts 实际消费面为准，normalize.ts:60-90）：**

| pi 事件 | opencode 形状（翻译目标） | normalize 产出 |
|---|---|---|
| `agent_start` | session.updated（passthrough） | 死事件，仅保留 sessionID |
| `message_start` / `message_update` | message.part.updated（part.text/delta） | chatSignal=delta |
| `message_end` | message.updated | chatSignal=complete |
| `tool_call` / `tool_result` | message.part.updated（tool-call / tool-result） | step 提取 |
| `turn_start` | message.part.updated（step-start） | step 提取 |
| `turn_end` | message.part.updated（step-finish） | step 提取（step-inject 消费） |
| `agent_end` / `agent_settled` | **session.idle**（不是 session.updated） | broadcast=idle / chatSignal=complete |
| 错误（error 事件） | **session.error** | broadcast=error / chatSignal=error |

> 注意：`session.updated` 是 normalize 的 passthrough 死事件（normalize.ts:80-81 只认 session.idle/session.error）。完成信号必须映射到 **session.idle**，否则 step-inject 与桌面 SSE 漏掉完成。

**生命周期（§4.2b 配套）：**
- `subscribeToEvents()` 可能多次调用（启动 + recoverServe）：每次调用 `global.event()` 建新 AsyncIterable；**重复订阅复用同一底层流**（单例订阅，内部引用计数；消费循环结束/出错时迭代器 `return()` 触发退订 `listener.unsubscribe()`）
- 实现：`PiEventStream` 单例持有 AgentSession 订阅；多个 AsyncIterable 消费者共享一个底层 listener（fan-out）
- sessionID 从注册表逆查（AgentSession 实例 ↔ sessionID 双向 Map）

## 8. 配置与认证

```yaml
runtime:
  plugin: pi
  pluginConfig:
    pi:
      provider: xiaomi          # 默认
      model: mimo-v2.5          # 默认
      sessionDir: ~/.pi/sessions   # pi SessionManager 目录（缺省 pi 默认）
      thinkingLevel: medium     # 可选
      tools: []                 # 可选工具白名单（缺省 pi 内置 read/bash/edit/write）
media:
  engine: pi                    # 媒体 agent 用 pi（Phase 2）
```

认证链（媒体适配器已验证）：`ctx.credentials?.getApiKey(provider)` → `readOpencodeAuth()` 回退 → `ModelRuntime.setRuntimeApiKey(provider, key)`。

## 9. 媒体 agent 改造（Phase 2）

```
现状:  media-agent.ts → MediaService → PromptFn（pi ModelRuntime.complete 单次）
改为:  media-agent.ts → MediaRuntimeExecutor → AgentRuntime（AgentSession 多轮）
```

- `MediaService` 保留为分析引擎抽象（media-plugin 系统仍在，作为"自定义引擎"选项）
- `MediaRuntimeExecutor`：A2A execute → `runtime.session.create() + promptAsync()` 序列
- 追问不建新 task 链，同一 session 内连续 prompt（真实多轮记忆）
- 视频/音频：`sendUserMessage([{type:'image', data, mimeType: video/mp4}])` → `before_provider_request` 挂 `fixMediaPayload`
- 媒体 agent 可配置用不同 runtime：`media.engine` 从 media-plugin 引擎扩展为"runtime 名或插件引擎名"

**MediaRuntimeExecutor 必须覆盖的执行器面（媒体 agent 现有 executor 能力）：**
- `execute(ctx, bus)` — 首轮：媒体 FilePart 作为首条消息（`sendUserMessage([{type:'image', data, mimeType}])`）→ prompt；追问：同 session 内 `promptAsync(text)`。返回文本 + 新 taskID（复用现有 A2A task 链，task 仍是每次 execute 一个，但底层是同一 pi session）
- `cancelTask(taskId, bus)` — A2A 取消 → `session.abort()`
- **音频首轮叙事路径**：`analyzeAudioNarrative`（media-agent.ts:561）现为独立入口——executor 必须支持音频首轮走同一会话序列（音频转写 + 叙事分析一次 prompt 完成）
- **超时语义**：`AgentSession.prompt` 无超时参数（pi-adapter 原 180s `AbortSignal.timeout` 不适用）。executor 侧用 `Promise.race` 包超时（默认 180s，pluginConfig 可配），超时 → `session.abort()` + A2A 任务标记失败
- **映射键**：taskID/contextId → pi session 的映射与 GC（task 完成或取消后，对应 session 保留 TTL 供追问，如 24h 后 dispose）

**Phase 2 验收补充：** A2A 首轮/追问/取消/音频四路径全部走 `MediaRuntimeExecutor`；`media.engine` 支持 `pi`（runtime 名）与插件引擎名（media-plugin 系统）双路由。

## 10. 分期

- **Phase 1**：pi-runtime 插件本体（Tier 2 部分能力：session/eventStream/provider；nativeApprovals/sessionStorageApi/agentConfigApi false）+ §4.2a 事件订阅与 serve 解耦 + §4.2b shutdown。媒体不动。
- **Phase 2**：媒体 agent 改消费 AgentRuntime + MediaRuntimeExecutor + `media.engine` 路由扩展。
- **Phase 3**（后续待办）：nativeApprovals 翻译层、sessionStorageApi（listByDirectory）、agentConfigApi。

## 11. 测试策略

| 测试 | 内容 |
|---|---|
| `gateway/tests/unit/runtime/pi-runtime.test.ts` | 能力声明、createRuntime 返回形状（mock pi 模块） |
| `gateway/tests/unit/runtime/pi-session.test.ts` | Map 生命周期、promptAsync idle→prompt/busy→followUp 路由、waitForIdle 等待（mock AgentSession） |
| `gateway/tests/unit/runtime/pi-events.test.ts` | pi 事件 → opencode 形状翻译映射表 |
| `gateway/tests/unit/runtime/pi-provider.test.ts` | getProviders → provider.list 形状 |
| `gateway/tests/unit/runtime/pi-integration.test.ts` | 全链路（mock ModelRuntime 单例，无网络） |
| `tests/unit/gateway/media-runtime-executor.test.ts` | A2A execute → runtime session 调用序列（Phase 2） |
| 既有回归 | runtime 契约 35 测试 + media 测试全部保持绿 |

**Mock 策略：** pi-coding-agent 是 ESM，测试用 `jest.mock` + 模块名映射 mock `@earendil-works/pi-coding-agent`；真实 ESM 加载只跑一个冒烟测试（`pi-integration.test.ts`，用 mock ModelRuntime 避免网络）。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `AgentSession` 无 `before_provider_request` 透出 | 回退 `createAgentSession({ modelRuntime })` 传预配置 ModelRuntime（media 适配器同款，已验证） |
| pi 事件不带 sessionID | 注册表逆查（AgentSession 实例 ↔ sessionID 双向 Map） |
| pi 消息形状翻译差异 | pi-messages.ts 隔离翻译层，单测覆盖映射表 |
| ESM 桥在 jest 环境不可用 | 测试全部 mock pi 模块；真实加载只一个冒烟测试 |
| 每个 AgentSession 同时只有一个 agent run（isStreaming） | 忙时新 prompt 走 followUp 队列（§6 promptAsync 忙时语义）；不涉及同 cwd 冲突（createAgentSession 每次建新 session） |
| external=true 时事件订阅被 serveReady 门挡住（纯 pi 环境静默失效） | §4.2a 解耦改动（Phase 1 范围，非待办） |
| `AgentSession.prompt` 无超时参数 | executor 侧 `Promise.race` 包超时（默认 180s）+ `session.abort()`（§9） |

## 13. 验收标准

1. `npm run build` exit 0
2. `runtime.plugin: pi` 启动 → `/api/runtime` 返回 pi 能力集（8 项声明如 §5）
3. pi 会话：create → promptAsync → messages 全链路工作（冒烟，真模型或 mock）
4. **纯 pi 环境（无 opencode serve）事件流实际工作**：`subscribeToEvents()` 不被 serveReady 门挡住（§4.2a），步进注入/自动化触发器收到完成信号（session.idle）
5. 媒体 agent（Phase 2）：图片/视频/音频追问在同一会话内保持上下文；取消（cancelTask）→ abort；超时 → 失败标记
6. opencode 路径全程行为不变（回归全绿）
7. `rg -n "TODO" gateway/src/runtime/pi/` 仅 Phase 3 待办标记