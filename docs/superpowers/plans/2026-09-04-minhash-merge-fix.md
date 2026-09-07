# MinHash 合并修复 + 存量合体清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MinHash 签名哈希多样性失效导致的连环误合并（76% 记忆变成 `|` 合体），收敛合并行为（去 energy 加成、memory_value 上限），并写清理脚本还原已合并的历史记忆。

**Architecture:** 重写 `MinHashMerger.generateSignature` 为 FNV-1a 双哈希（Kirsch–Mitzenmacher），32 签名、阈值 0.7；合并比较改为段级（blob 按 ` | ` 切分取 max sim），解决稀释效应；存量清理由纯函数 planner（可单测）+ ts-node CLI（dry-run 默认）组成。

**Tech Stack:** TypeScript, jest (ts-jest), js-yaml, ts-node。

## Global Constraints

- 工作目录 `C:\work\work-loop\opencode-plugin-mafw`，直接在 master 分支 inline 执行（用户既定工作流）。
- Gateway 测试命令：`cd gateway; npx jest tests/unit/<file> --runInBand --forceExit`（`--forceExit` 必须，fs.watch 会挂住进程）。
- Gateway 构建：`cd gateway; npm run build`（tsc）。
- 签名只在使用时现算，不持久化——改算法无需迁移索引。
- reflection.ts 的 classifyInsight 阈值（0.6 duplicate / 0.4 conflict）保持不变。
- 不提交与本任务无关的文件（ChatPane.tsx、UsageDock.tsx、usage-poller.ts 有未提交的其他改动，严禁带入）。

## 已验证的算法预期值（node 模拟，作为测试断言依据）

| 文本对 | 旧算法 sim | 新算法 sim (32 签名) |
|---|---|---|
| `...guardrails` vs `...guardrails enabled`（近重复） | — | 0.969 |
| memory-curator 定义 vs opencode serve sidecar（无关） | — | 0.063 |
| `gateway 部署流程需要全局安装` vs `gateway 的媒体插件热加载机制` | **1.000（误合并）** | 0.313 |
| `mafw 记忆系统检索排序` vs `mafw 桌面端截图功能` | **1.000（误合并）** | 0.063 |
| `opencode 插件权限配置` vs `opencode 主题颜色设置` | 1.000 | 0.375 |
| `用户偏好中文回复` vs `今天天气很好适合出门散步` | 0.000 | 0.000 |
| 7 条 Android 近重复写入（段级匹配全链路模拟） | 全滚成一个合体 | **2 条活跃**（符合现有回归测试 ≤2 预期） |

---

### Task 1: 重写 generateSignature（双哈希 MinHash）+ 段级匹配

**Files:**
- Modify: `gateway/src/core/memory/minhash-merger.ts`（全文重写核心方法）
- Test: `gateway/tests/unit/minhash-merger.test.ts`

**Interfaces:**
- Produces:
  - `MinHashMerger.segmentsOf(text: string): string[]`（static，按 ` | ` 切分）
  - `merger.maxSimilarityToText(sig: number[], text: string): number`（段级 max sim，Task 3 的 reflection 使用）
  - `generateSignature` 输出长度从 8 变为 **32**

**背景（为什么重写）：** 旧实现 `hash = hash*31 + charCode + seed`，seed 加在循环内对 hash 影响 ≤21，而字符码点决定数量级（CJK ~2万+，ASCII ~100），导致 8 个"独立"哈希全部退化为「码点最小 shingle」的同一选择——任何两条共享英文词（如 gateway）的记忆 sim=1.0 被误合并。实测线上 3015 条索引 2288 条是合体。

- [ ] **Step 1: 更新失败测试**

修改 `gateway/tests/unit/minhash-merger.test.ts`：

1. `produces 8-element signature` 改为：

```typescript
    test('produces 32-element signature', () => {
      const sig = merger.generateSignature('memory-curator agent definition');
      expect(sig).toHaveLength(32);
    });
```

2. `near-variant texts caught by MinHash with 8 seeds` 改为：

```typescript
    test('near-variant texts caught by MinHash', () => {
      const text1 = 'memory-curator agent definition with restricted tool whitelist and security guardrails';
      const text2 = 'memory-curator agent definition with restricted tool whitelist and security guardrails enabled';

      const sig1 = merger.generateSignature(text1);
      const sig2 = merger.generateSignature(text2);
      const sim = merger.similarity(sig1, sig2);
      expect(sim).toBeGreaterThan(0.7); // 实测 0.969
    });
```

3. `dissimilar texts not caught by MinHash` 断言收紧：

```typescript
      expect(sim).toBeLessThan(0.3); // 实测 0.063
```

4. 新增回归测试（追加到 `describe('similarity')` 块内）：

```typescript
    test('shared English token alone does NOT cause high similarity (blob regression)', () => {
      // 线上事故：这两条曾因共享 "gateway" 被判定 sim=1.0 而误合并
      const a = 'gateway 部署流程需要全局安装';
      const b = 'gateway 的媒体插件热加载机制';
      expect(merger.similarity(merger.generateSignature(a), merger.generateSignature(b))).toBeLessThan(0.5); // 实测 0.313
    });

    test('CJK texts sharing only project name do NOT merge', () => {
      const a = 'mafw 记忆系统检索排序';
      const b = 'mafw 桌面端截图功能';
      expect(merger.similarity(merger.generateSignature(a), merger.generateSignature(b))).toBeLessThan(0.3); // 实测 0.063
    });
```

5. 新增段级匹配测试（追加到 `describe('merge - exact duplicate detection')` 块内，复用该 describe 的 `makeMockIndex`）：

```typescript
    test('duplicate of one segment of a merged blob still matches (anti-dilution)', async () => {
      const index = makeMockIndex([{
        id: 'blob_1',
        pa: 'alpha unique fact about zebra crossings | memory-curator agent definition',
      }]);
      const store = {
        read: async (id: string) => ({
          id, type: 'semantic' as const,
          primary_abstraction: 'alpha unique fact about zebra crossings | memory-curator agent definition',
          cue_anchors: [], memory_value: 'blob content', energy: 0.8,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }),
        deleteSync: () => true,
        markSuperseded: () => true,
      };
      const unit = {
        id: 'new_dup', type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition',
        cue_anchors: [], memory_value: 'content', energy: 0.8,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toContain('blob_1');
    });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway; npx jest tests/unit/minhash-merger.test.ts --runInBand --forceExit`
Expected: FAIL — `produces 32-element signature`（实际 8）、`near-variant`（0.969 > 0.7 旧算法可能也过，但 32 长度断言必失败）、两个新回归测试失败。

- [ ] **Step 3: 重写 minhash-merger.ts**

替换 `gateway/src/core/memory/minhash-merger.ts` 的类常量与 `generateSignature`，并给 `merge()` 加段级匹配。完整新文件内容（保留未提及的部分不变，以下为变更点全集）：

```typescript
import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export class MinHashMerger {
  private signatureSize: number = 32;
  private threshold: number = 0.7;
  private maxMergeChars: number = 500;
  private maxMergeDepth: number = 10;

  static normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Split a (possibly merged) abstraction into its ' | ' segments. */
  static segmentsOf(text: string): string[] {
    return text.split(' | ');
  }

  /** FNV-1a 32-bit. */
  private static hashForward(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** FNV-1a over the reversed string, forced odd (second independent hash). */
  private static hashReverse(s: string): number {
    let h = 0x811c9dc5;
    for (let i = s.length - 1; i >= 0; i--) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h | 1) >>> 0;
  }

  /**
   * MinHash signature via double hashing (Kirsch–Mitzenmacher): two
   * independent FNV-1a hashes per shingle generate signatureSize values
   * h_k = (h1 + k*h2) mod 2^32. Replaces the old `hash*31 + charCode + seed`
   * scheme whose in-loop seed was negligible next to char codepoints — all
   * "independent" hashes degenerated to picking the same lowest-codepoint
   * shingle, so any two memories sharing one English token (e.g. "gateway")
   * scored similarity 1.0 and were wrongly merged.
   */
  generateSignature(text: string): number[] {
    const normalized = MinHashMerger.normalizeForDedup(text);
    const sig = new Array<number>(this.signatureSize).fill(Number.MAX_SAFE_INTEGER);
    let found = false;
    for (let i = 0; i + 3 <= normalized.length; i++) {
      const shingle = normalized.slice(i, i + 3);
      const h1 = MinHashMerger.hashForward(shingle);
      const h2 = MinHashMerger.hashReverse(shingle);
      found = true;
      for (let k = 0; k < this.signatureSize; k++) {
        const hk = (h1 + Math.imul(k, h2)) >>> 0;
        if (hk < sig[k]) sig[k] = hk;
      }
    }
    return found ? sig : sig.fill(0);
  }

  similarity(sigA: number[], sigB: number[]): number {
    let matches = 0;
    for (let i = 0; i < this.signatureSize; i++) {
      if (sigA[i] === sigB[i]) {
        matches++;
      }
    }
    return matches / this.signatureSize;
  }

  /**
   * Max similarity of a signature against each ' | ' segment of a (possibly
   * merged) text. Merged blobs concatenate segments, which dilutes whole-text
   * Jaccard (a true duplicate of one segment scores ~1/segments against the
   * blob); taking the per-segment max preserves duplicate detection.
   */
  maxSimilarityToText(sig: number[], text: string): number {
    let best = 0;
    for (const seg of MinHashMerger.segmentsOf(text)) {
      const s = this.similarity(sig, this.generateSignature(seg));
      if (s > best) best = s;
    }
    return best;
  }

  // ... merge() 及以下保持原有结构，仅改比较逻辑（见下） ...
}
```

`merge()` 方法中，替换原来的 exactMatch / sim 计算（旧代码 84-89 行）为段级版本：

```typescript
      const exactMatch = normalizedNew.length > 0
        && MinHashMerger.segmentsOf(entry.primary_abstraction)
          .some(seg => MinHashMerger.normalizeForDedup(seg) === normalizedNew);

      const sim = exactMatch ? 1.0 : this.maxSimilarityToText(sig, entry.primary_abstraction);
```

`dedupMerge` 增加「段已存在则不追加」防退化（替换原方法）：

```typescript
  private dedupMerge(a: string, b: string): string {
    const normA = MinHashMerger.normalizeForDedup(a);
    const normB = MinHashMerger.normalizeForDedup(b);
    if (normA === normB) return a;
    // If a is already one of b's segments, keep b unchanged (prevents
    // identical-duplicate writes from growing the blob with repeat segments).
    for (const seg of MinHashMerger.segmentsOf(b)) {
      if (MinHashMerger.normalizeForDedup(seg) === normA) return b;
    }
    return `${a} | ${b}`;
  }
```

注意：`merge()` 顶部仍保留 `if (unit.merged_from?.length) return unit;` 防递归、superseded 跳过、`maxMergeDepth` 跳过、`maxMergeChars` 上限、pinned 继承、`markSuperseded` 调用——均不变。`maxMergeDepth` 保持 10（合体仍可作为合并目标，否则完全重复的持续写入无法归并——由修复后的哈希 + 段级匹配保证只有真重复才合并）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd gateway; npx jest tests/unit/minhash-merger.test.ts --runInBand --forceExit`
Expected: PASS（全部）

同时跑回归套件：
Run: `cd gateway; npx jest tests/unit/minhash-dedup-regression.test.ts --runInBand --forceExit`
Expected: PASS（7 条 Android 近重复 → ≤2 活跃，已经离线模拟验证；`maxMergeDepth` 测试走 exactMatch 路径不受阈值影响）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/minhash-merger.ts gateway/tests/unit/minhash-merger.test.ts
git commit -m "fix(memory): rewrite MinHash with double hashing to stop false-positive merges

The old in-loop seed (hash*31 + charCode + seed) was negligible vs char
codepoints, collapsing all 8 'independent' hashes to the same
lowest-codepoint shingle. Any two memories sharing one English token
(e.g. gateway) scored similarity 1.0 and merged — 76% of the production
index became ' | '-joined mega blobs. Now: FNV-1a forward+reverse with
Kirsch-Mitzenmacher double hashing, 32 signatures, threshold 0.7, and
segment-wise matching so merged blobs don't dilute duplicate detection."
```

---

### Task 2: 合并行为收敛（去 energy 加成 + memory_value 2000 字符上限）

**Files:**
- Modify: `gateway/src/core/memory/minhash-merger.ts`（merge 循环 1 行 + mergeValues）
- Test: `gateway/tests/unit/minhash-dedup-regression.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MinHashMerger`。
- Produces: `mergeValues` 输出 ≤ 2000 字符；合并不再改变 result.energy。

**背景：** 每次合并 `energy +0.15` 造成"合体越大越显眼"的正反馈（实测合体 energy 均值 0.605 vs 普通 0.513，最高 1.0），StepInject 反复选中。`mergeValues` 无上限，实测合体 value 累积 5+ 个无关主题段。

- [ ] **Step 1: 写失败测试**

追加到 `gateway/tests/unit/minhash-dedup-regression.test.ts` 末尾（文件最后一个 `});` 之前）：

```typescript
  describe('merge behavior caps', () => {
    test('merge does NOT boost energy (no snowball feedback)', async () => {
      const store = new HarmonicUnitFileStore(dir);
      await store.write(makeUnit({ id: 'mem_e1', primary_abstraction: 'energy cap test fact alpha', memory_value: 'v1', energy: 0.8 }));
      await store.write(makeUnit({ id: 'mem_e2', primary_abstraction: 'energy cap test fact alpha', memory_value: 'v2', energy: 0.8 }));
      const active = store.indexManager_().getIndex().entries.filter((e: any) => !e.superseded_by);
      expect(active.length).toBe(1);
      expect(active[0].energy).toBe(0.8); // 旧实现会变成 0.95
    });

    test('mergeValues caps total length at 2000 chars, keeping newest content intact', () => {
      const merger = new MinHashMerger();
      const newer = 'N'.repeat(1500);
      const section = (tag: string) => `${tag}${'x'.repeat(300)}`;
      const older = `${section('A')}\n---\n[Updated 2026-01-01] ${section('B')}\n---\n[Updated 2026-01-02] ${section('C')}`;
      const result = (merger as any).mergeValues(newer, older, '2026-09-04T00:00:00.000Z');
      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.startsWith(newer)).toBe(true);
      expect(result).toContain('[Updated 2026-09-04T00:00:00.000Z]');
      expect(result).toContain('A' + 'x'.repeat(300)); // 最新旧段完整保留
    });

    test('mergeValues keeps full older value when under cap', () => {
      const merger = new MinHashMerger();
      const result = (merger as any).mergeValues('new', 'old', '2026-09-04T00:00:00.000Z');
      expect(result).toBe('new\n---\n[Updated 2026-09-04T00:00:00.000Z] old');
    });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/minhash-dedup-regression.test.ts --runInBand --forceExit`
Expected: FAIL — `energy` 断言（实际 0.95）、`mergeValues caps`（实际长度 1500+1200+ > 2000）。

- [ ] **Step 3: 实现**

`gateway/src/core/memory/minhash-merger.ts`：

1. 类常量加一行：

```typescript
  private maxMergedValueChars: number = 2000;
```

2. `merge()` 循环内**删除**这一行（约 110 行）：

```typescript
        result.energy = Math.min(1.0, result.energy + 0.15);
```

3. 替换 `mergeValues`：

```typescript
  private mergeValues(newerValue: string, olderValue: string, updatedAt?: string): string {
    if (newerValue === olderValue) return newerValue;
    const header = updatedAt ? `[Updated ${updatedAt}] ` : '[Updated] ';
    const sep = `\n---\n${header}`;
    const budget = this.maxMergedValueChars - newerValue.length - sep.length;
    if (budget <= 0) return newerValue;
    let kept = olderValue.length <= budget ? olderValue : olderValue.slice(0, budget);
    if (kept.length < olderValue.length) {
      // Cut at the last section boundary so we never leave a truncated section.
      const lastBoundary = kept.lastIndexOf('\n---\n');
      if (lastBoundary > 0) kept = kept.slice(0, lastBoundary);
    }
    return `${newerValue}${sep}${kept}`;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/minhash-dedup-regression.test.ts tests/unit/minhash-merger.test.ts --runInBand --forceExit`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/minhash-merger.ts gateway/tests/unit/minhash-dedup-regression.test.ts
git commit -m "fix(memory): remove merge energy boost and cap merged memory_value at 2000 chars

The +0.15 energy per merge created a snowball (blobs ranked ever higher,
mean 0.605 vs 0.513), and unbounded '---' value accumulation produced
multi-topic Frankenstein documents that then fed the reflection pipeline."
```

---

### Task 3: reflection classifyInsight 段级匹配

**Files:**
- Modify: `gateway/src/recall/reflection.ts:170-197`（classifyInsight）
- Test: `gateway/tests/unit/reflection-classify.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `MinHashMerger.segmentsOf()`。

**背景：** classifyInsight 用整条 `primary_abstraction` 算签名；合体条目稀释相似度（真重复对 3 段合体 sim≈0.33 < 0.6），duplicate 判定失效。阈值（0.6/0.4）不变。

- [ ] **Step 1: 写失败测试**

新建 `gateway/tests/unit/reflection-classify.test.ts`：

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline } from '../../src/recall/reflection';

function makeMockIndex(entries: Array<{ id: string; pa: string; anchors?: string[]; superseded?: boolean }>) {
  return {
    getIndex: () => ({
      version: 2,
      updated_at: new Date().toISOString(),
      entries: entries.map(e => ({
        id: e.id,
        type: 'semantic' as const,
        primary_abstraction: e.pa,
        cue_anchors: e.anchors ?? [],
        tier: 'semantic',
        energy: 0.8,
        filePath: `concepts/semantic/${e.id}.md`,
        created_at: new Date().toISOString(),
        superseded_by: e.superseded ? 'some_id' : undefined,
      })),
    }),
    save: () => {},
  };
}

function makePipeline(index: any): ReflectionPipeline {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-reflect-'));
  return new ReflectionPipeline({
    index,
    baseDir: dir,
    workerFor: () => { throw new Error('not used in classify tests'); },
    cursor: { isReflected: () => false, markReflected: () => {}, prune: () => {} } as any,
  });
}

describe('ReflectionPipeline.classifyInsight', () => {
  test('exact duplicate of an existing entry → duplicate', () => {
    const index = makeMockIndex([{ id: 's1', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码' }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', []);
    expect(result.kind).toBe('duplicate');
  });

  test('duplicate of one segment of a merged blob → duplicate (anti-dilution)', () => {
    const index = makeMockIndex([{
      id: 'blob1',
      pa: 'Rail 指挥台重设计完成 | gateway 部署需要 npm install 全局安装再走 restart 令牌 | UsageDock 显示名映射修复',
    }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('gateway 部署需要 npm install 全局安装再走 restart 令牌', []);
    expect(result.kind).toBe('duplicate');
  });

  test('unrelated content → novel', () => {
    const index = makeMockIndex([{ id: 's2', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码' }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('Flutter 的 MaterialApp 主题配置支持 dark mode', []);
    expect(result.kind).toBe('novel');
  });

  test('superseded entries are ignored', () => {
    const index = makeMockIndex([{ id: 's3', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', superseded: true }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', []);
    expect(result.kind).toBe('novel'); // 唯一匹配已被 superseded
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/reflection-classify.test.ts --runInBand --forceExit`
Expected: FAIL — `anti-dilution` 用例得到 `novel`（合体稀释后 sim < 0.6）。

- [ ] **Step 3: 实现**

`gateway/src/recall/reflection.ts`，替换 `classifyInsight` 的循环体（174-184 行）为段级版本：

```typescript
  private classifyInsight(content: string, cueAnchors: string[]): { kind: 'duplicate' | 'conflict' | 'novel'; conflictTarget?: string } {
    const sig = this.merger.generateSignature(content);
    let bestMatch: { id: string; sim: number } | null = null;

    for (const entry of this.opts.index.getIndex().entries) {
      if (entry.type !== 'semantic' && entry.type !== 'procedural') continue;
      if ((entry as any).superseded_by) continue; // skip already-superseded entries
      // Merged blobs concatenate segments with ' | ' — compare per segment
      // so a true duplicate of one segment is not diluted by the rest.
      let sim = 0;
      for (const seg of MinHashMerger.segmentsOf(entry.primary_abstraction)) {
        const other = `${seg} ${(entry.cue_anchors ?? []).join(' ')}`;
        const s = this.merger.similarity(sig, this.merger.generateSignature(other));
        if (s > sim) sim = s;
      }

      if (sim > 0.6) return { kind: 'duplicate' };
      if (sim > 0.4 && sim > (bestMatch?.sim ?? 0)) {
        bestMatch = { id: entry.id, sim };
      }
    }

    // Conflict requires both MinHash in the 0.4-0.6 band AND at least one shared cue_anchor
    if (bestMatch && bestMatch.sim > 0.4) {
      const targetEntry = this.opts.index.getIndex().entries.find(e => e.id === bestMatch!.id);
      const targetAnchors = targetEntry?.cue_anchors ?? [];
      const sharedAnchors = cueAnchors.filter(a => targetAnchors.includes(a));
      if (sharedAnchors.length > 0) {
        return { kind: 'conflict', conflictTarget: bestMatch.id };
      }
    }

    return { kind: 'novel' };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/reflection-classify.test.ts --runInBand --forceExit`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/reflection.ts gateway/tests/unit/reflection-classify.test.ts
git commit -m "fix(memory): segment-wise similarity in reflection classifyInsight

Merged blobs diluted whole-text similarity below the 0.6 duplicate
threshold, letting true duplicates through to the write path."
```

---

### Task 4: 存量清理 planner（纯函数，可单测）

**Files:**
- Create: `gateway/src/memory/unmerge-cleanup.ts`
- Test: `gateway/tests/unit/unmerge-cleanup.test.ts`

**Interfaces:**
- Produces（Task 5 CLI 消费）：

```typescript
export interface CleanupEntry {
  id: string;
  superseded_by?: string;
  merged_from?: string[];
  pinned?: boolean;
  energy?: number;
}
export interface CleanupPlan {
  restore: { id: string; energy: number }[];
  deleteBlobs: string[];
  keepBlobs: { id: string; reason: string }[];
  missingSources: { blobId: string; sourceId: string }[];
}
export function planUnmerge(entries: CleanupEntry[], fileExists: (id: string) => boolean): CleanupPlan;
```

**设计规则（必须精确实现）：**
- blob = `merged_from` 非空的条目
- 闭包展开：blob 的 `merged_from` 若指向另一个 blob（合并链/consolidation 不继承祖先），递归展开其 `merged_from`；中间 blob 不还原、随删除
- 还原条件：源条目存在盘上（`fileExists`）**且**其 `superseded_by` 指向一个将被删除的 blob（绝不触碰显式 knowledge-update 的 supersedes）
- 还原 energy：`min(0.9, max(0.4, energy * 2))`（markSuperseded 每次 ×0.5 下限 0.1，原值不可考，此为确定性近似）
- pinned blob → 保留（reason `pinned`），其源不还原
- 闭包内有源缺失（不在 entries 或文件不在盘上）→ 保留该 blob（reason `missing sources: N`），记录 missingSources，其可还原的源也**不**还原（内容仍由 blob 承载）

- [ ] **Step 1: 写失败测试**

新建 `gateway/tests/unit/unmerge-cleanup.test.ts`：

```typescript
import { planUnmerge, CleanupEntry } from '../../src/memory/unmerge-cleanup';

const existsAll = () => true;

describe('planUnmerge', () => {
  test('simple blob: delete blob, restore direct sources', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S2'] },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
      { id: 'S2', superseded_by: 'B', energy: 0.3 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([
      { id: 'S1', energy: 0.8 },
      { id: 'S2', energy: 0.6 },
    ]);
    expect(plan.keepBlobs).toEqual([]);
  });

  test('chain: intermediate blob is expanded and deleted, leaf sources restored', () => {
    const entries: CleanupEntry[] = [
      { id: 'B2', merged_from: ['B1', 'S2'] },
      { id: 'B1', merged_from: ['S1'], superseded_by: 'B2' },
      { id: 'S1', superseded_by: 'B1', energy: 0.5 },
      { id: 'S2', superseded_by: 'B2', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs.sort()).toEqual(['B1', 'B2']);
    expect(plan.restore.map(r => r.id).sort()).toEqual(['S1', 'S2']);
  });

  test('pinned blob is kept and its sources stay superseded', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'], pinned: true },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.keepBlobs).toEqual([{ id: 'B', reason: 'pinned' }]);
    expect(plan.deleteBlobs).toEqual([]);
    expect(plan.restore).toEqual([]);
  });

  test('missing source keeps the blob and records the gap', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S9'] },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, (id) => id === 'S1'); // S9 文件缺失
    expect(plan.keepBlobs).toEqual([{ id: 'B', reason: 'missing sources: 1' }]);
    expect(plan.missingSources).toEqual([{ blobId: 'B', sourceId: 'S9' }]);
    expect(plan.deleteBlobs).toEqual([]);
    expect(plan.restore).toEqual([]); // S1 不还原，内容仍由 B 承载
  });

  test('source superseded by a non-blob (explicit knowledge update) is NOT restored', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'] },
      { id: 'S1', superseded_by: 'X', energy: 0.4 },
      { id: 'X', energy: 0.8 }, // 普通条目，显式取代 S1
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([]);
  });

  test('live source (not superseded) is left alone', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'] },
      { id: 'S1', energy: 0.7 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([]);
  });

  test('energy restore rule: floor 0.4, cap 0.9', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S2', 'S3'] },
      { id: 'S1', superseded_by: 'B', energy: 0.1 },
      { id: 'S2', superseded_by: 'B', energy: 0.3 },
      { id: 'S3', superseded_by: 'B', energy: 0.48 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.restore).toEqual([
      { id: 'S1', energy: 0.4 },
      { id: 'S2', energy: 0.6 },
      { id: 'S3', energy: 0.9 },
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/unmerge-cleanup.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

新建 `gateway/src/memory/unmerge-cleanup.ts`：

```typescript
// Undo MinHash merge blobs: restore the superseded source units and delete
// the ' | '-concatenated merge products. Pure planning function (no IO) so
// the decision logic is unit-testable; the CLI in scripts/unmerge-blobs.ts
// executes the plan against ~/.mafw/memory.

export interface CleanupEntry {
  id: string;
  superseded_by?: string;
  merged_from?: string[];
  pinned?: boolean;
  energy?: number;
}

export interface CleanupPlan {
  /** Sources to un-supersede, with the energy to set. */
  restore: { id: string; energy: number }[];
  /** Blob unit ids to delete (file + index entry). */
  deleteBlobs: string[];
  /** Blobs kept with a human-readable reason. */
  keepBlobs: { id: string; reason: string }[];
  /** Sources referenced by kept blobs that no longer exist on disk. */
  missingSources: { blobId: string; sourceId: string }[];
}

const isBlob = (e?: CleanupEntry): boolean => !!e && (e.merged_from?.length ?? 0) > 0;

/** Restored energy: markSuperseded halved energy (floor 0.1) per supersede;
 *  the original is unrecoverable, so double with a floor/cap. */
export function restoredEnergy(current: number | undefined): number {
  return Math.min(0.9, Math.max(0.4, (current ?? 0.4) * 2));
}

export function planUnmerge(entries: CleanupEntry[], fileExists: (id: string) => boolean): CleanupPlan {
  const byId = new Map(entries.map(e => [e.id, e]));
  const blobs = entries.filter(isBlob);

  // Expand a blob's merged_from through intermediate blobs (merge chains;
  // consolidation mergeIntoNewer does not inherit ancestors).
  const closureSources = (blob: CleanupEntry): { sources: string[]; missing: string[] } => {
    const sources: string[] = [];
    const missing: string[] = [];
    const seen = new Set<string>([blob.id]);
    const queue = [...(blob.merged_from ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = byId.get(id);
      if (isBlob(e)) {
        queue.push(...(e!.merged_from ?? []));
        continue;
      }
      if (!e || !fileExists(id)) {
        missing.push(id);
        continue;
      }
      sources.push(id);
    }
    return { sources, missing };
  };

  // Pass 1: decide each blob's fate.
  const deleteSet = new Set<string>();
  const blobSources = new Map<string, string[]>();
  const keepBlobs: CleanupPlan['keepBlobs'] = [];
  const missingSources: CleanupPlan['missingSources'] = [];
  for (const blob of blobs) {
    if (blob.pinned) {
      keepBlobs.push({ id: blob.id, reason: 'pinned' });
      continue;
    }
    const { sources, missing } = closureSources(blob);
    if (missing.length > 0) {
      keepBlobs.push({ id: blob.id, reason: `missing sources: ${missing.length}` });
      for (const m of missing) missingSources.push({ blobId: blob.id, sourceId: m });
      continue;
    }
    deleteSet.add(blob.id);
    blobSources.set(blob.id, sources);
  }

  // Pass 2: restore sources superseded by a blob that is being deleted.
  // Never touch units superseded by a live non-blob unit (explicit
  // knowledge-update via mafw_add_memory supersedes / mafw_supersede_memory).
  const restore: CleanupPlan['restore'] = [];
  const restoredIds = new Set<string>();
  for (const blobId of deleteSet) {
    for (const srcId of blobSources.get(blobId)!) {
      if (restoredIds.has(srcId)) continue;
      const src = byId.get(srcId)!;
      if (!src.superseded_by) continue; // still live — nothing to undo
      if (!deleteSet.has(src.superseded_by)) continue; // superseded by something kept
      restoredIds.add(srcId);
      restore.push({ id: srcId, energy: restoredEnergy(src.energy) });
    }
  }

  return { restore, deleteBlobs: [...deleteSet], keepBlobs, missingSources };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/unmerge-cleanup.test.ts --runInBand --forceExit`
Expected: PASS（7 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/unmerge-cleanup.ts gateway/tests/unit/unmerge-cleanup.test.ts
git commit -m "feat(memory): add unmerge cleanup planner (pure function)

Decides which MinHash merge blobs can be safely undone: restores their
superseded sources (energy floor 0.4 / cap 0.9), keeps pinned blobs and
blobs with missing sources, never touches explicit knowledge-update
supersedes."
```

---

### Task 5: 清理 CLI 脚本（dry-run 默认）

**Files:**
- Create: `gateway/scripts/unmerge-blobs.ts`

**Interfaces:**
- Consumes: Task 4 的 `planUnmerge` / `CleanupEntry`。
- 运行方式：`cd gateway; npx ts-node scripts/unmerge-blobs.ts [--apply] [--force]`

**安全设计：**
- 默认 dry-run，只打印计划；`--apply` 才执行
- gateway 运行中会持有索引并覆写——执行前探测 `http://127.0.0.1:3000/health`（1.5s 超时），活着且无 `--force` 则中止
- `--apply` 先备份 `.harmonic_index.json` + `concepts/` 到 `~/.mafw/memory/backup-unmerge-<ISO时间戳>/`

- [ ] **Step 1: 实现脚本**

新建 `gateway/scripts/unmerge-blobs.ts`：

```typescript
// Undo MinHash merge blobs in ~/.mafw/memory (see src/memory/unmerge-cleanup.ts).
//
//   npx ts-node scripts/unmerge-blobs.ts          # dry-run: print plan
//   npx ts-node scripts/unmerge-blobs.ts --apply  # backup + execute
//   npx ts-node scripts/unmerge-blobs.ts --apply --force  # skip gateway-running guard
//
// MUST run with the gateway stopped (it holds the harmonic index in memory
// and would overwrite our edits on the next save).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { planUnmerge, CleanupEntry } from '../src/memory/unmerge-cleanup';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const MEM_DIR = path.join(os.homedir(), '.mafw', 'memory');
const INDEX_PATH = path.join(MEM_DIR, '.harmonic_index.json');
const CONCEPTS_DIR = path.join(MEM_DIR, 'concepts');

async function gatewayRunning(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch('http://127.0.0.1:3000/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

function splitOKF(raw: string): { frontmatter: any; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: {}, body: raw };
  return { frontmatter: yaml.load(m[1]) ?? {}, body: raw.slice(m[0].length) };
}

function writeOKF(fullPath: string, frontmatter: any, body: string): void {
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' });
  const tmpPath = fullPath + '.tmp';
  fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body.replace(/\n*$/, '\n')}`, 'utf-8');
  fs.renameSync(tmpPath, fullPath);
}

async function main(): Promise<void> {
  if (!fs.existsSync(INDEX_PATH)) {
    console.log(`[unmerge] index not found: ${INDEX_PATH}`);
    process.exit(1);
  }
  if (!FORCE && (await gatewayRunning())) {
    console.log('[unmerge] gateway is RUNNING (port 3000 responds). Stop it first (mafw stop), or pass --force.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  const entries: any[] = index.entries ?? [];
  const fileExists = (id: string): boolean => {
    const e = entries.find((x: any) => x.id === id);
    return !!e?.filePath && fs.existsSync(path.join(MEM_DIR, e.filePath));
  };
  const plan = planUnmerge(entries as CleanupEntry[], fileExists);

  console.log(`[unmerge] entries=${entries.length}`);
  console.log(`[unmerge] blobs to delete: ${plan.deleteBlobs.length}`);
  console.log(`[unmerge] sources to restore: ${plan.restore.length}`);
  console.log(`[unmerge] blobs kept: ${plan.keepBlobs.length}`);
  for (const k of plan.keepBlobs.slice(0, 10)) console.log(`  keep ${k.id}: ${k.reason}`);
  if (plan.missingSources.length > 0) {
    console.log(`[unmerge] missing sources: ${plan.missingSources.length}`);
  }

  if (!APPLY) {
    console.log('[unmerge] dry-run. Re-run with --apply to execute (a backup is made first).');
    return;
  }

  // Backup
  const backupDir = path.join(MEM_DIR, `backup-unmerge-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(INDEX_PATH, path.join(backupDir, '.harmonic_index.json'));
  if (fs.existsSync(CONCEPTS_DIR)) {
    fs.cpSync(CONCEPTS_DIR, path.join(backupDir, 'concepts'), { recursive: true });
  }
  console.log(`[unmerge] backup: ${backupDir}`);

  // Restore sources: rewrite OKF frontmatter + update index entry.
  let restored = 0;
  for (const r of plan.restore) {
    const entry = entries.find((x: any) => x.id === r.id);
    const fullPath = path.join(MEM_DIR, entry.filePath);
    const { frontmatter, body } = splitOKF(fs.readFileSync(fullPath, 'utf-8'));
    delete frontmatter.superseded_by;
    frontmatter.energy = r.energy;
    frontmatter.updated_at = new Date().toISOString();
    writeOKF(fullPath, frontmatter, body);
    delete entry.superseded_by;
    entry.energy = r.energy;
    restored++;
  }

  // Delete blobs: unlink OKF file + drop index entry.
  let deleted = 0;
  const deleteSet = new Set(plan.deleteBlobs);
  for (const id of plan.deleteBlobs) {
    const entry = entries.find((x: any) => x.id === id);
    if (entry?.filePath) {
      const fullPath = path.join(MEM_DIR, entry.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    deleted++;
  }
  index.entries = entries.filter((x: any) => !deleteSet.has(x.id));
  index.updated_at = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH + '.tmp', JSON.stringify(index, null, 2), 'utf-8');
  fs.renameSync(INDEX_PATH + '.tmp', INDEX_PATH);

  console.log(`[unmerge] applied: restored=${restored} deleted=${deleted}`);
}

main().catch((err) => {
  console.error(`[unmerge] failed: ${err?.message || err}`);
  process.exit(1);
});
```

- [ ] **Step 2: 类型检查 + dry-run 实测**

```bash
cd gateway; npx tsc --noEmit -p .
npx ts-node scripts/unmerge-blobs.ts
```

Expected（dry-run，基于当前线上数据）：`entries≈3015`、`blobs to delete≈2300` 量级、`sources to restore≈2000` 量级、若 gateway 在跑则打印中止提示（此时应 `mafw stop` 后重跑 dry-run 或直接进 Step 3 时再停）。

- [ ] **Step 3: Commit**

```bash
git add gateway/scripts/unmerge-blobs.ts
git commit -m "feat(memory): add unmerge-blobs cleanup CLI (dry-run default)

Restores superseded sources and deletes ' | ' merge blobs in
~/.mafw/memory. Guards against a running gateway, backs up index +
concepts before applying."
```

**注意：本步骤只提交脚本，不在此任务中对真实数据执行 --apply**——真实清理在 Task 6 全量验证后、gateway 停止时由用户确认执行。

---

### Task 6: 文档更新 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§3.1 注、§3.3 压缩段）
- Modify: `gateway/AGENTS.md`（如存在对应 MinHash 描述；先 grep 确认，没有则跳过）

**Interfaces:**
- Consumes: Task 1-5 全部产物。

- [ ] **Step 1: 更新 AGENTS.md**

`AGENTS.md` §3.3 第 4 条原文：

> 触发 MinHash 跨层合并检查（`MinHashMerger.merge()`，阈值 0.6、4 签名、3-gram shingle；合并产物带 `merged_from` 防递归；`skipMerge` 选项供 LongMemEval 基准等确定性摄入场景关闭）

改为：

> 触发 MinHash 跨层合并检查（`MinHashMerger.merge()`，阈值 0.7、32 签名、3-gram shingle、FNV-1a 双哈希 Kirsch–Mitzenmacher；段级匹配——合体按 ` | ` 切段取 max sim 防稀释；合并不加 energy；`memory_value` 合并上限 2000 字符截断于段边界；合并产物带 `merged_from` 防递归；`skipMerge` 选项供 LongMemEval 基准等确定性摄入场景关闭）

`AGENTS.md` §3.1 注（`merged_from` 行）原文：

> `merged_from?: string[];`         // MinHash 合并来源 id（写路径 merge 时填充）

在其下方追加一行说明（同级注释列表）：

> 存量合体清理：`cd gateway; npx ts-node scripts/unmerge-blobs.ts`（dry-run 默认，`--apply` 执行并自动备份；需先 `mafw stop`）

先 grep `gateway/AGENTS.md` 是否含 `MinHash`/`0.6`，若含同步更新数值；若无则不动。

- [ ] **Step 2: 全量构建 + 测试**

```bash
cd gateway; npm run build
npx jest --runInBand --forceExit
```

Expected: build exit 0；全量测试套件 PASS（重点关注 minhash/reflection/记忆相关套件无连带失败；kernel 集成套件如出现环境性失败，与本次改动无关时需记录说明）。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update MinHash merge parameters and cleanup script in AGENTS.md"
```

- [ ] **Step 4: 真实数据清理（需用户确认后执行）**

```bash
mafw stop
cd gateway; npx ts-node scripts/unmerge-blobs.ts          # dry-run 复核数字
npx ts-node scripts/unmerge-blobs.ts --apply              # 备份 + 执行
mafw daemon                                                # 或 mafw start
```

验证：重启后 `mafw_search_hybrid` 查 "gateway 部署"，结果应为若干独立记忆而非 `|` 合体。

---

## Self-Review 记录

- Spec 覆盖：用户批准的 1（重写签名/阈值）→ Task 1；2（止滚雪球：energy、value 上限；合体仍可为合并目标——修正：完全禁目标会破坏 exact-dup 归并回归测试，真滚雪球根因是坏哈希，已由 Task 1 修复 + maxMergeChars/深度上限兜底）→ Task 2；3（value 上限）→ Task 2；4（reflection 自动受益 + 段匹配防稀释）→ Task 3；5(a)（清理脚本）→ Task 4+5。
- 类型一致性：`segmentsOf`/`maxSimilarityToText`（Task 1 产出）在 Task 3 使用；`planUnmerge`/`CleanupEntry`（Task 4 产出）在 Task 5 使用——签名一致。
- 已离线模拟验证：新算法在 7 组真实文本对上的 sim 值与 Android 回归集全链路写入结果（2 活跃），断言数值取自模拟输出。
