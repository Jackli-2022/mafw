# 记忆回执 / 过程时间线 / 用户元信息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MAFW 桌面聊天里落地三件事：可展开的记忆回执、替代只读工具卡的过程时间线、每轮用户上下文（时间/城市/语言）。

**Architecture:** 回执由 gateway 在 recall 响应之后异步构建/持久化/广播，桌面按 `anchorKey` 挂到对应回合；时间线是 session-ui 的纯分组视图，只折叠过程、不折叠输出；用户元信息由桌面在发送时附带隐藏 part，gateway 不新增配置面。

**Tech Stack:** TypeScript、Node、SolidJS、better-sqlite3、Jest（gateway）、node:test + tsx（desktop/session-ui）、OpenAPI/SDK 契约生成。

**Spec:** `docs/superpowers/specs/2026-11-18-memory-receipt-timeline-meta-design.md`

## Global Constraints

- 边界 recall 有 **100ms 硬契约**；回执构建必须纯同步，持久化/广播只在 `res.end` 之后。
- **禁止解析 recall 文本**；只消费 `memories` / `t1Hits` / `topicState` 等结构化数据。
- 回执 payload **不包含** `memory_value` 全文、`#mem-` 指针、energy 展示值。
- T1 只展示 `source` 为 `user` / `assistant` 的自然语言；`tool` / `system` / 子代理提示词过滤，计入 `filteredT1`。
- 时间线只折叠 process；**任何 output text 永远可见**，中间输出与最终输出同款排版，不加标签。
- 只读工具进时间线：`reasoning` / `read` / `list` / `glob` / `grep` / `websearch` / `webfetch`；写操作、bash、question、task、审批保留卡片。
- 药丸 token：`height 28px` / `border-radius 999px` / `background var(--bg-float)` / `border 1px var(--border-subtle)` / `font-size 12px`。
- 元信息 chip：ghost 行，`10.5px`，无边框；城市默认关闭；只发城市名，不发坐标。
- 不新增裸 `<button>` / `<input>` / `title`；用 `@mafw/ui` v2 组件或现有壳层 class。
- 不 push、不 merge；每个 task 本地 commit。
- 主题只用现有 token；禁止硬编码色值。

## Review Focus

1. **recall 超时 / abort**：客户端 100ms 断开时，模型没拿到 recall，UI 不能出现“想起了”。回执必须在响应成功后才发。
2. **T1 噪声**：工具输出、子代理提示词不能冒充“原话”；过滤计数必须诚实。
3. **一轮多次 recall**：同一 anchor 的多次 recall 必须合并去重，不能重复或丢条目。
4. **中间输出**：思考→工具→输出→思考→工具→输出时，所有 output 按原顺序可见；折叠只能收 process。
5. **520px 窄列**：chip、药丸、时间线头不能溢出；城市/摘要可在窄列收起，但内容仍能从 popover/卡片打开。

---

## Phase 0：锚点（turn marker）

### Task 0.1: Turn marker 纯函数

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/turn-marker.ts`
- Create: `packages/desktop/src/renderer/mafw/chat/turn-marker.test.ts`
- Create: `src/hooks/turn-marker.ts`
- Test: `packages/desktop/tests/turn-marker-host.test.ts`

**Interfaces:**
- Produces:
  - `TURN_MARKER_PREFIX = 'turn_'`
  - `composeTurnMarkerPart(ts: number, uuid: string): { type: 'text'; id: string; text: string; synthetic: true }`
  - `extractTurnMarkerKey(parts): string | null`（优先 part id，其次扫描文本 `[[turn:<key>]]`）
  - `stripTurnMarker(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/renderer/mafw/chat/turn-marker.test.ts
import { describe, expect, test } from 'bun:test'
import { composeTurnMarkerPart, extractTurnMarkerKey } from './turn-marker'

describe('turn marker', () => {
  test('composes a synthetic text part with a stable id', () => {
    const part = composeTurnMarkerPart(1000, 'abc')
    expect(part).toMatchObject({ type: 'text', id: 'turn_abc', synthetic: true })
    expect(part.text).toBe('[[turn:turn_abc]]')
  })

  test('extracts the marker id from parts', () => {
    expect(extractTurnMarkerKey([
      { id: 'p1', type: 'text', synthetic: false },
      { id: 'turn_abc', type: 'text', synthetic: true },
    ])).toBe('turn_abc')
  })

  test('extracts the marker from persisted text', () => {
    expect(extractTurnMarkerKey([
      { id: 'msg-p0', type: 'text', text: 'hello\n[[turn:turn_abc]]' },
    ])).toBe('turn_abc')
  })

  test('ignores non-synthetic or non-turn parts', () => {
    expect(extractTurnMarkerKey([{ id: 'turn_abc', type: 'text', synthetic: false }])).toBeNull()
    expect(extractTurnMarkerKey([{ id: 'prt_1', type: 'text', synthetic: true }])).toBeNull()
  })

  test('strips the marker from display text', () => {
    expect(stripTurnMarker('hello\n[[turn:turn_abc]]')).toBe('hello\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/chat/turn-marker.test.ts"` (workdir `packages/desktop`)
Expected: FAIL with "Cannot find module './turn-marker'".

- [ ] **Step 3: Implement the helper**

`packages/desktop/src/renderer/mafw/chat/turn-marker.ts`:
- `composeTurnMarkerPart` returns `{ type: 'text', id: `${PREFIX}${uuid}`, text: '[[turn]]', synthetic: true }`.
- `extractTurnMarkerKey` returns the first part where `type === 'text' && synthetic === true && id.startsWith(PREFIX)`.

`src/hooks/turn-marker.ts`:
- Re-export the same `extractTurnMarkerKey` logic (5 lines, no import from desktop; the host plugin is standalone).

- [ ] **Step 4: Add the host-side test**

`packages/desktop/tests/turn-marker-host.test.ts` imports `../../../../src/hooks/turn-marker` and asserts the same fixtures. Run it with the desktop test script.

- [ ] **Step 5: Run tests to verify they pass**

Run the desktop single-file test above.
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/turn-marker.ts packages/desktop/src/renderer/mafw/chat/turn-marker.test.ts packages/desktop/tests/turn-marker-host.test.ts src/hooks/turn-marker.ts
git commit -m "feat(chat): add hidden turn marker helper"
```

### Task 0.2: 验证 marker 端到端（gate）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`（normal path only, temporary）
- Modify: `src/hooks/session-recall.ts`（log marker, temporary）
- Create: `docs/research/2026-11-18-turn-marker-spike.md`

- [ ] **Step 1: Send one real message** with the marker part added to `sendParts`.
- [ ] **Step 2: Inspect** `output.messages` in `session-recall.ts` (temporary `console.log`) and `GET /api/sessions/:id/messages` history for the marker.
- [ ] **Step 3: Record the result** in the research note: marker present in hook? present after reload? id preserved?
- [ ] **Step 4: Gate:** if all three are yes, continue. If not, stop and switch to the fallback "send returns turnID"; update the spec §4.6 before continuing.
- [ ] **Step 5: Remove temporary logs / normal-path marker wiring** (Task 4.2 will add it permanently).
- [ ] **Step 6: Commit** the research note.

### Task 0.3: Hook 透传 `anchorKey`

**Files:**
- Modify: `src/hooks/session-recall.ts`
- Test: `packages/desktop/tests/turn-marker-host.test.ts`（扩展）

**Interfaces:**
- `fetchRecall(query, sessionID, anchorKey?)` appends `&anchorKey=<key>` when present.
- `sessionRecallHook` extracts the text marker from the last real user message's text/parts; strips it before building the query; if absent, still fetches recall but the gateway will not emit a receipt.

- [ ] **Step 1: Write a failing test** for `buildRecallUrl(query, sessionID, anchorKey)` (export it from `src/hooks/session-recall.ts` or a small helper) — with anchor it contains `anchorKey=turn_abc`, without it omits the param.
- [ ] **Step 2: Run fail** with the desktop single-file test command.
- [ ] **Step 3: Implement** extraction + URL param; keep the 100ms abort.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

---

## Phase 1：Gateway 回执

### Task 1.1: `buildMemoryReceipt` 纯函数

**Files:**
- Create: `gateway/src/recall/receipt.ts`
- Test: `gateway/tests/unit/recall/memory-receipt.test.ts`

**Interfaces:**
- Produces:
  - `type MemoryReceiptStatus = 'inject' | 'low-confidence' | 'no-memory'`
  - `interface MemoryReceipt { version: 1; status; tookMs; createdAt; updatedAt; topic; memories; t1; filteredT1; counts }`
  - `buildMemoryReceipt(input: BuildReceiptInput): MemoryReceipt | null`
  - `mergeMemoryReceipt(prev: MemoryReceipt, next: MemoryReceipt): MemoryReceipt`
  - `filterT1(hits: T1HitLike[]): { kept: T1Kept[]; filtered: number }`

`BuildReceiptInput`:
```ts
{
  status: 'inject' | 'low-confidence' | 'no-memory'
  tookMs: number
  now: string
  topic: { title: string; hasRelated: boolean } | null
  memories: Array<{ id; type; primary_abstraction?; memory_value?; created_at?; energy?; pinned?; neighborOf?: string }>
  t1: Array<{ traceId?: string | null; excerpt: string; sessionId?: string; turnId?: number; source?: string }>
  /** 模型是否真的收到了 no-reliable-memory 块。 */
  noMemoryBlockRendered?: boolean
}
```

- [ ] **Step 1: Write failing tests**

Cover:
- 3 memories + 1 valid T1 → `status: 'inject'`, counts `3/1`.
- `memories=[]`, `t1=[]`, `noMemoryBlockRendered=false` → `null`.
- `memories=[]`, `t1=[]`, `noMemoryBlockRendered=true` → `status: 'no-memory'`, counts `0/0`.
- `low-confidence` + items → `status: 'low-confidence'`.
- items > 0 + status `no-memory` → forced `inject` (never no-memory with content).
- T1 filter:
  - `source: 'user'`, excerpt `元信息怎么展示` → kept.
  - `source: 'tool'`, excerpt `ok | packages\desktop...Select-String...` → filtered.
  - `source: 'system'`, excerpt `You are a subagent spawned...` → filtered.
  - unknown source + `[object Object]` → filtered.
  - `filteredT1` count equals 2.
- Memory cap 5, T1 cap 5; dedupe by id/traceId.
- Neighbor `neighborOf` present; `counts.memories` excludes neighbors.
- Payload JSON does not contain `memory_value` full text / `#mem-`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/recall/memory-receipt.test.ts --runInBand --forceExit` (workdir `gateway`)
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

- `filterT1` rules:
  - keep only `source === 'user' || source === 'assistant'` OR `source` unknown and excerpt fails no blacklist.
  - blacklist regex: `/You are a subagent|\[object Object\]|<path>|^ok\s*\|/i`.
  - trim excerpt to 240 chars; drop empty.
- `buildMemoryReceipt` trims `primary_abstraction || memory_value` to 240, caps 5, dedupes, sets `counts`.
- `mergeMemoryReceipt` dedupes by id/traceId, earliest `createdAt`, latest `updatedAt`, max `tookMs`, status rule from spec §4.3.

- [ ] **Step 4: Run to verify pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/receipt.ts gateway/tests/unit/recall/memory-receipt.test.ts
git commit -m "feat(recall): add structured memory receipt builder"
```

### Task 1.2: 快照结构化字段

**Files:**
- Modify: `gateway/src/recall/recall-snapshot.ts`
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Test: `gateway/tests/unit/recall/recall-snapshot.test.ts`（新建或现有）

**Interfaces:**
- `RecallSnapshot` additive:
  - `memories?: Array<{ id; type; abstraction; date; energy?; pinned?; neighborOf? }>`
  - `t1Rendered?: boolean`
- `T1Hit` additive: `source?: string`（从 `T1Row.source` 取；`makeT1Search` 填充）。
- Snapshot builder writes `memories` for the exact anchors rendered (≤5), and `t1Rendered` only when `t1Lines` are appended.

- [ ] **Step 1: Write failing test** — build a snapshot with 2 memories + T1; assert `memories.length === 2`, `t1Rendered === true`, `t1Hits[0].source` populated.
- [ ] **Step 2: Run to verify failure** (`npx jest tests/unit/recall/recall-snapshot.test.ts --runInBand --forceExit`).
- [ ] **Step 3: Implement** additive fields; old snapshots without fields stay valid (all optional).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Add a compatibility test** — `buildMemoryReceipt` from an old snapshot (no `memories`) returns `null`, not a parsed block.
- [ ] **Step 6: Commit.**

### Task 1.3: `memory_receipts` 表与仓储

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `gateway/tests/unit/memory/memory-receipts-db.test.ts`

**Interfaces:**
- `upsertMemoryReceipt(input: { sessionId: string; anchorKey: string; receipt: MemoryReceipt }): void`
- `listMemoryReceipts(sessionId: string, opts?: { limit?: number }): Array<{ anchorKey: string; receipt: MemoryReceipt }>`
- `pruneMemoryReceipts(sessionId: string, keep?: number): number`

- [ ] **Step 1: Write failing test** — create in-memory DB, upsert twice same anchor (merge), list, prune to 2, assert 2 remain.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement migration + methods.** Table from spec §4.4; JSON payload; `ON CONFLICT DO UPDATE`; prune oldest by `updated_at`.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

### Task 1.4: Recall 路由接线（响应后 emit）

**Files:**
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/kernel.ts`（broadcaster 注入）
- Test: `gateway/tests/unit/recall/memory-receipt-route.test.ts`

**Interfaces:**
- `RecallRouteDeps` add:
  - `broadcast: (event: { type: string; sessionID?: string; properties?: unknown }) => void`
  - `saveReceipt?: (input: { sessionId; anchorKey; receipt }) => void`
- Query param `anchorKey` (optional).
- `MAFW_MEMORY_RECEIPT=0` → skip build/save/broadcast (route behavior unchanged).

- [ ] **Step 1: Write failing tests**
  - fake `res` with `writeHead/end/destroyed`; fake broadcaster; assert `broadcast` called **after** `end`.
  - `res.destroyed = true` before end → no broadcast, no save.
  - `anchorKey` missing → no broadcast/save.
  - `memories=[]`, `t1=[]`, no no-memory → no broadcast.
  - `memories=2` → payload has `anchorKey`, counts `2/0`, no `memory_value`.
  - fake DB save that rejects → route still returns 200 (fail-open).
  - `MAFW_MEMORY_RECEIPT=0` → no broadcast/save.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement**
  - Capture `topicState`, `memories`, `snapshot?.t1Hits`, `snapshot?.t1Rendered`, `snap.fokStatus`, `tookMs`.
  - Build receipt; if null, skip.
  - `res.writeHead(200, ...); res.end(JSON.stringify({ pointers }))`.
  - `if (!res.destroyed) setImmediate(() => { saveReceipt?.(...); broadcast({...}) })` with try/catch.
  - Do **not** await save/broadcast.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Add a 100ms test** — fake DB save that never resolves; assert the response promise resolves immediately.
- [ ] **Step 6: Commit.**

### Task 1.5: 历史读取路由 + SDK

**Files:**
- Create: `gateway/src/routes/sessions-memory-receipts.ts`
- Modify: `gateway/src/routes/index.ts`（或 route catalog 注册）
- Modify: `packages/gateway-sdk/src/client.ts`、`types.ts`
- Test: `gateway/tests/unit/api-contract.test.ts`（ledger）、`gateway/tests/unit/routes/sessions-memory-receipts.test.ts`
- Contract: `gateway/contract/openapi.json`（通过 `npm run emit:openapi`）

**Interfaces:**
- `GET /api/sessions/:id/memory-receipts?limit=100` → `{ items: Array<{ anchorKey: string; receipt: MemoryReceipt }> }`
- SDK: `sessions.memoryReceipts(id: string, opts?: { limit?: number }): Promise<{ items: ... }>`

- [ ] **Step 1: Write failing route test** — insert 2 receipts, GET, assert order desc and shape.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement route + SDK method.**
- [ ] **Step 4: Run `npm run emit:openapi` in gateway, `npm run gen:api` in gateway-sdk; update ledger; run contract test.**
- [ ] **Step 5: Run pass.**
- [ ] **Step 6: Commit.**

---

## Phase 2：Desktop 回执

### Task 2.1: 回执投影模型

**Files:**
- Create: `packages/desktop/src/renderer/mafw/memory-receipt.ts`
- Create: `packages/desktop/src/renderer/mafw/memory-receipt.test.ts`

**Interfaces:**
- `typeLabel(type: string): '事实' | '做法' | '通用' | '往事'`
- `relativeReceiptTime(iso: string | null, now: number): string`
- `buildMemoryReceiptView(receipt: MemoryReceipt, now: number): { label; sub; statusCopy; memories; t1; filteredT1 }`
- `receiptLabel(counts): '想起了 3 件事' / '想起了 3 件事 · 1 段摘要'`

- [ ] **Step 1: Write failing tests** — type labels, relative time (`刚刚`/`N 分钟前`/`N 天前`), status copy, 0 T1 hides the second segment, filtered line.
- [ ] **Step 2: Run fail** with the desktop single-file command.
- [ ] **Step 3: Implement pure functions.**
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

### Task 2.2: SSE handler

**Files:**
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/memory-recall.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/memory-recall.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`

**Interfaces:**
- `handleMemoryRecallEvent(event: any, deps: { upsertReceipt(anchorKey: string, receipt: MemoryReceipt): void }): boolean`
- Returns `true` only for `event.type === 'memory.recalled'`.

- [ ] **Step 1: Write failing tests** — type match, anchorKey extraction, duplicate event idempotent (same updatedAt), newer updatedAt replaces.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement + add to `EXTRA_HANDLERS` before chat-stream.**
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

### Task 2.3: 药丸 + 卡片组件

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/MemoryReceipt.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/memory-receipt-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- `<MemoryReceipt receipt={view} onOpenMemory={() => void} />`
- Pill inside a focusable element; hover/focus 300ms opens card; Esc closes.
- CSS classes: `.mafw-memory-receipt`, `.mafw-memory-receipt-card`, `.mafw-memory-receipt-row`.

- [ ] **Step 1: Write failing wiring test** — source contains `mafw-memory-receipt`, `onMouseEnter`, `TooltipV2`? Assert component uses `ButtonV2`/no bare button, and the model labels.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement component** with `ButtonV2` ghost (or a `div role="button"`? AGENTS forbids bare button; `ButtonV2` is fine), `Show`, `For`.
- [ ] **Step 4: Add CSS tokens**; ensure 28px pill, card 440px, max-height 460 with scroll, clamp 2 lines for memory text, 1 line for T1.
- [ ] **Step 5: Run wiring test + tsgo.**
- [ ] **Step 6: Commit.**

### Task 2.4: 历史回填 + 挂到回合

**Files:**
- Create: `packages/desktop/src/renderer/mafw/memory-receipt-store.ts`
- Create: `packages/desktop/src/renderer/mafw/memory-receipt-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/session-ui/src/components/session-turn.tsx`

**Interfaces:**
- `createMemoryReceiptStore()` with `upsert(anchorKey, receipt)`, `forAnchor(anchorKey)`, `hydrate(sessionID, items)`.
- `SessionTurn` new prop: `renderTurnFooter?: (userMessageID: string) => JSX.Element`.
- ChatPane effect: on session change, `window.api.mafw.sessions.memoryReceipts(sessionID)` → hydrate; render footer with `receiptStore.forAnchor(turnKeyOf(messageParts))`.

- [ ] **Step 1: Write failing store test** — hydrate, upsert newer, idempotent, anchor lookup.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement store + preload method.**
- [ ] **Step 4: Add `renderTurnFooter` to SessionTurn** after assistant content; test with a source-read test that the prop is called with the user message id.
- [ ] **Step 5: Wire ChatPane** — find the marker in the user message parts to get anchorKey; render `<MemoryReceipt>`; `localStorage['mafw-memory-receipt']='0'` disables rendering.
- [ ] **Step 6: Run desktop tests + tsgo.**
- [ ] **Step 7: Commit.**

### Task 2.5: 回执真实数据验收

**Files:**
- Create: `packages/desktop/src/renderer/mafw/memory-receipt-realdata.test.ts`

- [ ] **Step 1: Add a fixture** with the 3-memory / 3-T1 block from 2026-11-18 (including tool/subagent lines).
- [ ] **Step 2: Assert** the view shows 3 memories, 1 T1, `filteredT1=2`, and no `ok | packages` / `You are a subagent` text.
- [ ] **Step 3: Run pass.**
- [ ] **Step 4: Commit.**

---

## Phase 3：过程时间线

### Task 3.1: `splitTurn` 纯函数

**Files:**
- Create: `packages/session-ui/src/components/turn-transcript.ts`
- Create: `packages/session-ui/src/components/turn-transcript.test.ts`

**Interfaces:**
- Types from spec §4.7.
- `splitTurn(parts: MafwPart[], opts: { showReasoning: boolean }): TurnEntry[]`
- `segmentDuration(segment, now): number | null` (live only; optional)

- [ ] **Step 1: Write failing fixtures**
  - 思考→工具→输出→思考→工具→输出 → `segment, segment`
  - 只有输出 → one segment with no process
  - 只有过程 → segment with no output
  - 工具后输出、输出后工具
  - 写操作卡片打断 segment
  - data part 打断 segment
  - `showReasoning=false`
  - 跨多个 assistant message 保持顺序
- [ ] **Step 2: Run fail** (`npm test -w @mafw/session-ui`).
- [ ] **Step 3: Implement** the algorithm from spec §4.7.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

### Task 3.2: `ProcessTimeline` 组件

**Files:**
- Create: `packages/session-ui/src/components/process-timeline.tsx`
- Create: `packages/session-ui/src/components/process-timeline.css`
- Create: `packages/session-ui/src/components/process-timeline.test.ts`
- Create: `packages/session-ui/src/components/timeline-tool-row.tsx`

**Interfaces:**
- `<ProcessTimeline entries={TurnEntry[]} working={boolean} showReasoning={boolean} renderCard={(part) => JSX.Element} renderAfterCard={(part) => JSX.Element} />`
- Collapse state per segment key; default: active segment expanded while working, others collapsed; after completion all collapsed; manual toggle wins.
- Tool row: title/subtitle from `getToolInfo` / `canonicalTool`; click toggles detail; detail uses `state.input` / `state.content` / `state.error`.

- [ ] **Step 1: Write failing model tests** for `toolRowLabel(part)` and `segmentStatus(segment)` (pure helpers).
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement component + CSS** (row height 29px, segment head 28px, 1px rail, 5px dot, output style 16px/1.6 via shell overrides).
- [ ] **Step 4: Add a render test** (if the test harness supports Solid): assert output text appears even when segment collapsed; if not, source-read + model test.
- [ ] **Step 5: Run pass + tsgo.**
- [ ] **Step 6: Commit.**

### Task 3.3: 接入 `SessionTurn`

**Files:**
- Modify: `packages/session-ui/src/components/session-turn.tsx`
- Modify: `packages/session-ui/src/components/parts-rules.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Create: `packages/session-ui/src/components/session-turn-timeline.test.ts`

**Interfaces:**
- `SessionTurn` new prop `useProcessTimeline?: boolean` (default false until flag).
- `parts-rules.ts`: `TIMELINE_TOOLS = new Set(['read','list','glob','grep','websearch','webfetch'])`; `isTopLevelToolEntry` returns false for these.
- ChatPane reads `localStorage['mafw-process-timeline'] !== '0'` and passes the flag.

- [ ] **Step 1: Write failing test** — source contains `ProcessTimeline`, `renderAfterCard`, `useProcessTimeline`; `isTopLevelToolEntry` false for `read`.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement** switch; when flag off, keep `AssistantParts` exactly as today.
- [ ] **Step 4: Run existing session-ui + desktop tests; fix compatibility.**
- [ ] **Step 5: Commit.**

### Task 3.4: 权限卡 / flow-card 兼容

**Files:**
- Modify: `packages/session-ui/src/components/session-turn.tsx`（renderAfterPart path）
- Test: `packages/session-ui/src/components/session-turn-timeline.test.ts`（扩展）

- [ ] **Step 1: Write failing test** — `renderAfterPart` called after a write card, not after a timeline tool; order preserved.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement** `renderAfterCard` wiring.
- [ ] **Step 4: Run session-ui + desktop tests.**
- [ ] **Step 5: Commit.**

### Task 3.5: 时长与折叠状态

**Files:**
- Modify: `process-timeline.tsx`
- Test: `process-timeline.test.ts`

- [ ] **Step 1: Write failing tests** for `formatDuration(ms)` (`3 秒`, `1 分 05 秒`) and default collapse state.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement** live observed duration per segment key; history fallback to message `time` or omit.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

---

## Phase 4：用户元信息

### Task 4.1: `latest-reminder` 纯函数

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/context-reminder.ts`
- Create: `packages/desktop/src/renderer/mafw/chat/context-reminder.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/ingest/messages.ts`
- Test: `packages/desktop/src/renderer/mafw/ingest/ingest.test.ts`

**Interfaces:**
- `interface ContextPrefs { city?: string; sendCity: boolean; locale: string; timeZone: string; enabled?: boolean }`
- `formatLatestReminder(prefs, now: Date): string` → `2026-11-18 周三 14:32 · Asia/Shanghai · 上海 · 中文`
- `composeLatestReminderPart(prefs, ts): { type:'text'; id:string; text:string; synthetic:true }`
- `stripLatestReminder(text: string): string` — removes `<latest-reminder>...</latest-reminder>`.

- [ ] **Step 1: Write failing tests** — city on/off, locale, timezone, weekday, strip.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Add `stripLatestReminder` to `stripInjectedUserText`; test.**
- [ ] **Step 5: Run pass.**
- [ ] **Step 6: Commit.**

### Task 4.2: 所有发送路径带 marker + reminder

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`

- [ ] **Step 1: Write failing tests** for normal send, queued flush, steer, retry: each `sendParts` contains `turn_` and `<latest-reminder>`.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement** `buildContextParts(ts)` and prepend in every path. Read prefs from `localStorage['mafw-context-prefs']`; `localStorage['mafw-latest-reminder']='0'` skips the reminder but keeps the turn marker.
- [ ] **Step 4: Run pass.**
- [ ] **Step 5: Commit.**

### Task 4.3: Ghost chip + popover

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ContextChip.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/context-chip.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- `formatContextChip(prefs, now): string` → `周三 14:32 · 上海` or `周三 14:32`.
- `<ContextChip prefs={} onChange={} />`; ghost row 10.5px, hover background, click popover.
- Prefs store: `localStorage['mafw-context-prefs']`, default `sendCity:false`, locale from i18n, timeZone from `Intl`.

- [ ] **Step 1: Write failing model test** — chip format city on/off, time width.
- [ ] **Step 2: Run fail.**
- [ ] **Step 3: Implement component + popover** with `TextInputV2`, `SwitchV2`, `ButtonV2`.
- [ ] **Step 4: Add CSS** (ghost row, no capsule, popover 300px).
- [ ] **Step 5: Wire into ChatPane composer area.**
- [ ] **Step 6: Run desktop tests + tsgo.**
- [ ] **Step 7: Commit.**

---

## Phase 5：集成与验收

### Task 5.1: 全量门禁

- [ ] Gateway: `npx jest --runInBand --forceExit` → all pass; `npx tsc --noEmit -p tsconfig.json` → rc 0.
- [ ] Desktop: `npm test` → all pass; `npx tsgo --noEmit -p tsconfig.json` → rc 0.
- [ ] Session-ui: `npm test -w @mafw/session-ui` → all pass.
- [ ] SDK: `npm test -w @mafw/gateway-sdk` → all pass.
- [ ] Gateway build: `npm run build` → pass.
- [ ] Desktop build: `cd packages/desktop && npx electron-vite build` → pass (do not run concurrently with packaging).
- [ ] Commit any fixes.

### Task 5.2: 真机验收

- [ ] 一轮带 recall 的对话：药丸出现、hover 三条、点击跳 Memory。
- [ ] 刷新后回执仍在。
- [ ] 一轮 5 次 read/grep：折叠后正文不被推走；展开后入参/输出都在。
- [ ] 中间输出在折叠前后数量/顺序一致。
- [ ] “今天 DeepSeek 发布了什么”不再答错日期。
- [ ] 暗/亮/第三主题各看一次。
- [ ] 520px 窄列：chip/药丸不溢出；城市与摘要可从 popover/卡片打开。
- [ ] `GET /api/kernel/stats` 的 recall 路径 p100 仍 < 100ms（日志或临时计时）。
- [ ] 记录 gateway pid / instance / commit 到 release note。

### Task 5.3: 文档与 release

- [ ] `docs/architecture/memory.md`：补回执数据流、T1 过滤、持久化。
- [ ] `docs/architecture/desktop.md`：补时间线分段、用户元信息 chip。
- [ ] `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`：提交、测试数、真机验证、边界、回滚。
- [ ] Commit docs.

---

## 依赖顺序

- Phase 0 → Phase 1（anchorKey 是回执的 PK/SSE 前提）。
- Phase 1 → Phase 2（payload/GET 是桌面契约）。
- Phase 3 独立于 1/2，但建议在 2 之后，避免同时改 ChatPane。
- Phase 4 独立，最后做。
- Phase 5 收口。

## 回滚

- 回执：`MAFW_MEMORY_RECEIPT=0` 关闭 emit/渲染；表保留。
- 时间线：`localStorage['mafw-process-timeline']='0'` 回退到现有工具卡。
- 元信息：`MAFW_LATEST_REMINDER=0` 不注入；chip 可隐藏。
- 所有 migration additive，不删列/表。
