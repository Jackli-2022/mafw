# Runtime lifecycle contract & background unknown states (2026-11-18)

**Commits:** `2dc020739` (contract/adapter/gateway/UI), `54e88017a` (opencode capability declaration), `d4c23dac8` (docs), `ec2270fb4` (child-session gating + observation round-trip), `ba28e6bd1` (Claude managed background tasks)
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
- Claude managed tasks are now implemented in the adapter:
  `background_tasks_changed` is treated as a REPLACE level,
  `task_started` / `task_updated` / `task_notification` as edges. A task that
  leaves the level without a terminal edge becomes `unknown`
  (`missing-from-background-level`); `paused` maps to `waiting`; each query
  starts a new process epoch and invalidates the previous live level.
  `background.tasks` flows through the neutral runtime into
  `BackgroundJobService`; managed tasks carry no `childSessionID` and cannot be
  cancelled through the subagent path.
- Desktop background bar counts only `running / input_required`; `waiting` has
  its own row, and `unknown`/terminal rows live behind a "显示历史" toggle.

## Verification

- runtime-contract: 30/30
- runtime-core: 53/53
- Claude adapter: 39/39
- gateway focused (lifecycle/background/opencode/contract/routes): 186/186
- gateway `tsc -p` rc=0; desktop `tsgo -p` rc=0
- desktop background wiring: 2/2
- SDK: 245/245 and desktop 4100/4100 (776 suites) from the original lifecycle
  delivery; this follow-up does not touch those runtimes beyond the dock guard.
- The last full gateway run before the concurrent agent commits landed had 12
  unrelated failures (`api-contract` write/error ledgers and
  `legacy-route-inventory`); no lifecycle/background/opencode test fails.

## Deferred

- dsh adapter is not in this checkout (`adapters/dsh` and the
  `@deepseek-ai/dsh` SDK are absent); its `running / waiting / settled` mapping
  is pinned by a contract fixture but has no real adapter to wire.
- Claude still declares `sessionChildrenApi: false`: managed tasks are not
  child sessions, so `session.children` stays unsupported and returns neutral
  503 instead of an empty list.
