/**
 * Experience store —— 前端唯一的能力/动作来源。
 * loading 与 unsupported 分离；runtime 切换/重连必须 invalidate 以防旧响应覆盖。
 * `supported`（功能性存在）与 `enabled`（此刻可执行）来自 gateway 的 ActionDescriptor，
 * 前端不得再用 runtime 名称/裸 capabilities 推导。
 */
import { createSignal } from 'solid-js'
import type { ActionDescriptor, ExperienceActionId, ExperienceActionsResponse } from '@mafw/sdk'

export type ExperienceStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'incompatible' | 'error'

export interface ExperienceState {
  status: ExperienceStatus
  version?: string
  minClientVersion?: string
  sessionID?: string
  directory?: string
  actions: Partial<Record<ExperienceActionId, ActionDescriptor>>
  error?: string
}

export interface ExperienceLoadOptions {
  directory?: string
}

export interface ExperienceStore {
  state(): ExperienceState
  status(): ExperienceStatus
  load(sessionID?: string, opts?: ExperienceLoadOptions): Promise<void>
  /** 等待进行中的 load；无 in-flight 时立即完成。超时（默认 3s）不 reject。 */
  whenReady(timeoutMs?: number): Promise<void>
  invalidate(): void
  supported(id: ExperienceActionId): boolean
  enabled(id: ExperienceActionId): boolean
  /** @deprecated 使用 enabled（保留旧调用点别名）。 */
  isEnabled(id: ExperienceActionId): boolean
  semantics(id: ExperienceActionId): Record<string, unknown> | undefined
  action(id: ExperienceActionId): ActionDescriptor | undefined
}

export type ExperienceLoader = (
  sessionID?: string,
  opts?: ExperienceLoadOptions,
) => Promise<ExperienceActionsResponse>

/** `2026.11.1` 这类点分数字串比较（段数不同按缺省 0 处理）。 */
export function compareExperienceVersion(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * 客户端实现的 Experience 版本（与 @mafw/sdk `EXPERIENCE_VERSION` 同值）。
 *
 * 不直接 import SDK 的值导出：`@mafw/sdk` 的 dist 是 CJS 计算属性导出，Rollup
 * 静态分析看不到命名导出（renderer 打包会失败）。契约新鲜度由 SDK 单测与
 * `experience-contract.json` 钉扎；这里只用于 incompatible 判定。
 */
export const CLIENT_EXPERIENCE_VERSION = '2026.11.1'

export function isExperienceIncompatible(
  minClientVersion: string | undefined,
  clientVersion = CLIENT_EXPERIENCE_VERSION,
): boolean {
  if (!minClientVersion) return false
  return compareExperienceVersion(minClientVersion, clientVersion) > 0
}

export function createExperienceStore(loader: ExperienceLoader): ExperienceStore {
  const [current, setCurrent] = createSignal<ExperienceState>({ status: 'idle', actions: {} })
  let generation = 0
  let inflight: Promise<void> | null = null

  return {
    state: () => current(),
    status: () => current().status,
    load(sessionID?: string, opts?: ExperienceLoadOptions) {
      const gen = ++generation
      setCurrent({ ...current(), status: 'loading', sessionID, directory: opts?.directory, error: undefined })
      const run = (async () => {
        try {
          const result = await loader(sessionID, opts)
          if (gen !== generation) return
          if (isExperienceIncompatible(result.minClientVersion)) {
            setCurrent({
              status: 'incompatible',
              version: result.experienceVersion,
              minClientVersion: result.minClientVersion,
              sessionID: result.sessionID ?? sessionID,
              directory: opts?.directory,
              actions: {},
              error: `gateway requires experience ${result.minClientVersion}`,
            })
            return
          }
          setCurrent({
            status: 'ready',
            version: result.experienceVersion,
            minClientVersion: result.minClientVersion,
            sessionID: result.sessionID ?? sessionID,
            directory: opts?.directory,
            actions: result.actions ?? {},
          })
        } catch (err: any) {
          if (gen !== generation) return
          setCurrent({
            status: err?.status === 404 || /^not found$|\b404\b|not found/i.test(String(err?.message ?? '')) ? 'unavailable' : 'error',
            sessionID,
            directory: opts?.directory,
            actions: {},
            error: err?.message ?? String(err),
          })
        }
      })()
      inflight = run
      void run.finally(() => { if (inflight === run) inflight = null })
      return run
    },
    whenReady(timeoutMs = 3000) {
      const pending = inflight
      if (!pending) return Promise.resolve()
      const settled = pending.catch(() => {})
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return settled
      return new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(finish, timeoutMs)
        void settled.then(finish)
      })
    },
    invalidate() {
      generation++
      setCurrent({ status: 'idle', actions: {} })
    },
    supported(id) {
      const state = current()
      return state.status === 'ready' && state.actions[id]?.supported === true
    },
    enabled(id) {
      const state = current()
      const action = state.actions[id]
      return state.status === 'ready' && action?.supported === true && action.enabled === true
    },
    isEnabled(id) {
      const state = current()
      const action = state.actions[id]
      return state.status === 'ready' && action?.supported === true && action.enabled === true
    },
    semantics(id) {
      const state = current()
      if (state.status !== 'ready') return undefined
      return state.actions[id]?.semantics
    },
    action(id) {
      return current().actions[id]
    },
  }
}

function apiLoader(sessionID?: string, opts?: ExperienceLoadOptions) {
  return (globalThis as any).window?.api?.mafw?.experience?.actions(sessionID, opts) as Promise<ExperienceActionsResponse>
}

export const experienceStore = createExperienceStore(apiLoader)
