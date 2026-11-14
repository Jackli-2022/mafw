/**
 * E10h-R6：memory / embedding 写接口（6 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/dashboard.ts`（memory.add / memory.setSticky）
 *   - `routes/memory.ts`（memory.delete / memory.embeddingsBackfill）
 *   - `routes/merge-memory.ts` → MCP `handleMergeMemory`（memory.merge）
 *   - `routes/embedding-config.ts`（embedding.update）
 *
 * 这一面的 200 大量是「**未命中也是 200**」：handler 用 `res.end(...)` 直接
 * 写错误回执（默认状态码 200），只有 `memory.delete` / `embeddingsBackfill`
 * 会真的发 404/400/503。因此 `success:false` 分支是合法 200，必须进 schema。
 *
 * 错误体（400/500/503）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { EmbeddingConfigStateSchema, EmbeddingRuntimeStateSchema } from './media-voice'

// ── memory.delete ───────────────────────────────────────────────────────────

/**
 * `DELETE /api/memory/:id`（handler：`routes/memory.ts` `memory.delete`）。
 *
 * 命中 → 200 `{status:'deleted'}`；未命中 → 404 `{error}`（不在本 schema 内）。
 */
export const MemoryDeleteResponse = Type.Object({
  status: Type.Literal('deleted'),
})

// ── memory.setSticky ────────────────────────────────────────────────────────

/**
 * `POST /api/memory/pin`（handler：`routes/dashboard.ts` `memory.setSticky`）。
 *
 * 一个 body 两种模式 → 两个成功分支 + 一个失败分支（`id` 缺失 / 未知 id 都是
 * 200，不是 404）：
 *   - 便签模式（`sticky` 是 boolean）：`{success:true, id, sticky, sticky_until?}`
 *     （`sticky:false` 时窗口为 null → `sticky_until` 键被 `JSON.stringify` 丢掉）；
 *   - pin 模式（`sticky` 缺省）：`{success:true, id, pinned}`；
 *   - 失败：`{success:false, error}`（`memoryService` 未就绪 / id 不存在 / 解析异常）。
 * `sticky` 与 `pinned` 在 wire 上互斥，收敛成一份会让「两个都给」的 body 合法化。
 */
export const MemorySetStickyResponse = Type.Union([
  Type.Object({
    success: Type.Literal(true),
    id: Type.String({ description: 'Harmonic memory id that was updated.' }),
    sticky: Type.Boolean({ description: 'Echo of the requested sticky flag.' }),
    sticky_until: Type.Optional(Type.String({
      description: 'Note-board expiry (ISO). Absent when sticky was set to false.',
    })),
  }, {
    description: 'Note-board mode: the body carried a boolean sticky flag.',
  }),
  Type.Object({
    success: Type.Literal(true),
    id: Type.String({ description: 'Harmonic memory id that was updated.' }),
    pinned: Type.Boolean({ description: 'Echo of the resolved pinned flag (pinned === true pins).' }),
  }, {
    description: 'Pin mode: sticky was absent, so the body only carried pinned.',
  }),
  Type.Object({
    success: Type.Literal(false),
    error: Type.String({ description: 'Unknown id / memoryService not ready / body parse error (still 200).' }),
  }, {
    description: 'Failure receipt: this endpoint never uses 404 for a missing id.',
  }),
])

// ── memory.add ──────────────────────────────────────────────────────────────

/**
 * `POST /api/memory/add`（handler：`routes/dashboard.ts` `memory.add`）。
 *
 * 写管线 HTTP 入口（MCP `mafw_add_memory` 与 worker 都走这里）。成功分支的
 * 公共键只有 `success`，其余按 handler 的写出条件可选：
 *   - `id`：dedup 命中（`reason:'exact-hash'`）时**没有** id；
 *   - `deduped`：`routeAndWrite` 走 `skip` 时为字面量 true；
 *   - `updated`：`routeAndWrite` 走 `update` 时是被更新的目标 id；
 *   - `sticky_until`：只有新建且 sticky 时出现。
 * 失败分支的 `code:'disk_low'` 只在磁盘 critical 出现（其余是纯 `{success:false,error}`）。
 */
export const MemoryAddResponse = Type.Union([
  Type.Object({
    success: Type.Literal(true),
    id: Type.Optional(Type.String({
      description: 'New (or updated) harmonic id; absent on the exact-hash dedup receipt.',
    })),
    deduped: Type.Optional(Type.Literal(true, {
      description: 'Verbatim re-submit was skipped (routeAndWrite skip, or exact-hash guard).',
    })),
    reason: Type.Optional(Type.Literal('exact-hash', {
      description: 'Only present on the pre-write exact-hash dedup receipt.',
    })),
    updated: Type.Optional(Type.String({
      description: 'Target id when routeAndWrite merged into an existing unit.',
    })),
    sticky_until: Type.Optional(Type.String({
      description: 'Note-board expiry (ISO) when the unit was created with sticky:true.',
    })),
  }, {
    description: 'Write accepted (created / updated / deduped / exactly-deduped).',
  }),
  Type.Object({
    success: Type.Literal(false),
    error: Type.String({ description: 'Validation / service-not-ready / supersedes-miss / parse error (still 200).' }),
    code: Type.Optional(Type.Literal('disk_low', {
      description: 'Disk pressure critical: the write was refused before dedup/disk side effects.',
    })),
  }, {
    description: 'Failure receipt: this endpoint answers 200 even for rejected writes.',
  }),
])

// ── memory.embeddingsBackfill ───────────────────────────────────────────────

/**
 * `POST /api/memory/embeddings/backfill`（handler：`routes/memory.ts` →
 * `kernel.backfillEmbeddings` + `vector-store.backfill`）。
 *
 * 200 是补建计数 + 补建后的向量覆盖率快照（`vectors` / `indexEntries` 是
 * 整库状态，不是本次处理的条数）。provider 关闭 → 400，满盘 → 503，不在本
 * schema 内。
 */
export const MemoryEmbeddingsBackfillResponse = Type.Object({
  indexed: Type.Number({ description: 'Entries that received a fresh vector in this run.' }),
  skipped: Type.Number({ description: 'Entries already present in the new provider store (idempotent rerun).' }),
  missing: Type.Number({ description: 'Entries that could not be embedded (empty abstraction etc.).' }),
  vectors: Type.Number({ description: 'Total vectors in the active store after the run.' }),
  indexEntries: Type.Number({ description: 'Total harmonic index entries (the backfill denominator).' }),
})

// ── memory.merge ────────────────────────────────────────────────────────────

/** 冲突两侧的单元回显（`handleMergeMemory` 直接摘取存储字段）。 */
const MergeConflictSideSchema = Type.Object({
  id: Type.String(),
  primary_abstraction: Type.Optional(Type.String()),
  memory_value: Type.Optional(Type.String()),
  energy: Type.Optional(Type.Number()),
})

/** `details.conflicts` 的一行：只在 `strategy === 'manual'` 时非空。 */
const MergeConflictSchema = Type.Object({
  source: MergeConflictSideSchema,
  target: MergeConflictSideSchema,
  similarity: Type.Number(),
})

/** `details.added` 的一行（新建单元的投影）。 */
const MergeAddedSchema = Type.Object({
  id: Type.String(),
  primary_abstraction: Type.Optional(Type.String()),
  energy: Type.Optional(Type.Number()),
})

/**
 * `POST /api/merge-memory`（handler：`routes/merge-memory.ts` → MCP
 * `handleMergeMemory`）。
 *
 * `ok` 是 gateway 的信封键（`parsed.success !== false`），`success` 是 MCP
 * handler 自己的判定，两者在 200 上恒一致。成功分支的 `conflicts` 是命中数，
 * `details.conflicts` 只在 manual 策略下带冲突明细（其余策略为空数组——
 * `higher_energy` / `newer` 已经自行裁决）。未知策略按 manual 静默处理。
 *
 * 失败分支：源 worktree 无记忆 / 目标不存在等 → MCP handler 返回
 * `{success:false,error}`，路由仍写 200（`isError` 不改变状态码）。
 */
export const MemoryMergeResponse = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    success: Type.Literal(true),
    added: Type.Number({ description: 'Newly created units in the target store.' }),
    conflicts: Type.Number({ description: 'Similar units above the 0.6 similarity threshold.' }),
    skipped: Type.Number({ description: 'Byte-identical units that were skipped.' }),
    details: Type.Object({
      added: Type.Array(MergeAddedSchema),
      conflicts: Type.Array(MergeConflictSchema, {
        description: 'Conflict detail; empty unless strategy resolved to manual.',
      }),
      strategy: Type.String({ description: 'manual | higher_energy | newer (unknown values behave like manual).' }),
    }),
  }, {
    description: 'Merge finished (added / updated / skipped counts + strategy).',
  }),
  Type.Object({
    ok: Type.Literal(false),
    success: Type.Literal(false),
    error: Type.String({ description: 'Missing source worktree / unreadable source store / handler exception.' }),
  }, {
    description: 'Failure receipt: the MCP handler error is still transported as a 200 JSON body.',
  }),
])

// ── embedding.update ────────────────────────────────────────────────────────

/**
 * `POST /api/memory/embedding-config`（handler：`routes/embedding-config.ts`
 * `handleEmbeddingConfigUpdate`）。
 *
 * 校验 → 落盘 → 热重建 runtime 后回 `{success:true, current, runtime, note}`：
 * `current` / `runtime` 是**重建后重新读回**的状态（与 `embedding.get` 的两段
 * 严格同形，故复用同一批 schema）；`note` 是两条固定文案之一（runtime 活 /
 * provider 关闭）。
 */
export const EmbeddingUpdateResponse = Type.Object({
  success: Type.Literal(true),
  current: EmbeddingConfigStateSchema,
  runtime: EmbeddingRuntimeStateSchema,
  note: Type.String({
    description: 'embedding runtime rebuilt (backfill scheduled) | provider off (dense channel disabled).',
  }),
})
