# Runtime 插件编写指南（Agent 版）

> 给执行任务的 agent：**先读这份，再读清单 JSON**。目标不是“写一个能加载的插件”，而是“让 coverage 在目标 preset 上可解释地绿”。
>
> 机器可读清单：`packages/gateway-sdk/contract/runtime-contract.json`
> 设计依据：`docs/superpowers/specs/2026-10-30-runtime-contract-coverage-manifest-design.md`
> 代码级示例：`.opencode/skills/runtime-plugin-authoring/SKILL.md`

## 0. 你需要的输入

开始写代码前，先确认这四件事：

1. **目标平台 SDK**：包名、入口、认证方式、会话模型、事件流形态。
2. **目标 preset**：`core` / `conversation` / `autonomous` / `desktop`。不要默认冲 `desktop`；先让 `core` 可运行。
3. **gateway 版本**：`GET /api/runtime` 的 `active.name`、`active.coverage`；清单的 `contractVersion`。
4. **宿主能力**：目标平台能不能装宿主扩展（用于认知面六动词）？不能就明确接受 `cognition.*` 为 `unverified`，不要假装覆盖。

## 1. 先做平台侦察（30 分钟）

不要先写 `createRuntime`。先回答下面的问题，把答案写进一张映射表：

| 契约域 | 要问目标 SDK 的问题 | 典型答案 |
|---|---|---|
| session | 怎么建会话、传 cwd、列会话、删除、改名、中止？ | `createSession({cwd})` / `listSessions()` |
| prompt | 同步/异步发消息？返回 usage/stopReason 吗？支持流式吗？ | `prompt()` / `promptAsync()` + events |
| events | 原生事件类型、信封、增量/快照、终态？ | `turn_started` / `text_delta` / `turn_end` |
| tools | 怎么注册宿主工具？支持 JSON Schema 吗？ | MCP server / function tools |
| approvals | 工具审批、用户提问、表单？ | permission callback / ask user |
| identity | 怎么安装 agent 定义？ | agent md / config / prompts |
| discovery | 命令/技能目录怎么读？ | commands dir / skills API |
| mcp | MCP server 列表/连接/断开/配置写入？ | MCP client / config file |
| branch | fork/revert/diff/checkpoint？ | session fork / git snapshot |
| process | 自己的 server 怎么起、健康检查、重启？ | spawn CLI / HTTP health |
| credentials | provider key 从哪来？ | env / auth.json / keychain |
| completion | 有没有无状态单次补全？ | `complete()` / chat API |

**判定规则**：

- 目标 SDK 有、且语义接近 → 实现对应 surface。
- 有但不完全等价 → 实现，并在 `impact`/注释里写明降级语义。
- 没有 → 不要声明对应 capability；让它进 coverage 的 `missing`，用 preset 报告解释。
- **不要用 `true`/`{}` 假装实现**：presence 探针要求 `rt` 面最终是函数；容器/布尔值会被判 missing。

## 2. 契约模型（只记这 5 件事）

### 2.1 方向

- `gateway->runtime`：gateway 调你的方法（session/prompt/fork/...）。
- `runtime->gateway`：你的宿主调 gateway 的 loopback HTTP（observe/recall/...）。
- `declaration`：插件模块导出的纯数据（name/capabilities/eventMappings/nativeTools）。

### 2.2 义务

| obligation | 含义 | 缺了会怎样 |
|---|---|---|
| `required` | 契约必选面 | 激活 hard 失败，回退内置 runtime |
| `gated` | 由 capability 门控 | capability 声明 true 但实现缺失 → 降级 false；不在 `requires` 的缺口只记 warning/覆盖 |
| `optional` | 独立可选面 | 功能 503/禁用，缺口进覆盖率 |
| `advisory` | 建议项 | 只 warning/覆盖 |

### 2.3 验证方式

- `presence`：激活期检查方法/声明是否存在。
- `behavior`：确定性探针，不调 LLM（adapters/fixtures）。
- `conformance`：真实回合/场景（`POST /api/runtime/conformance`）。
- `attested`：无法探针的信任声明（如 `turnBudgetApi`），永远 `unverified`。

### 2.4 preset

| preset | 目标 |
|---|---|
| `core` | headless 会话 + prompt + tools + loader 元数据 |
| `conversation` | core + 事件流 + turn/part + prompt 用量 + 认知面 |
| `autonomous` | conversation + 审批/问答 + steer + 预算 |
| `desktop` | autonomous + 身份/发现/MCP/分支/instructions/provider/媒体 |

### 2.5 coverage

`GET /api/runtime/contract` 返回 `{ manifest, coverage }`；`GET /api/runtime` 的 `active.coverage` 是摘要。

```bash
curl -s http://127.0.0.1:3000/api/runtime | jq '.active.coverage.static.presets'
curl -s http://127.0.0.1:3000/api/runtime/contract | jq '.coverage.static.missing[:10]'
```

## 3. 先让 `core` 跑起来

### 3.1 文件位置与形状

```
~/.mafw/runtime-plugins/<name>.js
```

CJS 单文件：

```js
module.exports = {
  name: "my-runtime",
  capabilities: {
    // 只声明你真的实现了的增量；minimalCapabilities 已含 sessionApi/promptWhileBusy
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
  },
  external: true, // 自定义插件保持 true：gateway 不 spawn/kill 你的进程
  async createRuntime(ctx) {
    // 初始化 SDK、读 ctx.pluginConfig(name)、返回 AgentRuntime
  },
};
```

### 3.2 必须实现的 11 个 session 方法

`session.create` / `session.promptAsync` / `session.prompt` / `session.messages` / `session.get` / `session.delete` / `session.abort` / `session.list` / `session.todo` / `session.children` / `session.summarize`.

最小骨架：

```js
async createRuntime(ctx) {
  const cfg = ctx.pluginConfig("my-runtime");
  const sessions = new Map();

  return {
    name: "my-runtime",
    capabilities: { eventStream: false, nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false },

    session: {
      async create(opts) {
        if (!opts.directory) throw new Error("directory is required");
        const id = `my_${Date.now()}`;
        sessions.set(id, { id, directory: opts.directory, messages: [] });
        return { id };
      },
      async promptAsync(opts) {
        const s = sessions.get(opts.sessionID);
        if (!s) throw new Error("session not found");
        const text = opts.message ?? (opts.parts || []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
        s.messages.push({ role: "user", content: text });
        // TODO: 调目标 SDK，把结果写回 s.messages，并产出事件
      },
      async prompt(opts) {
        await this.promptAsync(opts);
        const s = sessions.get(opts.sessionID);
        const last = s.messages[s.messages.length - 1];
        return {
          parts: [{ type: "text", text: last?.content ?? "" }],
          // 能拿到就填：finish/stopReason/usage/structured
        };
      },
      async messages(opts) {
        const s = sessions.get(opts.sessionID);
        return { data: s ? s.messages : [] };
      },
      async get({ sessionID }) { return sessions.get(sessionID) || null; },
      async delete({ sessionID }) { sessions.delete(sessionID); },
      async abort({ sessionID }) { /* TODO: interrupt 目标 SDK */ },
      async list() { return [...sessions.values()]; },
      async todo() { return []; },
      async children() { return []; },
      async summarize() { return {}; },
    },

    global: { async event() { return { stream: (async function* () {})() }; } },
    provider: { async list() { return { all: [], connected: [], default: {} }; } },
    app: { async agents() { return []; } },
    config: { async get() { return {}; }, async update(c) { return c; } },
    tools: {
      async registerTools(factory) { /* 保存 factory，按 session 调 factory(sessionId) */ },
      nativeTools() { return []; },
    },
    getBaseUrl() { return cfg.baseUrl ?? "http://127.0.0.1:8080"; },
    async healthCheck() { return true; },
  };
}
```

### 3.3 两条硬规则

1. **会话目录只认 `opts.directory`**：必填、绝对路径。`ctx.projectDir` 只是启动期快照，不能当会话 cwd。
2. **server 根目录只认 `ctx.rootDir`**（`~/.mafw/runtime-root`）：自带 server 的 runtime 用它当 cwd，不能用 `process.cwd()` 或 session 目录。

## 4. 按 preset 补齐

```bash
# 看目标 preset 需要哪些面
jq --arg p desktop '.presets[] | select(.id==$p) | .requiredSurfaces' \
  packages/gateway-sdk/contract/runtime-contract.json

# 看某个 surface 的义务/影响
jq '.surfaces[] | select(.id=="session.fork")' \
  packages/gateway-sdk/contract/runtime-contract.json
```

实现顺序：

1. `core`：`session.*` + `prompt.parts.text` + `tools.registerTools` + `tools.nativeTools` + `plugin.*`。
2. `conversation`：`eventStream` + `events.global` + `events.turn.terminal` + `events.part.text` + `prompt.result.usage` + `cognition.observe` / `cognition.injectContext` / `cognition.injectSystem` / `cognition.tools`。
3. `autonomous`：`approval.permissionReply` / `approval.permissionList` / `approval.question.list` / `approval.question.reply` / `approval.question.reject` + `prompt.delivery.steer` + `prompt.maxTurns` / `prompt.maxCostUsd`。
4. `desktop`：`identity.agents.install` / `identity.agents.remove`、`discovery.list` / `discovery.loadSkill`、`mcp.*`、`branch.*`、`session.update`、`session.listByDirectory`、`session.instructions.list` / `session.instructions.put` / `session.instructions.remove`、`process.completion`、`provider.*`、`media.tools`、`usage.*`。

## 5. 事件面（最高频漏面）

### 5.1 default-deny

声明 `eventStream: true` 时，**每个原生 type 必须被 `eventMappings` 覆盖，或由 `transformEvent` 处理**；没有 canonical 直通分支。声明 eventStream 但没有任何翻译声明 → loader 直接降级 eventStream。

```js
eventSource: { typePath: "$.type", sessionIdPath: "$.session_id" },
eventMappings: [
  { from: "turn_done", to: "turn.completed", passProperties: "$.properties" },
  { from: "text_delta", to: "part.delta",
    fields: { "part.type": { const: "text" }, "delta": { path: "$.delta" } } },
  { from: "heartbeat", to: "drop" },
],
// 状态机/1→N/副作用才用它；返回 null 丢弃
transformEvent(raw) { return null; },
```

### 5.2 必须给全的字段

| 事件 | 必需字段 | 漏了会怎样 |
|---|---|---|
| `turn.started` / `turn.completed` / `turn.failed` / `turn.aborted` | `sessionID` | UI 永远 busy；记忆 drain 不触发 |
| `part.updated`（text） | `part.text` 或 `delta` | 不流式渲染 |
| `part.updated`（tool） | `part.state.input/output/error` | 工具卡空 |
| `message.updated` | `message.id` | 无法去重消息骨架 |
| `session.created/updated` | `info.id` | Rails 列表不刷新 |
| `session.deleted` | `sessionID` | 桌面不删 |
| `permission.asked` / `question.asked` | `requestId` + `sessionID` | FlowCard 无法关联 |

### 5.3 工具三原语

如果目标 runtime 是「call / result 分离」形态：

- 发 `tool.call` / `tool.delta` / `tool.result`（gateway `ToolPartAssembler` 合帧），或直接发 `part.updated` 的 tool part 快照。
- 不要两条链同时发（会双卡）。

### 5.4 试衣间

```bash
curl -X POST http://127.0.0.1:3000/api/runtime/dry-event \
  -H 'Content-Type: application/json' \
  -d '{"event":{"type":"turn.completed","properties":{"sessionID":"s1"}}}'
```

`warnings: []` 才算事件契约通过。构造事件用 `ctx.events.make(type, props, sessionID)`，检查用 `ctx.events.check(evt)`。

## 6. 认知面（runtime → gateway）

六个 loopback 动词，详见清单的 `cognition` 节：

| 动词 | 端点 | 预算 | 失败策略 |
|---|---|---|---|
| observe | `POST /api/obs/capture` | 5s | 不阻塞、不重试 |
| injectContext | `GET /api/recall/context` | **100ms** | 超时/失败 = 直接调 LLM |
| injectSystem | `GET /api/recall/pinned` + memory-guide | 150ms | 跳过注入 |
| tools | `/api/memory/add`、`/api/python/*`、`/api/tts`、`/a2a` | 60s | 工具错误文本返回 |
| gate | `POST /api/cognition/gate` | 2s | 超时 = allow |
| rewrite | `POST /api/cognition/rewrite` | 2s | 超时 = 原样透传 |

最小接入顺序：

1. 每次用户输入/assistant 完成/工具结果/推理结束 → `observe`。
2. 每次 LLM 调用前 → `injectContext`，把 `pointers` 拼到 messages 尾部；维护 per-session 增量游标，短增量（<50 字符）拼上一条 assistant 尾文本。
3. 每回合 system 尾部 → `injectSystem`（memory-guide + pinned）；注入物标 `synthetic: true`，防回流。
4. 目标平台有工具通道 → 六件套走 `registerTools` 或 MCP。

**没有宿主扩展时**：`cognition.*` 会保持 `unverified`。这是诚实的，不要声明 `perLlmCallTransform` 就假装接好了。

## 7. 工具面

```js
tools: {
  async registerTools(factory) {
    // 保存 factory；每个 session 创建时调用 factory(sessionId)
    // 返回 [{ name, label?, description, parameters(JSON Schema), execute(params, signal) }]
    // 注册进目标 runtime 的工具面；execute 直接透传。
  },
  nativeTools() {
    return [
      { name: "Read", toolClass: "readonly" },
      { name: "Bash", toolClass: "shell" },
    ];
  },
}
```

- `parameters` 是 JSON Schema；目标 SDK 不认 JSON Schema 时自行翻译。
- 历史工具卡不渲染 → 实现 `normalizeMessages`（把原生历史转 flat `MafwMessage[]`）。
- 进程外 runtime：`GET /api/tools` 取 spec，`POST /api/tools/execute` 执行；gateway 自动合成两帧 tool part，**不要**再自发工具事件。
- 工具注解（readOnly/destructive/…）与结构化结果能填就填；不填只影响审批/UI 提示，不影响执行。

## 8. 审批 / 身份 / 发现 / MCP / 分支 / 进程

| 域 | 面 | 关键点 |
|---|---|---|
| approval | `approval.permissionReply` / `approval.permissionList` | `nativeApprovals` 只要求 `permissionReply`；`permissionList` 缺失只 warning |
| approval | `approval.question.list` / `approval.question.reply` / `approval.question.reject` | `questionApi` 三个成员都必需 |
| identity | `identity.agents.install` / `identity.agents.remove` | `agentConfigApi` 只要求 install；remove 是 unlocks-only，缺失不产生 activation warning |
| discovery | `discovery.list` / `discovery.loadSkill` | `discoveryApi` 两个都必需 |
| mcp | `mcp.list` / `mcp.connect` / `mcp.disconnect` | `mcpApi` 三个都必需 |
| mcp | `mcp.config.preview` / `mcp.config.apply` / `mcp.config.remove` / `mcp.config.restore` | `mcpConfigApi` 四个都必需；持久化在 runtime 适配器 |
| branch | `branch.fork` / `branch.revert` / `branch.unrevert` / `branch.diff` / `branch.vcs` | `sessionBranchApi` 要求 fork+revert；diffApi 要求 diff+session.vcs.apply |
| branch | `branch.checkpoint` / `branch.runState` | `attested`；没有专属方法时保持 unverified |
| process | `process.restart` / `process.spawnServe` / `process.killServe` | `agentProcessApi` 只要求 restart |
| process | `process.completion` / `process.credentials` | completionApi 要求 completion.complete |
| provider | `provider.list` / `provider.app.agents` / `provider.config` / `provider.config.update` | `providerConfigApi` 四个都必需；config 整体缺失只报一条 hard |

## 9. 验证流程

### 9.1 加载/切换

```bash
# 写文件
cp my-runtime.js ~/.mafw/runtime-plugins/my-runtime.js

# 热重扫 + 切换（或重启 gateway）
curl -X POST http://127.0.0.1:3000/api/runtime/reload
curl -X POST http://127.0.0.1:3000/api/runtime/switch \
  -H 'Content-Type: application/json' -d '{"plugin":"my-runtime"}'
```

### 9.2 看校验与覆盖

```bash
curl -s http://127.0.0.1:3000/api/runtime | jq '{
  active: .active.name,
  capabilities: .active.capabilities,
  validation: .validation,
  coverage: .active.coverage.static.presets
}'
```

期望：

- `validation` 里的 hard = 0。
- `active.coverage.static.presets.<target>.missing` 为空，或你明确接受缺口。
- `active.capabilities` 与 `active.coverage.static.effective` 不矛盾。

### 9.3 契约端点

```bash
curl -s http://127.0.0.1:3000/api/runtime/contract | jq '.coverage.static.missing'
```

### 9.4 事件试衣间

见 §5.4。

### 9.5 conformance

```bash
curl -X POST http://127.0.0.1:3000/api/runtime/conformance \
  -H 'Content-Type: application/json' \
  -d '{"scenarios":["chat-roundtrip","session-lifecycle","cognition-observe","cognition-inject","identity-roundtrip","tool-visibility"]}'
```

每个场景 PASS 才算行为面通过；`chat-roundtrip` / `cognition-*` 会消耗真实 LLM 往返。

### 9.6 桌面/TUI 冒烟

- 新建会话 → 发消息 → 看到流式 text/tool 卡。
- 审批/问答卡能弹能回。
- 取消/中止、切换模型/agent、时间线 fork/revert（如果实现）。
- 重启 gateway 后会话列表/历史仍在。

## 10. Definition of Done

- [ ] `name` / `createRuntime` / `capabilities` 正确导出，`external: true`。
- [ ] `core` 的 11 个 session 方法全部是函数；`session.create` 使用 `opts.directory`。
- [ ] 目标 preset 的 `requiredSurfaces` 在 `active.coverage.static.presets.<target>.missing` 中为空（或已记录接受的缺口）。
- [ ] 声明了 `eventStream` → 有 `eventSource` + `eventMappings`/`transformEvent`；`turn.*` / `part.*` 字段齐全。
- [ ] `tools.registerTools` + `tools.nativeTools` 已实现；工具事件可见（或走 out-of-process）。
- [ ] 认知面四动词已接（目标 preset 为 conversation 及以上）；时延/ fail-open 符合预算。
- [ ] `nativeApprovals` / `questionApi` / `providerConfigApi` 声明与实现一致；没有虚报。
- [ ] `normalizeMessages`（如目标 SDK 历史形状不同）已实现。
- [ ] `POST /api/runtime/conformance` 目标场景 PASS；`/api/runtime` 无新 hard/downgrade。
- [ ] 桌面/TUI 冒烟通过。

## 11. 常见失败模式

| 现象 | 根因 | 修复 |
|---|---|---|
| 插件加载但 `validation` 有 hard | 11 个 session 方法缺一个 / tools 缺 / eventStream 缺 `global.event` | 按 `hard` 消息补方法 |
| `eventStream` 自动变 false | 没有 `eventMappings` 或 `transformEvent` | 加翻译声明或 `canonicalIdentity()` 恒等行 |
| UI 永远 busy | `turn.completed` 没带 `sessionID`，或没有终态事件 | 补 `sessionID` / `turn.failed` |
| 工具卡不显示 | 工具事件没映射；或历史没有 `normalizeMessages` | 映射 tool part / 三原语；实现历史归一 |
| 媒体附件消失 | `prompt` 只取 text parts，把 file parts 拍平 | 把 file parts 作为多模态输入传给目标 SDK |
| `prompt` 没有 usage/stopReason | 返回 `{parts:[]}` 或只返回文本 | 从目标 SDK 结果映射 `PromptResultEnvelope` |
| 身份不生效 | 没实现 `agents.install` / `prompt` 不带 agent | 实现物化 + 绑定 |
| 审批卡永远空 | 声明 `nativeApprovals` 但缺 `permissionReply`/`permissionList` | 补方法或声明 false |
| 设置页 503 | 声明 `providerConfigApi` 但缺 provider/app/config | 补齐或声明 false |
| 会话串目录 | 用 `ctx.projectDir` 或 `process.cwd()` 当 cwd | 只用 `opts.directory` |
| server 起在错误目录 | 用 session cwd 当 server root | 用 `ctx.rootDir` |

## 12. 给 agent 的执行顺序

1. **侦察**：填 §1 的表，选 target preset。
2. **读清单**：只读目标 preset 的 `requiredSurfaces` 和 `cognition` / `events` 节，不要先读全部 gateway 源码。
3. **写 core**：11 个 session 方法 + tools + loader 元数据；先不接事件。
4. **本地验证 core**：reload/switch → `/api/runtime` hard=0 → `session-lifecycle` PASS。
5. **接事件**：eventSource/eventMappings/transformEvent → dry-event → `chat-roundtrip` PASS。
6. **接认知面**：observe/injectContext/injectSystem/tools → `cognition-observe` / `cognition-inject` PASS。
7. **按 preset 补域**：approval → identity → discovery → mcp → branch → process/provider → media/usage。
8. **跑 coverage**：确认 `active.coverage.static.presets.<target>.missing`；把接受的缺口写进插件 README/注释。
9. **冒烟**：桌面/TUI 真实回合；重启 gateway 后回归。
10. **交付**：插件文件 + `GET /api/runtime/contract` 的 coverage 截图/JSON + conformance 结果。

## 13. 机器可读资源

| 资源 | 位置/入口 |
|---|---|
| 清单 JSON | `packages/gateway-sdk/contract/runtime-contract.json` |
| JSON Schema | `packages/gateway-sdk/contract/runtime-contract.schema.json` |
| 清单端点 | `GET /api/runtime/contract` |
| 覆盖率摘要 | `GET /api/runtime` → `active.coverage` |
| SDK | `@mafw/sdk` → `runtime.contract()` |
| 场景一致性 | `POST /api/runtime/conformance` |
| 事件试衣间 | `POST /api/runtime/dry-event` |
| 作者 skill（代码级示例） | `.opencode/skills/runtime-plugin-authoring/SKILL.md` |

> 清单是权威；本文是操作手册。两者冲突时以 `runtime-contract.json` 与代码行为为准。
