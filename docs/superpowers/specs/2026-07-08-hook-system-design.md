# Hook System Design — Complete Hook List for MAFW v6.4+

> Based on industry frameworks (OpenAI Agents SDK, CrewAI, AutoGen, Hermes Agent) and tools (agent-memory-mcp, mem, MemoryMixin).

## Architecture

HookManager is the **single event dispatch hub** for all hooks — both platform-bridged events and internal MAFW events. No separate event bus.

```
OpenCode Platform                  HookManager                     Memory Components
┌─────────────────┐    bridge     ┌──────────────────────┐         ┌──────────────────┐
│ hooks / event / │──────────────►│ execute(event, ctx)  │◄────────│ addEntry()       │
│ experimental    │               │                      │         │ search()         │
└─────────────────┘               │ handlers[event]      │         │ merge()          │
                                  │   → sorted by pri    │         │ decay()          │
                                  │   → timeout + retry  │         └──────────────────┘
                                  └──────────────────────┘
```

**Key decision**: Extend existing HookManager with new event names. No new EventBus abstraction.

---

## Wave 1 — Memory Internal Hooks (4 hooks)

Internal events fired by memory components directly. Zero platform dependency.

| Event | Payload | Trigger Point | Intended Handlers |
|---|---|---|---|
| `memory.write` | `{ unit: HarmonicUnit, tier: string, source: string }` | After `HarmonicIndexManager.addEntry()` | Audit log, cognitive graph association, minhash merge trigger |
| `memory.recall` | `{ query: string, resultIds: string[], source: string }` | After `HarmonicIndexManager.search()` | Access log, heat tracking, association strengthening |
| `memory.contradiction` | `{ existingId: string, newId: string, field: string, existingValue: string, newValue: string }` | When `DeltaMerger.merge()` detects conflict | Mark conflict, request user clarification, auto-resolve |
| `memory.decay` | `{ unitId: string, oldEnergy: number, newEnergy: number, reason: string }` | After `EnergySystem.decay()` | Garbage collection trigger, archival, notification |

**Changes needed:**
- `src/memory/harmonic-index.ts` — add `hookManager?.execute('memory.write', ...)` after addEntry
- `src/memory/harmonic-index.ts` — add `hookManager?.execute('memory.recall', ...)` after search
- `src/memory/merger.ts` — add `hookManager?.execute('memory.contradiction', ...)` on conflict
- `src/memory/energy-system.ts` — add `hookManager?.execute('memory.decay', ...)` after decay
- `src/plugin.ts` — register default handlers for these 4 events (logging, association tracking)

HookManager receives an optional reference in memory component constructors (pass through from plugin.ts).

---

## Wave 2 — New Platform Bridge Hooks (6 hooks)

New OpenCode API features bridged to HookManager. Some upgrade existing stubs.

### 2a. New bridge: 4 platform events

| OpenCode API | Bridge To | Priority | Handler Description |
|---|---|---|---|
| `event({type:'session.created'})` | `session.start` | 5 | Load project identity, global axioms, user profile into context |
| `tool.execute.before({tool, sessionID, callID})` | `tool.execute.before` | 100 | Inject tool-specific context memory, validate execution preconditions |
| `chat.message({sessionID, agent, model, messageID, variant})` | `user.prompt.submit` | 50 | Pre-fetch memories based on user message (alternative to heavier messages.transform) |
| `experimental.text.complete({sessionID, messageID, partID})` | `llm.call.after` | 50 | Record LLM reasoning as observation |

### 2b. Upgrade: 2 existing stubs

| Existing | Problem | Upgrade |
|---|---|---|
| `tool.execute.after` handler | Only does cost recording + output truncation stub | Add observation capture: record tool output + metadata as T1 working memory |
| `experimental.session.compacting` | Only logs session ID | Call `hookManager.execute('session.compacting', { sessionID })` → real handler preserves high-energy memories before compaction |

### Changes needed:
- `src/plugin.ts` — add 4 new bridge points + upgrade 2 stubs
- New handler files:
  - `src/hooks/session-start.ts` — session identity loading
  - `src/hooks/tool-before.ts` — tool context injection
  - `src/hooks/user-prompt.ts` — memory pre-fetch
  - `src/hooks/llm-after.ts` — observation recording
  - `src/hooks/session-compacting.ts` — extraction before compaction (upgrade from stub)
  - `src/hooks/observation-capture.ts` — tool output → T1 memory (upgrade from stub)

---

## Wave 3 — Handoff + Stub Completion (2 hooks)

### on_handoff

OpenCode has **no native handoff event**. Implement as manual trigger within MAFW handoff flow.

| Event | Payload | Trigger Point | Handler |
|---|---|---|---|
| `session.handoff` | `{ from: string, to: string, goalId: string, context: any }` | End of handoff flow (handoffs/*.json write) | Record handoff context, transfer memory state, warm cache for target agent |

Implementation: In the handoff completion code, add `hookManager.execute('session.handoff', { from, to, goalId, context })`.

### Upgraded handlers

| Handler | Wave | New Behavior |
|---|---|---|
| `session.compacting` | 3 | Before compaction: extract key info from about-to-be-dropped messages, write as T1/T2 to harmonic memory |
| `tool-executed` (observation-capture) | 3 | After tool output: write structured Observation to working memory → feeds into compression pipeline |

---

## File Map

```
src/
├── hooks/
│   ├── hook-manager.ts          (unchanged — already supports all needed features)
│   ├── session-ending.ts        (unchanged)
│   ├── session-start.ts         [NEW] — load base memory on session start
│   ├── session-compacting.ts    [NEW] — extract from about-to-be-dropped context
│   ├── tool-before.ts           [NEW] — inject tool context
│   ├── tool-executed.ts         (upgrade — add observation capture)
│   ├── observation-capture.ts   [NEW] — tool output → T1 working memory
│   ├── user-prompt.ts           [NEW] — pre-fetch on user message
│   ├── llm-after.ts             [NEW] — record LLM reasoning
│   └── handoff.ts               [NEW] — handoff context transfer
├── plugin.ts                    (upgrade — add all new bridge points)
├── memory/
│   ├── harmonic-index.ts        (upgrade — emit memory.write/recall)
│   ├── merger.ts                (upgrade — emit memory.contradiction)
│   └── energy-system.ts         (upgrade — emit memory.decay)
```

## Event Namespace Convention

| Namespace | Examples | Source |
|---|---|---|
| `session.*` | `session.start`, `session.end`, `session.handoff`, `session.compacting` | Platform + Internal |
| `tool.*` | `tool.execute.before`, `tool.execute.after` | Platform |
| `llm.*` | `llm.call.after` | Platform |
| `user.*` | `user.prompt.submit` | Platform |
| `memory.*` | `memory.write`, `memory.recall`, `memory.contradiction`, `memory.decay` | Internal |
| `cost.*` | `cost.recording` (existing) | Platform |
