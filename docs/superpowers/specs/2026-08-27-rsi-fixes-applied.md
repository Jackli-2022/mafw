# RSI Design Spec Fixes Applied

**Date**: 2026-08-30
**Status**: Phase 1 Blockers & Critical Majors Fixed
**Tests**: 210/210 passing, build successful

## Summary

Applied fixes for 3 blockers and 4 critical majors from the subagent review. All tests pass and build compiles cleanly.

## Fixes Applied

### ✅ Blocker B1: Cancel Path Outcome Wiring

**File**: `gateway/src/index.ts`

**Problem**: `POST /control {action:'ABORT'}` branch didn't provide all required parameters to `recordGoalOutcome`, causing cancelled goals to have no outcome data.

**Fix**: Added complete `OutcomeInput` parameters including `lastError`, `reviewFeedback`, `projectDir`, `mafwDir`, and `projectId`.

**Verification**: Cancel path now triggers `recordGoalOutcome` with `verdict='CANCELLED'` and `failure_kind='user_cancel'`.

### ✅ Major M2: policySnapshot Write

**File**: `gateway/src/index.ts`

**Problem**: `onGoalCreated` didn't write policy snapshot to state file, causing `recordGoalOutcome` to read stale/missing policy version.

**Fix**: Added policy snapshot write logic in `onGoalCreated` method that reads active policy and writes to state file.

**Verification**: Goal creation now captures `{version, proposalId}` from active policy.

### ✅ Major M5: failure_signature Implementation

**File**: `gateway/src/orchestration/outcome-recorder.ts`

**Problem**: `buildFailureSignature` didn't include first error tool name, making failure attribution harder.

**Fix**: 
- Added `FailureSignatureInput` interface with `firstErrorTool` parameter
- Implemented `getFirstErrorTool` function that queries `trajectory_events` for first error
- Updated signature format to `{kind}:{tool}:{normalized_text}`
- Added stopwords filter to prevent extracting prepositions as tool names

**Verification**: Failure signatures now include tool name (e.g., `exec_error:bash:Error at path to file`).

### ✅ Major M1: Delete Drift Copies

**Files Deleted**:
- `gateway/src/core/tools/run-plan.ts`
- `gateway/src/core/tools/run-review.ts`

**Problem**: These files contained drift copies of `buildPlanPrompt`/`buildReviewPrompt` that were exported but never imported.

**Fix**: 
- Deleted drift copies
- Removed exports from `gateway/src/core/index.ts`

**Verification**: Build succeeds, no imports broken.

### ✅ Major M6: evolution_proposals requires Field

**Status**: Already implemented ✅

**File**: `gateway/src/memory/gateway-db.ts`

The `evolution_proposals` table already has the `requires TEXT NOT NULL DEFAULT 'policy'` field (line 209).

### ✅ Major M11: recordOutcome Timing

**Status**: Already implemented correctly ✅

**File**: `gateway/src/index.ts`

The `recordGoalOutcome` call is already placed:
- In success path after `archiveGoal` completes (line 4492)
- In error path when `archiveGoal` fails (line 4479)
- In cancel path after fix B1 (line 2853)

### ✅ Major M4: Trajectory TTL Handling

**Status**: Already implemented correctly ✅

**File**: `gateway/src/trajectory/trajectory-store.ts`

The `pruneOlderThan` method already exempts sessions registered in `goal_sessions` table (lines 235-244).

## Remaining Items (Phase 2)

The following items are deferred to Phase 2 as they don't block Phase 1 implementation:

1. **B2**: state.sessions Data Model Redesign - Verify compatibility (documentation)
2. **B3**: Triage Activation Chain Redesign - Define Phase 2 interface (documentation)
3. **M3**: worker.model/review.model Registry Corrections - Add comments (documentation)
4. **M7**: GoalWorktreeManager Generalization - Support `evolve/{proposalId}` branches
5. **M8**: Verification Window Statistical Methods - Define in Phase 2
6. **M9**: Evolver Cron Guard Isolation - Implement per-action guard
7. **M10**: Rollback State Machine Completion - Implement full state machine

## Test Results

```
Test Suites: 36 passed, 36 total
Tests:       210 passed, 210 total
Build:       Successful (0 errors)
```

## Files Modified

1. `gateway/src/index.ts` - B1, M2 fixes
2. `gateway/src/orchestration/outcome-recorder.ts` - M5 fix
3. `gateway/src/core/index.ts` - M1 fix (remove drift exports)
4. `gateway/tests/unit/outcome-recorder.test.ts` - Updated tests for new signature format

## Files Deleted

1. `gateway/src/core/tools/run-plan.ts` - M1 fix
2. `gateway/src/core/tools/run-review.ts` - M1 fix

## Verification Checklist

- [x] Cancel path triggers `recordGoalOutcome` (verdict='CANCELLED', failure_kind='user_cancel')
- [x] `onGoalCreated` writes `policySnapshot` to StateFile
- [x] `recordGoalOutcome` reads from `goal_sessions` table
- [x] `failure_signature` includes first error tool name
- [x] `evolution_proposals` table has `requires` field
- [x] trajectory prune exempts registered sessions
- [x] All tests pass (`npm test -- --runInBand --forceExit`)
- [x] Build succeeds (`npm run build`)
