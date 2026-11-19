# ToolPresentation Wave 3 · Rich Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move `task`, `question`, and `skill` onto the shared `ToolCard` shell while keeping their navigation, answers, and content.

**Architecture:** Pure `presentTask` / `presentQuestion` / `presentSkill` functions build the one-line rows. `TaskBody` and `QuestionBody` stay in `message-part.tsx` because they reuse the local `taskSession` / `taskAgent` helpers; `skill` uses the existing `markdown` / `default` ToolCard bodies. `ToolCard` gains `onOpenSession` and renders `open-subagent` actions. Task's self-drawn `BasicTool` trigger and the timeline `task-tool-*` overrides are deleted.

**Tech Stack:** TypeScript, SolidJS, `node:test` + `@mafw/test-shim`, Vite/Electron.

**Spec:** `docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`

## Global Constraints

- Collapsed row: **11px / 550** title, **10.5px** object/meta, **28px** high, one line.
- Expanded body first line aligns at `--mafw-tool-content-left: 6px`.
- All cards default **collapsed**; only explicit `defaultOpen` (details mode) opens.
- No second density: chat and the process timeline share `ToolCard`.
- `expanded.body: "custom"` requires `renderBody`; never an empty expanded body.
- Do not touch approval cards, flow cards, `renderAfterPart`, or mobile.
- Stage only the files named in each task; the worktree has unrelated changes.

## Review Focus

- `task` with `metadata.sessionID` but an empty session list: the open-subagent action still uses the metadata id.
- History `task` without metadata: the `subagentSession` resolver finds the child by title/agent; no child means no action, not a broken link.
- `question` with zero questions or no answers: row resolves, body shows the unanswered fallback, no crash.
- `skill` with empty output: expanded body falls back to the generic input body instead of rendering an empty Markdown body.
- Plugin override on a rich card: `ToolPresentationFallback` supplies `agent` / `subagentSession`, so the fallback matches the normal card.

---

### Task 1: Rich presenters and context resolvers

**Files:**
- Modify: `packages/session-ui/src/components/tool-presentation.ts`
- Modify: `packages/session-ui/src/components/tool-presenters.ts`
- Test: `packages/session-ui/src/components/tool-presenters.test.ts`

**Interfaces:**
- Extend `ToolPresentationContext` with:
  ```ts
  /** Resolve a task part's child session (metadata first, then title/agent match). */
  subagentSession?: (input: Record<string, any>) => string | undefined
  ```
- Produce in `tool-presenters.ts`:
  ```ts
  export const PRESENTED_RICH_TOOLS = ["task", "question", "skill"] as const
  export type PresentedRichTool = (typeof PRESENTED_RICH_TOOLS)[number]
  export function presentTask(ctx: ToolPresentationContext): ToolPresentation
  export function presentQuestion(ctx: ToolPresentationContext): ToolPresentation
  export function presentSkill(ctx: ToolPresentationContext): ToolPresentation
  ```
- `presentTask`: title from `ctx.agent(input.agent)?.name ?? ctx.t("ui.tool.agent.default")`; object `input.description ?? child`; meta `(background)`; `expanded = { body: "custom", actions: [open-subagent] }` when a child exists.
- `presentQuestion`: title `ui.tool.questions`; object first `question.question`; meta answered count or `N 个问题`; `expanded = { body: "custom" }`.
- `presentSkill`: title `input.name` capitalized or `ui.tool.skill`; `expanded.body` = `"markdown"` when `props.output` is non-empty, else `"default"`.

- [x] **Step 1: Write the failing presenter tests**

Append to `tool-presenters.test.ts` (import the three functions and `resolvePresentation` already exists):
```ts
const rich = (props: any, overrides: Partial<ToolPresentationContext> = {}): ToolPresentationContext => ({
  props,
  directory: "C:/repo",
  mode: "chat",
  t: (key: string) => key,
  agent: (name?: string) => (name ? { name: name[0]!.toUpperCase() + name.slice(1) } : undefined),
  subagentSession: () => "ses_child",
  sessionHref: (id: string) => `/session/${id}`,
  ...overrides,
})

describe("rich tool presentations", () => {
  test("task shows the agent, description, background meta, and open action", () => {
    const c = rich({
      tool: "task",
      input: { agent: "build", description: "Fix the bug" },
      metadata: { background: true },
      status: "completed",
    })
    const out = resolvePresentation(presentTask(c), c)
    expect(out.collapsed).toMatchObject({ title: "Build", object: "Fix the bug", meta: [{ text: "(background)", tone: "muted" }] })
    expect(out.expanded.body).toBe("custom")
    expect(out.expanded.actions?.[0]).toMatchObject({
      kind: "open-subagent",
      sessionID: "ses_child",
      href: "/session/ses_child",
      label: "ui.tool.agent",
    })
  })

  test("task prefers metadata.sessionID and omits the action without a child", () => {
    const withMeta = rich({
      tool: "task",
      input: { description: "x" },
      metadata: { sessionID: "ses_meta" },
      status: "completed",
    })
    expect(resolvePresentation(presentTask(withMeta), withMeta).expanded.actions?.[0]).toMatchObject({ sessionID: "ses_meta" })

    const orphan = rich(
      { tool: "task", input: { description: "x" }, metadata: {}, status: "completed" },
      { subagentSession: () => undefined },
    )
    expect(resolvePresentation(presentTask(orphan), orphan).expanded.actions).toBeUndefined()
  })

  test("question shows the first question and answered/unanswered meta", () => {
    const answered = rich({
      tool: "question",
      input: { questions: [{ question: "Pick one" }, { question: "Pick two" }] },
      metadata: { answers: [["A"], ["B"]] },
      status: "completed",
    })
    const out = resolvePresentation(presentQuestion(answered), answered)
    expect(out.collapsed).toMatchObject({
      title: "ui.tool.questions",
      object: "Pick one",
      meta: [{ text: "ui.question.subtitle.answered" }],
    })
    expect(out.expanded.body).toBe("custom")

    const waiting = rich({
      tool: "question",
      input: { questions: [{ question: "Pick one" }, { question: "Pick two" }] },
      metadata: {},
      status: "completed",
    })
    expect(resolvePresentation(presentQuestion(waiting), waiting).collapsed.meta).toEqual([
      { text: "2 ui.common.question.other" },
    ])
  })

  test("skill uses markdown for output and the default body when empty", () => {
    const c = rich({ tool: "skill", input: { name: "office-editing" }, metadata: {}, status: "completed", output: "Title\nBody" })
    const out = resolvePresentation(presentSkill(c), c)
    expect(out.collapsed.title).toBe("Office-editing")
    expect(out.expanded.body).toBe("markdown")

    const empty = rich({ tool: "skill", input: { name: "office-editing" }, metadata: {}, status: "completed", output: "" })
    expect(resolvePresentation(presentSkill(empty), empty).expanded.body).toBe("default")
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run (from `packages/session-ui`):
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-presenters.test.ts`
Expected: FAIL, `presentTask` / `presentQuestion` / `presentSkill` not exported.

- [x] **Step 3: Implement the context field and presenters**

Add the optional `subagentSession` field to `ToolPresentationContext`. Implement the three functions with the exact values from Interfaces.

- [x] **Step 4: Run the tests and the type gate**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-presenters.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-presentation.ts packages/session-ui/src/components/tool-presenters.ts packages/session-ui/src/components/tool-presenters.test.ts
git commit -m "feat(session-ui): add rich tool presenters"
```

---

### Task 2: Open-subagent action and rich bodies

**Files:**
- Modify: `packages/session-ui/src/components/tool-card.tsx`
- Modify: `packages/session-ui/src/components/tool-card.css`
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Test: `packages/session-ui/src/components/tool-card.test.ts`
- Test: `packages/session-ui/src/components/message-part.test.ts`

**Interfaces:**
- `ToolCardProps` gains `onOpenSession?: (sessionID: string) => void`.
- `ToolCard` renders `expanded.actions`:
  - `link` → existing external `<a>`.
  - `open-subagent` with `sessionID` → internal `<a>` when `href` starts with `/`; otherwise a `ButtonV2` ghost when `onOpenSession` exists. Click calls `onOpenSession(sessionID)` and prevents the default navigation.
- `message-part.tsx` adds `TaskBody` and `QuestionBody` components:
  - `TaskBody`: agent row + description + child session id (`data-component="task-detail"`).
  - `QuestionBody`: the existing Q/A markup (`data-component="question-answers"`), with `ui.question.review.notAnswered` when unanswered.

- [x] **Step 1: Write the failing source tests**

Append to `tool-card.test.ts`:
```ts
test("renders open-subagent actions through a session callback", () => {
  expect(tsx).toContain("onOpenSession")
  expect(tsx).toContain("open-subagent")
  expect(tsx).toContain("sessionID")
  expect(css).toContain(".mafw-tool-card-link")
})
```
Append to `message-part.test.ts`:
```ts
describe("rich card bodies", () => {
  test("task and question keep body-only components", () => {
    expect(componentSource).toContain("function TaskBody")
    expect(componentSource).toContain('data-component="task-detail"')
    expect(componentSource).toContain("function QuestionBody")
    expect(componentSource).toContain('data-component="question-answers"')
  })

  test("ToolCard receives the session navigation callback", () => {
    expect(componentSource).toContain("onOpenSession")
  })
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-card.test.ts src/components/message-part.test.ts`
Expected: FAIL on `onOpenSession` / `open-subagent` / `TaskBody`.

- [x] **Step 3: Implement the action and the bodies**

In `tool-card.tsx` import `Icon` and `ButtonV2`; add `onOpenSession`; render the two action kinds. Add inline-flex styling to `.mafw-tool-card-link` and a `.mafw-tool-card-detail` block (11px values, muted labels) to `tool-card.css`.

In `message-part.tsx` add `TaskBody` / `QuestionBody` near `ToolPresentationFallback`; both use `useData` / `useI18n` / `useLocation` and the existing `taskSession` / `taskAgent` helpers. Pass `onOpenSession={(id) => data.navigateToSession?.(id)}` from `ToolPartDisplay` to `ToolCard`.

- [x] **Step 4: Run the tests and the type gate**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-card.test.ts src/components/message-part.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-card.tsx packages/session-ui/src/components/tool-card.css packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/tool-card.test.ts packages/session-ui/src/components/message-part.test.ts
git commit -m "feat(session-ui): add rich tool card bodies and session action"
```

---

### Task 3: Register rich cards and delete the legacy shells

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Modify: `packages/session-ui/src/components/message-part.test.ts`

**Interfaces:**
- Consumes `presentTask` / `presentQuestion` / `presentSkill` (Task 1), `TaskBody` / `QuestionBody` (Task 2).
- Registrations:
  ```ts
  ToolRegistry.register({ name: "task", present: presentTask, renderBody: TaskBody })
  ToolRegistry.register({ name: "question", present: presentQuestion, renderBody: QuestionBody })
  ToolRegistry.register({ name: "skill", present: presentSkill })
  ```
- `ToolPartDisplay` context gains:
  ```ts
  agent: (name) => taskAgent(name, data.store.agent),
  subagentSession: (taskInput) =>
    (partMetadata().sessionID as string | undefined) ??
    taskSession(taskInput, location.pathname, data.store.session, data.store.agent),
  ```
- `ToolPresentationFallback` (plugin presenter fallback) builds the same `agent` / `subagentSession` context with its own `useData` / `useLocation`.
- Delete the old `task` / `question` / `skill` `render` bodies and the `task-tool-*` markup. Remove now-unused imports (`Spinner`, `SessionProgressIndicatorV2`).

- [x] **Step 1: Write the failing wiring tests**

Append to `message-part.test.ts`:
```ts
describe("rich tools use the shared presentation path", () => {
  const block = (name: string, next?: string) => {
    const start = componentSource.indexOf(`name: "${name}"`)
    const end = next ? componentSource.indexOf(`name: "${next}"`, start) : undefined
    return componentSource.slice(start, end)
  }

  test("task/question/skill register present and body slots", () => {
    expect(block("task", "bash")).toContain("present: presentTask")
    expect(block("task", "bash")).toContain("renderBody: TaskBody")
    expect(block("question", "skill")).toContain("present: presentQuestion")
    expect(block("question", "skill")).toContain("renderBody: QuestionBody")
    expect(block("skill")).toContain("present: presentSkill")
    expect(block("task", "bash")).not.toContain("BasicTool")
    expect(block("task", "bash")).not.toContain("task-tool-card")
  })

  test("the presentation context resolves agent and child session", () => {
    expect(componentSource).toContain("agent: (name) => taskAgent(name, data.store.agent)")
    expect(componentSource).toContain("subagentSession:")
    expect(componentSource).toContain("taskSession(taskInput")
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts`
Expected: FAIL, the task block still contains `BasicTool` and no `present: presentTask`.

- [x] **Step 3: Replace the registrations and delete the legacy bodies**

Remove the old task/question/skill `render` blocks. Keep `hideQuestion` and the question error branch unchanged. Import the presenters.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts src/components/tool-presenters.test.ts src/components/tool-card.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.test.ts
git commit -m "feat(session-ui): route rich cards through ToolCard"
```

---

### Task 4: Remove the timeline task overrides

**Files:**
- Modify: `packages/session-ui/src/components/process-timeline.css`
- Modify: `packages/session-ui/src/components/process-timeline.test.ts`
- Modify: `packages/session-ui/src/components/tool-card.css` (only if Task 2 did not finish the detail block)

**Interfaces:**
- `process-timeline.css` drops every `[data-component="task-tool-*"]` rule (no markup emits them after Task 3).
- The task row now uses the shared `.mafw-tool-card-title` / `.mafw-tool-card-object` tokens.

- [x] **Step 1: Write the failing cleanup assertions**

Change `process-timeline.test.ts`:
```ts
test("normalises native cards to the drawer rhythm", () => {
  const src = read('./process-timeline.tsx')
  expect(src).toContain('mafw-process-step-card')
  expect(src).toContain('Collapsible.Arrow')
  const styles = css()
  expect(styles).not.toContain('.mafw-process-tool-row')
  expect(styles).toContain('.mafw-process-step-card [data-slot="basic-tool-tool-title"]')
  expect(styles).not.toContain('task-tool-title')
  expect(styles).not.toContain('task-tool-icon')
  expect(styles).toContain('.mafw-process-think-label')
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/process-timeline.test.ts`
Expected: FAIL, the task-tool rules are still present.

- [x] **Step 3: Delete the task-tool CSS blocks**

Remove the `task-tool-card`, `task-tool-surface`, `task-tool-title`, `task-tool-action`, and `task-tool-icon` blocks from `process-timeline.css`. Leave the `basic-tool.css` baseline for Wave 5.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/process-timeline.test.ts src/components/tool-card.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/process-timeline.css packages/session-ui/src/components/process-timeline.test.ts
git commit -m "style(session-ui): drop timeline task overrides"
```

---

### Task 5: Conformance, docs, full gates, and real-device check

**Files:**
- Modify: `packages/session-ui/src/components/tool-conformance.test.ts`
- Modify: `packages/session-ui/src/components/tool-presentation.test.ts` (fallback context only if needed)
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`
- Modify: `docs/superpowers/plans/2026-11-19-tool-presentation-wave3-rich.md`

**Interfaces:**
- Consumes `PRESENTED_RICH_TOOLS` and the three presenters (Task 1).

- [x] **Step 1: Add the conformance test**

In `tool-conformance.test.ts`, import `PRESENTED_RICH_TOOLS, presentQuestion, presentSkill, presentTask` and add:
```ts
test("every rich tool resolves both states", () => {
  const ctx = {
    ...base,
    agent: (name?: string) => (name ? { name } : undefined),
    subagentSession: () => "ses_child",
    sessionHref: (id: string) => `/session/${id}`,
  }
  const byTool: Record<string, any> = {
    task: { agent: "build", description: "x" },
    question: { questions: [{ question: "q" }] },
    skill: { name: "s" },
  }
  const presenters: Record<string, (c: any) => any> = {
    task: presentTask,
    question: presentQuestion,
    skill: presentSkill,
  }
  for (const name of PRESENTED_RICH_TOOLS) {
    const local = { ...ctx, props: { ...ctx.props, tool: name, input: byTool[name], metadata: {}, output: "out" } }
    const out = resolvePresentation(presenters[name](local), local)
    expect(out.collapsed.title).toBeTruthy()
    expect(out.collapsed.status).toBeTruthy()
    expect(out.expanded.body ?? out.expanded.sections).toBeTruthy()
  }
})
```

- [x] **Step 2: Run conformance and the full session-ui suite**

Run conformance:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-conformance.test.ts`
Expected: pass.
Run the full suite (exclude `architecture.test.ts`):
```powershell
$files = Get-ChildItem src -Recurse -Filter *.test.ts | Where-Object { $_.Name -ne 'architecture.test.ts' } | ForEach-Object { $_.FullName }
node --import tsx --import ../../packages/test-shim/register.mjs --test @files
```
Expected: `fail 0`.

- [x] **Step 3: Run desktop gates**

From `packages/desktop`:
```bash
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: desktop tests `fail 0`, `tsgo` exit 0, build exit 0.

- [x] **Step 4: Verify in the running desktop app**

Reload the renderer (CDP `Page.reload`). In the current chat or process drawer, check:
- a `task` row: one 28px line, agent title 11px/550, description 10.5px, open-subagent action in the expanded body;
- an answered `question` row: `问题` + first question + answered meta, Q/A list in the body;
- a `skill` row: 11px name and markdown body when opened;
- no `.mafw-turn-render-error`.

- [x] **Step 5: Update docs with real gate numbers**

- `docs/architecture/desktop.md`: extend the 2026-11-19 tool-presentation bullet with Wave 3 (`presentTask` / `presentQuestion` / `presentSkill`, `TaskBody` / `QuestionBody`, `onOpenSession`, task-tool CSS removal).
- `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`: add the Wave 3 commit list and exact suite counts.
- Tick every checkbox in this plan file.

- [x] **Step 6: Commit docs and plan**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-18-memory-receipt-timeline-meta.md docs/superpowers/plans/2026-11-19-tool-presentation-wave3-rich.md docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md
git commit -m "docs: record tool presentation wave 3"
```
