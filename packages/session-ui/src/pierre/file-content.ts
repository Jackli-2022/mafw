/**
 * 只读文件载荷（渲染层 `readFile` 的返回形状）。
 *
 * 中性视图：桌面/编辑器按此形状实现 `readFile`，session-ui 只读 `content`
 * 与 `mimeType`/`encoding`；这不是 runtime SDK 类型，也不透传 runtime 私有字段。
 */
export interface FileContent {
  /** `text` 可直接渲染；`binary` 由媒体层按 MIME 解码。缺省按 `text` 处理。 */
  type?: "text" | "binary"
  content?: string
  /** 读取内容的补丁文本（存在时优先于 `content` 展示）。 */
  diff?: string
  /** `base64` 表示 `content` 已编码（图片/音频/二进制）。 */
  encoding?: string
  mimeType?: string
}
