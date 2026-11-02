/**
 * 中性 DTO 归一（Task 12）。
 *
 * TUI 只消费 MAFW View DTO；本模块把 gateway 现役的 provider/agent/permission
 * 响应形状（opencode 对象映射 + pi 数组 / 原生字段 / 已归一 DTO）收敛到
 * `@mafw/sdk` 的官方类型。归一在客户端摄取层完成，渲染/命令层只读规范形。
 */
import type {
  MafwAgent,
  MafwModel,
  MafwPermissionRequest,
  MafwProvider,
  MafwSuggestedRule,
} from '@mafw/sdk'

type Rec = Record<string, any>

function asRecord(v: unknown): Rec | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// ── permission ────────────────────────────────────────────────

/**
 * 权限请求归一：pi `{requestId, toolName, args, risk}` / opencode
 * `{id, permission, patterns, always}` / 已归一 MAFW DTO 均收敛到
 * `MafwPermissionRequest`。无法识别时返回 null（调用方不得伪造请求）。
 */
export function normalizePermissionRequest(raw: unknown): MafwPermissionRequest | null {
  const r = asRecord(raw)
  if (!r) return null

  const extensions: Rec = { ...(asRecord(r.extensions) ?? {}) }
  const mafwPolicy = asRecord(r.mafwPolicy)
  if (mafwPolicy) extensions.mafwPolicy = mafwPolicy
  const ext = Object.keys(extensions).length > 0 ? { extensions } : {}

  // 已归一：id + kind + targets
  if (typeof r.id === 'string' && typeof r.kind === 'string' && Array.isArray(r.targets)) {
    return {
      id: r.id,
      sessionID: str(r.sessionID),
      kind: r.kind,
      targets: r.targets.map(String),
      ...(asRecord(r.suggestedRule) ? { suggestedRule: r.suggestedRule as unknown as MafwSuggestedRule } : {}),
      ...(asRecord(r.tool) ? { tool: r.tool as MafwPermissionRequest['tool'] } : {}),
      ...(asRecord(r.time) ? { time: r.time as MafwPermissionRequest['time'] } : {}),
      ...ext,
    }
  }

  const id = typeof r.id === 'string' ? r.id : typeof r.requestId === 'string' ? r.requestId : ''
  if (!id) return null
  const sessionID = str(r.sessionID)

  // pi：requestId + toolName + args
  if (typeof r.toolName === 'string') {
    const args = asRecord(r.args) ?? {}
    return {
      id,
      sessionID,
      kind: r.toolName,
      targets: permissionTargets(args),
      suggestedRule: { scope: 'tool', value: r.toolName },
      ...ext,
    }
  }

  // opencode：permission + patterns / always
  const kind = str(r.permission) || str(r.kind) || 'tool'
  const targets = Array.isArray(r.patterns)
    ? r.patterns.map(String)
    : Array.isArray(r.targets) ? r.targets.map(String) : []
  const always = Array.isArray(r.always) ? r.always.find((x) => typeof x === 'string') : undefined
  return {
    id,
    sessionID,
    kind,
    targets,
    ...(typeof always === 'string' ? { suggestedRule: { scope: 'prefix', value: always } } : {}),
    ...(asRecord(r.tool) ? { tool: r.tool as MafwPermissionRequest['tool'] } : {}),
    ...(asRecord(r.time) ? { time: r.time as MafwPermissionRequest['time'] } : {}),
    ...ext,
  }
}

/** 从工具入参提取可展示目标（命令 / 路径 / URL）；未知形状返回空数组。 */
function permissionTargets(args: Rec): string[] {
  const keys = ['command', 'cmd', 'script', 'path', 'filePath', 'file_path', 'url', 'pattern', 'query']
  const out: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value) out.push(value)
  }
  return out
}

// ── provider ──────────────────────────────────────────────────

/**
 * provider 归一：models 恒为数组（opencode 对象映射 / pi 数组同形）。
 * 顶层信封 `{all, connected, default}` 的 `connected` 只在非空时下发给各行
 * （空 = 未知，不能伪造 `connected: false`）。
 */
export function normalizeProviders(raw: unknown): MafwProvider[] {
  const rec = asRecord(raw)
  const list = asArray(raw) ?? asArray(rec?.all) ?? asArray(rec?.items) ?? []
  const connected = asArray(rec?.connected)
    ?.filter((id): id is string => typeof id === 'string') ?? []
  const connectedSet = new Set(connected)

  const out: MafwProvider[] = []
  for (const item of list) {
    const p = asRecord(item)
    if (!p) continue
    const id = str(p.id)
    if (!id) continue
    out.push({
      id,
      name: str(p.name) || id,
      models: normalizeModels(p.models, id),
      ...(connectedSet.size > 0 ? { connected: connectedSet.has(id) } : {}),
      ...(asRecord(p.extensions) ? { extensions: p.extensions } : {}),
    })
  }
  return out
}

function normalizeModels(raw: unknown, providerID: string): MafwModel[] {
  const entries: Array<[string, unknown]> = []
  const list = asArray(raw)
  if (list) {
    for (const item of list) entries.push(['', item])
  } else {
    const map = asRecord(raw)
    if (map) for (const [key, value] of Object.entries(map)) entries.push([key, value])
  }

  const models: MafwModel[] = []
  for (const [key, item] of entries) {
    const m = asRecord(item)
    if (!m) continue
    const id = str(m.id) || key
    if (!id) continue
    const limit = asRecord(m.limit)
    const contextLimit = num(limit?.context) ?? num(m.contextLimit)
    const outputLimit = num(limit?.output) ?? num(m.outputLimit)
    models.push({
      id,
      name: str(m.name) || id,
      providerID,
      ...(contextLimit !== undefined ? { contextLimit } : {}),
      ...(outputLimit !== undefined ? { outputLimit } : {}),
      ...(asRecord(m.extensions) ? { extensions: m.extensions } : {}),
    })
  }
  return models
}

export interface ProviderModelOption {
  value: string
  label: string
  description: string
}

/** /model picker 选项：provider/model 稳定 value；未连接 provider 不出现。 */
export function providerModelOptions(raw: unknown): ProviderModelOption[] {
  const out: ProviderModelOption[] = []
  for (const provider of normalizeProviders(raw)) {
    if (provider.connected === false) continue
    for (const model of provider.models) {
      out.push({
        value: `${provider.id}/${model.id}`,
        label: model.name || model.id,
        description: provider.id,
      })
    }
  }
  return out
}

/** 状态栏默认模型标签（中性 default 引用；缺省返回空串）。 */
export function providerDefaultModelLabel(raw: unknown): string {
  const rec = asRecord(raw)
  const def = asRecord(rec?.default)
  const id = str(def?.modelID) || str(def?.id) || str(def?.model)
  return id
}

// ── agent ─────────────────────────────────────────────────────

/**
 * agent 归一：runtime 原生 `{id, name, mode, hidden}` 与 MAFW 注册表身份
 * `{name, scope, materialized}` 统一为 `MafwAgent`；已是 DTO 时透传。
 */
export function normalizeAgents(raw: unknown): MafwAgent[] {
  const rec = asRecord(raw)
  const list = asArray(raw) ?? asArray(rec?.items) ?? []
  const out: MafwAgent[] = []
  for (const item of list) {
    const a = asRecord(item)
    if (!a) continue
    if (typeof a.id === 'string' && typeof a.label === 'string' && typeof a.selectable === 'boolean') {
      out.push(a as unknown as MafwAgent)
      continue
    }
    const id = str(a.id) || str(a.name)
    if (!id) continue
    const label = str(a.label) || str(a.name) || id
    // 注册表身份没有 id（只有 name + scope/materialized）；runtime 条目带 id。
    const isRegistry = !str(a.id) && (a.scope !== undefined || a.materialized !== undefined || a.source === 'mafw')
    const source: MafwAgent['source'] = a.source === 'mafw' || isRegistry ? 'mafw' : 'runtime'
    const selectable = typeof a.selectable === 'boolean'
      ? a.selectable
      : source === 'mafw'
        ? a.materialized !== false && a.scope !== 'subagent'
        : a.hidden !== true && a.mode !== 'subagent'
    out.push({
      id,
      label,
      source,
      selectable,
      ...(str(a.description) ? { description: str(a.description) } : {}),
      ...(str(a.mode) || str(a.scope) ? { mode: str(a.mode) || str(a.scope) } : {}),
      ...(asRecord(a.model) ? { model: a.model as MafwAgent['model'] } : {}),
      ...(asRecord(a.extensions) ? { extensions: a.extensions } : {}),
    })
  }
  return out
}
