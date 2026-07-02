# MAFW v5.0 Dashboard Redesign — Prototype to SPA

**Goal:** Replace the current minimal Dashboard SPA with the full-featured design from `mafw-dashboard-prototype.html`, featuring 5 views (Overview / Sessions / Goals / Loops / Analytics), KPI metrics, real-time SSE updates, and all data sourced from existing REST APIs.

**Architecture:** Frontend-only rewrite. The `index.html` becomes the SPA shell, `app.js` handles routing + data binding + SSE. Existing `DashboardAPI` gets 3 new endpoints for stats/sessions. `components.js` is removed.

## New / Modified Files

| File | Action | Lines |
|------|--------|-------|
| `gateway/src/dashboard/public/index.html` | REPLACE | ~200 |
| `gateway/src/dashboard/public/app.js` | REWRITE | ~300 |
| `gateway/src/dashboard/public/components.js` | DELETE | 0 |
| `gateway/src/dashboard/api.ts` | MODIFY | +60 lines |

## New API Endpoints

### GET /api/stats

```json
{
  "activeGoals": 3,
  "loopsToday": 7,
  "wavesToday": 23,
  "activeSessions": 2,
  "totalDuration": "2h 14m",
  "memoryEntries": { "total": 156, "L1": 120, "L2": 36, "L3": 0 },
  "loopSuccessRate": 78,
  "avgWavesPerLoop": 2.8
}
```

Implementation: read state/*.json → count goals, sum loops, calc duration from timestamps.

### GET /api/sessions

```json
[
  { "id": "ses_abc123", "projectDir": "D:\\code\\todo-app", "agent": "default", "status": "active", "idle": "12s" }
]
```

Implementation: from existing `activeGoals` sessions in memory, plus scan state files.

### GET /api/sessions/:id/metrics

```json
{ "uptime": "4m 32s", "sseReconnects": 0, "messagesSent": 27, "totalTokens": 45200 }
```

Implementation: aggregate from state file session records.

## View Architecture

```
index.html
  ├── Top Nav (Overview | Sessions | Goals | Loops | Analytics)
  └── #view-overview   ← KPI cards + charts + live table
  └── #view-sessions   ← Session table + SSE stream + metrics panel
  └── #view-goals      ← Project header + goal cards with progress
  └── #view-loops      ← Loop timeline with wave phases
  └── #view-analytics  ← Cost KPI + success rate chart + token chart
```

## Data Flow

1. `app.js` loads: fetch `/api/stats`, `/api/goals`, `/api/sessions`
2. SSE `/api/events?stream=true` pushes state changes → auto-refresh affected views
3. View switches via nav tabs → `switchView('overview')` → show/hide DOM sections
4. Goal detail / loop detail fetched on-demand via `fetch /api/goals/:id`

## Execution Order

- [ ] Task 1: Add `/api/stats` + `/api/sessions` endpoints to `DashboardAPI`
- [ ] Task 2: Replace `index.html` with prototype layout
- [ ] Task 3: Rewrite `app.js` with 5-view routing, data binding, SSE
- [ ] Task 4: Delete `components.js`
- [ ] Task 5: Rebuild + repack + verify
