# MAFW LangChain Native Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LangChain abstractions (BaseSingleActionAgent, BaseRetriever, BaseMemory) on top of MAFW's existing OpenCode SDK, Harmonic Memory, and MCP tool systems, while refactoring the 3 duplicated LangGraph nodes into a unified config-driven pattern.

**Architecture:** All new code lives in `src/langchain/` as wrappers; no internal implementations change. The node runner replaces the duplicated `createSession → sendPrompt → interrupt → readResult → destroySession` pattern across plan/execute/review with a single config-driven factory.

**Tech Stack:** `@langchain/core` v1.1.48, `@langchain/langgraph` v1.4.7, `langchain-mcp-adapters` (latest), TypeScript, Jest

## Global Constraints

- 80% test coverage threshold (global branches/functions/lines/statements)
- All `src/memory/` internals remain unchanged
- Gateway event-driven architecture remains unchanged
- `interrupt()` pattern preserved (OpenCode SDK runs out-of-process)
- Import paths: `src/` uses relative imports, `tests/` uses `../../../src/...` style
- No new npm dependencies beyond `langchain-mcp-adapters`

---

### Task 1: Node Runner + Refactored Nodes

**Files:**
- Create: `src/langchain/node-runner.ts`
- Modify: `src/langgraph/nodes/plan.node.ts` (replace body with one-liner)
- Modify: `src/langgraph/nodes/execute.node.ts` (replace body with one-liner)
- Modify: `src/langgraph/nodes/review.node.ts` (replace body with one-liner, keep `parseReviewVerdict`)
- Modify: `src/langgraph/index.ts` (add node-runner export)
- Test: `tests/unit/langgraph/node-runner.test.ts`

**Interfaces:**
- Consumes: `LoopStateType` from `src/langgraph/loop-state.ts`, `interrupt` from `@langchain/langgraph`
- Produces: `createAgentNode(type, options?)` factory function returning `(state, services) => Promise<Partial<LoopStateType>>`

- [ ] **Step 1: Read existing node implementations to understand the pattern**

```bash
cat src/langgraph/nodes/plan.node.ts
cat src/langgraph/nodes/execute.node.ts
cat src/langgraph/nodes/review.node.ts
```

- [ ] **Step 2: Create `src/langchain/node-runner.ts`**

```typescript
import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../langgraph/loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentServices {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

interface NodeConfig {
  skill: string;
  resultPath: (state: LoopStateType) => string;
  parseResult: (state: LoopStateType, content: string) => Partial<LoopStateType>;
}

function wavesPath(s: LoopStateType) {
  return path.join(s.mafwDir!, 'waves.json');
}

function receiptPath(s: LoopStateType) {
  return path.join(s.mafwDir!, 'receipts', s.goalId!, 'loop-receipt.json');
}

function reviewPath(s: LoopStateType) {
  return path.join(s.mafwDir!, 'reviews', `${s.goalId!}-loop${s.round}.md`);
}

function parseWavesResult(s: LoopStateType, content: string): Partial<LoopStateType> {
  JSON.parse(content);
  return { wavePlanPath: wavesPath(s) };
}

function parseReceiptResult(s: LoopStateType, content: string): Partial<LoopStateType> {
  JSON.parse(content);
  return { receiptPath: receiptPath(s) };
}

function parseReviewResult(s: LoopStateType, content: string): Partial<LoopStateType> {
  const verdict = parseReviewVerdict(content);
  return {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath(s),
    reviewFeedback: verdict.feedback,
  };
}

const NODE_CONFIGS: Record<string, NodeConfig> = {
  plan:    { skill: 'mafw-plan',    resultPath: wavesPath,   parseResult: parseWavesResult },
  execute: { skill: 'mafw-execute', resultPath: receiptPath, parseResult: parseReceiptResult },
  review:  { skill: 'mafw-review',  resultPath: reviewPath,  parseResult: parseReviewResult },
};

export function parseReviewVerdict(content: string): { verdict: 'PASS' | 'FAIL' | 'ERROR'; feedback: string } {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }
  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) {
      return { verdict: 'PASS', feedback: content.slice(0, 200) };
    }
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

export function createAgentNode(type: 'plan' | 'execute' | 'review') {
  return async (state: LoopStateType, options: AgentServices): Promise<Partial<LoopStateType>> => {
    const config = NODE_CONFIGS[type];
    const phaseKey = `${type.toUpperCase()}_IN_PROGRESS` as const;
    options.syncToFile({ ...state, phase: phaseKey });

    const sessionId = await options.createSession(state.projectDir!);
    await options.sendPrompt(sessionId, `/skill ${config.skill} ${state.goalId}`);

    interrupt('awaiting_agent');

    const rp = config.resultPath(state);
    if (!fs.existsSync(rp)) {
      return { lastError: `Result not found: ${rp}`, reviewVerdict: 'ERROR' };
    }
    const content = fs.readFileSync(rp, 'utf-8');
    const result = config.parseResult(state, content);

    await options.destroySession(sessionId);

    const phaseCompleteKey = `${type.toUpperCase()}_COMPLETE` as const;
    options.syncToFile({
      ...state,
      ...result,
      round: type === 'plan' ? state.round : state.round,
      phase: phaseCompleteKey,
    });

    return result;
  };
}
```

- [ ] **Step 3: Write the test file `tests/unit/langgraph/node-runner.test.ts`**

```typescript
import { createAgentNode } from '../../../src/langchain/node-runner';
import { LoopStateType } from '../../../src/langgraph/loop-state';
import * as path from 'path';
import * as fs from 'fs';
import os from 'os';

function makeState(overrides: Partial<LoopStateType> = {}): LoopStateType {
  return {
    goalId: 'test-goal',
    projectDir: os.tmpdir(),
    mafwDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-test-')),
    round: 1,
    maxRounds: 3,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
    phase: null,
    ...overrides,
  } as LoopStateType;
}

function mockServices() {
  const calls: string[] = [];
  return {
    createSession: async (_p: string) => { calls.push('createSession'); return 'sess-1'; },
    sendPrompt: async (_s: string, _m: string) => { calls.push('sendPrompt'); },
    destroySession: async (_s: string) => { calls.push('destroySession'); },
    syncToFile: (_st: any) => { calls.push('syncToFile'); },
    getCalls: () => calls,
    resetCalls: () => { calls.length = 0; },
  };
}

describe('createAgentNode', () => {
  describe('plan node', () => {
    it('returns ERROR when waves.json missing', async () => {
      const node = createAgentNode('plan');
      const state = makeState();
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.lastError).toContain('waves.json');
      expect(result.reviewVerdict).toBe('ERROR');
    });

    it('returns wavePlanPath when waves.json exists and valid', async () => {
      const state = makeState();
      const wavesPath = path.join(state.mafwDir!, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify({ waves: [] }));
      const node = createAgentNode('plan');
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.wavePlanPath).toBe(wavesPath);
      expect(result.lastError).toBeNull();
    });
  });

  describe('execute node', () => {
    it('returns ERROR when receipt missing', async () => {
      const node = createAgentNode('execute');
      const state = makeState();
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.lastError).toContain('loop-receipt.json');
      expect(result.reviewVerdict).toBe('ERROR');
    });

    it('returns receiptPath when receipt exists', async () => {
      const state = makeState();
      const recDir = path.join(state.mafwDir!, 'receipts', state.goalId!);
      fs.mkdirSync(recDir, { recursive: true });
      const recPath = path.join(recDir, 'loop-receipt.json');
      fs.writeFileSync(recPath, JSON.stringify({ status: 'done' }));
      const node = createAgentNode('execute');
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.receiptPath).toBe(recPath);
    });
  });

  describe('review node', () => {
    it('returns ERROR when review report missing', async () => {
      const node = createAgentNode('review');
      const state = makeState();
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.lastError).toContain('review report');
      expect(result.reviewVerdict).toBe('ERROR');
    });

    it('returns PASS verdict when review says pass', async () => {
      const state = makeState();
      const reviewDir = path.join(state.mafwDir!, 'reviews');
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewPath = path.join(reviewDir, `${state.goalId!}-loop${state.round}.md`);
      fs.writeFileSync(reviewPath, JSON.stringify({ verdict: 'PASS', reason: 'All good' }));
      const node = createAgentNode('review');
      const svc = mockServices();
      const result = await node(state, svc);
      expect(result.reviewVerdict).toBe('PASS');
      expect(result.reviewReportPath).toBe(reviewPath);
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails (no node-runner.ts yet—skip if already created)**

```bash
npx jest tests/unit/langgraph/node-runner.test.ts --no-coverage 2>&1 | head -20
```

- [ ] **Step 5: Refactor `src/langgraph/nodes/plan.node.ts` to use node-runner**

Replace entire file:

```typescript
import { createAgentNode } from '../../langchain/node-runner';
export const planNode = createAgentNode('plan');
```

- [ ] **Step 6: Refactor `src/langgraph/nodes/execute.node.ts`**

Replace entire file:

```typescript
import { createAgentNode } from '../../langchain/node-runner';
export const executeNode = createAgentNode('execute');
```

- [ ] **Step 7: Refactor `src/langgraph/nodes/review.node.ts`**

```typescript
import { createAgentNode, parseReviewVerdict } from '../../langchain/node-runner';
export const reviewNode = createAgentNode('review');
export { parseReviewVerdict };
```

- [ ] **Step 8: Update `src/langgraph/index.ts`**

```typescript
export { LoopState } from './loop-state';
export type { LoopStateType } from './loop-state';
export { routeAfterReview, buildExecutionGraph } from './graph';
export { planNode } from './nodes/plan.node';
export { executeNode } from './nodes/execute.node';
export { reviewNode, parseReviewVerdict } from './nodes/review.node';
export { archiveSuccessNode, archiveFailNode, archiveMaxRetriesNode } from './nodes/archive.node';
export { syncToDashboard } from './nodes/sync.node';
export { FileCheckpointer } from './checkpointer';
export { createAgentNode, AgentServices } from '../langchain/node-runner';
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx jest tests/unit/langgraph/node-runner.test.ts --no-coverage -v
```
Expected: 6 tests passed (or more, if you wrote additional cases).

- [ ] **Step 10: Run existing langgraph tests to verify no regression**

```bash
npx jest tests/unit/langgraph/ --no-coverage -v
```
Expected: all existing tests still pass.

- [ ] **Step 11: Commit**

```bash
git add src/langchain/node-runner.ts src/langgraph/nodes/plan.node.ts src/langgraph/nodes/execute.node.ts src/langgraph/nodes/review.node.ts src/langgraph/index.ts tests/unit/langgraph/node-runner.test.ts
git commit -m "refactor(langgraph): unify plan/execute/review nodes into config-driven node-runner"
```

---

### Task 2: CodeAgentAdapter

**Files:**
- Create: `src/langchain/agent-adapter.ts`
- Test: `tests/unit/langchain/agent-adapter.test.ts`

**Interfaces:**
- Consumes: LoopStateType, AgentServices (from node-runner)
- Produces: `CodeAgentAdapter` class extending `BaseSingleActionAgent`

- [ ] **Step 1: Create `src/langchain/agent-adapter.ts`**

```typescript
import { BaseSingleActionAgent } from "@langchain/core/agents";
import { AgentAction, AgentFinish } from "@langchain/core/agents";
import { IntermediateStep } from "@langchain/core/agents";
import { Callbacks } from "@langchain/core/callbacks/manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentServices } from './node-runner';

export class CodeAgentAdapter extends BaseSingleActionAgent {
  lc_namespace = ["mafw", "agent"];

  constructor(
    private services: AgentServices,
    private instruction: string,
    private goalId: string,
  ) {
    super();
  }

  get inputKeys(): string[] {
    return ["input"];
  }

  get outputKeys(): string[] {
    return ["output"];
  }

  async plan(
    _steps: IntermediateStep[],
    _callbacks: Callbacks | undefined,
    _config: RunnableConfig | undefined,
  ): Promise<AgentAction | AgentFinish> {
    const sessionId = await this.services.createSession(this.goalId);
    await this.services.sendPrompt(sessionId, this.instruction);
    // OpenCode SDK handles all tool calls via MCP internally
    // This agent always delegates - no LangChain-level tool loop
    return {
      returnValues: { output: 'delegated_to_opencode' },
      log: `Delegated to OpenCode SDK: ${this.instruction}`,
    };
  }
}
```

- [ ] **Step 2: Write test file `tests/unit/langchain/agent-adapter.test.ts`**

```bash
mkdir -p tests/unit/langchain
```

```typescript
import { CodeAgentAdapter } from '../../../src/langchain/agent-adapter';

function mockServices() {
  return {
    createSession: async (_p: string) => { return 'sess-1'; },
    sendPrompt: async (_s: string, _m: string) => {},
    destroySession: async (_s: string) => {},
    syncToFile: (_st: any) => {},
  };
}

describe('CodeAgentAdapter', () => {
  it('returns AgentFinish with delegation message', async () => {
    const adapter = new CodeAgentAdapter(mockServices(), '/skill test-cmd goal-1', 'goal-1');
    const result = await adapter.plan([], undefined, undefined);
    expect(result).toHaveProperty('returnValues');
    expect((result as any).returnValues.output).toContain('delegated_to_opencode');
  });

  it('has correct input/output keys', () => {
    const adapter = new CodeAgentAdapter(mockServices(), '', 'g-1');
    expect(adapter.inputKeys).toEqual(['input']);
    expect(adapter.outputKeys).toEqual(['output']);
  });

  it('sets lc_namespace correctly', () => {
    const adapter = new CodeAgentAdapter(mockServices(), '', 'g-1');
    expect(adapter.lc_namespace).toEqual(['mafw', 'agent']);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx jest tests/unit/langchain/agent-adapter.test.ts --no-coverage -v
```
Expected: 3 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/langchain/agent-adapter.ts tests/unit/langchain/agent-adapter.test.ts
git commit -m "feat(langchain): add CodeAgentAdapter wrapping OpenCode SDK as BaseSingleActionAgent"
```

---

### Task 3: MAFWRetriever

**Files:**
- Create: `src/langchain/retriever.ts`
- Test: `tests/unit/langchain/retriever.test.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager` interface (not imported directly—wraps via duck typing)
- Produces: `MAFWRetriever` class extending `BaseRetriever`

- [ ] **Step 1: Read the HarmonicIndexManager interface to know what to wrap**

```bash
cat src/memory/harmonic-index.ts | head -50
```

- [ ] **Step 2: Create `src/langchain/retriever.ts`**

```typescript
import { BaseRetriever } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import { Callbacks } from "@langchain/core/callbacks/manager";

interface HarmonicSearchResult {
  id: string;
  memory_value: string;
  memory_type: string;
  energy: number;
  salience?: number;
  abstraction_level?: number;
}

interface HarmonicIndexLike {
  hybridSearch(query: string, opts?: { limit?: number }): Promise<HarmonicSearchResult[]>;
}

export class MAFWRetriever extends BaseRetriever {
  lc_namespace = ["mafw", "retriever"];

  constructor(
    private harmonicIndex: HarmonicIndexLike,
    private defaultLimit: number = 10,
  ) {
    super();
  }

  async _getRelevantDocuments(
    query: string,
    _callbacks?: Callbacks,
  ): Promise<Document[]> {
    const results = await this.harmonicIndex.hybridSearch(query, {
      limit: this.defaultLimit,
    });
    return results.map((r) =>
      new Document({
        pageContent: r.memory_value,
        metadata: {
          id: r.id,
          type: r.memory_type,
          energy: r.energy,
          salience: r.salience,
          abstractionLevel: r.abstraction_level,
        },
      })
    );
  }
}
```

- [ ] **Step 3: Write test file `tests/unit/langchain/retriever.test.ts`**

```typescript
import { MAFWRetriever } from '../../../src/langchain/retriever';

function mockHarmonicIndex() {
  return {
    hybridSearch: async (query: string, opts?: { limit?: number }) => {
      return [
        {
          id: 'mem-1',
          memory_value: 'Test memory about ' + query,
          memory_type: 'semantic',
          energy: 0.8,
          salience: 1.0,
          abstraction_level: 2,
        },
      ];
    },
  };
}

describe('MAFWRetriever', () => {
  it('returns documents from harmonic index search', async () => {
    const retriever = new MAFWRetriever(mockHarmonicIndex());
    const docs = await retriever._getRelevantDocuments('test query');
    expect(docs).toHaveLength(1);
    expect(docs[0].pageContent).toContain('test query');
    expect(docs[0].metadata.type).toBe('semantic');
    expect(docs[0].metadata.energy).toBe(0.8);
  });

  it('respects defaultLimit', async () => {
    let actualLimit = 0;
    const index = {
      hybridSearch: async (q: string, opts?: { limit?: number }) => {
        actualLimit = opts?.limit ?? 0;
        return [];
      },
    };
    const retriever = new MAFWRetriever(index, 5);
    await retriever._getRelevantDocuments('q');
    expect(actualLimit).toBe(5);
  });

  it('has correct lc_namespace', () => {
    const retriever = new MAFWRetriever(mockHarmonicIndex());
    expect(retriever.lc_namespace).toEqual(['mafw', 'retriever']);
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npx jest tests/unit/langchain/retriever.test.ts --no-coverage -v
```
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/langchain/retriever.ts tests/unit/langchain/retriever.test.ts
git commit -m "feat(langchain): add MAFWRetriever wrapping HarmonicIndexManager as BaseRetriever"
```

---

### Task 4: MAFWMemory

**Files:**
- Create: `src/langchain/memory.ts`
- Test: `tests/unit/langchain/memory.test.ts`

**Interfaces:**
- Consumes: HarmonicIndexLike interface, parametric store interface
- Produces: `MAFWMemory` class extending `BaseMemory`

- [ ] **Step 1: Read existing memory injection hooks to understand the data flow**

```bash
cat src/hooks/user-prompt.ts
```

- [ ] **Step 2: Create `src/langchain/memory.ts`**

```typescript
import { BaseMemory } from "@langchain/core/memory";
import { InputValues, MemoryVariables } from "@langchain/core/memory";
import { BaseMessage } from "@langchain/core/messages";

interface HarmonicIndexLike {
  hybridSearch(query: string, opts?: { limit?: number }): Promise<any[]>;
  addObservation(data: { text: string; source: string }): Promise<string>;
}

interface AxiomStoreLike {
  getActiveAxioms(): Promise<Array<{ id: string; content: string }>>;
}

interface ParametricStoreLike {
  getActiveDeltas(): Promise<Array<{ id: string; rule: string }>>;
}

export class MAFWMemory extends BaseMemory {
  memoryKeys = ['l3_constraints', 'l5_axioms', 'hot_memories'] as const;

  constructor(
    private harmonicIndex: HarmonicIndexLike,
    private parametricStore?: ParametricStoreLike,
    private axiomStore?: AxiomStoreLike,
  ) {
    super();
  }

  async loadMemoryVariables(_values: InputValues): Promise<MemoryVariables> {
    const [hotResults, l3Deltas, l5Axioms] = await Promise.all([
      this.harmonicIndex.hybridSearch('', { limit: 5 }),
      this.parametricStore?.getActiveDeltas() ?? Promise.resolve([]),
      this.axiomStore?.getActiveAxioms() ?? Promise.resolve([]),
    ]);
    return {
      hot_memories: hotResults.map((r: any) => r.memory_value).join('\n'),
      l3_constraints: l3Deltas.map((d: any) => d.rule).join('\n'),
      l5_axioms: l5Axioms.map((a: any) => a.content).join('\n'),
    };
  }

  async saveContext(_input: InputValues, output: Record<string, any>): Promise<void> {
    const result = output?.output || output?.result || JSON.stringify(output);
    await this.harmonicIndex.addObservation({
      text: typeof result === 'string' ? result : JSON.stringify(result),
      source: 'agent_execution',
    });
  }
}
```

- [ ] **Step 3: Write test file `tests/unit/langchain/memory.test.ts`**

```typescript
import { MAFWMemory } from '../../../src/langchain/memory';

function mockHarmonicIndex() {
  const observations: string[] = [];
  return {
    hybridSearch: async (_q: string, _opts?: { limit?: number }) => [
      { memory_value: 'Hot memory 1' },
      { memory_value: 'Hot memory 2' },
    ],
    addObservation: async (data: { text: string; source: string }) => {
      observations.push(data.text);
      return 'obs-1';
    },
    getObservations: () => observations,
  };
}

describe('MAFWMemory', () => {
  it('loads hot memories from harmonic index', async () => {
    const hi = mockHarmonicIndex();
    const mem = new MAFWMemory(hi);
    const vars = await mem.loadMemoryVariables({});
    expect(vars.hot_memories).toContain('Hot memory 1');
    expect(vars.hot_memories).toContain('Hot memory 2');
  });

  it('returns empty strings when stores are not provided', async () => {
    const hi = mockHarmonicIndex();
    const mem = new MAFWMemory(hi);
    const vars = await mem.loadMemoryVariables({});
    expect(vars.l3_constraints).toBe('');
    expect(vars.l5_axioms).toBe('');
  });

  it('saves observations to harmonic index', async () => {
    const hi = mockHarmonicIndex();
    const mem = new MAFWMemory(hi);
    await mem.saveContext({ input: 'test' }, { output: 'execution result' });
    expect(hi.getObservations()).toContain('execution result');
  });

  it('has correct memoryKeys', () => {
    const mem = new MAFWMemory(mockHarmonicIndex());
    expect(mem.memoryKeys).toEqual(['l3_constraints', 'l5_axioms', 'hot_memories']);
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npx jest tests/unit/langchain/memory.test.ts --no-coverage -v
```
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/langchain/memory.ts tests/unit/langchain/memory.test.ts
git commit -m "feat(langchain): add MAFWMemory wrapping HarmonicMemory as BaseMemory"
```

---

### Task 5: Barrel Export + MCP Adapter

**Files:**
- Create: `src/langchain/index.ts`
- Modify: `gateway/package.json` (add `langchain-mcp-adapters` dependency)
- Modify: `gateway/src/index.ts` (add MCP client connection)

**Interfaces:**
- Consumes: All components from tasks 1-4
- Produces: Unified `@mafw/langchain` barrel

- [ ] **Step 1: Create `src/langchain/index.ts`**

```typescript
export { CodeAgentAdapter } from './agent-adapter';
export { MAFWRetriever } from './retriever';
export { MAFWMemory } from './memory';
export { createAgentNode, AgentServices, parseReviewVerdict } from './node-runner';
```

- [ ] **Step 2: Add langchain-mcp-adapters to gateway**

```bash
cd gateway && npm install langchain-mcp-adapters
```

- [ ] **Step 3: Add MCP client initialization in gateway**

Edit `gateway/src/index.ts` to add near the top (after existing imports):

```typescript
// Near existing MCP imports (around line 9)
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
```

And add in the constructor or init method:

```typescript
// After MCP SSE endpoint setup (around line 300-400)
private async initLangChainTools() {
  try {
    const mcpClient = MultiServerMCPClient.fromSSE('http://localhost:3001/sse');
    const tools = await mcpClient.getTools();
    console.log(`[LangChain] Loaded ${tools.length} MCP tools`);
    return tools;
  } catch (err) {
    console.warn('[LangChain] MCP client init failed (non-fatal):', err);
    return [];
  }
}
```

- [ ] **Step 4: Verify gateway starts without error**

```bash
cd gateway && npm run build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/langchain/index.ts gateway/package.json gateway/src/index.ts
git commit -m "feat(langchain): add barrel export and langchain-mcp-adapters integration"
```

---

### Task 6: Cleanup + Full Test Suite

**Files:**
- No file changes — verification and cleanup only

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -20
```
Expected: All tests pass. Note any failures.

- [ ] **Step 2: Run with coverage**

```bash
npx jest 2>&1 | tail -20
```
Expected: Coverage thresholds met (80% branches, functions, lines, statements).

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No TypeScript errors.

- [ ] **Step 4: Run gateway build**

```bash
cd gateway && npm run build 2>&1 | tail -5
```
Expected: No errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git status
git commit -m "chore: final cleanup after langchain native refactoring"
```
