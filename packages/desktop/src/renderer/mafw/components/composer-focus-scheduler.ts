// 延迟聚焦调度器：单击聊天区后等 220ms 再聚焦 composer，期间若发生第二次
// 点击（双击选词）/ 拖选 / 取消，则不抢焦点。纯逻辑（schedule/cancel/focus
// 注入），node --test 可测。

export interface FocusSchedulerDeps {
  schedule: (fn: () => void, ms: number) => unknown
  cancel: (handle: unknown) => void
  focus: () => void
  selectionCollapsed: () => boolean
  delayMs?: number
}

export interface FocusScheduler {
  request(): void
  cancel(): void
}

export function createFocusScheduler(deps: FocusSchedulerDeps): FocusScheduler {
  let handle: unknown = null

  const clear = () => {
    if (handle !== null) {
      deps.cancel(handle)
      handle = null
    }
  }

  return {
    request() {
      clear()
      handle = deps.schedule(() => {
        handle = null
        if (deps.selectionCollapsed()) deps.focus()
      }, deps.delayMs ?? 220)
    },
    cancel: clear,
  }
}
