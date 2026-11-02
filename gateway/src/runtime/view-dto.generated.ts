/** AUTO-GENERATED from packages/gateway-sdk/src/view-dto.ts — run npm run sync:view-dto. */

/** 契约版本（与生成的 `contract/view-dto.json` 的 contractVersion 保持一致）。 */
export const VIEW_DTO_CONTRACT_VERSION = '2026.11.0' as const

/** 回合终态（MAFW 中性词汇；与 session-ui `util/stop-reason.ts` 同源）。 */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'refusal'
  | 'cancelled'
  | 'error'
  | 'unknown'

/** 中性模型引用（消息/会话所属模型）。 */
export interface MafwModelRef {
  providerID: string
  modelID: string
  /** 同一模型的推理变体标识（opencode variant；可缺省）。 */
  variant?: string
}

/** 部件/工具状态的时间戳（毫秒）。 */
export interface MafwPartTime {
  start?: number
  end?: number
}

/** 工具语义类别（与 gateway `runtime/tool-classes.ts` 的 TOOL_CLASS 同词汇）。 */
export type MafwToolClass =
  | 'readonly'
  | 'search'
  | 'file-edit'
  | 'shell'
  | 'subagent'
  | 'web'
  | 'plan'
  | 'other'

/** token 用量（trajectory / 上下文占用主干字段；缺省字段 = 未知，不补 0）。 */
export interface MafwTokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
  total?: number
}

/** 工具执行状态（pending/running/completed/error 为唯一状态集）。 */
export type MafwToolStatus = 'pending' | 'running' | 'completed' | 'error'

export interface MafwToolState {
  status: MafwToolStatus
  /** 工具入参（runtime 归一后的对象/标量；不再暴露原生包装）。 */
  input?: unknown
  /** 未结构化的原始参数串（runtime 直接给出时保留，供审计展示）。 */
  raw?: string
  output?: string
  error?: string
  title?: string
  metadata?: Record<string, unknown>
  time?: MafwPartTime
}

/** 文件 part 的引用来源（opencode source / pi 路径提示的归一）。 */
export interface MafwFileSource {
  kind: 'file' | 'symbol' | 'resource' | 'unknown'
  path?: string
  /** 引用在源文件中的区间（行号语义由 adapter 声明，客户端只做展示）。 */
  text?: { start?: number; end?: number }
}

/** 部件身份主干：id 必须稳定（桌面按 part.id upsert、live/历史按 id 去重）。 */
export interface MafwPartBase {
  id: string
  sessionID?: string
  messageID?: string
  /** reasoning/thinking 连续性签名（provider opaque，允许保留）。 */
  signature?: string
  /** 受控扩展槽（Ingress 过滤后列入契约）；不得承载通用原生载荷。 */
  extensions?: Record<string, unknown>
}

/**
 * 消息部件判别联合（现役 part 全覆盖）。
 *
 * 未知 part 类型不入联合——边界守卫仍放行（`isMafwPart` 只证明形状），
 * 消费方要已知变体语义时用 `narrowMafwPart` 显式收窄。
 */
export type MafwPart =
  | (MafwPartBase & {
      type: 'text'
      text: string
      /** 非用户输入产生的文本（注入/系统提示回显）。 */
      synthetic?: boolean
      time?: MafwPartTime
    })
  | (MafwPartBase & {
      type: 'reasoning'
      text: string
      synthetic?: boolean
      time?: MafwPartTime
    })
  | (MafwPartBase & {
      type: 'tool'
      callID: string
      tool: string
      toolClass?: MafwToolClass
      /** 中性工具身份（跨 runtime 别名归一后的规范名，如 bash）。 */
      canonicalTool?: string
      state: MafwToolState
    })
  | (MafwPartBase & {
      type: 'file'
      mime: string
      url: string
      filename?: string
      source?: MafwFileSource
    })
  | (MafwPartBase & { type: 'step-start'; time?: MafwPartTime })
  | (MafwPartBase & {
      type: 'step-finish'
      /** runtime finish 原值（诊断用；业务判断走 MafwMessage.stopReason）。 */
      reason?: string
      cost?: number
      tokens?: MafwTokenUsage
      time?: MafwPartTime
    })
  | (MafwPartBase & { type: 'compaction'; auto?: boolean; overflow?: boolean })
  | (MafwPartBase & {
      type: 'agent'
      name: string
      source?: { value?: string; start?: number; end?: number }
    })
  /** T2-3：类型化自定义数据（AI SDK 6 `data-<name>` 语义；id 调和 + transient）。 */
  | (MafwPartBase & {
      type: `data-${string}`
      data: unknown
      transient?: boolean
    })

/** 消息错误（中性 kind/message；原生错误类名不入业务面）。 */
export interface MafwMessageError {
  /** 中性错误分类（如 abort / provider / rate-limit / unknown）。 */
  kind: string
  message: string
}

/** 文件变更视图（会话 diff / summary.diffs 共用）。 */
export type MafwDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'

export interface MafwDiff {
  file: string
  patch?: string
  additions?: number
  deletions?: number
  status?: MafwDiffStatus
}

export interface MafwMessage {
  /** 事件载荷形态可缺省（parts 经 part.updated 单独流）；历史形态必有。 */
  id?: string
  sessionID?: string
  role: 'user' | 'assistant'
  parentID?: string
  /** 内容：历史响应恒为数组；事件快照可缺省（由事件类型区分）。 */
  content?: MafwPart[]
  time?: { created?: number; updated?: number; completed?: number }
  /** 中性模型归属（user/assistant 同形，不再分别读原生字段）。 */
  model?: MafwModelRef
  agent?: string
  /** 回合终态（MAFW stop reason；中止不靠原生错误字符串分支）。 */
  stopReason?: StopReason
  summary?: { title?: string; body?: string; diffs?: MafwDiff[] }
  error?: MafwMessageError
  extensions?: Record<string, unknown>
}

/** 会话状态（loading/error/unavailable 属客户端 store 状态，不在此枚举）。 */
export type MafwSessionStatus = 'idle' | 'busy' | 'retry' | 'unknown'

/** 会话回退状态（中性字段；UI 不读原生 `info.revert`）。 */
export interface MafwSessionRevert {
  /** 历史保留到该消息（含）为止。 */
  messageID: string
  partID?: string
  diffs?: MafwDiff[]
}

export interface MafwSession {
  id: string
  status: MafwSessionStatus
  title?: string
  projectID?: string
  directory?: string
  parentID?: string
  /** 派生血缘深度（root 0，直接子会话 1）。 */
  depth?: number
  agent?: string
  model?: MafwModelRef
  time?: { created?: number; updated?: number }
  reverted?: MafwSessionRevert
  summary?: { title?: string; diffs?: MafwDiff[] }
  extensions?: Record<string, unknown>
}

/**
 * 检查点只读视图（spec §5.1）。
 *
 * 只暴露中性事实：`filesAvailable` 表达该边界是否存在文件快照（UI 不用
 * `snapshotTree`/`kind` 反推动作），对象级恢复动作由 Experience 给出。
 */
export interface MafwCheckpoint {
  id: string
  sessionID: string
  /** 历史保留边界（含该消息）。 */
  anchorMessageID: string
  kind: 'auto' | 'manual'
  createdAt: string
  /** 该边界是否存在文件快照（false = 只能恢复对话）。 */
  filesAvailable: boolean
  /** 创建时不在版本控制内的文件数量（restore 残留报告基线；不暴露路径）。 */
  untrackedCount?: number
}

export interface MafwModel {
  id: string
  name: string
  providerID?: string
  contextLimit?: number
  outputLimit?: number
  extensions?: Record<string, unknown>
}

/** provider：models 恒为数组（不再出现对象映射与数组两种形状）。 */
export interface MafwProvider {
  id: string
  name: string
  models: MafwModel[]
  connected?: boolean
  extensions?: Record<string, unknown>
}

export type MafwAgentSource = 'mafw' | 'runtime'

export interface MafwAgent {
  id: string
  label: string
  description?: string
  source: MafwAgentSource
  /** 是否可被用户选中（primary/subagent 区分由此表达，不在业务代码硬编码）。 */
  selectable: boolean
  mode?: string
  model?: MafwModelRef
  extensions?: Record<string, unknown>
}

/** 可沉淀规则提示（tool=整个工具，prefix=命令/路径前缀）。 */
export interface MafwSuggestedRule {
  scope: 'tool' | 'prefix'
  value: string
}

/** 权限请求（opencode patterns / pi toolName 归一为 kind + targets）。 */
export interface MafwPermissionRequest {
  id: string
  sessionID: string
  /** 中性权限种类（bash / edit / webfetch / …）。 */
  kind: string
  /** 受影响目标：命令文本 / 路径 / URL 等。 */
  targets: string[]
  suggestedRule?: MafwSuggestedRule
  tool?: { messageID: string; callID: string }
  time?: { created?: number }
  extensions?: Record<string, unknown>
}

export interface MafwQuestionOption {
  label: string
  description?: string
}

export interface MafwQuestionInfo {
  question: string
  header?: string
  options: MafwQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface MafwQuestionRequest {
  id: string
  sessionID: string
  questions: MafwQuestionInfo[]
  tool?: { messageID: string; callID: string }
  time?: { created?: number }
  extensions?: Record<string, unknown>
}

/** background job 来源（runtime shell / MAFW 持久任务 / SSE 派生子代理）。 */
export type MafwBackgroundJobSource = 'runtime-shell' | 'mafw-task' | 'subagent'

/** 状态机（working/input_required 归一为 running）。 */
export type MafwBackgroundJobStatus =
  | 'running'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface MafwBackgroundJob {
  /** 稳定 id（同一作业跨源合并后不变）。 */
  id: string
  source: MafwBackgroundJobSource
  kind: 'shell' | 'subagent'
  status: MafwBackgroundJobStatus
  sessionID: string
  title?: string
  /** shell 作业的命令文本。 */
  command?: string
  /** 合并保留定位信息：runtime shell 原生 id / MAFW 任务 id / 子会话 id。 */
  runtimeShellID?: string
  taskID?: string
  childSessionID?: string
  time?: { created?: number; updated?: number; completed?: number }
  /** 输出游标（下一次 output 读取的起点）。 */
  cursor?: number
  exitCode?: number
  extensions?: Record<string, unknown>
}

/**
 * 单类 DTO 的字段清单。
 *
 * `required` 是 `VIEW_DTO_REQUIRED_FIELDS` 的数据来源；`fields` 是全部顶层
 * 字段（含可选，用于 golden/契约消费方）；`variants` 只用于判别联合
 * （部件各变体自己的字段）。
 */
export interface ViewDtoFieldSpec {
  readonly required: readonly string[]
  readonly fields: readonly string[]
  readonly variants?: Record<string, readonly string[]>
}

/** 契约字段清单（`contract/view-dto.json` 的唯一数据源）。 */
export const VIEW_DTO_FIELD_INVENTORY = {
  message: {
    required: ['role'],
    fields: [
      'id', 'sessionID', 'role', 'parentID', 'content', 'time',
      'model', 'agent', 'stopReason', 'summary', 'error', 'extensions',
    ],
  },
  part: {
    required: ['id', 'type'],
    fields: ['id', 'sessionID', 'messageID', 'signature', 'extensions', 'type'],
    variants: {
      text: ['text', 'synthetic', 'time'],
      reasoning: ['text', 'synthetic', 'time'],
      tool: ['callID', 'tool', 'toolClass', 'canonicalTool', 'state'],
      file: ['mime', 'url', 'filename', 'source'],
      'step-start': ['time'],
      'step-finish': ['reason', 'cost', 'tokens', 'time'],
      compaction: ['auto', 'overflow'],
      agent: ['name', 'source'],
      'data-*': ['data', 'transient'],
    },
  },
  model: {
    required: ['id', 'name'],
    fields: ['id', 'name', 'providerID', 'contextLimit', 'outputLimit', 'extensions'],
  },
  session: {
    required: ['id', 'status'],
    fields: [
      'id', 'status', 'title', 'projectID', 'directory', 'parentID', 'depth',
      'agent', 'model', 'time', 'reverted', 'summary', 'extensions',
    ],
  },
  checkpoint: {
    required: ['id', 'sessionID', 'anchorMessageID', 'kind', 'createdAt', 'filesAvailable'],
    fields: [
      'id', 'sessionID', 'anchorMessageID', 'kind', 'createdAt',
      'filesAvailable', 'untrackedCount',
    ],
  },
  diff: {
    required: ['file'],
    fields: ['file', 'patch', 'additions', 'deletions', 'status'],
  },
  provider: {
    required: ['id', 'name', 'models'],
    fields: ['id', 'name', 'models', 'connected', 'extensions'],
  },
  agent: {
    required: ['id', 'label', 'source', 'selectable'],
    fields: [
      'id', 'label', 'description', 'source', 'selectable', 'mode',
      'model', 'extensions',
    ],
  },
  permission: {
    required: ['id', 'sessionID', 'kind', 'targets'],
    fields: [
      'id', 'sessionID', 'kind', 'targets', 'suggestedRule', 'tool',
      'time', 'extensions',
    ],
  },
  question: {
    required: ['id', 'sessionID', 'questions'],
    fields: ['id', 'sessionID', 'questions', 'tool', 'time', 'extensions'],
  },
  background: {
    required: ['id', 'source', 'kind', 'status', 'sessionID'],
    fields: [
      'id', 'source', 'kind', 'status', 'sessionID', 'title', 'command',
      'runtimeShellID', 'taskID', 'childSessionID', 'time', 'cursor',
      'exitCode', 'extensions',
    ],
  },
} as const satisfies Record<string, ViewDtoFieldSpec>

/** 契约必填字段清单（`VIEW_DTO_FIELD_INVENTORY.required` 的 TypeScript 投影）。 */
export const VIEW_DTO_REQUIRED_FIELDS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(VIEW_DTO_FIELD_INVENTORY).map(
    ([name, spec]) => [name, spec.required] as [string, readonly string[]],
  ),
)

/**
 * 契约 JSON 数据源（`npm run emit:view-dto` 用它写出
 * `packages/gateway-sdk/contract/view-dto.json`；测试用它做 freshness 对比）。
 */
export function viewDtoContract(): {
  contractVersion: string
} & typeof VIEW_DTO_FIELD_INVENTORY {
  return { contractVersion: VIEW_DTO_CONTRACT_VERSION, ...VIEW_DTO_FIELD_INVENTORY }
}

/**
 * 部件边界形状：守卫能证明的最小事实（`id`/`type` 为 string），其余字段未知。
 *
 * 额外字段用索引签名诚实表达（不是声明 `native` 作为契约字段——那是被禁止的
 * 通用原生载荷；这里只是承认「未知字段可能存在，消费方不得直接信任」）。
 */
export interface MafwPartShape {
  id: string
  type: string
  sessionID?: string
  messageID?: string
  signature?: string
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

/** 消息边界形状：`role` 合法、`content`（若存在）由合法部件形状组成。 */
export interface MafwMessageShape {
  role: 'user' | 'assistant'
  content?: MafwPartShape[]
  id?: string
  sessionID?: string
  [key: string]: unknown
}

const PART_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'completed',
  'error',
])

/**
 * 部件结构守卫：只证明边界形状（`MafwPartShape`），不谎称收窄到 `MafwPart`。
 * 已知变体语义（tool 的 callID/state 等）用 `narrowMafwPart` 显式校验。
 */
export function isMafwPart(v: unknown): v is MafwPartShape {
  if (v === null || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.id === 'string' && typeof p.type === 'string'
}

/** 消息结构守卫：`role ∈ user|assistant`；`content`（若存在）为合法部件形状。 */
export function isMafwMessage(v: unknown): v is MafwMessageShape {
  if (v === null || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  if (m.role !== 'user' && m.role !== 'assistant') return false
  if (m.content !== undefined) {
    if (!Array.isArray(m.content)) return false
    if (!(m.content as unknown[]).every((p) => isMafwPart(p))) return false
  }
  return true
}

/**
 * 显式收窄到已知部件变体（校验该变体的判别字段）。
 *
 * 未知类型（`retry` / `snapshot` / `patch` / `subtask` / 插件自定义 …）返回
 * `null`——调用方决定丢弃、映射或按形状兜底渲染，而不是被守卫骗成已知变体。
 * 可选展示字段（`synthetic` / `time` / `metadata` …）不做深度校验：它们不改变
 * 变体判别，生产方由 Ingress 归一。
 */
export function narrowMafwPart(v: unknown): MafwPart | null {
  if (!isMafwPart(v)) return null
  const p = v
  switch (p.type) {
    case 'text':
    case 'reasoning':
      return typeof p.text === 'string' ? (p as unknown as MafwPart) : null
    case 'tool': {
      if (typeof p.callID !== 'string' || typeof p.tool !== 'string') return null
      const state = p.state
      if (state === null || typeof state !== 'object') return null
      const status = (state as Record<string, unknown>).status
      if (typeof status !== 'string' || !PART_STATUSES.has(status)) return null
      return p as unknown as MafwPart
    }
    case 'file':
      return typeof p.mime === 'string' && typeof p.url === 'string'
        ? (p as unknown as MafwPart)
        : null
    case 'step-start':
    case 'step-finish':
    case 'compaction':
      return p as unknown as MafwPart
    case 'agent':
      return typeof p.name === 'string' ? (p as unknown as MafwPart) : null
    default:
      return p.type.startsWith('data-') && 'data' in p
        ? (p as unknown as MafwPart)
        : null
  }
}

/**
 * 显式收窄到 `MafwMessage`：消息形状合法，且**全部**部件都能收窄到已知变体。
 * 含未知部件类型的消息返回 `null`（调用方保留形状、逐部件处理）。
 */
export function narrowMafwMessage(v: unknown): MafwMessage | null {
  if (!isMafwMessage(v)) return null
  const m = v
  if (m.content === undefined) return m as unknown as MafwMessage
  const parts: MafwPart[] = []
  for (const part of m.content) {
    const known = narrowMafwPart(part)
    if (!known) return null
    parts.push(known)
  }
  return { ...(m as Record<string, unknown>), content: parts } as unknown as MafwMessage
}
