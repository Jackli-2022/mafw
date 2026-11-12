/** 焦点栈驱动的显式打开请求；line 为可选的评审锚点行。 */
export type FocusOpenRequest = {
  root: string
  rel: string
  nonce: number
  line?: number
}
