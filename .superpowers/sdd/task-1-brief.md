## Task 1: Foundation — Atomic State Utilities + Tests

**Files:**
- Create: `tests/unit/utils/state.test.ts`
- Modify: `src/utils/state.ts:73-212`

**Interfaces:**
- Consumes: Node `fs`.
- Produces: `updateState(goalId, patch, projectDir?)`, `loadState`, `loadRequest`, `loadGoal`, `loadWaves`, `loadReceipts`, `loadReview`, `extractGoalId`, `stateExists`, `initState`.

- [ ] **Step 1: Write failing tests**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initState,
  updateState,
  loadState,
  loadRequest,
  loadWaves,
  loadReceipts,
  extractGoalId
} from '../../../src/utils/state';

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-state-'));
  projectDir = tmpDir;
  fs.mkdirSync(path.join(projectDir, '.opencode', 'mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.opencode', 'mafw', 'requests'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.opencode', 'mafw', 'goals'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('initState writes a valid initial state file', () => {
  initState('001-auth', projectDir);
  const statePath = path.join(projectDir, '.opencode', 'mafw', 'state', '001-auth.json');
  expect(fs.existsSync(statePath)).toBe(true);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  expect(state.goalId).toBe('001-auth');
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
});

test('updateState atomically patches state', async () => {
  initState('001-auth', projectDir);
  const updated = await updateState('001-auth', { phase: 'PLANNING_COMPLETE', nextAction: 'CREATE_EXECUTE_SESSION' }, projectDir);
  expect(updated.phase).toBe('PLANNING_COMPLETE');
  expect(updated.nextAction).toBe('CREATE_EXECUTE_SESSION');
  expect(fs.existsSync(path.join(projectDir, '.opencode', 'mafw', 'state', '001-auth.json.tmp'))).toBe(false);
});

test('loadState throws for missing file', async () => {
  await expect(loadState('missing', projectDir)).rejects.toThrow(/State file not found/);
});

test('loadRequest parses request file', async () => {
  const reqPath = path.join(projectDir, '.opencode', 'mafw', 'requests', '001-auth.json');
  fs.writeFileSync(reqPath, JSON.stringify({ goalId: '001-auth', title: 'Auth', metrics: {}, boundaries: [] }));
  const req = await loadRequest('001-auth', projectDir);
  expect(req.title).toBe('Auth');
});

test('loadWaves returns empty array when missing', async () => {
  const waves = await loadWaves('001-auth', projectDir);
  expect(waves).toEqual([]);
});

test('loadReceipts returns empty array when missing', async () => {
  const receipts = await loadReceipts('001-auth', projectDir);
  expect(receipts).toEqual([]);
});

test('extractGoalId supports /skill mafw-plan 001-auth', () => {
  expect(extractGoalId('/skill mafw-plan 001-auth')).toBe('001-auth');
});

test('extractGoalId supports raw goal id', () => {
  expect(extractGoalId('001-auth')).toBe('001-auth');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/utils/state.test.ts -v`
Expected: FAIL — `tests/unit/utils/state.test.ts` not found or no tests matched.

- [ ] **Step 3: Fix state.ts edge cases**

Modify `src/utils/state.ts`:
1. Ensure `loadWaves` and `loadReceipts` return `[]` instead of throwing when directories/files are missing (already implemented; verify).
2. Ensure `extractGoalId` trims and returns the last non-empty token (already implemented; verify).
3. Add explicit error wrapping if `JSON.parse` fails in loaders.

```typescript
// In loadState, loadRequest, etc. wrap JSON.parse in try/catch
function safeJsonParse<T>(path: string): T {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch (err: any) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/utils/state.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/utils/state.test.ts src/utils/state.ts
git commit -m "test(plugin): add state utility tests and harden loaders"
```

---

