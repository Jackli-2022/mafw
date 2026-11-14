/**
 * E10g-W7：memory / embedding 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/dashboard.ts` 的 `memory.add` / `memory.setSticky`、
 * `routes/memory.ts` 的 `memory.embeddingsBackfill`、
 * `routes/merge-memory.ts` 的 `memory.merge`、
 * `routes/embedding-config.ts` 的 `embedding.update`）。
 * 条件必填 / 二选一用 description 说明，不伪造 oneOf/anyOf 把契约做得比
 * handler 更严（handler 的 trim/白名单校验才是权威）。
 *
 * 分类（与 W1-W6 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`memory.add`、`memory.setSticky`、
 *     `memory.merge`、`embedding.update`；
 *   - 空对象 + `requestRequired:false`：`memory.embeddingsBackfill`（只读
 *     `?limit=N`，body 被忽略）、`memory.delete`（DELETE 只读路径 `:id`，
 *     catalog 直接复用 `EmptyRequest`）。
 */
import { Type } from '@sinclair/typebox'

/** `MemoryType`（`core/memory/harmonic-types.ts`）：`memory.add` 的白名单。 */
const MemoryType = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('global'),
])

/** `Authority`（`normalizeAuthority`）：非法值 → 400，缺省 → 'agent'。 */
const MemoryAuthority = Type.Union([
  Type.Literal('user'),
  Type.Literal('agent'),
  Type.Literal('tool'),
  Type.Literal('pipeline'),
])

// ── memory.add ────────────────────────────────────────────────────────────

/**
 * `POST /api/memory/add`（handler：`routes/dashboard.ts` `memory.add`）。
 *
 * 写管线的 HTTP 入口（MCP `mafw_add_memory` 与 worker 都走这里）。handler 只
 * 要求 `content` 非空、`memoryType` 在白名单内；`authority` 非法 → 400；
 * `supersedes` 指向不存在的 id → 200 `{success:false}`。
 *
 * `content` 会被截断到 4000 字符、`primaryAbstraction` 到 200、`cueAnchors`
 * 到前 8 个（`sourceTraceIds` 的前 20 条由 `normalizeSourceTraceIds` 保留）——
 * 全是**截断而不是拒绝**，所以这里不声明 `maxItems`：声明了就等于向客户端
 * 承诺一个 handler 永远不会返回的 400。上限写在 description 里（E10g-fix F2）。
 */
export const MemoryAddRequest = Type.Object({
  content: Type.String({
    minLength: 1,
    description: 'Memory body (trimmed; empty → 400). Stored truncated to 4000 chars.',
  }),
  memoryType: Type.Optional(MemoryType),
  authority: Type.Optional(MemoryAuthority),
  importance: Type.Optional(Type.Number({
    description: 'Salience hint (1-10 recommended); any finite number is accepted, absent → judgeSalience().',
  })),
  primaryAbstraction: Type.Optional(Type.String({
    description: '6-8 word index abstraction; absent → the content, truncated to 200 chars.',
  })),
  cueAnchors: Type.Optional(Type.Array(Type.String(), {
    description: 'Retrieval keywords (identifiers kept verbatim); the pipeline keeps the first 8 and drops the rest.',
  })),
  pinned: Type.Optional(Type.Boolean({
    description: 'Pin to the per-turn <user-profile> disclosure layer.',
  })),
  sticky: Type.Optional(Type.Boolean({
    description: 'Put the memory on the note board (expires, never deleted).',
  })),
  stickyDays: Type.Optional(Type.Number({
    description: 'Note-board window in days when sticky is true; absent/<=0 → 7.',
  })),
  sessionID: Type.Optional(Type.String({
    description: 'Originating session; pipeline worker ids resolve back to their source session.',
  })),
  sourceTraceIds: Type.Optional(Type.Array(Type.String(), {
    description: 'Exact T1 trace ids (unknown ids are dropped, not rejected); the pipeline keeps the first 20.',
  })),
  supersedes: Type.Optional(Type.String({
    description: 'Harmonic id to soft-supersede (missing target → 200 {success:false}).',
  })),
})

// ── memory.setSticky ──────────────────────────────────────────────────────

/**
 * `POST /api/memory/pin`（handler：同上 `memory.setSticky`）。
 *
 * 一个 body 两种模式，由 `sticky` 是否为 boolean 决定：
 *   - `sticky: true|false` → 设置/清除便签窗口（`stickyDays` 缺省 7 天）；
 *   - 否则 → 按 `pinned === true` 设置披露层 pin（缺省即取消 pin）。
 * `id` 缺失 → 200 `{success:false,error:'id required'}`；id 不存在 →
 * 200 `{success:false}`（不是 404）。
 */
export const MemorySetStickyRequest = Type.Object({
  id: Type.String({
    minLength: 1,
    description: 'Harmonic memory id; unknown ids return 200 {success:false}.',
  }),
  pinned: Type.Optional(Type.Boolean({
    description: 'Only read when sticky is absent: pinned === true pins, anything else unpins.',
  })),
  sticky: Type.Optional(Type.Boolean({
    description: 'Presence of a boolean switches to note-board mode (true → expire at stickyDays).',
  })),
  stickyDays: Type.Optional(Type.Number({
    description: 'Note-board window in days when sticky is true; absent/<=0 → 7.',
  })),
})

// ── memory.merge ──────────────────────────────────────────────────────────

/**
 * `POST /api/merge-memory`（handler：`routes/merge-memory.ts` → MCP
 * `handleMergeMemory`）。
 *
 * 跨 worktree 记忆融合（desktop `/merge-memory` slash 命令）。handler 只要求
 * `sourceWorktree`；strategy 为 `manual | higher_energy | newer`，但未知字符串
 * 会被当作 manual 静默处理，因此声明为 string 而不是封闭枚举（不把契约做得
 * 比 handler 更严）。
 */
export const MemoryMergeRequest = Type.Object({
  sourceWorktree: Type.String({
    minLength: 1,
    description: 'Absolute source worktree path (memory root is <worktree>/<paths.mafwDir>).',
  }),
  strategy: Type.Optional(Type.String({
    description: 'manual | higher_energy | newer; unknown values behave like manual.',
  })),
  resolveStrategy: Type.Optional(Type.String({
    description: 'Legacy alias, read only when strategy is absent; defaults to manual.',
  })),
})

// ── embedding.update ──────────────────────────────────────────────────────

/** `EMBEDDING_PROVIDERS` / `ENGINES` / `GPUS`（`routes/embedding-config.ts`）。 */
const EmbeddingProvider = Type.Union([
  Type.Literal('off'),
  Type.Literal('local'),
  Type.Literal('dashscope'),
])
const EmbeddingEngine = Type.Union([
  Type.Literal('onnx'),
  Type.Literal('llamacpp'),
])
const EmbeddingGpu = Type.Union([
  Type.Literal('cpu'),
  Type.Literal('vulkan'),
  Type.Literal('cuda'),
])

/**
 * `POST /api/memory/embedding-config`（handler：`routes/embedding-config.ts`
 * `handleEmbeddingConfigUpdate`）。
 *
 * 校验后持久化到 config.yaml 并热重建 embedding runtime（provider/model 变更
 * 会在后台重跑 backfill）。空 body / `{}` → 400 `empty body`；未知字段忽略，
 * 但 `baseUrl` 是**显式拒绝**（防止 DashScope key 外泄），因此这里声明可填
 * 字段而不是开放对象：把 baseUrl 写进契约等于鼓励客户端提交一个必然 400 的字段。
 */
export const EmbeddingUpdateRequest = Type.Object({
  provider: Type.Optional(EmbeddingProvider),
  engine: Type.Optional(EmbeddingEngine),
  model: Type.Optional(Type.String({
    description: 'Provider model id (free-form; validated by the provider at runtime).',
  })),
  threads: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 32,
    description: 'ONNX/llama.cpp thread count; out of 1..32 → 400.',
  })),
  llamacpp: Type.Optional(Type.Object({
    gpu: Type.Optional(EmbeddingGpu),
    threads: Type.Optional(Type.Integer({
      minimum: 1,
      maximum: 32,
      description: 'llama.cpp thread override; out of 1..32 → 400.',
    })),
    contextSize: Type.Optional(Type.Integer({
      minimum: 256,
      maximum: 32768,
      description: 'llama.cpp context size; out of 256..32768 → 400.',
    })),
    batchSize: Type.Optional(Type.Integer({
      minimum: 32,
      maximum: 32768,
      description: 'llama.cpp batch size; out of 32..32768 → 400.',
    })),
  }, {
    description: 'llama.cpp-only knobs; ignored by the ONNX engine.',
  })),
}, {
  description: 'At least one field is required ({} → 400). baseUrl is config-file only and is rejected here.',
})
