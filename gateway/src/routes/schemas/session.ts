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

/**
 * `POST /api/session` 的 200 响应（E10h-P0，handler 事实源：`routes/session-create.ts`）。
 *
 * handler 下发 `{ ...result.session, worktree: result.worktree }`：
 *   - 会话半边与 `session.get` 同形（SDK `session.create()` 把它当 `Session` 读）；
 *   - `worktree` 只在 `worktree:true|<slug>` 创建成功时存在，普通创建**没有该键**
 *     （`JSON.stringify` 会丢掉 `undefined`），因此 optional —— 客户端不得假定
 *     `worktree` 恒在（desktop 的 `createSession()` 只读 `r.id`）。
 *
 * `dir` 是 worktree 的绝对路径、`branch` 是 `mafw/<slug>` 分支名（manager 的
 * `WorktreeRef` 去掉 `worktreeDir` 命名）。
 */
export const SessionCreateResponse = Type.Composite([
  SessionSchema,
  Type.Object({
    worktree: Type.Optional(Type.Object({
      dir: Type.String(),
      branch: Type.String(),
    })),
  }),
])

/**
 * E8-3 `GET /api/sessions/:id/messages` —— MAFW flat 历史（`{data, nextCursor}`）。
 *
 * 形状来源：`routes/session-history.ts` 的单一出口（handler 是事实源）。
 * `data` 的每一项是 `@mafw/sdk` 的 `MafwMessage`；`content` 的 part 判别联合由
 * `contract/view-dto.json` 拥有，schema 只声明 SDK 边界守卫 `isMafwMessage()` 认可的
 * 最小形状（`type` 必填 + 其余字段开放），避免在这里复制一份会漂移的 part 联合。
 */
const MafwDiffSchema = Type.Object({
  file: Type.String(),
  patch: Type.Optional(Type.String()),
  additions: Type.Optional(Type.Number()),
  deletions: Type.Optional(Type.Number()),
  status: Type.Optional(DiffStatus),
})

const StopReason = Type.Union([
  Type.Literal('end_turn'),
  Type.Literal('max_tokens'),
  Type.Literal('tool_use'),
  Type.Literal('refusal'),
  Type.Literal('cancelled'),
  Type.Literal('error'),
  Type.Literal('unknown'),
])

/** 边界形状：part 的 `type` 由 runtime 归一化，业务字段由客户端 `narrowMafwPart` 收窄。 */
const MafwPartBoundary = Type.Object({
  id: Type.Optional(Type.String()),
  type: Type.String(),
}, { additionalProperties: true })

const MafwMessageSchema = Type.Object({
  id: Type.Optional(Type.String()),
  sessionID: Type.Optional(Type.String()),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  parentID: Type.Optional(Type.String()),
  content: Type.Optional(Type.Array(MafwPartBoundary)),
  time: Type.Optional(Type.Object({
    created: Type.Optional(Type.Number()),
    updated: Type.Optional(Type.Number()),
    completed: Type.Optional(Type.Number()),
  })),
  model: Type.Optional(Type.Object({
    providerID: Type.String(),
    modelID: Type.String(),
    variant: Type.Optional(Type.String()),
  })),
  agent: Type.Optional(Type.String()),
  stopReason: Type.Optional(StopReason),
  summary: Type.Optional(Type.Object({
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    diffs: Type.Optional(Type.Array(MafwDiffSchema)),
  })),
  error: Type.Optional(Type.Object({
    kind: Type.String(),
    message: Type.String(),
  })),
  snapshot: Type.Optional(Type.Object({
    start: Type.Optional(Type.String()),
    end: Type.Optional(Type.String()),
    files: Type.Optional(Type.Array(Type.Unknown())),
  })),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * E10g-P0 `POST /api/session` 请求体（handler 事实源：routes/session-create.ts →
 * createSessionWithWorktree()）。
 *
 * `directory` 必填且必须是绝对路径（AGENTS 硬不变量，handler 先判 400）；
 * `worktree` 为 true 时建分支 worktree，字符串则作为 slug；`metadata` 原样
 * 透传给 runtime session.create。只声明、不运行时校验。
 */
export const SessionCreateRequest = Type.Object({
  directory: Type.String({
    minLength: 1,
    pattern: '^(?:[A-Za-z]:[\\\\/]|[\\\\/])',
    description: 'Absolute project directory path (drive, POSIX root, or UNC).',
  }),
  worktree: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const SessionMessagesResponse = Type.Object({
  data: Type.Array(MafwMessageSchema),
  // handler 的 flat 出口恒带 nextCursor（末页为 null）。
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
