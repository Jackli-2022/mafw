# Gateway 全量融合：MCP + Memory + 编排统一进程

> **Goal**: 将 MCP Server、记忆系统（Harmonic Memory）、成本控制（Cost）全部嵌入 Gateway 进程，消除跨进程 HTTP 通信，实现单一进程/单一端口部署。

## 现状与问题

### 当前架构（3 进程）

```
Plugin (opencode 插件进程)
  ├── hooks / command / event / config
  └── 不管理 tools（已移除）

MCP Server (独立 stdio 进程, src/mcp-server.ts)
  ├── HarmonicIndexManager  ← 独立实例
  ├── CognitiveGraphManager ← 独立实例
  ├── CostEstimator
  ├── CognitiveRouter
  └── 9 个工具处理器
       └── HTTP POST → Gateway (/api/events, /api/work/*)

Gateway (独立 HTTP 进程, port 3000)
  ├── LangGraph 编排
  ├── Session 管理
  ├── Dashboard (port 3001)
  └── HTTP API (/register, /control, /health)
```

### 核心问题

| 问题 | 影响 |
|------|------|
| 记忆检索绕路：Agent → OpenCode → MCP stdio → MCP Server → (HTTP) → FS | `mafw_search_hybrid` 延迟 ~50ms，实际只需 ~0.01ms |
| 两套 HarmonicIndexManager 实例 | Plugin 和 MCP Server 各一份，内存浪费 |
| HTTP fire-and-forget 不可靠 | `httpPost()` 无重试，事件可能丢失 |
| 3 进程部署心智负担 | 调试、监控、回滚都需要考虑进程间状态 |
| 端口碎片化 | Gateway(3000) + Dashboard(3001) + 旧架构可能更多 |

## 目标架构（1 进程）

```
Gateway (单进程, 单端口 3000)
├── MCP SSE (/mcp)
│   ├── ListTools  → 9 个工具定义
│   └── CallTool   → 路由到 handlers/
│
├── MemoryService (内存单例)
│   ├── HarmonicIndexManager
│   ├── CognitiveGraphManager
│   ├── SaliencePerceptor
│   ├── EnergySystem
│   └── ReviewScheduler
│
├── CostService (内存单例)
│   ├── CostEstimator
│   └── CognitiveRouter
│
├── LangGraph Engine
│   ├── StateGraph → plan → execute → review → archive
│   └── FileCheckpointer
│
├── Dashboard (同端口)
│   ├── /api/* (REST)
│   └── /api/events?stream=true (SSE)
│
└── HTTP API
    ├── POST /register
    ├── POST /control
    ├── POST /api/work/{id}/validate
    ├── POST /api/work/{id}/complete
    ├── POST /api/events
    └── GET /health
```

### OpenCode 连接方式

OpenCode 通过 `mcpServers` 的 SSE transport 连接 Gateway：

```json
{
  "mcpServers": {
    "mafw": {
      "transports": [
        {
          "type": "sse",
          "url": "http://127.0.0.1:3000/mcp",
          "sessionId": "mafw"
        }
      ]
    }
  }
}
```

### Plugin 保留部分

Plugin **只保留** OpenCode Plugin 机制需要的部分：

| 模块 | 保留？ | 原因 |
|------|--------|------|
| hooks | ✅ | session.end, tool.execute.after, 上下文注入 |
| command | ✅ | /goal, /status 等用户命令 |
| event | ✅ | OpenCode 事件监听 |
| config | ✅ | Agent 映射配置 |
| tools | ❌ 移除 | 全部由 Gateway MCP SSE 提供 |

## 子系统设计

### 1. MCP SSE Transport

**文件**: `gateway/src/mcp/sse-transport.ts`

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse } from "http";

class McpSSEEndpoint {
  private server: Server;
  private transports: Map<string, SSEServerTransport> = new Map();

  constructor(toolRegistry: ToolRegistry) {
    this.server = new Server(
      { name: "mafw-mcp-server", version: "4.1.0" },
      { capabilities: { tools: {} } }
    );
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: toolRegistry.definitions,
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const handler = toolRegistry.handlers[req.params.name];
      if (!handler) throw new Error(`Unknown tool: ${req.params.name}`);
      return handler(req.params.arguments ?? {});
    });
  }

  // GET /mcp → SSE session 建立
  async handleSSE(req: IncomingMessage, res: ServerResponse) { /* ... */ }

  // POST /mcp → 收到客户端消息
  async handleMessage(req: IncomingMessage, res: ServerResponse) { /* ... */ }
}
```

`SSEServerTransport` 是 `@modelcontextprotocol/sdk` 原生支持的传输实现，管理 SSE 会话生命周期。

### 2. MemoryService

**文件**: `gateway/src/memory/service.ts`

```typescript
import { HarmonicIndexManager } from "./harmonic-index";
import { CognitiveGraphManager } from "./cognitive-graph";
import { EnergySystem } from "./energy-system";

export class MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  energy: EnergySystem;

  constructor(mafwDir: string) {
    this.harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.cognitiveGraph = new CognitiveGraphManager(
      path.join(mafwDir, "data", "knowledge-graph.json")
    );
    this.energy = new EnergySystem(mafwDir);
  }

  search(query: string, topK = 20) {
    return this.harmonicIndex.search(query, topK);
  }

  addMemory(unit: HarmonicUnit, tier: string) {
    // 原子写入 tier 文件 + 更新索引（旧逻辑压缩到一次事务）
    this.harmonicIndex.addEntry(unit, tier);
  }

  // ... 其他记忆操作
}
```

**关键变化**：所有工具处理器不再 `import('../memory/harmonic-index')` 动态创建实例，而是通过构造函数注入 `MemoryService` 单例。

### 3. CostService

**文件**: `gateway/src/cost/service.ts`

```typescript
import { CostEstimator } from "./estimator";
import { CognitiveRouter } from "./router";

export class CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;

  constructor() {
    this.estimator = new CostEstimator();
    this.router = new CognitiveRouter();
  }

  getModelRoute(agentType: string, remaining: number, total: number) {
    return this.router.selectModel(agentType, remaining, total);
  }
}
```

`CognitiveRouter` 当前在 `tools.ts` 中被 `new CognitiveRouter()` 创建——融合后统一从 `CostService` 获取。

### 4. 工具处理器（无网络调用）

每个工具处理器接收 `(args, deps)`——`deps` 包含 `MemoryService` 和 `CostService` 的单例引用：

```typescript
// handlers/search-hybrid.ts
import { ToolHandler } from "../tool-registry";
import { Services } from "../types";

export const handler: ToolHandler = async (args, { memory }) => {
  const query = args.query as string;
  const topK = (args.topK as number) || 20;
  const results = memory.search(query, topK);

  if (args.memoryType) {
    results = results.filter(r => r.memory_type === args.memoryType);
  }
  return { content: [{ type: "text", text: JSON.stringify({ results, count: results.length }) }] };
};
```

**所有 HTTP `fetch` 调用被移除**，包括：

| 工具 | 旧行为 | 新行为 |
|------|--------|--------|
| `mafw_create_goal` | `httpPost('/api/events')` | 直接调用 `eventBus.emit('goal_created')` |
| `mafw_update_state` | `httpPost('/api/events')` | 直接写 state 文件 + `eventBus.emit('state_change')` |
| `mafw_ask_user` | `httpPost('/api/events')` | 直接写 question 文件 + `eventBus.emit('user_question')` |
| `mafw_record_feedback` | `httpPost('/api/events')` | 直接写 feedback 文件 + `eventBus.emit('user_feedback')` |

### 5. 事件总线（替代 HTTP fire-and-forget）

Gateway 内部使用 `EventEmitter` 替代跨进程 HTTP 事件投递：

```typescript
// gateway/src/event-bus.ts
import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

// Dashboard SSE 订阅
eventBus.on("state_change", (data) => {
  broadcastToSSEClients({ type: "state_change", ...data });
});

// LangGraph 事件驱动
eventBus.on("state_change", (data) => {
  if (data.goalId) setImmediate(() => onEvent(data.goalId));
});
```

### 6. LangGraph 集成不变

LangGraph Engine 不需要改动——它已经是 Gateway 的一部分。唯一变化是 `buildNodeOptions()` 中的 `syncToFile` 可以复用 `eventBus` 而不是写 dashboard 文件。

### 7. Dashboard 同端口

Dashboard 不再需要独立端口 3001——通过 Gateway 的 HTTP server 路由：

```
GET /                → SPA 静态文件
GET /api/goals       → Dashboard API
GET /api/events?stream=true → SSE 事件流
```

使用 `req.url` 前缀路由：

```typescript
if (req.url?.startsWith("/api/dashboard/")) {
  // Dashboard REST
} else if (req.url === "/api/events" && req.method === "GET") {
  // SSE 流
} else if (req.url === "/mcp" && req.method === "GET") {
  // MCP SSE 会话建立
} else if (req.url === "/mcp" && req.method === "POST") {
  // MCP 消息
} else {
  // SPA 静态文件 / 现有 HTTP API
}
```

## 文件清单

### 新增文件（3）

| 文件 | 说明 |
|------|------|
| `gateway/src/mcp/sse-transport.ts` | MCP SSE 端点，会话管理 |
| `gateway/src/mcp/tool-registry.ts` | 9 个工具 definitions + 路由 |
| `gateway/src/event-bus.ts` | 进程内 EventEmitter 替代 HTTP fire-and-forget |

### 迁移文件（从 src/ 移入 gateway/src/）

以下文件通过 `git mv` 物理移动：

| 源路径 | 目标路径 |
|--------|----------|
| `src/memory/` (整个目录) | `gateway/src/memory/` |
| `src/graph/` (整个目录) | `gateway/src/graph/` |
| `src/cost/` (整个目录) | `gateway/src/cost/` |
| `src/mcp/tools.ts` (工具逻辑拆入 handlers/) | `gateway/src/mcp/handlers/*.ts` |

### 修改文件（4）

| 文件 | 改动 |
|------|------|
| `gateway/src/index.ts` | 初始化顺序：initServices → startSSE → startHTTP → startDashboard。不再 spawn MCP Server |
| `gateway/package.json` | 添加 `@modelcontextprotocol/sdk` 依赖 |
| `src/plugin.ts` | 移除 `tool:` 段（~80 行） |
| `src/mcp-server.ts` | 废弃，标记 `@deprecated` |

### 删除文件（1）

| 文件 | 原因 |
|------|------|
| `src/mcp-server.ts` | 独立 MCP Server 进程不再需要 |

## 实现计划（3 天）

### Day 1: MCP SSE 端点

- [ ] `gateway/package.json` 添加 `@modelcontextprotocol/sdk` 锁定到当前 OpenCode MCP Client 兼容版本（不可用 `^`）
- [ ] 实现 `gateway/src/mcp/sse-transport.ts`
- [ ] 实现 `gateway/src/mcp/tool-registry.ts`（definitions 只从 tools.ts 复制定义，不包含 handler 逻辑）
- [ ] `gateway/src/index.ts` 添加 `/mcp` GET+POST 路由
- [ ] 验证：OpenCode 能通过 SSE 连接并列出 9 个工具

### Day 2: 内存单例 + 处理器迁移

- [ ] `git mv src/memory/ gateway/src/memory/`
- [ ] `git mv src/cost/ gateway/src/cost/`
- [ ] 实现 `gateway/src/memory/service.ts`（MemoryService 单例）
- [ ] 实现 `gateway/src/cost/service.ts`（CostService 单例）
- [ ] 实现 `gateway/src/event-bus.ts`
- [ ] 逐一迁移 9 个工具处理器到 `handlers/*.ts`，注入 MemoryService/CostService
- [ ] 修改 `tools.ts` 中的 `httpPost()` 调用为 `eventBus.emit()`
- [ ] 验证：`mafw_search_hybrid` 和 `mafw_add_memory` 通过 SSE 调用成功

### Day 3: Plugin 清理 + 部署灰度

- [ ] `src/plugin.ts` 移除 `tool:` 段
- [ ] `src/mcp-server.ts` 标记 `@deprecated`
- [ ] Dashboard 同端口整合（不再需要 port 3001）
- [ ] 实现 `ENABLE_LEGACY_MCP` 回滚开关
- [ ] 更新 `opencode.json.example` 为 SSE transport 配置
- [ ] 端到端测试：Agent 调 MCP 工具 → Gateway → MemoryService → 返回结果

## 回滚策略

```typescript
// gateway/src/index.ts
const enableLegacy = process.env.ENABLE_LEGACY_MCP === "true";

if (enableLegacy) {
  // 同时启动旧 MCP Server 进程（兜底）
  spawn("node", ["dist/mcp-server.js"], { stdio: "inherit" });
  // SSE 端点与旧 stdio 路径并行
}
```

## 决策记录

| # | 决策 | 理由 |
|---|------|------|
| 1 | SSE 传输替代 stdio | OpenCode 原生支持 SSE transport，无需 stdio 桥接 |
| 2 | 内存单例替代动态 import | 消除每个工具调用都 new HarmonicIndexManager 的开销 |
| 3 | EventEmitter 替代 HTTP fire-and-forget | 进程内事件投递可靠、零延迟 |
| 4 | Dashboard 同端口 3000 | 减少端口碎片，简化部署 |
| 5 | `git mv` 保留历史 | 文件移动后 git blame 仍可追溯 |
| 6 | `@modelcontextprotocol/sdk` 锁定版本 | 避免 SSE 传输协议不兼容 |
