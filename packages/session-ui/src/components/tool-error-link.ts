// ToolErrorCard 副标题的点击语义：href 优先（浏览器默认导航），只有无 href
// 且是未带修饰键的主键单击时才走 onNavigate。纯逻辑，node --test 可测。

export interface ErrorLinkClick {
  href?: string
  button: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function shouldInvokeNavigate(click: ErrorLinkClick): boolean {
  if (click.href) return false
  return (
    click.button === 0
    && !click.ctrlKey
    && !click.metaKey
    && !click.altKey
    && !click.shiftKey
  )
}
