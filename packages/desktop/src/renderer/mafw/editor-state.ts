// 编辑器状态机（纯不可变 reducer，与 background-tracker 同风格）。
//
// 核心语义（spec §5.2 + 调研 §3）：
// - dirty 期间收到外部改动（典型：agent 刚写了同一文件）→ conflict，**绝不静默覆盖**；
//   缓冲区干净时 → staleClean，由消费方读盘后 applyCleanReload 静默刷新；
// - 保存成功（markSaved）清 dirty/conflict/staleClean 并换磁盘基准；
// - root 变化（切会话/worktree）→ 全清，不展示别树旧内容。
export interface OpenFile {
  rel: string
  /** 磁盘基准（加载或上次保存时的内容） */
  savedContent: string
  dirty: boolean
  /** too-large/binary 打开降级 */
  readOnly: boolean
  /** dirty 时收到外部改动 → 冲突横幅 */
  conflict: boolean
  /** 干净时收到外部改动 → 待静默刷新 */
  staleClean: boolean
}

export interface EditorModel {
  root: string | null
  files: OpenFile[]
  active: string | null
}

export function createEditorModel(): EditorModel {
  return { root: null, files: [], active: null }
}

export function onRootChange(m: EditorModel, root: string | null): EditorModel {
  if (m.root === root) return m
  return { root, files: [], active: null }
}

/** 幂等：已打开仅激活（保留 savedContent/dirty/readOnly 等一切状态）。 */
export function openFile(m: EditorModel, rel: string, content: string, readOnly = false): EditorModel {
  if (m.files.some(f => f.rel === rel)) return { ...m, active: rel }
  return {
    ...m,
    active: rel,
    files: [...m.files, { rel, savedContent: content, dirty: false, readOnly, conflict: false, staleClean: false }],
  }
}

/** 关闭文件；关闭 active 时激活列表中最靠后（最近打开）的剩余项。 */
export function closeFile(m: EditorModel, rel: string): EditorModel {
  const files = m.files.filter(f => f.rel !== rel)
  const active = m.active !== rel ? m.active : (files.length > 0 ? files[files.length - 1]!.rel : null)
  return { ...m, files, active }
}

export function setActive(m: EditorModel, rel: string): EditorModel {
  if (!m.files.some(f => f.rel === rel)) return m
  return { ...m, active: rel }
}

export function markDirty(m: EditorModel, rel: string): EditorModel {
  return update(m, rel, f => f.dirty ? f : { ...f, dirty: true })
}

export function markSaved(m: EditorModel, rel: string, content: string): EditorModel {
  return update(m, rel, f => ({ ...f, savedContent: content, dirty: false, conflict: false, staleClean: false }))
}

export function onExternalChange(m: EditorModel, rel: string): EditorModel {
  return update(m, rel, f => f.dirty
    ? { ...f, conflict: true, staleClean: false }
    : { ...f, staleClean: true, conflict: false })
}

export function resolveConflict(
  m: EditorModel,
  rel: string,
  action: "keep-mine" | "reload",
  diskContent?: string,
): EditorModel {
  return update(m, rel, f => action === "keep-mine"
    ? { ...f, conflict: false }
    : {
        ...f,
        savedContent: diskContent ?? f.savedContent,
        dirty: false,
        conflict: false,
        staleClean: false,
      })
}

/** staleClean 消费：换基准并清标记（调用方负责把磁盘内容 setDoc 进编辑器）。 */
export function applyCleanReload(m: EditorModel, rel: string, diskContent: string): EditorModel {
  return update(m, rel, f => ({ ...f, savedContent: diskContent, staleClean: false }))
}

/** 读盘 await 结束后再确认一次：期间用户开始输入 → 禁止静默覆盖（终审 Critical 1）。 */
export function canApplyCleanReload(m: EditorModel, rel: string): boolean {
  const f = m.files.find(x => x.rel === rel)
  return !!f && !f.dirty && !f.readOnly
}

function update(m: EditorModel, rel: string, fn: (f: OpenFile) => OpenFile): EditorModel {
  let changed = false
  const files = m.files.map(f => {
    if (f.rel !== rel) return f
    const next = fn(f)
    if (next !== f) changed = true
    return next
  })
  return changed ? { ...m, files } : m
}
