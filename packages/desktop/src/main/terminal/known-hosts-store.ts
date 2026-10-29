// TOFU known_hosts store for SSH host keys (not secret; integrity matters).
import { sshHostKey, type KnownHostEntry } from "../../shared/ssh-host"
import { readJsonFile, writeJsonFileAtomic } from "./json-file"

type KnownHostsFile = { version: 1; entries: Record<string, KnownHostEntry> }

export type KnownHostsStore = {
  list(): KnownHostEntry[]
  get(host: string, port: number): KnownHostEntry | null
  put(entry: KnownHostEntry): void
  replace(entry: KnownHostEntry): void
  remove(host: string, port: number): void
}

export function createKnownHostsStore(opts: {
  filePath: string
  now?: () => number
}): KnownHostsStore {
  const now = opts.now ?? Date.now
  const read = (): Record<string, KnownHostEntry> => {
    const file = readJsonFile<KnownHostsFile>(opts.filePath, { version: 1, entries: {} })
    return file?.entries && typeof file.entries === "object" ? file.entries : {}
  }
  const write = (entries: Record<string, KnownHostEntry>) => {
    writeJsonFileAtomic(opts.filePath, { version: 1, entries })
  }
  const key = (host: string, port: number) => sshHostKey(host, port)

  return {
    list() {
      return Object.values(read()).sort(
        (a, b) => a.host.localeCompare(b.host) || a.port - b.port,
      )
    },

    get(host, port) {
      return read()[key(host, port)] ?? null
    },

    put(entry) {
      const entries = { ...read() }
      const stamp = now()
      entries[key(entry.host, entry.port)] = {
        ...entry,
        addedAt: entry.addedAt || stamp,
        lastSeenAt: entry.lastSeenAt || stamp,
      }
      write(entries)
    },

    replace(entry) {
      const entries = { ...read() }
      const current = entries[key(entry.host, entry.port)]
      entries[key(entry.host, entry.port)] = {
        ...entry,
        addedAt: current?.addedAt ?? entry.addedAt ?? now(),
        lastSeenAt: now(),
      }
      write(entries)
    },

    remove(host, port) {
      const entries = { ...read() }
      if (!(key(host, port) in entries)) return
      delete entries[key(host, port)]
      write(entries)
    },
  }
}
