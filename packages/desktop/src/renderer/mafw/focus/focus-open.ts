/** 焦点栈驱动的显式打开请求；line 为可选的评审锚点行。 */
export type FocusOpenRequest = {
  root: string
  rel: string
  nonce: number
  line?: number
  /** 显式打开（文件树）→ 持久 tab；不传则按当前 content intent 决定预览/持久。 */
  persist?: boolean
}
