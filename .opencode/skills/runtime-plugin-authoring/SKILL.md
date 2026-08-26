---
name: runtime-plugin-authoring
description: 为 MAFW Gateway 编写 Runtime 插件的完整指南。覆盖能力契约（Tier 0/1/2）、CJS 插件格式、事件归一化、可选接口、激活与测试。当需要接入新的 agent runtime（如 pi-coding-agent、claude、自定义 LLM 服务）时使用此 skill。
---

# MAFW Runtime Plugin 编写指南

## 概述

MAFW Gateway 通过**能力契约**（Runtime Capability Contract）与 agent runtime 解耦。插件是一个 CJS `.js` 文件，放在 `~/.mafw/runtime-plugins/` 目录下，声明自己支持的能力等级，gateway 按能力集自动开关功能。

**核心原则：**
- **能力自声明**：插件声明能力，gateway 按能力降级（缺能力 → 503 或跳过，永不崩溃）
- **Fail-open**：插件加载/运行失败 → 自动回退到内置 opencode runtime
- **无热加载**：runtime 是 gateway 的基础设施层（事件流/sidecar 建立其上），修改后需重启 gateway

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

## 第三步：事件归一化

### 事件形状

Gateway 的事件归一化器 `normalizeOpencodeEvent()` 接受两种形状：

```typescript
// 信封形状（GlobalEvent wrapper）
{ payload: { type: "string", properties: {...}, sessionID: "..." } }

// 扁平形状
{ type: "string", properties: {...}, sessionID: "..." }
```

**推荐：** 让你的 runtime 事件尽可能接近 opencode 事件形状，这样 `normalizeOpencodeEvent()` 可直接使用，无需写新归一化器。

### 关键事件类型（opencode 参考）

| 事件类型 | EventFacets 映射 | 说明 |
|----------|-----------------|------|
| `message.part.updated` | `step`（settled step）+ `chatSignal: 'delta'` | 流式文本输出 |
| `message.updated` | `step`（completed message）+ `chatSignal: 'complete'` | 消息完成 |
| `session.idle` | `chatSignal: 'complete'` + `broadcast: 'idle'` | 会话空闲 |
| `session.error` | `chatSignal: 'error'` + `broadcast: 'error'` | 会话错误 |
| `session.next.step.ended` | `step`（legacy 兜底） | 步骤结束（旧版） |

### EventFacets 正交切面

```typescript
interface EventFacets {
  type: string;           // 原始类型（透传）
  properties: any;        // 原始属性（透传）
  sessionID?: string;
  directory?: string;
  step: StepEndedProps | null;  // 已结算的 LLM step
  chatSignal: 'delta' | 'complete' | 'error' | null;  // chat 信号
  deltaText?: string;
  chatError?: unknown;
  broadcast: 'idle' | 'error' | 'passthrough';  // 全局广播
  toolCommand?: string;   // shell 命令（自更新定位用）
}
```

### 自定义事件流

若你的 runtime 事件形状与 opencode 差异大，需要：
1. 写新归一化函数（如 `normalizeMyRuntimeEvent(evt): EventFacets`）
2. 修改 `gateway/src/index.ts` 的事件分发逻辑，根据 `runtimeName` 选择归一化器

**简单路径：** 让你的 runtime 发出 opencode 兼容事件，无需改 gateway 代码。

## 第四步：激活与测试

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

## 第五步：参考实现

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

### 1. 忘记重启 gateway
插件无热加载。修改 `.js` 文件后必须重启：
```bash
mafw restart
```

### 2. 能力声明与实际实现不匹配
声明了 `eventStream: true` 但 `global.event()` 未实现 → 事件订阅失败。

**规则：** 声明的能力必须有对应实现；未实现的能力声明为 `false`。

### 3. 事件形状不兼容
自定义事件形状与 `normalizeOpencodeEvent()` 不兼容 → 归一化失败。

**解决：** 
- 优先让事件形状接近 opencode（见"事件归一化"章节）
- 或写新归一化器并修改 `index.ts` 的事件分发

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
- **参考实现**：`gateway/src/runtime/opencode-runtime.ts`
- **Agent 定义模型**：`gateway/src/runtime/agent-definition.ts`
- **Gateway 激活逻辑**：`gateway/src/index.ts:814`（`createRuntime()` 方法）
- **能力守卫**：`gateway/src/index.ts:800`（`capGuard()` 方法）

## 总结

编写 MAFW runtime 插件的核心步骤：

1. **理解能力分级**（Tier 0/1/2），选择需要的能力
2. **编写 CJS 插件**（`module.exports`），声明能力 + 实现 `createRuntime(ctx)`
3. **处理事件归一化**（优先兼容 opencode 事件形状）
4. **激活与测试**（config.yaml 或环境变量，重启 gateway，检查 `/api/runtime`）
5. **参考内置实现**（`opencode-runtime.ts` 是完整的 Tier 2 参考）

**关键原则：**
- 能力自声明 + fail-open 降级
- 无热加载，修改后需重启
- 插件失败自动回退 opencode
- 事件形状尽量兼容 opencode 归一化器

遵循这些原则，你的 runtime 插件可以无缝接入 MAFW gateway，享受记忆系统、自动化、桌面 UI 等全套功能。
