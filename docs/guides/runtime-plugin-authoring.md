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
- `declaration`：插件模块导出的纯数据（name/capabilities/eventSource/eventMappings/transformEvent/eventTranslation/preset/sampleEvents/nativeTools）。

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

**presence ≠ 可用（重要）**：presence 只证明方法/声明存在，不能证明它工作。反向校验会把「实现了但没声明」的能力**自动打开**——一个只有空壳（stub / 运行时抛错）的方法也会被当成实现。所以：

- 不想暴露的能力必须**显式写 false**（显式声明永不被自动补覆盖）；
- 真实可用性只能靠 `behavior`/`conformance`（`mafw plugin-test`）证明，coverage 的 `unverified` 不是绿灯。

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
  preset: "conversation",              // 目标档位（plugin-check 缺面清单用）
  eventTranslation: "declared",        // 推荐：gateway 执行器翻译（见 §5）
  capabilities: {
    // 只声明你真的实现了的增量；minimalCapabilities 已含 sessionApi/promptWhileBusy
    // 声明是唯一来源：实例（createRuntime 返回对象）不要重复声明 capabilities
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
  },
  external: true, // 自定义插件保持 true：gateway 不 spawn/kill 你的进程

  // 声明式事件翻译（eventStream: true 时必填；纯数据，执行器在 gateway）
  eventSource: { typePath: "$.type", sessionIdPath: "$.sessionID" },
  eventMappings: [
    { from: "done", to: "turn.completed", fields: { sessionID: { path: "$.sessionID" } } },
  ],
  transformEvent(raw) { return null },  // 状态机/1→N 才用它
  sampleEvents: [                        // 离线检查器样本（原生事件）
    { type: "done", sessionID: "sample" },
  ],

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

### 5.0 唯一推荐路径：declared（gateway 执行器翻译）

插件只推**原生事件**，翻译写成模块导出的纯数据表（`eventSource` + `eventMappings` + 可选 `transformEvent`）；执行器在 gateway（`applyEventMappings`），插件包内**不要**写自己的翻译执行器。产线示例：`adapters/claude/src/events.ts`（表）+ `adapters/claude/src/runtime.ts`（推 raw）。

**逃逸：`eventTranslation: "self"`** —— 插件坚持自己翻译成 canonical 再推总线时显式声明。代价：coverage 标注「self-translation (not recommended)」，且默认 `eventStream` 校验放宽为「不强制映射表」。没有这个声明、又推 canonical 的插件必须注册恒等行（`canonicalIdentity()`），否则 default-deny 会拦截。

**turn.started 这类跨事件状态机不要放 `transformEvent`**：执行器 first-match，命中映射行的终态事件不会到达逃逸口。用 `packages/runtime-kit` 的 `createTurnTracker` 在总线入口观察原生流并补发 `turn.started`（claude 适配器是参考实现）。

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
| `message.updated` | `message.id`（+ `message.role`） | 无法去重消息骨架（**wire `info` 已删除**，见 §9.7(b)） |
| `session.created/updated` | `info.id`（session 生命周期仍是 wire `info`） | Rails 列表不刷新 |
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
- 历史工具卡不渲染 → 实现 `normalizeMessages`（把原生历史转 **flat `MafwMessage[]`**，
  工具 part id 用 `toolpart_<callID>`；§9.7(a)）。
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

### 9.0 Runtime Ingress 与 Experience Contract

原生事件、SDK 历史与 runtime 专属形状不得进入 gateway 业务核心：它们只能到达 Runtime Ingress，由 gateway 执行翻译/归一，再经 `RuntimeFacade` 进入核心。未匹配或非法数据 fail-closed，只产生 telemetry。

前端消费 `GET /api/experience/actions`（版本化 Action Descriptor），不读取裸 capabilities 或 runtime 名称。Diagnostics/Admin（插件中心、runtime 切换、原生 coverage）是独立窄通道。

### 9.1 离线检查（plugin-check，零 LLM、零激活）

改完插件先跑离线检查，再做在线 conformance：

```bash
mafw plugin-check ~/.mafw/runtime-plugins/my-runtime.js --preset core
mafw plugin-check ~/.mafw/runtime-plugins/my-runtime.js --preset conversation --strict
```

检查内容：加载形状、事件映射表校验、声明矩阵（declared/self、矛盾声明）、试实例化、能力盖印 + 声明↔实现校验（声明了没实现 → 降级；实现了没声明 → 自动补 + warning）、`sampleEvents` 逐条过真执行器、按 preset 列出缺失面。

退出码：`0` = 通过；`1` = hard/error 或（`--strict` 时）preset 缺面；`2` = gateway dist 缺失。CI 可直接用（不需要 LLM 凭据）。

需要真实 LLM 往返的场景时再跑 `mafw plugin-test`（§9.5）。

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

### 9.7 第二批破坏性迁移（2026-11-02）——写插件前必须先读

第二批把「gateway 业务核心 / 全部客户端」收敛到 MAFW View DTO + Experience Contract，
并删除了客户端兼容层。**新插件与旧插件的行为差异全部在这一节**：

#### (a) 历史出口只有 flat，没有开关

- `GET /api/sessions/:id/messages` 唯一响应：`{ data: MafwMessage[], nextCursor }`。
  需要历史基线的 profile 调 `session.messages(<sessionID>)`；没有 session.history 方法，
  也没有 `?format=flat|wire` 参数（旧参数被忽略，不再改变形状）。
- `MafwMessage` = `{ id, sessionID?, role, content: MafwPart[], time?, parentID?, model?, finish?, tokens?, cost?, error? }`；
  `MafwPart` 覆盖 `text / reasoning / tool / file / agent / compaction / step-* / data-*`。
  **旧 wire 信封 `{ info, parts }` 已删除**：adapter 直接返回 flat，facade 对非 flat 成员
  fail-closed 丢弃并记录 `normalizeMessages produced a non-flat member — dropped`。
- 声明 `normalizeMessages` 的 runtime：签名不变（`(raw) => MafwMessage[]`），但**输出必须是
  flat**——不会再有一条「wire→flat 二次翻译」的救援通道。
- 工具 part id 方案（历史与 live 必须同 id，否则 upsert 双卡）：`toolpart_<callID>`。
  pi / claude 已按此实现；opencode 用 serve 原生 part id（历史与 live 本来就同源）。

#### (b) SSE `message.updated` 只携带 `properties.message`

- 事件载荷：`{ type: 'message.updated', properties: { message: {...}, sessionID? } }`，不再是 `properties.info`。
- 升级后 gateway 启动时对 `event_log` 做**一次性幂等迁移**（`info` → `message`，备份
  `~/.mafw/logs/event-log-message-migration-<ts>.jsonl`）；replay 与直播逐字节同形。
- `session.created/updated/deleted` 仍是 wire `properties.info`（本批未翻转）。desktop 只在这三个
  事件上读 `info`；其余事件读 `info` 属于违例，`event-field-contract` 会告警。
- 已登记的 live 缺口：pi 的 `message_end → message.updated` 映射不带 `message.id`，桌面按
  「无 id 的 live message.updated 丢弃」处理（历史 id 由 `normalizePiMessages` 提供）。

#### (c) 删除的 SDK / HTTP 面（旧客户端无法连新 gateway）

| 已删除 | 替代 |
|---|---|
| session.history / `?format=flat` | `session.messages`（恒 flat） |
| `shells`、`requestRuntime`、`command`、`skill`（含 `skill.content`）、`opencodeConfig` | `background.*`、`runtime.*`、`discovery.*`、`runtimeConfig` |
| `GET /command`、`GET /skill`、`GET /api/skill/content`、`GET|PATCH /api/opencode-config` | `GET /api/sessions/:id/discovery`、`GET .../discovery/skills/:key`、`GET /api/runtime-config` |
| 通用 preload `window.api.mafw.invoke(ns, method, ...)` | 每个 namespace 的 typed 方法 |

这是**有意 breaking change**：新版 desktop/TUI/mobile 与 gateway 需协调发布。

#### (d) Experience Contract：客户端不再读 capabilities / runtime 名称

- 业务 UI 只看 `GET /api/experience/actions`（版本化 Action Descriptor）：
  `supported` = 该 runtime 有这个面；`enabled` = 当前上下文可用（busy/数据缺失时为 false）；
  `reason` 用中性词汇（`unsupported | busy | missing-data | not-invertible-patch | disabled`）。
- 后端只经 `RuntimeAccess.can(<surface>)` 做门：缺能力 = 中性 `503`（`runtime does not support <surface>`），
  文案不得出现 runtime 名或 capability flag 名。`402/404` 只能用于「语义上不存在该原语」
  （例：`branch.unrevert`）。
- worktree 归 **gateway git + session directory 契约**，不再是某个 runtime 的能力位；
  目录不支持时 `409`（不是 503）。

#### (e) background / terminal 的中性协议

- background 三源统一：`GET /api/background/jobs?sessionID=`、`GET .../jobs/:id/output?cursor=`、
  `POST .../jobs/:id/cancel`；DTO = `MafwBackgroundJob` / `MafwBackgroundOutput`；
  实时更新走 SSE `background.job.updated`（`properties.job`）。`POST /api/session/:id/background`
  仍独立表达「把阻塞回复转后台」动作（surface `session.background`）。
- terminal 走 MAFW 中性协议（`mafw-terminal/1`）：`GET/POST/DELETE /api/terminal/sessions`、
  `POST .../connect-ticket`（loopback-only）、WS 帧格式由 gateway 定义（adapter 负责翻译原生帧）；
  `GET /api/terminal/sessions` 在缺能力时仍 200 但 `supported:false`（不是空列表假象）。

#### (f) 架构守卫（改代码前先知道哪条会红）

| 守卫 | 位置 | 约束 |
|---|---|---|
| gateway 业务边界 | `gateway/tests/unit/runtime/architecture-boundaries.test.ts` | `routes/core/media/trajectory` + 抽出的 `experience/events/terminal` 与顶层业务文件不得读 runtime 名称/裸能力/诊断字段/私有路径；组合根 `index.ts` 的诊断例外**逐形态登记**（8 条），新增形态会让测试变红 |
| route → surface | `gateway/tests/unit/runtime/route-surface-catalog.test.ts` | 每个 gated route 的 operationId 必须在 catalog、surface 必须在 manifest、拒绝时中性 503/404（列表类 `supported:false`） |
| 历史 / SSE golden | `gateway/tests/unit/runtime/history-exit-golden.test.ts` | opencode/pi/claude 三种 native 输入 → 同一 flat 出口、同一 canonical `message.updated`；工具 id 与 live assembler 一致 |
| 删除面回归锁 | `gateway/tests/unit/runtime/wire-deletion-guards.test.ts` | wire-compat / legacy 路由 / 旧 SDK namespace 不得复活 |
| desktop | `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts` | `src/` 全域（除测试/故事）：无 runtime 名称/能力位/wire 形状/runtime SDK；Config 是唯一名称例外；`properties.info` 仅 3 个 session 生命周期文件 |
| TUI | `packages/tui/tests/experience-boundaries.test.ts` | 同一套边界 + 只走 `session.messages` |
| session-ui | `packages/session-ui/src/architecture.test.ts` | 渲染层不得出现 runtime 身份/能力位/wire 形状/runtime SDK；无例外清单 |

新增 runtime 时的最小自检顺序：`mafw plugin-check` → `mafw plugin-test`（conformance）→
本表 3 条 golden/守卫测试 → desktop/TUI 冒烟。

## 10. Definition of Done

- [ ] `name` / `createRuntime` / `capabilities` 正确导出，`external: true`；capabilities 只在模块侧声明一次。
- [ ] `mafw plugin-check <file> --preset <target>` 退出码 0（`--strict` 时 preset 缺面为空）。
- [ ] `core` 的 11 个 session 方法全部是函数；`session.create` 使用 `opts.directory`。
- [ ] 目标 preset 的 `requiredSurfaces` 在 `active.coverage.static.presets.<target>.missing` 中为空（或已记录接受的缺口）。
- [ ] 声明了 `eventStream` → 有 `eventSource` + `eventMappings`/`transformEvent`；`turn.*` / `part.*` 字段齐全。
- [ ] `tools.registerTools` + `tools.nativeTools` 已实现；工具事件可见（或走 out-of-process）。
- [ ] 认知面四动词已接（目标 preset 为 conversation 及以上）；时延/ fail-open 符合预算。
- [ ] `nativeApprovals` / `questionApi` / `providerConfigApi` 声明与实现一致；没有虚报。
- [ ] `normalizeMessages`（如目标 SDK 历史形状不同）已实现，且输出是 **flat** `MafwMessage[]`
      （无 `{info, parts}`；工具 part id = `toolpart_<callID>`；§9.7(a)）。
- [ ] `POST /api/runtime/conformance` 目标场景 PASS；`/api/runtime` 无新 hard/downgrade。
- [ ] 桌面/TUI 冒烟通过。

## 11. 常见失败模式

| 现象 | 根因 | 修复 |
|---|---|---|
| 插件加载但 `validation` 有 hard | 11 个 session 方法缺一个 / tools 缺 / eventStream 缺 `global.event` | 按 `hard` 消息补方法 |
| `eventStream` 自动变 false | 没有 `eventMappings` 或 `transformEvent` | 加翻译声明或 `canonicalIdentity()` 恒等行 |
| `eventTranslation self` 报矛盾 | 同时导出了 `eventTranslation:"self"` 和映射表 | 删掉一侧（declared 胜出，但状态会标 error） |
| 能力声明了但被降级 | 声明 true 但实例方法缺失 | 补方法或声明 false（`plugin-check` 会直接指出） |
| 实现了能力但没生效 | 忘了在 module.exports.capabilities 声明 | 反向校验会自动补 true + warning；把声明补上 |
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
