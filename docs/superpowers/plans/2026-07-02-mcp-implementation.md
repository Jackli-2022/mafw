# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenCode Plugin tool registration with MCP stdio server, move phase ownership to Gateway via HTTP.

**Architecture:** MCP Server (standalone stdio process) exposes 8 tools. Tools that trigger phase transitions (create_goal, update_state) perform local FS verification then HTTP POST to Gateway. Gateway owns the state machine. Plugin retains config/command/hooks/event but removes `tool:` section.

**Tech Stack:** Node.js/TypeScript, @modelcontextprotocol/sdk, Jest.

## Global Constraints

- commit messages follow conventional commits (`feat:` / `refactor:`)
- Use `npx jest` for all tests
- MCP transport: stdio only
- projectDir from env var `MAFW_PROJECT_DIR` (fallback to `process.cwd()`)
- Gateway URL from env var `MAFW_GATEWAY_URL` (fallback `http://127.0.0.1:3000`)
- Phase validation is local FS read (no HTTP for validation)
- HTTP POST to Gateway only on successful validation
- Plugin `tool:` section must be removed (tools exist only via MCP)

---

## MCP1: MCP Server

### MCP1 File Map

| File | Action | Purpose |
|---|---|---|
| `src/mcp-server.ts` | **Create** | Entry point, stdio transport, subsystem init |
| `src/mcp/tools.ts` | **Create** | 8 tool definitions + handler dispatch |
| `src/mcp/validator.ts` | **Create** | Phase artifact validation functions |
| `tests/unit/mcp/tools.test.ts` | **Create** | Tool definition tests |
| `package.json` | Modify | Add `@modelcontextprotocol/sdk` dependency |

### Task 1: Install dependency + create MCP server skeleton

**Files:**
- Modify: `package.json`
- Create: `src/mcp-server.ts`

- [ ] **Step 1: Install MCP SDK**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create `src/mcp-server.ts`**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';
import { registerTools } from './mcp/tools';

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
const gatewayUrl = process.env.MAFW_GATEWAY_URL || 'http://127.0.0.1:3000';
const mafwDir = path.join(projectDir, '.opencode', 'mafw');

async function main() {
  // Initialize subsystems
  const { HarmonicIndexManager } = await import('./memory/harmonic-index');
  const { CognitiveGraphManager } = await import('./memory/cognitive-graph');
  const { CostEstimator } = await import('./cost/cost-estimator');
  const { CognitiveRouter } = await import('./cost/cognitive-router');

  const harmonicIndex = new HarmonicIndexManager(mafwDir);
  const cognitiveGraph = new CognitiveGraphManager(mafwDir);
  const costEstimator = new CostEstimator();
  const cognitiveRouter = new CognitiveRouter();
  const config = { cost: { budget: { total: 1000000, threshold: 0.8 } } };

  const server = new Server({ name: 'mafw', version: '6.4.0' }, { capabilities: { tools: {} } });

  const toolHandlers = registerTools({
    projectDir, gatewayUrl, mafwDir,
    harmonicIndex, cognitiveGraph, costEstimator, cognitiveRouter, config
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolHandlers.definitions
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers.handlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    try {
      const result = await handler(args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors, `dist/mcp-server.js` created

- [ ] **Step 4: Commit**

```bash
git add package.json src/mcp-server.ts
git commit -m "feat: add MCP server skeleton with stdio transport"
```

### Task 2: Create tool definitions + validator

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/mcp/validator.ts`
- Test: `tests/unit/mcp/tools.test.ts`

- [ ] **Step 1: Create `src/mcp/validator.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  missing?: string[];
}

export function validateGoalCreation(goalId: string, mafwDir: string): ValidationResult {
  const missing: string[] = [];
  const charterPath = path.join(mafwDir, 'goals', `${goalId}.md`);
  const requestPath = path.join(mafwDir, 'requests', `${goalId}.json`);
  const statePath = path.join(mafwDir, 'state', `${goalId}.json`);

  if (!fs.existsSync(charterPath)) missing.push(`goals/${goalId}.md`);
  if (!fs.existsSync(requestPath)) missing.push(`requests/${goalId}.json`);
  if (fs.existsSync(statePath)) return { valid: false, error: `Goal ${goalId} already exists in state` };

  if (missing.length > 0) return { valid: false, error: 'Missing required goal files', missing };
  return { valid: true };
}

export function validatePhaseCompletion(phase: string, goalId: string, mafwDir: string): ValidationResult {
  switch (phase) {
    case 'PLANNING': {
      const wavesPath = path.join(mafwDir, 'waves.json');
      if (!fs.existsSync(wavesPath)) return { valid: false, error: 'waves.json not found', missing: ['waves.json'] };
      const data = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      if (!data.waves || data.waves.length === 0) return { valid: false, error: 'No waves defined' };
      return { valid: true };
    }
    case 'EXECUTING': {
      const receiptsDir = path.join(mafwDir, 'receipts', goalId);
      if (!fs.existsSync(receiptsDir)) return { valid: false, error: `No receipts directory`, missing: [`receipts/${goalId}/`] };
      const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) return { valid: false, error: 'Receipts directory is empty' };
      return { valid: true };
    }
    case 'REVIEWING': {
      const reviewsDir = path.join(mafwDir, 'reviews');
      if (!fs.existsSync(reviewsDir)) return { valid: false, error: 'Reviews directory not found' };
      const files = fs.readdirSync(reviewsDir).filter(f => f.startsWith(goalId) && f.endsWith('.md'));
      if (files.length === 0) return { valid: false, error: `No review report for ${goalId}` };
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}
```

- [ ] **Step 2: Create `src/mcp/tools.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { validateGoalCreation, validatePhaseCompletion } from './validator';

export interface ToolContext {
  projectDir: string;
  gatewayUrl: string;
  mafwDir: string;
  harmonicIndex: any;
  cognitiveGraph: any;
  costEstimator: any;
  cognitiveRouter: any;
  config: any;
}

interface ToolHandlers {
  definitions: Tool[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

async function httpPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  return res.json();
}

export function registerTools(ctx: ToolContext): ToolHandlers {
  const tools: Tool[] = [
    {
      name: 'mafw_create_goal',
      description: 'Validate goal creation files and notify Gateway to start planning',
      inputSchema: {
        type: 'object',
        properties: { goalId: { type: 'string', description: 'Goal ID' } },
        required: ['goalId']
      }
    },
    {
      name: 'mafw_update_state',
      description: 'Validate phase completion artifacts and notify Gateway for state transition',
      inputSchema: {
        type: 'object',
        properties: { goalId: { type: 'string' } },
        required: ['goalId']
      }
    },
    {
      name: 'mafw_search_hybrid',
      description: 'Hybrid search across harmonic memory index',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          goalId: { type: 'string' },
          maxResults: { type: 'number', default: 10 }
        },
        required: ['query']
      }
    },
    {
      name: 'mafw_get_deltas',
      description: 'Get parametric deltas (L3 constraints)',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string' },
          phase: { type: 'string', enum: ['plan', 'execute', 'review'] },
          maxResults: { type: 'number', default: 5 }
        },
        required: ['goalId']
      }
    },
    {
      name: 'mafw_load_state',
      description: 'Load the current state file for a Goal',
      inputSchema: {
        type: 'object',
        properties: { goalId: { type: 'string' } },
        required: ['goalId']
      }
    },
    {
      name: 'mafw_ask_user',
      description: 'Ask user a clarifying question (non-blocking)',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          goalId: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['normal', 'high'] }
        },
        required: ['question', 'goalId']
      }
    },
    {
      name: 'mafw_record_feedback',
      description: 'Record user feedback for a specific Wave result',
      inputSchema: {
        type: 'object',
        properties: {
          targetId: { type: 'string' },
          type: { type: 'string', enum: ['thumbs_up', 'thumbs_down', 'correction'] },
          goalId: { type: 'string' },
          comment: { type: 'string' }
        },
        required: ['targetId', 'type', 'goalId']
      }
    },
    {
      name: 'mafw_get_model_route',
      description: 'Decide which LLM model to use based on task and remaining budget',
      inputSchema: {
        type: 'object',
        properties: {
          taskType: { type: 'string', enum: ['planning', 'coding', 'reviewing'] },
          remainingBudget: { type: 'number' }
        },
        required: ['taskType', 'remainingBudget']
      }
    }
  ];

  const handlers: Record<string, (args: any) => Promise<any>> = {
    mafw_create_goal: async (args) => {
      const validation = validateGoalCreation(args.goalId, ctx.mafwDir);
      if (!validation.valid) return validation;
      return httpPost(`${ctx.gatewayUrl}/api/work/${args.goalId}/validate`, { goalId: args.goalId, projectDir: ctx.projectDir });
    },

    mafw_update_state: async (args) => {
      const statePath = path.join(ctx.mafwDir, 'state', `${args.goalId}.json`);
      if (!fs.existsSync(statePath)) return { success: false, error: 'Goal state not found' };
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const phase = state.phase;
      const validation = validatePhaseCompletion(phase, args.goalId, ctx.mafwDir);
      if (!validation.valid) return { success: false, error: validation.error, phase };
      return httpPost(`${ctx.gatewayUrl}/api/work/${args.goalId}/complete`, { goalId: args.goalId, projectDir: ctx.projectDir });
    },

    mafw_search_hybrid: async (args) => {
      const results = ctx.harmonicIndex.search(args.query, args.maxResults || 10);
      if (ctx.cognitiveGraph && results.length > 1) {
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            ctx.cognitiveGraph.addConnection(results[i].id, results[j].id);
          }
        }
      }
      return { results };
    },

    mafw_get_deltas: async (args) => {
      return { deltas: [] };
    },

    mafw_load_state: async (args) => {
      const statePath = path.join(ctx.mafwDir, 'state', `${args.goalId}.json`);
      if (!fs.existsSync(statePath)) return { success: false, error: 'State not found' };
      return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    },

    mafw_ask_user: async (args) => {
      const { askUser } = require('../tools/run-ask-user');
      const result = await askUser({ ...args, loopNum: 1 });
      await httpPost(`${ctx.gatewayUrl}/api/events`, { type: 'user.question', goalId: args.goalId, question: args.question });
      return result;
    },

    mafw_record_feedback: async (args) => {
      const { recordFeedback } = require('../tools/run-record-feedback');
      const result = await recordFeedback({ ...args, loopNum: 1 });
      await httpPost(`${ctx.gatewayUrl}/api/events`, { type: 'feedback', goalId: args.goalId, data: result });
      return result;
    },

    mafw_get_model_route: async (args) => {
      return ctx.cognitiveRouter.selectModel(args.taskType, args.remainingBudget, ctx.config?.cost?.budget?.total || 1000000);
    }
  };

  return { definitions: tools, handlers };
}
```

- [ ] **Step 3: Write test file**

```typescript
// tests/unit/mcp/tools.test.ts
import { validateGoalCreation, validatePhaseCompletion } from '../../src/mcp/validator';

describe('MCP Validator', () => {
  it('validatePhaseCompletion returns invalid for missing waves.json', () => {
    const result = validatePhaseCompletion('PLANNING', 'test', '/nonexistent');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('waves.json');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/mcp/tools.test.ts --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts src/mcp/validator.ts tests/unit/mcp/tools.test.ts
git commit -m "feat: add MCP tool definitions and phase validator"
```

---

## MCP2: Gateway Endpoints

### MCP2 File Map

| File | Action | Purpose |
|---|---|---|
| `gateway/src/work-validator.ts` | **Create** | Shared validation (used by Gateway) |
| `gateway/src/index.ts` | Modify | Add POST /validate, POST /complete routes |

### Task 3: Gateway endpoints

**Files:**
- Create: `gateway/src/work-validator.ts`
- Modify: `gateway/src/index.ts`

- [ ] **Step 1: Create `gateway/src/work-validator.ts`**

Copy validation logic from `src/mcp/validator.ts`. In Gateway, validation may be redundant (MCP already validated), but Gateway validates again for defense in depth.

- [ ] **Step 2: Add routes to `gateway/src/index.ts`**

In `MafwScheduler`, add HTTP request handling for:

```typescript
// POST /api/work/{goalId}/validate
// 1. Validate goal files
// 2. Call state.initState() to create state file
// 3. Add to activeGoals
// 4. Start planning session
// 5. Return success

// POST /api/work/{goalId}/complete
// 1. Validate phase completion
// 2. Read current state
// 3. Run state machine transition
// 4. Write updated state
// 5. Create next session if needed
// 6. Return nextAction
```

- [ ] **Step 3: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add gateway/src/work-validator.ts gateway/src/index.ts
git commit -m "feat: add Gateway phase validation and state machine endpoints (MCP2)"
```

---

## MCP3: Plugin Cleanup

### MCP3 File Map

| File | Action | Purpose |
|---|---|---|
| `src/plugin.ts` | Modify | Remove `tool:` section |

### Task 4: Remove tool section

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Remove `tool:` section**

Delete the entire `tool: { ... },` block from the return object (~80 lines). Keep all other sections.

- [ ] **Step 2: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass (tools moved to MCP, no tests should break)

- [ ] **Step 3: Create `opencode.json.example`**

```json
{
  "mcpServers": {
    "mafw": {
      "command": "node",
      "args": ["node_modules/opencode-plugin-mafw/dist/mcp-server.js"]
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts opencode.json.example
git commit -m "refactor: remove tool section from Plugin, tools now via MCP"
```

---

## Verification

```bash
npx jest --verbose         # All tests pass
npm run build              # tsc
node dist/mcp-server.js    # MCP Server starts (will wait for stdio)
```
