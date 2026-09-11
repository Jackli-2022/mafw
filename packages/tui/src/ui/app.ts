import type { SelectItem } from '@earendil-works/pi-tui'

export type Retriever = 'bm25' | 'hybrid'

export interface AppOptions {
  baseUrl: string
  retriever: Retriever
}

/** T5 实现：TuiAltScreen 布局 + tab 切换 + 各面板接线。 */
export async function runApp(_opts: AppOptions): Promise<void> {
  const items: SelectItem[] = []
  void items
  throw new Error('TUI app not implemented yet (Task 5)')
}
