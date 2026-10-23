// 点击聊天区聚焦 composer 的纯谓词（无 DOM 依赖，node --test 可测）。
//
// 目标行为：点消息文本/气泡/空白 → inputbar 获得焦点；但拖选/双击选词、
// 点击链接/按钮/工具卡、右键/带修饰键点击 → 不抢焦点（否则复制和卡片交互
// 会被打断）。selectionCollapsed=null 表示环境没有 Selection API（测试/极老
// 环境），按可聚焦处理。

export interface ComposerFocusClick {
  button: number
  detail: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  selectionCollapsed: boolean | null
  interactive: boolean
}

export function shouldFocusComposerFromClick(info: ComposerFocusClick): boolean {
  return (
    info.button === 0
    && info.detail === 1
    && !info.ctrlKey
    && !info.metaKey
    && !info.altKey
    && !info.shiftKey
    && info.selectionCollapsed !== false
    && !info.interactive
  )
}
