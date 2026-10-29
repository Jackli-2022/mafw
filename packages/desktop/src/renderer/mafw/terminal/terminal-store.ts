// Renderer terminal tab store: sessions, local-directory follow, host dialogs.
// Pure factory (deps injected) so the state machine is unit-testable without Electron.
import { createSignal } from "solid-js"
import type {
  HostKeyRequest,
  PersistedTerminal,
  PromptRequest,
  TerminalEvent,
  TerminalSessionInfo,
} from "../../../shared/terminal-session"
import { localSessionId } from "../../../shared/terminal-session"
import type { SshHostProfile, SshHostProfileInput, SshSecretInput } from "../../../shared/ssh-host"
import { applyTerminalEvent, nextActiveAfterClose, persistedTabs } from "./terminal-model"

const STORAGE_KEY = "mafw-terminal-tabs-v1"
const MAX_SESSIONS = 10

export type TerminalStoreApi = {
  sessions: {
    list(): Promise<TerminalSessionInfo[]>
    attachLocal(directory: string): Promise<TerminalSessionInfo>
    createSsh(input: { id?: string; hostId: string }): Promise<TerminalSessionInfo>
    restore(input: { id: string; hostId: string }): Promise<TerminalSessionInfo>
    attach(sessionId: string, key: string): Promise<{ ok: boolean; replayed: boolean }>
    detach(sessionId: string, key: string): Promise<void>
    input(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    close(sessionId: string): Promise<void>
    kill(sessionId: string): Promise<void>
    reconnect(sessionId: string): Promise<void>
  }
  hosts: {
    list(): Promise<SshHostProfile[]>
    save(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<SshHostProfile>
    remove(id: string): Promise<void>
    test(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<{ ok: boolean; error?: string }>
  }
  hostkey: {
    respond(input: { requestId: string; action: "trust" | "trust-and-save" | "replace" | "reject" }): Promise<void>
  }
  prompt: {
    respond(input: { requestId: string; answers?: string[] }): Promise<void>
  }
  onEvent(cb: (ev: TerminalEvent) => void): () => void
}

export type TerminalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type TerminalStoreDeps = {
  api: TerminalStoreApi
  storage: TerminalStorage
  localDirectory: () => string | null
  now?: () => number
  onError?: (message: string) => void
}

export type HostDialogState = { open: boolean; initial?: SshHostProfile }

export type TerminalStore = {
  sessions(): TerminalSessionInfo[]
  activeId(): string | null
  hosts(): SshHostProfile[]
  drawerOpen(): boolean
  hostDialog(): HostDialogState
  hostKey(): HostKeyRequest | null
  prompt(): PromptRequest | null
  init(): Promise<void>
  setVisible(v: boolean): void
  setActive(id: string | null): void
  ensureLocal(dir: string | null): void
  openLocal(): void
  openSsh(hostId: string): Promise<TerminalSessionInfo | null>
  closeTab(id: string): Promise<void>
  killLocal(id: string): Promise<void>
  reconnect(id: string): Promise<void>
  saveHost(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<SshHostProfile | null>
  removeHost(id: string): Promise<void>
  testHost(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<{ ok: boolean; error?: string }>
  setDrawerOpen(open: boolean): void
  openHostDialog(initial?: SshHostProfile | null): void
  closeHostDialog(): void
  respondHostKey(action: "trust" | "trust-and-save" | "replace" | "reject"): Promise<void>
  respondPrompt(answers: string[]): Promise<void>
  handleEvent(ev: TerminalEvent): void
  dispose(): void
}

function platformOf(): string {
  const nav = typeof navigator !== "undefined" ? navigator.platform : ""
  if (/win/i.test(nav)) return "win32"
  if (/mac/i.test(nav)) return "darwin"
  return "linux"
}

function dirTitle(dir: string): string {
  const name = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir
  return `本地 · ${name || "终端"}`
}

function parsePersisted(raw: string | null): PersistedTerminal | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedTerminal
    if (!parsed || !Array.isArray(parsed.tabs)) return null
    return parsed
  } catch {
    return null
  }
}

export function createTerminalStore(deps: TerminalStoreDeps): TerminalStore {
  const [sessions, setSessions] = createSignal<TerminalSessionInfo[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [hosts, setHosts] = createSignal<SshHostProfile[]>([])
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [hostDialog, setHostDialog] = createSignal<HostDialogState>({ open: false })
  const [hostKey, setHostKey] = createSignal<HostKeyRequest | null>(null)
  const [prompt, setPrompt] = createSignal<PromptRequest | null>(null)
  const platform = platformOf()
  const titleFor = (dir: string) => dirTitle(dir)
  let visible = false
  let initialized = false
  let localClosed = false
  let attachingLocal = false
  let unsub: (() => void) | null = null

  const persist = () => {
    try {
      deps.storage.setItem(STORAGE_KEY, JSON.stringify(persistedTabs(sessions(), activeId())))
    } catch { /* storage full/unavailable */ }
  }

  const upsert = (info: TerminalSessionInfo) => {
    setSessions((prev) => {
      const index = prev.findIndex((s) => s.id === info.id)
      if (index < 0) return [...prev, info]
      return prev.map((s) => (s.id === info.id ? { ...s, ...info } : s))
    })
  }

  const localInfo = (dir: string): TerminalSessionInfo => ({
    id: localSessionId(dir, platform),
    kind: "local",
    title: titleFor(dir),
    directory: dir,
    status: "disconnected",
  })

  const attachLocal = async (info: TerminalSessionInfo) => {
    if (!info.directory || attachingLocal) return
    attachingLocal = true
    try {
      const fresh = await deps.api.sessions.attachLocal(info.directory)
      const oldId = info.id
      setSessions((prev) => {
        const without = prev.filter((s) => !(s.id === oldId && oldId !== fresh.id))
        const index = without.findIndex((s) => s.id === fresh.id)
        if (index < 0) return [...without, { ...info, ...fresh }]
        return without.map((s) => (s.id === fresh.id ? { ...s, ...fresh } : s))
      })
      if (activeId() === oldId) setActiveId(fresh.id)
      persist()
    } catch (err: any) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === info.id
            ? { ...s, status: "error", error: `本地终端不可用：${err?.message ?? err}` }
            : s,
        ),
      )
    } finally {
      attachingLocal = false
    }
  }

  const activate = (id: string) => {
    const session = sessions().find((s) => s.id === id)
    if (!session) return
    setActiveId(id)
    persist()
    if (!visible) return
    if (session.kind === "ssh" && (session.status === "disconnected" || session.status === "error")) {
      void deps.api.sessions.reconnect(id)
    } else if (session.kind === "local" && session.status !== "connected" && session.status !== "connecting") {
      void attachLocal(session)
    }
  }

  const handleEvent = (ev: TerminalEvent) => {
    if (ev.type === "status") {
      setSessions((prev) => applyTerminalEvent({ sessions: prev }, ev).sessions)
      return
    }
    if (ev.type === "hostkey") setHostKey(ev)
    else if (ev.type === "prompt") setPrompt(ev)
  }

  const store: TerminalStore = {
    sessions,
    activeId,
    hosts,
    drawerOpen,
    hostDialog,
    hostKey,
    prompt,

    async init() {
      if (initialized) return
      initialized = true
      unsub = deps.api.onEvent(handleEvent)
      const [live, hostList] = await Promise.all([
        deps.api.sessions.list(),
        deps.api.hosts.list().catch(() => [] as SshHostProfile[]),
      ])
      setHosts(hostList)
      const persisted = parsePersisted(deps.storage.getItem(STORAGE_KEY))

      const list = [...live]
      const ids = new Set(list.map((s) => s.id))
      if (persisted) {
        for (const tab of persisted.tabs) {
          if (tab.kind !== "ssh" || !tab.hostId || ids.has(tab.id)) continue
          try {
            const info = await deps.api.sessions.restore({ id: tab.id, hostId: tab.hostId })
            list.push(info)
            ids.add(info.id)
          } catch (err: any) {
            deps.onError?.(`恢复 SSH 会话失败：${err?.message ?? err}`)
          }
        }
      }

      const hasLocal = list.some((s) => s.kind === "local")
      if (!hasLocal && (!persisted || persisted.tabs.some((t) => t.kind === "local"))) {
        const directory = deps.localDirectory()
        if (directory) list.push(localInfo(directory))
      }

      setSessions(list)
      const wanted = persisted?.activeId
      setActiveId(wanted && list.some((s) => s.id === wanted) ? wanted : list[0]?.id ?? null)
      persist()
    },

    setVisible(next) {
      visible = next
      if (!next) return
      const list = sessions()
      for (const session of list) {
        if (session.kind === "ssh" && session.status === "disconnected") {
          void deps.api.sessions.reconnect(session.id)
        }
      }
      const local = list.find((s) => s.kind === "local")
      if (
        local &&
        (activeId() === local.id || activeId() === null) &&
        local.status !== "connected" &&
        local.status !== "connecting"
      ) {
        void attachLocal(local)
      }
    },

    setActive(id) {
      if (id === null) {
        setActiveId(null)
        persist()
        return
      }
      activate(id)
    },

    ensureLocal(directory) {
      if (!directory) return
      const existing = sessions().find((s) => s.kind === "local")
      if (localClosed && !existing) return
      if (!existing) {
        const info = localInfo(directory)
        setSessions((prev) => [...prev, info])
        if (!activeId()) setActiveId(info.id)
        persist()
        if (visible && activeId() === info.id) void attachLocal(info)
        return
      }
      const nextId = localSessionId(directory, platform)
      if (existing.directory !== directory || existing.id !== nextId) {
        const updated: TerminalSessionInfo = {
          ...existing,
          id: nextId,
          title: titleFor(directory),
          directory,
          status: "disconnected",
          error: undefined,
          connectedAt: undefined,
        }
        setSessions((prev) => prev.map((s) => (s.id === existing.id ? updated : s)))
        if (activeId() === existing.id) setActiveId(nextId)
        if (existing.id !== nextId) void deps.api.sessions.close(existing.id)
        persist()
        if (visible && activeId() === nextId) void attachLocal(updated)
        return
      }
      if (visible && activeId() === existing.id && existing.status !== "connected" && existing.status !== "connecting") {
        void attachLocal(existing)
      }
    },

    openLocal() {
      localClosed = false
      const directory = deps.localDirectory()
      if (!directory) return
      const existing = sessions().find((s) => s.kind === "local")
      if (existing) {
        activate(existing.id)
        return
      }
      const info = localInfo(directory)
      setSessions((prev) => [...prev, info])
      setActiveId(info.id)
      persist()
      if (visible) void attachLocal(info)
    },

    async openSsh(hostId) {
      if (sessions().length >= MAX_SESSIONS) {
        deps.onError?.(`最多同时打开 ${MAX_SESSIONS} 个终端`)
        return null
      }
      try {
        const info = await deps.api.sessions.createSsh({ hostId })
        upsert(info)
        setActiveId(info.id)
        persist()
        return info
      } catch (err: any) {
        deps.onError?.(`创建 SSH 会话失败：${err?.message ?? err}`)
        return null
      }
    },

    async closeTab(id) {
      const session = sessions().find((s) => s.id === id)
      if (!session) return
      await deps.api.sessions.close(id)
      if (session.kind === "local") localClosed = true
      const next = nextActiveAfterClose(sessions(), activeId(), id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setActiveId(next)
      persist()
    },

    async killLocal(id) {
      const session = sessions().find((s) => s.id === id)
      if (!session || session.kind !== "local") return
      await deps.api.sessions.kill(id)
      localClosed = true
      const next = nextActiveAfterClose(sessions(), activeId(), id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setActiveId(next)
      persist()
    },

    async reconnect(id) {
      const session = sessions().find((s) => s.id === id)
      if (!session) return
      if (session.kind === "ssh") await deps.api.sessions.reconnect(id)
      else await attachLocal(session)
    },

    async saveHost(profile, secret) {
      try {
        const saved = await deps.api.hosts.save(profile, secret)
        setHosts(await deps.api.hosts.list().catch(() => hosts()))
        setHostDialog({ open: false })
        return saved
      } catch (err: any) {
        deps.onError?.(`保存主机失败：${err?.message ?? err}`)
        return null
      }
    },

    async removeHost(id) {
      try {
        await deps.api.hosts.remove(id)
        for (const session of sessions().filter((s) => s.hostId === id)) {
          await store.closeTab(session.id)
        }
        setHosts(await deps.api.hosts.list().catch(() => hosts().filter((h) => h.id !== id)))
      } catch (err: any) {
        deps.onError?.(`删除主机失败：${err?.message ?? err}`)
      }
    },

    async testHost(profile, secret) {
      return deps.api.hosts.test(profile, secret)
    },

    setDrawerOpen(open) {
      setDrawerOpen(open)
    },

    openHostDialog(initial) {
      setHostDialog({ open: true, ...(initial ? { initial } : {}) })
    },

    closeHostDialog() {
      setHostDialog({ open: false, ...(hostDialog().initial ? { initial: hostDialog().initial } : {}) })
    },

    async respondHostKey(action) {
      const request = hostKey()
      if (!request) return
      setHostKey(null)
      await deps.api.hostkey.respond({ requestId: request.requestId, action })
    },

    async respondPrompt(answers) {
      const request = prompt()
      if (!request) return
      setPrompt(null)
      await deps.api.prompt.respond({ requestId: request.requestId, answers })
    },

    handleEvent,

    dispose() {
      unsub?.()
      unsub = null
    },
  }

  return store
}

let singleton: TerminalStore | null = null

/** Production singleton; created lazily so Node tests can import the factory. */
export function terminalStore(): TerminalStore {
  if (singleton) return singleton
  const runtime = globalThis as any
  const api = runtime.window?.api?.mafw?.terminal as TerminalStoreApi
  const storage = runtime.window?.localStorage ?? runtime.localStorage
  if (!api || !storage) {
    throw new Error("terminalStore 只能在 renderer（preload API + localStorage）中使用")
  }
  singleton = createTerminalStore({ api, storage, localDirectory: () => null })
  return singleton
}
