/**
 * E10d-1：memory 扩展读接口（4 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - memory.mergedSearch          → routes/memory.ts + memory/service.ts `mergedSearch`
 *                                    → `interceptors/memory-injector.ts` `MemoryFact`
 *   - memory.getEnergyDistribution → routes/memory.ts（HarmonicUnitFileStore 索引分桶）
 *   - memory.getL5Axioms           → routes/memory.ts + core/memory/l5-store.ts `getTop`
 *   - memory.listSticky            → routes/memory.ts + routes/note-board.ts `handleNoteBoard`
 *
 * 四条都有 SDK client 方法，DTO 在 `packages/gateway-sdk/src/types.ts`
 * （`MemoryFact` / `EnergyDistribution` / `Axiom` / `L5Heuristic` / `StickyNote`），
 * 逐字段等价由 `contract-compat.checks.ts` 的 AssertEq 钉住。
 *
 * 失败体不在 200 schema 内：mergedSearch / getEnergyDistribution 的 503（记忆服务缺失）
 * 与 500 回 `{error}`；listSticky 反常——503 与 catch 分支都回**同形**的
 * `{entries: [], budget}`（fail-open shell），故 200 schema 恰好也描述了这两个降级体。
 */
import { Type } from '@sinclair/typebox'

/** 记忆类型词表（`core/memory/harmonic-types.ts` `HarmonicUnit['type']`）。 */
const MemoryTypeSchema = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('global'),
])

// ── memory.mergedSearch ─────────────────────────────────────────────────────

/**
 * `MemoryFact`（`interceptors/memory-injector.ts`）：
 * `createMemorySearch` 只产两种 source —— `parametric`（L3 delta 行，type 恒为 `'delta'`）
 * 与 `harmonic`（索引命中，type 为记忆类型词表）。handler 上 `type` 是裸 `string`
 * （接口未收窄），因此契约面按 `string` 承诺、不枚举值域。
 */
const MemoryFactSchema = Type.Object({
  source: Type.Union([Type.Literal('parametric'), Type.Literal('harmonic')]),
  type: Type.String(),
  content: Type.String(),
  energy: Type.Number(),
})

/**
 * `GET /api/memory/merged-search?query=&maxFacts=` —— memory context injection 的合并结果
 * （delta + 索引，按 energy 降序后截断到 maxFacts，maxFacts 默认 5）。
 */
export const MemoryMergedSearchResponse = Type.Object({
  results: Type.Array(MemoryFactSchema),
})

// ── memory.getEnergyDistribution ────────────────────────────────────────────

/**
 * `GET /api/memory/energy-distribution` —— 索引条目按 energy 四桶计数
 * （≥0.8 critical / ≥0.6 high / ≥0.4 medium / 其余 low）+ `total`。
 * 分桶来自索引行（不是 OKF 正文），`total` 恒为索引条目数。
 */
export const MemoryEnergyDistributionResponse = Type.Object({
  critical: Type.Number(),
  high: Type.Number(),
  medium: Type.Number(),
  low: Type.Number(),
  total: Type.Number(),
})

// ── memory.getL5Axioms ──────────────────────────────────────────────────────

/**
 * `L5Axiom`（`core/memory/l5-store.ts`）：`addAxiom` 恒写 id/content/source/energy/created_at。
 * `src/axioms.json` 若被更早版本/手工编辑写过，可能缺 `source` / `created_at`；此处按
 * store 写入面承诺为必填（SDK `Axiom` 同步补齐这两列）——file 是持久层，不是 wire。
 */
const L5AxiomSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  source: Type.Union([Type.Literal('manual'), Type.Literal('distilled')]),
  energy: Type.Number(),
  created_at: Type.String(),
})

/**
 * `L5Heuristic`（同一 store）：`addHeuristic` 恒写七列（`success_rate` 初值 0.9、
 * `source_goal_ids` 来自触发目标）。SDK `L5Heuristic` 历史上把 `success_rate` /
 * `source_goal_ids` / `created_at` 标 optional，E10d-1 起按 handler 真值收紧为必填。
 */
const L5HeuristicSchema = Type.Object({
  id: Type.String(),
  pattern: Type.String(),
  trigger_context: Type.Array(Type.String()),
  success_rate: Type.Number(),
  source_goal_ids: Type.Array(Type.String()),
  energy: Type.Number(),
  created_at: Type.String(),
})

/**
 * `GET /api/l5/axioms?topK=` —— `L5Store.getTop(topK)` 的 `{axioms, heuristics}` 原样透传
 * （各自按 energy 降序，topK 默认 10）。两条数组都恒发（无数据即空数组）。
 */
export const MemoryL5AxiomsResponse = Type.Object({
  axioms: Type.Array(L5AxiomSchema),
  heuristics: Type.Array(L5HeuristicSchema),
})

// ── memory.listSticky ───────────────────────────────────────────────────────

/**
 * note-board 条目 = `Pick<HarmonicUnit, 'id' | 'type' | 'primary_abstraction' |
 * 'memory_value' | 'energy' | 'created_at' | 'sticky_until'>`（`handleNoteBoard` 投影）。
 * `created_at` 在 legacy OKF 文件上可能缺省（与 memory.get / recall.pinned 同一保守处理），
 * `sticky_until` 由 index 行回填但类型上仍可缺省 → 两者 optional。
 */
const StickyNoteSchema = Type.Object({
  id: Type.String(),
  type: MemoryTypeSchema,
  primary_abstraction: Type.String(),
  memory_value: Type.String(),
  energy: Type.Number(),
  created_at: Type.Optional(Type.String()),
  sticky_until: Type.Optional(Type.String()),
})

/**
 * `GET /api/memory/sticky` —— note-board 结构化列表（desktop dock 用）。
 *
 * `entries` 只含**排版后仍上板**的条目（`formatNoteBoard` 的 `used` 截断，超预算的条目
 * 只记日志）；`budget.max` / `budget.maxChars` / `budget.perNoteCap` 是常量预算
 * （`NOTE_BOARD_BUDGET`），`budget.used` 是收录条数。`perNoteCap` 是防饿死关键：
 * 无上限时一条超长便签吃光总预算、后续条目全被丢弃。wire 恒为
 * `{ ...NOTE_BOARD_BUDGET, used }`（E10f-E 建模，原来只声明三键）。
 * 503（记忆服务缺失）与 catch 分支都回 `{entries: [], budget: emptyNoteBoardBudget()}`
 * ——与 200 同形，故单个 schema 覆盖两种降级体。
 */
export const MemoryStickyResponse = Type.Object({
  entries: Type.Array(StickyNoteSchema),
  budget: Type.Object({
    max: Type.Number(),
    maxChars: Type.Number(),
    perNoteCap: Type.Number(),
    used: Type.Number(),
  }),
})
