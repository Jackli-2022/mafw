# Multi-Platform Usage Progress Bars — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-level quota tracking (opencode-go, zen) with ASCII progress bars showing 5h/7d/month window usage, integrated into the existing UsageDock sidebar tab.

**Architecture:** Extend `trajectory_turns` with `provider` column, add a `UsagePoller` service that aggregates local trajectory data into quota windows, expose via merged `GET /api/usage` endpoint, and render ASCII progress bars in UsageDock alongside existing token stats.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), SolidJS, Jest

## Global Constraints

- Provider column must be backfilled from existing `model` strings (e.g., `xiaomi/mimo-v2.5` → `xiaomi`)
- Quota limits are hardcoded defaults in config, user-overridable via `~/.config/mafw/config.yaml` `usage:` section
- Pacing formula: `pacing = pct_used − pct_time_elapsed`, `>+10 → ahead`, `<−10 → under`, else `on-track`
- Severity: 0-49% low (green) / 50-74% mid (yellow) / 75-89% high (orange) / 90-100% critical (red)
- ASCII bar: 20 chars, `█` filled / `░` empty
- Poll interval: 60s, fail-open (retain last good data on error)
- No SQL views — aggregate in TypeScript (403 turns ≈ 1ms)
- Route regex must use `(?:\?|$)` anchor to avoid query string conflicts

---

### Task 1: Add `provider` Column to `trajectory_turns`

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts:80-99` (schema)
- Modify: `gateway/src/trajectory/types.ts:47-65` (TrajectoryTurn interface)
- Modify: `gateway/src/trajectory/collector.ts:133-156` (capture providerID)
- Modify: `gateway/src/trajectory/trajectory-store.ts:30-50,92-134` (row mapping + upsert)
- Test: `tests/unit/trajectory/provider-column.test.ts`

**Interfaces:**
- Consumes: `info.providerID` from opencode `message.updated` event (assistant role)
- Produces: `TrajectoryTurn.provider: string | null` field available to downstream queries

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/trajectory/provider-column.test.ts
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { TrajectoryTurn } from '../../../gateway/src/trajectory/types';

describe('TrajectoryStore provider column', () => {
  let db: GatewayDatabase;
  let store: TrajectoryStore;

  beforeEach(() => {
    db = new GatewayDatabase(':memory:');
    store = new TrajectoryStore(db, 'test-project');
  });

  afterEach(() => {
    db.close();
  });

  it('stores and retrieves provider field', () => {
    const turn: TrajectoryTurn = {
      projectID: 'test-project',
      sessionID: 'ses_123',
      turnID: 1,
      turnStartMs: Date.now(),
      turnEndMs: Date.now() + 1000,
      durationMs: 1000,
      toolCount: 0,
      toolErrorCount: 0,
      reasoningCount: 0,
      agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.01,
      finish: 'stop',
      model: 'mimo-v2.5',
      provider: 'xiaomi',
      agent: 'default',
      userText: 'test',
    };
    store.upsertTurn(turn);
    const result = store.getSessionTrajectory('ses_123', { limit: 10 });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].provider).toBe('xiaomi');
  });

  it('handles null provider gracefully', () => {
    const turn: TrajectoryTurn = {
      projectID: 'test-project',
      sessionID: 'ses_456',
      turnID: 1,
      turnStartMs: Date.now(),
      turnEndMs: Date.now() + 1000,
      durationMs: 1000,
      toolCount: 0,
      toolErrorCount: 0,
      reasoningCount: 0,
      agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.01,
      finish: 'stop',
      model: 'claude-3-haiku',
      provider: null,
      agent: 'default',
      userText: 'test',
    };
    store.upsertTurn(turn);
    const result = store.getSessionTrajectory('ses_456', { limit: 10 });
    expect(result.turns[0].provider).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/trajectory/provider-column.test.ts`
Expected: FAIL with "provider is not defined" or type error

- [ ] **Step 3: Add provider to TrajectoryTurn type**

Edit `gateway/src/trajectory/types.ts:47-65`:

```typescript
export interface TrajectoryTurn {
  projectID: string;
  sessionID: string;
  turnID: number;
  turnStartMs: number;
  turnEndMs: number | null;
  durationMs: number | null;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  provider: string | null;  // NEW
  agent: string | null;
  userText: string;
  assistantText?: string;
}
```

- [ ] **Step 4: Add provider column to schema**

Edit `gateway/src/memory/gateway-db.ts:80-99`, add `provider TEXT` after `model TEXT`:

```typescript
CREATE TABLE IF NOT EXISTS trajectory_turns (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL,
  turn_start_ms REAL NOT NULL,
  turn_end_ms REAL,
  duration_ms REAL,
  tool_count INTEGER DEFAULT 0,
  tool_error_count INTEGER DEFAULT 0,
  reasoning_count INTEGER DEFAULT 0,
  agent_switch_count INTEGER DEFAULT 0,
  tokens TEXT,
  cost REAL DEFAULT 0,
  finish TEXT,
  model TEXT,
  provider TEXT,
  agent TEXT,
  user_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, turn_id)
);
```

Add migration after the CREATE TABLE:

```typescript
// Migration: add provider column if missing
try {
  this.db.exec('ALTER TABLE trajectory_turns ADD COLUMN provider TEXT');
} catch (e: any) {
  if (!e.message?.includes('duplicate column')) throw e;
}
```

- [ ] **Step 5: Update rowToTurn mapping**

Edit `gateway/src/trajectory/trajectory-store.ts:30-50`:

```typescript
function rowToTurn(row: any): TrajectoryTurn {
  return {
    projectID: row.project_id,
    sessionID: row.session_id,
    turnID: row.turn_id,
    turnStartMs: row.turn_start_ms,
    turnEndMs: row.turn_end_ms,
    durationMs: row.duration_ms,
    toolCount: row.tool_count,
    toolErrorCount: row.tool_error_count,
    reasoningCount: row.reasoning_count,
    agentSwitchCount: row.agent_switch_count,
    tokens: row.tokens ? JSON.parse(row.tokens) : { ...EMPTY_TOKENS },
    cost: row.cost,
    finish: row.finish,
    model: row.model,
    provider: row.provider ?? null,  // NEW
    agent: row.agent,
    userText: row.user_text,
    assistantText: row.assistant_text ?? undefined,
  };
}
```

- [ ] **Step 6: Update upsertTurn SQL**

Edit `gateway/src/trajectory/trajectory-store.ts:92-134`, add `provider` to INSERT and UPDATE:

```typescript
upsertTurn(turn: TrajectoryTurn): void {
  this.rawDb
    .prepare(
      `INSERT INTO trajectory_turns
       (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms,
        tool_count, tool_error_count, reasoning_count, agent_switch_count,
        tokens, cost, finish, model, provider, agent, user_text, assistant_text)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(session_id, turn_id) DO UPDATE SET
         turn_end_ms = excluded.turn_end_ms,
         duration_ms = excluded.duration_ms,
         tool_count = excluded.tool_count,
         tool_error_count = excluded.tool_error_count,
         reasoning_count = excluded.reasoning_count,
         agent_switch_count = excluded.agent_switch_count,
         tokens = excluded.tokens,
         cost = excluded.cost,
         finish = excluded.finish,
         model = excluded.model,
         provider = excluded.provider,
         agent = excluded.agent,
         user_text = excluded.user_text,
         assistant_text = excluded.assistant_text`,
    )
    .run(
      turn.projectID,
      turn.sessionID,
      turn.turnID,
      turn.turnStartMs,
      turn.turnEndMs,
      turn.durationMs,
      turn.toolCount,
      turn.toolErrorCount,
      turn.reasoningCount,
      turn.agentSwitchCount,
      JSON.stringify(turn.tokens),
      turn.cost,
      turn.finish,
      turn.model,
      turn.provider ?? null,
      turn.agent,
      turn.userText,
      turn.assistantText ?? null,
    );
}
```

- [ ] **Step 7: Capture providerID in collector**

Edit `gateway/src/trajectory/collector.ts:14-35` (TurnState interface):

```typescript
interface TurnState {
  turnID: number;
  turnStartMs: number;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  provider: string | null;  // NEW
  agent: string | null;
  userText: string;
  userMessageID: string | null;
  assistantText: string;
  assistantMessageID: string | null;
  stepFinishMessageIDs: Set<string>;
  toolCallIDs: Set<string>;
  reasoningPartIDs: Set<string>;
  lastModel: string | null;
  projectID: string;
}
```

Edit `gateway/src/trajectory/collector.ts:59-87` (stateFor initialization):

```typescript
s = {
  turnID: turnID ?? (this.store.currentTurnId(sessionID) || 1),
  turnStartMs: Date.now(),
  toolCount: 0,
  toolErrorCount: 0,
  reasoningCount: 0,
  agentSwitchCount: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0,
  finish: null,
  model: null,
  provider: null,  // NEW
  agent: null,
  userText: '',
  userMessageID: null,
  assistantText: '',
  assistantMessageID: null,
  stepFinishMessageIDs: new Set(),
  toolCallIDs: new Set(),
  reasoningPartIDs: new Set(),
  lastModel: null,
  projectID: projectID || this.projectID,
};
```

Edit `gateway/src/trajectory/collector.ts:133-156` (assistant message handler), capture providerID:

```typescript
if (info.role === 'assistant') {
  const s = this.stateFor(sessionID, undefined, projectID);
  if (info.modelID && s.lastModel && info.modelID !== s.lastModel) {
    s.agentSwitchCount++;
    const evt = this.emit(sessionID, s, 'model_switch', { model: info.modelID }, projectID);
    s.lastModel = info.modelID;
    return evt;
  }
  s.lastModel = info.modelID || s.lastModel;
  s.model = info.modelID || s.model;
  s.provider = info.providerID || s.provider;  // NEW
  if (!s.stepFinishMessageIDs.has(info.id) && info.finish && info.tokens) {
    s.stepFinishMessageIDs.add(info.id);
    s.tokens = addTokens(s.tokens, info.tokens);
    s.cost += info.cost || 0;
    s.finish = info.finish;
    const evt = this.emit(sessionID, s, 'step_finish', {
      model: info.modelID,
      tokens: info.tokens,
      cost: info.cost,
      finish: info.finish,
    }, projectID);
    return evt;
  }
  return null;
}
```

Edit `gateway/src/trajectory/collector.ts:250-278` (onIdle), add provider to turn:

```typescript
onIdle(sessionID: string): TrajectoryTurn | null {
  const s = this.turns.get(sessionID);
  log.info(`[Trajectory] onIdle: sessionID=${sessionID}, hasState=${!!s}`);
  if (!s) return null;
  s.finish = s.finish || 'idle';
  const turn: TrajectoryTurn = {
    projectID: s.projectID,
    sessionID,
    turnID: s.turnID,
    turnStartMs: s.turnStartMs,
    turnEndMs: Date.now(),
    durationMs: Date.now() - s.turnStartMs,
    toolCount: s.toolCount,
    toolErrorCount: s.toolErrorCount,
    reasoningCount: s.reasoningCount,
    agentSwitchCount: s.agentSwitchCount,
    tokens: s.tokens,
    cost: s.cost,
    finish: s.finish,
    model: s.model,
    provider: s.provider,  // NEW
    agent: s.agent,
    userText: s.userText,
    assistantText: s.assistantText,
  };
  this.store.upsertTurn(turn);
  this.emit(sessionID, s, 'turn_end', {}, s.projectID);
  this.turns.delete(sessionID);
  return turn;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/unit/trajectory/provider-column.test.ts`
Expected: PASS

- [ ] **Step 9: Add backfill script**

Create `gateway/src/trajectory/backfill-provider.ts`:

```typescript
import { GatewayDatabase } from '../memory/gateway-db';
import { log } from '../core/utils/logger';

export function backfillProviderColumn(db: GatewayDatabase): void {
  const rawDb = (db as any).db;
  
  const rows = rawDb
    .prepare('SELECT session_id, turn_id, model FROM trajectory_turns WHERE provider IS NULL AND model IS NOT NULL')
    .all() as { session_id: string; turn_id: number; model: string }[];

  if (rows.length === 0) {
    log.info('[Backfill] No turns need provider backfill');
    return;
  }

  const update = rawDb.prepare('UPDATE trajectory_turns SET provider = ? WHERE session_id = ? AND turn_id = ?');
  let updated = 0;

  for (const row of rows) {
    const provider = inferProvider(row.model);
    if (provider) {
      update.run(provider, row.session_id, row.turn_id);
      updated++;
    }
  }

  log.info(`[Backfill] Updated ${updated}/${rows.length} turns with provider`);
}

function inferProvider(model: string): string | null {
  if (model.includes('/')) {
    return model.split('/')[0];
  }
  const knownProviders: Record<string, string> = {
    'claude': 'anthropic',
    'gpt': 'openai',
    'deepseek': 'deepseek',
    'mimo': 'xiaomi',
    'qwen': 'alibaba-cn',
  };
  for (const [prefix, provider] of Object.entries(knownProviders)) {
    if (model.toLowerCase().includes(prefix)) return provider;
  }
  return null;
}
```

- [ ] **Step 10: Call backfill on gateway startup**

Edit `gateway/src/index.ts` in the `initServices()` method (around line 300-350), add after trajectory store initialization:

```typescript
import { backfillProviderColumn } from './trajectory/backfill-provider';

// After trajectoryStore is created:
backfillProviderColumn(this.getGatewayDb());
```

- [ ] **Step 11: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/trajectory/types.ts gateway/src/trajectory/collector.ts gateway/src/trajectory/trajectory-store.ts gateway/src/trajectory/backfill-provider.ts gateway/src/index.ts tests/unit/trajectory/provider-column.test.ts
git commit -m "feat(trajectory): add provider column to trajectory_turns with backfill"
```

---

### Task 2: Model Prices Table (Partial, opencode-go/Zen Only)

**Files:**
- Create: `gateway/src/usage/model-prices.ts`
- Test: `tests/unit/usage/model-prices.test.ts`

**Interfaces:**
- Consumes: model ID string (e.g., `deepseek-v4-flash`)
- Produces: `getModelPrice(modelID: string): { input: number; output: number; cachedRead: number; cachedWrite: number } | null` (per 1M tokens in USD)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/usage/model-prices.test.ts
import { getModelPrice } from '../../../gateway/src/usage/model-prices';

describe('getModelPrice', () => {
  it('returns price for known model', () => {
    const price = getModelPrice('deepseek-v4-flash');
    expect(price).not.toBeNull();
    expect(price!.input).toBeGreaterThan(0);
    expect(price!.output).toBeGreaterThan(0);
  });

  it('returns null for unknown model', () => {
    const price = getModelPrice('unknown-model-xyz');
    expect(price).toBeNull();
  });

  it('matches partial model names', () => {
    const price = getModelPrice('xiaomi/mimo-v2.5');
    expect(price).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/usage/model-prices.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement model prices table**

Create `gateway/src/usage/model-prices.ts`:

```typescript
interface ModelPrice {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
}

const PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cachedRead: 0.014, cachedWrite: 0 },
  'deepseek-v3': { input: 0.27, output: 1.10, cachedRead: 0.07, cachedWrite: 0 },
  'deepseek-r1': { input: 0.55, output: 2.19, cachedRead: 0.14, cachedWrite: 0 },
  'mimo-v2.5': { input: 0.10, output: 0.30, cachedRead: 0.01, cachedWrite: 0 },
  'qwen3.7-max': { input: 0.20, output: 0.60, cachedRead: 0.02, cachedWrite: 0 },
  'qwen3-coder-plus': { input: 0.15, output: 0.45, cachedRead: 0.015, cachedWrite: 0 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00, cachedRead: 0.30, cachedWrite: 3.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cachedRead: 0.03, cachedWrite: 0.30 },
  'gpt-4o': { input: 2.50, output: 10.00, cachedRead: 1.25, cachedWrite: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedRead: 0.075, cachedWrite: 0 },
};

export function getModelPrice(modelID: string): ModelPrice | null {
  if (PRICES[modelID]) return PRICES[modelID];
  
  const normalized = modelID.includes('/') ? modelID.split('/')[1] : modelID;
  if (PRICES[normalized]) return PRICES[normalized];
  
  for (const [key, price] of Object.entries(PRICES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return price;
    }
  }
  
  return null;
}

export function calculateCost(
  modelID: string,
  tokens: { input: number; output: number; cache: { read: number; write: number } },
): number {
  const price = getModelPrice(modelID);
  if (!price) return 0;
  
  const inputCost = (tokens.input / 1_000_000) * price.input;
  const outputCost = (tokens.output / 1_000_000) * price.output;
  const cachedReadCost = (tokens.cache.read / 1_000_000) * price.cachedRead;
  const cachedWriteCost = (tokens.cache.write / 1_000_000) * price.cachedWrite;
  
  return inputCost + outputCost + cachedReadCost + cachedWriteCost;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/usage/model-prices.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/model-prices.ts tests/unit/usage/model-prices.test.ts
git commit -m "feat(usage): add model prices table for cost estimation fallback"
```

---

### Task 3: UsagePoller with opencode-go/zen Adapters

**Files:**
- Create: `gateway/src/usage/usage-poller.ts`
- Create: `gateway/src/usage/types.ts`
- Test: `tests/unit/usage/usage-poller.test.ts`

**Interfaces:**
- Consumes: `TrajectoryStore` instance, config with quota limits
- Produces: `UsageProvider` interface, `UsagePoller` class with `poll(): Promise<UsageResponse>`

- [ ] **Step 1: Define types**

Create `gateway/src/usage/types.ts`:

```typescript
export type WindowType = '5h' | '7d' | 'month' | 'balance';
export type Severity = 'low' | 'mid' | 'high' | 'critical';
export type Pacing = 'ahead' | 'on-track' | 'under';

export interface UsageWindow {
  window: WindowType;
  used: number;
  limit: number;
  unit: '$' | 'tokens' | 'requests';
  resetAt?: number;
  pct: number;
  pacing?: Pacing;
}

export interface UsageProvider {
  name: string;
  plan?: string;
  windows: UsageWindow[];
  severity: Severity;
}

export interface UsageResponse {
  providers: UsageProvider[];
  updatedAt: number;
}

export interface QuotaLimits {
  'opencode-go': { '5h': number; '7d': number; month: number };
  zen: { balance: number };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/usage/usage-poller.test.ts
import { UsagePoller } from '../../../gateway/src/usage/usage-poller';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';

describe('UsagePoller', () => {
  let db: GatewayDatabase;
  let store: TrajectoryStore;
  let poller: UsagePoller;

  beforeEach(() => {
    db = new GatewayDatabase(':memory:');
    store = new TrajectoryStore(db, 'test-project');
    poller = new UsagePoller(store, {
      'opencode-go': { '5h': 12, '7d': 30, month: 60 },
      zen: { balance: 100 },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty providers when no turns exist', async () => {
    const result = await poller.poll();
    expect(result.providers).toHaveLength(0);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('aggregates opencode-go turns into 5h window', async () => {
    const now = Date.now();
    store.upsertTurn({
      projectID: 'test-project',
      sessionID: 'ses_1',
      turnID: 1,
      turnStartMs: now - 3600_000,
      turnEndMs: now - 3500_000,
      durationMs: 100_000,
      toolCount: 0,
      toolErrorCount: 0,
      reasoningCount: 0,
      agentSwitchCount: 0,
      tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 2.5,
      finish: 'stop',
      model: 'deepseek-v4-flash',
      provider: 'opencode-go',
      agent: 'default',
      userText: 'test',
    });

    const result = await poller.poll();
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].name).toBe('opencode-go');
    expect(result.providers[0].windows).toHaveLength(3);
    
    const window5h = result.providers[0].windows.find(w => w.window === '5h');
    expect(window5h).toBeDefined();
    expect(window5h!.used).toBeCloseTo(2.5, 1);
    expect(window5h!.limit).toBe(12);
    expect(window5h!.pct).toBeGreaterThan(0);
  });

  it('calculates severity correctly', async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      store.upsertTurn({
        projectID: 'test-project',
        sessionID: `ses_${i}`,
        turnID: 1,
        turnStartMs: now - 3600_000,
        turnEndMs: now - 3500_000,
        durationMs: 100_000,
        toolCount: 0,
        toolErrorCount: 0,
        reasoningCount: 0,
        agentSwitchCount: 0,
        tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 1.0,
        finish: 'stop',
        model: 'deepseek-v4-flash',
        provider: 'opencode-go',
        agent: 'default',
        userText: 'test',
      });
    }

    const result = await poller.poll();
    const window5h = result.providers[0].windows.find(w => w.window === '5h');
    expect(window5h!.used).toBeCloseTo(10, 0);
    expect(window5h!.pct).toBeGreaterThan(80);
    expect(result.providers[0].severity).toBe('high');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/usage/usage-poller.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement UsagePoller**

Create `gateway/src/usage/usage-poller.ts`:

```typescript
import { TrajectoryStore } from '../trajectory/trajectory-store';
import { UsageProvider, UsageResponse, UsageWindow, QuotaLimits, Severity, Pacing, WindowType } from './types';

const WINDOW_MS: Record<WindowType, number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'month': 30 * 24 * 60 * 60 * 1000,
  'balance': 0,
};

export class UsagePoller {
  private lastGood: UsageResponse | null = null;

  constructor(
    private store: TrajectoryStore,
    private limits: QuotaLimits,
  ) {}

  async poll(): Promise<UsageResponse> {
    try {
      const providers: UsageProvider[] = [];
      
      const opencodeGo = this.aggregateProvider('opencode-go', this.limits['opencode-go']);
      if (opencodeGo.windows.length > 0) providers.push(opencodeGo);
      
      const zen = this.aggregateProvider('zen', this.limits.zen);
      if (zen.windows.length > 0) providers.push(zen);
      
      const result: UsageResponse = { providers, updatedAt: Date.now() };
      this.lastGood = result;
      return result;
    } catch (err: any) {
      if (this.lastGood) return this.lastGood;
      return { providers: [], updatedAt: Date.now() };
    }
  }

  private aggregateProvider(name: string, limits: Record<string, number>): UsageProvider {
    const rawDb = (this.store as any).rawDb || (this.store as any).db?.db;
    if (!rawDb) return { name, windows: [], severity: 'low' };

    const now = Date.now();
    const windows: UsageWindow[] = [];

    for (const [windowKey, limit] of Object.entries(limits)) {
      const windowType = windowKey as WindowType;
      const windowMs = WINDOW_MS[windowType];
      
      if (windowType === 'balance') {
        const totalCost = this.getTotalCost(name, rawDb);
        if (totalCost > 0) {
          const pct = Math.round((totalCost / limit) * 100);
          windows.push({
            window: 'balance',
            used: Math.round(totalCost * 100) / 100,
            limit,
            unit: '$',
            pct,
          });
        }
        continue;
      }

      const cutoff = now - windowMs;
      const cost = this.getCostInWindow(name, cutoff, rawDb);
      
      if (cost > 0) {
        const pct = Math.round((cost / limit) * 100);
        const resetAt = this.getResetAt(name, cutoff, rawDb, windowMs);
        const pacing = this.calculatePacing(pct, cutoff, now, windowMs);
        
        windows.push({
          window: windowType,
          used: Math.round(cost * 100) / 100,
          limit,
          unit: '$',
          resetAt,
          pct,
          pacing,
        });
      }
    }

    const severity = this.calculateSeverity(windows);
    return { name, windows, severity };
  }

  private getTotalCost(provider: string, db: any): number {
    const row = db
      .prepare('SELECT SUM(cost) as total FROM trajectory_turns WHERE provider = ?')
      .get(provider) as { total: number | null };
    return row?.total || 0;
  }

  private getCostInWindow(provider: string, cutoff: number, db: any): number {
    const row = db
      .prepare('SELECT SUM(cost) as total FROM trajectory_turns WHERE provider = ? AND turn_start_ms >= ?')
      .get(provider, cutoff) as { total: number | null };
    return row?.total || 0;
  }

  private getResetAt(provider: string, cutoff: number, db: any, windowMs: number): number {
    const row = db
      .prepare('SELECT MIN(turn_start_ms) as earliest FROM trajectory_turns WHERE provider = ? AND turn_start_ms >= ?')
      .get(provider, cutoff) as { earliest: number | null };
    if (!row?.earliest) return Date.now() + windowMs;
    return row.earliest + windowMs;
  }

  private calculatePacing(pctUsed: number, cutoff: number, now: number, windowMs: number): Pacing {
    const elapsed = now - cutoff;
    const pctElapsed = Math.round((elapsed / windowMs) * 100);
    const diff = pctUsed - pctElapsed;
    
    if (diff > 10) return 'ahead';
    if (diff < -10) return 'under';
    return 'on-track';
  }

  private calculateSeverity(windows: UsageWindow[]): Severity {
    if (windows.length === 0) return 'low';
    const maxPct = Math.max(...windows.map(w => w.pct));
    
    if (maxPct >= 90) return 'critical';
    if (maxPct >= 75) return 'high';
    if (maxPct >= 50) return 'mid';
    return 'low';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/usage/usage-poller.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/usage/types.ts gateway/src/usage/usage-poller.ts tests/unit/usage/usage-poller.test.ts
git commit -m "feat(usage): add UsagePoller with opencode-go and zen adapters"
```

---

### Task 4: Consolidated `GET /api/usage` Endpoint

**Files:**
- Modify: `gateway/src/index.ts:3442-3464` (replace `/api/usage/summary`)
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts` (add `usage()` method)
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts` (add `usage()` to sessions)
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts` (add types)
- Test: manual curl verification

**Interfaces:**
- Consumes: `UsagePoller.poll()`, `TrajectoryStore` session/project/global summaries
- Produces: `GET /api/usage?sessionID=xxx&projectID=xxx` returning `{ summary, providers, updatedAt }`

- [ ] **Step 1: Add config section for usage limits**

Edit `gateway/src/config.ts:6-166` (GatewayConfig interface), add after `recall`:

```typescript
usage: {
  pollIntervalMs: number;
  limits: {
    'opencode-go': { '5h': number; '7d': number; month: number };
    zen: { balance: number };
  };
};
```

Edit `gateway/src/config.ts:168-319` (defaults function), add after `recall`:

```typescript
usage: {
  pollIntervalMs: 60000,
  limits: {
    'opencode-go': { '5h': 12, '7d': 30, month: 60 },
    zen: { balance: 100 },
  },
},
```

Add getter in `Config` class (around line 402-416):

```typescript
get usage() { return this.data.usage; }
```

- [ ] **Step 2: Initialize UsagePoller in gateway**

Edit `gateway/src/index.ts` near the top (imports):

```typescript
import { UsagePoller } from './usage/usage-poller';
```

Add private field in the `Scheduler` class (around line 200-250):

```typescript
private usagePoller: UsagePoller | null = null;
```

In `initServices()` method (around line 300-350), after trajectoryStore initialization:

```typescript
this.usagePoller = new UsagePoller(this.trajectoryStore, config.usage.limits);
```

- [ ] **Step 3: Replace `/api/usage/summary` with consolidated `/api/usage`**

Edit `gateway/src/index.ts:3442-3464`, replace the entire `/api/usage/summary` handler:

```typescript
// GET /api/usage?sessionID=xxx&projectID=xxx — consolidated usage (summary + providers)
if (req.url?.match(/^\/api\/usage(?:\?|$)/) && req.method === 'GET') {
  try {
    const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const sessionID = parsedUrl.searchParams.get('sessionID') || '';
    const projectID = parsedUrl.searchParams.get('projectID') || '';
    const store = this.trajectoryStore;
    const empty = { totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, sessionCount: 0 };
    const summary: any = { session: { ...empty, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, project: { ...empty }, global: { ...empty } };
    
    if (store) {
      if (sessionID) summary.session = store.getSessionTokenSummary(sessionID);
      if (projectID) summary.project = store.getProjectTokenSummary(projectID);
      summary.global = store.getGlobalTokenSummary();
    }
    
    const providers = this.usagePoller ? await this.usagePoller.poll() : { providers: [], updatedAt: Date.now() };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ summary, ...providers }));
  } catch (err: any) {
    log.warn(`[Usage] failed: ${err.message}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ summary: null, providers: [], updatedAt: Date.now() }));
  }
  return;
}
```

- [ ] **Step 4: Update SDK client**

Edit `opencode-dev/packages/gateway-sdk/src/client.ts`, add method to `session` object (around line 35-100):

```typescript
usage: async (params?: { sessionID?: string; projectID?: string }): Promise<any> => {
  const query = new URLSearchParams();
  if (params?.sessionID) query.set('sessionID', params.sessionID);
  if (params?.projectID) query.set('projectID', params.projectID);
  const qs = query.toString();
  return this.request<any>(`/api/usage${qs ? '?' + qs : ''}`);
},
```

- [ ] **Step 5: Update preload API**

Edit `opencode-dev/packages/desktop/src/preload/mafw-api.ts`, add to `sessions` namespace:

```typescript
usage: (sessionID?: string, projectID?: string) => ipcRenderer.invoke('mafw-invoke', 'sessions', 'usage', sessionID, projectID),
```

Edit `opencode-dev/packages/desktop/src/preload/mafw-types.ts`, add to `MafwAPI` interface:

```typescript
usage: (sessionID?: string, projectID?: string) => Promise<any>;
```

- [ ] **Step 6: Test manually**

Run: `curl.exe -s "http://127.0.0.1:3000/api/usage?sessionID=test&projectID=test" | python -m json.tool`
Expected: JSON with `summary` and `providers` fields

- [ ] **Step 7: Commit**

```bash
git add gateway/src/config.ts gateway/src/index.ts opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(usage): consolidate /api/usage endpoint with summary + providers"
```

---

### Task 5: UsageDock UI with ASCII Progress Bars

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx` (add provider section)
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css` (add ASCII bar styles)

**Interfaces:**
- Consumes: `window.api.mafw.sessions.usage()` returning `{ summary, providers, updatedAt }`
- Produces: Updated UsageDock component with provider windows section

- [ ] **Step 1: Add ASCII bar helper function**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx`, add after `fmtCost` function:

```typescript
const asciiBar = (pct: number, width = 20): string => {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
};

const fmtTime = (ms: number): string => {
  if (ms <= 0) return '<1h';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d${hours % 24}h`;
  }
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
};

const pacingIcon = (pacing?: string): string => {
  if (pacing === 'ahead') return '↑';
  if (pacing === 'under') return '↓';
  return '→';
};

const severityClass = (severity: string): string => {
  if (severity === 'critical') return 'mafw-usage-severity-critical';
  if (severity === 'high') return 'mafw-usage-severity-high';
  if (severity === 'mid') return 'mafw-usage-severity-mid';
  return 'mafw-usage-severity-low';
};
```

- [ ] **Step 2: Update fetchSummary to use new endpoint**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx:84-96`, replace `fetchSummary`:

```typescript
const fetchSummary = async () => {
  const sid = props.sessionID;
  if (!sid) return;
  setLoading(true);
  try {
    const r = await window.api.mafw.sessions.usage(sid, props.projectID || undefined);
    setApiData(r);
  } catch (e: any) {
    console.warn("[UsageDock] fetch failed:", e?.message);
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 3: Update apiData signal type**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx:81`, update type:

```typescript
const [apiData, setApiData] = createSignal<{
  summary: { session: TokenSummary | null; project: TokenSummary | null; global: TokenSummary | null };
  providers: any[];
  updatedAt: number;
} | null>(null);
```

- [ ] **Step 4: Add ProviderSection component**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx`, add before `UsageDock` export:

```typescript
function ProviderSection(props: { provider: any }) {
  const p = () => props.provider;
  return (
    <div class={`mafw-usage-provider ${severityClass(p().severity)}`}>
      <div class="mafw-usage-provider-header">
        <span class="mafw-usage-provider-name">{p().name}</span>
        <Show when={p().plan}>
          <span class="mafw-usage-provider-plan">({p().plan})</span>
        </Show>
      </div>
      <For each={p().windows}>
        {(w: any) => (
          <div class="mafw-usage-window">
            <span class="mafw-usage-window-label">{w.window}</span>
            <span class="mafw-usage-window-bar">{asciiBar(w.pct)}</span>
            <span class="mafw-usage-window-pct">{w.pct}%</span>
            <span class="mafw-usage-window-detail">
              {w.unit === '$' ? `$${w.used}/${w.limit}` : `${w.used}/${w.limit}`}
            </span>
            <Show when={w.resetAt}>
              <span class="mafw-usage-window-reset">{fmtTime(w.resetAt - Date.now())}</span>
            </Show>
            <Show when={w.pacing}>
              <span class="mafw-usage-window-pacing">{pacingIcon(w.pacing)}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
```

Add `For` to imports at top:

```typescript
import { createSignal, createEffect, createMemo, Show, For, onCleanup } from "solid-js";
```

- [ ] **Step 5: Add providers section to UsageDock render**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx:135-197`, add providers section after context window bar and before session/project/global sections:

```typescript
<Show when={apiData()?.providers && apiData()!.providers.length > 0}>
  <div class="mafw-usage-section">
    <div class="mafw-usage-section-title">配额窗口</div>
    <For each={apiData()!.providers}>
      {(provider: any) => <ProviderSection provider={provider} />}
    </For>
  </div>
</Show>
```

Update `hasData` check to include providers:

```typescript
const hasData = () => {
  const d = apiData();
  if (!d) return false;
  if (d.providers && d.providers.length > 0) return true;
  return d.summary?.session?.turnCount || d.summary?.project?.turnCount || d.summary?.global?.turnCount;
};
```

Update session/project/global sections to use `apiData()?.summary`:

```typescript
<Show when={apiData()?.summary?.session?.turnCount}>
  <div class="mafw-usage-section">
    <div class="mafw-usage-section-title">当前会话</div>
    <TokenGrid data={apiData()!.summary!.session!} />
  </div>
</Show>

<Show when={apiData()?.summary?.project?.turnCount}>
  <div class="mafw-usage-section">
    <div class="mafw-usage-section-title">当前项目</div>
    <TokenGrid data={apiData()!.summary!.project!} showSessions />
  </div>
</Show>

<Show when={apiData()?.summary?.global?.turnCount}>
  <div class="mafw-usage-section">
    <div class="mafw-usage-section-title">系统总计</div>
    <TokenGrid data={apiData()!.summary!.global!} showSessions />
  </div>
</Show>
```

- [ ] **Step 6: Add CSS styles for ASCII bars**

Edit `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`, add after existing usage styles:

```css
/* Provider quota windows */
.mafw-usage-provider {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-surface);
}

.mafw-usage-provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-weight: 600;
  font-size: 12px;
}

.mafw-usage-provider-plan {
  font-weight: 400;
  color: var(--text-muted);
  font-size: 11px;
}

.mafw-usage-window {
  display: grid;
  grid-template-columns: 32px 1fr 40px 60px 50px 16px;
  gap: 6px;
  align-items: center;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 0;
}

.mafw-usage-window-label {
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 10px;
}

.mafw-usage-window-bar {
  color: var(--accent-green);
  letter-spacing: -0.5px;
}

.mafw-usage-window-pct {
  text-align: right;
  font-weight: 600;
}

.mafw-usage-window-detail {
  text-align: right;
  color: var(--text-muted);
  font-size: 10px;
}

.mafw-usage-window-reset {
  text-align: right;
  color: var(--text-muted);
  font-size: 10px;
}

.mafw-usage-window-pacing {
  text-align: center;
  font-size: 12px;
}

/* Severity colors */
.mafw-usage-severity-low .mafw-usage-window-bar {
  color: var(--accent-green);
}

.mafw-usage-severity-mid .mafw-usage-window-bar {
  color: var(--warning);
}

.mafw-usage-severity-high .mafw-usage-window-bar {
  color: var(--orange, #d19a66);
}

.mafw-usage-severity-critical .mafw-usage-window-bar {
  color: var(--danger);
}
```

- [ ] **Step 7: Build and test**

Run: `cd gateway && npm run build`
Run: `cd opencode-dev/packages/desktop && npm run build`

Open desktop app, navigate to Usage tab, verify:
- Provider windows section appears if data exists
- ASCII bars render with correct fill/color
- Pacing icons show correctly
- Severity colors apply

- [ ] **Step 8: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add ASCII progress bars to UsageDock for provider quota windows"
```

---

## Summary

Phase 1 delivers:
1. **Provider attribution** — `trajectory_turns.provider` column with backfill
2. **Model prices** — Partial table for cost estimation fallback
3. **UsagePoller** — Aggregates local trajectory data into 5h/7d/month windows
4. **Consolidated API** — `GET /api/usage` returns summary + providers
5. **UI** — ASCII progress bars in UsageDock with severity colors and pacing indicators

Total: 5 tasks, ~15 steps each, estimated 2-3 days of focused work.
