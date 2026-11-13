# Kernel v2 Phase 5 / Embedding & Reranker Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 embedding / reranker 的模型、API、本地引擎与策略逻辑可替换，同时保持 memory 的存储、索引、检索、soft supersede、T1、100ms recall、pinned/sticky 逻辑不变。

**Architecture:** 在现有 `EmbeddingProvider` / `Reranker` 上增加可选元数据，新增两个进程内 provider registry，由 `initEmbeddingServices` 与 `reranker-singleton` 选择默认实现。向量按 `modelTag + dims` 命名空间隔离；换 provider 只重建派生向量，旧文件保留可回滚；reranker 只服务异步/快照路径，不进入 100ms 同步边界 recall。

**Tech Stack:** TypeScript / Node、Jest、`better-sqlite3`、现有 `gateway/src/memory/*`、`gateway/src/core/memory/*`。

**Spec:** `docs/research/2026-11-13-phase5-stateful-capabilities-review.md`（Decision Update + I1）、`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` §Phase 5

## Global Constraints

- memory 是产品能力：不改 `MemoryService`、`HarmonicUnitFileStore`、`harmonic-index`、soft supersede、T1、100ms recall、pinned/sticky 的语义与调用路径。
- 本计划只动 embedding / reranker：它们只替换“怎么算向量、怎么精排”，不改变 memory 的最终结果过滤（supersede 链头、T1 过滤、近重折叠）。
- 默认行为不变：`memory.embedding.provider=off` 时不创建 embedding runtime；未配置 reranker 时仍为 `off`。
- 向量是派生数据：`modelTag + dims` 不同即不同命名空间；旧向量文件不删除，回滚时继续使用。
- embedding 失败必须 fail-open 到 BM25；reranker 失败必须回退未精排结果。
- reranker 不得进入 100ms 同步边界 recall；只在后台快照 / 显式搜索路径使用。
- 不引入第三方包 loader / marketplace；本计划只做内置 provider 与配置选择。
- 所有生产代码先写失败测试；每个 task 结束提交。

## Review Focus

1. **同 modelTag、不同 dims**：旧向量文件不能被当成新 provider 的向量加载；必须跳过并按空命名空间重建。
2. **provider 构造失败 / embed 抛错**：runtime 返回 null 或 dense 分数为 null，BM25 仍可用，写入不被阻断。
3. **热切换时旧 runtime 还有在飞 flush**：旧 provider 被 dispose 后不能把结果写进新命名空间，也不能让 gateway 崩溃。
4. **reranker 慢调用**：边界 recall 仍走 BM25 + 快照，不被 reranker 拖到 100ms 以上。
5. **回滚**：切回旧 provider 后，旧向量文件仍可加载，不需要重新 embedding。
6. **配置 off / 未知 provider**：不创建 runtime，不删除任何向量文件，不改变现有结果。

---

## File Structure

**Create:**
- `gateway/src/memory/embedding-namespace.ts` — modelTag / namespace / dims 校验的纯函数。
- `gateway/src/memory/embedding-registry.ts` — embedding provider 工厂注册、创建、dispose。
- `gateway/src/memory/reranker-registry.ts` — reranker provider 工厂注册、创建、dispose。
- `gateway/tests/unit/embedding-namespace.test.ts`
- `gateway/tests/unit/embedding-registry.test.ts`
- `gateway/tests/unit/embedding-provider-switch.test.ts`
- `gateway/tests/unit/reranker-registry.test.ts`
- `gateway/tests/unit/architecture/reranker-hot-path.test.ts`
- `gateway/tests/helpers/kernel-v2/embedding-conformance.ts`
- `gateway/tests/helpers/kernel-v2/reranker-conformance.ts`
- `gateway/tests/unit/kernel-v2/embedding-conformance.test.ts`
- `gateway/tests/unit/kernel-v2/reranker-conformance.test.ts`

**Modify:**
- `gateway/src/memory/embedding-provider.ts` — metadata 字段 + health/dispose。
- `gateway/src/memory/embedding-runtime.ts` — 注入 provider、namespace、runtime diagnostics。
- `gateway/src/memory/vector-store.ts` — dims/version 校验。
- `gateway/src/memory/sqlite-vector-store.ts` — 按 model + dims 加载。
- `gateway/src/memory/llamacpp-provider.ts` — `dispose()`。
- `gateway/src/core/memory/reranker.ts` — strategy / health / dispose。
- `gateway/src/core/memory/llamacpp-reranker.ts` — strategy / dispose。
- `gateway/src/core/memory/reranker-singleton.ts` — 使用 registry。
- `gateway/src/kernel.ts` — `initEmbeddingServices` / `embeddingConfigDeps`。
- `gateway/src/routes/embedding-config.ts` — runtime state 字段 + `baseUrl`。
- `gateway/tests/unit/embedding-runtime.test.ts`
- `gateway/tests/unit/vector-store.test.ts`
- `gateway/tests/unit/memory/embedding-runtime-t1.test.ts`
- `gateway/tests/unit/memory/sqlite-vector-store.test.ts`
- `gateway/tests/unit/embedding-config.test.ts`
- `gateway/tests/unit/reranker-factory.test.ts`
- `gateway/tests/unit/reranker-singleton.test.ts`
- `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

---

### Task 1: Embedding metadata + namespace

**Files:**
- Modify: `gateway/src/memory/embedding-provider.ts`
- Create: `gateway/src/memory/embedding-namespace.ts`
- Test: `gateway/tests/unit/embedding-namespace.test.ts`

**Interfaces:**
- Consumes: existing `EmbeddingProvider` / `EmbeddingProviderConfig`.
- Produces:

```ts
export type EmbeddingHealth = 'healthy' | 'degraded' | 'failed'

export interface EmbeddingProvider {
  name: string
  dims: number
  /** Stable vector namespace identity. Defaults to sanitized `name`. */
  modelTag?: string
  maxInputTokens?: number
  batchLimit?: number
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>
  health?(): EmbeddingHealth
  dispose?(): void | Promise<void>
}

export interface EmbeddingProviderMeta {
  modelTag: string
  dims: number
  maxInputTokens: number
  batchLimit: number
  version: number
}

export interface EmbeddingNamespace {
  modelTag: string
  dims: number
  version: number
  vectorFile: string
  t1JsonFile: string
}

export function embeddingProviderMeta(
  provider: Pick<EmbeddingProvider, 'name' | 'dims' | 'modelTag' | 'maxInputTokens' | 'batchLimit'>,
): EmbeddingProviderMeta

export function resolveEmbeddingNamespace(
  baseDir: string,
  provider: Pick<EmbeddingProvider, 'name' | 'dims' | 'modelTag'>,
): EmbeddingNamespace

export function assertEmbeddingDims(expected: number, actual: number, label: string): void
```

- [ ] **Step 1: Write the failing test**

```ts
import * as path from 'path'
import { assertEmbeddingDims, embeddingProviderMeta, resolveEmbeddingNamespace } from '../../src/memory/embedding-namespace'

test('defaults metadata from name and dims', () => {
  expect(embeddingProviderMeta({ name: 'llamacpp:Qwen3-Embedding.gguf', dims: 1024 })).toEqual({
    modelTag: 'llamacpp_Qwen3-Embedding.gguf',
    dims: 1024,
    maxInputTokens: 8192,
    batchLimit: 16,
    version: 1,
  })
})

test('explicit modelTag wins and is sanitized', () => {
  expect(embeddingProviderMeta({ name: 'local', dims: 512, modelTag: 'my model/v2' })).toMatchObject({
    modelTag: 'my_model_v2',
    dims: 512,
  })
})

test('namespace keeps the legacy vector filename and adds a separate t1 file', () => {
  const base = path.join('/tmp', 'mafw')
  expect(resolveEmbeddingNamespace(base, { name: 'fake-embed', dims: 4 })).toEqual({
    modelTag: 'fake-embed',
    dims: 4,
    version: 1,
    vectorFile: path.join(base, 'memory', 'vectors-fake-embed.json'),
    t1JsonFile: path.join(base, 'memory', 'vectors-t1-fake-embed.json'),
  })
})

test('dims mismatch throws with a provider label', () => {
  expect(() => assertEmbeddingDims(4, 3, 'fake-embed')).toThrow(/fake-embed.*4.*3/)
  expect(() => assertEmbeddingDims(4, 4, 'fake-embed')).not.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-namespace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the interface fields and pure helpers**

`embedding-namespace.ts` sanitizes with `[^A-Za-z0-9._-] -> _`, trims and falls back to `provider`; defaults `maxInputTokens=8192`, `batchLimit=16`, `version=1`. `resolveEmbeddingNamespace` uses exactly the legacy `vectors-<modelTag>.json` / `vectors-t1-<modelTag>.json` names so existing installs keep their vectors.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-namespace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/embedding-provider.ts gateway/src/memory/embedding-namespace.ts gateway/tests/unit/embedding-namespace.test.ts
git commit -m "feat(memory): add embedding provider metadata and namespace"
```

---

### Task 2: Embedding provider registry

**Files:**
- Create: `gateway/src/memory/embedding-registry.ts`
- Test: `gateway/tests/unit/embedding-registry.test.ts`

**Interfaces:**
- Consumes: `createEmbeddingProvider`, `EmbeddingProviderConfig`, `EmbeddingProvider`, `disposeEmbeddingProvider`.
- Produces:

```ts
export interface EmbeddingProviderFactory {
  id: string
  create(cfg: EmbeddingProviderConfig): EmbeddingProvider | null
}

export interface EmbeddingProviderRegistry {
  register(factory: EmbeddingProviderFactory): () => void
  create(id: string, cfg: EmbeddingProviderConfig): EmbeddingProvider | null
  list(): string[]
  dispose(): void | Promise<void>
}

export function embeddingProviderIdFromConfig(
  cfg: Pick<EmbeddingProviderConfig, 'provider' | 'engine'>,
): string | null

export function createEmbeddingProviderRegistry(): EmbeddingProviderRegistry
```

- [ ] **Step 1: Write the failing test**

```ts
import { createEmbeddingProviderRegistry, embeddingProviderIdFromConfig } from '../../src/memory/embedding-registry'

test('maps config to built-in provider id', () => {
  expect(embeddingProviderIdFromConfig({ provider: 'off' })).toBeNull()
  expect(embeddingProviderIdFromConfig({ provider: 'local', engine: 'onnx' })).toBe('local-onnx')
  expect(embeddingProviderIdFromConfig({ provider: 'local', engine: 'llamacpp' })).toBe('local-llamacpp')
  expect(embeddingProviderIdFromConfig({ provider: 'dashscope' })).toBe('dashscope')
})

test('creates a registered provider and lists built-ins', () => {
  const registry = createEmbeddingProviderRegistry()
  expect(registry.list()).toEqual(expect.arrayContaining(['dashscope', 'local-onnx', 'local-llamacpp']))
  const provider = {
    name: 'fake',
    dims: 2,
    embed: async () => [[1, 0]],
  }
  registry.register({ id: 'fake', create: () => provider })
  expect(registry.create('fake', { provider: 'local' } as any)).toBe(provider)
})

test('unknown / throwing factories return null', () => {
  const registry = createEmbeddingProviderRegistry()
  expect(registry.create('missing', { provider: 'local' } as any)).toBeNull()
  registry.register({ id: 'boom', create: () => { throw new Error('boom') } })
  expect(registry.create('boom', { provider: 'local' } as any)).toBeNull()
})

test('dispose calls provider.dispose in reverse creation order', async () => {
  const order: string[] = []
  const registry = createEmbeddingProviderRegistry()
  registry.register({ id: 'a', create: () => ({ name: 'a', dims: 1, embed: async () => [[1]], dispose: () => order.push('a') }) })
  registry.register({ id: 'b', create: () => ({ name: 'b', dims: 1, embed: async () => [[1]], dispose: () => order.push('b') }) })
  registry.create('a', { provider: 'local' } as any)
  registry.create('b', { provider: 'local' } as any)
  await registry.dispose()
  expect(order).toEqual(['b', 'a'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry + built-in factories**

Built-ins delegate to `createEmbeddingProvider` with the config overridden to `dashscope` / `local+onnx` / `local+llamacpp`. `engine` defaults to `onnx` when omitted. Track created providers and call `dispose()` LIFO; if `dispose` is absent but `killServer` exists, call `killServer()` (legacy `LlamaCppServerProvider`). Factory errors are swallowed and return `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/embedding-registry.ts gateway/tests/unit/embedding-registry.test.ts
git commit -m "feat(memory): add embedding provider registry"
```

---

### Task 3: Embedding runtime injection + dims-safe vector namespaces

**Files:**
- Modify: `gateway/src/memory/embedding-runtime.ts`
- Modify: `gateway/src/memory/vector-store.ts`
- Modify: `gateway/src/memory/sqlite-vector-store.ts`
- Modify: `gateway/src/memory/llamacpp-provider.ts`
- Test: `gateway/tests/unit/embedding-runtime.test.ts`
- Test: `gateway/tests/unit/vector-store.test.ts`
- Test: `gateway/tests/unit/memory/embedding-runtime-t1.test.ts`
- Test: `gateway/tests/unit/memory/sqlite-vector-store.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveEmbeddingNamespace`, `embeddingProviderMeta`.
- Produces:

```ts
export interface EmbeddingRuntime {
  provider: EmbeddingProvider
  providerId: string
  modelTag: string
  dims: number
  namespace: EmbeddingNamespace
  vectors: MemoryVectorStore
  indexer: EmbeddingIndexer
  t1Vectors: VectorStoreLike
  t1Indexer: EmbeddingIndexer
  scheduleFlush(): void
}

export interface InitEmbeddingRuntimeOptions {
  baseDir: string
  /** Injected by the live registry; omitted only in legacy tests. */
  provider?: EmbeddingProvider
  providerId?: string
  getTextForId?: (id: string) => Promise<string | null>
  cfg?: EmbeddingProviderConfig & { t1VectorStore?: 'sqlite' | 'json' }
  getApiKeyFn?: (provider: string) => string | null
  createProviderFn?: typeof createEmbeddingProvider
  vectorDb?: Database.Database
}
```

- [ ] **Step 1: Write the failing tests**

Add to `embedding-runtime.test.ts`:

```ts
test('injected provider controls providerId, modelTag, dims and namespace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-meta-'))
  const provider: EmbeddingProvider = {
    name: 'fake-embed',
    modelTag: 'fake-embed',
    dims: 2,
    embed: async (texts) => texts.map(() => [1, 0]),
  }
  const rt = initEmbeddingRuntime({
    baseDir: dir,
    provider,
    providerId: 'local-onnx',
    cfg: { provider: 'local', engine: 'onnx' } as any,
  })
  expect(rt).toMatchObject({ providerId: 'local-onnx', modelTag: 'fake-embed', dims: 2 })
  expect(rt!.namespace.vectorFile).toBe(path.join(dir, 'memory', 'vectors-fake-embed.json'))
  expect(fs.existsSync(rt!.namespace.vectorFile)).toBe(false)
  setEmbeddingRuntime(null)
})
```

Add to `vector-store.test.ts`:

```ts
test('reopening with a different dims does not load the old vector file', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'vectors-dims.json')
  const first = new MemoryVectorStore(file, 2)
  first.upsert('a', [1, 0])
  first.flush()

  const mismatched = new MemoryVectorStore(file, 3)
  expect(mismatched.size()).toBe(0)
  expect(fs.existsSync(file)).toBe(true)

  const restored = new MemoryVectorStore(file, 2)
  expect(restored.get('a')).toEqual([1, 0])
})
```

Add a `SqliteT1VectorStore` test that inserts one 2-dim row, reopens with 3 dims (`size() === 0`), then reopens with 2 dims and sees the row.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-runtime.test.ts tests/unit/vector-store.test.ts tests/unit/memory/embedding-runtime-t1.test.ts tests/unit/memory/sqlite-vector-store.test.ts`
Expected: FAIL — `modelTag`/`namespace`/`providerId` missing; mismatched dims still loads.

- [ ] **Step 3: Implement injection + namespace + load guards**

- Update the existing manual `EmbeddingRuntime` stubs in `embedding-runtime.test.ts` (the `rt = { provider, vectors, indexer, scheduleFlush }` objects) with `providerId`, `modelTag`, `dims` and `namespace`.
- `initEmbeddingRuntime`: when `opts.provider` is present, use it directly and skip the config `provider === 'off'` early return; otherwise keep the legacy `createProviderFn`/`createEmbeddingProvider` path for existing tests.
- `providerId = opts.providerId ?? cfg.provider`.
- `namespace = resolveEmbeddingNamespace(baseDir, provider)`; `MemoryVectorStore(namespace.vectorFile, provider.dims, namespace.modelTag, namespace.version)`.
- T1 uses `namespace.t1JsonFile`, `model: namespace.modelTag`, `dims: provider.dims`.
- `MemoryVectorStore.load()`: if `data.dims !== this.dims`, log `[VectorStore] dims mismatch ...` and return without loading. `flush()` writes `version`.
- `SqliteT1VectorStore.load()` and the existing-row count add `AND dims = ?`.
- `LlamaCppServerProvider.dispose()` delegates to `killServer()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-runtime.test.ts tests/unit/vector-store.test.ts tests/unit/memory/embedding-runtime-t1.test.ts tests/unit/memory/sqlite-vector-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/embedding-runtime.ts gateway/src/memory/vector-store.ts gateway/src/memory/sqlite-vector-store.ts gateway/src/memory/llamacpp-provider.ts gateway/tests/unit/embedding-runtime.test.ts gateway/tests/unit/vector-store.test.ts gateway/tests/unit/memory/embedding-runtime-t1.test.ts gateway/tests/unit/memory/sqlite-vector-store.test.ts
git commit -m "feat(memory): inject embedding providers and isolate vector namespaces"
```

---

### Task 4: Live wiring, hot swap, backfill and rollback

**Files:**
- Modify: `gateway/src/kernel.ts:1757-1779` (`initEmbeddingServices`)
- Modify: `gateway/src/kernel.ts` (`embeddingConfigDeps`)
- Modify: `gateway/src/routes/embedding-config.ts`
- Test: `gateway/tests/unit/embedding-config.test.ts`
- Create: `gateway/tests/unit/embedding-provider-switch.test.ts`

**Interfaces:**
- Consumes: Task 2 `createEmbeddingProviderRegistry`, `embeddingProviderIdFromConfig`; Task 3 `EmbeddingRuntime.providerId/modelTag/dims`.
- Produces:

```ts
export interface EmbeddingConfigState {
  provider: 'off' | 'local' | 'dashscope'
  engine: 'onnx' | 'llamacpp'
  model: string
  dimensions: number
  baseUrl: string
  threads: number
  llamacpp: {
    gpu: string
    threads: number
    contextSize: number
    batchSize: number
  }
}

export interface EmbeddingRuntimeState {
  active: string | null
  providerId: string | null
  modelTag: string | null
  dims: number | null
  vectors: number
  indexEntries: number
  coverage: number
}

export interface EmbeddingConfigUpdate {
  provider?: string
  engine?: string
  model?: string
  threads?: number
  llamacpp?: { gpu?: string; threads?: number; contextSize?: number; batchSize?: number }
}
```

> **Execution ruling (2026-11-13):** `baseUrl` is **not** accepted by `POST /api/memory/embedding-config`; it can exfiltrate the DashScope key / enable SSRF. The route returns 400 and custom endpoints remain config-file only. Tests below assert the rejection. T1 uses `t1_vectors_v2` with `(model, dims, key)` to preserve rollback rows.

- [ ] **Step 1: Write the failing tests**

Extend `embedding-config.test.ts`:

```ts
it('GET exposes providerId, modelTag and dims', async () => {
  const deps = makeDeps()
  server = createServer(deps)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const r = await request(server, 'GET')
  expect(r.body.runtime.providerId).toBe('local-onnx')
  expect(r.body.runtime.modelTag).toBe('local_onnx-community_Qwen3-Embedding-0.6B-ONNX')
  expect(r.body.runtime.dims).toBe(1024)
})

it('POST rejects baseUrl because it is config-file only', async () => {
  const deps = makeDeps()
  server = createServer(deps)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const rejected = await request(server, 'POST', { baseUrl: 'https://example.test/v1/embeddings' })
  expect(rejected.status).toBe(400)
  expect(rejected.body.error).toMatch(/config-file/)
  expect(deps.calls.reinit).toBe(0)
})
```

Create `embedding-provider-switch.test.ts` with two fake providers:

```ts
test('switching provider keeps the old namespace and rolls back without re-embedding', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-switch-'))
  const a: EmbeddingProvider = { name: 'fake-a', modelTag: 'fake-a', dims: 2, embed: async (t) => t.map(() => [1, 0]) }
  const b: EmbeddingProvider = { name: 'fake-b', modelTag: 'fake-b', dims: 2, embed: async (t) => t.map(() => [0, 1]) }

  const rtA = initEmbeddingRuntime({ baseDir: dir, provider: a, providerId: 'fake-a' })!
  rtA.indexer.enqueueText('u1', 'alpha')
  await rtA.indexer.flushQueue()
  const fileA = rtA.namespace.vectorFile
  expect(fs.existsSync(fileA)).toBe(true)

  const rtB = initEmbeddingRuntime({ baseDir: dir, provider: b, providerId: 'fake-b' })!
  rtB.indexer.enqueueText('u1', 'alpha')
  await rtB.indexer.flushQueue()
  expect(fileA).not.toBe(rtB.namespace.vectorFile)
  expect(fs.existsSync(fileA)).toBe(true)

  setEmbeddingRuntime(null)
  const back = initEmbeddingRuntime({ baseDir: dir, provider: a, providerId: 'fake-a' })!
  expect(back.vectors.get('u1')).toEqual([1, 0])
  setEmbeddingRuntime(null)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-config.test.ts tests/unit/embedding-provider-switch.test.ts`
Expected: FAIL — missing runtime fields / no switch behavior.

- [ ] **Step 3: Implement live wiring**

- Update `embedding-config.test.ts` `makeDeps()` so `currentConfig()` includes `baseUrl` and `runtimeState()` includes `providerId: 'local-onnx'`, the sanitized `modelTag`, and `dims: 1024`.
- `initEmbeddingServices`: build `EmbeddingProviderConfig` from `config.memory.embedding` including `baseUrl`, `engine`, `threads`, `llamacpp`, `getApiKeyFn`. Resolve `providerId = embeddingProviderIdFromConfig(cfg)`. Create registry, `provider = registry.create(providerId, cfg)`, then `initEmbeddingRuntime({ provider, providerId, baseDir, vectorDb, getTextForId })`. Dispose the old provider with `dispose()` / legacy `killServer()` before clearing runtime. If `initEmbeddingRuntime` returns null, dispose the newly created provider and leave the dense channel off (BM25-only).
- `embeddingConfigDeps`: return `providerId`, `modelTag`, `dims` from `getEmbeddingRuntime()`; `active` remains `provider.name`.
- `embedding-config` route: reject `baseUrl` in POST (`config-file only`); include `baseUrl` in GET current config; keep existing enum/range checks.
- Do not change `MemoryService` or recall paths.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/embedding-config.test.ts tests/unit/embedding-provider-switch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/kernel.ts gateway/src/routes/embedding-config.ts gateway/tests/unit/embedding-config.test.ts gateway/tests/unit/embedding-provider-switch.test.ts
git commit -m "feat(memory): wire embedding provider registry into live runtime"
```

---

### Task 5: Reranker provider metadata + registry + singleton

**Files:**
- Modify: `gateway/src/core/memory/reranker.ts`
- Modify: `gateway/src/core/memory/llamacpp-reranker.ts`
- Modify: `gateway/src/core/memory/reranker-singleton.ts`
- Create: `gateway/src/memory/reranker-registry.ts`
- Test: `gateway/tests/unit/reranker-factory.test.ts`
- Create: `gateway/tests/unit/reranker-registry.test.ts`
- Test: `gateway/tests/unit/reranker-singleton.test.ts`

**Interfaces:**
- Consumes: existing `createReranker`, `Reranker`, `ScoredEntry`.
- Produces:

```ts
export interface Reranker {
  name: string
  strategy?: string
  rerank(query: string, candidates: ScoredEntry[], topK: number): ScoredEntry[] | Promise<ScoredEntry[]>
  health?(): 'healthy' | 'degraded' | 'failed'
  dispose?(): void
}

export interface RerankerProviderFactory {
  id: 'heuristic' | 'cross-encoder' | 'llamacpp'
  create(weights?: Partial<RerankWeights>, opts?: import('./llamacpp-reranker').LlamaCppRerankerConfig): Reranker | null
}

export interface RerankerProviderRegistry {
  register(factory: RerankerProviderFactory): () => void
  create(id: string, weights?: Partial<RerankWeights>, opts?: import('./llamacpp-reranker').LlamaCppRerankerConfig): Reranker | null
  list(): string[]
  dispose(): void
}

export function createRerankerProviderRegistry(): RerankerProviderRegistry
```

- [ ] **Step 1: Write the failing tests**

Extend `reranker-factory.test.ts`:

```ts
test('built-in rerankers expose a stable strategy', () => {
  expect(createReranker('heuristic')?.strategy).toBe('heuristic')
  expect(createReranker('cross-encoder')?.strategy).toBe('cross-encoder')
  expect(createReranker('llamacpp', undefined, { gpu: 'cpu' })?.strategy).toBe('llamacpp')
})
```

Create `reranker-registry.test.ts`:

```ts
test('resolves built-ins, rejects unknown ids and disposes in reverse order', () => {
  const order: string[] = []
  const registry = createRerankerProviderRegistry()
  expect(registry.list()).toEqual(['heuristic', 'cross-encoder', 'llamacpp'])
  expect(registry.create('missing')).toBeNull()
  registry.register({ id: 'a' as any, create: () => ({ name: 'a', strategy: 'a', rerank: () => [], dispose: () => order.push('a') }) })
  registry.register({ id: 'b' as any, create: () => ({ name: 'b', strategy: 'b', rerank: () => [], dispose: () => order.push('b') }) })
  registry.create('a')
  registry.create('b')
  registry.dispose()
  expect(order).toEqual(['b', 'a'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/reranker-factory.test.ts tests/unit/reranker-registry.test.ts tests/unit/reranker-singleton.test.ts`
Expected: FAIL — `strategy` / registry missing.

- [ ] **Step 3: Implement**

- Add `strategy` to built-ins (`heuristic`, `cross-encoder`, `llamacpp`); `LlamaCppReranker.dispose()` delegates to `killServer()`.
- `reranker-registry.ts` registers the three built-in factories and tracks created instances for LIFO dispose.
- `reranker-singleton.ts` uses the registry; on cache miss, dispose the old instance (`dispose?.()` then legacy `killServer?.()`), create the new one, keep the existing cache key (`name:gpu:batchSize`).
- Keep `createReranker` public for tests/back-compat.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/reranker-factory.test.ts tests/unit/reranker-registry.test.ts tests/unit/reranker-singleton.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/reranker.ts gateway/src/core/memory/llamacpp-reranker.ts gateway/src/core/memory/reranker-singleton.ts gateway/src/memory/reranker-registry.ts gateway/tests/unit/reranker-factory.test.ts gateway/tests/unit/reranker-registry.test.ts gateway/tests/unit/reranker-singleton.test.ts
git commit -m "feat(memory): add reranker provider registry"
```

---

### Task 6: Reranker hot-path guard + conformance kits

**Files:**
- Create: `gateway/tests/unit/architecture/reranker-hot-path.test.ts`
- Create: `gateway/tests/helpers/kernel-v2/embedding-conformance.ts`
- Create: `gateway/tests/helpers/kernel-v2/reranker-conformance.ts`
- Create: `gateway/tests/unit/kernel-v2/embedding-conformance.test.ts`
- Create: `gateway/tests/unit/kernel-v2/reranker-conformance.test.ts`

**Interfaces:**
- Consumes: `EmbeddingProvider`, `Reranker`, `ScoredEntry`.
- Produces:

```ts
export async function runEmbeddingConformance(provider: EmbeddingProvider): Promise<string[]>
export async function runRerankerConformance(
  reranker: Reranker,
  candidates: Array<{ entry: { id: string; primary_abstraction?: string; cue_anchors?: string[]; created_at?: string; energy?: number }; score: number }>,
): Promise<string[]>
```

- [ ] **Step 1: Write the failing tests**

`reranker-hot-path.test.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'

test('the synchronous boundary recall module does not import the reranker', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/recall/recall-context.ts'), 'utf8')
  expect(source).not.toMatch(/from ['"][^'"]*reranker/)
  expect(source).not.toContain('getReranker')
  expect(source).not.toContain('applyReranker')
})
```

`embedding-conformance.test.ts`:

```ts
test('a complete provider passes and a broken one reports errors', async () => {
  const good = { name: 'good', modelTag: 'good', dims: 2, maxInputTokens: 128, batchLimit: 2, embed: async (t) => t.map(() => [1, 0]) }
  expect(await runEmbeddingConformance(good)).toEqual([])

  const bad = { name: '', dims: 0, embed: async () => [[1, 2, 3]] }
  const errors = await runEmbeddingConformance(bad as any)
  expect(errors.join('\n')).toMatch(/name|dims|vector length/)
})
```

`reranker-conformance.test.ts`:

```ts
test('a valid reranker preserves candidates and respects topK', async () => {
  const candidates = [{ entry: { id: 'a' }, score: 1 }, { entry: { id: 'b' }, score: 0.5 }]
  const good = { name: 'good', strategy: 'good', rerank: (_q: string, c: any[], k: number) => c.slice(0, k) }
  expect(await runRerankerConformance(good, candidates)).toEqual([])
  const bad = { name: 'bad', strategy: 'bad', rerank: () => [{ entry: { id: 'ghost' }, score: 1 }] }
  expect((await runRerankerConformance(bad as any, candidates)).join('\n')).toMatch(/unknown|subset/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/architecture/reranker-hot-path.test.ts tests/unit/kernel-v2/embedding-conformance.test.ts tests/unit/kernel-v2/reranker-conformance.test.ts`
Expected: FAIL — helpers missing.

- [ ] **Step 3: Implement conformance kits**

- Embedding checks: non-empty `name`, `modelTag`, `dims > 0`, `maxInputTokens > 0`, `batchLimit > 0`; `embed(['alpha'], 'query')` returns exactly one vector of `dims`; `embed(['alpha','beta'], 'document')` returns two vectors; all numbers finite; `health` (if present) returns a known value.
- Reranker checks: non-empty `name`/`strategy`; `rerank` returns an array; every returned entry id exists in candidates; no duplicate ids; length ≤ topK; scores finite; `health` (if present) returns a known value.
- Kits return `string[]` errors, never throw.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/architecture/reranker-hot-path.test.ts tests/unit/kernel-v2/embedding-conformance.test.ts tests/unit/kernel-v2/reranker-conformance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/architecture/reranker-hot-path.test.ts gateway/tests/helpers/kernel-v2/embedding-conformance.ts gateway/tests/helpers/kernel-v2/reranker-conformance.ts gateway/tests/unit/kernel-v2/embedding-conformance.test.ts gateway/tests/unit/kernel-v2/reranker-conformance.test.ts
git commit -m "test(memory): add embedding and reranker conformance kits"
```

---

### Task 7: Docs + full gate

**Files:**
- Create: `docs/releases/2026-11-13-capability-kernel-phase5-embedding-reranker.md`
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` (Phase 5 progress)

- [ ] **Step 1: Run the full gateway gate**

```bash
cd gateway
npx jest --runInBand --forceExit
npx tsc --noEmit -p tsconfig.json
```

Expected: all suites pass; typecheck exits 0. Record the exact counts in the release note.

- [ ] **Step 2: Write the release note**

Include: scope, provider contract, namespace/backfill/rollback semantics, reranker 100ms boundary, tests added, full-suite counts, typecheck, explicit non-goals (no memory core changes, no third-party package loader, no partitioning), rollback steps.

- [ ] **Step 3: Update the roadmap**

Phase 5 status: embedding/reranker delivered; memory remains fixed product capability; remaining Phase 5 items (automation/goal/storage) still open.

- [ ] **Step 4: Commit**

```bash
git add docs/releases/2026-11-13-capability-kernel-phase5-embedding-reranker.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md
git commit -m "docs: record phase 5 embedding and reranker providers"
```

---

## Self-Review

- **Spec coverage:** provider contract / namespace / dims / backfill / rollback / BM25 fallback / reranker 100ms / conformance / docs all have tasks.
- **Step scan:** each task starts with a failing test, then implementation, then green test, then commit.
- **Type consistency:** `EmbeddingRuntime.providerId/modelTag/dims/namespace`, `EmbeddingRuntimeState` fields, and `Reranker.strategy` are defined in the task that introduces them and consumed with the same names later.
- **Review Focus:** same-modelTag/different-dims, provider failure, in-flight flush, slow reranker, rollback, off/unknown provider each have a test or guard.
- **Proportion:** plan defines interfaces and test assertions; implementation bodies stay with the engineer.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-13-kernel-v2-phase5-embedding-reranker.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next; most thorough, higher cost.
- **Native** — I implement every task in this session, as in Phase 4; fastest, one final review.

I recommend **Native** because the tasks share the same provider interfaces and the changes are localized to memory/embedding/reranker; a fresh context per task would mostly re-read the same files. Does the plan capture what you want, and which approach should we use?
