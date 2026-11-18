# Runtime lifecycle contract & background unknown states (2026-11-18)

**Commit:** `2dc020739`
**Version:** `mafw-gateway@4.19.0`

## Problem

A long-lived session showed 64 background rows as permanently `running`. The
children were historical subagents (created 2026-09-23 → 2026-10-10) with
`time_idle = NULL`; the opencode adapter exposed raw session rows, and
`SubagentService.statusOf` interpreted "no idle signal" as `running`. The
gateway then counted them in the background work bar forever.

## Change

- Added `packages/runtime-contract/src/lifecycle.ts`:
  `active / waiting / settled / unknown` with `observedAt`, `lastActivityAt`,
  `outcome`, `waitingOn`, `revision`, `epoch`, `authority`, `reason`.
  Missing/invalid lifecycle normalizes to `unknown`, never `active`.
- `AdapterSession` now carries an optional canonical `lifecycle`; a separate
  `background.tasks` channel covers runtimes with managed tasks but no child
  session enumeration (Claude).
- opencode adapter maps:
  - `time.busy` → active
  - `time.idle` + `idle_outcome` → settled
  - `time.suspended` without a live-owner signal → unknown (`claimed-without-live-owner`)
  - legacy rows with no timestamps → unknown (`legacy-no-idle`)
  - `time.archived` → settled/cancelled
  - `children()` honors caller `limit` (default 200, no silent 100 cap) and
    attaches lifecycle to each row.
- `SubagentService` no longer reads `time.idle` / `outcome`; it consumes
  `lifecycle`. Missing lifecycle → `unknown`. Added `waiting`/`unknown` to
  `SubagentStatus`, routes schemas and SDK types.
- `MafwBackgroundJobStatus` adds `waiting` / `unknown`; jobs carry
  `observedAt`, `lastActivityAt`, `epoch`, `authority`, `waitingOn`.
  `isTerminalBackgroundStatus` only accepts `completed / failed / cancelled`.
- Desktop background bar counts only `running / input_required`; `waiting` has
  its own row, and `unknown`/terminal rows live behind a "显示历史" toggle.

## Verification

- runtime-contract: 29/29
- runtime-core: 51/51
- gateway focused (lifecycle/background/opencode/contract): 186/186
- SDK: 245/245
- desktop: 4100/4100 (776 suites)
- desktop `tsgo -p` rc=0; `electron-vite build` rc=0
- gateway full suite has 12 unrelated failures from concurrent uncommitted
  work (`api-contract` write/error ledgers and `legacy-route-inventory`);
  no lifecycle/background/opencode test fails.

## Deferred

- Claude adapter still exposes `children()` as `[]`; the SDK's managed
  `background_tasks_changed` level signal is the next step, using the
  `background.tasks` surface.
- dsh adapter is not in this checkout; its `running / waiting / settled`
  mapping is specified by the contract but not yet wired.
- `session.children` remains a required legacy surface; making it fully
  optional/gated is a separate contract change.
