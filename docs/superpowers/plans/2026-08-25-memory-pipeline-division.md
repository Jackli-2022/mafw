# Memory Pipeline Division of Labor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the turnCompress (factual layer) and reflect (cross-turn higher-order patterns) pipelines into two distinct responsibilities, add a Generative Agents–style 3-step reflection, and give `mafw_add_memory` an explicit `importance` scoring knob (1-10) that maps to `salience`.

**Architecture:** TurnCompress stays agent-driven (worker calls `mafw_add_memory` over HTTP with an `importance` field). Reflect upgrades from a single-call distillation to a gateway-orchestrated 3-step flow (questions → retrieval → distillation), fed with full `memory_value` text instead of index summaries. Both prompts gain a division-of-labor declaration so each pipeline knows what *not* to do.

**Tech Stack:** TypeScript (CJS gateway build), Zod for tool schemas, Jest for tests, BM25 via `HarmonicIndexManager.searchScored`, `HarmonicUnitFileStore.read(id)` to load per-episode `memory_value` from OKF files.

## Global Constraints

- Build output: `npm run build` must succeed (plugin + gateway).
- Tests: `npm test` green; the new/updated tests listed in each task.
- Legacy path `core/mcp/tools.ts:450` (`mafw_add_memory` legacy MCP handler) is **not modified** — it remains a deprecated fallback.
- Importance-to-salience formula: `salience = 0.5 + (importance - 1) / 9` → maps `[1, 10]` to `[0.5, 1.5]` inclusive, matching the existing regex tiers.
- Reflect full-text cap: 2000 chars per episode (truncate with `…` suffix on overflow).
- Reflect retrieval evidence: BM25 via `searchScored(q, 5, { graphExpand: false })`, skip entries with `superseded_by`.
- Three-step reflect hard-failure policy: Step 1 or Step 3 exception → episodes stay unreflected (retry next run). Step 2 empty/failed is not a failure; skip evidence block and proceed to Step 3.
- Step 1 question-parse failure → fall through to single-call reflect (legacy path with full-text prompt) — do not leave episodes unreflected for a JSON-parse glitch.
- YAGNI (explicit out-of-scope): no evidence-reference persistence on `HarmonicUnit`; no `category` field refactor; no Mem0-style ADD/UPDATE/DELETE/NOOP write decision.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `gateway/src/core/memory/salience-perceptor.ts` | Modify | Add `importanceToSalience(n)` pure function alongside existing `calculateSalience` |
| `gateway/src/recall/reflection.ts` | Modify | Full-text episode loading + 3-step orchestrator + `QUESTIONS_SYSTEM` + `parseQuestions` + division-of-labor declaration in `REFLECT_SYSTEM` |
| `gateway/src/recall/turn-pipeline.ts` | Modify | Add division-of-labor + importance scoring guidance to `TOOL_EXTRACTION_SYSTEM` |
| `gateway/src/mcp/handlers/add-memory.ts` | Modify | Accept `importance` arg → compute `salience` via `importanceToSalience` if valid, else `calculateSalience` |
| `gateway/src/index.ts` (`/api/memory/add`) | Modify | Same `importance`-aware salience logic |
| `src/tools/add-memory.ts` | Modify | Add optional `importance` to Zod schema + HTTP POST body |
| `tests/unit/recall/reflection.test.ts` | Modify | New tests for full-text load, 3-step flow, question-parse fallback |
| `tests/unit/gateway/salience-perceptor.test.ts` | Create (or modify if exists) | `importanceToSalience` unit tests |
| `tests/unit/gateway/add-memory-importance.test.ts` | Create | HTTP + MCP handler importance → salience mapping |

> If `tests/unit/gateway/salience-perceptor.test.ts` does not yet exist, create it. Grep first: `Get-ChildItem -Recurse tests -Filter salience*.test.ts`.

---

### Task 1: importance → salience helper

**Files:**
- Modify: `gateway/src/core/memory/salience-perceptor.ts:1-8`
- Create (or extend): `tests/unit/gateway/salience-perceptor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `importanceToSalience(importance: number): number` — pure, throws on out-of-range, used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/salience-perceptor.test.ts`:

```typescript
import { calculateSalience, importanceToSalience } from '../../gateway/src/core/memory/salience-perceptor';

describe('importanceToSalience', () => {
  test('maps 1 to 0.5 (floor)', () => {
    expect(importanceToSalience(1)).toBeCloseTo(0.5, 5);
  });
  test('maps 10 to 1.5 (ceiling)', () => {
    expect(importanceToSalience(10)).toBeCloseTo(1.5, 5);
  });
  test('maps 5 to ~0.944 (mid)', () => {
    // 0.5 + (5-1)/9 = 0.5 + 0.4444... = 0.9444...
    expect(importanceToSalience(5)).toBeCloseTo(0.9444, 3);
  });
  test('is monotonic increasing', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(importanceToSalience);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
  test('rejects non-integer and out-of-range', () => {
    expect(() => importanceToSalience(0)).toThrow();
    expect(() => importanceToSalience(11)).toThrow();
    expect(() => importanceToSalience(1.5)).toThrow();
    expect(() => importanceToSalience(NaN)).toThrow();
  });
});

describe('calculateSalience (regression)', () => {
  test('HIGH keywords → 1.5', () => {
    expect(calculateSalience('critical crash in production')).toBe(1.5);
  });
  test('LOW keywords → 0.5', () => {
    expect(calculateSalience('info: success')).toBe(0.5);
  });
  test('default → 1.0', () => {
    expect(calculateSalience('refactored the widget module')).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/salience-perceptor.test.ts`
Expected: FAIL — `importanceToSalience` is not exported / not defined.

- [ ] **Step 3: Add the helper to salience-perceptor.ts**

Edit `gateway/src/core/memory/salience-perceptor.ts`. The file becomes:

```typescript
export function calculateSalience(text: string): number {
  if (!text) return 1.0;
  const HIGH = [/error|crash|fail|丢失|数据损坏|宕机|critical|emergency|严重/i];
  const LOW = [/info|success|完成|正常|debug|trace|verbose/i];
  if (HIGH.some(p => p.test(text))) return 1.5;
  if (LOW.some(p => p.test(text))) return 0.5;
  return 1.0;
}

/**
 * Map an explicit 1-10 importance rating to salience in the range [0.5, 1.5],
 * linearly. Matches the three regex tiers of calculateSalience so that
 * importance-driven and regex-driven writes sort together in retrieval.
 */
export function importanceToSalience(importance: number): number {
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    throw new Error(`importance must be an integer in [1, 10], got ${importance}`);
  }
  return 0.5 + (importance - 1) / 9;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/salience-perceptor.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/salience-perceptor.ts tests/unit/gateway/salience-perceptor.test.ts
git commit -m "feat(memory): add importanceToSalience helper (1-10 -> 0.5-1.5)"
```

---

### Task 2: importance parameter on `mafw_add_memory` (plugin schema + HTTP + MCP)

**Files:**
- Modify: `src/tools/add-memory.ts:30-54` (plugin schema + HTTP body)
- Modify: `gateway/src/mcp/handlers/add-memory.ts:8-42` (MCP args + salience)
- Modify: `gateway/src/index.ts:4574-4612` (`/api/memory/add` salience)
- Create: `tests/unit/gateway/add-memory-importance.test.ts`

**Interfaces:**
- Consumes: `importanceToSalience` from Task 1.
- Produces: three write paths that accept `importance` and compute `salience` with the importance mapping when present, else fall back to `calculateSalience(content)`.

- [ ] **Step 1: Update the plugin tool schema + HTTP body**

Edit `src/tools/add-memory.ts`:

1. Add `importance?: number` to the `execute` args type (line 17-22).
2. Extend the `args` Zod object (line 30-38):

```typescript
  args: {
    content: z.string().describe('记忆内容（一句话）'),
    memoryType: z
      .enum(['semantic', 'episodic', 'procedural', 'global'])
      .optional()
      .describe('semantic=事实/偏好/约束，episodic=叙事，procedural=教训/模式，global=跨项目'),
    cueAnchors: z.array(z.string()).max(8).optional().describe('检索关键词'),
    primaryAbstraction: z.string().optional().describe('6-8 词摘要（缺省自动生成）'),
    importance: z.number().int().min(1).max(10).optional().describe(
      '1=琐碎日常，5=普通事实，9-10=架构级决定/严重事故。每条记忆必须显式打分。',
    ),
  },
```

3. Pass `importance` through the HTTP body (line 46-52):

```typescript
        body: JSON.stringify({
          content: args.content,
          memoryType: args.memoryType || 'semantic',
          cueAnchors: args.cueAnchors || [],
          primaryAbstraction: args.primaryAbstraction,
          importance: args.importance,
          sessionID: ctx?.sessionID,
        }),
```

- [ ] **Step 2: Update the MCP handler**

Edit `gateway/src/mcp/handlers/add-memory.ts`:

1. Import the new helper at line 6:

```typescript
import { calculateSalience, importanceToSalience } from "../../core/memory/salience-perceptor";
```

2. Read `importance` from args and compute salience (replace line 38 `salience: calculateSalience(content),`):

```typescript
    const rawImportance = args.importance;
    const hasValidImportance =
      typeof rawImportance === 'number' &&
      Number.isInteger(rawImportance) &&
      rawImportance >= 1 &&
      rawImportance <= 10;
    const salience = hasValidImportance
      ? importanceToSalience(rawImportance)
      : calculateSalience(content);

    const unit = {
      id: unitId,
      type: memoryType,
      primary_abstraction: primaryAbstraction.slice(0, memCfg.abstractionMaxLength),
      cue_anchors: cueAnchors.slice(0, memCfg.maxCueAnchors),
      memory_value: content,
      energy: memCfg.defaultEnergy,
      salience,
      abstraction_level: memoryType === "global" ? 3 : memoryType === "episodic" ? 1 : 2,
      created_at: now,
      updated_at: now,
    };
```

- [ ] **Step 3: Update the HTTP handler**

Edit `gateway/src/index.ts` inside the `/api/memory/add` block (line 4574-4612):

1. Update the `require` line at 4590:

```typescript
        const { calculateSalience, importanceToSalience } = require('./core/memory/salience-perceptor.js');
```

2. Compute salience from `data.importance` if valid, else regex:

```typescript
        const rawImportance = data?.importance;
        const hasValidImportance =
          typeof rawImportance === 'number' &&
          Number.isFinite(rawImportance) &&
          Number.isInteger(rawImportance) &&
          rawImportance >= 1 &&
          rawImportance <= 10;
        const salience = hasValidImportance
          ? importanceToSalience(rawImportance)
          : calculateSalience(content);
```

3. Use `salience` in the unit object (replace line 4600):

```typescript
          salience,
```

- [ ] **Step 4: Write the failing tests**

Create `tests/unit/gateway/add-memory-importance.test.ts`. Use direct handler invocation (no HTTP) — the handler is a pure async function:

```typescript
import { handleAddMemory } from '../../gateway/src/mcp/handlers/add-memory';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('mafw_add_memory importance → salience', () => {
  let tmpDir: string;
  let index: HarmonicIndexManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-imp-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    index = new HarmonicIndexManager(tmpDir);
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const call = async (args: Record<string, unknown>) => {
    const ctx = { memory: { harmonicIndex: index }, mafwDir: tmpDir } as any;
    return handleAddMemory(args, ctx);
  };

  test('importance=10 → salience 1.5', async () => {
    await call({ content: 'architectural decision', memoryType: 'semantic', cueAnchors: ['x'], importance: 10 });
    const e = index.getIndex().entries.find(x => x.type === 'semantic');
    expect(e?.salience).toBeCloseTo(1.5, 5);
  });

  test('importance=1 → salience 0.5', async () => {
    await call({ content: 'small fact', memoryType: 'semantic', cueAnchors: ['y'], importance: 1 });
    const e = index.getIndex().entries.find(x => x.type === 'semantic');
    expect(e?.salience).toBeCloseTo(0.5, 5);
  });

  test('missing importance falls back to regex salience (HIGH keyword → 1.5)', async () => {
    await call({ content: 'critical failure in production', memoryType: 'semantic', cueAnchors: ['z'] });
    const e = index.getIndex().entries.find(x => x.type === 'semantic');
    expect(e?.salience).toBe(1.5);
  });

  test('invalid importance (0, 11, 1.5, NaN) falls back to regex', async () => {
    for (const bad of [0, 11, 1.5, NaN]) {
      // clear previous
      for (const e of index.getIndex().entries.filter(x => x.type === 'semantic')) {
        index.removeEntry?.(e.id);
      }
      await call({ content: 'info success normal', memoryType: 'semantic', cueAnchors: ['q'], importance: bad });
      const e = index.getIndex().entries.find(x => x.type === 'semantic');
      expect(e?.salience).toBe(0.5); // LOW regex fallback
    }
  });
});
```

> Note: if `index.removeEntry` does not exist on `HarmonicIndexManager`, replace the loop with a fresh `index = new HarmonicIndexManager(tmpDir)` per iteration (the constructor re-loads the on-disk index, so clear the entries by writing a fresh index file or just use a fresh tmpDir per case — prefer fresh tmpDir: extract the loop body into a helper that takes a fresh `tmpDir` and assert inside).

- [ ] **Step 5: Run tests to verify they fail before impl**

Run: `npx jest tests/unit/gateway/add-memory-importance.test.ts`
Expected: FAIL — salience does not match importance-driven values (all fall through to `calculateSalience`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/unit/gateway/add-memory-importance.test.ts`
Expected: all PASS after Steps 2-3.

- [ ] **Step 7: Run the full plugin build to confirm schema compiles**

Run: `npm run build`
Expected: plugin + gateway both build without errors.

- [ ] **Step 8: Commit**

```bash
git add src/tools/add-memory.ts gateway/src/mcp/handlers/add-memory.ts gateway/src/index.ts tests/unit/gateway/add-memory-importance.test.ts
git commit -m "feat(memory): mafw_add_memory accepts importance (1-10) mapped to salience"
```

---

### Task 3: reflect pipeline — full-text input + 3-step Generative Agents flow + division-of-labor prompt

**Files:**
- Modify: `gateway/src/recall/reflection.ts:48-54` (REFLECT_SYSTEM division-of-labor), `99-118` (unreflectedBySession stays same signature), `172-233` (reflectSession → 3-step)
- Modify: `tests/unit/recall/reflection.test.ts` (update existing test + add 4 new tests)

**Interfaces:**
- Consumes: `HarmonicUnitFileStore.read(id)` (existing), `HarmonicIndexManager.searchScored(q, 5, { graphExpand: false })` (existing).
- Produces: updated `reflectSession` returning identical `ReflectionResult`; cursor semantics unchanged; `parseInsights` output format unchanged.

- [ ] **Step 1: Update `REFLECT_SYSTEM` prompt with division-of-labor declaration**

Edit `gateway/src/recall/reflection.ts:48-54`. Replace the `REFLECT_SYSTEM` constant:

```typescript
const REFLECT_SYSTEM = `You are the REFLECTION stage of a two-tier memory system. Your role is cross-turn higher-order reasoning, NOT factual recording (the turnCompress pipeline already handles that).

Review the episodic memories of one conversation — with full text, not summaries — and distill durable, reusable insights. Return ONLY valid JSON, no markdown:
{"insights":[{"category":"failure|correction|insight|preference|convention|tool-quirk","content":"<one sentence>","cue_anchors":["<keyword>"]}]}

Scope — DO extract:
- recurring failure root causes across episodes
- lessons that generalize to future tasks/sessions
- user behavior patterns and durable preference shifts
- workflow conventions and tool quirks that repeat

Scope — DO NOT extract:
- single-episode facts already captured as episodic memories
- session-scoped narrative ("we did X today") — turnCompress already recorded that
- any insight that paraphrases a specific episode's primary_abstraction verbatim

Evidence: you may be given a "Related historical memories" block from the harmonic index. Use it to anchor insights in cross-session patterns (e.g., "user keeps hitting X in projects A, B, and C"). Do not re-emit the evidence as new insights.

Rules:
- no redundant insights; each insight must be a durable, cross-session lesson
- every cue_anchors list MUST include the topic entity names (project, module, API, person, feature)
- for category "preference", include a machine-readable anchor like "pref:<dimension>=<value>"
- prefer insights that hold across multiple episodes of this conversation`;
```

- [ ] **Step 2: Add `QUESTIONS_SYSTEM`, `parseQuestions`, and full-text episode loading**

Edit `gateway/src/recall/reflection.ts`. Add the following **after** the `REFLECT_SYSTEM` constant (insert before `CATEGORY_TO_TYPE`):

```typescript
const QUESTIONS_SYSTEM = `You are a reflection pre-processor for a coding agent's long-term memory. Given the full-text episodic memories of ONE conversation, propose 2-3 high-salience questions whose answers would yield durable, cross-session insights (recurring failures, generalizable lessons, behavior patterns, conventions).

Do NOT answer the questions. Do NOT summarize the episodes. Return ONLY JSON, no markdown:
{"questions":["<question 1>","<question 2>","<question 3>? (optional)"]}

Rules:
- each question must be answerable from the episodes OR from searching the harmonic index
- prefer "why" and "what pattern" questions over "what happened" questions
- maximum 3 questions; minimum 2`;

/**
 * Parse the Step-1 question-generation response. Returns [] on any failure —
 * caller treats empty as "skip retrieval, proceed to Step 3 directly".
 */
export function parseQuestions(text: string): string[] {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const items = parsed?.questions ?? parsed;
    if (!Array.isArray(items)) return [];
    return items
      .filter((q: any) => typeof q === 'string' && q.trim().length > 0)
      .map((q: any) => String(q).trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}

const EPISODE_VALUE_CAP = 2000;

/**
 * Load the full memory_value of each episode via store.read(id). Falls back to
 * the index-level summary line (`primary_abstraction + cue_anchors`) on any
 * read error, so one missing file never aborts the batch.
 */
async function loadEpisodesFullText(
  store: HarmonicUnitFileStore,
  episodes: { id: string; text: string }[],
): Promise<{ id: string; text: string }[]> {
  const out: { id: string; text: string }[] = [];
  for (const ep of episodes) {
    try {
      const unit = await store.read(ep.id);
      if (unit?.memory_value) {
        const v = unit.memory_value.length > EPISODE_VALUE_CAP
          ? unit.memory_value.slice(0, EPISODE_VALUE_CAP) + '…'
          : unit.memory_value;
        out.push({ id: ep.id, text: v });
        continue;
      }
    } catch {
      // fall through to summary
    }
    out.push({ id: ep.id, text: ep.text });
  }
  return out;
}
```

- [ ] **Step 3: Rewrite `reflectSession` to the 3-step flow**

Edit `gateway/src/recall/reflection.ts:172-233`. Replace the body of `reflectSession`:

```typescript
  private async reflectSession(sessionID: string, episodes: { id: string; text: string }[]): Promise<ReflectionResult> {
    const result: ReflectionResult = { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, superseded: 0, failed: 0, pendingSessions: 0 };
    if (episodes.length === 0) return result;
    result.reviewed = episodes.length;

    const loaded = await loadEpisodesFullText(this.store, episodes);
    const episodesBlock = loaded.map((e, i) => `${i + 1}. [id=${e.id}] ${e.text}`).join('\n');

    const worker = this.opts.workerFor(sessionID);

    // Step 1: generate high-salience questions
    let questions: string[] = [];
    try {
      const qText = await worker.prompt(episodesBlock, QUESTIONS_SYSTEM, this.opts.workerModel);
      questions = parseQuestions(qText);
    } catch {
      // Hard LLM failure: treat as unreflected (retry next run)
      result.failed++;
      return result;
    }

    // Step 2: retrieval-augmented evidence (per-question, BM25, skip superseded)
    let evidenceBlock = '';
    if (questions.length > 0) {
      try {
        const seen = new Set<string>();
        const lines: string[] = [];
        for (const q of questions) {
          const hits = this.opts.index.searchScored(q, 5, { graphExpand: false });
          for (const h of hits) {
            if ((h.entry as any).superseded_by) continue;
            // skip the episodes we are reflecting over (self-evidence is noise)
            if (loaded.some(e => e.id === h.entry.id)) continue;
            if (seen.has(h.entry.id)) continue;
            seen.add(h.entry.id);
            lines.push(`- [${h.entry.id}] ${h.entry.primary_abstraction}`);
          }
        }
        if (lines.length > 0) {
          evidenceBlock = `\n\n### Related historical memories\n${lines.join('\n')}`;
        }
      } catch {
        // Step 2 never aborts: empty evidence is acceptable
        evidenceBlock = '';
      }
    }

    // Step 3: distill insights with episodes + evidence
    let insights: Insight[] = [];
    try {
      const step3Prompt = evidenceBlock
        ? `${episodesBlock}${evidenceBlock}`
        : episodesBlock;
      const text = await worker.prompt(step3Prompt, REFLECT_SYSTEM, this.opts.workerModel);
      insights = parseInsights(text);
    } catch {
      result.failed++;
      return result; // episodes stay unreflected
    }

    // If Step 1 produced no parseable questions, fall back to a single-call
    // distillation on the full-text prompt — do NOT leave episodes unreflected
    // over a JSON-parse glitch.
    // (No-op here: Step 3 already ran regardless of questions.length.)

    const maxInsights = this.opts.maxInsights ?? 10;
    for (const insight of insights.slice(0, maxInsights)) {
      const classification = this.classifyInsight(insight.content, insight.cue_anchors ?? []);

      if (classification.kind === 'duplicate') {
        result.deduped++;
        continue;
      }

      const now = new Date().toISOString();
      const unit: HarmonicUnit = {
        id: generateHarmonicId(),
        type: CATEGORY_TO_TYPE[insight.category],
        primary_abstraction: insight.content.slice(0, 200),
        cue_anchors: insight.cue_anchors ?? [],
        memory_value: insight.content,
        energy: CATEGORY_ENERGY[insight.category],
        salience: calculateSalience(insight.content),
        abstraction_level: 2,
        created_at: now,
        updated_at: now,
        source_session_id: sessionID === ORPHAN_SESSION ? undefined : sessionID,
      };
      try {
        if (classification.kind === 'conflict' && classification.conflictTarget) {
          this.store.markSuperseded(classification.conflictTarget, unit.id);
          result.superseded++;
        }
        await this.store.write(unit);
        result.distilled++;
      } catch {
        result.failed++;
      }
    }

    if (insights.length > 0) {
      this.opts.cursor.markReflected(sessionID, episodes.map((e) => e.id));
    }
    result.sessions = insights.length > 0 ? 1 : 0;
    return result;
  }
```

- [ ] **Step 4: Update the existing test to the new prompt-count signature**

The existing test `'distills insights from unreflected episodic memories per session'` (reflection.test.ts:62) mocks a single `fakeClient.session.prompt` call. After the 3-step change, **two prompts fire** (Step 1 + Step 3). Update it:

```typescript
  test('distills insights from unreflected episodic memories per session', async () => {
    seedEpisodic('ep-1', 's1');
    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"questions":["what failed?","what pattern?"]}' }] })
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"insights":[{"category":"preference","content":"user prefers pnpm over npm","cue_anchors":["pnpm"]},{"category":"failure","content":"localStorage tokens are XSS-unsafe"}]}' }] });

    const res = await mkPipeline().runAll();

    expect(res.sessions).toBe(1);
    expect(res.reviewed).toBe(1);
    expect(res.distilled).toBe(2);
    expect(fakeClient.session.prompt).toHaveBeenCalledTimes(2);
    const types = index.getIndex().entries.filter((e) => e.type !== 'episodic').map((e) => e.type);
    expect(types.sort()).toEqual(['semantic', 'semantic']);
  });
```

Apply the same two-call mock pattern to `'incremental cursor'`, `'failed reflection'`, `'dedups insights'`, `'insights carry source_session_id'`, and `'runSession reflects only the requested session'` — each must provide both a Step-1 and Step-3 mock.

- [ ] **Step 5: Add new tests for full-text loading, 3-step evidence injection, and question-parse fallback**

Append inside the `ReflectionPipeline` describe block:

```typescript
  test('reflectSession feeds full memory_value, not index summary', async () => {
    // seed an OKF-backed episodic memory
    const { HarmonicUnitFileStore } = require('../../../gateway/src/memory/harmonic-file-store');
    const store = new HarmonicUnitFileStore(tmpDir, index);
    const fullText = 'The user explicitly asked to use pnpm instead of npm because of lockfile reproducibility and workspace speed.';
    await store.write({
      id: 'ep-full',
      type: 'episodic',
      primary_abstraction: 'user prefers pnpm',
      cue_anchors: ['pnpm'],
      memory_value: fullText,
      energy: 0.7,
      salience: 1.0,
      abstraction_level: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_session_id: 's1',
    });
    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"questions":["why pnpm?"]}' }] })
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"insights":[{"category":"preference","content":"user prefers pnpm for reproducibility","cue_anchors":["pnpm","pref:package-manager=pnpm"]}]}' }] });

    await mkPipeline().runAll();

    const step1Prompt = fakeClient.session.prompt.mock.calls[0][0];
    expect(step1Prompt).toContain('The user explicitly asked to use pnpm instead of npm');
    expect(step1Prompt).toContain('ep-full');
  });

  test('Step 3 prompt contains evidence block from searchScored', async () => {
    seedEpisodic('ep-1', 's1');
    // pre-seed a related semantic memory so searchScored returns something
    index.addEntry({
      id: 'mem-rel',
      type: 'semantic',
      primary_abstraction: 'pnpm lockfile is reproducible across machines',
      cue_anchors: ['pnpm'],
      memory_value: 'pnpm lockfile is reproducible across machines',
      energy: 0.9,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'semantic');

    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"questions":["why pnpm?"]}' }] })
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"insights":[{"category":"convention","content":"pnpm for reproducibility","cue_anchors":["pnpm"]}]}' }] });

    await mkPipeline().runAll();

    const step3Prompt = fakeClient.session.prompt.mock.calls[1][0];
    expect(step3Prompt).toContain('### Related historical memories');
    expect(step3Prompt).toContain('mem-rel');
  });

  test('Step 1 parse failure falls through to Step 3 (no evidence), still distills', async () => {
    seedEpisodic('ep-1', 's1');
    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: 'totally not JSON and no questions field' }] })
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"insights":[{"category":"insight","content":"graceful fallback works","cue_anchors":["fb"]}]}' }] });

    const res = await mkPipeline().runAll();
    expect(res.distilled).toBe(1);
    // Step 3 prompt must NOT contain evidence block
    const step3Prompt = fakeClient.session.prompt.mock.calls[1][0];
    expect(step3Prompt).not.toContain('### Related historical memories');
  });

  test('Step 3 hard failure leaves episodes unreflected (retry next run)', async () => {
    seedEpisodic('ep-1', 's1');
    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"questions":["q1","q2"]}' }] })
      .mockRejectedValueOnce(new Error('serve down'));

    const res = await mkPipeline().runAll();
    expect(res.failed).toBe(1);
    expect(cursor.reflectedIds('s1').has('ep-1')).toBe(false);

    // retry succeeds
    fakeClient.session.prompt
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"questions":["q1"]}' }] })
      .mockResolvedValueOnce({ parts: [{ type: 'text', text: '{"insights":[{"category":"insight","content":"recovered","cue_anchors":["r"]}]}' }] });
    const res2 = await mkPipeline().runAll();
    expect(res2.distilled).toBe(1);
  });

  test('REFLECT_SYSTEM contains cross-turn declaration; TOOL_EXTRACTION_SYSTEM contains factual-layer', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const reflectSrc = readFileSync(path.join(__dirname, '../../../gateway/src/recall/reflection.ts'), 'utf-8');
    const turnSrc = readFileSync(path.join(__dirname, '../../../gateway/src/recall/turn-pipeline.ts'), 'utf-8');
    expect(reflectSrc).toMatch(/cross-turn|higher-order/);
    expect(turnSrc).toMatch(/事实层|factual layer/);
  });
```

- [ ] **Step 6: Run tests to verify**

Run: `npx jest tests/unit/recall/reflection.test.ts`
Expected: all existing + new tests PASS.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/recall/reflection.ts tests/unit/recall/reflection.test.ts
git commit -m "feat(reflect): 3-step Generative Agents flow + full-text input + division-of-labor"
```

---

### Task 4: turnCompress prompt — division-of-labor + importance scoring guidance

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts:36-53`

**Interfaces:**
- Consumes: nothing new.
- Produces: updated `TOOL_EXTRACTION_SYSTEM` with factual-layer declaration and importance scoring rubric.

- [ ] **Step 1: Update `TOOL_EXTRACTION_SYSTEM` prompt**

Edit `gateway/src/recall/turn-pipeline.ts:36-53`. Replace the constant with:

```typescript
const TOOL_EXTRACTION_SYSTEM = `You are the FACTUAL-LAYER stage of a two-tier memory system. Your job is to record THIS session's concrete facts, decisions, preferences, events, and specific technical pitfalls. Do NOT generalize across sessions or extract recurring patterns — that is the daily reflection pipeline's job, and it runs on the episodic memories you write here.

Use the mafw_add_memory tool to save every entry worth remembering long-term:
- semantic: durable facts, decisions, preferences, user constraints
- episodic: what happened (task narratives, outcomes)
- procedural: reusable lessons, patterns, mistakes to avoid (specific to THIS session's tech stack)

Every memory MUST carry an explicit importance score (1-10):
- 1-3: routine events, small observations, transient context
- 4-6: normal facts, standard decisions, common pitfalls
- 7-8: significant decisions, non-obvious lessons, user-stated constraints
- 9-10: architectural decisions, severe incidents, user-explicit "always/never" rules

Rules:
- one memory per mafw_add_memory call; memory_value concise; attach cue_anchors keywords
- always pass importance (integer 1-10); do not rely on regex fallback
- every cue_anchors list MUST include the topic entity names (project, module, person, API, feature)
- for preferences or constraints, include a machine-readable anchor like "pref:<dimension>=<value>" in addition to the entity
- skip redundant or trivial content; do not repeat entries that are obviously already known
- if nothing is worth saving, do not call the tool

Before writing preference/fact memories (semantic type), ALWAYS search for similar existing memories first using mafw_search_hybrid. If you find an existing memory that covers the same fact but with an outdated value (e.g., "my car is X" → now "my car is Y"), use the supersedes field in mafw_add_memory to link the old memory ID. If the user explicitly retracts a fact, use mafw_supersede_memory.

After processing, ALWAYS end your response with exactly one of these lines:
- [EXTRACTED: N] — where N is the number of mafw_add_memory calls you made
- [NOOP: reason] — if nothing was worth saving, give a one-sentence reason
This line MUST be the very last line of your response.`;
```

- [ ] **Step 2: Add a source-level assertion test**

Append to the existing `TOOL_EXTRACTION_SYSTEM`-covering test file (or create a new one at `tests/unit/recall/turn-pipeline-prompt.test.ts` if none exists):

```typescript
import * as fs from 'fs';
import * as path from 'path';

describe('TOOL_EXTRACTION_SYSTEM prompt contract', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../gateway/src/recall/turn-pipeline.ts'),
    'utf-8',
  );

  test('declares factual-layer scope', () => {
    expect(src).toMatch(/FACTUAL-LAYER|factual layer|事实层/);
  });

  test('explicitly defers cross-session generalization', () => {
    expect(src).toMatch(/Do NOT generalize across sessions|不要做跨会话/);
  });

  test('contains importance 1-10 rubric', () => {
    expect(src).toMatch(/importance.*1-10|1-10.*importance/);
    expect(src).toMatch(/9-10:/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest tests/unit/recall/turn-pipeline-prompt.test.ts`
Expected: PASS.

- [ ] **Step 4: Build to confirm gateway compiles**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all green, no regressions from Tasks 1-3.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts tests/unit/recall/turn-pipeline-prompt.test.ts
git commit -m "feat(turn-compress): factual-layer declaration + importance 1-10 rubric"
```

---

### Task 5: global install sync + smoke test

**Files:** none modified.

- [ ] **Step 1: Build, pack, install globally**

```bash
npm run build
npm pack
npm install -g opencode-plugin-mafw-*.tgz
```

- [ ] **Step 2: Verify the new tool schema exposes `importance`**

```bash
mafw version
```

Expected: reports the bumped version (or same version) without errors.

- [ ] **Step 3: Smoke test via a one-shot HTTP call against a running gateway**

Start the gateway (`mafw start` in another terminal), then:

```powershell
$body = '{"content":"smoke-test fact","memoryType":"semantic","cueAnchors":["smoke"],"importance":8}'
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:3000/api/memory/add" `
  -ContentType "application/json" -Body $body
```

Expected: `{ "success": true, "id": "mem_..." }`. Then `mafw stats` (or `GET /api/memory/search?q=smoke`) should show a semantic entry with salience ≈ `0.5 + 7/9 ≈ 1.278`.

- [ ] **Step 4: Stop the gateway and commit nothing (task is runtime-only)**

```bash
mafw stop
```

---

## Self-Review Checklist (run after drafting)

1. **Spec coverage:**
   - 改动 1 (reflect full-text): Task 3 Step 2 (`loadEpisodesFullText` + 2000-char cap).
   - 改动 2 (division of labor): Task 3 Step 1 (REFLECT_SYSTEM) + Task 4 Step 1 (TOOL_EXTRACTION_SYSTEM).
   - 改动 3 (3-step Generative Agents): Task 3 Steps 2-3 (QUESTIONS_SYSTEM, parseQuestions, evidence retrieval, reflectSession rewrite).
   - 改动 4 (importance on mafw_add_memory): Task 1 (helper) + Task 2 (plugin schema + HTTP + MCP).
   - 明确不做: no `HarmonicUnit` field additions, no category refactor, no Mem0 logic — confirmed absent from all tasks.
   - Tests in spec: full-text load, 3-step flow, question-parse fallback, importance mapping (HTTP+MCP) — all present.

2. **Placeholder scan:** no TBD / TODO / "implement later" / "similar to" found.

3. **Type consistency:**
   - `importanceToSalience` signature (Task 1) matches call sites in Task 2 (MCP + HTTP) and Task 4 (none, prompt-only).
   - `parseQuestions` signature (Task 3) is pure, matches usage.
   - `loadEpisodesFullText` signature matches `reflectSession` call.
   - `ScoredEntry` has `.entry.id`, `.entry.primary_abstraction`, `.entry.superseded_by` (from `HarmonicIndexEntry`) — used correctly in evidence block.
   - Test file path: `tests/unit/recall/reflection.test.ts` (not `tests/unit/gateway/reflection.test.ts` as the spec mistakenly wrote).

4. **One spec correction applied:** test file path is `tests/unit/recall/reflection.test.ts`, not `tests/unit/gateway/reflection.test.ts`.
