# Gateway 全量融合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed MCP Server tools + Memory System + Cost System into Gateway process, replacing stdio transport with SSE, eliminating all HTTP fire-and-forget calls.

**Architecture:** Gateway (single process, port 3000) hosts MCP SSE endpoint, MemoryService singleton, CostService singleton, LangGraph orchestration, and Dashboard REST/SSE — all in one address space. Plugin retains only hooks/command/event/config.

**Tech Stack:** @modelcontextprotocol/sdk (SSEServerTransport), EventEmitter (in-process event bus), existing HarmonicIndexManager/CostEstimator classes imported via shared source path.

## Global Constraints

- Gateway `package.json` must pin `@modelcontextprotocol/sdk` to exact version (no `^` prefix) matching OpenCode's MCP client
- All `httpPost()` calls in tool handlers must be replaced with `eventBus.emit()` — zero network calls
- `ENABLE_LEGACY_MCP=true` env var must restore old MCP Server process for safe rollback
- Gateway's `tsconfig.json` must include `"../src/**/*"` to access memory/cost shared source
- Plugin's `src/plugin.ts` must NOT be modified (the `tool:` section was already removed in prior work)
- Tool handler migration must preserve exact tool names, input schemas, and return types from current `src/mcp/tools.ts`

---

### Task 1: Gateway Foundation — deps, tsconfig, event bus, types

**Files:**
- Modify: `gateway/package.json`
- Modify: `gateway/tsconfig.json`
- Create: `gateway/src/event-bus.ts`
- Create: `gateway/src/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `eventBus` (EventEmitter singleton), `Services` interface (MemoryService + CostService type), `ToolHandler` type

- [ ] **Step 1: Add @modelcontextprotocol/sdk dependency**

Edit `gateway/package.json` to add the MCP SDK dependency:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.0.0",
    "@opencode-ai/sdk": "^1.17.12"
  }
}
```

Run: `cd gateway && npm install`

- [ ] **Step 2: Extend tsconfig to include shared source**

Edit `gateway/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "nodenext"
  },
  "include": ["src/**/*", "../src/**/*"]
}
```

- [ ] **Step 3: Create event bus**

Create `gateway/src/event-bus.ts`:

```typescript
import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type GatewayEvent =
  | { type: "goal_created"; goalId: string; projectDir: string }
  | { type: "state_change"; goalId: string; patch: Record<string, unknown>; projectDir: string }
  | { type: "user_question"; goalId: string; questionId: string }
  | { type: "user_feedback"; goalId: string; targetId: string; feedbackType: string }
  | { type: string; [key: string]: unknown };
```

- [ ] **Step 4: Create shared types**

Create `gateway/src/types.ts`:

```typescript
import type { HarmonicIndexManager } from "../../src/memory/harmonic-index";
import type { CognitiveGraphManager } from "../../src/memory/cognitive-graph";
import type { CostEstimator } from "../../src/cost/cost-estimator";
import type { CognitiveRouter } from "../../src/cost/cognitive-router";

export interface MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  search(query: string, topK?: number): ReturnType<HarmonicIndexManager["search"]>;
}

export interface CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;
  getModelRoute(agentType: string, remaining: number, total: number): { model: string; reason: string };
}

export interface Services {
  memory: MemoryService;
  cost: CostService;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  services: Services
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
```

- [ ] **Step 5: Verify build**

Run: `cd gateway && npx tsc --noEmit`
Expected: Compilation succeeds (may show warnings about unused imports, that's fine)

---

### Task 2: MemoryService + CostService singletons

**Files:**
- Create: `gateway/src/memory/service.ts`
- Create: `gateway/src/cost/service.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager` from `../../src/memory/harmonic-index`, `CostEstimator`/`CognitiveRouter` from `../../src/cost/`
- Produces: `MemoryService` class, `CostService` class

- [ ] **Step 1: Create MemoryService**

Create `gateway/src/memory/service.ts`:

```typescript
import * as path from "path";
import { HarmonicIndexManager } from "../../../src/memory/harmonic-index";
import { CognitiveGraphManager } from "../../../src/memory/cognitive-graph";

export class MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;

  constructor(mafwDir: string) {
    this.harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.cognitiveGraph = new CognitiveGraphManager(
      path.join(mafwDir, "data", "knowledge-graph.json")
    );
  }

  search(query: string, topK = 20) {
    return this.harmonicIndex.search(query, topK);
  }
}
```

- [ ] **Step 2: Create CostService**

Create `gateway/src/cost/service.ts`:

```typescript
import { CostEstimator } from "../../../src/cost/cost-estimator";
import { CognitiveRouter } from "../../../src/cost/cognitive-router";

export class CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;

  constructor() {
    this.estimator = new CostEstimator();
    this.router = new CognitiveRouter();
  }

  getModelRoute(agentType: "plan" | "execute" | "review", remainingBudget: number, totalBudget: number) {
    return this.router.selectModel(agentType, remainingBudget, totalBudget);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd gateway && npx tsc --noEmit`
Expected: Compilation succeeds

---

### Task 3: MCP SSE Transport

**Files:**
- Create: `gateway/src/mcp/sse-transport.ts`
- Create: `gateway/src/mcp/tool-registry.ts`

**Interfaces:**
- Consumes: `Services` from `../types`, tool definitions + handlers
- Produces: `McpSSEEndpoint` class with `handleSSE(req, res)` methods

- [ ] **Step 1: Create MCP SSE endpoint**

Create `gateway/src/mcp/sse-transport.ts`:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IncomingMessage, ServerResponse } from "http";
import { ToolRegistry } from "./tool-registry";
import { Services } from "../types";

export class McpSSEEndpoint {
  private server: Server;
  private transports: Map<string, SSEServerTransport> = new Map();
  private services: Services;

  constructor(toolRegistry: ToolRegistry, services: Services) {
    this.services = services;

    this.server = new Server(
      { name: "mafw-mcp-server", version: "4.1.0" },
      { capabilities: { tools: {} } }
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolRegistry.definitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const handler = toolRegistry.handlers[req.params.name];
      if (!handler) {
        throw new Error(`Unknown tool: ${req.params.name}`);
      }
      const args = req.params.arguments ?? {};
      return handler(args as Record<string, unknown>, this.services);
    });
  }

  async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/mcp", res);
    const sessionId = transport.sessionId;
    this.transports.set(sessionId, transport);

    res.on("close", () => {
      this.transports.delete(sessionId);
    });

    await this.server.connect(transport);
  }

  async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") || "";

    // SSE transport sends POST /mcp?sessionId=xxx with JSON body
    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    // SSEServerTransport.handlePostMessage reads req body internally
    await transport.handlePostMessage(req, res);
  }
}
```

- [ ] **Step 2: Create tool registry**

Create `gateway/src/mcp/tool-registry.ts`:

```typescript
import { ToolDefinition, ToolHandler } from "../types";

export interface ToolRegistry {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

// Schema definitions only — handler implementations in handlers/
// All 9 tool names and schemas copied verbatim from src/mcp/tools.ts
const DEFINITIONS: ToolDefinition[] = [
  {
    name: "mafw_create_goal",
    description: "Create a new MAFW goal with charter and request files",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Unique goal identifier (e.g. 003-foo)" },
        title: { type: "string", description: "Human-readable goal title" },
        charter: { type: "string", description: "Goal charter content in markdown" },
        source: { type: "string", description: "Source of the goal request", default: "user" },
        metrics: {
          type: "object",
          description: "Success metrics key-value pairs",
          additionalProperties: { type: "object", properties: { target: { type: "number" }, unit: { type: "string" } } }
        },
        boundaries: { type: "array", items: { type: "string" }, description: "Boundary constraints" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Goal priority", default: "medium" },
        maxLoops: { type: "number", description: "Maximum loop iterations", default: 5 },
      },
      required: ["goalId", "title", "charter"],
    },
  },
  {
    name: "mafw_update_state",
    description: "Update the state file for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        patch: { type: "object", description: "Partial state fields to update" },
      },
      required: ["goalId", "patch"],
    },
  },
  {
    name: "mafw_search_hybrid",
    description: "Search memory units using BM25 + vector hybrid retrieval",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        topK: { type: "number", description: "Maximum results to return", default: 20 },
        memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional memory type filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "mafw_get_deltas",
    description: "Get parametric L3 deltas for a goal and agent phase",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        agentType: { type: "string", enum: ["plan", "execute", "review"], description: "Target agent type" },
        loopNum: { type: "number", description: "Current loop number" },
      },
      required: ["goalId", "agentType"],
    },
  },
  {
    name: "mafw_load_state",
    description: "Load the current state file for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_ask_user",
    description: "Ask the user a non-blocking question during execution",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question to ask the user" },
        goalId: { type: "string", description: "Goal identifier" },
        loopNum: { type: "number", description: "Current loop number" },
        options: { type: "array", items: { type: "string" }, description: "Optional answer choices" },
        priority: { type: "string", enum: ["normal", "high"], description: "Question priority", default: "normal" },
      },
      required: ["question", "goalId", "loopNum"],
    },
  },
  {
    name: "mafw_record_feedback",
    description: "Record user feedback for alignment energy adjustment",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Target identifier (e.g. wave-1, task-2)" },
        type: { type: "string", enum: ["thumbs_up", "thumbs_down", "correction"], description: "Feedback type" },
        goalId: { type: "string", description: "Goal identifier" },
        loopNum: { type: "number", description: "Current loop number" },
        comment: { type: "string", description: "Optional feedback comment" },
      },
      required: ["targetId", "type", "goalId", "loopNum"],
    },
  },
  {
    name: "mafw_get_model_route",
    description: "Get the recommended model route for an agent based on budget",
    inputSchema: {
      type: "object",
      properties: {
        agentType: { type: "string", enum: ["plan", "execute", "review"], description: "Agent type to route" },
        remainingBudget: { type: "number", description: "Remaining token budget" },
        totalBudget: { type: "number", description: "Total available token budget" },
      },
      required: ["agentType", "remainingBudget", "totalBudget"],
    },
  },
  {
    name: "mafw_add_memory",
    description: "Save a memory unit to the harmonic memory system",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content text to remember" },
        memoryType: { type: "string", enum: ["semantic", "episodic", "procedural", "global"], description: "Memory type" },
        cueAnchors: { type: "array", items: { type: "string" }, description: "Tags/keywords for retrieval (max 8)" },
        primaryAbstraction: { type: "string", description: "6-8 word summary (auto-generated from content if omitted)" },
      },
      required: ["content", "memoryType"],
    },
  },
];
```

- [ ] **Step 3: Import handlers and build registry**

Add to the bottom of `gateway/src/mcp/tool-registry.ts`:

```typescript
import { handleCreateGoal } from "./handlers/create-goal";
import { handleUpdateState } from "./handlers/update-state";
import { handleSearchHybrid } from "./handlers/search-hybrid";
import { handleGetDeltas } from "./handlers/get-deltas";
import { handleLoadState } from "./handlers/load-state";
import { handleAskUser } from "./handlers/ask-user";
import { handleRecordFeedback } from "./handlers/record-feedback";
import { handleGetModelRoute } from "./handlers/get-model-route";
import { handleAddMemory } from "./handlers/add-memory";

export function createToolRegistry(): ToolRegistry {
  return {
    definitions: DEFINITIONS,
    handlers: {
      mafw_create_goal: handleCreateGoal,
      mafw_update_state: handleUpdateState,
      mafw_search_hybrid: handleSearchHybrid,
      mafw_get_deltas: handleGetDeltas,
      mafw_load_state: handleLoadState,
      mafw_ask_user: handleAskUser,
      mafw_record_feedback: handleRecordFeedback,
      mafw_get_model_route: handleGetModelRoute,
      mafw_add_memory: handleAddMemory,
    },
  };
}
```

---

### Task 4: Migrate all 9 tool handlers

**Files:**
- Create: `gateway/src/mcp/handlers/create-goal.ts`
- Create: `gateway/src/mcp/handlers/update-state.ts`
- Create: `gateway/src/mcp/handlers/search-hybrid.ts`
- Create: `gateway/src/mcp/handlers/get-deltas.ts`
- Create: `gateway/src/mcp/handlers/load-state.ts`
- Create: `gateway/src/mcp/handlers/ask-user.ts`
- Create: `gateway/src/mcp/handlers/record-feedback.ts`
- Create: `gateway/src/mcp/handlers/get-model-route.ts`
- Create: `gateway/src/mcp/handlers/add-memory.ts`

**Interfaces:**
- Consumes: `Services` (memory, cost from `../../types`), `eventBus` from `../../event-bus`
- Produces: 9 `ToolHandler` functions

**Pattern for all handlers:** Replace `httpPost()` with `eventBus.emit()`, replace `new HarmonicIndexManager(...)` with `services.memory.harmonicIndex`.

- [ ] **Step 1: Create handler directory**

Run: `mkdir -p gateway/src/mcp/handlers`

- [ ] **Step 2: Migrate create-goal.ts**

Create `gateway/src/mcp/handlers/create-goal.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleCreateGoal: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const title = args.title as string;
    const charter = args.charter as string;
    const source = (args.source as string) || "user";
    const metrics = (args.metrics as Record<string, { target: number; unit: string }>) || {};
    const boundaries = (args.boundaries as string[]) || [];
    const priority = (args.priority as string) || "medium";
    const maxLoops = (args.maxLoops as number) || 5;

    const mafwDir = path.join(projectDir, ".opencode/mafw");
    const goalsDir = path.join(mafwDir, "goals");
    const requestsDir = path.join(mafwDir, "requests");
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.mkdirSync(requestsDir, { recursive: true });

    const charterPath = path.join(goalsDir, `${goalId}.md`);
    if (fs.existsSync(charterPath)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Goal ${goalId} already exists` }) }], isError: true };
    }

    fs.writeFileSync(charterPath, charter, "utf-8");

    const request = {
      version: "2", goalId, title, state: "draft",
      createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
      source, projectDir, mafwDir, goalCharter: charterPath,
      metrics, boundaries, priority, maxLoops, parallel: false,
      degradeOnLoop: Math.ceil(maxLoops * 0.6),
    };

    const requestPath = path.join(requestsDir, `${goalId}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf-8");

    // Replace httpPost with eventBus.emit
    eventBus.emit("goal_created", { type: "goal_created", goalId, projectDir });

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, goalId, charterPath, requestPath }) }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 3: Migrate update-state.ts**

Create `gateway/src/mcp/handlers/update-state.ts`:

```typescript
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

// Reuse the existing updateState utility
async function updateState(goalId: string, patch: Record<string, unknown>): Promise<any> {
  const mafwDir = path.join(projectDir, ".opencode/mafw");
  const statePath = path.join(mafwDir, "state", `${goalId}.json`);
  const state = JSON.parse(require("fs").readFileSync(statePath, "utf-8"));
  const updated = { ...state, ...patch, updatedAt: new Date().toISOString() };
  const tmpPath = `${statePath}.tmp`;
  require("fs").writeFileSync(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
  require("fs").renameSync(tmpPath, statePath);
  return updated;
}

export const handleUpdateState: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const patch = args.patch as Record<string, unknown>;
    const state = await updateState(goalId, patch);
    eventBus.emit("state_change", { type: "state_change", goalId, patch, projectDir });
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 4: Migrate search-hybrid.ts**

Create `gateway/src/mcp/handlers/search-hybrid.ts`:

```typescript
import { ToolHandler } from "../../types";

export const handleSearchHybrid: ToolHandler = async (args, { memory }) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || 20;
    const results = memory.search(query, topK);

    let filtered = results;
    if (args.memoryType) {
      filtered = filtered.filter((r: any) => r.memory_type === args.memoryType);
    }

    return { content: [{ type: "text", text: JSON.stringify({ results: filtered, count: filtered.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 5: Migrate get-deltas.ts**

Create `gateway/src/mcp/handlers/get-deltas.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleGetDeltas: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const agentType = args.agentType as string;
    const loopNum = (args.loopNum as number) || 1;

    const parametricDir = path.join(projectDir, ".opencode/mafw/parametric");
    const deltas: any[] = [];

    if (fs.existsSync(parametricDir)) {
      const files = fs.readdirSync(parametricDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(parametricDir, file), "utf-8");
          const yaml = await import("js-yaml");
          const doc = yaml.load(content) as any;
          if (doc && doc.scope && doc.scope.includes(agentType)) {
            deltas.push({ ...doc, sourceFile: file });
          }
        } catch { /* skip malformed */ }
      }
    }

    const manifestPath = path.join(parametricDir, "manifest.json");
    const manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      try { Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, "utf-8"))); } catch {}
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ goalId, agentType, loopNum, deltas, manifest }) }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 6: Migrate load-state.ts**

Create `gateway/src/mcp/handlers/load-state.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleLoadState: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const statePath = path.join(projectDir, ".opencode/mafw/state", `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `State not found for ${goalId}` }) }], isError: true };
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 7: Migrate ask-user.ts**

Create `gateway/src/mcp/handlers/ask-user.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleAskUser: ToolHandler = async (args) => {
  try {
    const question = args.question as string;
    const goalId = args.goalId as string;
    const loopNum = args.loopNum as number;
    const options = args.options as string[] | undefined;
    const priority = (args.priority as string) || "normal";

    const questionDir = path.join(projectDir, ".opencode/mafw/user-questions", goalId);
    fs.mkdirSync(questionDir, { recursive: true });

    const questionId = `${goalId}-q-${Date.now()}`;
    const questionFile = {
      id: questionId, goalId, loopNum, question, options, priority,
      status: "pending", createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(questionDir, `${questionId}.json`),
      JSON.stringify(questionFile, null, 2),
      "utf-8"
    );

    eventBus.emit("user_question", { type: "user_question", goalId, questionId });

    return { content: [{ type: "text", text: JSON.stringify({ success: true, questionId, status: "pending" }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 8: Migrate record-feedback.ts**

Create `gateway/src/mcp/handlers/record-feedback.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleRecordFeedback: ToolHandler = async (args) => {
  try {
    const targetId = args.targetId as string;
    const type = args.type as "thumbs_up" | "thumbs_down" | "correction";
    const goalId = args.goalId as string;
    const loopNum = args.loopNum as number;
    const comment = args.comment as string | undefined;

    const feedback = { targetId, type, goalId, loopNum, comment, createdAt: new Date().toISOString() };

    const feedbackDir = path.join(projectDir, ".opencode/mafw/feedback");
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(
      path.join(feedbackDir, `${targetId}-${Date.now()}.json`),
      JSON.stringify(feedback, null, 2),
      "utf-8"
    );

    eventBus.emit("user_feedback", { type: "user_feedback", goalId, targetId, feedbackType: type });

    return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 9: Migrate get-model-route.ts**

Create `gateway/src/mcp/handlers/get-model-route.ts`:

```typescript
import { ToolHandler } from "../../types";

export const handleGetModelRoute: ToolHandler = async (args, { cost }) => {
  try {
    const agentType = args.agentType as "plan" | "execute" | "review";
    const remainingBudget = args.remainingBudget as number;
    const totalBudget = args.totalBudget as number;
    const selection = cost.getModelRoute(agentType, remainingBudget, totalBudget);
    return { content: [{ type: "text", text: JSON.stringify(selection) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 10: Migrate add-memory.ts**

Create `gateway/src/mcp/handlers/add-memory.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleAddMemory: ToolHandler = async (args, { memory }) => {
  try {
    const content = args.content as string;
    const memoryType = (args.memoryType as string) || "semantic";
    const cueAnchors = (args.cueAnchors as string[]) || [];
    const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, 80);

    if (!["episodic", "semantic", "procedural", "global"].includes(memoryType)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
    }

    // Use memory service's harmonicIndex instead of creating new instances
    const mafwDir = path.join(projectDir, ".opencode/mafw");
    const tier =
      memoryType === "procedural" ? "tier4"
      : memoryType === "episodic" ? "tier2"
      : memoryType === "global" ? "tier1"
      : "tier3";

    const memoryDir = path.join(mafwDir, "memory");
    const filePath = path.join(memoryDir, `${tier}.json`);

    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const existing: any[] = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
      : [];

    // Generate a simple ID without importing harmonic-types
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const unit = {
      id,
      memory_type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, 200),
      cue_anchors: cueAnchors.slice(0, 8),
      memory_value: content,
      energy: 0.8,
      salience: memoryType === "procedural" || memoryType === "global" ? 1.0 : 0.8,
      abstraction_level: memoryType === "procedural" ? 3 : memoryType === "global" ? 4 : 2,
      created_at: now,
      updated_at: now,
    };

    existing.push(unit);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);

    // Use memory service's harmonicIndex instead of creating new one
    memory.harmonicIndex.addEntry(unit, tier);

    return { content: [{ type: "text", text: JSON.stringify({ success: true, id, tier, filePath }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 11: Verify handlers build**

Run: `cd gateway && npx tsc --noEmit`
Expected: Compilation succeeds

---

### Task 5: Wire into Gateway + Dashboard port consolidation

**Files:**
- Modify: `gateway/src/index.ts`

**Interfaces:**
- Consumes: `McpSSEEndpoint` from `./mcp/sse-transport`, `createToolRegistry` from `./mcp/tool-registry`, `MemoryService` from `./memory/service`, `CostService` from `./cost/service`, `eventBus` from `./event-bus`
- Produces: Modified Gateway startup with SSE routes, ENABLE_LEGACY_MCP fallback, Dashboard on same port

- [ ] **Step 1: Add MCP routes and service init to index.ts**

Modify `gateway/src/index.ts`:

```typescript
import { McpSSEEndpoint } from "./mcp/sse-transport";
import { createToolRegistry } from "./mcp/tool-registry";
import { MemoryService } from "./memory/service";
import { CostService } from "./cost/service";
import { eventBus } from "./event-bus";
// ... existing imports ...

class MafwScheduler {
  // ... existing fields ...
  private mcpEndpoint?: McpSSEEndpoint;

  async start() {
    // 0. Init services (NEW — before starting anything else)
    await this.initServices();

    // 1. Start Serve
    await this.startServe();

    // 2. Init SDK client
    if (this.serveProcess) {
      await this.initClient();
      this.subscribeToEvents();
    }

    // 3. Start HTTP API (includes MCP routes + Dashboard)
    await this.startApiServer();

    // 4. Dashboard now served on same port (no need for separate DashboardServer)
    // this.dashboard = new DashboardServer(3001, ...) — REMOVED

    // 5-7. Recovery + polling (unchanged)
    await this.recoverConfig();
    await this.recoverRegistry();
    await this.recoverState();
    this.startBackupPolling();
  }

  private async initServices() {
    const projectDir = this.projectDir;
    const mafwDir = path.join(projectDir, ".opencode", "mafw");

    const memory = new MemoryService(mafwDir);
    const cost = new CostService();
    const services = { memory, cost };

    // Initialize MCP SSE endpoint
    const toolRegistry = createToolRegistry();
    this.mcpEndpoint = new McpSSEEndpoint(toolRegistry, services);

    console.log("[Scheduler] Services initialized (Memory + Cost + MCP SSE)");

    // Legacy MCP Server fallback
    const enableLegacy = process.env.ENABLE_LEGACY_MCP === "true";
    if (enableLegacy) {
      console.log("[Scheduler] Legacy MCP mode enabled — spawning old MCP Server");
      const { spawn } = require("child_process");
      spawn("node", [path.join(__dirname, "../../src/mcp-server.js")], {
        cwd: this.projectDir,
        stdio: "inherit",
      });
    }
  }

  // Modify HTTP server to add /mcp routes
  private async startApiServer() {
    return new Promise<void>((resolve) => {
      const server = http.createServer(async (req, res) => {
        // CORS headers for SSE
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // MCP SSE session establishment
        if (req.url === "/mcp" && req.method === "GET") {
          try {
            await this.mcpEndpoint!.handleSSE(req, res);
          } catch (err: any) {
            console.error("[MCP SSE] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // MCP client messages
        if (req.url?.startsWith("/mcp") && req.method === "POST") {
          try {
            await this.mcpEndpoint!.handleMessage(req, res);
          } catch (err: any) {
            console.error("[MCP Message] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // Dashboard SPA (serve from public/)
        if (req.url === "/" || req.url?.startsWith("/static/") || req.url === "/index.html") {
          res.setHeader("Content-Type", "text/html");
          const publicDir = path.join(__dirname, "..", "src", "dashboard", "public");
          const filePath = req.url === "/" || req.url === "/index.html"
            ? path.join(publicDir, "index.html")
            : path.join(publicDir, req.url!.replace("/static/", ""));
          if (fs.existsSync(filePath)) {
            res.end(fs.readFileSync(filePath, "utf-8"));
          } else {
            res.end(fs.readFileSync(path.join(publicDir, "index.html"), "utf-8"));
          }
          return;
        }

        // Dashboard API (from existing DashboardServer routes)
        if (req.url?.startsWith("/api/goals") || req.url?.startsWith("/api/stats") || req.url?.startsWith("/api/memory")) {
          // Delegate to dashboard API handler (existing logic)
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await this.handleDashboardAPI(req)));
          return;
        }

        // SSE event stream (for Dashboard)
        if (req.url === "/api/events" && req.method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);
          this.sseClients.add(res);
          req.on("close", () => { this.sseClients.delete(res); });
          return;
        }

        // ... rest of existing route handling (/register, /control, /validate, /complete, /health, /api/events POST) ...
        // (keep all existing routes unchanged)
      });

      server.listen(this.apiPort, () => {
        console.log(`[Scheduler] HTTP API on port ${this.apiPort}`);
        console.log(`[Scheduler]  - GET  /mcp           (MCP SSE)`);
        console.log(`[Scheduler]  - POST /mcp           (MCP messages)`);
        console.log(`[Scheduler]  - GET  /              (Dashboard SPA)`);
        resolve();
      });
    });
  }

  // Wire eventBus to SSE broadcast
  private setupEventBus() {
    eventBus.on("goal_created", (data) => {
      this.broadcast({ type: "goal_created", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("state_change", (data) => {
      this.broadcast({ type: "state_change", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("user_question", (data) => {
      this.broadcast({ type: "user_question", ...data });
    });
    eventBus.on("user_feedback", (data) => {
      this.broadcast({ type: "user_feedback", ...data });
    });
  }
}
```

- [ ] **Step 2: Add setupEventBus call in start()**

Add after `initServices()`:

```typescript
// After initServices(), before startServe():
this.setupEventBus();
```

- [ ] **Step 3: Remove old DashboardServer instantiation**

Remove or comment out:
```typescript
// this.dashboard = new DashboardServer(3001, this.projectDir, this);
// this.dashboard.start();
```

- [ ] **Step 4: Verify build**

Run: `cd gateway && npx tsc --noEmit`
Expected: Compilation succeeds

---

### Task 6: Deprecate old MCP Server + update config

**Files:**
- Modify: `src/mcp-server.ts` (add deprecation notice)
- Modify: `opencode.json.example` (change to SSE transport)
- Verify: `src/plugin.ts` (ensure no `tool:` section remains)

**Interfaces:**
- Consumes: nothing
- Produces: updated config files

- [ ] **Step 1: Mark src/mcp-server.ts as deprecated**

Add at the top of `src/mcp-server.ts`:

```typescript
/**
 * @deprecated MCP Server is now embedded in Gateway via SSE transport.
 * This file is kept for ENABLE_LEGACY_MCP fallback only.
 * See gateway/src/mcp/sse-transport.ts for the active implementation.
 * Will be removed in next major version.
 */
```

- [ ] **Step 2: Update opencode.json.example**

Update `opencode.json.example`:

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

- [ ] **Step 3: Verify plugin.ts has no tool section**

Search: `rg "tool:" src/plugin.ts`
Expected: No `tool:` line in the return object (we confirmed it was already removed)

---

### Task 7: E2E verification

**Files:**
- Test config: `tests/gateway-unified.test.ts` (or manual test steps)

**Interfaces:**
- Consumes: running Gateway on port 3000

- [ ] **Step 1: Start Gateway**

Run: `cd gateway && npm run build && npm start`

- [ ] **Step 2: Verify MCP SSE connection**

Test SSE session establishment:

```bash
# Use curl to establish SSE connection
curl -N http://127.0.0.1:3000/mcp -H "Accept: text/event-stream"
```

Expected: SSE connection established, `SSEServerTransport` logs session ID

- [ ] **Step 3: Verify tool listing**

In a separate terminal, send a POST to send MCP's `initialize` request followed by `ListTools`:

```bash
# Initialize
curl -X POST "http://127.0.0.1:3000/mcp?sessionId=xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Then list tools:

```bash
curl -X POST "http://127.0.0.1:3000/mcp?sessionId=xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Expected: JSON-RPC response with 9 tool definitions

- [ ] **Step 4: Test memory tool (search_hybrid)**

```bash
curl -X POST "http://127.0.0.1:3000/mcp?sessionId=xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mafw_search_hybrid","arguments":{"query":"test query","topK":5}}}'
```

Expected: Results from harmonic index (may be empty for first run)

- [ ] **Step 5: Test create_goal**

```bash
curl -X POST "http://127.0.0.1:3000/mcp?sessionId=xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mafw_create_goal","arguments":{"goalId":"test-001","title":"Test Goal","charter":"# Test\\n\\nTest goal"}}}'
```

Expected: `{"success": true, "goalId": "test-001", ...}`

- [ ] **Step 6: Verify no HTTP calls remain**

Search: `rg "httpPost\|fetch.*localhost:300" gateway/src/mcp/handlers/`
Expected: No results (all httpPost replaced with eventBus.emit)

- [ ] **Step 7: Verify ENABLE_LEGACY_MCP fallback**

```bash
ENABLE_LEGACY_MCP=true npm start
```

Expected: Gateway starts AND old MCP Server process also spawns

---

## Self-Review Checklist

1. **Spec coverage:**
   - ✅ SSE MCP endpoint (Tasks 3, 5)
   - ✅ MemoryService singleton (Task 2)
   - ✅ CostService singleton (Task 2)
   - ✅ 9 tool handlers migrated with zero HTTP (Task 4)
   - ✅ Gateway single-process startup (Task 5)
   - ✅ Dashboard on same port (Task 5)
   - ✅ Plugin unchanged (Task 6 — verified already clean)
   - ✅ ENABLE_LEGACY_MCP fallback (Task 5)
   - ✅ opencode.json.example updated (Task 6)

2. **Placeholder scan:** No TBD, TODO, "implement later", or similar patterns.

3. **Type consistency:** All tool names, handler signatures, and service interfaces match across tasks. `ToolHandler` type defined in Task 1 is used in all tasks.
