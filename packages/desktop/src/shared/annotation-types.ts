/** 预览面批注锚点（2026-10-27 预览批注 spec）。缺省（undefined）= 旧行号锚。 */
export type AnnotationAnchor =
  | { kind: "quote"; quote: string; context?: string }
  | { kind: "jsonPath"; path: string; valueSummary: string }
  | { kind: "cell"; sheet?: string; ref: string; value: string }
  | { kind: "region"; x: number; y: number; w: number; h: number; slide?: number }

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
  /** 预览面锚点；缺省 = 行号锚（旧数据兼容）。 */
  anchor?: AnnotationAnchor
  /** region 批注的裁剪截图（仅内存，不落 electron-store；发送时转附件）。 */
  imageDataUrl?: string
}

/** 持久化形状：sessionID → 批注列表。 */
export type AnnotationDb = Record<string, Annotation[]>
