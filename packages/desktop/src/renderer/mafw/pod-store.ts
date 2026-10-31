import { createSignal } from "solid-js"
import type { PodDetail, PodMessage, PodStatus } from "@mafw/sdk"
import { podEventAction, podIsUnsupported, podRouteMissing } from "./pod-model"

export type PodStoreApi = {
  lookup(projectDir: string): Promise<PodDetail>
  ensure(projectDir: string): Promise<PodDetail>
  get(podId: string): Promise<PodDetail>
  update(podId: string, body: { status: PodStatus }): Promise<PodDetail>
  wake(podId: string): Promise<PodDetail>
  sleep(podId: string): Promise<PodDetail>
  cost(podId: string): Promise<{ spentUsd: number; limitUsd: number }>
  listMessages(podId: string): Promise<{ items: PodMessage[] }>
  markRead(podId: string, messageId: string): Promise<{ message: PodMessage }>
}

export type PodStoreTimers = {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const DEFAULT_TIMERS: PodStoreTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as any),
}

function errorMessage(err: unknown): string {
  return String((err as any)?.message ?? err)
}

export function createPodStore(
  api: PodStoreApi,
  opts: { debounceMs?: number; timers?: PodStoreTimers } = {},
) {
  const debounceMs = opts.debounceMs ?? 200
  const timers = opts.timers ?? DEFAULT_TIMERS

  const [detail, setDetail] = createSignal<PodDetail | null>(null)
  const [cost, setCost] = createSignal<{ spentUsd: number; limitUsd: number } | null>(null)
  const [messages, setMessages] = createSignal<PodMessage[]>([])
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [unsupported, setUnsupported] = createSignal(false)
  const [projectDir, setProjectDir] = createSignal<string | null>(null)

  let seq = 0
  let timer: unknown = null
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (fn: () => void) => {
    clearTimer()
    timer = timers.setTimeout(() => {
      timer = null
      if (!disposed) fn()
    }, debounceMs)
  }

  const loadCost = (id: string, my: number) => {
    void api.cost(id)
      .then((next) => {
        if (!disposed && my === seq) setCost(next)
      })
      .catch(() => {
        if (!disposed && my === seq) setCost(null)
      })
  }

  const loadMessages = (id: string, my: number) => {
    void api.listMessages(id)
      .then((next) => {
        if (!disposed && my === seq) setMessages(next.items ?? [])
      })
      .catch(() => {
        if (!disposed && my === seq) setMessages([])
      })
  }

  const applyDetail = (next: PodDetail, my: number) => {
    if (disposed || my !== seq) return
    setDetail(next)
    setError(null)
    loadCost(next.pod.id, my)
    loadMessages(next.pod.id, my)
  }

  async function open(dir: string): Promise<void> {
    if (disposed) return
    if (dir === projectDir() && detail()) return
    const switching = dir !== projectDir()
    if (switching) {
      seq++
      clearTimer()
      setProjectDir(dir)
      setDetail(null)
      setCost(null)
      setMessages([])
      setError(null)
      setUnsupported(false)
    }
    const my = seq
    setLoading(true)
    try {
      const next = await api.lookup(dir)
      if (disposed || my !== seq) return
      setUnsupported(false)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      if (podRouteMissing(err)) {
        setDetail(null)
        setCost(null)
        setMessages([])
        setUnsupported(true)
        setError(null)
      } else if (podIsUnsupported(err) || /pod not found/i.test(errorMessage(err))) {
        setDetail(null)
        setCost(null)
        setMessages([])
        setError(null)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      if (!disposed && my === seq) setLoading(false)
    }
  }

  async function create(): Promise<void> {
    const dir = projectDir()
    if (!dir || disposed) return
    const my = seq
    setLoading(true)
    try {
      const next = await api.ensure(dir)
      if (disposed || my !== seq) return
      setUnsupported(false)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      if (podIsUnsupported(err)) {
        setUnsupported(true)
        setError("当前 gateway 不支持 Pod，请更新 gateway")
      } else {
        setError(errorMessage(err))
      }
    } finally {
      if (!disposed && my === seq) setLoading(false)
    }
  }

  async function refresh(): Promise<void> {
    const current = detail()
    if (!current || disposed || refreshing()) return
    const my = seq
    setRefreshing(true)
    try {
      const next = await api.get(current.pod.id)
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      setError(errorMessage(err))
    } finally {
      if (!disposed) setRefreshing(false)
    }
  }

  async function setStatus(status: PodStatus): Promise<void> {
    const current = detail()
    if (!current || disposed || refreshing()) return
    const my = seq
    setRefreshing(true)
    try {
      const next = status === "active"
        ? await api.wake(current.pod.id)
        : status === "idle"
          ? await api.sleep(current.pod.id)
          : await api.update(current.pod.id, { status })
      applyDetail(next, my)
    } catch (err) {
      if (disposed || my !== seq) return
      setError(errorMessage(err))
    } finally {
      if (!disposed) setRefreshing(false)
    }
  }

  async function markRead(messageId: string): Promise<boolean> {
    const current = detail()
    if (!current || disposed) return false
    try {
      const next = await api.markRead(current.pod.id, messageId)
      if (disposed) return false
      const readAt = next?.message?.readAt ?? new Date().toISOString()
      setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, readAt } : message)))
      return true
    } catch (err) {
      // 旧 gateway 没有 read 路由：静默忽略（spec 冒烟项 #8），其余失败记录但不抛出
      // （调用点是 void，抛出会变成 unhandled rejection）。
      if (!disposed && !podRouteMissing(err)) setError(errorMessage(err))
      return false
    }
  }

  function ingest(event: unknown): void {
    if (disposed) return
    const action = podEventAction({
      currentPodId: detail()?.pod.id ?? null,
      projectDir: projectDir(),
      event,
    })
    if (action === "refresh") {
      schedule(() => { void refresh() })
    } else if (action === "lookup") {
      schedule(() => {
        const dir = projectDir()
        if (dir) void open(dir)
      })
    }
  }

  function dispose(): void {
    disposed = true
    seq++
    clearTimer()
  }

  return {
    open,
    create,
    refresh,
    setStatus,
    markRead,
    ingest,
    dispose,
    detail,
    cost,
    messages,
    loading,
    refreshing,
    busy: () => loading() || refreshing(),
    error,
    unsupported,
    projectDir,
  }
}

const defaultApi: PodStoreApi = {
  lookup: (projectDir) => window.api.mafw.pod.lookup(projectDir),
  ensure: (projectDir) => window.api.mafw.pod.ensure(projectDir),
  get: (podId) => window.api.mafw.pod.get(podId),
  update: (podId, body) => window.api.mafw.pod.update(podId, body),
  wake: (podId) => window.api.mafw.pod.wake(podId),
  sleep: (podId) => window.api.mafw.pod.sleep(podId),
  cost: (podId) => window.api.mafw.pod.cost(podId),
  listMessages: (podId) => window.api.mafw.pod.listMessages(podId),
  markRead: (podId, messageId) => window.api.mafw.pod.markRead(podId, messageId),
}

export const podStore = createPodStore(defaultApi)

export function ingestPodEvent(event: unknown): void {
  podStore.ingest(event)
}
