/**
 * Experience store —— 前端唯一的能力/动作来源。
 * loading 与 unsupported 分离；runtime 切换/重连必须 invalidate 以防旧响应覆盖。
 */
import type { ActionDescriptor, ExperienceActionId, ExperienceActionsResponse } from '@mafw/sdk'

export type ExperienceStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export interface ExperienceState {
  status: ExperienceStatus
  version?: string
  sessionID?: string
  actions: Partial<Record<ExperienceActionId, ActionDescriptor>>
  error?: string
}

export interface ExperienceStore {
  state(): ExperienceState
  load(sessionID?: string): Promise<void>
  invalidate(): void
  isEnabled(id: ExperienceActionId): boolean
  action(id: ExperienceActionId): ActionDescriptor | undefined
}

export function createExperienceStore(
  loader: (sessionID?: string) => Promise<ExperienceActionsResponse>,
): ExperienceStore {
  let current: ExperienceState = { status: 'idle', actions: {} }
  let generation = 0

  return {
    state: () => current,
    async load(sessionID?: string) {
      const gen = ++generation
      current = { ...current, status: 'loading', sessionID, error: undefined }
      try {
        const result = await loader(sessionID)
        if (gen !== generation) return
        current = {
          status: 'ready',
          version: result.experienceVersion,
          sessionID: result.sessionID ?? sessionID,
          actions: result.actions ?? {},
        }
      } catch (err: any) {
        if (gen !== generation) return
        current = {
          status: err?.status === 404 || /\b404\b|not found/i.test(String(err?.message ?? '')) ? 'unavailable' : 'error',
          sessionID,
          actions: {},
          error: err?.message ?? String(err),
        }
      }
    },
    invalidate() {
      generation++
      current = { status: 'idle', actions: {} }
    },
    isEnabled(id) {
      return current.status === 'ready' && current.actions[id]?.enabled === true
    },
    action(id) {
      return current.actions[id]
    },
  }
}

function apiLoader(sessionID?: string) {
  return (globalThis as any).window?.api?.mafw?.experience?.actions(sessionID) as Promise<ExperienceActionsResponse>
}

export const experienceStore = createExperienceStore(apiLoader)
