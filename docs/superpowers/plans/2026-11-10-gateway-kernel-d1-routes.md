# Gateway Kernel Phase D1: Route Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate index.ts's legacy HTTP dispatch chain (135 checks: 74 `req.url?.match` + 21 `startsWith` + 40 `===`, spanning ~L5620-10161) into `routes/*.ts` handlers registered on the existing `RouteRegistry`, deleting the if-chain branch by branch with behavior equivalence — the first stage of the Phase D microkernel split (D2 = event dispatch table, D3 = boot/kernel extraction; separate plans).

**Architecture:** index.ts already constructs `RouteRegistry` + registers wave1/wave2/pod handlers (`attachWave1Handlers(this.routeRegistry, {...})` at ~L5449). The legacy if-chain inside the request handler duplicates dispatch for ~135 older routes. Each migration task: (a) extract one domain group's branches into a `routes/<domain>.ts` module with deps-injected handlers (existing `attachX(routeRegistry, deps)` pattern), (b) register it in the same wiring site, (c) regenerate the contract artifacts (`npm run emit:openapi` — the catalog → gateway-paths.json → openapi chain; freshness tests enforce this), (d) DELETE the corresponding if-branches from index.ts, (e) full suite + branch-count guard delta.

**Tech Stack:** TypeScript (CJS), Jest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md` (§5.2 route migration; §4 non-goals)

## Global Constraints

- **Behavior equivalence** (spec §4): no path/method/response-shape changes; no new routes; no event-order changes.
- **AGENTS §6.5 regex anchoring rule**: every migrated regex keeps `(?:\?|$)` anchoring where the original had it — query strings must not break matching.
- Type gate `npx tsc --noEmit -p tsconfig.json` in `gateway/`; full suite `npx jest --no-coverage --forceExit`.
- **Shared-checkout hazard**: another agent actively commits to index.ts. Commit after EVERY task; before each commit run `git diff --stat` and verify only the intended files changed; if edits vanish (stale-buffer overwrite — happened in B2), re-apply from the task description.
- Do NOT commit another agent's uncommitted files; explicit `git add` lists only.
- Branch: `feat/gateway-kernel-d1-routes` off `main`.
- Contract artifacts must be regenerated whenever route-catalog entries change (`npm run emit:openapi` from gateway/); `api-contract` / manifest-freshness tests gate this.

## Inventory (from `gateway/scripts/analyze-routes.cjs` — committed in Task 1)

Route region ~L5620-10161. Groups (branch counts are match/startsWith only; `===` checks fold into their neighboring groups during extraction):

| Group | ~Branches | Lines | Notes |
|---|---|---|---|
| /api/recall | 4 | 8284-8523 | includes the 100ms boundary-recall handler — extract with its fail-open semantics intact |
| /api/cognition | 3 | 7938-7950 | observe/inject endpoints |
| /api/memory + /api/media + /api/agent + /api/terminal | 5 | 5855-6717+8542 | mixed small domains |
| /api/sessions | ~35 of the /api mass | 5646-8258 | biggest; includes messages/history/permissions/question/branches |
| /api/goals + /api/stats | 4 | 6751-9992 | goals timeline/retry already route-registered? verify; dashboard stats |
| /api/mobile | 2 | 5917-5934 | pairing/deep-link |
| remaining /api long tail | ~20 | scattered | projects/providers/models/approvals/triage/automations/plugins/presence/… |
| static (/assets /static) + /mcp + root | 4 | 5628-6131 | NOT route-registry material — static file serving + MCP transport stay as direct branches in the (eventually) http-router; migrate LAST or keep |

## Key Rulings

1. **D1 scope = routes only.** Event dispatch (handleRuntimeEvent) and boot/kernel extraction are D2/D3 plans. index.ts shrinks by the route region (~4500 lines) but the <1000 acceptance is D3's.
2. **Registry registration = full catalog entry** (operationId + handler), feeding openapi. This is the spec's requirement and the established chain. Where a legacy route DUPLICATES an already-registered operation (e.g. goals timeline), keep the registered one and delete the legacy branch only.
3. **The 100ms boundary-recall handler** (`GET /api/recall/context`) keeps its inline shape in its new module — its fail-open try/catch structure moves verbatim; no scheduler coupling is added (Phase B ruling stands).
4. **Static/MCP/root branches are NOT migrated** to RouteRegistry (transport-level, not API routes). They move to http-router.ts in D3. D1 ends with them as the only remaining branches — the branch-count guard pins exactly that set.
5. **Uniform migration procedure** per group (the tasks below instantiate it): extract → attach → register → emit → delete branches → guard delta → suite. Same steps every time; only the group's route list and module name differ.

## Review Focus

1. **Query-string anchoring** — a migrated regex losing `(?:\?|$)` breaks `?limit=100` requests (AGENTS §6.5). Test: guard asserts migrated patterns keep the anchor; manual spot-check per group.
2. **Dashboard fallback ordering** — some `/api/*` branches sit BEFORE the dashboard catch-all; migrating a branch that the fallback would otherwise swallow changes nothing only if registration dispatches by exact/regex priority. Verify RouteRegistry dispatch precedence matches the original chain order for overlapping patterns (registry dispatch is keyed — overlapping legacy regexes must not both fire).
3. **Handler body moves verbatim** — extraction must be copy-paste + deps-threading, not a rewrite. `git diff` review: deleted index.ts lines ≈ added routes/*.ts lines (allowing import/deps boilerplate).
4. **Contract drift** — every catalog change regenerates openapi; stale artifacts fail freshness tests. Run `npm run emit:openapi` per task, commit artifacts together with the registration.
5. **Shared-checkout races** — verify `git diff --stat` before every commit; only intended files.

---

### Task 1: Inventory tooling + baseline guard (RED-first)

**Files:**
- Create: `gateway/scripts/analyze-routes.cjs` (already drafted — finalize: also count `===` checks, emit JSON)
- Create: `gateway/tests/unit/architecture/legacy-route-inventory.test.ts`
- Modify: nothing else

**Interfaces:**
- Produces: `analyze-routes.cjs --json` → `{ groups: [{ prefix, count, lines: [first, last] }], total }` on stdout — the guard test shells out to it and pins the CURRENT numbers; every migration task UPDATES the expected numbers (decreasing) as part of its commit.

- [ ] Step 1: Write the guard test (RED — script lacks --json): it runs `node scripts/analyze-routes.cjs --json`, parses, asserts `data.total === <current 95 match/startsWith>` plus the group table above, and asserts the static/MCP/root set is untouched (`groups['/assets'] === 1` etc).
- [ ] Step 2: Add `--json` to the script (RED→GREEN). Commit: `feat(gateway): legacy route inventory tooling + baseline guard`.

### Task 2: Migrate /api/cognition (smallest — pattern-proving)

**Files:**
- Create: `gateway/src/routes/cognition.ts`
- Modify: `gateway/src/index.ts` (wire attach + delete 3 branches), `gateway/src/routes/route-catalog.ts` (register), contract artifacts (emit:openapi)

**Interfaces:**
- Produces: `export function attachCognitionRoutes(registry: RouteRegistry, deps: { … }): void` — deps shaped from exactly what the 3 handler bodies reference (each is a thin `this.` closure; thread them as functions/getters like existing attachWave1Handlers deps).

- [ ] Step 1: Read the 3 branches (L7938-7950) + their handler bodies; list every `this.x` reference → deps surface.
- [ ] Step 2: Write `routes/cognition.ts` — handler bodies VERBATIM (copy-paste; only `this.x` → `deps.x`).
- [ ] Step 3: Wire `attachCognitionRoutes(this.routeRegistry, {...})` next to the wave handlers; add catalog entries; `npm run emit:openapi`.
- [ ] Step 4: DELETE the 3 branches from index.ts; update the inventory guard numbers (95 → 92).
- [ ] Step 5: `npx tsc --noEmit -p tsconfig.json` + `npx jest --no-coverage --forceExit` + spot-check a cognition endpoint via the existing route tests (add one if none: registry dispatch returns the same shape). Commit: `refactor(gateway): migrate /api/cognition to RouteRegistry`.

### Tasks 3–8: Migrate the remaining groups (uniform procedure)

Same procedure as Task 2, in this order (smallest-risk first, dashboard-adjacent last):

- Task 3: `/api/mobile` (2) + `/api/media` + `/api/agent` + `/api/terminal` (4 total branches)
- Task 4: `/api/memory` (2) + `/api/stats` (2)
- Task 5: `/api/recall` (4 — the boundary-recall handler; keep fail-open inline shape; add a registry-dispatch test asserting the 100ms path's response envelope `{ pointers }` shape)
- Task 6: `/api/goals` (2 — verify against existing goal route registrations first; dedupe)
- Task 7: `/api/sessions` mass (~35 — split into 2-3 commits: core CRUD, messages/history, permissions/question/branch)
- Task 8: remaining `/api` long tail (~20)

Each task: same 5 steps; inventory guard numbers decrease; full suite green; commit per task. **Stop-and-ask trigger**: if any group's branch overlaps an already-registered operation with DIFFERENT behavior (not just duplication), stop and rule (spec: no behavior change — the legacy branch is the truth; reconcile by fixing the registered handler or keeping the branch for D3).

### Task 9: End-state guard + docs

- [ ] Inventory guard final state: only `/assets` `/static` `/mcp` root remain (pinned exact numbers); `gateway/src` outside http transport files has no `req.url?.match` (guard pattern: index.ts match count === the static/MCP/root set).
- [ ] Update `docs/architecture/gateway.md` (MafwScheduler section: routes fully registry-dispatched; legacy chain gone) + spec §5.2 note (D1 complete, counts).
- [ ] Full suite + tsc; ledger.

## Ledger

`.superpowers/sdd/<this-plan-name>/progress.md` — one line per task (commits, test counts, guard numbers); Ruling lines for every stop-and-ask and deviation.
