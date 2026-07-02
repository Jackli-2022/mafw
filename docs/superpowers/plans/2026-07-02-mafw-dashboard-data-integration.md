# MAFW Dashboard — Gateway Runtime Data Integration

**Goal:** Connect the Dashboard SPA to the Gateway's in-memory runtime state (activeGoals, serveProcess, registeredProjects) so that data shown in the 5 views (Overview/Sessions/Goals/Loops/Analytics) reflects live state instead of (or in addition to) filesystem data.

**Problem:** DashboardAPI only reads from `.opencode/mafw/state/*.json` files. The Gateway's MafwScheduler holds real-time data in `this.activeGoals`, `this.serveProcess`, `this.registeredProjects`, but the Dashboard cannot access them even though they share the same process.

## New / Modified Files

| File | Change | Responsibility |
|------|--------|---------------|
| `gateway/src/dashboard/types.ts` | **NEW** | `SchedulerState` interface |
| `gateway/src/dashboard/api.ts` | **MODIFY** | Accept scheduler ref, use runtime data first |
| `gateway/src/dashboard/server.ts` | **MODIFY** | Pass scheduler ref to API |
| `gateway/src/index.ts` | **MODIFY** | Pass `this` to DashboardServer |

## Step 1: SchedulerState Interface

Create `gateway/src/dashboard/types.ts`:

```typescript
export interface SchedulerState {
  activeGoals: Map<string, any>;
  registeredProjects: Map<string, any>;
  serveRunning: boolean;
}
```

## Step 2: DashboardAPI — Accept Scheduler in Constructor

```typescript
import { SchedulerState } from './types';

export class DashboardAPI {
  private scheduler?: SchedulerState;

  constructor(projectDir: string = '.', scheduler?: SchedulerState) {
    this.scheduler = scheduler;
    // ...
  }
```

### getStats()

Prefer runtime data over filesystem:

```typescript
private async getStats(): Promise<any> {
  if (this.scheduler) {
    const goals = Array.from(this.scheduler.activeGoals.values());
    const activeSessions = goals.filter(g => 
      Object.values(g.sessions || {}).some((s: any) => s.active)
    ).length;
    return {
      activeGoals: goals.filter(g => 
        g.nextAction !== 'COMPLETED' && g.nextAction !== 'FAILED'
      ).length,
      loopsToday: goals.reduce((sum, g) => sum + (g.loop || 0), 0),
      wavesToday: goals.reduce((sum, g) => sum + (g.currentWave || 0), 0),
      activeSessions,
      serveRunning: this.scheduler.serveRunning,
      // duration/memory from FS fallback
      totalDuration: '0m',
      totalDurationMinutes: 0,
      memoryEntries: { total: 0, L1: 0, L2: 0, L3: 0 },
      loopSuccessRate: 0,
      avgWavesPerLoop: 0
    };
  }
  return this.getStatsFromFS();
}
```

### getGoals()

```typescript
private async getGoals(): Promise<any[]> {
  if (this.scheduler) {
    return Array.from(this.scheduler.activeGoals.values()).map(s => ({
      goalId: s.goalId, phase: s.phase, nextAction: s.nextAction,
      loop: s.loop, currentWave: s.currentWave, totalWaves: s.totalWaves,
      updatedAt: s.updatedAt,
      sessions: Object.values(s.sessions || {}).filter((sess: any) => sess.active).length
    }));
  }
  return this.getGoalsFromFS();
}
```

### getSessions()

```typescript
private async getSessions(): Promise<any[]> {
  if (!this.scheduler) return this.getSessionsFromFS();
  const results: any[] = [];
  for (const [goalId, state] of this.scheduler.activeGoals) {
    for (const [phase, session] of Object.entries(state.sessions || {})) {
      if ((session as any).active) {
        const idle = Math.floor((Date.now() - new Date((session as any).createdAt).getTime()) / 1000);
        results.push({
          id: (session as any).id, goalId, agent: phase,
          status: 'active', idle: idle + 's'
        });
      }
    }
  }
  return results;
}
```

## Step 3: DashboardServer — Pass Scheduler to API

```typescript
import { SchedulerState } from './types';

export class DashboardServer {
  constructor(port: number = 3111, projectDir: string = '.', scheduler?: SchedulerState) {
    this.api = new DashboardAPI(projectDir, scheduler);
  }
```

## Step 4: MafwScheduler — Pass Self

```typescript
this.dashboard = new DashboardServer(3001, this.projectDir, this);
```

The `this` reference works because `MafwScheduler` has the exact fields `activeGoals: Map<string, StateFile>`, `registeredProjects: Map<string, RegisteredProject>`, and a derived `serveRunning` getter.

## Step 5: Add serveRunning as a getter

In `MafwScheduler`, add:

```typescript
get serveRunning(): boolean {
  return !!this.serveProcess && !this.serveProcess.killed;
}
```

## Execution Order

1. Create `types.ts`
2. Modify `api.ts` — constructor + 3 methods
3. Modify `server.ts` — constructor pass scheduler
4. Modify `index.ts` — pass `this` + add `serveRunning` getter
5. Rebuild, test, restart
