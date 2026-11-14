/**
 * E10f-B：project / manager / command / file-history 读面（4 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - mafwCommands.list    → routes/mafw-commands.ts `handleMafwCommandList()`（registry.list()）
 *   - manager.session      → routes/manager-session.ts（?projectDir= 单项目对象 / 无过滤数组）
 *   - project.current      → routes/projects.ts（current-project kv self-heal 后的投影）
 *   - fileHistory.list     → core/file-history/file-history-service.ts `list()`（最新在前）
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （`MafwCommandDef` / `ManagerSessionInfo` / `Project` 的公开面）。fileHistory 没有
 * SDK client（`tags: internal`）→ schema-only。
 */
import { Type } from '@sinclair/typebox'

// ── mafwCommands.list ───────────────────────────────────────────────────────

/** `MafwCommandDef`（commands/registry.ts）：内置与自定义命令共用同一张元数据表。 */
const MafwCommandDefSchema = Type.Object({
  name: Type.String(),
  aliases: Type.Optional(Type.Array(Type.String())),
  description: Type.String(),
  /** 安全提示（`<目标>` / `<worktree路径> [strategy]`）。 */
  argumentHint: Type.Optional(Type.String()),
  category: Type.Union([
    Type.Literal('goals'),
    Type.Literal('session'),
    Type.Literal('memory'),
    Type.Literal('custom'),
  ]),
  /** 破坏性参数：客户端据此弹确认。 */
  destructive: Type.Optional(Type.Boolean()),
  kind: Type.Union([Type.Literal('builtin'), Type.Literal('custom')]),
  /** custom：来源文件绝对路径（审计 / 展示用）。 */
  source: Type.Optional(Type.String()),
})

/** `GET /api/mafw-commands` → `{commands: MafwCommandDef[]}`。 */
export const MafwCommandsListResponse = Type.Object({
  commands: Type.Array(MafwCommandDefSchema),
})

// ── manager.session ─────────────────────────────────────────────────────────

/**
 * Lead / manager 槽位行（`LeadSessionRegistry.current()` 投影）。
 *
 * `createdAt` handler 用 `?? null` 显式补空，所以键恒在、值可为 null
 * （SDK `ManagerSessionInfo.createdAt` 是 optional —— 见 AssertEq 的字段级锁定）。
 */
const ManagerSessionEntrySchema = Type.Object({
  projectDir: Type.String(),
  /** 历史字段名 camelCase `sessionId`（wire 稳定，不要改成 sessionID）。 */
  sessionId: Type.String(),
  createdAt: Type.Union([Type.String(), Type.Null()]),
})

/**
 * `GET /api/manager/session`：
 *   - `?projectDir=` → 单项目对象（未知项目 404）；
 *   - 无过滤 → **数组**（空 → 404）。
 * 404/500 是错误信封，不是 200 形态。
 */
export const ManagerSessionResponse = Type.Union([
  ManagerSessionEntrySchema,
  Type.Array(ManagerSessionEntrySchema),
])

// ── project.current ─────────────────────────────────────────────────────────

/**
 * 当前项目行：`id` / `worktree` 同值（= 规范化目录），`mafwDir` 是注册时记录的
 * `.mafw` 目录（Rail 打开项目用）。无当前项目时 `{project:null}`。
 */
const CurrentProjectSchema = Type.Object({
  id: Type.String(),
  worktree: Type.String(),
  mafwDir: Type.String(),
})

export const ProjectCurrentResponse = Type.Object({
  project: Type.Union([CurrentProjectSchema, Type.Null()]),
})

// ── fileHistory.list ────────────────────────────────────────────────────────

/**
 * `FileHistoryEntry`（file-history-service.ts）：服务端持久化索引的原始行。
 * `blob` 是内容 sha256（客户端拿它做去重，不直接取字节）；`seq` 只用于同毫秒排序。
 */
const FileHistoryEntrySchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  projectDir: Type.String(),
  /** 项目内相对路径（统一 `/` 分隔）。 */
  rel: Type.String(),
  blob: Type.String(),
  size: Type.Number(),
  mtimeMs: Type.Number(),
  createdAt: Type.String(),
  seq: Type.Number(),
  reason: Type.String(),
})

/** `GET /api/file-history` → `{entries: FileHistoryEntry[]}`（最新在前）。 */
export const FileHistoryListResponse = Type.Object({
  entries: Type.Array(FileHistoryEntrySchema),
})
