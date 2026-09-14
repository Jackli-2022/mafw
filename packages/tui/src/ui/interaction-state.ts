/**
 * 交互状态机（P1 地基）：把散落的 editing/streaming/hasOverlay 布尔收敛为
 * 单一交互模式，keymap 路由与状态栏展示共用一个真源。
 *
 * 模式（优先级从高到低）：
 * - overlay    模态打开（picker/permission/help）——键位归 overlay 组件
 * - busy       agent 流式中——输入进队列；Esc 可中止
 * - prompt     空闲输入态
 * - transcript 阅读态（P3 接入，setTranscript 显式进入）
 */

export type InteractionMode = 'prompt' | 'busy' | 'overlay' | 'transcript'

export interface InteractionInputs {
  overlayOpen: boolean
  streaming: boolean
}

export class InteractionStateMachine {
  mode: InteractionMode = 'prompt'
  onChange?: (mode: InteractionMode) => void

  /** 由原始输入派生模式（transcript 态由显式 enter/exit 管理，update 不覆盖）。 */
  update(inputs: InteractionInputs): InteractionMode {
    if (this.mode === 'transcript') return this.mode
    const next: InteractionMode = inputs.overlayOpen ? 'overlay' : inputs.streaming ? 'busy' : 'prompt'
    this.setMode(next)
    return this.mode
  }

  enterTranscript(): void { this.setMode('transcript') }
  exitTranscript(): void { this.setMode('prompt') }

  is(m: InteractionMode): boolean { return this.mode === m }

  private setMode(next: InteractionMode): void {
    if (this.mode === next) return
    this.mode = next
    this.onChange?.(next)
  }
}
