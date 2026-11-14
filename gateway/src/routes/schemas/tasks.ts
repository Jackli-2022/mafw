/**
 * E10f-A：durable task 读面（3 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - tasks.list / tasks.get → routes/tasks.ts + runtime/task-service.ts `publicTask()`
 *   - tasks.output           → runtime/task-service.ts `output()`（终态快照 / runtime shell 透传）
 *
 * `@mafw/sdk` `TaskEntity` 只承诺公开生命周期字段；`publicTask()` 额外下发输出快照游标
 * （`outputCursor` / `outputSize` / `outputTruncated`）——那是 gateway 持久化的旁账，
 * 故契约面按 optional 承诺，`contract-compat.checks.ts` 用 Omit 锁等价。
 */
import { Type } from '@sinclair/typebox'

const TaskKindSchema = Type.Union([Type.Literal('shell'), Type.Literal('subagent')])

/** `TaskStatus`（task-service）：working / input_required 都表示运行中。 */
const TaskStatusSchema = Type.Union([
  Type.Literal('working'),
  Type.Literal('input_required'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
])

/** `TaskEntity`（`publicTask()` 已剥 `output` / `resumeAt`，其余字段原样下发）。 */
const TaskEntitySchema = Type.Object({
  id: Type.String(),
  kind: TaskKindSchema,
  parentSessionID: Type.String(),
  childSessionID: Type.Optional(Type.String()),
  shellID: Type.Optional(Type.String()),
  title: Type.String(),
  status: TaskStatusSchema,
  directory: Type.Optional(Type.String()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  finishedAt: Type.Optional(Type.Number()),
  exitCode: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** 终态 shell 的有界输出快照游标（内部旁账，SDK DTO 不暴露）。 */
  outputCursor: Type.Optional(Type.Number()),
  outputSize: Type.Optional(Type.Number()),
  outputTruncated: Type.Optional(Type.Boolean()),
})

export const TaskListResponse = Type.Object({
  items: Type.Array(TaskEntitySchema),
})

export const TaskGetResponse = TaskEntitySchema

/**
 * 边界形状（owner = runtime shell surface `session.shell.output`）。
 *
 * - 终态 task 命中本地快照 → MAFW 自有 `{ output, cursor, size, truncated }`；
 * - 活动 task → `deps.shell.output()` **原样透传**（字段随 runtime 变化，游标语义是 UTF-8 字节）。
 *
 * 因此已知四字段全部 optional + 开放索引：不把 runtime 原生 output DTO 钉成 MAFW 契约。
 */
export const TaskOutputResponse = Type.Object({
  output: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.Number()),
  size: Type.Optional(Type.Number()),
  truncated: Type.Optional(Type.Boolean()),
}, { additionalProperties: true })
