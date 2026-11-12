// 决定板的数据源：唯一读取 attention 投影，rail badge 与 Chat 决定板共用。
import { createSignal } from "solid-js"
import type {
  AttentionItem,
  AttentionList,
  DecisionList,
  DecisionRecord,
} from "@mafw/sdk"
import { buildDecisionBoard, type DecisionBoardView } from "./focus/decision-model"

export function createDecisionStore(deps: {
  api: {
    attention(projectDir: string): Promise<AttentionList>
    decisions?(projectDir: string, goalId?: string): Promise<DecisionList>
    confirm?(id: string, input: { projectDir: string; rationale: string; consequences: string; reviewAt?: string }): Promise<unknown>
    shelve?(id: string, input: { projectDir: string; reviewAt: string; note?: string }): Promise<unknown>
    reopen?(id: string, input: { projectDir: string }): Promise<unknown>
  }
  projectDir(): string | null
}) {
  const [items, setItems] = createSignal<readonly AttentionItem[]>([])
  const [records, setRecords] = createSignal<readonly DecisionRecord[]>([])
  const [revision, setRevision] = createSignal(0)
  const [loaded, setLoaded] = createSignal(false)
  let seq = 0

  const board = (goalId?: string | null): DecisionBoardView =>
    buildDecisionBoard({ attention: items(), records: records(), goalId })

  const counts = () => board().counts

  async function refresh(): Promise<void> {
    const dir = deps.projectDir()
    if (!dir) return
    const my = ++seq
    const attentionTask = deps.api.attention(dir)
      .then((next) => {
        if (my !== seq) return
        setItems(Array.isArray(next?.items) ? next.items : [])
        setLoaded(true)
        setRevision((value) => value + 1)
      })
      .catch(() => { /* fail-open: keep the last projected list */ })
    const recordsTask = deps.api.decisions
      ? deps.api.decisions(dir)
        .then((next) => {
          if (my !== seq) return
          setRecords(Array.isArray(next?.items) ? next.items : [])
        })
        .catch(() => { /* fail-open: keep the last records */ })
      : Promise.resolve()
    await Promise.all([attentionTask, recordsTask])
  }

  const currentDir = (): string => {
    const dir = deps.projectDir()
    if (!dir) throw new Error("no current project")
    return dir
  }

  async function confirm(
    id: string,
    input: { rationale: string; consequences: string; reviewAt?: string },
  ): Promise<void> {
    if (!deps.api.confirm) throw new Error("decision confirmation is unavailable")
    await deps.api.confirm(id, { projectDir: currentDir(), ...input })
    await refresh()
  }

  async function shelve(
    id: string,
    input: { reviewAt: string; note?: string },
  ): Promise<void> {
    if (!deps.api.shelve) throw new Error("decision shelving is unavailable")
    await deps.api.shelve(id, { projectDir: currentDir(), ...input })
    await refresh()
  }

  async function reopen(id: string): Promise<void> {
    if (!deps.api.reopen) throw new Error("decision reopening is unavailable")
    await deps.api.reopen(id, { projectDir: currentDir() })
    await refresh()
  }

  return { items, records, revision, loaded, refresh, board, counts, confirm, shelve, reopen }
}

export type DecisionStore = ReturnType<typeof createDecisionStore>
