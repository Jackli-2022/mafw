// 后台任务 REST 能力探测（Gate Ruling A：REST 面是可选能力）。
//
// 两个门：
// - backgroundRest：`GET /api/shell` 可达（v2 鉴权桥就绪）→
//   终止按钮 / 对账轮询可用；
// - canUseBackgroundApi：当前 runtime 为 opencode（`/api/runtime`）→
//   「全部转后台」端点存在（pi 无 session.background）。
//
// REST 探测是三态（checking / available / unavailable）：组件首帧不能用
// `false` 冒充「不可用」（会闪提示），且失败后必须能被 60s 重探/SSE 重连
// reset 点亮，而不是永远停在启动竞态。

export type BackgroundRestState = "checking" | "available" | "unavailable"

const RETRY_MS = 60_000

export function createRestProbe(
  probe: () => Promise<unknown>,
  now: () => number = Date.now,
): {
  state(): BackgroundRestState
  probe(): Promise<BackgroundRestState>
  reset(): void
} {
  let state: BackgroundRestState = "checking"
  let at = 0
  let inflight: Promise<BackgroundRestState> | null = null
  let generation = 0

  const run = (): Promise<BackgroundRestState> => {
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

const restProbe = createRestProbe(() => window.api.mafw.shells.list())

export function backgroundRestState(): BackgroundRestState {
  return restProbe.state()
}

export function probeBackgroundRest(): Promise<BackgroundRestState> {
  return restProbe.probe()
}

/** 兼容旧调用：布尔形态（state === "available"）。 */
export function backgroundRestAvailable(): Promise<boolean> {
  return probeBackgroundRest().then((s) => s === "available")
}

export function shouldShowRestUnavailableHint(state: BackgroundRestState, hasShellRows: boolean): boolean {
  return state === "unavailable" && hasShellRows
}

/** 输出预览占位文案：REST 不可用时不要提示用户点一个已隐藏的按钮。 */
export function outputPlaceholder(state: BackgroundRestState): string {
  return state === "available" ? "（点「刷新」拉取输出）" : "（REST 不可用，无法拉取输出）"
}

// ── runtime（opencode?）探测：沿用既有缓存语义 ──────────────────────────

export interface RuntimeInfo {
  active?: { name?: string }
}

export function createRuntimeProbe(
  probe: () => Promise<RuntimeInfo | null | undefined>,
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
        const ok = info?.active?.name === "opencode"
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

const runtimeProbe = createRuntimeProbe(() => window.api.mafw.runtime.get())

export function canUseBackgroundApi(): Promise<boolean> {
  return runtimeProbe.available()
}

/** runtime 热切换 / SSE 重连 / 测试后重置探测缓存。 */
export function resetBackgroundCapability(): void {
  restProbe.reset()
  runtimeProbe.reset()
}
