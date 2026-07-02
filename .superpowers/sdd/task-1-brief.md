# Task 1: Cost types + SQLite table

## Purpose
First task of MAFW v6.0 P1. Create the foundational cost tracking types and SQLite storage table. All subsequent cost features depend on these types.

## Files
- Create: `src/cost/types.ts` — CostRecord, CostSummary interfaces, estimation functions
- Modify: `src/storage/sqlite-storage.ts` — add `cost_logs` table to `initSchema()`
- Test: `tests/unit/cost-types.test.ts`

## Interfaces (Produced)
- `CostRecord` — per-tool-call cost record
- `CostSummary` — aggregated cost with byWave/byTool breakdown
- `generateCostId()` — unique ID generator
- `estimateTokens(toolName, input)` — token estimation per tool type
- `estimateCost(tokens, model)` — USD cost calculation

## Global Constraints
- Do NOT modify any v5.0 Search/Graph/Storage/StateLock/Energy modules except `src/storage/sqlite-storage.ts`
- All new SQLite tables must be created via `initSchema()` in `src/storage/sqlite-storage.ts`
- Every new module must have a unit test
- commit messages: conventional commits (`feat:` prefix)
- Cost estimation coefficients: file_edit/mafw_observe/search = 0 tokens; LLM calls = inputChars/4 tokens; Sonnet rate = $0.003/1K tokens

## Existing code to be aware of
- `src/storage/sqlite-storage.ts` has an `initSchema()` method at line 35 that creates the `memories` table with FTS5 and triggers. Append the `cost_logs` table creation after line 68.
- `better-sqlite3` is the database library.

## Step-by-step

### Step 1: Write `src/cost/types.ts`

Full content:

```typescript
export interface CostRecord {
  id: string;
  goalId: string;
  loopNum: number;
  waveNum?: number;
  toolName: string;
  estimatedTokens: number;
  estimatedCost: number;
  timestamp: string;
}

export interface CostSummary {
  totalTokens: number;
  totalCost: number;
  byWave: Array<{ waveNum: number; tokens: number; cost: number }>;
  byTool: Array<{ toolName: string; tokens: number; cost: number }>;
}

export function generateCostId(): string {
  return `cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function estimateTokens(toolName: string, input: string): number {
  if (['file_edit', 'file_write', 'mafw_observe', 'mafw_search_hybrid'].includes(toolName)) {
    return 0;
  }
  return Math.ceil(input.length / 4);
}

export function estimateCost(tokens: number, model: string = 'sonnet'): number {
  const RATES: Record<string, number> = { sonnet: 0.003, haiku: 0.0015 };
  const rate = RATES[model] || RATES.sonnet;
  return (tokens / 1000) * rate;
}
```

### Step 2: Write `tests/unit/cost-types.test.ts`

```typescript
import { estimateTokens, estimateCost, generateCostId } from '../../src/cost/types';

describe('Cost Types', () => {
  it('estimates zero tokens for file tools', () => {
    expect(estimateTokens('file_edit', 'some content')).toBe(0);
    expect(estimateTokens('mafw_observe', 'some content')).toBe(0);
  });

  it('estimates tokens for LLM calls based on input length', () => {
    const result = estimateTokens('mafw_review', 'a'.repeat(100));
    expect(result).toBe(25);
  });

  it('calculates cost based on token count and model rate', () => {
    const sonnetCost = estimateCost(1000, 'sonnet');
    expect(sonnetCost).toBeCloseTo(3.0, 1);

    const haikuCost = estimateCost(1000, 'haiku');
    expect(haikuCost).toBeCloseTo(1.5, 1);
  });

  it('generates unique cost IDs', () => {
    const a = generateCostId();
    const b = generateCostId();
    expect(a).not.toBe(b);
  });
});
```

### Step 3: Modify `src/storage/sqlite-storage.ts`

In the `initSchema()` method, after the existing triggers (line 68), append:

```typescript
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_logs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        loop_num INTEGER NOT NULL,
        wave_num INTEGER,
        tool_name TEXT NOT NULL,
        estimated_tokens INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        timestamp TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cost_goal ON cost_logs(goal_id);
      CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_logs(timestamp);
    `);
```

## Tests to Run
```bash
npx vitest run tests/unit/cost-types.test.ts --reporter=verbose
```

## Report Contract
Write report to `.superpowers/sdd/task-1-report.md` with:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commits (short hashes + messages)
- Test results (command + output)
- Any concerns
