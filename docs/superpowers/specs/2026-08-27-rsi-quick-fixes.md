# RSI Quick Fixes — Immediate Action Items

## Blocker B1: Cancel Path Outcome Wiring

**File**: `gateway/src/index.ts`

**Current Code** (line ~2836):
```typescript
await this.archiveGoal(control.goalId, {
  verdict: 'CANCELLED',
  // ... missing parameters
});
```

**Fix**:
```typescript
// In POST /control ABORT branch
const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
recordGoalOutcome(this.getGatewayDb(), {
  goalId: control.goalId,
  verdict: 'CANCELLED',
  rounds: state?.round ?? 0,
  lastError: 'User cancelled',
  reviewFeedback: null,
  projectDir: state?.projectDir ?? '.',
  mafwDir: state?.mafwDir ?? '.mafw',
  projectId: state?.projectId ?? 'unknown',
});
await this.archiveGoal(control.goalId, {
  verdict: 'CANCELLED',
  rounds: state?.round ?? 0,
  lastError: 'User cancelled',
});
```

---

## Major M2: policy_version Snapshot Timing

**File**: `gateway/src/index.ts`

**Current Code** (line ~4885):
```typescript
private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
  // ... existing logic
  // MISSING: policySnapshot write
}
```

**Fix**:
```typescript
private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
  const { getActivePolicy } = await import('./orchestration/policy.js');
  const policy = getActivePolicy(mafwDir);
  
  // Write policy snapshot to state file
  const statePath = path.join(projectDir, '.mafw/state', `${goalId}.json`);
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    state.policySnapshot = {
      version: policy.version,
      proposalId: policy.proposalId,
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }
  
  // ... rest of existing logic
}
```

---

## Major M11: recordOutcome Timing Fix

**File**: `gateway/src/index.ts`

**Current Code** (line ~4447):
```typescript
// Inside archiveGoal method
const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
recordGoalOutcome(this.getGatewayDb(), {
  goal_id: goalId,
  // ... parameters
});
```

**Fix**: Move `recordGoalOutcome` call OUTSIDE `archiveGoal`:

```typescript
// In the calling code (e.g., review node completion)
try {
  await this.archiveGoal(goalId, {
    verdict: 'PASS',
    rounds: state.round,
    reviewFeedback: state.reviewFeedback,
  });
  
  // Record outcome AFTER successful archive
  const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
  recordGoalOutcome(this.getGatewayDb(), {
    goalId,
    verdict: 'PASS',
    rounds: state.round,
    lastError: null,
    reviewFeedback: state.reviewFeedback,
    projectDir: state.projectDir,
    mafwDir: state.mafwDir,
    projectId: state.projectId,
  });
} catch (err) {
  // Archive failed, but still record outcome
  const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
  recordGoalOutcome(this.getGatewayDb(), {
    goalId,
    verdict: 'ERROR',
    rounds: state.round,
    lastError: err.message,
    reviewFeedback: null,
    projectDir: state.projectDir,
    mafwDir: state.mafwDir,
    projectId: state.projectId,
  });
}
```

---

## Major M5: failure_signature Implementation

**File**: `gateway/src/orchestration/outcome-recorder.ts`

**Current Code** (line ~27):
```typescript
export function buildFailureSignature(kind: string | null, text?: string | null): string | null {
  if (!kind) return null;
  const norm = (text || '')
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, 'N')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return norm ? `${kind}:${norm}` : kind;
}
```

**Fix**:
```typescript
export interface FailureSignatureInput {
  kind: string | null;
  errorText?: string | null;
  firstErrorTool?: string | null;  // NEW: from trajectory
}

export function buildFailureSignature(input: FailureSignatureInput): string | null {
  if (!input.kind) return null;
  
  const norm = (input.errorText || '')
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, 'N')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  
  const tool = input.firstErrorTool || 'unknown';
  const text = norm || 'no_details';
  
  return `${input.kind}:${tool}:${text}`;
}

// Update callers:
const signature = buildFailureSignature({
  kind: failureKind,
  errorText: input.lastError ?? input.reviewFeedback,
  firstErrorTool: traj?.firstErrorTool,  // Query from trajectory
});
```

---

## Major M6: evolution_proposals requires Field

**File**: `gateway/src/memory/gateway-db.ts`

**Current Code** (line ~206):
```sql
CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY,
  component_diffs TEXT,
  declared_prediction TEXT,
  rationale TEXT,
  status TEXT,
  validation_result TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

**Fix**: Add migration logic after table creation:
```typescript
// After CREATE TABLE evolution_proposals
try {
  this.db.exec(`ALTER TABLE evolution_proposals ADD COLUMN requires TEXT DEFAULT 'policy'`);
} catch {
  // Column already exists, ignore
}
```

---

## Major M1: Delete Drift Copies

**Files to delete**:
- `gateway/src/core/tools/run-plan.ts` (drift copy of buildPlanPrompt)
- `gateway/src/core/tools/run-review.ts` (drift copy of buildReviewPrompt)

**Verification**:
```bash
# Check if these files are imported anywhere
grep -r "from.*run-plan" gateway/src/
grep -r "from.*run-review" gateway/src/

# If no imports, safe to delete
rm gateway/src/core/tools/run-plan.ts
rm gateway/src/core/tools/run-review.ts
```

---

## Testing Checklist

After applying fixes, run:

```bash
# 1. Unit tests
npm test -- --runInBand --forceExit

# 2. Specific test files
npx jest tests/unit/gateway/outcome-recorder.test.ts
npx jest tests/unit/gateway/goal-sessions.test.ts
npx jest tests/unit/gateway/policy.test.ts
npx jest tests/unit/gateway/registry.test.ts

# 3. Integration test (manual)
# - Create a goal
# - Cancel it via POST /control {action:'ABORT'}
# - Verify goal_outcomes table has CANCELLED record
```

---

## Status: ALL FIXED ✅

**Applied**: 2026-08-30
**Tests**: 210/210 passing
**Build**: Successful

### Fixed Items
1. **B1** (Cancel path) - ✅ Fixed
2. **M2** (policySnapshot) - ✅ Fixed  
3. **M11** (recordOutcome timing) - ✅ Already correct
4. **M5** (failure_signature) - ✅ Fixed
5. **M6** (requires field) - ✅ Already implemented
6. **M1** (delete drift copies) - ✅ Fixed

See `2026-08-27-rsi-fixes-applied.md` for details.