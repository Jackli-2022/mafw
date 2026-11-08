/**
 * Code-first 路由 schema（P0 试点）—— 响应形状的唯一事实源。
 *
 * 约定：
 *   - schema 用 TypeBox 表达，`JSON.stringify` 即 OpenAPI 3.1 可用的 JSON Schema；
 *   - handler 的返回类型由 `Static<typeof Schema>` 约束（写错字段 tsc 红）；
 *   - `emit:openapi` 直接读 RouteDef.response，不再经过 overrides.json。
 *
 * 形状必须与 `@mafw/sdk` 的 `Session` / `MafwSessionRevert` / `MafwDiff` 结构等价——
 * `contract-compat.checks.ts` 的编译期 AssertEq 会钉住（漂移即 tsc 红）。
 */
import { Type } from '@sinclair/typebox'

const SessionStatus = Type.Union([
  Type.Literal('idle'),
  Type.Literal('busy'),
  Type.Literal('retry'),
  Type.Literal('unknown'),
])

const DiffStatus = Type.Union([
  Type.Literal('added'),
  Type.Literal('modified'),
  Type.Literal('deleted'),
  Type.Literal('renamed'),
  Type.Literal('unknown'),
])

const SessionRevert = Type.Object({
  messageID: Type.String(),
  partID: Type.Optional(Type.String()),
  diffs: Type.Optional(Type.Array(Type.Object({
    file: Type.String(),
    patch: Type.Optional(Type.String()),
    additions: Type.Optional(Type.Number()),
    deletions: Type.Optional(Type.Number()),
    status: Type.Optional(DiffStatus),
  }))),
})

/** 会话视图（与 @mafw/sdk `Session` 对齐；后续可由 schema 反向生成 SDK 类型）。 */
export const SessionSchema = Type.Object({
  id: Type.String(),
  projectID: Type.String(),
  directory: Type.String(),
  title: Type.String(),
  time: Type.Object({
    created: Type.Number(),
    updated: Type.Number(),
  }),
  parentID: Type.Optional(Type.String()),
  status: Type.Optional(SessionStatus),
  reverted: Type.Optional(SessionRevert),
  model: Type.Optional(Type.Object({
    providerID: Type.String(),
    modelID: Type.String(),
    variant: Type.Optional(Type.String()),
  })),
  agent: Type.Optional(Type.String()),
})

export const SessionListResponse = Type.Object({
  sessions: Type.Array(SessionSchema),
})
