/**
 * E10g-W4：decision 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 字段面来自 `routes/decisions.ts`（`handleDecisionDraft` /
 * `handleDecisionMutation`）与 `core/decision/decision-record-service.ts` 的
 * 归一化边界（`requireText` / `optionalText` / `dateText` / `normalizeOptions` /
 * `normalizeEvidence` / `normalizeRevision`）——service 的 400 是条件必填的事实源。
 *
 * 只有声明，不做运行时校验。`projectDir` 在四条路由上都可缺省：handler 的
 * `projectDirOf` 会回退 `MAFW_PROJECT_DIR` → cwd，因此不声明为必填。
 *
 * 人审：confirm / shelve / reopen 是 human-only（`decisions.ts` 用
 * `isHumanPrincipal` + `humanOnlyDenied`）；body 里只要出现非空 `actorSessionID`
 * 就 403，所以该字段**不声明**（禁止字段，不是可选字段）。
 *
 * 分类（与 W2/W3 同口径）：
 *   - JSON body（required:true）：draft（`kind` + `question` 缺失 400）、
 *     shelve（`reviewAt` 缺失 400）；
 *   - 可选 body（有字段 + `requestRequired:false`）：confirm / reopen ——
 *     字段都是补充说明（rationale / consequences / reviewAt / note），
 *     body 缺省时仍是一次合法的人审决定。
 */
import { Type } from '@sinclair/typebox'

/** `DecisionKind`（`core/decision/decision-record.ts`）：service 用 `KINDS` 收窄。 */
const DecisionKindSchema = Type.Union([
  Type.Literal('direction'),
  Type.Literal('plan'),
  Type.Literal('scope'),
  Type.Literal('authorization'),
  Type.Literal('acceptance'),
  Type.Literal('priority'),
  Type.Literal('disposition'),
  Type.Literal('other'),
])

/** `DecisionRecordOption`；`id` / `title` 非空，`risks` 逐条非空（service 400）。 */
const DecisionOptionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80 }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  summary: Type.Optional(Type.String({ maxLength: 4000 })),
  risks: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }))),
})

/** `DecisionRecordEvidence`：`kind` 闭集，`ref` 非空。 */
const DecisionEvidenceSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('message'),
    Type.Literal('file'),
    Type.Literal('change'),
    Type.Literal('review_item'),
    Type.Literal('goal'),
  ]),
  ref: Type.String({ minLength: 1, maxLength: 1000 }),
  label: Type.Optional(Type.String({ maxLength: 200 })),
})

const ProjectDir = Type.Optional(Type.String({
  description: 'Defaults to MAFW_PROJECT_DIR / cwd when absent (handler projectDirOf).',
}))

// ── decisions.draft ───────────────────────────────────────────────────────

/**
 * `POST /api/decisions`（handler：`routes/decisions.ts` `handleDecisionDraft`）。
 * `kind` 必须是八类之一、`question` 非空（≤500）；`options` ≤8、`evidence` ≤12；
 * `revision` 必须是正整数（null 表示不绑定 revision）；`source` 只决定 history
 * 里的 authored by（缺省 agent）。
 */
export const DecisionDraftRequest = Type.Object({
  projectDir: ProjectDir,
  goalId: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  revision: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  kind: DecisionKindSchema,
  question: Type.String({ minLength: 1, maxLength: 500 }),
  options: Type.Optional(Type.Array(DecisionOptionSchema, { maxItems: 8 })),
  evidence: Type.Optional(Type.Array(DecisionEvidenceSchema, { maxItems: 12 })),
  rationale: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  consequences: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  reviewAt: Type.Optional(Type.Union([Type.String(), Type.Null()], {
    description: 'ISO date for the review reminder; invalid dates are 400.',
  })),
  source: Type.Optional(Type.Union([Type.Literal('agent'), Type.Literal('user')])),
})

// ── decisions.confirm ─────────────────────────────────────────────────────

/**
 * `POST /api/decisions/:id/confirm`（human-only）。仅 draft 可确认（否则 409）。
 * 显式 `null` 会清空对应字段（confirm 的 rationale / consequences 覆盖语义），
 * `reviewAt` 为 null 时保留原值。
 */
export const DecisionConfirmRequest = Type.Object({
  projectDir: ProjectDir,
  rationale: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  consequences: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  reviewAt: Type.Optional(Type.Union([Type.String(), Type.Null()], {
    description: 'ISO date; null keeps the draft value.',
  })),
})

// ── decisions.shelve ──────────────────────────────────────────────────────

/**
 * `POST /api/decisions/:id/shelve`（human-only）。仅 draft 可搁置（否则 409）；
 * `reviewAt` 是重新审视时间，缺省/非法 → 400。
 */
export const DecisionShelveRequest = Type.Object({
  projectDir: ProjectDir,
  reviewAt: Type.String({ description: 'Required ISO date (when the shelved record resurfaces).' }),
  note: Type.Optional(Type.String({ maxLength: 4000 })),
})

// ── decisions.reopen ──────────────────────────────────────────────────────

/**
 * `POST /api/decisions/:id/reopen`（human-only）。仅 decided / shelved 可重开
 * （否则 409），`note` 只进入 history。
 */
export const DecisionReopenRequest = Type.Object({
  projectDir: ProjectDir,
  note: Type.Optional(Type.String({ maxLength: 4000 })),
})
