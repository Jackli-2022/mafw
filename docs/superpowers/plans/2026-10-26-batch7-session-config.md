# Batch 7 — Session Config Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline).

**Goal:** Add unified GET/POST session config API, five config categories, `session.config` event, SDK/preload surface.

**Architecture:** `SessionConfigService` façade over approval policy + runtime switches + gateway kv; `session.config` is a gateway-emitted canonical event. No new UI.

**Spec:** `docs/superpowers/specs/2026-10-26-batch7-session-config-design.md`

## Global Constraints
- Reuse existing switch/policy methods; no duplicate persistence for mode.
- `thought_level` is Pi-only; opencode returns 400 with variant hint.
- Additive event/API; no existing route changes.
- `session.config` event full state, not deltas.

## Review Focus
- Config get must merge runtime agent/model with stored variant/thinking.
- Mode change should still emit existing `permission_mode` plus `session.config`.
- model_config without current model must 400.
- Unsupported thought_level must 400, not 500.
- Event vocabulary four-layer guard must stay green.

---

### Task 1: Service + tests
- Create `gateway/src/core/session-config.ts`, `gateway/tests/unit/core/session-config.test.ts`.
- [x] TDD service (get/set/validation/event); commit.

### Task 2: Routes + runtime capability
- Create `gateway/src/routes/session-config.ts`, route tests.
- Add `SessionClient.setThinkingLevel?`; Pi registry implementation.
- [x] TDD routes/pi; commit.

### Task 3: Gateway wiring + catalog + SDK/preload
- index service construction, wave1 handlers, route-catalog.
- SDK types/client, preload, event union/matrix/vocab/TUI known.
- [x] api-contract/tsc/tests; commit.

### Task 4: Finalize/deploy
- [x] Full tests/build, version 4.35.0, live smoke, deploy.

## Verification (v4.35.0)
- gateway **2625**; SDK **148**; TUI **225** (224 pass / 1 skip); session-ui **89**; desktop **1457** (shared workspace includes parallel TerminalDock).
- live: GET/POST config 200; mode/agent/model/model_config; opencode thought_level 400; session.config event; deployed.
