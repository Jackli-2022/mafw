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
 * E10h-P0 `POST /api/tasks` 的 200 响应（handler 事实源：`routes/tasks.ts`
 * `handleTaskSubmit` → `TaskService.submit` → `publicTask(task)`）。
 *
 * 与 `tasks.get` 完全同形：没有信封，task 就是 body（SDK `tasks.submit()` 直接
 * 返回 `TaskEntity`）。submit 只是把新任务写进表并进入 `working`（subagent 派生
 * 失败时立即 `failed` + `finishedAt`/`error`），输出游标仍是终态旁账。
 */
export const TaskSubmitResponse = TaskEntitySchema

/**
 * E10h-R2 `POST /api/tasks/:id/cancel` 的 200 响应（handler 事实源：`routes/tasks.ts`
 * `handleTaskCancel` → `TaskService.cancel` → `publicTask(task)`）。
 *
 * 与 `tasks.get` 同形：取消后回任务本体（终态 `cancelled`；已终态任务原样回，
 * 不报 409）。`{ok:true}` 会与 wire 不符——这里没有信封。
 */
export const TaskCancelResponse = TaskEntitySchema

/**
 * E10h-R2 `POST /api/tasks/:id/message` 的 200 响应（handler 事实源：
 * `TaskService.message` 成功即 `json(200, {ok:true})`；非 subagent / 空消息 400）。
 */
export const TaskMessageResponse = Type.Object({
  ok: Type.Literal(true),
})

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

/**
 * E10g-P0 `POST /api/tasks` 请求体（handler 事实源：routes/tasks.ts
 * `handleTaskSubmit` → `TaskService.submit`）。
 *
 * 顶层必填 `kind` + `parentSessionID`；`shell` 需要非空 `command`、`subagent`
 * 需要非空 `prompt`——条件必填由 service 校验（400），声明面保留 optional +
 * description，不伪造 oneOf，避免契约比 handler 更严。
 */
export const TaskSubmitRequest = Type.Object({
  kind: TaskKindSchema,
  parentSessionID: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  command: Type.Optional(Type.String({ description: 'Required when kind is "shell".' })),
  cwd: Type.Optional(Type.String()),
  timeout: Type.Optional(Type.Number()),
  prompt: Type.Optional(Type.String({ description: 'Required when kind is "subagent".' })),
  agent: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  model: Type.Optional(Type.Object({
    providerID: Type.String(),
    modelID: Type.String(),
  })),
  outputSchema: Type.Optional(Type.Object({
    name: Type.Optional(Type.String()),
    schema: Type.Record(Type.String(), Type.Unknown()),
    retryCount: Type.Optional(Type.Number()),
  })),
})
