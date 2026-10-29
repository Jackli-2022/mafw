// Encrypted SSH passwords/passphrases. The renderer never reads this file.
import type { SshSecretInput } from "../../shared/ssh-host"
import { readJsonFile, writeJsonFileAtomic } from "./json-file"

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  /** Electron on Linux reports basic_text even when isEncryptionAvailable() is true. */
  getSelectedStorageBackend?(): string
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

type SecretEntry = { password?: string; passphrase?: string }
type SecretsFile = { version: 1; entries: Record<string, SecretEntry> }

export type TerminalSecrets = {
  available(): boolean
  has(hostId: string): { password: boolean; passphrase: boolean }
  get(hostId: string): { password?: string; passphrase?: string }
  set(hostId: string, input: SshSecretInput): void
  remove(hostId: string): void
}

export function createTerminalSecrets(opts: {
  filePath: string
  safeStorage: SafeStorageLike
}): TerminalSecrets {
  const read = (): Record<string, SecretEntry> => {
    const file = readJsonFile<SecretsFile>(opts.filePath, { version: 1, entries: {} })
    return file?.entries && typeof file.entries === "object" ? file.entries : {}
  }
  const write = (entries: Record<string, SecretEntry>) => {
    writeJsonFileAtomic(opts.filePath, { version: 1, entries })
  }
  const encrypt = (value: string) =>
    opts.safeStorage.encryptString(value).toString("base64")
  const decrypt = (value: string): string | undefined => {
    try {
      return opts.safeStorage.decryptString(Buffer.from(value, "base64"))
    } catch {
      return undefined
    }
  }
  const available = () =>
    opts.safeStorage.isEncryptionAvailable() &&
    opts.safeStorage.getSelectedStorageBackend?.() !== "basic_text"

  return {
    available,

    has(hostId) {
      const entry = read()[hostId]
      return { password: !!entry?.password, passphrase: !!entry?.passphrase }
    },

    get(hostId) {
      const entry = read()[hostId]
      if (!entry) return {}
      const out: { password?: string; passphrase?: string } = {}
      if (entry.password) {
        const value = decrypt(entry.password)
        if (value !== undefined) out.password = value
      }
      if (entry.passphrase) {
        const value = decrypt(entry.passphrase)
        if (value !== undefined) out.passphrase = value
      }
      return out
    },

    set(hostId, input) {
      if (!available() && (input.password || input.passphrase)) {
        throw new Error("凭据存储不可用：系统钥匙串不可访问")
      }
      const entries = { ...read() }
      const next: SecretEntry = { ...(entries[hostId] ?? {}) }
      if (input.clearPassword) delete next.password
      if (input.clearPassphrase) delete next.passphrase
      if (input.password) next.password = encrypt(input.password)
      if (input.passphrase) next.passphrase = encrypt(input.passphrase)
      if (next.password || next.passphrase) entries[hostId] = next
      else delete entries[hostId]
      write(entries)
    },

    remove(hostId) {
      const entries = { ...read() }
      if (!(hostId in entries)) return
      delete entries[hostId]
      write(entries)
    },
  }
}
