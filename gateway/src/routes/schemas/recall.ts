/**
 * E10c-1：recall 读接口（4 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - recall.context      → routes/recall.ts + recall/inject-format.ts `formatRecallContext`
 *   - recall.pinned       → routes/pinned-recall.ts `handleRecallPinned`
 *   - recall.instructions → routes/recall-instructions.ts（含 render 失败的 fail-open 体）
 *   - recall.priors       → routes/agent-priors.ts `handleAgentPriors`
 *
 * 四个面都是 plugin / pi host extension 的宿主注入通道（tags: internal）；SDK 不调用，
 * 因此没有对应 DTO 可做 AssertEq，等价性由 `tests/unit/api-contract.test.ts` 的
 * property/Value.Check 断言钉住。
 *
 * 四条路由的失败姿态都是 **fail-open 200**（内存服务缺失 / 渲染异常 / 检索异常都回
 * 中性空体），所以没有 4xx/5xx 响应体需要建模。
 */
import { Type } from '@sinclair/typebox'

const MemoryTypeSchema = Type.Union([
  Type.Literal('episodic'),
  Type.Literal('semantic'),
  Type.Literal('procedural'),
  Type.Literal('global'),
])

// ── recall.context ──────────────────────────────────────────────────────────

/**
 * `GET /api/recall/context?query=&sessionID=` —— 边界 recall 的注入块。
 *
 * 只有一个 `pointers` 字段：命中时是渲染后的 markdown 块（`<recall>` 指针 +
 * note-board + goal snapshot + arbiter 注记拼成的单串），无可用记忆时是 `null`。
 * 100ms 硬契约下的 fail-open 出口（异常 / 空 query 且两块都为空）同形，故无分支 schema。
 */
export const RecallContextResponse = Type.Object({
  pointers: Type.Union([Type.String(), Type.Null()]),
})

// ── recall.pinned ───────────────────────────────────────────────────────────

/**
 * pinned 披露层条目（`handleRecallPinned` 的投影，7 字段）：
 * 取 `HarmonicUnit` 的 id/type/primary_abstraction/memory_value/energy/salience/created_at。
 * `salience` 与 `created_at` 在 legacy OKF 文件上可能缺省（`JSON.stringify` 直接省略该键，
 * 与 `MemoryUnit` 的可选原因相同）→ optional。
 */
const PinnedEntrySchema = Type.Object({
  id: Type.String(),
  type: MemoryTypeSchema,
  primary_abstraction: Type.String(),
  memory_value: Type.String(),
  energy: Type.Number(),
  salience: Type.Optional(Type.Number()),
  created_at: Type.Optional(Type.String()),
})

/**
 * `GET /api/recall/pinned` —— 每轮注入的 `<user-profile>` 披露层。
 * `profile` 是渲染后的 profile 串（无 pinned 记忆时为 null）；`budget.used` 是实际
 * 收录条数（超出预算的条目被 formatter 丢弃，只记日志），`max`/`maxChars` 是常量预算。
 *
 * **没有 `perNoteCap`**：pinned 走 `PINNED_BUDGET`（20 条 / 2000 字符），
 * `formatPinnedProfile` 不按条截断（身份陈述必须完整）。note-board 的 `perNoteCap`
 * 只属于 `memory.listSticky` 的 `NOTE_BOARD_BUDGET`；此处加一个不生效的字段
 * 会让 schema 拒绝 handler 自己的输出（E10f-E 记为有意偏离 spec 的一处）。
 */
export const RecallPinnedResponse = Type.Object({
  profile: Type.Union([Type.String(), Type.Null()]),
  entries: Type.Array(PinnedEntrySchema),
  budget: Type.Object({
    max: Type.Number(),
    maxChars: Type.Number(),
    used: Type.Number(),
  }),
})

// ── recall.instructions ─────────────────────────────────────────────────────

/**
 * `GET /api/recall/instructions?sessionID=` —— 三块 instruction block 的缺失面（T2-4 fallback）。
 *
 * handler 恒发 managed/revision/missing/staleKeys/erroredKeys/blocks 六键：
 * `managed:true` 表示插件侧条目齐全（此时 blocks 为空对象）；否则 blocks 只带缺失块。
 * `reason` 只在 inspect 给出原因（如 'render_failed'）时出现。
 */
export const RecallInstructionsResponse = Type.Object({
  managed: Type.Boolean(),
  revision: Type.String(),
  missing: Type.Array(Type.String()),
  staleKeys: Type.Array(Type.String()),
  erroredKeys: Type.Array(Type.String()),
  reason: Type.Optional(Type.String()),
  blocks: Type.Object({
    memoryGuide: Type.Optional(Type.String()),
    userProfile: Type.Optional(Type.String()),
    agentPriors: Type.Optional(Type.String()),
  }),
})

// ── recall.priors ───────────────────────────────────────────────────────────

/**
 * `GET /api/recall/priors` —— W1 `<agent-priors>` 常驻先验块（L5 公理 + L2 失败模式谱）。
 * `block` 是渲染串（无可用公理/模式时为 null）；`used` 是收录条数；`budget` 只承诺
 * 字符上限（`formatAgentPriors` 的常量 800）。
 */
export const RecallPriorsResponse = Type.Object({
  block: Type.Union([Type.String(), Type.Null()]),
  used: Type.Number(),
  budget: Type.Object({
    maxChars: Type.Number(),
  }),
})
