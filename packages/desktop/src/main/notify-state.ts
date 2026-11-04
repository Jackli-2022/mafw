// packages/desktop/src/main/notify-state.ts
// "Notify once" ledger persisted across restarts. Without it a hidden-to-tray
// app would re-announce the same finished Goal every launch.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

interface Persisted {
  attentionIds: string[]
  resultKeys: string[]
}

export class NotifyState {
  private attentionIds = new Set<string>()
  private resultKeys = new Set<string>()

  constructor(private readonly file?: string) {
    this.load()
  }

  hasAttention(id: string): boolean {
    return this.attentionIds.has(id)
  }

  markAttention(id: string): void {
    this.attentionIds.add(id)
    this.save()
  }

  pruneAttention(alive: readonly string[]): void {
    const keep = new Set(alive)
    let changed = false
    for (const id of [...this.attentionIds]) {
      if (!keep.has(id)) {
        this.attentionIds.delete(id)
        changed = true
      }
    }
    if (changed) this.save()
  }

  hasResult(goalId: string, revision: number): boolean {
    return this.resultKeys.has(`${goalId}:r${revision}`)
  }

  markResult(goalId: string, revision: number): void {
    this.resultKeys.add(`${goalId}:r${revision}`)
    this.save()
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Persisted>
      for (const id of raw.attentionIds ?? []) this.attentionIds.add(id)
      for (const key of raw.resultKeys ?? []) this.resultKeys.add(key)
    } catch {
      // corrupt ledger = start clean; worst case one duplicate notification
    }
  }

  private save(): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const payload: Persisted = {
        attentionIds: [...this.attentionIds],
        resultKeys: [...this.resultKeys].slice(-500),
      }
      writeFileSync(this.file, JSON.stringify(payload), "utf8")
    } catch {
      // fail-open: notifications still work, just without restart dedupe
    }
  }
}
