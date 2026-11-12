// 决定板的数据源：唯一读取 attention 投影，rail badge 与 Chat 决定板共用。
import { createSignal } from "solid-js"
import type { AttentionItem, AttentionList } from "@mafw/sdk"
import { buildDecisionBoard, type DecisionBoardView } from "./focus/decision-model"

export function createDecisionStore(deps: {
  api: { attention(projectDir: string): Promise<AttentionList> }
  projectDir(): string | null
}) {
  const [items, setItems] = createSignal<readonly AttentionItem[]>([])
  const [revision, setRevision] = createSignal(0)
  const [loaded, setLoaded] = createSignal(false)
  let seq = 0

  const board = (goalId?: string | null): DecisionBoardView =>
    buildDecisionBoard({ attention: items(), records: [], goalId })

  const counts = () => board().counts

  async function refresh(): Promise<void> {
    const dir = deps.projectDir()
    if (!dir) return
    const my = ++seq
    try {
      const next = await deps.api.attention(dir)
      if (my !== seq) return
      setItems(Array.isArray(next?.items) ? next.items : [])
      setLoaded(true)
      setRevision((value) => value + 1)
    } catch {
      /* fail-open: keep the last projected list */
    }
  }

  return { items, revision, loaded, refresh, board, counts }
}

export type DecisionStore = ReturnType<typeof createDecisionStore>
