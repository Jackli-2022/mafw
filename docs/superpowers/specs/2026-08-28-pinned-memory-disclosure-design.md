# Pinned Memory Disclosure Layer

**Date:** 2026-08-28
**Status:** Draft
**Author:** MiMo (brainstorming session with user)

---

## Problem

The harmonic memory system is entirely retrieval-driven: memories appear in context only when BM25 search命中 them. User identity/profile and stable preferences are *always relevant* — they should not depend on retrieval luck. A "disclosure layer" guarantees certain memories appear in every turn's system prompt.

## Decision

**Option B: `pinned` flag + per-turn system injection.**

Not a new `type` — disclosure is an *injection strategy*, not a classification. `pinned` is orthogonal to type (semantic, procedural, episodic, global all pin-able). Minimal diff, fits existing OptMem philosophy.

---

## 1. Data Model

`HarmonicUnit` gains optional field:

```ts
pinned?: boolean   // default false; any type can be pinned
```

`HarmonicIndexEntry` carries `pinned` (injection reads index only, no tier file loads).

**Merge semantics:**
- MinHash merge: `pinned = OR` across sources (if any source is pinned, merged result stays pinned)
- Soft-superseded old entries are *excluded* from disclosure injection (prevents duplicate/dated versions of same preference)
- Pinned entries still participate in BM25 retrieval normally; `pinned` does **not** boost retrieval score

## 2. Write Path

### 2a. `mafw_add_memory` — add optional parameter

```ts
pinned?: boolean   // default false; pass true for user identity/preference/constraint content
```

MCP schema + `/api/memory/add` endpoint both accept and persist the flag.

### 2b. New tool: `mafw_pin_memory`

```ts
{ id: string, pinned: boolean } → { success: boolean, id: string, pinned: boolean }
```

For "pin this existing memory" and "unpin" scenarios (agent decides a preference is stable, or user asks to remove something from profile).

### 2c. `<memory-guide>` update

Add usage discipline section:

> **用户身份/画像、长期偏好与约束** → 写入时 `pinned: true`（每轮保证注入）
> 任务相关、易变内容 **不要 pin**

## 3. Injection Path

```
system.transform (every turn)
  → GET /api/recall/pinned           (fail-open: timeout/error → skip, no block)
  → index scan for pinned entries    (exclude superseded)
  → sort by energy × salience, cap
  → render <user-profile> block
```

**System array order:**

```
system: [
  "<memory-guide>",        // static, never changes — prefix cache friendly
  "<user-profile>",        // semi-stable, invalidates from here down
  ...                    // existing recall injection, per-turn context, etc.
]
```

`<memory-guide>` is static text. `<user-profile>` changes only when pinned set mutates. Order ensures cache prefix stays warm for most turns.

**Render format:**

```xml
<user-profile>
- 用户偏好中文回复
- 不在生产库跑迁移前先备份
</user-profile>
```

Uses full `memory_value` (pinned discipline requires one-sentence content, naturally short).

## 4. Volume Budget

| Limit | Value |
|---|---|
| Max entries | 20 |
| Max total chars | 2000 |
| Truncation | energy × salience descending; overflow logged |

```log
[Recall] pinned overflow: 3 entries dropped (budget exceeded)
```

**Decay behavior:** Pinned entries decay at normal rate (0.005/day). Decay only affects *sort position* (long-unreviewed profiles sink within the budget), never causes removal from pin. If all 20 budget slots fill, lowest energy×salience pinned entries fall below the cutoff but remain pinned in index (can be re-injected if higher-pinned entries are unpinned).

## 5. API Changes

### `GET /api/recall/pinned`

```json
// Response
{
  "entries": [
    {
      "id": "mem_...",
      "type": "semantic",
      "primary_abstraction": "...",
      "memory_value": "...",
      "energy": 0.9,
      "salience": 0.85,
      "created_at": "2026-08-28T..."
    }
  ],
  "budget": { "max": 20, "maxChars": 2000, "used": 3 }
}
```

Empty: `{ "entries": [], "budget": { "max": 20, "maxChars": 2000, "used": 0 } }`.

### `POST /api/memory/pin`

```json
// Request
{ "id": "mem_...", "pinned": true }
// Response
{ "success": true, "id": "mem_...", "pinned": true }
```

## 6. User Review

Phase 1: `GET /api/recall/pinned` is the list API. In-session agent can directly quote the `<user-profile>` block. Desktop UI (Config page "User Profile" card + pin toggle) is follow-up scope, not part of this phase.

## 7. Testing

**Unit tests:**
- Write with `pinned: true` → index entry carries `pinned`
- Merge: pinned=OR across sources
- Superseded entries excluded from injection
- Endpoint: sort by energy×salience, cap at 20/2000, empty → `[]`
- `mafw_pin_memory`: pin/unpin round-trip; nonexistent id → error
- Fail-open: gateway error → no `<user-profile>` block, no crash

**Regression:**
- LongMemEval ingestion baseline unaffected (pinned is optional field, defaults false)

## 8. Out of Scope

- Desktop UI for managing pinned memories (follow-up)
- Auto-pin heuristics (agent decides via `pinned: true` in `mafw_add_memory`)
- Per-project vs global distinction for pinned (currently all global; can add `scope` field later if needed)
