# MAFW MCP Architecture Design

> **Goal**: Replace traditional OpenCode Plugin tool registration with an MCP (Model Context Protocol) server, and move phase ownership from Plugin to Gateway via HTTP communication.

## Architecture Overview

```
Before:
  Plugin owns tools + state machine + phase transitions
  Gateway dumb-polls state.json every 5s

After:
  MCP Server owns tools (stdio)
  Gateway owns state machine + phase transitions (HTTP driven)
  Plugin owns config + commands + hooks + context injection
```

## Communication Flow

```
opencode.json
  mcpServers.mafw: { command: "node", args: ["dist/mcp-server.js"] }
        │
        │ stdio (child process)
        ▼
MCP Server (independent process)
        │
        ├── read/write ──▶ .opencode/mafw/ (FS)
        │
        ├── HTTP POST ──▶ Gateway (create_goal, update_state)
        │
        └── HTTP POST ──▶ Gateway /api/events (ask_user, record_feedback)

Gateway
        │
        ├── HTTP ◀── MCP Server (validate, complete)
        ├── SSE ◀── Dashboard
        └── FS ◀──── .opencode/mafw/state/*.json
```

## MCP Server

### Transport: stdio

The MCP Server uses `@modelcontextprotocol/sdk` with `StdioServerTransport`. OpenCode spawns it as a child process via `mcpServers` configuration.

### Configuration

```json
// opencode.json
{
  "mcpServers": {
    "mafw": {
      "command": "node",
      "args": ["node_modules/opencode-plugin-mafw/dist/mcp-server.js"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MAFW_PROJECT_DIR` | `process.cwd()` | Project working directory |
| `MAFW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway HTTP API |

### Subsystems

The MCP Server initializes the following subsystems at startup (same as Plugin):

- `HarmonicIndexManager` — harmonic memory index
- `CognitiveGraphManager` — association network
- `CostEstimator` — cost tracking
- `CognitiveRouter` — model selection
- `KnowledgeGraphManager` — knowledge graph

### 8 Tools

| Tool | Handler | Verification | Notification |
|---|---|---|---|
| `mafw_create_goal` | Check goal FS files exist | Local FS | HTTP POST /validate |
| `mafw_update_state` | Check phase artifacts exist | Local FS | HTTP POST /complete |
| `mafw_search_hybrid` | Execute search directly | — | — |
| `mafw_get_deltas` | Read parametric store | — | — |
| `mafw_load_state` | Read state file | — | — |
| `mafw_ask_user` | Write question file | — | HTTP POST /events |
| `mafw_record_feedback` | Write feedback file | — | HTTP POST /events |
| `mafw_get_model_route` | In-memory computation | — | — |

### Core Pattern: Local Verify → HTTP Notify

Tools that trigger phase transitions (`create_goal`, `update_state`) follow this pattern:

```typescript
async function handleCreateGoal(args: { goalId: string }) {
  // 1. Local FS verification
  const charterPath = path.join(mafwDir, 'goals', `${args.goalId}.md`);
  const requestPath = path.join(mafwDir, 'requests', `${args.goalId}.json`);
  
  const missing: string[] = [];
  if (!fs.existsSync(charterPath)) missing.push(`goals/${args.goalId}.md`);
  if (!fs.existsSync(requestPath)) missing.push(`requests/${args.goalId}.json`);
  
  if (missing.length > 0) {
    return { success: false, error: `Missing files`, missing };
  }

  // 2. HTTP notify Gateway
  const res = await fetch(`${gatewayUrl}/api/work/${args.goalId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goalId: args.goalId, projectDir })
  });
  
  return res.json();
}
```

### Tool Definitions

```typescript
const TOOLS: ToolDefinition[] = [
  {
    name: 'mafw_create_goal',
    description: 'Validate goal creation and notify Gateway to start planning',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID (must match file names)' }
      },
      required: ['goalId']
    }
  },
  {
    name: 'mafw_update_state',
    description: 'Validate phase completion artifacts and notify Gateway for state transition',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' }
      },
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
    description: 'Get parametric deltas (L3 constraints) for a goal and phase',
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
    description: 'Load the current state file for a goal',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' }
      },
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
    description: 'Record user thumbs up/down for a wave result',
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
```

---

## Gateway Endpoints

### POST /api/work/{goalId}/validate

**Purpose**: Verify goal files exist, create state file, start planning session.

```typescript
// Request: { goalId, projectDir }
// Response success: { goalId, phase: 'PLANNING', nextAction: 'CREATE_PLAN_SESSION' }
// Response error: { goalId, error: '...' }
```

### POST /api/work/{goalId}/complete

**Purpose**: Verify phase completion artifacts, run state machine, trigger next phase.

```typescript
// Request: { goalId, projectDir }
// Response success: { goalId, nextAction: '...', phase: '...' }
// Response error: { goalId, error: '...', phase: '...' }
```

### Phase Validation Logic

```typescript
function validatePhaseCompletion(phase: string, goalId: string, mafwDir: string): ValidationResult {
  switch (phase) {
    case 'PLANNING': {
      const wavesPath = path.join(mafwDir, 'waves.json');
      if (!fs.existsSync(wavesPath)) return { valid: false, error: 'waves.json not found' };
      const waves = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      if (!waves.waves || waves.waves.length === 0) return { valid: false, error: 'No waves defined in waves.json' };
      return { valid: true };
    }
    case 'EXECUTING': {
      const receiptsDir = path.join(mafwDir, 'receipts', goalId);
      if (!fs.existsSync(receiptsDir)) return { valid: false, error: `No receipts found` };
      const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) return { valid: false, error: `Receipts directory is empty` };
      return { valid: true };
    }
    case 'REVIEWING': {
      const reviewsDir = path.join(mafwDir, 'reviews');
      if (!fs.existsSync(reviewsDir)) return { valid: false, error: `Review directory not found` };
      const reviewFiles = fs.readdirSync(reviewsDir).filter(f => f.startsWith(goalId) && f.endsWith('.md'));
      if (reviewFiles.length === 0) return { valid: false, error: `No review report found for ${goalId}` };
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}
```

### State Machine Transition

```typescript
// Gateway polls or receives HTTP completion events
// Uses GatewayLoopStateMachine to determine next action
// Writes state.json with updated phase + nextAction
```

---

## Plugin Changes

### Before

```typescript
return {
  config: async (config) => { /* agent mappings */ },
  'experimental.chat.messages.transform': async (input, output) => { /* context injection */ },
  command: { goal, status, ... },
  tool: { mafw_search_hybrid, mafw_get_deltas, ... },  // ~80 lines, REMOVE
  hooks: { 'session.end': ..., 'tool.execute.after': ... },
  event: async ({ event }) => { /* handle events */ }
};
```

### After

```typescript
return {
  config: async (config) => { /* agent mappings */ },
  'experimental.chat.messages.transform': async (input, output) => { /* context injection */ },
  command: { goal, status, ... },  // unchanged
  hooks: { 'session.end': ..., 'tool.execute.after': ... },  // unchanged
  event: async ({ event }) => { /* handle events */ }  // unchanged
};
```

---

## File Manifest

### New Files (3)

| File | Lines | Purpose |
|---|---|---|
| `src/mcp-server.ts` | ~50 | MCP Server entry point, stdio transport, subsystem init |
| `src/mcp/tools.ts` | ~120 | 8 tool definitions + handler dispatch |
| `src/mcp/validator.ts` | ~40 | Phase artifact validation functions |

### Modified Files (4)

| File | Change | Lines |
|---|---|---|
| `gateway/src/index.ts` | Add POST /validate, POST /complete routes | +40 |
| `gateway/src/work-validator.ts` | **Create** phase validation logic | ~40 |
| `src/plugin.ts` | Remove `tool:` section (~80 lines) | -80 |
| `package.json` | Add `@modelcontextprotocol/sdk` dependency | +1 |

### Config/Example Files

| File | Lines | Purpose |
|---|---|---|
| `opencode.json.example` | ~10 | MCP server configuration example |

---

## Decision Log

| # | Decision | Rationale |
|---|---|---|
| 1 | MCP over stdio, not SSE | Simplest transport, no port management |
| 2 | Tools only via MCP, remove Plugin tool: | Single tool definition source |
| 3 | Local FS verify → HTTP notify Gateway | No round-trip for validation failures |
| 4 | Plugin retains config/command/hooks/event | Context injection still needed |
| 5 | projectDir from env var | No per-call parameter needed |
| 6 | Gateway owns state machine | Phase transitions centralized |
| 7 | Blocking HTTP retry from MCP Server | Reliable delivery to Gateway |
