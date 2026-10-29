// Non-secret SSH host profiles persisted in userData.
import { randomUUID } from "node:crypto"
import { validateSshHostProfile, type SshHostProfile, type SshHostProfileInput } from "../../shared/ssh-host"
import { readJsonFile, writeJsonFileAtomic } from "./json-file"

type HostFile = { version: 1; hosts: SshHostProfile[] }

export type SshHostStore = {
  list(): SshHostProfile[]
  get(id: string): SshHostProfile | null
  save(input: SshHostProfileInput, hosts?: SshHostProfile[]): SshHostProfile
  remove(id: string): void
}

export function createSshHostStore(opts: {
  filePath: string
  now?: () => number
  id?: () => string
}): SshHostStore {
  const now = opts.now ?? Date.now
  const newId = opts.id ?? randomUUID
  const read = (): SshHostProfile[] => {
    const file = readJsonFile<HostFile>(opts.filePath, { version: 1, hosts: [] })
    return Array.isArray(file?.hosts) ? file.hosts : []
  }
  const write = (hosts: SshHostProfile[]) => {
    writeJsonFileAtomic(opts.filePath, { version: 1, hosts })
  }

  return {
    list() {
      return [...read()].sort(
        (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
      )
    },

    get(id) {
      return read().find((h) => h.id === id) ?? null
    },

    save(input, hosts) {
      const existing = hosts ?? read()
      const result = validateSshHostProfile(input, { hosts: existing })
      if (!result.ok) throw new Error(result.errors.join("; "))
      const current = result.value.id
        ? existing.find((h) => h.id === result.value.id)
        : undefined
      const next: SshHostProfile = {
        ...result.value,
        id: current?.id ?? result.value.id ?? newId(),
        createdAt: current?.createdAt ?? now(),
        updatedAt: now(),
      }
      const nextHosts = current
        ? existing.map((h) => (h.id === next.id ? next : h))
        : [...existing, next]
      write(nextHosts)
      return next
    },

    remove(id) {
      const hosts = read()
      const next = hosts.filter((h) => h.id !== id)
      if (next.length !== hosts.length) write(next)
    },
  }
}
