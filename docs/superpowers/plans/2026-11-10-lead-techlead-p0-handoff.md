# Lead / Tech Lead P0 + P0.5：Handoff 与 Goal 模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead 创建 Goal 时自动把「当前话题」原文交给 Tech Lead；用户从 Goal 卡片或 Lead 移交卡进入 Tech Lead；Lead 可按需读 Goal 状态；Tech Lead 在同一 Goal 路径上选择 quick / standard / standing 模式。

**Architecture:** 在现有 `mafw_create_goal → PodTechLeadService.createGoal → 隐藏 Tech Lead session` 路径上，新增 `lead_topic` handoff provenance、`buildLeadHandoff` 纯函数、`<goalDir>/context/lead-handoff.md` 全文、opening prompt 注入 snapshot；`goal_mode` 落在 `pod_goal_revisions`，复用现有 `PlanStrategy='quick'`，不新增 `quick_goals` 表或 Quick Worker。

**Tech Stack:** TypeScript、better-sqlite3、jest（gateway）、node:test + `@mafw/test-shim`（desktop）、SolidJS、`@mafw/ui` v2。

**Spec:** `docs/superpowers/specs/2026-11-10-lead-techlead-p0-kernel-objects-design.md`、`docs/superpowers/specs/2026-11-10-goal-shapes-quick-goals-design.md`

## Global Constraints

- 用户永远看不到 session id / session tab / 「新建 session 还是 compaction」。
- `GoalSourceRef.snapshot` ≤ **4000** 字符；只取 user / assistant 的 text，不含 tool call/result、system、compaction 标记。
- 不恢复 `/new-topic`；不改变 NodeDriver / Builder / Reviewer / Plan + Goal Eval。
- **Quick 是同一 Goal 路径上的 `goal_mode` + 现有 `PlanStrategy='quick'`**；不新增 `quick_goals` 表、Quick Worker、第二套 scheduler。
- 不新增裸 `<button>` / `<input>` / `title`；桌面一律 `@mafw/ui` v2 组件。
- Desktop 测试必须带 `--conditions=browser`；gateway 测试用 `jest --runInBand`。
- 功能开关 `MAFW_LEAD_HANDOFF` 默认开；失败回退现有 `mafw_create_goal` 行为，不阻断 Goal 创建。

## Review Focus

- 空话题 / 只有 tool 消息 → 不生成空 snapshot，不抛错。
- runtime history 已压缩 / 不可用 → 用 `lead-handoff.md` 或返回 null，Goal 仍创建。
- 并发创建 / `goalId` 冲突 → 不双写 topic，不重复 handoff。
- Lead session 被替换 → 旧 topic 只读，不把旧 session 当当前 Lead。
- opening prompt 注入顺序 → ContextManifest 在前，handoff 在后，正文最后。
- 桌面入口 → 不出现 session id；invite 在 composer 之前；GoalDetail 来源区可展开。
- Quick plan 多于 1 个 task / 请求 probe → validator 拒绝；旧 revision 默认 `standard`；高风险 quick 拒绝并升 standard。

---

### Task 1: `GoalSourceRef` 增加 topic provenance

**Files:**
- Modify: `gateway/src/core/goal/goal-intake.ts:31-63`
- Test: `gateway/tests/unit/goal/goal-intake.test.ts`

**Interfaces:**
- Produces: `GoalSourceRef { sessionID?; messageID?; snapshot; capturedAt; topicId?; messageRange?: { from: string; to: string } }`
- `normalizeGoalSourceRef(value, fallbackCapturedAt): GoalSourceRef | undefined` keeps old behavior; drops invalid `messageRange`.

- [ ] **Step 1: Write the failing test**

```ts
test("sourceRef keeps topic provenance and drops invalid range", () => {
  const ref = normalizeGoalSourceRef({
    snapshot: "hello",
    topicId: "topic_1",
    messageRange: { from: "m1", to: "m2" },
    capturedAt: "2026-11-10T00:00:00.000Z",
  }, "fallback");
  expect(ref).toEqual({
    snapshot: "hello",
    topicId: "topic_1",
    messageRange: { from: "m1", to: "m2" },
    capturedAt: "2026-11-10T00:00:00.000Z",
  });
  expect(normalizeGoalSourceRef({ snapshot: "x", messageRange: { from: "", to: "m2" } }, "f")?.messageRange)
    .toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/goal/goal-intake.test.ts --runInBand --forceExit`
Expected: FAIL — `topicId` / `messageRange` missing from result.

- [ ] **Step 3: Implement the type and normalization**

```ts
export interface GoalSourceRef {
  sessionID?: string;
  messageID?: string;
  snapshot: string;
  capturedAt: string;
  topicId?: string;
  messageRange?: { from: string; to: string };
}
```

In `normalizeGoalSourceRef`, after snapshot/messageID:

```ts
const topicId = typeof raw.topicId === 'string' ? raw.topicId.trim() : '';
const rawRange = raw.messageRange as Record<string, unknown> | undefined;
const from = typeof rawRange?.from === 'string' ? rawRange.from.trim() : '';
const to = typeof rawRange?.to === 'string' ? rawRange.to.trim() : '';
const messageRange = from && to ? { from, to } : undefined;
```

Include `topicId` / `messageRange` in the returned object only when non-empty.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/goal/goal-intake.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-intake.ts gateway/tests/unit/goal/goal-intake.test.ts
git commit -m "feat(goal): extend sourceRef with topic provenance"
```

---

### Task 2: `lead_topic` store

**Files:**
- Create: `gateway/src/core/lead/lead-topic-store.ts`
- Test: `gateway/tests/unit/lead/lead-topic-store.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LeadTopicRow {
  id: string; projectDir: string; leadSessionId: string; title: string;
  startMessageId: string; endMessageId: string; goalId: string;
  ownerRole: 'lead' | 'tech-lead'; ownerSessionId: string | null; createdAt: string;
}
export class LeadTopicStore {
  constructor(db: Database);
  insert(row: LeadTopicRow): void;
  latestForProject(projectDir: string): LeadTopicRow | null;
  listByProject(projectDir: string): LeadTopicRow[];
  get(id: string): LeadTopicRow | null;
}
```

- [ ] **Step 1: Write the failing test**

```ts
import Database from "better-sqlite3";
import { LeadTopicStore } from "../../../src/core/lead/lead-topic-store";

test("inserts and reads topics newest-first", () => {
  const db = new Database(":memory:");
  const store = new LeadTopicStore(db);
  store.insert({ id: "t1", projectDir: "/p", leadSessionId: "s1", title: "one",
    startMessageId: "m1", endMessageId: "m2", goalId: "g1",
    ownerRole: "tech-lead", ownerSessionId: "s2", createdAt: "2026-11-10T01:00:00.000Z" });
  store.insert({ id: "t2", projectDir: "/p", leadSessionId: "s1", title: "two",
    startMessageId: "m3", endMessageId: "m4", goalId: "g2",
    ownerRole: "tech-lead", ownerSessionId: "s3", createdAt: "2026-11-10T02:00:00.000Z" });
  expect(store.latestForProject("/p")?.id).toBe("t2");
  expect(store.listByProject("/p").map(t => t.id)).toEqual(["t2", "t1"]);
  expect(store.get("t1")?.goalId).toBe("g1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-topic-store.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create the table in the constructor:

```sql
CREATE TABLE IF NOT EXISTS lead_topic (
  id TEXT PRIMARY KEY,
  project_dir TEXT NOT NULL,
  lead_session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  owner_session_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_topic_project_created
  ON lead_topic(project_dir, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_topic_goal ON lead_topic(goal_id);
```

Map snake_case columns to `LeadTopicRow` in `latestForProject` / `listByProject` / `get`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-topic-store.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-topic-store.ts gateway/tests/unit/lead/lead-topic-store.test.ts
git commit -m "feat(lead): add lead_topic handoff store"
```

---

### Task 3: `buildLeadHandoff` pure function

**Files:**
- Create: `gateway/src/core/lead/lead-handoff.ts`
- Test: `gateway/tests/unit/lead/lead-handoff.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LeadHandoffInput {
  messages: MafwMessage[];
  fromMessageId?: string;
  maxChars?: number;
}
export interface LeadHandoffResult {
  snapshot: string;
  messageRange: { from: string; to: string } | null;
  messageCount: number;
  truncated: boolean;
}
export function buildLeadHandoff(input: LeadHandoffInput): LeadHandoffResult;
```

Rules:
- Keep only `role: user | assistant` whose `content` has at least one `type: 'text'` part with non-empty text.
- Start after `fromMessageId` (exclusive) when provided; otherwise from the first kept message.
- Join as `User: ...` / `Assistant: ...` lines.
- If over `maxChars` (default 4000), keep head 60% + tail 40% with `\n…\n` between.

- [ ] **Step 1: Write the failing test**

```ts
const msg = (id: string, role: "user" | "assistant", text: string): MafwMessage => ({
  id, role, content: [{ type: "text", text }],
});

test("filters non-text and truncates head+tail", () => {
  const result = buildLeadHandoff({
    messages: [
      msg("m1", "user", "old"),
      msg("m2", "assistant", "a".repeat(3000)),
      { id: "m3", role: "user", content: [{ type: "tool", tool: "read" } as any] },
      msg("m4", "user", "b".repeat(3000)),
    ],
    fromMessageId: "m1",
    maxChars: 4000,
  });
  expect(result.messageCount).toBe(2);
  expect(result.messageRange).toEqual({ from: "m2", to: "m4" });
  expect(result.truncated).toBe(true);
  expect(result.snapshot.startsWith("Assistant: aaaa")).toBe(true);
  expect(result.snapshot.endsWith("bbbb")).toBe(true);
  expect(result.snapshot).toContain("…");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-handoff.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the function**

Filter, slice after `fromMessageId`, build text, then:

```ts
const head = Math.floor(maxChars * 0.6);
const tail = maxChars - head - 3;
return { snapshot: text.slice(0, head) + "…" + text.slice(-tail), ... };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-handoff.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-handoff.ts gateway/tests/unit/lead/lead-handoff.test.ts
git commit -m "feat(lead): add buildLeadHandoff pure function"
```

---

### Task 4: `LeadHandoffService`

**Files:**
- Create: `gateway/src/core/lead/lead-handoff-service.ts`
- Test: `gateway/tests/unit/lead/lead-handoff-service.test.ts`

**Interfaces:**
- Consumes: `LeadTopicStore`, `buildLeadHandoff`, `MafwMessage`.
- Produces:
```ts
export interface LeadHandoffDeps {
  topics: LeadTopicStore;
  listMessages(input: { sessionID: string; limit: number }): Promise<{ data: MafwMessage[] }>;
  now(): string;
  newId(): string;
}
export interface LeadHandoffBuilt {
  sourceRef: GoalSourceRef;
  handoffPath: string;
  topicId: string;
  messageRange: { from: string; to: string } | null;
}
export class LeadHandoffService {
  constructor(private readonly deps: LeadHandoffDeps);
  buildForGoal(input: {
    projectDir: string; leadSessionId: string; goalId: string; goalDir: string;
    title: string; untilMessageId?: string; maxMessages?: number;
  }): Promise<LeadHandoffBuilt | null>;
}
```

Behavior:
1. `start = topics.latestForProject(projectDir)?.endMessageId` (exclusive).
2. `messages = (await listMessages({ sessionID, limit: maxMessages ?? 200 })).data`.
3. `built = buildLeadHandoff({ messages, fromMessageId: start })`.
4. If `built.messageRange` is null → return null (empty topic).
5. `mkdir -p <goalDir>/context`; write `<goalDir>/context/lead-handoff.md` with full joined text (not truncated).
6. Insert `LeadTopicRow` with new id, `endMessageId = built.messageRange.to`, `ownerRole:'tech-lead'`, `ownerSessionId:null`.
7. Return `sourceRef { sessionID, messageID: to, snapshot, capturedAt: now, topicId, messageRange }`.

- [ ] **Step 1: Write the failing test**

```ts
test("writes full handoff and topic row, returns sourceRef", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const db = new Database(":memory:");
  const topics = new LeadTopicStore(db);
  const service = new LeadHandoffService({
    topics,
    listMessages: async () => ({ data: [msg("m1", "user", "hello"), msg("m2", "assistant", "world")] }),
    now: () => "2026-11-10T00:00:00.000Z",
    newId: () => "topic_1",
  });
  const goalDir = path.join(dir, "goals", "g1");
  const built = await service.buildForGoal({
    projectDir: "/p", leadSessionId: "s1", goalId: "g1", goalDir, title: "T",
  });
  expect(built?.sourceRef.topicId).toBe("topic_1");
  expect(built?.sourceRef.snapshot).toContain("hello");
  expect(fs.readFileSync(path.join(goalDir, "context", "lead-handoff.md"), "utf8")).toContain("world");
  expect(topics.latestForProject("/p")?.goalId).toBe("g1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-handoff-service.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildForGoal`**

Use `fs.mkdirSync(path.join(goalDir, 'context'), { recursive: true })` and `fs.writeFileSync`. Full text = the same filter/join but without truncation; export a helper `renderHandoffText(messages, fromMessageId)` from `lead-handoff.ts` and reuse it (do not duplicate the filter).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-handoff-service.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-handoff-service.ts gateway/src/core/lead/lead-handoff.ts gateway/tests/unit/lead/lead-handoff-service.test.ts
git commit -m "feat(lead): build and persist current-topic handoff"
```

---

### Task 5: Inject handoff into `PodTechLeadService`

**Files:**
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts:54-97,146-305,462-471`
- Modify: `gateway/src/index.ts:4607-4649`
- Test: `gateway/tests/unit/pod/pod-tech-lead-service.test.ts`

**Interfaces:**
- Consumes: `LeadHandoffService.buildForGoal`.
- Produces: `PodTechLeadGoalInput.handoff?: 'current-topic' | 'none'`, `PodTechLeadGoalInput.untilMessageId?: string`; opening prompt includes `<lead-handoff>` with snapshot + path.

- [ ] **Step 1: Write the failing test**

In the existing PodTechLeadService harness, inject `leadHandoff: { buildForGoal: jest.fn(async () => ({ sourceRef: { snapshot: "USER: hi", topicId: "t1", messageRange: { from: "m1", to: "m2" }, capturedAt: "now" }, handoffPath: "/tmp/h.md", topicId: "t1", messageRange: { from: "m1", to: "m2" } })) }` and assert:

```ts
expect(runtime.promptAsync).toHaveBeenCalledWith(expect.objectContaining({
  parts: [expect.objectContaining({ text: expect.stringContaining("<lead-handoff>") })],
}));
const request = JSON.parse(fs.readFileSync(path.join(created.goalDir!, "request.json"), "utf8"));
expect(request.sourceRef.topicId).toBe("t1");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/pod/pod-tech-lead-service.test.ts --runInBand --forceExit`
Expected: FAIL — no `leadHandoff` dep / no `<lead-handoff>` in prompt.

- [ ] **Step 3: Implement**

Add to `PodTechLeadServiceDeps`:
```ts
leadHandoff?: Pick<LeadHandoffService, 'buildForGoal'>;
```
Add to `PodTechLeadGoalInput`: `handoff?: 'current-topic' | 'none'; untilMessageId?: string`.

In `createGoal`, after `goalId` is resolved and before `createGoalIntake`:
```ts
let sourceRef = input.sourceRef;
let handoffPath: string | undefined;
if (!sourceRef && input.createdBy && input.handoff !== 'none' && this.deps.leadHandoff) {
  const built = await this.deps.leadHandoff.buildForGoal({
    projectDir, leadSessionId: input.createdBy, goalId, goalDir: path.join(resolved.mafwDir, 'goals', goalId),
    title, untilMessageId: input.untilMessageId,
  }).catch((err) => { this.deps.log?.(`[Pod] handoff failed: ${err?.message ?? err}`); return null; });
  sourceRef = built?.sourceRef;
  handoffPath = built?.handoffPath;
}
```
Pass `sourceRef` into `createGoalIntake`; change `openingPrompt(title, objective || charter)` to `openingPrompt(title, objective || charter, sourceRef, handoffPath)`.

Append to `openingPrompt`:
```ts
const handoff = sourceRef
  ? `\n\n<lead-handoff>\n${sourceRef.snapshot}\n</lead-handoff>\n` +
    `The user and the Lead discussed this above. Full text: ${handoffPath ?? '(inline snapshot)'}.\n` +
    `Continue from it; do not ask the user to repeat confirmed points.`
  : '';
return `Start the technical discussion...${handoff}`;
```

Wire in `index.ts`:
```ts
leadHandoff: this.leadHandoffService,
```
construct before `new PodTechLeadService(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/pod/pod-tech-lead-service.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/index.ts gateway/tests/unit/pod/pod-tech-lead-service.test.ts
git commit -m "feat(pod): seed Tech Lead with current-topic handoff"
```

---

### Task 6: `mafw_create_goal` schema + args

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts:10-41`
- Modify: `gateway/src/mcp/handlers/create-goal.ts:69-130`
- Test: `gateway/tests/unit/mcp/create-goal-direct.test.ts`

**Interfaces:**
- Produces: schema accepts `sourceRef`, `handoff`, `topicId`; handler passes `handoff` / `topicId` to `createGoal`.

- [ ] **Step 1: Write the failing test**

```ts
test("passes handoff and sourceRef to the Tech Lead", async () => {
  const createGoal = jest.fn(async () => ({ goalId: "g1" }));
  const tool = createCreateGoalTool({ techLead: { isLeadSession: () => true, hasPod: () => true, createGoal } });
  await tool.execute({
    title: "T", objective: "O", sessionID: "lead_1",
    handoff: "current-topic",
    sourceRef: { snapshot: "hi", topicId: "t1" },
  });
  expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({
    handoff: "current-topic",
    sourceRef: expect.objectContaining({ topicId: "t1" }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/mcp/create-goal-direct.test.ts --runInBand --forceExit`
Expected: FAIL — schema/handler drops `handoff` / `sourceRef`.

- [ ] **Step 3: Implement**

Add to the schema properties:
```ts
sourceRef: {
  type: "object",
  properties: {
    sessionID: { type: "string" }, messageID: { type: "string" },
    snapshot: { type: "string" }, capturedAt: { type: "string" },
    topicId: { type: "string" },
    messageRange: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
    },
  },
},
handoff: { type: "string", enum: ["current-topic", "none"] },
topicId: { type: "string" },
```
In the handler, pass `handoff: args.handoff === "none" ? "none" : "current-topic"` and `topicId: clean(args.topicId) || undefined`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/mcp/create-goal-direct.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/create-goal.ts gateway/tests/unit/mcp/create-goal-direct.test.ts
git commit -m "feat(mcp): expose handoff/sourceRef on create_goal"
```

---

### Task 7: Lead goal-status projection + tool

**Files:**
- Create: `gateway/src/core/lead/goal-status.ts`
- Create: `gateway/src/mcp/handlers/lead-goal-status.ts`
- Modify: `gateway/src/mcp/tool-registry.ts` (definition + handler)
- Modify: `gateway/src/runtime/tool-classes.ts` (annotation)
- Test: `gateway/tests/unit/lead/goal-status.test.ts`, `gateway/tests/unit/mcp/lead-goal-status.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LeadGoalStatus {
  goalId: string; title: string; stage: string;
  progress: { done: number; total: number } | null;
  blockers: string[]; pendingAttention: number; lastUpdate: string;
}
export function buildLeadGoalStatus(
  views: PodGoalView[], attention: PodAttentionItem[], limit?: number,
): LeadGoalStatus[];
```
- MCP `mafw_lead_goal_status` args `{ projectDir?: string; limit?: number }`; returns `{ goals: LeadGoalStatus[] }`.

- [ ] **Step 1: Write the failing pure test**

```ts
test("projects active goals with attention counts", () => {
  const status = buildLeadGoalStatus(
    [view({ goalId: "g1", title: "T", stage: { owner: "person", kind: "plan_approval" }, progress: { done: 1, total: 3 } }) as any],
    [{ goalId: "g1", kind: "plan_approval" } as any],
  );
  expect(status[0]).toMatchObject({
    goalId: "g1", title: "T", stage: "plan_approval",
    progress: { done: 1, total: 3 }, pendingAttention: 1,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/goal-status.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

Filter `!v.endedAt`; sort by `v.priority` desc then `v.enqueuedAt` desc; slice limit (default 5); map:
- `stage: v.stage.kind`
- `progress: v.progress ?? null`
- `blockers`: `v.lastError` if present; plus `v.pendingQuestion` → `["waiting for user answer"]`; plus stage kind `blocked/failed`.
- `pendingAttention`: attention.filter(a => a.goalId === v.goalId).length
- `lastUpdate`: `v.startedAt ?? v.enqueuedAt`

- [ ] **Step 4: Implement the MCP handler**

`createLeadGoalStatusTool({ listViews, attention, now? })`; handler resolves `projectDir` from args or `services.sessionID`? Use deps injected from `index.ts`: `listViews(projectDir)` → find Pod by project → `podGoalService.views(podId)`. For the tool, if no projectDir, use `services.projectDir` or `process.cwd()`. Follow `mafw_pod_goal_context` 503 pattern when unwired.

Add definition + handler map + annotation `readOnlyHint: true`.

- [ ] **Step 5: Run tests**

Run:
```bash
npm test --prefix gateway -- tests/unit/lead/goal-status.test.ts tests/unit/mcp/lead-goal-status.test.ts tests/unit/mcp/tool-registry-annotations.test.ts --runInBand --forceExit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/lead/goal-status.ts gateway/src/mcp/handlers/lead-goal-status.ts gateway/src/mcp/tool-registry.ts gateway/src/runtime/tool-classes.ts gateway/tests/unit/lead/goal-status.test.ts gateway/tests/unit/mcp/lead-goal-status.test.ts
git commit -m "feat(lead): add goal status tool"
```

---

### Task 8: Desktop invite label + GoalDetail source

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PodTechLeadInvite.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts:29-46`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:2166-2176`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx:598-660`
- Test: `packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts`, `packages/desktop/tests/pod-tech-lead-wiring.test.ts`, `packages/desktop/tests/goal-detail-unified.test.ts`

**Interfaces:**
- `PodTechLeadInvite` adds `sourceLabel?: string` and renders it as `.mafw-card-meta`.
- `techLeadInvite` returns `{ goalId, label, sourceLabel? }`; `sourceLabel = goal.sourceRef?.topicId ? "来自 Lead 话题" : undefined` (P0; topic title is P1).
- `activeLeadGoalInvite` passes `sourceLabel`.
- `GoalDetailPanel` renders a `上下文来源` line when `podGoal()?.sourceRef` exists, with snapshot first 120 chars and no session id.

- [ ] **Step 1: Write the failing tests**

```ts
// pod-tech-lead-invite.test.ts
test("invite carries source label without session id", () => {
  const view = goal({ goalId: "g1", title: "T", stage: { kind: "discussing" }, sourceRef: { topicId: "t1", snapshot: "hi" } });
  expect(pickTechLeadInviteGoal([view])).toMatchObject({ goalId: "g1", sourceLabel: "来自 Lead 话题" });
});
```

```ts
// packages/desktop/tests/pod-tech-lead-wiring.test.ts
expect(invite).toContain("sourceLabel");
expect(invite).not.toMatch(/ses_[a-zA-Z0-9]+/);
```

```ts
// goal-detail-unified.test.ts
expect(detail).toContain("上下文来源");
expect(detail).toContain("sourceRef");
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-tech-lead-invite.test.ts tests/pod-tech-lead-wiring.test.ts tests/goal-detail-unified.test.ts
```
Expected: FAIL — no `sourceLabel` / no `上下文来源`.

- [ ] **Step 3: Implement the label and source section**

`PodTechLeadInvite.tsx`:
```tsx
<Show when={props.sourceLabel}>
  <span class="mafw-card-meta">{props.sourceLabel}</span>
</Show>
```
`pod-store.ts` `techLeadInvite`:
```ts
const sourceLabel = goal.sourceRef?.topicId ? "来自 Lead 话题" : undefined;
return { goalId, label: TECH_LEAD_INVITE_LABEL, sourceLabel };
```
`GoalDetailPanel.tsx` after the header chips:
```tsx
<Show when={podGoal()?.sourceRef}>
  <div class="mafw-card-meta" data-goal-source>
    上下文来源：{podGoal()!.sourceRef!.snapshot.slice(0, 120)}
  </div>
</Show>
```

- [ ] **Step 4: Run tests to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/PodTechLeadInvite.tsx packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts packages/desktop/tests/pod-tech-lead-wiring.test.ts packages/desktop/tests/goal-detail-unified.test.ts
git commit -m "feat(desktop): show handoff source on Tech Lead entry"
```

---

### Task 9: Lead status card（问才出）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/LeadGoalStatusCard.tsx`
- Create: `packages/desktop/src/renderer/mafw/lead-goal-status.ts` (pure projection)
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` (header toggle + card)
- Modify: `packages/desktop/src/renderer/mafw/mafw.css` (card styles)
- Test: `packages/desktop/src/renderer/mafw/lead-goal-status.test.ts`, `packages/desktop/tests/lead-goal-status-wiring.test.ts`

**Interfaces:**
- `buildLeadGoalStatusCards(goals: PodGoalView[], limit=5): LeadGoalStatusCard[]` — pure, uses `stage.kind`, `progress`, `pendingQuestion`, `lastError`, `endedAt`.
- `LeadGoalStatusCard` props `{ goals: LeadGoalStatusCard[] }`; no fetch, parent passes `podStore.detail()?.goals`.
- ChatPane header: a `ButtonV2` `variant="ghost"` `size="small"` "状态" toggle; card renders above composer only when toggled **and** the active session role is `lead` (use the existing `workspace.sessionRole(activeSessionId()) === "lead"` check, no new prop).

- [ ] **Step 1: Write the failing pure test**

```ts
test("omits ended goals and keeps person stages first", () => {
  const cards = buildLeadGoalStatusCards([
    view({ goalId: "g1", endedAt: "2026-01-01", stage: { kind: "plan_approval" } }),
    view({ goalId: "g2", stage: { kind: "implementing" }, progress: { done: 1, total: 2 } }),
  ]);
  expect(cards.map(c => c.goalId)).toEqual(["g2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-goal-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure projection + component**

Projection: filter non-terminal; sort person > team > system; take 5; fields `{ goalId, title, stageLabel, progressText, blocker, pendingAttention }`.
Component: `@mafw/ui` v2 `ButtonV2` + a `.mafw-queue-bar` card; no raw `<button>`.
ChatPane: add `showLeadStatus` signal; `Show when={props.isLead && showLeadStatus()}` card above `.mafw-composer`.

- [ ] **Step 4: Add wiring contract test**

```ts
const chat = readFileSync("src/renderer/mafw/components/ChatPane.tsx", "utf8");
expect(chat).toContain("LeadGoalStatusCard");
expect(chat.indexOf("LeadGoalStatusCard")).toBeLessThan(chat.indexOf("mafw-composer"));
expect(chat).not.toMatch(/ses_[a-zA-Z0-9]+/);
```

- [ ] **Step 5: Run tests**

Run:
```bash
cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-goal-status.test.ts tests/lead-goal-status-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/LeadGoalStatusCard.tsx packages/desktop/src/renderer/mafw/lead-goal-status.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/lead-goal-status.test.ts packages/desktop/tests/lead-goal-status-wiring.test.ts
git commit -m "feat(desktop): add on-demand Lead goal status card"
```

---

### Task 10: Integration + full gates

**Files:**
- Create: `gateway/tests/integration/lead-handoff.test.ts`
- Modify: none
- Run: gateway + desktop + typecheck + build

- [ ] **Step 1: Write the failing integration test**

Use the `PodTechLeadService` harness with a fake `LeadHandoffService` or the real service + fake messages:
1. Create a Lead session id.
2. `createGoal({ title, objective, createdBy: leadSessionId, projectDir })`.
3. Assert `request.json.sourceRef.topicId` and `<goalDir>/context/lead-handoff.md` exist.
4. Assert `runtime.promptAsync` text contains `<lead-handoff>` and the snapshot.
5. Assert `sourceRef.snapshot` does not contain `tool` / `system`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/lead-handoff.test.ts --runInBand --forceExit`
Expected: FAIL before Tasks 1–7; PASS after.

- [ ] **Step 3: Run the full gates**

```bash
npm test --prefix gateway -- --runInBand --forceExit
cd packages/desktop && npm test
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
cd packages/desktop && npx electron-vite build
cd gateway && npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS / rc=0. Report the exact counts (gateway suites/cases, desktop cases).

- [ ] **Step 4: Commit**

```bash
git add gateway/tests/integration/lead-handoff.test.ts
git commit -m "test(lead): end-to-end current-topic handoff"
```

---

### Task 11: `goal_mode` on revisions + view

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts:20-125,534-571,739-749,1067-1103`
- Modify: `gateway/src/core/pod/pod-view.ts:79-117`
- Modify: `gateway/src/core/pod/pod-goal-service.ts:437-456`
- Test: `gateway/tests/unit/pod/pod-store-revisions.test.ts`, `gateway/tests/unit/pod/pod-view-revisions.test.ts`

**Interfaces:**
- Produces:
```ts
export type PodGoalMode = 'quick' | 'standard' | 'standing';
// PodGoalRevisionRow gains: goalMode: PodGoalMode
// createGoalRevision input gains: goalMode?: PodGoalMode
// PodGoalView gains: goalMode: PodGoalMode
// PodStore gains: setGoalRevisionMode(goalId: string, revision: number, mode: PodGoalMode): void
```

- [ ] **Step 1: Write the failing test**

```ts
test("new revisions default to standard and setGoalRevisionMode updates", () => {
  const row = store.createGoalRevision({
    podId, goalId: "g1", revision: 1, status: "discussing", now,
  });
  expect(row.goalMode).toBe("standard");
  store.setGoalRevisionMode("g1", 1, "quick");
  expect(store.getGoalRevision("g1", 1)?.goalMode).toBe("quick");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/pod/pod-store-revisions.test.ts --runInBand --forceExit`
Expected: FAIL — `goalMode` undefined / method missing.

- [ ] **Step 3: Implement the column and types**

In `PodStore` constructor:
```ts
this.ensureColumn('pod_goal_revisions', 'goal_mode', "goal_mode TEXT NOT NULL DEFAULT 'standard'");
```
Add `goalMode` to `PodGoalRevisionRow`, `createGoalRevision` input/INSERT, and row mapping. Add:
```ts
setGoalRevisionMode(goalId: string, revision: number, mode: PodGoalMode): void {
  this.db.prepare('UPDATE pod_goal_revisions SET goal_mode = ? WHERE goal_id = ? AND revision = ?')
    .run(mode, goalId, revision);
}
```
In `PodGoalService.views`, pass `revision.goalMode` into `buildPodGoalView` (add optional 5th param `goalMode: PodGoalMode = 'standard'`), and set `PodGoalView.goalMode`.

- [ ] **Step 4: Run tests**

Run:
```bash
npm test --prefix gateway -- tests/unit/pod/pod-store-revisions.test.ts tests/unit/pod/pod-view-revisions.test.ts --runInBand --forceExit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-view.ts gateway/src/core/pod/pod-goal-service.ts gateway/tests/unit/pod/pod-store-revisions.test.ts gateway/tests/unit/pod/pod-view-revisions.test.ts
git commit -m "feat(pod): add goal_mode to revisions and views"
```

---

### Task 12: Extend `mafw_pod_goal_direction` with `goalMode`

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts:42-71`
- Modify: `gateway/src/mcp/handlers/pod-goal-direction.ts:16-190`
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts:361-378`
- Modify: `gateway/src/skills/tech-lead-identity.ts:13-34`
- Test: `gateway/tests/unit/mcp/pod-goal-direction.test.ts`, `gateway/tests/unit/pod/pod-tech-lead-service.test.ts`

**Interfaces:**
- `PodGoalDirectionArgs` gains `goalMode?: 'quick' | 'standard' | 'standing'`.
- `PodGoalDirectionDeps` gains `setGoalMode(goalId: string, mode: PodGoalMode): Promise<void> | void`.
- `PodTechLeadService.setGoalMode(goalId: string, mode: PodGoalMode): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("direction writes goalMode before starting planning", async () => {
  const setGoalMode = jest.fn();
  const decide = jest.fn();
  const startPlanning = jest.fn();
  const tool = createPodGoalDirectionTool({
    techLead: { assertTechLeadSession: () => ({ revision: 1, sessionID: "s1" }) },
    direction: { decide, request: jest.fn() },
    setGoalMode,
    startPlanning,
  });
  await tool.execute({ goalId: "g1", mode: "clear", goalMode: "quick", sessionID: "s1" });
  expect(setGoalMode).toHaveBeenCalledWith("g1", "quick");
  expect(decide).toHaveBeenCalled();
  expect(startPlanning).toHaveBeenCalledWith("g1");
});
```

```ts
test("standing is not supported yet", async () => {
  const tool = createPodGoalDirectionTool({ /* deps */ });
  const result = await tool.execute({ goalId: "g1", mode: "clear", goalMode: "standing", sessionID: "s1" });
  expect(result.structuredContent).toMatchObject({ success: false, status: 501 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/mcp/pod-goal-direction.test.ts --runInBand --forceExit`
Expected: FAIL — `goalMode` ignored.

- [ ] **Step 3: Implement**

Schema: add `goalMode: { type: 'string', enum: ['quick','standard','standing'] }`.

Handler:
```ts
const goalMode = args.goalMode === 'standing' ? 'standing'
  : args.goalMode === 'quick' ? 'quick' : 'standard';
if (goalMode === 'standing') {
  return ok({ success: false, status: 501, error: 'standing goals are not supported yet' });
}
await deps.setGoalMode(goalId, goalMode);
// then existing direction.decide/request + startPlanning
```

`PodTechLeadService.setGoalMode`:
1. `assertTechLeadSession`? The handler already validated; service resolves goal/revision.
2. Read `request.json`; if `planReview === 'manual'` and mode `quick` → `throw new PodError(400, 'quick requires auto plan review')`.
3. `store.setGoalRevisionMode(goalId, revision, mode)`.

Tech Lead prompt: add "Before calling `mafw_pod_goal_direction`, choose `goalMode`: `quick` for one-file/low-risk work; `standard` otherwise. Never choose `standing` directly; that is P2.5."

- [ ] **Step 4: Run tests**

Run:
```bash
npm test --prefix gateway -- tests/unit/mcp/pod-goal-direction.test.ts tests/unit/pod/pod-tech-lead-service.test.ts tests/unit/runtime/identity-registry.test.ts --runInBand --forceExit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/pod-goal-direction.ts gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/skills/tech-lead-identity.ts gateway/tests/unit/mcp/pod-goal-direction.test.ts gateway/tests/unit/pod/pod-tech-lead-service.test.ts
git commit -m "feat(pod): let Tech Lead choose quick/standard mode"
```

---

### Task 13: Quick plan prompt + validator

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts` (plan prompt builder)
- Modify: `gateway/src/core/goal/plan-package.ts:143-162` (validator)
- Test: `gateway/tests/unit/goal/plan-package.test.ts` (or existing validator test)

**Interfaces:**
- Plan prompt accepts `goalMode?: PodGoalMode`; when `quick`, append:
  `This Goal is quick: produce exactly one task, request no probes, and set strategy:'quick'.`
- `validatePlanPackage` rejects a quick plan with `tasks.length !== 1` or `probes.length > 0`.

- [ ] **Step 1: Write the failing tests**

```ts
test("quick plan with two tasks is rejected", () => {
  const result = validatePlanPackage({ strategy: "quick", tasks: [task("a"), task("b")], ... } as any);
  expect(result.ok).toBe(false);
  expect(result.errors.join(" ")).toContain("exactly one task");
});

test("quick plan with a probe is rejected", () => {
  const result = validatePlanPackage({ strategy: "quick", tasks: [task("a")], probes: [{ ... }] } as any);
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/goal/plan-package.test.ts --runInBand --forceExit`
Expected: FAIL — validator accepts multi-task quick.

- [ ] **Step 3: Implement**

- Add `goalMode` to the plan prompt input and append the directive when `goalMode === 'quick'`.
- In `validatePlanPackage`, in the `strategy === 'quick'` branch, push `"quick plan must have exactly one task"` when `tasks.length !== 1`; push `"quick plan must not request probes"` when probes are non-empty.
- Ensure `goalMode` is threaded from the active revision into the plan node prompt (driver/`node-prompts` call site).

- [ ] **Step 4: Run tests**

Run: `npm test --prefix gateway -- tests/unit/goal/plan-package.test.ts tests/unit/goal-driver-quick-path.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/plan-package.ts gateway/tests/unit/goal/plan-package.test.ts
git commit -m "feat(goal): enforce quick plan shape"
```

---

### Task 14: Goal mode badge

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx:598-660`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkOverview.tsx` (goal row badge)
- Test: `packages/desktop/tests/goal-detail-unified.test.ts`

**Interfaces:**
- `PodGoalView.goalMode` from Task 11; render `Quick` / `Standard` / `Standing` as a `.mafw-card-meta` badge.
- No new color tokens; use existing `--text-2` / `--border-subtle`.

- [ ] **Step 1: Write the failing test**

```ts
const detail = readFileSync(new URL("./GoalDetailPanel.tsx", import.meta.url), "utf8");
expect(detail).toContain("goalMode");
expect(detail).toContain("Quick");
expect(detail).not.toMatch(/ses_[a-zA-Z0-9]+/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-detail-unified.test.ts`
Expected: FAIL — no `goalMode`.

- [ ] **Step 3: Implement**

Add a `goalModeLabel(mode)` helper (pure, `quick → "Quick"`, etc.) and render it next to the phase badge in `GoalDetailPanel`; add a small badge in `WorkOverview` goal rows. Use `@mafw/ui` v2 components only.

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/components/WorkOverview.tsx packages/desktop/tests/goal-detail-unified.test.ts
git commit -m "feat(desktop): show goal mode badge"
```

---

### Task 15: Quick mode integration

**Files:**
- Create: `gateway/tests/integration/goal-modes-quick.test.ts`
- Run: full gates

- [ ] **Step 1: Write the failing integration test**

Using the existing `goal-driver-quick-path` / `pod-goal-direction` harness:
1. Create a discussing Goal with a fake Tech Lead session.
2. Call direction with `goalMode:'quick'` and `mode:'clear'`.
3. Assert revision `goalMode='quick'`, plan prompt contains "exactly one task".
4. Run the plan node with one task; assert `archive_unreviewed` and no independent Reviewer.
5. Create a second Goal with `goalMode:'quick'` and a two-task plan; assert validator rejects.
6. Create a third Goal with `goalMode:'standard'`; assert the existing plan-approval path still runs.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/goal-modes-quick.test.ts --runInBand --forceExit`
Expected: FAIL before Tasks 11–14; PASS after.

- [ ] **Step 3: Run full gates**

```bash
npm test --prefix gateway -- --runInBand --forceExit
cd packages/desktop && npm test
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
cd packages/desktop && npx electron-vite build
cd gateway && npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS / rc=0. Report exact counts.

- [ ] **Step 4: Commit**

```bash
git add gateway/tests/integration/goal-modes-quick.test.ts
git commit -m "test(goal): quick mode end-to-end"
```

## Self-Review

- **Spec coverage:** P0 spec §4.2 (lead_topic/sourceRef/goal-status), §4.3 (handoff flow), §4.4 (API), §4.5 (UI), §5 (failure), §6 (tests) map to Tasks 1–10. P0.5 spec §5 (`goal_mode`), §6 (direction), §7 (quick plan), §8 (badge), §11 (tests) map to Tasks 11–15.
- **Type consistency:** `GoalSourceRef` fields match across Tasks 1/4/5/6; `LeadGoalStatus` matches Task 7; `LeadTopicRow` matches Task 2/4; `PodGoalMode` matches Tasks 11/12/13/14/15.
- **Review Focus:** each line has a test in Tasks 3/4/5/8/9/10/13/15.
- **No second path:** Quick is `goal_mode` + existing `PlanStrategy='quick'`; no `quick_goals` table or Quick Worker is created by any task.
