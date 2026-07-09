### Task 1: L5Store + findGlobalMafwDir

**Files:**
- Create: `src/utils/global-path.ts`
- Create: `src/memory/l5-store.ts`
- Test: `tests/unit/l5-store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `findGlobalMafwDir(): string`, `L5Store` class with `loadAxioms()`, `addAxiom()`, `loadHeuristics()`, `addHeuristic()`, `getTop()`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/l5-store.test.ts`:

```typescript
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { L5Store, L5Axiom, L5Heuristic } from '../../src/memory/l5-store';

describe('L5Store', () => {
  const tmpDir = path.join(os.tmpdir(), 'mafw-l5-test-' + Date.now());
  const store = new L5Store(tmpDir);

  beforeEach(() => {
    // Clean test dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('loadAxioms returns empty array for fresh store', () => {
    const axioms = store.loadAxioms();
    expect(axioms).toEqual([]);
  });

  test('addAxiom persists and returns axiom with id', () => {
    const axiom = store.addAxiom('All payments must be idempotent', 'manual');
    expect(axiom.id).toBeTruthy();
    expect(axiom.content).toBe('All payments must be idempotent');
    expect(axiom.source).toBe('manual');
    expect(axiom.energy).toBe(0.8);
    const loaded = store.loadAxioms();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('All payments must be idempotent');
  });

  test('addHeuristic persists heuristic', () => {
    const h = store.addHeuristic('Deploy: build â†?migrate â†?smoke', ['deploy', 'migration'], ['goal_001']);
    expect(h.id).toBeTruthy();
    expect(h.pattern).toBe('Deploy: build â†?migrate â†?smoke');
    expect(h.success_rate).toBe(0.9);
    const loaded = store.loadHeuristics();
    expect(loaded).toHaveLength(1);
  });

  test('getTop returns topK axioms and heuristics by energy', () => {
    store.addAxiom('Low energy axiom', 'manual');
    store.addAxiom('High energy axiom', 'distilled');
    const highAxiom = store.addAxiom('Critical axiom', 'manual');
    // Manually bump energy by re-adding via internal file edit
    const axioms = store.loadAxioms();
    const target = axioms.find(a => a.content === 'Critical axiom')!;
    target.energy = 1.0;
    const axiomsPath = path.join(tmpDir, 'axioms.json');
    fs.writeFileSync(axiomsPath, JSON.stringify(axioms, null, 2));

    const top = store.getTop(2);
    expect(top.axioms).toHaveLength(2);
    expect(top.axioms[0].energy).toBeGreaterThanOrEqual(top.axioms[1].energy);
  });

  test('addAxiom with same content does not duplicate', () => {
    store.addAxiom('Unique axiom', 'manual');
    store.addAxiom('Unique axiom', 'manual');
    const axioms = store.loadAxioms();
    expect(axioms).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/l5-store.test.ts --no-coverage 2>&1`
Expected: FAIL â€?`Cannot find module '../../src/memory/l5-store'`

- [ ] **Step 3: Create `src/utils/global-path.ts`**

```typescript
import * as os from 'os';
import * as path from 'path';

export function findGlobalMafwDir(): string {
  return path.join(os.homedir(), '.mafw');
}
```

- [ ] **Step 4: Create `src/memory/l5-store.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface L5Axiom {
  id: string;
  content: string;
  source: 'manual' | 'distilled';
  energy: number;
  created_at: string;
}

export interface L5Heuristic {
  id: string;
  pattern: string;
  trigger_context: string[];
  success_rate: number;
  source_goal_ids: string[];
  energy: number;
  created_at: string;
}

function generateId(): string {
  return `l5_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class L5Store {
  private baseDir: string;

  constructor(baseDir?: string) {
    const { findGlobalMafwDir } = require('./global-path');
    this.baseDir = baseDir || path.join(findGlobalMafwDir(), 'l5');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private axiomsPath(): string {
    return path.join(this.baseDir, 'axioms.json');
  }

  private heuristicsPath(): string {
    return path.join(this.baseDir, 'heuristics.json');
  }

  loadAxioms(): L5Axiom[] {
    try {
      if (fs.existsSync(this.axiomsPath())) {
        return JSON.parse(fs.readFileSync(this.axiomsPath(), 'utf-8'));
      }
    } catch {}
    return [];
  }

  addAxiom(content: string, source: 'manual' | 'distilled' = 'manual'): L5Axiom {
    const axioms = this.loadAxioms();
    const existing = axioms.find(a => a.content === content);
    if (existing) {
      existing.energy = Math.min(1, existing.energy + 0.1);
      this.saveAxioms(axioms);
      return existing;
    }
    const axiom: L5Axiom = {
      id: generateId(),
      content,
      source,
      energy: 0.8,
      created_at: new Date().toISOString(),
    };
    axioms.push(axiom);
    this.saveAxioms(axioms);
    return axiom;
  }

  private saveAxioms(axioms: L5Axiom[]): void {
    const tmpPath = this.axiomsPath() + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(axioms, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.axiomsPath());
  }

  loadHeuristics(): L5Heuristic[] {
    try {
      if (fs.existsSync(this.heuristicsPath())) {
        return JSON.parse(fs.readFileSync(this.heuristicsPath(), 'utf-8'));
      }
    } catch {}
    return [];
  }

  addHeuristic(
    pattern: string,
    triggerContext: string[],
    sourceGoalIds: string[]
  ): L5Heuristic {
    const heuristics = this.loadHeuristics();
    const existing = heuristics.find(h => h.pattern === pattern);
    if (existing) {
      existing.success_rate = Math.min(1, existing.success_rate + 0.05);
      existing.energy = Math.min(1, existing.energy + 0.05);
      this.saveHeuristics(heuristics);
      return existing;
    }
    const heuristic: L5Heuristic = {
      id: generateId(),
      pattern,
      trigger_context: triggerContext,
      success_rate: 0.9,
      source_goal_ids: sourceGoalIds,
      energy: 0.8,
      created_at: new Date().toISOString(),
    };
    heuristics.push(heuristic);
    this.saveHeuristics(heuristics);
    return heuristic;
  }

  private saveHeuristics(heuristics: L5Heuristic[]): void {
    const tmpPath = this.heuristicsPath() + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(heuristics, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.heuristicsPath());
  }

  getTop(topK: number = 3): { axioms: L5Axiom[]; heuristics: L5Heuristic[] } {
    const axioms = this.loadAxioms()
      .sort((a, b) => b.energy - a.energy)
      .slice(0, topK);
    const heuristics = this.loadHeuristics()
      .sort((a, b) => b.energy - a.energy)
      .slice(0, topK);
    return { axioms, heuristics };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/l5-store.test.ts --no-coverage 2>&1`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/utils/global-path.ts src/memory/l5-store.ts tests/unit/l5-store.test.ts
git commit -m "feat: add L5Store + findGlobalMafwDir for global ~/.mafw/l5/"
```

---
