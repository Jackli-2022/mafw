## Task 1: AutomationEngine handler registry refactor

**Files**
- Modify: `gateway/src/automation-engine.ts`
- Create: `tests/unit/automation-engine-actions.test.ts`

**Interfaces**
- Consumes: `MemoryActionType`, `AutomationRule`
- Produces: `ActionHandler` type, `actionRegistry` export

**Steps**

- [ ] 1. Add `ActionHandler` type and `actionRegistry` Map at module top (after imports):

```typescript
export type ActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine
) => Promise<void>;
export const actionRegistry: Map<string, ActionHandler> = new Map();
```

- [ ] 2. Replace `private async executeAction(actionType: MemoryActionType)` with:

```typescript
private async executeAction(actionType: string, rule: AutomationRule): Promise<void> {
  const handler = actionRegistry.get(actionType);
  if (!handler) {
    console.warn(`[AutomationEngine] No handler registered for action: ${actionType}`);
    return;
  }
  try {
    await handler(rule, this);
  } catch (err: any) {
    console.error(`[AutomationEngine] Action ${actionType} failed: ${err.message}`);
  }
}
```

- [ ] 3. Update `executeRule()` call sites — change `this.executeAction(rule.action.type)` to `this.executeAction(rule.action.type, rule)` (lines ~143 and ~392)

- [ ] 4. Update `validateRule()` line ~442 — change action type check from `['memory:distill', 'memory:decay', 'memory:review', 'memory:prune'].includes(rule.action.type)` to `actionRegistry.has(rule.action.type)`

- [ ] 5. Register 4 memory actions in constructor (at end of `constructor(mafwDir)`):

```typescript
actionRegistry.set('memory:distill', async (_rule, engine) => {
  console.log('[AutomationEngine] Starting memory distillation...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const result = await runDistillation(indexManager, engine['mafwDir']);
  console.log(`[AutomationEngine] Distillation complete: created ${result.created}, locked ${result.locked}`);
});
actionRegistry.set('memory:decay', async (_rule, engine) => {
  console.log('[AutomationEngine] Running energy decay...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const index = indexManager.getIndex();
  const energySystem = new EnergySystem();
  let decayed = 0;
  for (const entry of index.entries) {
    const salience = (entry as any).salience || 1.0;
    const daysSinceUpdate = entry.energy > 0 ? 1 : 0;
    const newEnergy = energySystem.calculateEnergy(entry.energy, { type: 'retrieved' }, daysSinceUpdate, salience, entry.id);
    const diff = entry.energy - newEnergy;
    if (diff > 0.005) { indexManager.updateEnergy(entry.id, -(diff)); decayed++; }
  }
  console.log(`[AutomationEngine] Energy decay applied to ${decayed} entries`);
});
actionRegistry.set('memory:review', async (_rule, engine) => {
  console.log('[AutomationEngine] Checking review queue...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const scheduler = new ReviewScheduler(indexManager, engine['mafwDir']);
  scheduler.tick();
  const queue = scheduler.getReviewQueue();
  console.log(`[AutomationEngine] Review queue: ${queue.length} items due`);
});
actionRegistry.set('memory:prune', async (_rule, engine) => {
  console.log('[AutomationEngine] Pruning cognitive graph...');
  const graph = new CognitiveGraphManager(engine['mafwDir']);
  const before = graph.getGraph().edges.length;
  graph.prune(0.1);
  const after = graph.getGraph().edges.length;
  const pruned = before - after;
  if (pruned > 0) {
    console.log(`[AutomationEngine] Pruned ${pruned} low-weight edges`);
  } else {
    console.log('[AutomationEngine] No edges to prune');
  }
});
```

- [ ] 6. Remove dead private methods: `runDistill()`, `runDecay()`, `runReview()`, `runPrune()` (these are now inline in registry)

- [ ] 7. Move `mafwDir` from `private` to `readonly mafwDir: string` so it's accessible from handlers

- [ ] 8. Write test `tests/unit/automation-engine-actions.test.ts`:

```typescript
import { AutomationEngine, actionRegistry, ActionHandler, AutomationRule } from '../../../src/automation-engine';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('AutomationEngine actionRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ae-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('has 4 memory actions registered', () => {
    expect(actionRegistry.has('memory:distill')).toBe(true);
    expect(actionRegistry.has('memory:decay')).toBe(true);
    expect(actionRegistry.has('memory:review')).toBe(true);
    expect(actionRegistry.has('memory:prune')).toBe(true);
  });

  it('executes handler without error for memory:distill', async () => {
    const handler = actionRegistry.get('memory:distill')!;
    const engine = new AutomationEngine(tmpDir);
    // should not throw
    await handler({ id: 'test', enabled: true, trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' } }, engine);
  });

  it('validateRule accepts registered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'memory:distill' },
    });
    expect(result.valid).toBe(true);
  });

  it('validateRule rejects unregistered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'manager:report_completed' },
    });
    // manager:* not yet registered — should fail validation
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown action type'))).toBe(true);
  });

  it('executeRule logs warning for unregistered action', async () => {
    const engine = new AutomationEngine(tmpDir);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    engine['rules'].set('bad', {
      id: 'bad', enabled: true,
      trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' },
      action: { type: 'nonexistent:action' },
    });
    await engine.executeRule('bad');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No handler registered'));
    warnSpy.mockRestore();
  });
});
```

- [ ] 9. Run tests: `npx jest tests/unit/automation-engine-actions.test.ts --coverage`

---


