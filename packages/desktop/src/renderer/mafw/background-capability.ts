// 后台作业能力探测（Experience 驱动，不再探测 `/api/shell` REST）。
//
// 两个门：
// - backgroundApi：Experience `background.jobs`（gateway 三源 jobs façade）——
//   列表/输出/终止可用；三态（checking/available/unavailable）供 UI 区分
//   「还在探测」与「明确不可用」，失败 60s 重探、runtime 切换/SSE 重连 reset；
// - canUseBackgroundApi：Experience `session.background`（把阻塞工具转后台）——
//   独立动作，不与 jobs 查询合并（spec §7.3）。
import { untrack } from "solid-js"
import { experienceStore } from "./experience-store"

export type BackgroundApiState = "checking" | "available" | "unavailable"

const RETRY_MS = 60_000

export function createAvailabilityProbe(
  probe: () => Promise<unknown>,
  now: () => number = Date.now,
): {
  state(): BackgroundApiState
  probe(): Promise<BackgroundApiState>
  reset(): void
} {
  let state: BackgroundApiState = "checking"
  let at = 0
  let inflight: Promise<BackgroundApiState> | null = null
  let generation = 0

  const run = (): Promise<BackgroundApiState> => {
    if (inflight) return inflight
    const gen = generation
    const started = now()
    inflight = probe()
      .then(() => {
        if (gen === generation) { state = "available"; at = started }
        return state
      })
      .catch(() => {
        if (gen === generation) { state = "unavailable"; at = started }
        return state
      })
      .finally(() => {
        if (gen === generation) inflight = null
      })
    return inflight
  }

  return {
    state: () => state,
    probe: () => {
      if (state === "available") return Promise.resolve(state)
      if (state === "unavailable" && now() - at < RETRY_MS) return Promise.resolve(state)
      return run()
    },
    reset: () => {
      generation++
      state = "checking"
      at = 0
      inflight = null
    },
  }
}

async function experienceAction(id: "background.jobs" | "session.background") {
  // Probes are called from component effects (BackgroundDock / BackgroundWorkBar).
  // Reading the store directly would subscribe that effect to every experience
  // state write; load() writes `loading` synchronously, so the probe re-enters
  // before its in-flight promise is assigned and recurses until the stack blows
  // (2832 IPC calls + RangeError on every Desktop start). Keep the read
  // untracked: the probe owns its own (non-reactive) state machine.
  const status = untrack(() => experienceStore.state().status)
  if (status === "idle") await experienceStore.load()
  await experienceStore.whenReady()
  return untrack(() => experienceStore.action(id))
}

const jobsProbe = createAvailabilityProbe(async () => {
  const action = await experienceAction("background.jobs")
  if (action?.supported !== true) throw new Error("background jobs not supported")
  return action
})

export function backgroundApiState(): BackgroundApiState {
  return jobsProbe.state()
}

export function probeBackgroundApi(): Promise<BackgroundApiState> {
  return jobsProbe.probe()
}

export function backgroundApiAvailable(): Promise<boolean> {
  return probeBackgroundApi().then((state) => state === "available")
}

export function shouldShowBackgroundUnavailableHint(state: BackgroundApiState, hasJobRows: boolean): boolean {
  return state === "unavailable" && hasJobRows
}

/** 输出预览占位文案：接口不可用时不要提示用户点一个已隐藏的按钮。 */
export function outputPlaceholder(state: BackgroundApiState): string {
  return state === "available" ? "（点「刷新」拉取输出）" : "（后台作业接口不可用，无法拉取输出）"
}

// ── `session.background` 动作探测（沿用既有缓存语义） ─────────────────────

export interface BackgroundActionInfo {
  enabled?: boolean
}

export function createActionProbe(
  probe: () => Promise<BackgroundActionInfo | null | undefined>,
  now: () => number = Date.now,
): { available(): Promise<boolean>; reset(): void } {
  type RuntimeState = { at: number; ok: boolean; known: boolean }
  let state: RuntimeState = { at: 0, ok: false, known: false }
  let inflight: Promise<boolean> | null = null
  let generation = 0

  const fresh = () => state.known && (state.ok || now() - state.at < RETRY_MS)

  const run = (): Promise<boolean> => {
    if (inflight) return inflight
    const gen = generation
    const started = now()
    inflight = probe()
      .then((info) => {
        if (!info) {
          // Experience 尚在加载：这是 checking，不是 unavailable，且不得缓存 60s。
          if (gen === generation) state = { at: started, ok: false, known: false }
          return false
        }
        const ok = info.enabled === true
        if (gen === generation) state = { at: started, ok, known: true }
        return ok
      })
      .catch(() => {
        if (gen === generation) state = { at: started, ok: false, known: true }
        return false
      })
      .finally(() => {
        if (gen === generation) inflight = null
      })
    return inflight
  }

  return {
    available: () => (fresh() ? Promise.resolve(state.ok) : run()),
    reset: () => {
      generation++
      state = { at: 0, ok: false, known: false }
      inflight = null
    },
  }
}

const actionProbe = createActionProbe(() => experienceAction("session.background"))

export function canUseBackgroundApi(): Promise<boolean> {
  return actionProbe.available()
}

/** runtime 热切换 / SSE 重连 / 测试后重置探测缓存。 */
export function resetBackgroundCapability(): void {
  jobsProbe.reset()
  actionProbe.reset()
}
