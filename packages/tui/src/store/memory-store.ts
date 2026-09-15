import type { MemoryUnit, StickyNote, StickyNoteBudget } from '@mafw/sdk'

export interface MemoryStoreDeps {
  memory: {
    search(o: { query: string; topK?: number; retriever?: 'bm25' | 'token' | 'hybrid' }): Promise<MemoryUnit[]>
    listSticky(): Promise<{ entries: StickyNote[]; budget: StickyNoteBudget }>
    setSticky(id: string, sticky: boolean, days?: number): Promise<void>
  }
  onChange: () => void
  onError?: (message: string) => void
}

/** Memory 面板数据：检索（--hybrid 走 dense+BM25 RRF）+ 便签板。 */
export class MemoryStore {
  readonly results: MemoryUnit[] = []
  readonly sticky: StickyNote[] = []
  budget?: StickyNoteBudget
  private deps: MemoryStoreDeps
  private retriever: 'bm25' | 'token' | 'hybrid'

  constructor(deps: MemoryStoreDeps, retriever: 'bm25' | 'token' | 'hybrid' = 'bm25') {
    this.deps = deps
    this.retriever = retriever
  }

  async search(query: string): Promise<void> {
    try {
      const r = await this.deps.memory.search({ query, topK: 20, retriever: this.retriever })
      this.results.length = 0
      this.results.push(...r)
      this.deps.onChange()
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
  }

  async refreshSticky(): Promise<void> {
    try {
      const s = await this.deps.memory.listSticky()
      this.sticky.length = 0
      this.sticky.push(...s.entries)
      this.budget = s.budget
      this.deps.onChange()
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
  }

  async unstick(id: string): Promise<void> {
    try {
      await this.deps.memory.setSticky(id, false)
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
    await this.refreshSticky()
  }
}
