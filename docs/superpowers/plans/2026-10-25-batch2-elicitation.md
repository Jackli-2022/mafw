# Batch 2 — Elicitation Structured Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline). Steps use checkbox syntax.

**Goal:** Make 2.1 Form.* a first-class typed interaction: complete field metadata, correct directory-scoped discovery, live refresh, typed answers (external boolean), and typed AskCard UI.

**Architecture:** Extract the form↔question mapping into a pure gateway module used by both the adapter and the @2.1 event transform. Desktop passes the active session directory to `questions.list`, refreshes on top-level `form.*` events, and renders typed controls from the mapped questions.

**Tech Stack:** TypeScript, Jest (gateway), node:test (desktop/SDK), SolidJS AskCard, opencode 2.1 Form API.

**Spec:** `docs/superpowers/specs/2026-10-25-batch2-elicitation-design.md`

**Status:** Implemented in `bbf6dfed` (shared typed form bridge + external boolean), `9a4147e3` (directory-scoped discovery + form.created refresh), `bfaad174` (typed AskCard), `142bca8b` (legacy question requirements + optional field omission). Verification: gateway 2576/2576, desktop 1413/1413, session-ui 89/89, SDK 143/143, TUI 224 (1 smoke skip), root build rc=0. Live smoke: typed form listed (`mode:url`, 5 field types), `external:true` reply 200 with `Form.Detail.state=answered` and typed answer; `external:false` 400 expected.

## Global Constraints

- Do not add canonical event types; reuse `question.asked/replied/rejected` and top-level `form.*` refresh.
- External fields must be answered as boolean true; never send the URL string.
- Directory filter for `/api/form` is the `x-opencode-directory` header; the gateway route already passes it.
- Preserve old question behavior when fields have no `type`.
- No new npm dependency.
- Do not touch parallel B3.1 docs.

## Review Focus

- Form session directory is `"."` or missing — list must still fall back and not crash.
- `when` dependency points to a hidden/unanswered field — field hides; no empty answer sent.
- External acknowledged but URL missing — still submit boolean; UI shows the URL if present.
- `form.created` has no sessionID — refresh only, never create an empty card.
- `default` for multiselect/boolean is not a string — initialize correctly.
- Number/integer custom input must not be treated as a free-text question in answers.

---

### Task 1: Shared form-question module + typed answers

**Files:**
- Create: `gateway/src/runtime/form-question.ts`
- Modify: `gateway/src/runtime/opencode-adapter.ts` (use shared functions; delete local copies)
- Modify: `gateway/src/runtime/opencode-21-events.ts` (`question.v2.asked` transform with form payload)
- Test: `gateway/tests/unit/runtime/form-question.test.ts`
- Test: `gateway/tests/unit/runtime/opencode-21-events.test.ts` (form payload case)

**Interfaces:**
- `formToQuestion(form: any): { id, sessionID, title, metadata, tool, form, questions, __fields }`
- `formAnswerOf(form: any, answers: string[][]): Record<string, unknown>`
- `FormQuestion` type with `type`, `required`, `default`, `format`, `placeholder`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `when`, `url`, `options`, `multiple`, `custom`.

- [ ] **Step 1: Write failing tests**

```ts
import { formToQuestion, formAnswerOf } from '../../../src/runtime/form-question';

const form = {
  id: 'f1', sessionID: 's1', title: 'T',
  fields: [
    { key: 'name', type: 'string', title: 'Name', required: true, placeholder: 'x', minLength: 2 },
    { key: 'count', type: 'integer', title: 'Count', minimum: 1, maximum: 5, default: 2 },
    { key: 'agree', type: 'boolean', title: 'Agree', default: true },
    { key: 'tags', type: 'multiselect', title: 'Tags', options: [{ value: 'a', label: 'A' }] },
    { key: 'link', type: 'external', title: 'Link', url: 'https://x' },
    { key: 'note', type: 'string', title: 'Note', when: [{ key: 'agree', op: 'eq', value: true }] },
  ],
};
const q = formToQuestion(form);
expect(q.questions.find(x => x.id === 'count')).toMatchObject({ type: 'integer', minimum: 1, maximum: 5, default: 2 });
expect(q.questions.find(x => x.id === 'link')).toMatchObject({ type: 'external', url: 'https://x' });
expect(q.questions.find(x => x.id === 'note')!.when).toEqual([{ key: 'agree', op: 'eq', value: true }]);
expect(formAnswerOf(form, [['Alice'], ['3'], ['true'], ['a'], ['true'], ['ok']])).toEqual({
  name: 'Alice', count: 3, agree: true, tags: ['a'], link: true, note: 'ok',
});
expect(formAnswerOf(form, [['Alice'], ['3'], ['false'], [], ['false'], ['']]).link).toBe(false);
```

- [ ] **Step 2: Run to verify fail**, implement the module, rerun.
- [ ] **Step 3: Wire adapter imports** and remove duplicate local functions.
- [ ] **Step 4: Event transform**

```ts
case 'question.v2.asked': {
  const form = data?.form?.fields ? data.form : (Array.isArray(data?.fields) ? data : null);
  return eventOf(raw, MAFW.questionAsked, form ? formToQuestion(form) : data);
}
```
Remove the `question.v2.asked` mapping row. Keep `replied/rejected` mappings.
- [ ] **Step 5: Run tests + tsc; commit** `feat(runtime): typed form-to-question bridge and external boolean answers`.

---

### Task 2: Directory-scoped discovery + immediate refresh

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts` (`questions.list(directory?)`)
- Modify: `packages/gateway-sdk/src/types.ts` (`QuestionsNamespace.list(directory?)`)
- Modify: `packages/desktop/src/preload/mafw-api.ts`, `mafw-types.ts` (list directory arg)
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` (`reconcileFlowCards` + seed use active directory)
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` (form.* top-level refresh)
- Test: `packages/gateway-sdk/src/client.test.ts`
- Test: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`

- [ ] **Step 1: SDK list(directory?)**:
```ts
list: async (directory?: string): Promise<QuestionRequest[]> => {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  const data = await this.request<{ items: QuestionRequest[] }>(`/api/questions${q}`)
  return data.items || []
}
```
Add client test asserting `?directory=`.

- [ ] **Step 2: Preload/types** `list: (directory?: string)`; invoke passes the arg.

- [ ] **Step 3: MafwShell**
```ts
const questionsDir = () => {
  const sid = activeSessionId()
  const dir = store.session.find((s: any) => s.id === sid)?.directory
  return dir && dir !== '.' ? dir : undefined
}
```
Use `window.api.mafw.questions.list(questionsDir())` in both `reconcileFlowCards` and the initial seed. Keep `.catch` fail-open.

- [ ] **Step 4: dispatcher top-level**
```ts
if (['form.created','form.updated','form.replied','form.cancelled'].includes(event.type)) {
  deps.core.trace(event, 'card:form-refresh')
  deps.flowCards.scheduleReconcile(0)
  return
}
```
Add a test with fake deps and assert `calls` contains `scheduleReconcile`.

- [ ] **Step 5: run SDK/desktop tests; commit** `feat(desktop): directory-scoped form discovery and live form refresh`.

---

### Task 3: Typed AskCard UI

**Files:**
- Create: `packages/desktop/src/renderer/mafw/form-model.ts` (pure visibility/validation/defaults/answers)
- Test: `packages/desktop/src/renderer/mafw/form-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/AskCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts` (`mapAskCard` typed fields + form/mode/expiresAt)
- Test: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.test.ts` (or existing)

**Interfaces:**
- `FormField`/`FormQuestion` shape from gateway; `AskQuestionData` extends with type/required/default/format/placeholder/minimum/maximum/minLength/maxLength/pattern/when/url.
- `form-model.ts`:
  - `visibleFields(questions, answers): AskQuestionData[]`
  - `isFieldComplete(q, value): boolean`
  - `initialAnswers(questions): Record<string, string[]>`
  - `serializeAnswers(questions, answers): string[][]`
- `AskCardData.form?: any`, `.mode?: 'form'|'url'`, `.expiresAt?: number`.

- [ ] **Step 1: Write failing form-model tests** for `when` visibility, required/optional, number min/max, external acknowledgement, defaults, serialization order.

- [ ] **Step 2: Implement form-model.ts**; run tests.

- [ ] **Step 3: mapAskCard**:
```ts
form: req.form,
mode: req.mode ?? (req.questions?.some((q:any)=>q.type==='external') ? 'url' : 'form'),
expiresAt: req.expiresAt,
questions: (req.questions || []).map((q:any,i:number) => ({
  id: q.id ?? `${req.id}-q${i}`,
  title: q.question ?? q.title,
  mode: q.multiple ? 'multi' : 'single',
  type: q.type, required: q.required === true,
  options: (q.options || []).map(...),
  allowCustom: q.custom !== false && q.type !== 'external' && q.type !== 'boolean' && q.type !== 'number' && q.type !== 'integer',
  placeholder: q.placeholder, format: q.format,
  minimum: q.minimum, maximum: q.maximum, minLength: q.minLength, maxLength: q.maxLength, pattern: q.pattern,
  when: q.when, url: q.url,
  defaultValue: q.default,
}))
```
- [ ] **Step 4: AskCard**:
  - Import `visibleFields`, `isFieldComplete`, `initialAnswers` from form-model.
  - Keep old behavior when `q.type` undefined.
  - Render number/integer custom input with `type="number"`, min/max; string custom input with placeholder; external URL row + checkbox; boolean/multiselect existing options.
  - `submittable` = pending + every visible required field complete + external acknowledged.
  - `submit` serializes visible fields in question order via `serializeAnswers`.
  - Defaults initialized once; `when` filters.
  - `expiresAt` countdown/expired state; disable submit; show "已过期".
- [ ] **Step 5: CSS** add minimal classes for `.mafw-flow-url`, `.mafw-flow-typed-input`, `.mafw-flow-consent`, expired badge. Use existing tokens (no literal colors).
- [ ] **Step 6: run desktop tests + tsgo + build; commit** `feat(desktop): typed elicitation forms in AskCard`.

---

### Task 4: Live verification + deploy

- [ ] Gateway tests (related + full `--forceExit`), desktop `npm test`, SDK `npm test`, session-ui/TUI unchanged.
- [ ] Build root; pack/install/restart gateway.
- [ ] Live smoke in a `C:/work` scratch session:
  1. Create a form via gateway proxy `POST /api/session/:sid/form` with all 5 field types.
  2. `GET /api/questions?directory=C:/work` shows typed questions.
  3. Reply via `/api/questions/:id/reply` with external `['true']` → success; `GET /api/session/:sid/form/:fid` state=answered.
  4. Deny external (`['false']`) → 400 remains, card stays pending (expected).
  5. `form.created` appears on `/api/events`; desktop reconciliation path covered by test.
- [ ] Update spec/plan status with commits/tests; deploy; report.

## Self-Review

- [x] Spec coverage: typed mapping, external boolean, directory scoping, form.created refresh, when/default/required, expiry UI, old question compatibility.
- [x] Failure modes: '.' directory, hidden `when`, missing URL, no sessionID form event, non-string defaults, number input.
- [x] No new canonical vocabulary; no new dependency; MCP elicitation covered via Form.*.
