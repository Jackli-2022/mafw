/**
 * E10f-A：background jobs 读面（2 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状。
 * 形状来源（handler 是事实源）：
 *   - background.jobs.list   → routes/background-jobs.ts → core/background/background-jobs.ts
 *                              `mergeBackgroundJobs()` → `MafwBackgroundJob`
 *   - background.jobs.output → `toBackgroundOutput()` → `MafwBackgroundOutput`
 *
 * 两者都是 MAFW 定义的中性 DTO（runtime shell/subagent 原生形状已在 gateway 消化），
 * 与 `@mafw/sdk` `MafwBackgroundJob` / `MafwBackgroundOutput` 逐字段等价（AssertEq 钉住）。
 */
import { Type } from '@sinclair/typebox'

/** 三源（task / runtime shell / 子代理）合并后的稳定 id 行。 */
const BackgroundJobSchema = Type.Object({
  id: Type.String(),
  source: Type.Union([
    Type.Literal('runtime-shell'),
    Type.Literal('mafw-task'),
    Type.Literal('subagent'),
  ]),
  kind: Type.Union([Type.Literal('shell'), Type.Literal('subagent')]),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('input_required'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
  ]),
  sessionID: Type.String(),
  title: Type.Optional(Type.String()),
  /** shell 作业的启动文本（task 的 metadata.command）。 */
  command: Type.Optional(Type.String()),
  /** 合并行定位信息：runtime shell 原生 id / MAFW task id / 子会话 id。 */
  runtimeShellID: Type.Optional(Type.String()),
  taskID: Type.Optional(Type.String()),
  childSessionID: Type.Optional(Type.String()),
  time: Type.Optional(Type.Object({
    created: Type.Optional(Type.Number()),
    updated: Type.Optional(Type.Number()),
    completed: Type.Optional(Type.Number()),
  })),
  /** 输出游标（下一次 output 读取的起点）。 */
  cursor: Type.Optional(Type.Number()),
  exitCode: Type.Optional(Type.Number()),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const BackgroundJobsListResponse = Type.Object({
  items: Type.Array(BackgroundJobSchema),
})

/**
 * `MafwBackgroundOutput`：游标式增量（cursor 是**下一次读取的字节起点**，
 * 不是已消费长度）；truncated 表示本轮被读取上限截断。
 */
export const BackgroundJobOutputResponse = Type.Object({
  cursor: Type.Number(),
  data: Type.String(),
  truncated: Type.Boolean(),
})
