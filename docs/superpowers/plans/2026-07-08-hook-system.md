# Hook System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete hook system across 3 waves: memory internal hooks, new platform bridge hooks, handoff + stub completion.

**Architecture:** 13 hooks total, all dispatched via existing HookManager. 4 memory-internal events emitted directly by memory components. 6 platform-bridged events (4 new, 2 upgraded from stubs). 1 handoff event triggered manually. 2 on_memory_* events emitted internally.

**Tech Stack:** TypeScript, OpenCode Plugin API v1, Jest for testing

## Global Constraints

- All hooks registered via existing `HookManager` — no new event bus
- Event naming convention: `{namespace}.{action}` — `memory.write`, `session.start`, `tool.execute.before`
- HookManager reference injected into memory component constructors as optional (`null`-safe)
- Every new hook handler file goes in `src/hooks/`
- Existing `config.hooks.enabled` array controls which hooks are active at runtime
- Existing `config.hooks.failBehavior` and `config.hooks.timeout` apply to all hooks
- Test coverage ≥ 80% for all new code (per AGENTS.md 5.2)

---

## File Structure

```
src/hooks/
├── hook-manager.ts              (unchanged)
├── session-ending.ts            (unchanged)
├── session-start.ts             [NEW] — load base memories on session.created
├── session-compacting.ts        [NEW] — extract key info before compaction
├── tool-before.ts               [NEW] — inject tool context memory
├── observation-capture.ts       [NEW] — tool output → T1 working memory
├── user-prompt.ts               [NEW] — pre-fetch memories on chat.message
├── llm-after.ts                 [NEW] — record LLM reasoning as observation
├── handoff.ts                   [NEW] — transfer memory context on handoff
src/memory/
├── harmonic-index.ts            (modify — emit memory.write, memory.recall)
├── merger.ts                    (modify — emit memory.contradiction)
├── energy-system.ts             (modify — emit memory.decay)
src/plugin.ts                    (modify — add all bridge points)
tests/unit/hooks/
├── hook-manager.test.ts         (unchanged)
├── session-start.test.ts        [NEW]
├── session-compacting.test.ts   [NEW]
├── tool-before.test.ts          [NEW]
├── observation-capture.test.ts  [NEW]
├── user-prompt.test.ts          [NEW]
├── llm-after.test.ts            [NEW]
├── handoff.test.ts              [NEW]
```

---

## Wave 1: Memory Internal Hooks (4 hooks)

### Task 1.1: Add HookManager reference to HarmonicIndexManager

**Files:**
- Modify: `src/memory/harmonic-index.ts`

**Interfaces:**
- Produces: `HarmonicIndexManager` constructor accepts optional `hookManager?: { execute: (event: string, ctx: any) => Promise<void> }`

- [ ] **Step 1: Add constructor parameter**

Modify `src/memory/harmonic-index.ts` — change constructor to accept optional hookManager:

```typescript
import type { HarmonicUnit, HarmonicIndex, HarmonicIndexEntry } from './harmonic-types';

interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

export class HarmonicIndexManager {
  private indexPath: string;
  private index: HarmonicIndex;
  private hookManager: HookManagerLike | null;

  constructor(baseDir: string, hookManager?: HookManagerLike | null) {
    const memoryDir = path.join(baseDir, 'memory');
    this.indexPath = path.join(memoryDir, '.harmonic_index.json');
    this.index = this.load();
    this.hookManager = hookManager || null;
  }
```

- [ ] **Step 2: Emit memory.write after addEntry**

In `addEntry()`, after `this.save()`, add:

```typescript
  this.hookManager?.execute('memory.write', {
    unit,
    tier,
    source: 'HarmonicIndexManager.addEntry'
  });
```

- [ ] **Step 3: Emit memory.recall after search**

In `search()`, after `return scored...`, capture result IDs before return and emit:

```typescript
  search(query: string, topK: number = 20): HarmonicIndexEntry[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (tokens.length === 0) return [];

    const scored = this.index.entries.map(entry => {
      const text = (entry.primary_abstraction + ' ' + entry.cue_anchors.join(' ')).toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);
        if (matches) score += matches.length;
      }
      return { entry, score: score * entry.energy };
    });

    const results = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry);

    this.hookManager?.execute('memory.recall', {
      query,
      resultIds: results.map(r => r.id),
      source: 'HarmonicIndexManager.search'
    });

    return results;
  }
```

- [ ] **Step 4: Run tests to verify**

```bash
npm test -- tests/unit/hooks/hook-manager.test.ts
```

Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/memory/harmonic-index.ts
git commit -m "feat(harmonic-index): emit memory.write and memory.recall hooks"
```

### Task 1.2: Add HookManager reference to DeltaMerger

**Files:**
- Modify: `src/memory/merger.ts`

**Interfaces:**
- Produces: `DeltaMerger` constructor accepts optional `hookManager?: { execute: (event: string, ctx: any) => Promise<void> }`

- [ ] **Step 1: Add constructor parameter and emit contradiction**

Modify `src/memory/merger.ts`:

```typescript
import { Delta, MergeResult, Conflict } from '../types/parametric';

interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

export class DeltaMerger {
  private hookManager: HookManagerLike | null;

  constructor(hookManager?: HookManagerLike | null) {
    this.hookManager = hookManager || null;
  }

  merge(deltas: Delta[]): MergeResult {
    const merged = new Map<string, Delta>();
    const conflicts: Conflict[] = [];
    const banned: string[] = [];

    for (const d of deltas) {
      if (merged.has(d.id)) {
        const existing = merged.get(d.id)!;
        this.hookManager?.execute('memory.contradiction', {
          existingId: existing.id,
          newId: d.id,
          field: 'id',
          existingValue: existing.id,
          newValue: d.id
        });
        // ... existing logic
      }

      const semanticDup = this.findSemanticDuplicate(d, merged.values());
      if (semanticDup) {
        this.hookManager?.execute('memory.contradiction', {
          existingId: semanticDup.id,
          newId: d.id,
          field: 'content',
          existingValue: this.getContent(semanticDup).substring(0, 100),
          newValue: this.getContent(d).substring(0, 100)
        });
        // ... existing logic
      }
      // ... rest unchanged
    }

    return { merged: Array.from(merged.values()), conflicts, banned };
  }
  // ... rest unchanged
```

- [ ] **Step 2: Check existing DeltaMerger usage**

Search for `new DeltaMerger()` in codebase. If any instantiation exists, update with `new DeltaMerger(hookManager)`.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/memory/merger.ts
git commit -m "feat(merger): emit memory.contradiction hook"
```

### Task 1.3: Add HookManager reference to EnergySystem

**Files:**
- Modify: `src/memory/energy-system.ts`

**Interfaces:**
- Produces: `EnergySystem` constructor accepts optional `hookManager?: { execute: (event: string, ctx: any) => Promise<void> }`

- [ ] **Step 1: Add constructor parameter**

```typescript
interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

export class EnergySystem {
  private decayRatePerDay: number;
  private readonly minEnergy = 0.0;
  private readonly maxEnergy = 1.0;
  private cleanupThreshold: number;
  private criticalThreshold: number;
  private hookManager: HookManagerLike | null;

  constructor(config?: {
    decayRatePerDay?: number;
    cleanupThreshold?: number;
    criticalThreshold?: number;
    hookManager?: HookManagerLike | null;
  }) {
    this.decayRatePerDay = config?.decayRatePerDay ?? 0.01;
    this.cleanupThreshold = config?.cleanupThreshold ?? 0.3;
    this.criticalThreshold = config?.criticalThreshold ?? 0.8;
    this.hookManager = config?.hookManager || null;
  }
```

- [ ] **Step 2: Emit memory.decay on significant decay**

In `calculateEnergy()`, after computing new energy, emit if energy dropped significantly:

```typescript
  calculateEnergy(currentEnergy: number, event: EnergyEvent, daysSinceLastUpdate: number, salience: number = 1.0): number {
    const effectiveDecay = this.decayRatePerDay * (1 / Math.max(0.1, salience));
    let energy = currentEnergy - effectiveDecay * Math.max(0, daysSinceLastUpdate);
    energy += EVENT_DELTAS[event.type];
    const clamped = Math.max(this.minEnergy, Math.min(this.maxEnergy, energy));

    const threshold = currentEnergy * 0.3;
    if (clamped < currentEnergy - threshold) {
      this.hookManager?.execute('memory.decay', {
        oldEnergy: currentEnergy,
        newEnergy: clamped,
        reason: `decay: ${effectiveDecay * Math.max(0, daysSinceLastUpdate)} over ${daysSinceLastUpdate} days, event: ${event.type}`,
        unitId: 'unknown'
      });
    }

    return clamped;
  }
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/memory/energy-system.ts
git commit -m "feat(energy-system): emit memory.decay hook"
```

### Task 1.4: Register default handlers for memory hooks in plugin.ts

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Register 4 memory event handlers**

After the `hookManager.register({name: 'cost-threshold', ...})` block (line 206), add:

```typescript
  // ── Wave 1: Memory Internal Hooks ──
  hookManager.register({
    name: 'memory-write-handler',
    event: 'memory.write',
    handler: async (ctx) => {
      const { unit, tier, source } = ctx.data || ctx;
      console.log(`[hook:memory.write] ${unit?.id} -> tier ${tier} (from ${source})`);
      // Update cognitive graph associations
      if (cognitiveGraph && unit) {
        // auto-associate with goal
        if (unit.goal_id) {
          cognitiveGraph.addConnection(unit.id, `goal:${unit.goal_id}`);
        }
      }
    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-recall-handler',
    event: 'memory.recall',
    handler: async (ctx) => {
      const { query, resultIds } = ctx.data || ctx;
      console.log(`[hook:memory.recall] "${query.substring(0, 50)}" -> ${resultIds?.length || 0} results`);
      // Strengthen associations between co-recalled memories
      if (cognitiveGraph && resultIds && resultIds.length > 1) {
        for (let i = 0; i < resultIds.length; i++) {
          for (let j = i + 1; j < resultIds.length; j++) {
            cognitiveGraph.addConnection(resultIds[i], resultIds[j]);
          }
        }
      }
    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-contradiction-handler',
    event: 'memory.contradiction',
    handler: async (ctx) => {
      const { existingId, newId, field, existingValue, newValue } = ctx.data || ctx;
      console.log(`[hook:memory.contradiction] ${existingId} vs ${newId} on ${field}`);
      // Placeholder: future conflict resolution logic
    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-decay-handler',
    event: 'memory.decay',
    handler: async (ctx) => {
      const { oldEnergy, newEnergy, reason, unitId } = ctx.data || ctx;
      if (newEnergy < 0.3) {
        console.log(`[hook:memory.decay] ${unitId} fell below cleanup threshold (${newEnergy})`);
        // Future: trigger GC / archival
      }
    },
    priority: 100
  });
```

- [ ] **Step 2: Pass hookManager to memory component constructors**

Replace the `HarmonicIndexManager` instantiation (line 67):

```typescript
  const harmonicIndex = new HarmonicIndexManager(mafwDir, hookManager);
```

Find and update `EnergySystem` instantiation — check if constructor takes config object:

```typescript
  // existing EnergySystem usage - update to pass hookManager
  const energySystem = new EnergySystem({
    ...config?.memory?.energy,
    hookManager
  });
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts src/memory/
git commit -m "feat(plugin): register default memory hook handlers"
```

---

## Wave 2: New Platform Bridge Hooks (6 hooks)

### Task 2.1: Create session-start handler

**Files:**
- Create: `src/hooks/session-start.ts`
- Test: `tests/unit/hooks/session-start.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/hooks/session-start.test.ts`:

```typescript
import { sessionStartHook } from '../../../src/hooks/session-start';

describe('sessionStartHook', () => {
  test('loads base memory on session start', async () => {
    const ctx = { sessionId: 'test-session' };
    const result = await sessionStartHook(ctx, { mafwDir: '/tmp/test-mafw' });
    // Should complete without error
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/hooks/session-start.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create handler**

`src/hooks/session-start.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface SessionStartContext {
  sessionId: string;
  goalId?: string;
  projectDir?: string;
}

export async function sessionStartHook(ctx: SessionStartContext, options?: { mafwDir?: string }): Promise<void> {
  const projectDir = ctx.projectDir || process.cwd();
  const mafwDir = options?.mafwDir || path.join(projectDir, '.opencode', 'mafw');
  const goalDir = path.join(mafwDir, 'goals');

  console.log(`[hook:session-start] Session ${ctx.sessionId} started`);

  if (!fs.existsSync(goalDir)) return;

  const files = fs.readdirSync(goalDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return;

  // Load the most recent goal charter
  const latest = files.sort().reverse()[0];
  const goalPath = path.join(goalDir, latest);
  const goalContent = fs.readFileSync(goalPath, 'utf-8');

  console.log(`[hook:session-start] Loaded goal charter: ${latest} (${goalContent.length} chars)`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/hooks/session-start.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-start.ts tests/unit/hooks/session-start.test.ts
git commit -m "feat(hooks): add session-start handler"
```

### Task 2.2: Create tool-before handler

**Files:**
- Create: `src/hooks/tool-before.ts`
- Test: `tests/unit/hooks/tool-before.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { toolBeforeHook } from '../../../src/hooks/tool-before';

describe('toolBeforeHook', () => {
  test('injects tool context', async () => {
    const ctx = { tool: 'read', sessionID: 'test' };
    const result = await toolBeforeHook(ctx as any);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/hooks/tool-before.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create handler**

```typescript
export interface ToolBeforeContext {
  tool: string;
  sessionID: string;
  callID?: string;
  args?: any;
}

export async function toolBeforeHook(ctx: ToolBeforeContext): Promise<{ args?: any } | void> {
  console.log(`[hook:tool.before] Tool ${ctx.tool} (session: ${ctx.sessionID})`);
  // Future: inject tool-specific context memories
  // Future: validate preconditions based on parametric deltas
}
```

- [ ] **Step 4: Run test**

```bash
npm test -- tests/unit/hooks/tool-before.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/tool-before.ts tests/unit/hooks/tool-before.test.ts
git commit -m "feat(hooks): add tool-before handler"
```

### Task 2.3: Create user-prompt handler

**Files:**
- Create: `src/hooks/user-prompt.ts`
- Test: `tests/unit/hooks/user-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { userPromptHook } from '../../../src/hooks/user-prompt';

describe('userPromptHook', () => {
  test('pre-fetches memories', async () => {
    const ctx = { sessionID: 'test', messageID: 'msg-1', text: 'implement auth' };
    const result = await userPromptHook(ctx as any);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Create handler**

```typescript
export interface UserPromptContext {
  sessionID: string;
  messageID?: string;
  agent?: string;
  model?: string;
  text?: string;
}

export async function userPromptHook(ctx: UserPromptContext): Promise<void> {
  if (!ctx.text) return;
  console.log(`[hook:user.prompt] Session ${ctx.sessionID}: "${ctx.text.substring(0, 80)}..."`);
  // Future: trigger hybrid search pre-fetch based on user text
  // This is a lighter-weight alternative to experimental.chat.messages.transform
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/user-prompt.ts tests/unit/hooks/user-prompt.test.ts
git commit -m "feat(hooks): add user-prompt handler"
```

### Task 2.4: Create llm-after handler

**Files:**
- Create: `src/hooks/llm-after.ts`
- Test: `tests/unit/hooks/llm-after.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { llmAfterHook } from '../../../src/hooks/llm-after';

describe('llmAfterHook', () => {
  test('records LLM reasoning', async () => {
    const ctx = { sessionID: 'test', messageID: 'msg-1', partID: 'part-1', text: 'The answer is 42' };
    const result = await llmAfterHook(ctx as any);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Create handler**

```typescript
export interface LlmAfterContext {
  sessionID: string;
  messageID?: string;
  partID?: string;
  text?: string;
}

export async function llmAfterHook(ctx: LlmAfterContext): Promise<void> {
  if (!ctx.text) return;
  console.log(`[hook:llm.after] Session ${ctx.sessionID}: ${ctx.text.length} chars`);
  // Future: record LLM reasoning as T1 observation
  // Future: feed into compression pipeline for lesson extraction
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/llm-after.ts tests/unit/hooks/llm-after.test.ts
git commit -m "feat(hooks): add llm-after handler"
```

### Task 2.5: Upgrade tool-executed handler → observation capture

**Files:**
- Create: `src/hooks/observation-capture.ts`
- Modify: `src/hooks/tool-executed.ts` (add delegation)
- Test: `tests/unit/hooks/observation-capture.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { captureObservation } from '../../../src/hooks/observation-capture';

describe('captureObservation', () => {
  test('captures tool output as observation', async () => {
    const result = await captureObservation({
      toolName: 'read',
      output: 'file content here',
      args: '{"path": "/test.txt"}'
    });
    expect(result).toBeDefined();
    expect(result.type).toBe('observation');
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Create observation-capture module**

```typescript
export interface Observation {
  type: 'observation';
  tool: string;
  args: string;
  output: string;
  timestamp: string;
  summary: string;
}

export interface CaptureResult {
  observation?: Observation;
}

export async function captureObservation(ctx: {
  toolName: string;
  output: string;
  args?: string;
}): Promise<CaptureResult> {
  const outputLength = ctx.output?.length || 0;
  const summary = outputLength > 200
    ? ctx.output.substring(0, 100) + '...' + ctx.output.substring(outputLength - 100)
    : ctx.output;

  console.log(`[hook:observation] ${ctx.toolName}: ${outputLength} chars`);

  return {
    observation: {
      type: 'observation',
      tool: ctx.toolName,
      args: ctx.args || '',
      output: ctx.output || '',
      timestamp: new Date().toISOString(),
      summary
    }
  };
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Update tool-executed.ts to use observation capture**

```typescript
import { captureObservation } from './observation-capture';

export async function toolExecutedHook(hookContext: ToolExecutedHookContext): Promise<void> {
  const { toolName, output, projectDir } = hookContext;

  if (output?.length > 1000) {
    console.log(`[hook:tool-executed] Compressing output for ${toolName} (${output.length} chars)`);
    const truncated = output.length > 2000
      ? output.slice(0, 500) + '\n... [TRUNCATED] ...\n' + output.slice(-500)
      : output;
    console.log(`[hook:tool-executed] Output compressed for ${toolName} (${truncated.length} chars)`);
  }

  // Capture observation for memory
  await captureObservation({ toolName, output, args: '' });
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/unit/hooks/observation-capture.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/observation-capture.ts src/hooks/tool-executed.ts tests/unit/hooks/observation-capture.test.ts
git commit -m "feat(hooks): upgrade tool-executed with observation capture"
```

### Task 2.6: Create session-compacting handler (upgrade from stub)

**Files:**
- Create: `src/hooks/session-compacting.ts`
- Modify: `src/plugin.ts` (upgrade compacting stub)
- Test: `tests/unit/hooks/session-compacting.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { sessionCompactingHook } from '../../../src/hooks/session-compacting';

describe('sessionCompactingHook', () => {
  test('extracts key info before compaction', async () => {
    const result = await sessionCompactingHook({ sessionID: 'test-session' });
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Create handler**

```typescript
export interface SessionCompactingContext {
  sessionID: string;
  projectDir?: string;
}

export async function sessionCompactingHook(ctx: SessionCompactingContext): Promise<void> {
  console.log(`[hook:session.compacting] Session ${ctx.sessionID} — preserving high-energy context`);
  // Future: scan about-to-be-dropped messages
  // Future: extract key decisions and patterns
  // Future: write as T1/T2 observations to harmonic memory
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Register compacting handler in HookManager + upgrade stub in plugin.ts**

In `src/plugin.ts`, replace the `experimental.session.compacting` stub (lines 551-554):

```typescript
    'experimental.session.compacting': async ({ sessionID }: any, { snapshot }: any) => {
      await hookManager.execute('session.compacting', { sessionID, projectDir: directory });
    },
```

Then register the handler in the hookManager block:

```typescript
  hookManager.register({
    name: 'session-compacting',
    event: 'session.compacting',
    handler: async (ctx) => {
      await sessionCompactingHook({ sessionID: ctx.sessionID, projectDir: directory });
    },
    priority: 100
  });
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/session-compacting.ts src/plugin.ts tests/unit/hooks/session-compacting.test.ts
git commit -m "feat(hooks): session-compacting handler with HookManager bridge"
```

### Task 2.7: Bridge all new platform events in plugin.ts

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Add 4 new bridge points**

Import new handlers at top of file:

```typescript
import { sessionStartHook } from './hooks/session-start';
import { toolBeforeHook } from './hooks/tool-before';
import { userPromptHook } from './hooks/user-prompt';
import { llmAfterHook } from './hooks/llm-after';
```

Add to `event` callback (replace lines 557-561):

```typescript
    event: async ({ event }: any) => {
      if (event.type === 'session.created') {
        await hookManager.execute('session.start', {
          sessionId: event.info?.id || event.sessionID,
          projectDir: directory
        });
      }
      if (event.type === 'session.status') {
        // Status updates — future use
      }
    }
```

Add to `hooks` object (replace lines 544-548):

```typescript
    hooks: {
      'session.end': (ctx: any) => hookManager.execute('session.end', ctx),
      'tool.execute.before': (ctx: any) => hookManager.execute('tool.execute.before', ctx),
      'tool.execute.after': (ctx: any, result: any) => hookManager.execute('tool.execute.after', { ...ctx, data: result }),
      'chat.message': (ctx: any) => hookManager.execute('user.prompt.submit', ctx),
    },
```

Add to returned object — experimental hooks:

```typescript
    'experimental.chat.messages.transform': async (input: any, output: any) => {
      // ... existing implementation unchanged ...
    },
    'experimental.text.complete': async ({ sessionID, messageID, partID }: any, result: any) => {
      await hookManager.execute('llm.call.after', {
        sessionID, messageID, partID, text: result?.text || ''
      });
    },
    'experimental.session.compacting': async ({ sessionID }: any, { snapshot }: any) => {
      await hookManager.execute('session.compacting', { sessionID, projectDir: directory });
    },
```

- [ ] **Step 2: Register handlers for each new event**

After existing registrations:

```typescript
  // ── Wave 2: Session Start ──
  hookManager.register({
    name: 'session-start',
    event: 'session.start',
    handler: async (ctx) => {
      await sessionStartHook({ sessionId: ctx.sessionId, projectDir: directory });
    },
    priority: 5
  });

  // ── Wave 2: Tool Before ──
  hookManager.register({
    name: 'tool-before',
    event: 'tool.execute.before',
    handler: async (ctx) => {
      await toolBeforeHook({ tool: ctx.tool, sessionID: ctx.sessionID, callID: ctx.callID, args: ctx.args });
    },
    priority: 100
  });

  // ── Wave 2: User Prompt ──
  hookManager.register({
    name: 'user-prompt',
    event: 'user.prompt.submit',
    handler: async (ctx) => {
      await userPromptHook({ sessionID: ctx.sessionID, text: ctx.message?.parts?.[0]?.text || '' });
    },
    priority: 50
  });

  // ── Wave 2: LLM After ──
  hookManager.register({
    name: 'llm-after',
    event: 'llm.call.after',
    handler: async (ctx) => {
      await llmAfterHook({ sessionID: ctx.sessionID, text: ctx.text });
    },
    priority: 50
  });
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts src/hooks/session-start.ts src/hooks/tool-before.ts src/hooks/user-prompt.ts src/hooks/llm-after.ts
git commit -m "feat(plugin): bridge 4 new platform events + register handlers"
```

---

## Wave 3: Handoff + Stub Completion

### Task 3.1: Create handoff handler

**Files:**
- Create: `src/hooks/handoff.ts`
- Test: `tests/unit/hooks/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { handoffHook } from '../../../src/hooks/handoff';

describe('handoffHook', () => {
  test('transfers memory context on handoff', async () => {
    const ctx = { from: 'mafw-plan', to: 'mafw-execute', goalId: '001-auth', context: { wave: 2 } };
    const result = await handoffHook(ctx);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Create handler**

```typescript
export interface HandoffContext {
  from: string;
  to: string;
  goalId: string;
  context?: any;
  projectDir?: string;
}

export async function handoffHook(ctx: HandoffContext): Promise<void> {
  console.log(`[hook:session.handoff] ${ctx.from} → ${ctx.to} (goal: ${ctx.goalId})`);

  if (ctx.context) {
    console.log(`[hook:session.handoff] Transferring context: ${JSON.stringify(ctx.context).substring(0, 200)}`);
  }

  // Future: warm cache for target agent
  // Future: transfer memory state (active deltas, recent observations)
  // Future: set cross-agent context flags
}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Register handoff hook in plugin.ts**

```typescript
import { handoffHook } from './hooks/handoff';

// In hook registrations:
  hookManager.register({
    name: 'session-handoff',
    event: 'session.handoff',
    handler: async (ctx) => {
      await handoffHook({
        from: ctx.from,
        to: ctx.to,
        goalId: ctx.goalId,
        context: ctx.context,
        projectDir: directory
      });
    },
    priority: 100
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/handoff.ts tests/unit/hooks/handoff.test.ts
git commit -m "feat(hooks): add handoff handler"
```

### Task 3.2: Add handoff trigger points in MAFW handoff flow

**Files:**
- Modify: `src/engine/phase-orchestrator.ts` (or wherever handoff happens)
- Or: `src/plugin.ts` — expose hookManager for handoff calls

**Note:** Handoff flow location varies. Search for handoff files write:

```typescript
// In the handoff completion code (where handoffs/{goalId}.json is written):
if (hookManager) {
  await hookManager.execute('session.handoff', {
    from: currentPhase,
    to: nextPhase,
    goalId,
    context: { /* relevant state */ }
  });
}
```

- [ ] **Step 1: Find handoff completion code**

```bash
rg "handoffs" src/ --include "*.ts" -l
```

- [ ] **Step 2: Add handoff hook trigger at handoff completion point**

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: trigger session.handoff hook at handoff points"
```

### Task 3.3: Final integration test — all hooks fire correctly

- [ ] **Step 1: Verify all 13 hooks registered**

Write an integration test (`tests/unit/hooks/hook-registration.test.ts`):

```typescript
import { HookManager } from '../../../src/hooks/hook-manager';

describe('All hooks registration', () => {
  test('all 13 hooks are defined', () => {
    const manager = new HookManager();

    // Wave 1: Memory internal
    manager.register({ name: 'test-write', event: 'memory.write', handler: async () => {}, priority: 100 });
    manager.register({ name: 'test-recall', event: 'memory.recall', handler: async () => {}, priority: 100 });
    manager.register({ name: 'test-contradiction', event: 'memory.contradiction', handler: async () => {}, priority: 100 });
    manager.register({ name: 'test-decay', event: 'memory.decay', handler: async () => {}, priority: 100 });

    // Wave 2: Platform bridge
    manager.register({ name: 'test-session-start', event: 'session.start', handler: async () => {}, priority: 10 });
    manager.register({ name: 'test-session-end', event: 'session.end', handler: async () => {}, priority: 100 });
    manager.register({ name: 'test-tool-before', event: 'tool.execute.before', handler: async () => {}, priority: 100 });
    manager.register({ name: 'test-tool-after', event: 'tool.execute.after', handler: async () => {}, priority: 50 });
    manager.register({ name: 'test-user-prompt', event: 'user.prompt.submit', handler: async () => {}, priority: 50 });
    manager.register({ name: 'test-llm-after', event: 'llm.call.after', handler: async () => {}, priority: 50 });
    manager.register({ name: 'test-session-compacting', event: 'session.compacting', handler: async () => {}, priority: 100 });

    // Wave 3: Handoff
    manager.register({ name: 'test-handoff', event: 'session.handoff', handler: async () => {}, priority: 100 });

    expect(manager.size()).toBe(13);
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Final commit**

```bash
git add tests/unit/hooks/hook-registration.test.ts
git commit -m "test: verify all 13 hooks registered"
```
