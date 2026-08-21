# merged_from Index Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-repair `merged_from` in `.harmonic_index.json` at gateway startup by reading OKF frontmatter, so the index stays consistent with on-disk files without requiring the manual `scripts/backfill-merged-from.js`.

**Architecture:** Add a `reconcileMergedFrom()` method to `HarmonicIndexManager` that scans index entries missing `merged_from`, reads the corresponding OKF file, extracts the field from YAML frontmatter, and patches the index. Call this at startup (after data-dir migration) following the existing migration pattern.

**Tech Stack:** TypeScript, Node.js fs, js-yaml (already a dependency), existing OKF parser.

## Global Constraints

- Follow existing migration pattern in `gateway/src/index.ts` (try/catch, log result, non-fatal)
- Idempotent: safe to run multiple times, skips entries already having `merged_from`
- No new dependencies; use existing `readOKFFile` from `okf-parser.ts` or inline regex (simpler, avoids full parse)
- Existing standalone `scripts/backfill-merged-from.js` remains as a manual tool (not removed)

---

## Task 1: Add `reconcileMergedFrom()` to `HarmonicIndexManager`

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts:32-67`

**Interfaces:**
- Consumes: `this.index` (loaded `HarmonicIndex`), `this.indexPath` (for dir resolution)
- Produces: `reconcileMergedFrom(): { patched: number; alreadyOk: number; missing: number }`

- [ ] **Step 1: Add the reconcile method after `save()`**

In `gateway/src/core/memory/harmonic-index.ts`, after the `save()` method (line 67), add:

```typescript
  /**
   * Reconcile missing merged_from in index entries by reading OKF frontmatter.
   * Older addEntry() versions omitted this field; the OKF files always had it.
   * Idempotent — skips entries that already carry merged_from.
   */
  reconcileMergedFrom(): { patched: number; alreadyOk: number; missing: number } {
    const result = { patched: 0, alreadyOk: 0, missing: 0 };
    const baseDir = path.dirname(path.dirname(this.indexPath)); // ~/.mafw/memory/.harmonic_index.json → ~/.mafw
    let changed = false;

    for (const entry of this.index.entries) {
      if (entry.merged_from && entry.merged_from.length > 0) {
        result.alreadyOk++;
        continue;
      }
      if (!entry.filePath) { result.missing++; continue; }

      const fullPath = path.join(baseDir, entry.filePath);
      if (!fs.existsSync(fullPath)) { result.missing++; continue; }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const match = content.match(/^merged_from:\s*\n((?:\s+-\s+.+\n?)*)/m);
        if (!match) { result.missing++; continue; }

        const ids = match[1]
          .split('\n')
          .filter(l => l.trim().startsWith('-'))
          .map(l => l.replace(/^\s*-\s+/, '').trim())
          .filter(Boolean);

        if (ids.length > 0) {
          entry.merged_from = ids;
          result.patched++;
          changed = true;
        } else {
          result.missing++;
        }
      } catch {
        result.missing++;
      }
    }

    if (changed) this.save();
    return result;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project gateway/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add gateway/src/core/memory/harmonic-index.ts
git commit -m "feat: add reconcileMergedFrom() to HarmonicIndexManager"
```

---

## Task 2: Call `reconcileMergedFrom()` at gateway startup

**Files:**
- Modify: `gateway/src/index.ts:370-431` (between data-dir migration and constraints migration)

**Interfaces:**
- Consumes: The `HarmonicIndexManager` instance (created later during service init; but we can run reconcile standalone using the same path logic)
- Produces: Startup log line with reconcile results

- [ ] **Step 1: Add startup migration block in `gateway/src/index.ts`**

After the data-dir migration block (line 381, `}`), before the gateway-db migration (line 383), insert:

```typescript
    // 5.0b Reconcile missing merged_from in .harmonic_index.json from OKF
    // frontmatter. Older addEntry() versions omitted this field.
    try {
      const { HarmonicIndexManager } = await import('./core/memory/harmonic-index.js');
      const idxMgr = new HarmonicIndexManager(config.resolvePath());
      const reconcile = idxMgr.reconcileMergedFrom();
      if (reconcile.patched > 0) {
        log.info(`[Scheduler] merged_from reconcile: ${reconcile.patched} patched, ${reconcile.alreadyOk} ok, ${reconcile.missing} missing`);
      }
    } catch (err: any) {
      log.warn(`[Scheduler] merged_from reconcile failed (non-fatal): ${err.message}`);
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project gateway/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run existing tests to confirm no regressions**

Run: `npx jest tests/unit/memory-quality.test.ts --verbose`
Expected: All tests pass, including the existing `merged_from propagation (regression)` suite

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat: auto-reconcile merged_from at gateway startup"
```

---

## Task 3: Add unit test for `reconcileMergedFrom()`

**Files:**
- Modify: `tests/unit/memory-quality.test.ts:214-252` (extend existing regression test)

**Interfaces:**
- Consumes: `HarmonicUnitFileStore`, `HarmonicIndexManager`
- Produces: Test confirming reconcile works on fresh store

- [ ] **Step 1: Add test after existing regression tests**

In `tests/unit/memory-quality.test.ts`, after the existing `should read merged_from from OKF and backfill to index` test (line 252), add:

```typescript
    it('reconcileMergedFrom() patches entries missing merged_from at startup', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const base = 'test knowledge module about react hooks and state management';
      const similar = 'test knowledge module about react hooks and state management patterns';
      const anchors = ['react', 'hooks', 'state'];

      await store.write(unit('mem_src3', base, anchors, 0.8, 1), undefined, { skipMerge: false });
      await store.write(unit('mem_new3', similar, anchors, 0.8, 1), undefined, { skipMerge: false });

      const idx = store.indexManager_().getIndex();
      const entry = idx.entries.find(e => e.id === 'mem_new3');
      const savedMergedFrom = entry!.merged_from;
      expect(savedMergedFrom).toBeDefined();

      // Simulate old index: delete merged_from
      delete (entry as any).merged_from;
      store.indexManager_().save();

      // Create a fresh manager (simulates gateway restart) and run reconcile
      const manager2 = new HarmonicIndexManager(tmpDir);
      const result = manager2.reconcileMergedFrom();
      expect(result.patched).toBeGreaterThanOrEqual(1);

      // Verify the entry is restored
      const idx2 = manager2.getIndex();
      const restored = idx2.entries.find(e => e.id === 'mem_new3');
      expect(restored!.merged_from).toEqual(savedMergedFrom);
    });
```

- [ ] **Step 2: Run the test**

Run: `npx jest tests/unit/memory-quality.test.ts --verbose`
Expected: All tests pass including the new one

- [ ] **Step 3: Commit**

```bash
git add tests/unit/memory-quality.test.ts
git commit -m "test: add reconcileMergedFrom unit test"
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit --project gateway/tsconfig.json` — no type errors
- [ ] `npx jest tests/unit/memory-quality.test.ts --verbose` — all tests pass
- [ ] `npx jest tests/unit/harmonic-e2e.test.ts --verbose` — no regressions
- [ ] Manual: verify `scripts/backfill-merged-from.js` still works independently
