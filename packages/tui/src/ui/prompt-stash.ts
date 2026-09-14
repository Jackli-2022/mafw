/**
 * Prompt stash（Hermes Ctrl+S 栈式语义）：busy 期间先把草稿收起来发别的，
 * 空输入时再按 Ctrl+S 逐个恢复（LIFO）。
 * 只存内存不落盘（草稿常含敏感内容，Hermes 同款决定）。
 */
export class PromptStash {
  private stack: string[] = []

  get size(): number { return this.stack.length }

  push(text: string): void {
    if (text.trim().length === 0) return
    this.stack.push(text)
  }

  pop(): string | null {
    return this.stack.pop() ?? null
  }
}
