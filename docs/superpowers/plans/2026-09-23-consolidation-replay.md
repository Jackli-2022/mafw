# 巩固层 · 回放（Consolidation Replay）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `TurnPipeline.runSession` 主动召回跨会话相关旧记忆并注入 worker prompt，使 curator 判 UPDATE/合并/矛盾而非只 CREATE（CLS interleaved replay 的非参数近似）。

**Architecture:** 在 `turn-pipeline.ts` 新增两个纯函数 `priorKnowledgeFor`（索引召回，跨会话/非 episodic）与 `priorKnowledgeBlock`（渲染 + 预算截断），在 `runSession` 里拼进 worker prompt，并在 `TOOL_EXTRACTION_SYSTEM` 增一段 supersedes 指令。

**Tech Stack:** TypeScript (CJS)、Jest（`--runInBand`）、现有 `HarmonicIndexManager.searchScored`、`TurnPipeline`。

**Spec:** `docs/superpowers/specs/2026-09-23-consolidation-replay-design.md`

## Global Constraints

- fail-open：召回/渲染失败不得阻塞 turnCompress（worker prompt 照常发）。
- 预算：`replayK` 默认 5、`replayMaxChars` 默认 1500。
- 排除本会话（`source_session_id !== sessionID`）与 episodic。
- 不改存储；不改 L2/评测。
- 测试命令在 `gateway/` 下执行。

---

## File Structure

- **Modify** `gateway/src/recall/turn-pipeline.ts` — 两个纯函数 + `TurnPipelineOptions` 新字段 + `runSession` 注入 + prompt 段落。
- **Modify** `gateway/src/index.ts` — `getTurnPipeline()` 传 `replayK`/`replayMaxChars`（可选，缺省用默认）。
- **Create** `gateway/tests/unit/turn-pipeline-replay.test.ts`

---

### Task 1: 召回 + 渲染纯函数

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`
- Test: `gateway/tests/unit/turn-pipeline-replay.test.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager.searchScored(query, topK, opts)`, `HarmonicIndexEntry`。
- Produces:
  - `priorKnowledgeFor(index: HarmonicIndexManager, sessionID: string, query: string, k: number): HarmonicIndexEntry[]`
  - `priorKnowledgeBlock(entries: HarmonicIndexEntry[], maxChars: number): string`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/turn-pipeline-replay.test.ts`:

```ts
import { priorKnowledgeFor, priorKnowledgeBlock } from '../../src/recall/turn-pipeline';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, sessionId: string, type = 'semantic'): HarmonicUnit {
  const now = new Date().toISOString();
  return { id, type, primary_abstraction: abstraction, cue_anchors: ['kubernetes', 'deploy'], memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now, source_session_id: sessionId } as HarmonicUnit;
}

describe('priorKnowledgeFor', () => {
  test('召回跨会话相关记忆，排除本会话与 episodic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('a', 'kubernetes deployment rollout steps', 'other-session'), 'semantic');
    index.addEntry(unit('b', 'kubernetes deployment narrative', 'other-session', 'episodic'), 'episodic');
    index.addEntry(unit('c', 'kubernetes deployment current', 's1'), 'semantic');
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 5);
    const ids = out.map(e => e.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b'); // episodic 排除
    expect(ids).not.toContain('c'); // 本会话排除
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('k<=0 或空 query 返回空', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    const index = new HarmonicIndexManager(dir);
    expect(priorKnowledgeFor(index, 's1', 'q', 0)).toEqual([]);
    expect(priorKnowledgeFor(index, 's1', '  ', 5)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('priorKnowledgeBlock', () => {
  test('渲染 id + 摘要，超预算截断', () => {
    const entries = [
      { id: 'm1', primary_abstraction: 'first' },
      { id: 'm2', primary_abstraction: 'second' },
    ] as any;
    const block = priorKnowledgeBlock(entries, 1000);
    expect(block).toContain('m1');
    expect(block).toContain('reconcile');
    const tiny = priorKnowledgeBlock(entries, 12);
    expect(tiny === '' || (tiny.includes('m1') && !tiny.includes('m2'))).toBe(true);
  });

  test('空数组返回空串', () => {
    expect(priorKnowledgeBlock([], 1000)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: FAIL — `priorKnowledgeFor is not a function`

- [ ] **Step 3: Implement**

In `gateway/src/recall/turn-pipeline.ts`, add the import and the two functions (after `sessionContext`, ~line 110):

```ts
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';

/**
 * Cross-session related prior memories for interleaved replay (CLS): retrieve by
 * the new transcript, drop the current session and episodic narratives, keep the
 * top-k semantic/procedural entries. Fail-open: returns [] on any error.
 */
export function priorKnowledgeFor(
  index: HarmonicIndexManager,
  sessionID: string,
  query: string,
  k: number,
): HarmonicIndexEntry[] {
  if (k <= 0 || !query.trim()) return [];
  try {
    return index
      .searchScored(query, k * 3, { retriever: 'bm25', graphExpand: true })
      .map((s) => s.entry)
      .filter((e) => e.source_session_id !== sessionID)
      .filter((e) => e.type !== 'episodic')
      .filter((e) => !e.superseded_by)
      .slice(0, k);
  } catch {
    return [];
  }
}

/** Render prior knowledge as a budgeted "reconcile" block (empty when nothing fits). */
export function priorKnowledgeBlock(entries: HarmonicIndexEntry[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- [${e.id}] ${e.primary_abstraction}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return `Prior knowledge from other work (reconcile — update/merge/supersede rather than duplicate):\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/tests/unit/turn-pipeline-replay.test.ts
git commit -m "feat(gateway): 回放——跨会话 prior knowledge 召回与渲染"
```

---

### Task 2: 注入 runSession + prompt 指令 + wiring

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（`TurnPipelineOptions` + `runSession` + `TOOL_EXTRACTION_SYSTEM`）
- Modify: `gateway/src/index.ts`（`getTurnPipeline()`）
- Test: `gateway/tests/unit/turn-pipeline-replay.test.ts`（追加集成用例）

**Interfaces:**
- Consumes: Task 1 的两个函数。
- Produces: `TurnPipelineOptions.replayK?: number`、`TurnPipelineOptions.replayMaxChars?: number`。

- [ ] **Step 1: Write the failing integration test**

Append to `gateway/tests/unit/turn-pipeline-replay.test.ts` (extend the existing `turn-pipeline` import on line 1 instead of re-importing):

```ts
import { TurnPipeline, TOOL_EXTRACTION_SYSTEM, priorKnowledgeFor, priorKnowledgeBlock } from '../../src/recall/turn-pipeline';

describe('TurnPipeline replay injection', () => {
  test('runSession prompt 含跨会话 prior knowledge 块', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-int-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('other', 'kubernetes deployment prior decision', 'other-session'), 'semantic');

    let captured = '';
    const fakeWorker = { prompt: async (p: string) => { captured = p; return '[NOOP: test]'; } };
    const fakeDb = {
      listTurns: () => [{ session_id: 's1', turn_id: 1, count: 2, has_user_input: 1, response_count: 1, last_ts: 0 }],
      readTurn: () => [{ source: 'user_input', content: 'kubernetes deployment question' }],
      archiveTurn: () => {},
      logNoop: () => {},
    } as any;

    const pipeline = new TurnPipeline({
      t1db: fakeDb,
      index,
      workerFor: () => fakeWorker as any,
      staleMs: 0,
      replayK: 5,
      replayMaxChars: 1500,
    });
    await pipeline.runSession('s1');
    expect(captured).toContain('Prior knowledge from other work');
    expect(captured).toContain('[other]');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('TOOL_EXTRACTION_SYSTEM 含 reconcile 指令', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toContain('Prior knowledge from other work');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: FAIL — prompt 不含 prior knowledge 块

- [ ] **Step 3: Implement**

In `turn-pipeline.ts`:

1. `TurnPipelineOptions` 新增字段：
```ts
  /** Interleaved replay: cross-session prior-knowledge recall into the worker prompt. */
  replayK?: number;
  replayMaxChars?: number;
```
2. `runSession` 的 prompt 拼装（当前 `const prompt = grade ? ... : base;`）改为：
```ts
      const prior = priorKnowledgeFor(this.opts.index, sessionID, transcript, this.opts.replayK ?? 5);
      const priorBlock = priorKnowledgeBlock(prior, this.opts.replayMaxChars ?? 1500);
      const grade = this.opts.gradeFor?.(sessionID);
      const gradeBlock = grade
        ? `Outcome feedback for this session's recent work (a signal about trajectory reliability, not proof of correctness):\n${grade}`
        : '';
      const prompt = [base, priorBlock, gradeBlock].filter(Boolean).join('\n\n');
```
3. `TOOL_EXTRACTION_SYSTEM` 在现有 supersedes 段（`...mafw_supersede_memory to mark the old memory as outdated without writing a replacement.`）之后插入：
```
When "Prior knowledge from other work" is provided: compare each new insight against it. If a new insight updates or contradicts an existing memory, call mafw_add_memory with supersedes: [that id] (or mafw_supersede_memory to retract without replacement) — do not create a duplicate. If prior knowledge is unrelated, ignore it.
```
4. `index.ts` `getTurnPipeline()` 传入默认（可省略；显式写以留钩子）：
```ts
      replayK: 5,
      replayMaxChars: 1500,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: PASS (6 tests)

- [ ] **Step 5: Build + full suite**

Run: `npm run build && npx jest --runInBand`
Expected: build exit 0；全绿

- [ ] **Step 6: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/index.ts gateway/tests/unit/turn-pipeline-replay.test.ts
git commit -m "feat(gateway): 回放注入 runSession + reconcile 指令"
```

---

## Self-Review

- **Spec §3.1 召回** → Task 1 `priorKnowledgeFor` ✅
- **Spec §3.2 渲染** → Task 1 `priorKnowledgeBlock` ✅
- **Spec §3.3 注入** → Task 2 Step 3.2 ✅
- **Spec §3.4 prompt 指令** → Task 2 Step 3.3 ✅
- **Spec §4 配置** → Task 2 Step 3.1/3.4（options 默认 + index 传值）✅
- **Spec §5 测试** → Task 1 + Task 2 ✅
- Placeholder：无。
- 类型一致性：`priorKnowledgeFor`/`priorKnowledgeBlock` 签名跨 Task 一致；`HarmonicIndexEntry` 从 `harmonic-types` 引入。

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-23-consolidation-replay.md`. 执行方式：① Subagent-Driven ② Inline。选哪个？
