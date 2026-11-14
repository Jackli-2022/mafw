/**
 * E10g-W6：platform 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 覆盖 config / project / manager / commands 四个 gateway 平台面。只有声明，
 * 不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/config.ts`、`http/transport.ts` 的 `/register` 分支、
 * `routes/manager-rotate.ts`、`routes/mafw-commands.ts`）。
 */
import { Type } from '@sinclair/typebox'

// ── config.set ────────────────────────────────────────────────────────────

/**
 * `PUT /api/config`（handler：`routes/config.ts` `config.set`）。
 *
 * body 是**整份 gateway 配置覆盖文档**：handler `JSON.parse` 后
 * `yaml.dump(overrides)` 写到 `<dataRoot>/config.yaml` 再 `config.reload()`
 * （`restartRequired` 非空时 200 仍然返回，只是提示需要重启）。
 * 它不做任何字段校验：未知键原样落盘、缺省键回退内置默认值。
 *
 * 因此这里只声明已知的**顶层分区**（`GatewayConfig`，`src/config.ts`），
 * 子结构留给 `config.reload()`；`additionalProperties:true` 是必须的——
 * 未来分区与插件自定义键都允许落盘，收窄会立刻比 handler 更严。
 */
const ConfigSection = (description: string) => Type.Optional(Type.Unknown({ description }))

export const ConfigSetRequest = Type.Object({
  server: ConfigSection('HTTP/CORS/serve ports and apiToken.'),
  paths: ConfigSection('Project and data-root paths (the data root is fixed to ~/.mafw).'),
  timeouts: ConfigSection('serve / session / goal timeouts.'),
  loop: ConfigSection('Loop round caps and degradation factors.'),
  goal: ConfigSection('Goal node model overrides and eval switches.'),
  mobile: ConfigSection('Mobile pairing URL override.'),
  search: ConfigSection('Default retriever / reranker / topK.'),
  memory: ConfigSection('Memory pipeline parameters.'),
  decay: ConfigSection('CATD topology-weighted decay.'),
  llm: ConfigSection('Default provider/model and token caps.'),
  logging: ConfigSection('Log directory, rotation size and level.'),
  mcpserver: ConfigSection('MCP server metadata.'),
  metrics: ConfigSection('In-memory metrics retention.'),
  chat: ConfigSection('Chat command keywords.'),
  manager: ConfigSection('Manager session wake/report cadence.'),
  recall: ConfigSection('Recall instruction surface, worker and boundary-recall parameters.'),
  usage: ConfigSection('Usage accounting parameters.'),
  trajectory: ConfigSection('Trajectory rebuild parameters.'),
  approval: ConfigSection('Approval policy parameters.'),
  media: ConfigSection('Media / TTS engine configuration.'),
  cognition: ConfigSection('Declarative cognition rules (validateRules is authoritative).'),
  events: ConfigSection('Persistent event log switches and retention.'),
  runtime: ConfigSection('Active runtime plugin name and per-plugin config index.'),
  alignment: ConfigSection('Alignment weights file.'),
  resources: ConfigSection('Resource ledger watermarks and connection/quota limits (0 = unlimited).'),
  env: ConfigSection('Environment mirror (MAFW_* paths and switches).'),
}, {
  additionalProperties: true,
  description: 'Gateway config overrides persisted to config.yaml. Unknown keys are written verbatim; omitted keys fall back to defaults.',
})

// ── project.setCurrent ────────────────────────────────────────────────────

/**
 * `POST /register`（handler：`http/transport.ts` 的 `/register` 分支 →
 * `parseRegisterIntent`，`runtime/project-selection.ts`）。
 *
 * 两个调用方共用：插件激活时的自动注册与桌面 Rail 的显式切换
 * （SDK `project.setCurrent`）。`setCurrent` 缺省 false —— 自动注册只登记。
 * `projectDir` / `mafwDir` trim 后都必须非空（否则 400）；
 * `setCurrent:true` 时 `projectDir` 必须是绝对路径且不是 runtime root
 * （基础设施目录 400），home 下的标准数据目录也拒绝（400）。
 */
export const ProjectSetCurrentRequest = Type.Object({
  projectDir: Type.String({
    minLength: 1,
    description: 'Absolute project directory to register.',
  }),
  mafwDir: Type.String({
    minLength: 1,
    description: 'Project-level .mafw data directory.',
  }),
  setCurrent: Type.Optional(Type.Boolean({
    description: 'Switch the current project (default false: registration only).',
  })),
})

// ── manager.rotate ────────────────────────────────────────────────────────

/**
 * `POST /api/manager/session/rotate`（handler：
 * `routes/manager-rotate.ts` `handleManagerRotate`）。
 *
 * 每个项目首次调用在锁内懒建 manager 会话（`created:'initial'`），之后把旧
 * Lead 归档并新建（`created:'rotated'` + `previousSessionId`）。
 * `projectDir` 缺失/空白 → 400；body 解析失败按 `{}` 继续（同样 400）。
 */
export const ManagerRotateRequest = Type.Object({
  projectDir: Type.String({
    minLength: 1,
    description: 'Project whose manager (Lead) session should be rotated.',
  }),
})

// ── mafwCommands.run ──────────────────────────────────────────────────────

/**
 * `POST /api/mafw-commands/run`（handler：`routes/mafw-commands.ts`
 * `attachMafwCommandRoutes` → `handleMafwCommandRun`）。
 *
 * `command` 转小写后查注册表（内置 + 自定义），未知命令 → 400
 * `Unknown command: <name>`；`args` 原样 trim 后交给 handler；
 * `sessionID` 用于 hold-queue 预检（挂起会话 → 409，不执行命令）。
 * `projectDir` 不是 body 字段：由 gateway 的注册项目解析。
 */
export const MafwCommandRunRequest = Type.Object({
  command: Type.String({
    minLength: 1,
    description: 'Command name including the leading slash form the UI sends (resolved case-insensitively).',
  }),
  args: Type.Optional(Type.String({
    description: 'Raw argument string, trimmed and passed to the command handler.',
  })),
  sessionID: Type.Optional(Type.String({
    description: 'Session context; a suspended session short-circuits with 409 before running.',
  })),
})
