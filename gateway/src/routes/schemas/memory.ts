/**
 * E10c-1：memory 读接口（2 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - memory.search → routes/memory.ts（`{results, t1Results?}`；layer=gist/both/t1）
 *   - memory.get    → routes/memory.ts + mcp/handlers/get-memory.ts（MCP get-memory 透传）
 *
 * `memory.search` 此前由 `contract/overrides.json` 手写 schema 描述；E10c-1 起改为
 * code-first，override 条目删除。`results` 元素与 `@mafw/sdk` `MemoryUnit` 逐字段等价
 * （`contract-compat.checks.ts` 的 `CHECK_memory_search` 钉住）；`t1Results` 元素与
 * `T1SearchHit` 等价（`CHECK_memory_search_t1_item`）。
 */
import { Type, type Static } from '@sinclair/typebox'
import type { HarmonicUnit } from '../../core/memory/harmonic-types'

/**
 * 编译期精确相等（恒等函数技巧，never 安全）。与 SDK `contract-compat.checks.ts`
 * 的 AssertEq 同一写法；这里锁的是 gateway 自己的 store 类型（`HarmonicUnit`
 * 没有 SDK DTO —— `memory.get` 是 internal op，只做 OKF frontmatter 透传）。
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type AssertEq<A, B> = Equals<A, B> extends true ? true : ['MISMATCH', A, B]

/** 记忆类型词表（`core/memory/harmonic-types.ts` `HarmonicUnit['type']`）。 */
const MemoryTypeSchema = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('global'),
])

// ── memory.search ───────────────────────────────────────────────────────────

/**
 * 与 `@mafw/sdk` `MemoryUnit` 逐字段等价（必需：id/type/primary_abstraction/
 * cue_anchors/memory_value/energy；salience/created_at 可选）。
 *
 * 注意 handler 的降级分支（`store.read` 返回 null，index 条目仍在）会补一行
 * `{id, type, primary_abstraction, cue_anchors, memory_value: '', energy, tier}` ——
 * `tier` 是索引级字段，不属于 MemoryUnit 承诺；schema 不建模它（JSON Schema 未声明
 * `additionalProperties: false`，多余键不影响校验），MemoryUnit 等价性优先。
 */
const MemoryUnitSchema = Type.Object({
  id: Type.String(),
  type: MemoryTypeSchema,
  primary_abstraction: Type.String(),
  cue_anchors: Type.Array(Type.String()),
  memory_value: Type.String(),
  energy: Type.Number(),
  salience: Type.Optional(Type.Number()),
  created_at: Type.Optional(Type.String()),
})

/**
 * T1 verbatim 命中（`recall/verbatim-recall.ts` `T1Hit`，与 `@mafw/sdk`
 * `T1SearchHit` 逐字段等价）：`traceId` 在 raw dense 命中上可能为 null 或缺省，
 * `sources`/`score` 只在融合（RRF）命中上出现。
 */
const T1SearchHitSchema = Type.Object({
  sessionId: Type.String(),
  turnId: Type.Number(),
  traceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  episodeId: Type.Optional(Type.String()),
  cosine: Type.Number(),
  excerpt: Type.String(),
  sources: Type.Optional(Type.Array(Type.Union([
    Type.Literal('dense'),
    Type.Literal('lexical'),
    Type.Literal('feature'),
    Type.Literal('concept'),
    Type.Literal('actor'),
    Type.Literal('sparse'),
    Type.Literal('neighbor'),
  ]))),
  score: Type.Optional(Type.Number()),
})

/**
 * `GET /api/memory/search?query=&topK=&layer=&retriever=`。
 *
 * handler 三个出口：
 *   - `layer=gist`（默认）→ `{ results }`（t1Results 键不存在）；
 *   - `layer=t1`          → `{ results: [], t1Results }`；
 *   - `layer=both`        → `{ results, t1Results }`。
 * 因此 `t1Results` 只在 layer != gist 时出现 → optional；`results` 恒为数组。
 */
export const MemorySearchResponse = Type.Object({
  results: Type.Array(MemoryUnitSchema),
  t1Results: Type.Optional(Type.Array(T1SearchHitSchema)),
  episodes: Type.Optional(Type.Array(Type.Object({
    episodeId: Type.String(),
    sessionId: Type.String(),
    startTurn: Type.Number(),
    endTurn: Type.Number(),
    status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
    startedAt: Type.Union([Type.Number(), Type.Null()]),
    boundarySource: Type.String(),
    boundaryReason: Type.Optional(Type.String()),
    intent: Type.Optional(Type.String()),
    outcome: Type.Optional(Type.String()),
    actors: Type.Array(Type.String()),
    conceptIds: Type.Array(Type.String()),
    score: Type.Number(),
    sources: Type.Array(Type.String()),
    topTraceIds: Type.Array(Type.String()),
  }))),
  legacyEpisodic: Type.Optional(Type.Array(MemoryUnitSchema)),
})

const EpisodeRecordSchema = Type.Object({
  episodeId: Type.String(),
  sessionId: Type.String(),
  startTurn: Type.Number(),
  endTurn: Type.Number(),
  status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  endedAt: Type.Union([Type.Number(), Type.Null()]),
  goalId: Type.Optional(Type.String()),
  boundarySource: Type.String(),
  boundaryReason: Type.String(),
  confidence: Type.Number(),
  intent: Type.Optional(Type.String()),
  outcome: Type.Optional(Type.String()),
  actors: Type.Array(Type.Object({
    actorId: Type.String(),
    role: Type.String(),
    weight: Type.Number(),
  })),
  conceptIds: Type.Array(Type.String()),
  sourceTraceIds: Type.Array(Type.String()),
})

export const MemoryEpisodesResponse = Type.Object({
  episodes: Type.Array(Type.Object({
    episodeId: Type.String(),
    sessionId: Type.String(),
    startTurn: Type.Number(),
    endTurn: Type.Number(),
    status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
    startedAt: Type.Union([Type.Number(), Type.Null()]),
    boundarySource: Type.String(),
    boundaryReason: Type.Optional(Type.String()),
    intent: Type.Optional(Type.String()),
    outcome: Type.Optional(Type.String()),
    actors: Type.Array(Type.String()),
    conceptIds: Type.Array(Type.String()),
    score: Type.Number(),
    sources: Type.Array(Type.String()),
    topTraceIds: Type.Array(Type.String()),
  })),
  nextCursor: Type.Optional(Type.String()),
})

export const MemoryEpisodeResponse = Type.Object({
  episode: EpisodeRecordSchema,
  members: Type.Array(Type.Object({
    episodeId: Type.String(),
    traceId: Type.String(),
    turnSeq: Type.Number(),
  })),
})

// ── memory.get ──────────────────────────────────────────────────────────────

/**
 * `core/memory/harmonic-types.ts` `HarmonicUnit` 的完整字段面（okf frontmatter 原样）。
 * owner = memory store；`memory.get` 只做 `JSON.parse(result.content[0].text)` 透传。
 * 磁盘上可能存在接口未枚举的残留键（例如 `archived`）——JSON Schema 不声明
 * `additionalProperties: false`，残留键合法，但不属本契约承诺。
 *
 * **E10f-E 编译期桥**：`HarmonicUnitSchema` 不再手工镜像——下方 AssertEq 钉住
 * 它与 store 类型的等价性（`npx tsc --noEmit -p tsconfig.json` 即门禁）。
 * 唯一**有意**的偏差是 `created_at`：E10c 为 legacy OKF 文件（缺该键、store 只回填
 * `updated_at`）把 wire 放宽为 optional，而 `HarmonicUnit` 仍标记 required，
 * 故桥接目标对称剥掉 `created_at` 再比剩余键，并单独断言它是 optional string。
 * 任何**其它**字段的新增/删除/可选性/类型漂移都会让 tsc 红。
 */
const HarmonicUnitSchema = Type.Object({
  id: Type.String(),
  type: MemoryTypeSchema,
  granularity: Type.Optional(Type.Union([
    Type.Literal('function'),
    Type.Literal('class'),
    Type.Literal('module'),
    Type.Literal('architecture'),
  ])),
  primary_abstraction: Type.String(),
  cue_anchors: Type.Array(Type.String()),
  memory_value: Type.String(),
  energy: Type.Number(),
  // 与 recall.pinned 同一 store.read() 来源：legacy OKF 文件可能缺 created_at，
  // store 只回填 updated_at，因此这里与 recall.pinned 保持一致为 optional。
  created_at: Type.Optional(Type.String()),
  updated_at: Type.String(),
  goal_id: Type.Optional(Type.String()),
  merged_from: Type.Optional(Type.Array(Type.String())),
  distinct_from: Type.Optional(Type.Array(Type.String())),
  salience: Type.Optional(Type.Number()),
  abstraction_level: Type.Optional(Type.Number()),
  review_count: Type.Optional(Type.Number()),
  last_reviewed: Type.Optional(Type.String()),
  superseded_by: Type.Optional(Type.String()),
  pinned: Type.Optional(Type.Boolean()),
  sticky_until: Type.Optional(Type.String()),
  source_session_id: Type.Optional(Type.String()),
  source_trace_ids: Type.Optional(Type.Array(Type.String())),
  authority: Type.Optional(Type.Union([
    Type.Literal('user'),
    Type.Literal('agent'),
    Type.Literal('tool'),
    Type.Literal('pipeline'),
  ])),
  distilled_by: Type.Optional(Type.Array(Type.String())),
  commitment_capped_at: Type.Optional(Type.String()),
  novelty: Type.Optional(Type.Number()),
})

/**
 * `HarmonicUnit` 的 wire 投影：除 `created_at` 放宽为 optional（legacy OKF 缺键，见上）外
 * 与 store 类型逐字段等价。用 `Omit` 对称剥掉 `created_at` 再比剩余键，避免把
 * `Omit<…> & {…}` 交集当作比较对象（交集不会被条件类型归一，恒等比较会假红）。
 */
type HarmonicUnitSchemaWire = Omit<Static<typeof HarmonicUnitSchema>, 'created_at'>
type HarmonicUnitStoreShape = Omit<HarmonicUnit, 'created_at'>

/**
 * schema ↔ `HarmonicUnit` 漂移即 gateway tsc 红（`npx tsc --noEmit -p tsconfig.json`）。
 * 换新字段时先改 `core/memory/harmonic-types.ts`，这句会逼你同步 schema。
 */
const _MEMORY_GET_UNIT_SCHEMA_MATCHES_STORE: AssertEq<HarmonicUnitSchemaWire, HarmonicUnitStoreShape> = true

/**
 * 有意偏差的显式断言（E10c）：wire 的 `created_at` 必须是 optional string。
 * 若有人把 schema 改回 required，这里红。
 */
const _MEMORY_GET_CREATED_AT_IS_OPTIONAL: AssertEq<
  Pick<Static<typeof HarmonicUnitSchema>, 'created_at'>,
  { created_at?: string }
> = true
export { _MEMORY_GET_UNIT_SCHEMA_MATCHES_STORE, _MEMORY_GET_CREATED_AT_IS_OPTIONAL }

/**
 * 溯源块（`handleGetMemory`）：exact trace 命中时带 `traces`（最多 5 条，每条
 * excerpt ≤300 字符）；无 exact provenance 时回退 C0 `evidence` 原文片段。
 */
const MemorySourceTraceSchema = Type.Object({
  traceId: Type.String(),
  sessionId: Type.String(),
  turnId: Type.Number(),
  archived: Type.Boolean(),
  excerpt: Type.String(),
})

const MemorySourceSchema = Type.Object({
  sessionId: Type.String(),
  evidence: Type.Optional(Type.String()),
  traces: Type.Optional(Type.Array(MemorySourceTraceSchema)),
})

/** Harmonic 记忆成功体：`memory` 恒有；`latest` 只在 supersede 链非空时；`source` 只在溯源可解时。 */
const MemoryGetUnitBody = Type.Object({
  success: Type.Literal(true),
  memory: HarmonicUnitSchema,
  latest: Type.Optional(HarmonicUnitSchema),
  source: Type.Optional(MemorySourceSchema),
})

/** t1 行（`t1_archive` rows 投影）：legacy 指针只有 source/content。 */
const T1RowSchema = Type.Object({
  source: Type.String(),
  content: Type.String(),
})

/** 永久 trace 指针的行：额外带 observationKey（observation 身份行）。 */
const T1TraceRowSchema = Type.Object({
  source: Type.String(),
  content: Type.String(),
  observationKey: Type.Optional(Type.String()),
})

/**
 * legacy 会话尾指针 `t1:<sessionTail>:<turnId>` 的成功体（resolveT1）。
 * `traceId` 只在首行带 trace 时出现。
 */
const MemoryGetT1LegacyBody = Type.Object({
  success: Type.Literal(true),
  t1: Type.Object({
    sessionId: Type.String(),
    turnId: Type.Number(),
    traceId: Type.Optional(Type.String()),
    rows: Type.Array(T1RowSchema),
  }),
})

/** 永久指针 `t1:<traceId>` 的成功体（readTrace）：带归档/legacy 歧义标记。 */
const MemoryGetT1TraceBody = Type.Object({
  success: Type.Literal(true),
  t1: Type.Object({
    traceId: Type.String(),
    sessionId: Type.String(),
    turnId: Type.Number(),
    archived: Type.Boolean(),
    legacyAmbiguous: Type.Boolean(),
    rows: Type.Array(T1TraceRowSchema),
  }),
})

/**
 * `GET /api/memory/get?id=` 的 200 成功体 = 三种互斥变体（handler 的三条成功返回）：
 *   1. Harmonic 记忆（+ 可选 latest / source）；
 *   2. legacy t1 会话尾指针；
 *   3. 永久 t1 trace 指针。
 * 用 union 而不是"全 optional 的宽松对象"，避免把三种形状摊平成一种。
 *
 * **失败体不在这里**：`isError` 时 handler 回 404，body 是
 * `{ success: false, error, candidates? }`（含 ambiguous tail 的候选列表）；
 * 它属于错误响应，不是 `RouteDef.response`（200 schema）的一部分。
 */
export const MemoryGetResponse = Type.Union([
  MemoryGetUnitBody,
  MemoryGetT1LegacyBody,
  MemoryGetT1TraceBody,
])
