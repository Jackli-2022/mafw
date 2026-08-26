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

### 4.3 pi 能力面（探索确认）

| pi API | 用途 |
|---|---|
| `createAgentSession({cwd, model, sessionManager, ...})` | 会话创建（进程内） |
| `AgentSession.prompt(text, options?)` / `steer` / `sendUserMessage` | 发消息 |
| `AgentSession.waitForIdle()` / `abort()` / `dispose()` | 生命周期 |
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
  promptWhileBusy: true,      // waitForIdle 语义
  eventStream: true,          // subscribe → opencode 形状翻译
  nativeApprovals: false,     // pi 无原生 question/permission API（Phase 3 待办）
  providerConfigApi: true,    // ModelRuntime.getProviders() 真实；app.agents → []
  perLlmCallTransform: true,  // 信息性声明
  sessionStorageApi: false,   // pi 无 listByDirectory 直读（Phase 3 待办）
  agentConfigApi: false,      // pi 无 agent 定义安装（跳过 + warn）
}
external: true                // 进程内嵌入，gateway 不 spawn
```

## 6. 会话模型（单例 Map）

```ts
class PiSessionRegistry {
  private sessions = new Map<string, AgentSession>();

  async create(cwd: string): Promise<{ id: string }>
    // createAgentSession({ cwd, model, sessionManager }) + 登记

  async promptAsync(id: string, text: string): Promise<void>
    // session.prompt(text) + await waitForIdle()

  async prompt(id: string, text: string): Promise<{ parts: any[] }>
    // prompt + waitForIdle + 取最新 assistant 消息翻译

  async messages(id: string, opts?): Promise<{ data: any[] }>
    // AgentSession.messages → opencode 形状（pi-messages.ts）

  async delete(id: string): Promise<void>   // dispose + 移除
  async abort(id: string): Promise<void>    // session.abort()
  async list(): Promise<any[]>              // SessionManager 枚举
  async todo(id: string): Promise<any[]>    // []（pi 无 todo 概念）
  async children(id: string): Promise<any[]> // []（pi 无子会话概念）
  async get(id: string): Promise<any>       // 会话元数据
  async summarize(id: string): Promise<any> // session.compact()
}
```

**未实现映射（返回空/降级）：** `todo` → []、`children` → []、`get` → 元数据形状（id/directory/title）。

## 7. 事件流翻译（pi-events.ts）

```
AgentSession.subscribe(event)
  → 翻译器：pi 事件 → opencode 形状事件
  → AsyncIterable 包装
  → global.event() 返回 { stream }
  → 现有 normalize.ts 消费（EventFacets）
```

| pi 事件 | opencode 形状 |
|---|---|
| `agent_start` | session.updated（started） |
| `message_start` / `message_update` / `message_end` | message.part.updated（delta / text） |
| `tool_call` / `tool_result` | message.part.updated（tool-call / tool-result） |
| `turn_start` / `turn_end` | message.part.updated（step-start / step-finish） |
| `agent_end` / `agent_settled` | session.updated（idle / complete） |

翻译目标以 normalize.ts 消费的形状为准（step-finish / session.updated / message.part.updated）；精确映射表实现期按 normalize.ts 的 `normalizeOpencodeEvent` 输入面确定。sessionID 从注册表逆查（event 不带 sessionID，按 AgentSession 实例对应）。

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

## 10. 分期

- **Phase 1**：pi-runtime 插件本体（Tier 2 部分能力：session/eventStream/provider；nativeApprovals/sessionStorageApi/agentConfigApi false）。媒体不动。
- **Phase 2**：媒体 agent 改消费 AgentRuntime + MediaRuntimeExecutor + `media.engine` 路由扩展。
- **Phase 3**（后续待办）：nativeApprovals 翻译层、sessionStorageApi（listByDirectory）、agentConfigApi。

## 11. 测试策略

| 测试 | 内容 |
|---|---|
| `gateway/tests/unit/runtime/pi-runtime.test.ts` | 能力声明、createRuntime 返回形状（mock pi 模块） |
| `gateway/tests/unit/runtime/pi-session.test.ts` | Map 生命周期、promptAsync 等待 idle（mock AgentSession） |
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
| AgentSession 单例限制（一个 cwd 一个 session） | 注册表按 sessionID 管理；并发 prompt 用 pi 内部队列语义（steering/followUp） |

## 13. 验收标准

1. `npm run build` exit 0
2. `runtime.plugin: pi` 启动 → `/api/runtime` 返回 pi 能力集（8 项声明如 §5）
3. pi 会话：create → promptAsync → messages 全链路工作（冒烟，真模型或 mock）
4. 媒体 agent（Phase 2）：图片/视频/音频追问在同一会话内保持上下文
5. opencode 路径全程行为不变（回归全绿）
6. `rg -n "TODO" gateway/src/runtime/pi/` 仅 Phase 3 待办标记