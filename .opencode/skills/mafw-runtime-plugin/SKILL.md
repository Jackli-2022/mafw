---
name: mafw-runtime-plugin
description: 编写 MAFW Gateway runtime 插件（~/.mafw/runtime-plugins/*.js），把新 agent runtime（pi-coding-agent / claude / 自研 ...）接入网关。覆盖插件契约形状、能力声明分级、ctx 使用、可选接口（credentials/agents/listByDirectory/external）、测试与排错。触发词：写 runtime 插件 / 接入新 runtime / runtime plugin / 插件编写。
---

# MAFW Runtime 插件编写 Skill

把一个新的 agent runtime 接入 MAFW gateway，只需在 `~/.mafw/runtime-plugins/` 放一个 `.js` 文件。本 Skill 说明契约形状、能力分级、如何实现各接口、如何测试。

## 0. 前置理解：契约模型

gateway 与 runtime 之间是**能力自声明契约**（`gateway/src/runtime/`）：

- 插件声明 `capabilities` → gateway 按能力集开关功能（缺能力 = 功能降级，**永不崩溃**，fail-open）
- 插件返回 `AgentRuntime` 对象 → gateway 通过它调用 runtime 的会话 API
- 插件默认视为**外部托管**（`external: true`），gateway 不 spawn 你的进程
- 改动插件后**重启 gateway 生效**（无热加载，`mafw-gateway-restart` skill）

**能力分级（Tier）：**

| Tier | 能力 | gateway 功能 |
|---|---|---|
| 0 | `sessionApi` + `promptWhileBusy` | 协作协议（Goal/问答/反馈）+ per-turn 记忆 |
| 1 | + `eventStream` | 自治执行（Goal plan/execute/review）+ per-step 记忆 |
| 2 | + 全能力 | 桌面聊天面完整 |

## 1. 最小插件骨架

```js
// ~/.mafw/runtime-plugins/my-runtime.js
module.exports = {
  name: "my-runtime",
  // 合并到 Tier-0 基线（sessionApi + promptWhileBusy 已默认 true）
  capabilities: { eventStream: false },
  async createRuntime(ctx) {
    return {
      name: "my-runtime",
      capabilities: { eventStream: false },
      session: { /* 见 §2 */ },
      global: { async event() { return { stream: [] }; } },
      getBaseUrl() { return "http://127.0.0.1:PORT"; },
    };
  },
};
```

## 2. 必须实现的接口

`createRuntime(ctx)` 返回 `AgentRuntime`，必选字段：

```js
{
  name: "my-runtime",                    // 与 module.exports.name 一致
  capabilities: { /* 与插件顶部声明一致 */ },
  session: {
    async create({ directory }) { return { id }; },            // → {id}
    async promptAsync({ sessionID, parts, message, agent, model }) {},  // → void（追加消息）
    async prompt({ sessionID, message }) { return { parts }; },         // → {parts, ...}
    async messages({ sessionID, limit, before }) { return { data, nextCursor }; },
    async get({ sessionID }) {},
    async delete({ sessionID }) {},
    async abort({ sessionID }) {},
    async list({ directory }) { return []; },
    async todo({ sessionID }) { return []; },
    async children({ sessionID }) { return []; },
    async summarize({ sessionID, providerID, modelID }) {},
  },
  global: {
    async event() { return { stream: <AsyncIterable> }; },  // 事件流，Tier 1 必需
  },
  provider: { async list() { return { all: [], connected: [], default: {} }; } },
  app: { async agents() { return []; } },
  config: { async get() {}, async update(c) {} },
  getBaseUrl() { return "..."; },          // serve 进程地址
  // 可选：
  async healthCheck() { return true; },
  credentials: { getApiKey(provider) { return null; } },
  agents: { async install(name, definition) {}, async remove(name) {} },
  session: { /* 可加 */ listByDirectory(directory, limit) { return []; } },
}
```

## 3. ctx（插件上下文）

`createRuntime(ctx)` 收到的 `ctx`：

| 字段 | 说明 |
|---|---|
| `ctx.fetch(url, opts)` | fetch，默认 60s 超时（`AbortSignal.timeout(60000)`） |
| `ctx.log` | `{ info, warn, error, debug }`，写入 gateway 文件日志 |
| `ctx.pluginConfig(name)` | 读 `config.yaml` 的 `runtime.pluginConfig[name]`（per-plugin 配置） |

## 4. 可选接口（按需实现）

### 4a. credentials — 凭据获取
```js
credentials: {
  getApiKey(provider) {   // 如 'xiaomi'
    return mySecretStore.get(provider);  // 或 null
  },
}
```
实现后 media 服务优先走 `runtime.credentials.getApiKey(p)`，**回退**直读 opencode `auth.json`。不实现 = 用回退。

### 4b. agents — agent 定义安装
```js
// 需声明 capabilities: { agentConfigApi: true }
agents: {
  async install(name, definition) {
    // definition 是运行时中立模型（§5），翻译成你 runtime 的 agent 配置格式
  },
  async remove(name) {},
}
```
不实现/不声明 → gateway 跳过安装 + warn 日志，manager 功能降级但不崩。

### 4c. session.listByDirectory — 直读会话存储
```js
// 需声明 capabilities: { sessionStorageApi: true }
session: {
  async listByDirectory(directory, limit) { return [SessionInfo]; },
}
```
实现后按目录直接查会话（opencode 用 SQLite）。缺失 → gateway 回退 `session.list` + 客户端目录过滤（缺点：worktree/sandbox 会话可能丢失，见 §6 已知局限）。

### 4d. external + getBaseUrl — 托管模式
- `external: true`（默认）→ gateway **不 spawn、不 kill** 你的进程，watchdog 只健康探测 + 事件流重连
- `external: false` → 需配合 `MAFW_SERVER_SERVE_URL`（插件场景罕见）
- `getBaseUrl()` 返回 serve 地址，`healthCheck()` 供 watchdog 探测

## 5. AgentDefinition（agents.install 的参数）

运行时中立模型，**翻译职责在你的 runtime 实现侧**：

```js
{
  description: "Manager Agent — 项目自治管理",
  mode: "primary",            // 'primary' | 'subagent' | 'all'
  model: "provider/model",    // 可省略
  temperature: 0.0,
  color: "#46DC82",
  systemPrompt: "...",        // 正文
  permissions: {
    edit: "deny",                    // 文件修改类工具
    bash: "allow",                   // shell 执行
    task: { general: "deny" },       // 子任务派发，按 subagent 名
    tools: { mafw_set_goal: "allow", /* 其余按工具名 */ },
  },
}
// PermissionRule: 'allow' | 'deny' | 'ask'
```
opencode 的翻译参考：`gateway/src/runtime/opencode-runtime.ts` 的 `serializeAgentToFrontmatter`。

## 6. 激活与排错

```yaml
# .mafw/config.yaml
runtime:
  plugin: my-runtime          # 匹配 module.exports.name
  pluginConfig: {}            # per-plugin 配置（ctx.pluginConfig 读取）
```
或环境变量 `MAFW_RUNTIME_PLUGIN=my-runtime`。未知/失败的插件自动回退内置 opencode（fail-open）。

**排错：**
- `GET /api/runtime` 返回 `{ active, plugins }` — 查看插件加载状态
- `~/.mafw/logs/mafw.log` 搜 `[RuntimePluginLoader]` — 加载错误信息
- 常见错误：缺 `name`（`missing name`）、缺 `createRuntime`（`missing createRuntime(ctx)`）、重名（`duplicate name`）
- 改插件后**重启 gateway** 生效

**已知局限（fallback 路径）：** 未实现 `sessionStorageApi` 的 runtime，会话列表用 `session.list` + 客户端过滤，无法解析 worktree/sandbox 会话归属——opencode 用 SQLite 直读解决，其他 runtime 若需要完整会话归属应实现 `listByDirectory`。

## 7. 测试

参考测试文件：
- `gateway/tests/unit/runtime/loader.test.ts` — loader 契约校验（13 例）
- `gateway/tests/unit/runtime/integration.test.ts` — 全链路（load → createRuntime → 能力门）
- `tests/unit/gateway/runtime-agents-install.test.ts` — AgentDefinition → frontmatter 字节级回归
- `tests/unit/gateway/runtime-credentials.test.ts` — credentials 回退链

测试约定：测试放 `tests/unit/gateway/`（导入 `../../../gateway/src/...`，**不带** `.js` 后缀）；或 `gateway/tests/unit/`（gateway 包内自测）。跑：`npm run build` + `npx jest <你的测试>`。

## 8. 参考实现

- 内置恒等实现：`gateway/src/runtime/opencode-runtime.ts`（全能力，含 SQLite/auth/agents 实现）
- 契约定义：`gateway/src/runtime/contract.ts`
- 中立模型：`gateway/src/runtime/agent-definition.ts`
- 加载器：`gateway/src/runtime/loader.ts`
