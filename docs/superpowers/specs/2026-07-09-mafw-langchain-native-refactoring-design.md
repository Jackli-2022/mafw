# MAFW LangChain Native Refactoring — Design Spec

## 1. Motivation

The MAFW v6.6 architecture already uses `@langchain/langgraph` for its core execution graph but wraps it in custom abstractions (file-based state passing, duplicated node patterns, manual interrupt management). This refactoring completes the LangChain-native transition by:

- **Reduce custom code**: Replace duplicate node logic (~120 lines → ~40 lines) via a unified node runner
- **Ecosystem compatibility**: Expose Harmonic Memory through `BaseRetriever`/`BaseMemory` interfaces for LangChain ecosystem tooling
- **Multi-agent extensibility**: Abstract OpenCode SDK behind `BaseSingleActionAgent` for future backend swaps

## 2. Scope

| Component | Change | Effort |
|-----------|--------|--------|
| `src/langgraph/nodes/` | Refactor 3 nodes into unified config-driven pattern | -80 lines |
| `src/langchain/agent-adapter.ts` | NEW: `BaseSingleActionAgent` wrapping OpenCode SDK | ~100 lines |
| `src/langchain/retriever.ts` | NEW: `BaseRetriever` wrapping `HarmonicIndexManager` | ~60 lines |
| `src/langchain/memory.ts` | NEW: `BaseMemory` wrapping memory injection/recording | ~80 lines |
| `src/langchain/node-runner.ts` | NEW: Generic agent-node factory (plan/execute/review) | ~80 lines |
| `gateway/` | Add `langchain-mcp-adapters`, wire tools | ~50 lines |
| `src/langgraph/graph.ts` | Simplification — use node-runner instead of raw node refs | -20 lines |
| `tests/` | New tests for langchain/ + update graph tests | ~200 lines |
| **Total net** | | **~470 new + -100 removed** |

### Already done (confirmed during exploration)

- ✅ `StateGraph` with plan/execute/review/archive/sync nodes (`src/langgraph/graph.ts`)
- ✅ `LoopState` Annotation.Root (`src/langgraph/loop-state.ts`)
- ✅ `FileCheckpointer extends BaseCheckpointSaver` (`src/langgraph/checkpointer.ts`)
- ✅ MCP tool registration (tool-registry.ts, tools.ts)
- ✅ Gateway invokes LangGraph (`gateway/src/index.ts`)

## 3. Architecture

```
                     ┌──────────────────────────────┐
                     │   LangGraph StateGraph        │
                     │   (graph.ts)                  │
                     └──────────┬───────────────────┘
                                │
                     ┌──────────▼───────────────────┐
                     │   langchain/node-runner.ts    │
                     │   createAgentNode(type)       │
                     │   → NODE_CONFIGS[type]        │
                     └──────────┬───────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
    ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
    │ CodeAgentAdapter│ │ MAFWRetriever│ │ MAFWMemory   │
    │ (OpenCode SDK)  │ │ (HarmonicIdx)│ │ (HarmonicSys)│
    └─────────────────┘ └──────────────┘ └──────────────┘
              │                 │                  │
              └─────────────────┼──────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │  memory/ (unchanged)  │
                    │  harmonic-index.ts    │
                    │  cognitive-graph.ts   │
                    │  energy-system.ts     │
                    └───────────────────────┘
```

### Key design principle: Wrapper, not replacement

| System | LangChain Interface | Internal Implementation |
|--------|-------------------|------------------------|
| Agent | `BaseSingleActionAgent` | OpenCode SDK session calls |
| Memory retrieval | `BaseRetriever` | `HarmonicIndexManager.hybridSearch()` |
| Memory injection | `BaseMemory` | `HarmonicIndex.addObservation()` + `L3Store.load()` |
| MCP tools | `langchain-mcp-adapters` | Existing MCP SSE server on :3001 |

All internal implementations remain unchanged. LangChain abstractions are **added on top**, never replacing existing code paths.

## 4. Component Details

### 4.1 Node Runner (`src/langchain/node-runner.ts`)

Replaces the duplicated createSession → sendPrompt → interrupt → readResult → destroySession pattern across plan/execute/review nodes.

```typescript
interface NodeConfig {
  skill: string;
  resultFile: string;          // template path, resolved at runtime
}

const NODE_CONFIGS: Record<string, NodeConfig> = {
  plan:    { skill: 'mafw-plan',    resultFile: 'waves.json' },
  execute: { skill: 'mafw-execute', resultFile: 'receipts/loop-receipt.json' },
  review:  { skill: 'mafw-review',  resultFile: 'reviews/{goalId}-loop{round}.md' },
};

export function createAgentNode(type: 'plan' | 'execute' | 'review') {
  return async (state: LoopStateType, services: AgentServices) => {
    const config = NODE_CONFIGS[type];
    services.syncToFile({ ...state, phase: `${type}_IN_PROGRESS` });
    const sessionId = await services.createSession(state.projectDir);
    await services.sendPrompt(sessionId, `/skill ${config.skill} ${state.goalId}`);
    interrupt('awaiting_agent');
    const result = await services.readResult(state, config);
    await services.destroySession(sessionId);
    services.syncToFile({ ...state, ...result, phase: `${type}_COMPLETE` });
    return result;
  };
}
```

**Result**: plan.node.ts: 42→15 lines, execute.node.ts: 38→15 lines, review.node.ts: 74→20 lines.

### 4.2 CodeAgentAdapter (`src/langchain/agent-adapter.ts`)

Wraps OpenCode SDK session management as a LangChain `BaseSingleActionAgent`.

Key behavior:
- Does NOT implement a tool-calling loop — all tool calls happen inside OpenCode via MCP
- `plan()` always returns `AgentFinish` (delegating tool calls to OpenCode)
- Exists primarily as a **future extension point** for when direct LLM calls are needed

```typescript
export class CodeAgentAdapter extends BaseSingleActionAgent {
  inputKeys = ['input'];
  outputKeys = ['output'];

  async plan(
    _steps: IntermediateStep[],
    _callbacks: Callbacks,
    config?: RunnableConfig,
  ): Promise<AgentAction | AgentFinish> {
    const { goalId, instruction } = config?.configurable ?? {};
    const sessionId = await this.services.createSession(goalId);
    await this.services.sendPrompt(sessionId, instruction);
    // OpenCode handles all tool calls internally via MCP
    return {
      returnValues: { output: 'delegated_to_opencode' },
      log: `Delegated to OpenCode SDK for goal ${goalId}`,
    };
  }
}
```

### 4.3 MAFWRetriever (`src/langchain/retriever.ts`)

A `BaseRetriever` that wraps `HarmonicIndexManager.hybridSearch()`. Allows LangChain-native chains/agents to query Harmonic Memory.

```typescript
export class MAFWRetriever extends BaseRetriever {
  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const results = await this.harmonicIndex.hybridSearch(query);
    return results.map(r => new Document({
      pageContent: r.memory_value,
      id: r.id,
      metadata: {
        type: r.memory_type,
        energy: r.energy,
        salience: r.salience,
        abstractionLevel: r.abstraction_level,
      },
    }));
  }
}
```

### 4.4 MAFWMemory (`src/langchain/memory.ts`)

A `BaseMemory` that loads L3 constraints, L5 axioms, and hot memories into the agent context window, then records observations after execution.

```typescript
export class MAFWMemory extends BaseMemory {
  memoryKeys = ['l3_constraints', 'l5_axioms', 'hot_memories'];

  async loadMemoryVariables() {
    const [l3, l5, hot] = await Promise.all([
      this.parametricStore.getActiveDeltas(),
      this.axiomStore.getActiveAxioms(),
      this.harmonicIndex.getHotMemories({ energy: 0.5, limit: 5 }),
    ]);
    return { l3_constraints: l3, l5_axioms: l5, hot_memories: hot };
  }

  async saveContext(input: {}, output: { result: string }) {
    await this.harmonicIndex.addObservation({
      text: output.result,
      source: 'agent_execution',
    });
  }
}
```

### 4.5 langchain-mcp-adapters Integration (`gateway/src/index.ts`)

```typescript
import { MultiServerMCPClient } from 'langchain-mcp-adapters';

const mcpClient = MultiServerMCPClient.fromSSE('http://localhost:3001/sse');
const tools = await mcpClient.getTools();
// tools === StructuredTool[] — ready for LangChain Agent binding
```

This replaces manual tool registration with automatic discovery from the MCP SSE endpoint.

## 5. File Structure Change

```
src/
├── langchain/                          ✨ NEW
│   ├── index.ts                        Exports
│   ├── agent-adapter.ts                BaseSingleActionAgent wrapper
│   ├── retriever.ts                    BaseRetriever wrapper
│   ├── memory.ts                       BaseMemory wrapper
│   └── node-runner.ts                  Agent node factory
├── langgraph/                          🔄 REFACTOR
│   ├── graph.ts                        Simplified (node-runner injected)
│   └── nodes/
│       ├── plan.node.ts                ~15 lines (was 42)
│       ├── execute.node.ts             ~15 lines (was 38)
│       ├── review.node.ts              ~20 lines (was 74)
│       └── sync.node.ts / archive.node.ts  (unchanged)
├── memory/                             ✅ UNCHANGED
└── tools/                              ✅ UNCHANGED
```

## 6. Testing Strategy

| Test | Scope | Type |
|------|-------|------|
| `node-runner.test.ts` | createAgentNode with mock AgentServices | Unit |
| `agent-adapter.test.ts` | CodeAgentAdapter.plan() delegation | Unit |
| `retriever.test.ts` | MAFWRetriever._getRelevantDocuments | Unit |
| `memory.test.ts` | MAFWMemory.loadMemoryVariables / saveContext | Unit |
| `graph.test.ts` (updated) | Graph routing with node-runner nodes | Integration |

All new tests follow existing Jest patterns in `tests/unit/`. Gateway integration tests remain unchanged.

## 7. Migration Plan

The refactoring is incremental — each component can be landed independently:

1. **Phase 1**: `node-runner.ts` + refactored nodes (no new behavior)
2. **Phase 2**: `CodeAgentAdapter` + `mcp-adapters` (parallel path, no existing code removed)
3. **Phase 3**: `MAFWRetriever` + `MAFWMemory` (parallel path, no existing code removed)
4. **Phase 4**: Tests + cleanup (remove dead code after verifying no regression)

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| langchain-mcp-adapters SSE compatibility | P2 blocked | Fallback: manual tool conversion via `StructuredTool.from()` |
| interrupt() + Agent adapter interaction | Graph may pause unexpectedly | Test: 3-node loop with mock services |
| No existing Graph test coverage | Regression risk | Write graph.test.ts before touching graph.ts |
| Memory wrapper loses Harmonic features | Semantic mismatch | Verify all metadata fields pass through Document |

## 9. Non-Goals

- NOT replacing Harmonic Memory internals (BM25, cognitive graph, energy system)
- NOT changing the Gateway's event-driven architecture
- NOT migrating away from OpenCode SDK as primary LLM backend
- NOT adding LangSmith tracing (future work)
