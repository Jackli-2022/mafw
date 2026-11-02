/**
 * TUI Experience store（Task 12）——框架无关的动作面状态机。
 *
 * 职责：读 `GET /api/experience/actions` 的版本化 Action Descriptor，向命令层
 * 提供 `supported/enabled` 门；不读 runtime 名或裸 capabilities。
 *
 * 客户端状态（`status`）与动作描述分离（spec §6.3）：
 *   idle / loading / ready / unavailable / incompatible / error
 *  - `unavailable` = 旧网关没有此契约（404 / HTML）
 *  - `incompatible` = 网关要求更高的客户端 Experience 版本
 *  - `error` = 网络/解析失败
 * 三者都给中性门禁文案，绝不伪造 ActionDescriptor，也不回退到旧业务推导。
 */
import {
  EXPERIENCE_VERSION,
  MIN_CLIENT_EXPERIENCE_VERSION,
  type ActionDescriptor,
  type ActionUnavailableReason,
  type ExperienceActionId,
} from '@mafw/sdk'

export type ExperienceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'incompatible'
  | 'error'

export interface ExperienceActionsPayload {
  experienceVersion: string
  minClientVersion?: string
  sessionID?: string
  actions?: Partial<Record<ExperienceActionId, ActionDescriptor>>
}

export interface ExperienceClient {
  experience: {
    actions(sessionID?: string): Promise<ExperienceActionsPayload>
  }
}

export interface TuiExperienceStoreOptions {
  /** 状态/动作面变化后的回调（UI 重绘用）。 */
  onChange?: () => void
  /** 客户端实现的 Experience 版本（测试可覆盖；缺省 = SDK EXPERIENCE_VERSION）。 */
  clientVersion?: string
  /**
   * 动作快照有效期。命令门在读取前按 TTL 重拉，避免 busy 等瞬时状态长期缓存
   * （Experience 的 `enabled` 是服务端投影时刻的事实）。0 = 每次都重拉。
   */
  ttlMs?: number
  now?: () => number
}

/** 动作的人类可读名（中性文案；不含 runtime 名）。 */
export const EXPERIENCE_ACTION_TITLES: Record<ExperienceActionId, string> = {
  'checkpoint.restore': '恢复检查点',
  'checkpoint.create': '创建检查点',
  'branch.fork': '分叉会话',
  'branch.revert': '回退会话',
  'branch.unrevert': '恢复回退',
  'branch.diff': '查看改动',
  'run.control': '暂停/恢复回合',
  'session.worktree': '并行工作区',
  'session.summarize': '压缩会话',
  'session.switch-agent': '切换 Agent',
  'session.switch-model': '切换模型',
  'session.discovery': '读取命令与技能',
  'approval.permission': '审批回复',
  'approval.question': '回答提问',
  'background.jobs': '后台任务',
  'terminal.attach': '打开终端',
  'prompt.steer': '插话',
  'session.background': '转后台执行',
  'mcp.manage': 'MCP 管理',
  'mcp.config.write': 'MCP 配置写入',
}

const REASON_TEXT: Record<ActionUnavailableReason, string> = {
  unsupported: '当前运行时不支持',
  busy: '会话正忙，请稍后再试',
  'missing-data': '缺少必要数据',
  'non-invertible-patch': '该改动不可逆',
  unsafe: '当前上下文不允许',
}

export function experienceReasonText(reason?: string): string {
  if (reason && reason in REASON_TEXT) return REASON_TEXT[reason as ActionUnavailableReason]
  return '当前不可用'
}

/** 逐段数值比较（'2026.11.1' > '2026.11.0'；缺失段按 0）。 */
export function compareExperienceVersions(a: string, b: string): number {
  const pa = String(a || '').split('.')
  const pb = String(b || '').split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = parseInt(pa[i] ?? '0', 10) || 0
    const y = parseInt(pb[i] ?? '0', 10) || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

function isUnavailableError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err ?? '')
  return /^HTTP 404\b/.test(message) || /Received HTML instead of JSON/.test(message)
}

export class TuiExperienceStore {
  private _status: ExperienceStatus = 'idle'
  private _actions: Partial<Record<ExperienceActionId, ActionDescriptor>> = {}
  private _version = ''
  private sessionID: string | null = null
  private generation = 0
  private loadedAt = 0
  private inflight: Promise<void> | null = null
  private client: ExperienceClient
  private onChange: () => void
  private clientVersion: string
  private ttlMs: number
  private now: () => number

  constructor(client: ExperienceClient, opts: TuiExperienceStoreOptions = {}) {
    this.client = client
    this.onChange = opts.onChange ?? (() => {})
    this.clientVersion = opts.clientVersion ?? EXPERIENCE_VERSION
    this.ttlMs = opts.ttlMs ?? 5000
    this.now = opts.now ?? (() => Date.now())
  }

  get status(): ExperienceStatus { return this._status }
  get version(): string { return this._version }
  get session(): string | null { return this.sessionID }

  /** 加载（或重载）指定会话的动作面；旧代际响应不会覆盖新状态。 */
  async load(sessionID: string | null): Promise<void> {
    this.sessionID = sessionID
    const gen = ++this.generation
    this._status = 'loading'
    this.onChange()

    const promise = (async () => {
      try {
        const res = await this.client.experience.actions(sessionID ?? undefined)
        if (gen !== this.generation) return
        const min = typeof res?.minClientVersion === 'string'
          ? res.minClientVersion
          : MIN_CLIENT_EXPERIENCE_VERSION
        this._version = String(res?.experienceVersion ?? '')
        if (compareExperienceVersions(this.clientVersion, min) < 0) {
          this._actions = {}
          this._status = 'incompatible'
          return
        }
        this._actions = (res?.actions ?? {}) as Partial<Record<ExperienceActionId, ActionDescriptor>>
        this._status = 'ready'
        this.loadedAt = this.now()
      } catch (err) {
        if (gen !== this.generation) return
        this._actions = {}
        this._status = isUnavailableError(err) ? 'unavailable' : 'error'
      } finally {
        if (gen === this.generation) {
          this.inflight = null
          this.onChange()
        }
      }
    })()

    this.inflight = promise
    await promise
  }

  /**
   * 作用域失效（会话切换 / runtime 切换 / SSE 重连）：
   * 清空动作面并推进代际，下一次 gate 会重新加载。
   */
  invalidate(): void {
    this.generation++
    this._actions = {}
    this._status = 'idle'
    this.inflight = null
    this.loadedAt = 0
    this.onChange()
  }

  action(id: ExperienceActionId): ActionDescriptor | null {
    if (this._status !== 'ready') return null
    return this._actions[id] ?? null
  }

  /** 功能面是否存在（不看瞬时 enabled）。 */
  supported(id: ExperienceActionId): boolean {
    const desc = this.action(id)
    return desc !== null && desc.supported === true
  }

  /** 此刻是否可执行（supported && enabled）。 */
  enabled(id: ExperienceActionId): boolean {
    const desc = this.action(id)
    return desc !== null && desc.supported === true && desc.enabled === true
  }

  /**
   * 命令门：返回 null = 允许执行；否则返回中性不可用文案。
   * 调用方拿到非 null 时**不得发送请求**。
   */
  async gate(id: ExperienceActionId): Promise<string | null> {
    if (this._status !== 'ready' || this.isStale()) await this.ensureLoaded()

    const title = EXPERIENCE_ACTION_TITLES[id] ?? id
    if (this._status === 'incompatible') return `${title}不可用（客户端与网关的契约版本不兼容）`
    if (this._status === 'unavailable') return `${title}不可用（网关未提供此契约，请升级网关）`
    if (this._status !== 'ready') return `${title}不可用（暂时无法确认可用性）`

    const desc = this._actions[id]
    if (!desc) return `${title}不支持`
    if (!desc.supported) return `${title}不支持`
    if (!desc.enabled) return `${title}暂不可用（${experienceReasonText(desc.reason)}）`
    return null
  }

  private isStale(): boolean {
    if (this.ttlMs <= 0) return true
    return this.now() - this.loadedAt > this.ttlMs
  }

  private async ensureLoaded(): Promise<void> {
    if (this._status === 'loading' && this.inflight) {
      await this.inflight
      return
    }
    await this.load(this.sessionID)
  }
}
