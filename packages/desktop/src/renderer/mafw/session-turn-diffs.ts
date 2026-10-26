// Per-turn diff store（B3.1）：会话级 per-turn 抓取 + 合并。
// 供 MafwShell（ChangesDock/EditorDock 数据面）与 ChatPane（composer badge）共用，
// 保证 badge 与变更树使用同一份合并结果。
//
// 生命周期规则（B3.1 历史 minors 收口）：
// - busy 时排除最后一个（在飞）回合：其 snapshotKey 每 step 变化，否则全量重拉；
// - 每会话请求代际：旧请求（晚到）不得覆盖新数据；
// - 单回合失败/整体失败 → 移除请求 key，允许下次重试；
// - 请求 key 集合上限 50（防长会话无界增长）。
import { createSignal } from "solid-js"
import type { FileDiffEntry } from "./components/DiffReviewPanel"
import { aggregateSessionDiffs } from "./components/session-diffs"
import { collectTurnDiffCandidates, loadTurnDiffs, mergeDiffLists, turnDiffRequestKey } from "./components/turn-diffs"

export type DiffFetcher = (sessionID: string, messageID: string) => Promise<{ files: FileDiffEntry[] }>
type PerTurnMap = Record<string, FileDiffEntry[] | null>
type EnsureInput = {
  sid: string
  messages: any[]
  runtimeName: string
  busy: boolean
  diffApi: boolean
}

export function createSessionTurnDiffsStore(fetchDiff: DiffFetcher) {
  const [bySession, setBySession] = createSignal<Record<string, PerTurnMap>>({})
  const requested = new Set<string>()
  const generations = new Map<string, number>()

  function ensure(input: EnsureInput): void {
    if (!input.sid || !input.diffApi) return
    const candidates = collectTurnDiffCandidates(input.messages, { excludeLastTurn: input.busy })
    if (!candidates.length) return
    const key = turnDiffRequestKey(input.runtimeName, input.sid, candidates)
    if (requested.has(key)) return
    requested.add(key)
    if (requested.size > 50) {
      const oldest = requested.values().next().value
      if (oldest) requested.delete(oldest)
    }
    const generation = (generations.get(input.sid) ?? 0) + 1
    generations.set(input.sid, generation)
    void loadTurnDiffs(input.sid, input.messages, fetchDiff, 4, { excludeLastTurn: input.busy })
      .then((map) => {
        if ((generations.get(input.sid) ?? 0) !== generation) return // 旧代际丢弃
        if (Object.values(map).some((v) => v === null)) requested.delete(key) // 失败可重试
        setBySession((prev) => ({ ...prev, [input.sid]: map }))
      })
      .catch(() => { requested.delete(key) })
  }

  function perTurn(sid: string): PerTurnMap {
    return bySession()[sid] ?? {}
  }

  /** 与 ChangesDock/EditorDock 完全一致的合并结果（summary 打底，per-turn 覆盖）。 */
  function entries(sid: string, messages: any[]): FileDiffEntry[] {
    return mergeDiffLists(aggregateSessionDiffs(messages), perTurn(sid))
  }

  function count(sid: string, messages: any[]): number {
    return entries(sid, messages).length
  }

  return { ensure, perTurn, entries, count }
}

let singleton: ReturnType<typeof createSessionTurnDiffsStore> | null = null

/** Lazy singleton（模块导入时不触碰 window，便于测试注入假 fetch）。 */
export function getSessionTurnDiffs(): ReturnType<typeof createSessionTurnDiffsStore> {
  if (!singleton) {
    singleton = createSessionTurnDiffsStore((sid, mid) => window.api.mafw.sessions.diff(sid, mid))
  }
  return singleton
}
