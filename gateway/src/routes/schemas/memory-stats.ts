/**
 * E8-3 `GET /api/memory/stats` 响应 schema（TypeBox）。
 *
 * 形状来源：`routes/memory.ts` 的 `memory.stats` handler（事实源）。它是运维诊断面
 * （tags: internal），不是 SDK 调用面：绝大多数子块是**可增长**的计数器快照，
 * 因此只钉住 load-bearing 顶层块与稳定字段，动态/可扩展子块用
 * `additionalProperties: true`（新计数器不会让客户端 schema 校验失败）。
 *
 * 明确取舍：
 *  - `embedding` / `t1` / `abstractionLevels` 是客户端判断覆盖率与分层的依据 → 精确；
 *  - `consolidation` / `routing` / `dedup` / `commitment` / `reconsolidation` /
 *    `coactivation` / `fok` / `retrievalEvents` 在依赖不可用时为 `null` → `null` union；
 *  - `pipelines` 每项的 `lastCounts` 是 per-pipeline 计数袋 → `Record<string, number>`。
 */
import { Type } from '@sinclair/typebox'

const EmbeddingStatsSchema = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  vectors: Type.Number(),
  indexEntries: Type.Number(),
  // Active intersection (not vectors/indexEntries); see memory/vector-coverage.ts.
  coverage: Type.Number(),
  // Diagnostics: optional so older bodies/payloads stay valid.
  activeEntries: Type.Optional(Type.Number()),
  activeWithVectors: Type.Optional(Type.Number()),
  orphanVectors: Type.Optional(Type.Number()),
  /** Legacy mixed ratio (vectors / indexEntries), never clamped. */
  rawCoverage: Type.Optional(Type.Number()),
})

const T1RetrievalStatsSchema = Type.Object({
  total: Type.Number(),
  byKind: Type.Object({
    search: Type.Number(),
    recall: Type.Number(),
    redeem: Type.Number(),
  }),
  uniqueTraces: Type.Number(),
  // Unix 秒；没有检索事件时为 null。
  lastAt: Type.Union([Type.Number(), Type.Null()]),
})

const T1StatsSchema = Type.Object({
  vectors: Type.Number(),
  activeRows: Type.Number(),
  archiveRows: Type.Number(),
  coverage: Type.Number(),
  retrieval: T1RetrievalStatsSchema,
  provenance: Type.Object({
    memories: Type.Number(),
    withExact: Type.Number(),
    coverage: Type.Number(),
  }),
  activation: Type.Object({
    traces: Type.Number(),
    mean: Type.Number(),
    max: Type.Number(),
  }),
  activationRanking: Type.Object({
    mode: Type.Union([
      Type.Literal('off'),
      Type.Literal('shadow'),
      Type.Literal('on'),
    ]),
    evaluations: Type.Number(),
    wouldReorder: Type.Number(),
    applied: Type.Number(),
  }, { additionalProperties: true }),
})

const ConsolidationStatsSchema = Type.Object({
  judged: Type.Number(),
  updates: Type.Number(),
  creates: Type.Number(),
  skipped: Type.Number(),
  updateRatio: Type.Number(),
})

const PipelineHeartbeatSchema = Type.Object({
  name: Type.String(),
  lastRunAt: Type.Optional(Type.String()),
  lastSuccessAt: Type.Optional(Type.String()),
  lastCounts: Type.Optional(Type.Record(Type.String(), Type.Number())),
  ok: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String()),
  intervalMs: Type.Union([Type.Number(), Type.Null()]),
  ageMs: Type.Union([Type.Number(), Type.Null()]),
  stale: Type.Boolean(),
}, { additionalProperties: true })

const DiagnosticBag = Type.Object({}, { additionalProperties: true })

export const MemoryStatsResponse = Type.Object({
  embedding: EmbeddingStatsSchema,
  t1: T1StatsSchema,
  consolidation: Type.Union([ConsolidationStatsSchema, Type.Null()]),
  routing: Type.Union([DiagnosticBag, Type.Null()]),
  dedup: Type.Union([DiagnosticBag, Type.Null()]),
  commitment: Type.Union([DiagnosticBag, Type.Null()]),
  reconsolidation: Type.Union([DiagnosticBag, Type.Null()]),
  pipelines: Type.Array(PipelineHeartbeatSchema),
  coactivation: Type.Union([DiagnosticBag, Type.Null()]),
  abstractionLevels: Type.Record(Type.String(), Type.Number()),
  fok: Type.Union([DiagnosticBag, Type.Null()]),
  retrievalEvents: Type.Union([DiagnosticBag, Type.Null()]),
})
