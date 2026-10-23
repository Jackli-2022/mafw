/** 批注草稿（桌面端持久；main 与 renderer 共用同一形状）。 */
export type Annotation = {
  id: string
  sessionID: string
  /** 相对会话目录的文件路径（与编辑器/文件树口径一致）。 */
  rel: string
  startLine: number
  endLine: number
  /** 选区文本快照（发送时原样携带，避免行号漂移）。 */
  code: string
  comment: string
  createdAt: number
}

/** 持久化形状：sessionID → 批注列表。 */
export type AnnotationDb = Record<string, Annotation[]>
