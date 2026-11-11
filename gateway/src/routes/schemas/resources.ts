/**
 * E4-8 `GET /api/kernel/stats` 响应 schema（TypeBox）。
 *
 * 形状来源是 `resources/stats.ts` 的 `KernelStatsSnapshot`（builder 是事实源）。
 * 只做 OpenAPI 投影，不改变 wire；`emit:openapi` 直接把它写成 200 content schema。
 *
 * 精确度取舍：
 *  - 状态枚举用 Literal union（disk 允许 `unknown`——statfs 失败 fail-open）；
 *  - `heap` 可为 null（采样器还没有样本）；
 *  - `disk.error` 是 `string|null`，不是可选键（builder 把 undefined 归一化成 null）；
 *  - `limits` / `byKind` / `byType` / `byName` 用 `Record(string, number)`：键是
 *    运行时的资源/定时器名，schema 不预先枚举；
 *  - `quotas` 的 `limit: 0` 表示"不限"，所以**不能**给 minimum 1；
 *  - `entries` / `limits` 加 `additionalProperties: true` 给前向兼容（新进程种类、
 *    新连接类别不会让客户端 schema 校验失败）。
 */
import { Type } from '@sinclair/typebox'

const DiskStateSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('warn'),
  Type.Literal('critical'),
  Type.Literal('unknown'),
])

const HeapStateSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('warn'),
  Type.Literal('critical'),
])

const DegradedCodeSchema = Type.Union([
  Type.Literal('disk_critical'),
  Type.Literal('heap_critical'),
])

const DiskSchema = Type.Object({
  totalBytes: Type.Number(),
  freeBytes: Type.Number(),
  state: DiskStateSchema,
  error: Type.Union([Type.String(), Type.Null()]),
})

const HeapSchema = Type.Object({
  heapUsed: Type.Number(),
  heapTotal: Type.Number(),
  rss: Type.Number(),
  external: Type.Number(),
  arrayBuffers: Type.Number(),
  heapLimit: Type.Number(),
  ratio: Type.Number(),
  state: HeapStateSchema,
})

const PressureSchema = Type.Object({
  disk: DiskStateSchema,
  heap: HeapStateSchema,
  degraded: Type.Array(DegradedCodeSchema),
})

const ConnectionsSchema = Type.Object({
  httpOpen: Type.Number(),
  sse: Type.Number(),
  ws: Type.Number(),
  voice: Type.Number(),
  terminal: Type.Number(),
  limits: Type.Object({
    httpConnections: Type.Number(),
    sseClients: Type.Number(),
    wsClients: Type.Number(),
    voiceClients: Type.Number(),
    terminalClients: Type.Number(),
  }, { additionalProperties: true }),
  refused: Type.Record(Type.String(), Type.Number()),
})

const BuffersSchema = Type.Object({
  sseOverflows: Type.Number(),
  sseDropped: Type.Number(),
  sseWriteErrors: Type.Number(),
  sseQueuedFrames: Type.Number(),
  sseQueuedBytes: Type.Number(),
  wsDropped: Type.Number(),
})

const TimersSchema = Type.Object({
  active: Type.Number(),
  byName: Type.Record(Type.String(), Type.Number()),
})

const ProcessEntrySchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([
    Type.Literal('python'),
    Type.Literal('llamacpp'),
    Type.Literal('serve'),
  ]),
  pid: Type.Optional(Type.Number()),
  sessionId: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  owned: Type.Optional(Type.Boolean()),
  startedAt: Type.Number(),
}, { additionalProperties: true })

const ProcessesSchema = Type.Object({
  total: Type.Number(),
  byKind: Type.Record(Type.String(), Type.Number()),
  entries: Type.Array(ProcessEntrySchema),
})

const QuotaEntrySchema = Type.Object({
  current: Type.Number(),
  // 0 = unlimited（配置原样保留），不能给 minimum 1。
  limit: Type.Number(),
})

const QuotasSchema = Type.Object({
  projects: QuotaEntrySchema,
  sessions: QuotaEntrySchema,
  sessionRecordsPerProject: QuotaEntrySchema,
}, { additionalProperties: true })

const HandlesSchema = Type.Object({
  total: Type.Number(),
  byType: Type.Record(Type.String(), Type.Number()),
  fdCount: Type.Optional(Type.Number()),
})

const SchedulerSchema = Type.Object({
  queued: Type.Number(),
  running: Type.Number(),
  byPriority: Type.Record(Type.String(), Type.Number()),
})

const EventsSchema = Type.Object({
  headSeq: Type.Number(),
  appendFailures: Type.Number(),
})

const ServeSchema = Type.Object({
  running: Type.Boolean(),
  owned: Type.Boolean(),
})

export const KernelStatsResponse = Type.Object({
  timestamp: Type.String(),
  uptimeSec: Type.Number(),
  pressure: PressureSchema,
  disk: DiskSchema,
  heap: Type.Union([HeapSchema, Type.Null()]),
  connections: ConnectionsSchema,
  buffers: BuffersSchema,
  timers: TimersSchema,
  processes: ProcessesSchema,
  quotas: QuotasSchema,
  handles: HandlesSchema,
  scheduler: SchedulerSchema,
  events: EventsSchema,
  serve: ServeSchema,
})
