// IPC wiring for the v2 terminal service (local + SSH sessions).
import type { TerminalEvent } from "../../shared/terminal-session"
import { createLocalTerminalOps } from "./local-terminal"
import { createTerminalService, type TerminalService } from "./terminal-service"
import type { SafeStorageLike } from "./terminal-secrets"

export const TERMINAL_V2_EVENT = "mafw-terminal-v2-event"

export type TerminalServiceIpcDeps = {
  dataDir: string
  gatewayBase: () => string
  safeStorage: SafeStorageLike
  openExternal: (directory: string) => Promise<void>
  broadcast: (channel: string, payload: any) => void
  log?: (msg: string) => void
}

export function installTerminalServiceIpc(ipcMain: any, deps: TerminalServiceIpcDeps): TerminalService {
  const local = createLocalTerminalOps({ gatewayBase: deps.gatewayBase, log: deps.log })
  const service = createTerminalService({
    dataDir: deps.dataDir,
    local,
    safeStorage: deps.safeStorage,
    onEvent: (ev) => deps.broadcast(TERMINAL_V2_EVENT, ev),
    openExternal: deps.openExternal,
    log: deps.log,
  })

  const bySender = new Map<number, Map<string, { sessionId: string; sub: (ev: TerminalEvent) => void }>>()
  const destroyHooked = new Set<number>()

  const fullKey = (senderId: number, key: string) => `${senderId}:${key}`
  const subFor = (sender: any, sessionId: string, key: string) => {
    const map = bySender.get(sender.id) ?? new Map()
    bySender.set(sender.id, map)
    const id = fullKey(sender.id, key)
    const existing = map.get(id)
    if (existing) {
      existing.sessionId = sessionId
      return { id, sub: existing.sub }
    }
    const sub = (ev: TerminalEvent) => {
      try {
        if (!sender.isDestroyed?.()) sender.send(TERMINAL_V2_EVENT, ev)
      } catch { /* window gone */ }
    }
    map.set(id, { sessionId, sub })
    if (!destroyHooked.has(sender.id)) {
      destroyHooked.add(sender.id)
      try {
        sender.once?.("destroyed", () => {
          destroyHooked.delete(sender.id)
          const subs = bySender.get(sender.id)
          bySender.delete(sender.id)
          if (subs) {
            for (const [key, item] of subs) {
              void service.hub.detach(item.sessionId, key)
            }
          }
        })
      } catch { /* fake sender */ }
    }
    return { id, sub }
  }

  ipcMain.handle("mafw-terminal-v2-probe", async () => {
    const probe = await local.probe()
    return {
      localAvailable: probe.available,
      sshAvailable: true,
      ...(probe.reason ? { reason: probe.reason } : {}),
    }
  })
  ipcMain.handle("mafw-terminal-v2-list", () => service.hub.list())
  ipcMain.handle("mafw-terminal-v2-local-attach", (_e: any, args: { directory: string }) => service.hub.attachLocal(args.directory))
  ipcMain.handle("mafw-terminal-v2-ssh-create", (_e: any, args: { id?: string; hostId: string }) => service.hub.createSsh(args))
  ipcMain.handle("mafw-terminal-v2-ssh-restore", (_e: any, args: { id: string; hostId: string }) => service.hub.restoreSsh(args))
  ipcMain.handle("mafw-terminal-v2-attach", async (event: any, args: { sessionId: string; key: string }) => {
    const { id, sub } = subFor(event.sender, args.sessionId, args.key)
    return service.hub.attach(args.sessionId, sub, id)
  })
  ipcMain.handle("mafw-terminal-v2-detach", (event: any, args: { sessionId: string; key: string }) => {
    const id = fullKey(event.sender.id, args.key)
    bySender.get(event.sender.id)?.delete(id)
    service.hub.detach(args.sessionId, id)
  })
  ipcMain.handle("mafw-terminal-v2-input", (_e: any, args: { sessionId: string; data: string }) => service.hub.input(args.sessionId, args.data))
  ipcMain.handle("mafw-terminal-v2-resize", (_e: any, args: { sessionId: string; cols: number; rows: number }) => service.hub.resize(args.sessionId, args.cols, args.rows))
  ipcMain.handle("mafw-terminal-v2-close", (_e: any, args: { sessionId: string }) => service.hub.close(args.sessionId))
  ipcMain.handle("mafw-terminal-v2-kill", (_e: any, args: { sessionId: string }) => service.hub.kill(args.sessionId))
  ipcMain.handle("mafw-terminal-v2-reconnect", (_e: any, args: { sessionId: string }) => service.hub.reconnect(args.sessionId))
  ipcMain.handle("mafw-terminal-v2-hosts-list", () => service.hosts.list())
  ipcMain.handle("mafw-terminal-v2-hosts-save", (_e: any, args: { profile: any; secret?: any }) => service.hosts.save(args.profile, args.secret))
  ipcMain.handle("mafw-terminal-v2-hosts-remove", (_e: any, args: { id: string }) => service.hosts.remove(args.id))
  ipcMain.handle("mafw-terminal-v2-hosts-test", (_e: any, args: { profile: any; secret?: any }) => service.hosts.test(args.profile, args.secret))
  ipcMain.handle("mafw-terminal-v2-hostkey-respond", (_e: any, args: { requestId: string; action: any }) => service.respondHostKey(args.requestId, args.action))
  ipcMain.handle("mafw-terminal-v2-prompt-respond", (_e: any, args: { requestId: string; answers?: string[] }) => service.respondPrompt(args.requestId, args.answers))
  ipcMain.handle("mafw-terminal-v2-open-external", (_e: any, args: { directory: string }) => deps.openExternal(args.directory))

  return service
}
