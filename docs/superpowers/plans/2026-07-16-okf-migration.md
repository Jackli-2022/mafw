# OKF 存储迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate memory storage from single `memories.json` to OKF multi-file Markdown architecture.

**Architecture:** `HarmonicUnitFileStore` encapsulates all OKF file operations. 10 source files switch from direct JSON I/O to FileStore calls. `granularity` field added to `HarmonicUnit`. Migrator script converts existing data.

**Tech Stack:** TypeScript, Node.js fs, YAML frontmatter

## Global Constraints

- `HarmonicUnitFileStore` is the ONLY code that directly reads/writes `.md` files
- `.harmonic_index.json` pointer changes from JSON memory index to `.md` file path
- All tool interfaces (`mafw_search`, `mafw_write_memory`) remain unchanged
- `episodic` type does NOT write to OKF
- `semantic` + `granularity` → `concepts/knowledge/`; `semantic` alone → `concepts/semantic/`
- `procedural` → `concepts/procedural/`
- `global` → handled by existing L5Store (unchanged)
- Filename format: `{typeLabel}-{id[:12]}-{slug[:40]}.md`
- Atom writes: `.tmp` + `renameSync` for all file operations

---

### Task 1: Add `granularity` to `HarmonicUnit`

**Files:**
- Modify: `src/memory/harmonic-types.ts`
- Test: `tests/unit/harmonic-types.test.ts`

**Interfaces:**
- Produces: `HarmonicUnit.granularity?: 'function' | 'class' | 'module' | 'architecture'`

- [ ] **Step 1: Add the field to `HarmonicUnit` interface**

```typescript
// src/memory/harmonic-types.ts
export interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';
  granularity?: 'function' | 'class' | 'module' | 'architecture';  // NEW
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  goal_id?: string;
  merged_from?: string[];
  salience?: number;
  abstraction_level?: number;
  review_count?: number;
  last_reviewed?: string;
  top_associations?: string[];
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Add test for granularity field**

```typescript
// tests/unit/harmonic-types.test.ts
test('HarmonicUnit allows optional granularity', () => {
  const unit: HarmonicUnit = {
    id: 'test', type: 'semantic', granularity: 'function',
    primary_abstraction: 'test func', cue_anchors: [], memory_value: 'code',
    energy: 0.5, created_at: '', updated_at: '',
  };
  expect(unit.granularity).toBe('function');
});

test('HarmonicUnit defaults granularity to undefined', () => {
  const unit: HarmonicUnit = {
    id: 'test', type: 'semantic',
    primary_abstraction: 'test fact', cue_anchors: [], memory_value: 'fact',
    energy: 0.5, created_at: '', updated_at: '',
  };
  expect(unit.granularity).toBeUndefined();
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest tests/unit/harmonic-types.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/memory/harmonic-types.ts tests/unit/harmonic-types.test.ts
git commit -m "feat(memory): add granularity field to HarmonicUnit"
```

---

### Task 2: Create OKF parser and writer

**Files:**
- Create: `gateway/src/memory/okf-parser.ts`
- Create: `gateway/src/memory/okf-writer.ts`
- Test: `tests/unit/memory/okf-parser.test.ts`

**Interfaces:**
- Consumes: `HarmonicUnit` (with `granularity`)
- Produces: `parseOKF(content: string): { unit: Partial<HarmonicUnit>; body: string; links: string[] }`
- Produces: `buildOKF(unit: HarmonicUnit): string`

- [ ] **Step 1: Write the failing test for `parseOKF`**

```typescript
// tests/unit/memory/okf-parser.test.ts
import { parseOKF } from '../../gateway/src/memory/okf-parser';

const sample = `---
type: knowledge
id: mem_fn_001
primary_abstraction: "createPayment function"
cue_anchors: [payment, create]
granularity: function
energy: 0.7
links:
  - [[PaymentService]]
  - [[payment]]
---
# createPayment
Function code here
`;

test('parseOKF parses frontmatter, body, and links', () => {
  const result = parseOKF(sample);
  expect(result.unit.type).toBe('knowledge');
  expect(result.unit.id).toBe('mem_fn_001');
  expect(result.unit.primary_abstraction).toBe('createPayment function');
  expect(result.unit.granularity).toBe('function');
  expect(result.links).toEqual(['PaymentService', 'payment']);
  expect(result.body).toContain('Function code here');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/okf-parser.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `parseOKF`**

```typescript
// gateway/src/memory/okf-parser.ts
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface OKFResult {
  unit: Record<string, any>;
  body: string;
  links: string[];
}

const LINK_REGEX = /\[\[([^\]]+)\]\]/g;

export function parseOKF(content: string): OKFResult {
  // Split frontmatter (---) from body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid OKF format: missing frontmatter');

  const frontmatter = yaml.load(match[1]) as Record<string, any>;
  const body = match[2].trim();

  // Extract [[links]] from both frontmatter.links and body
  const links: string[] = [...(frontmatter.links || [])];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = LINK_REGEX.exec(body)) !== null) {
    links.push(linkMatch[1]);
  }

  return { unit: frontmatter, body, links: [...new Set(links)] };
}

export function readOKFFile(filePath: string): OKFResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseOKF(content);
}
```

- [ ] **Step 4: Implement `buildOKF`**

```typescript
// gateway/src/memory/okf-writer.ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HarmonicUnit } from '../../../src/memory/harmonic-types';

export function buildOKF(unit: HarmonicUnit): string {
  const frontmatter: Record<string, any> = {
    type: unit.type === 'semantic' && unit.granularity ? 'knowledge' : unit.type,
    id: unit.id,
    primary_abstraction: unit.primary_abstraction,
    cue_anchors: unit.cue_anchors,
    energy: unit.energy,
    created_at: unit.created_at,
    updated_at: unit.updated_at,
  };

  if (unit.granularity) frontmatter.granularity = unit.granularity;
  if (unit.salience !== undefined) frontmatter.salience = unit.salience;
  if (unit.abstraction_level !== undefined) frontmatter.abstraction_level = unit.abstraction_level;
  if (unit.merged_from?.length) frontmatter.merged_from = unit.merged_from;

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' });
  return `---\n${yamlStr}---\n${unit.memory_value}\n`;
}

export function getOKFFilename(unit: HarmonicUnit): string {
  const typeLabel = unit.type === 'semantic' && unit.granularity
    ? 'knowledge'
    : unit.type === 'procedural' ? 'procedural' : 'semantic';
  const slug = unit.primary_abstraction
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${typeLabel}-${unit.id.slice(0, 12)}-${slug}.md`;
}

export function getOKFDirectory(unit: HarmonicUnit): string {
  if (unit.type === 'procedural') return 'concepts/procedural';
  if (unit.type === 'semantic' && unit.granularity) return 'concepts/knowledge';
  if (unit.type === 'semantic') return 'concepts/semantic';
  throw new Error(`episodic should not be written to OKF directly`);
}

export function writeOKFFile(baseDir: string, unit: HarmonicUnit): string {
  const dir = path.join(baseDir, getOKFDirectory(unit));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = getOKFFilename(unit);
  const filePath = path.join(dir, fileName);
  const content = buildOKF(unit);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
  return fileName;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/memory/okf-parser.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/memory/okf-parser.ts gateway/src/memory/okf-writer.ts tests/unit/memory/okf-parser.test.ts
git commit -m "feat(memory): add OKF parser and writer"
```

---

### Task 3: Create `HarmonicUnitFileStore`

**Files:**
- Create: `gateway/src/memory/harmonic-file-store.ts`
- Test: `tests/unit/memory/harmonic-file-store.test.ts`

**Interfaces:**
- Produces: `class HarmonicUnitFileStore { write(unit): Promise<string>; read(id): Promise<HarmonicUnit|null>; ... }`
- Consumes: `buildOKF`, `parseOKF`, `getOKFFilename`, `getOKFDirectory`, `writeOKFFile`
- Consumes: `HarmonicIndexManager`, `CognitiveGraphManager`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/memory/harmonic-file-store.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicUnitFileStore } from '../../gateway/src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/memory/harmonic-types';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id: 'mem_fn_001', type: 'semantic', granularity: 'function',
    primary_abstraction: 'createPayment', cue_anchors: ['payment'],
    memory_value: 'function code', energy: 0.7, created_at: now, updated_at: now,
    ...overrides,
  };
}

describe('HarmonicUnitFileStore', () => {
  let tmpDir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    store = new HarmonicUnitFileStore(tmpDir);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('write creates .md file and returns filename', async () => {
    const unit = makeUnit();
    const fileName = await store.write(unit);
    const filePath = path.join(tmpDir, 'concepts', 'knowledge', fileName);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('write knowledge unit goes to concepts/knowledge/', async () => {
    const unit = makeUnit();
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^knowledge-/);
  });

  test('write semantic unit (no granularity) goes to concepts/semantic/', async () => {
    const unit = makeUnit({ granularity: undefined });
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^semantic-/);
  });

  test('write procedural unit goes to concepts/procedural/', async () => {
    const unit = makeUnit({ type: 'procedural', granularity: undefined });
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^procedural-/);
  });

  test('read returns unit matching what was written', async () => {
    const unit = makeUnit();
    await store.write(unit);
    const loaded = await store.read('mem_fn_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.primary_abstraction).toBe('createPayment');
    expect(loaded!.memory_value).toBe('function code');
  });

  test('archive sets archived flag', async () => {
    const unit = makeUnit();
    await store.write(unit);
    await store.archive('mem_fn_001');
    const loaded = await store.read('mem_fn_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.archived).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/harmonic-file-store.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `HarmonicUnitFileStore`**

```typescript
// gateway/src/memory/harmonic-file-store.ts
import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from '../../src/memory/harmonic-types';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { CognitiveGraphManager } from '../../src/memory/cognitive-graph';
import { writeOKFFile, getOKFFilename, getOKFDirectory } from './okf-writer';
import { readOKFFile } from './okf-parser';

export class HarmonicUnitFileStore {
  private indexManager: HarmonicIndexManager;
  private graphManager: CognitiveGraphManager;

  constructor(private baseDir: string) {
    this.indexManager = new HarmonicIndexManager(baseDir);
    this.graphManager = new CognitiveGraphManager(baseDir);
  }

  async write(unit: HarmonicUnit): Promise<string> {
    const fileName = writeOKFFile(path.join(this.baseDir, 'memory'), unit);
    const filePath = path.join('memory', getOKFDirectory(unit).replace(/\\/g, '/'), fileName);
    const tier = unit.type === 'semantic' && unit.granularity ? 'knowledge'
      : unit.type === 'procedural' ? 'procedural' : 'semantic';

    this.indexManager.addEntry({
      id: unit.id,
      type: unit.type,
      primary_abstraction: unit.primary_abstraction,
      cue_anchors: unit.cue_anchors,
      tier,
      energy: unit.energy,
      filePath,  // pointer to .md
    } as any, tier);

    // Parse [[links]] from memory_value and update cognitive graph
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(unit.memory_value)) !== null) {
      this.graphManager.addConnection(unit.id, match[1]);
    }

    return fileName;
  }

  async read(id: string): Promise<HarmonicUnit | null> {
    const index = this.indexManager.getIndex();
    const entry = index.entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return null;

    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return null;

    const { unit, body } = readOKFFile(fullPath);
    return {
      ...unit as any,
      memory_value: body,
      updated_at: new Date().toISOString(),
    };
  }

  async archive(id: string): Promise<void> {
    const index = this.indexManager.getIndex();
    const entry = index.entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return;

    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return;

    const { unit, body } = readOKFFile(fullPath);
    unit.archived = true;
    unit.updated_at = new Date().toISOString();

    const yaml = require('js-yaml');
    const yamlStr = yaml.dump(unit, { lineWidth: -1, quotingType: '"' });
    const tmpPath = fullPath + '.tmp';
    fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body}\n`, 'utf-8');
    fs.renameSync(tmpPath, fullPath);
  }

  get indexManager_() { return this.indexManager; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/memory/harmonic-file-store.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/harmonic-file-store.ts tests/unit/memory/harmonic-file-store.test.ts
git commit -m "feat(memory): create HarmonicUnitFileStore for OKF operations"
```

---

### Task 4: Create `okf-index-renderer`

**Files:**
- Create: `gateway/src/memory/okf-index-renderer.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager.getIndex()`
- Produces: `renderIndexMd(baseDir, indexManager): void`

- [ ] **Step 1: Implement `renderIndexMd`**

```typescript
// gateway/src/memory/okf-index-renderer.ts
import * as fs from 'fs';
import * as path from 'path';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';

export function renderIndexMd(baseDir: string, indexManager: HarmonicIndexManager): void {
  const index = indexManager.getIndex();
  const lines: string[] = ['# Memory Index', '', '> Auto-generated from `.harmonic_index.json`', ''];

  const byTier = new Map<string, typeof index.entries>();
  for (const entry of index.entries) {
    const tier = entry.tier || 'unknown';
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(entry);
  }

  for (const [tier, entries] of byTier) {
    lines.push(`## ${tier}`, '');
    for (const e of entries) {
      const pathStr = (e as any).filePath || '';
      lines.push(`- **${e.primary_abstraction}** (energy: ${e.energy}) — \`${pathStr}\``);
    }
    lines.push('');
  }

  const mdPath = path.join(baseDir, 'memory', 'index.md');
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf-8');
}
```

- [ ] **Step 2: Commit**

```bash
git add gateway/src/memory/okf-index-renderer.ts
git commit -m "feat(memory): add index.md renderer from harmonic index"
```

---

### Task 5: Rewrite `src/mcp/tools.ts` — `mafw_add_memory` and `mafw_merge_memory`

**Files:**
- Modify: `src/mcp/tools.ts`

**Interfaces:**
- Consumes: `HarmonicUnitFileStore`

- [ ] **Step 1: Replace `mafw_add_memory` handler**

In the `mafw_add_memory` handler (currently lines 384-438), replace the `memories.json` read/write with FileStore:

```typescript
// Inside handlers object, mafw_add_memory:
mafw_add_memory: async (args) => {
  try {
    const content = args.content as string;
    const memoryType = (args.memoryType as string) || 'semantic';
    const cueAnchors = (args.cueAnchors as string[]) || [];
    const primaryAbstraction = (args.primaryAbstraction as string) || content.slice(0, 80);
    const granularity = args.granularity as string | undefined;

    if (!['episodic', 'semantic', 'procedural', 'global'].includes(memoryType)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Invalid memoryType: ${memoryType}` }) }], isError: true };
    }

    const now = new Date().toISOString();
    const unit: HarmonicUnit = {
      id: generateHarmonicId(),
      type: memoryType as HarmonicUnit['type'],
      granularity: granularity as any,
      primary_abstraction: primaryAbstraction.slice(0, 200),
      cue_anchors: cueAnchors.slice(0, 8),
      memory_value: content,
      energy: 0.8,
      salience: calculateSalience(content),
      abstraction_level: memoryType === 'procedural' ? 3 : memoryType === 'global' ? 4 : 2,
      created_at: now,
      updated_at: now,
    };

    // Use FileStore instead of writing memories.json directly
    const { HarmonicUnitFileStore } = await import('../memory/harmonic-file-store');
    const store = new HarmonicUnitFileStore(mafwDir);
    await store.write(unit);

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, id: unit.id }) }],
    };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
},
```

- [ ] **Step 2: Replace `mafw_merge_memory` handler**

In the `mafw_merge_memory` handler replace memories.json operations with FileStore.

- [ ] **Step 3: Run the MCP tools test**

Run: `npx jest tests/unit/mcp/tools.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "refactor(mcp): switch mafw_add_memory and mafw_merge_memory to HarmonicUnitFileStore"
```

---

### Task 6: Rewrite `src/tools/archive-worktree.ts` and `src/plugin.ts`

**Files:**
- Modify: `src/tools/archive-worktree.ts`
- Modify: `src/plugin.ts`

- [ ] **Step 1: Replace `mergeMemoryFromWorktree` in archive-worktree.ts**

Replace the `memories.json` read/write with `HarmonicUnitFileStore.write()`.

- [ ] **Step 2: Replace `/merge-memory` command in plugin.ts**

Same pattern — use FileStore instead of direct JSON I/O.

- [ ] **Step 3: Run tests**

Run: `npx jest --no-coverage`
Expected: PASS (existing failures unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/tools/archive-worktree.ts src/plugin.ts
git commit -m "refactor: switch archive-worktree and plugin merge-memory to HarmonicUnitFileStore"
```

---

### Task 7: Rewrite `gateway/src/mcp/handlers/add-memory.ts` and `merge-memory.ts`

**Files:**
- Modify: `gateway/src/mcp/handlers/add-memory.ts`
- Modify: `gateway/src/mcp/handlers/merge-memory.ts`

- [ ] **Step 1: Replace `handleAddMemory`**

Replace `memories.json` write with `HarmonicUnitFileStore.write()`.

- [ ] **Step 2: Replace `handleMergeMemory`**

Replace `memories.json` read/write with FileStore.

- [ ] **Step 3: Build and verify**

Run: `npm run build` in `gateway/`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add gateway/src/mcp/handlers/add-memory.ts gateway/src/mcp/handlers/merge-memory.ts
git commit -m "refactor(gateway): switch MCP memory handlers to HarmonicUnitFileStore"
```

---

### Task 8: Rewrite compression layer files

**Files:**
- Modify: `src/memory/abstraction-distiller.ts`
- Modify: `src/compression/hybrid-compressor.ts`
- Modify: `src/memory/t1-to-t2-compressor.ts`

- [ ] **Step 1: Replace `loadTierUnits`/`saveTierUnits` in abstraction-distiller.ts**

Replace with `HarmonicUnitFileStore.read()`/`write()`.

- [ ] **Step 2: Replace `persistUnit` in hybrid-compressor.ts**

Replace `memories.json` write with `HarmonicUnitFileStore.write()`.

- [ ] **Step 3: Replace in t1-to-t2-compressor.ts**

Same pattern.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/abstraction-distiller.test.ts tests/unit/compression-pipeline.test.ts tests/unit/t1-to-t2-compressor.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/abstraction-distiller.ts src/compression/hybrid-compressor.ts src/memory/t1-to-t2-compressor.ts
git commit -m "refactor(compression): switch compression layer to HarmonicUnitFileStore"
```

---

### Task 9: Create migration script

**Files:**
- Create: `gateway/src/memory/okf-migrator.ts`

- [ ] **Step 1: Implement `migrateFromJson`**

```typescript
// gateway/src/memory/okf-migrator.ts
import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from '../../src/memory/harmonic-types';
import { HarmonicUnitFileStore } from './harmonic-file-store';

export async function migrateFromJson(mafwDir: string): Promise<{ migrated: number }> {
  const memPath = path.join(mafwDir, 'memory', 'memories.json');
  if (!fs.existsSync(memPath)) return { migrated: 0 };

  const units: HarmonicUnit[] = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
  const store = new HarmonicUnitFileStore(mafwDir);

  let migrated = 0;
  for (const unit of units) {
    if (unit.type === 'episodic') continue;  // skip episodic
    try {
      await store.write(unit);
      migrated++;
    } catch (err) {
      console.warn(`[migrate] Failed to migrate ${unit.id}: ${err}`);
    }
  }

  // Rename old file after successful migration
  fs.renameSync(memPath, memPath + '.bak');

  return { migrated };
}
```

- [ ] **Step 2: Commit**

```bash
git add gateway/src/memory/okf-migrator.ts
git commit -m "feat(migration): add okf-migrator for memories.json to OKF conversion"
```

---

### Task 10: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All 590+ tests passing (existing pre-existing failures unchanged)

- [ ] **Step 2: Build gateway**

Run: `npm run build` in `gateway/`
Expected: No errors
