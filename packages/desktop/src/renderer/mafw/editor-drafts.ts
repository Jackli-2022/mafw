// editor-drafts：跨组件 root-scoped 草稿/磁盘基准存储（模块单例）。
//
// 为什么不是组件内 Map：RightDock 关闭（presence 卸载）或 connDown 替换面板时
// 组件会卸载，草稿必须存活；key 带 root 保证不同项目/worktree 的同名文件
// 绝不串内容（终审 Important 2/8）。
export type Eol = "\n" | "\r\n"

const drafts = new Map<string, string>()
const mtimes = new Map<string, number>()
const eols = new Map<string, Eol>()

const key = (root: string, rel: string) => `${root}\u0000${rel}`

export function setDraft(root: string, rel: string, content: string): void {
  drafts.set(key(root, rel), content)
}
export function getDraft(root: string, rel: string): string | undefined {
  return drafts.get(key(root, rel))
}
export function clearDraft(root: string, rel: string): void {
  drafts.delete(key(root, rel))
}
export function setMtime(root: string, rel: string, mtimeMs: number): void {
  mtimes.set(key(root, rel), mtimeMs)
}
export function getMtime(root: string, rel: string): number | undefined {
  return mtimes.get(key(root, rel))
}
export function setEol(root: string, rel: string, eol: Eol): void {
  eols.set(key(root, rel), eol)
}
export function getEol(root: string, rel: string): Eol | undefined {
  return eols.get(key(root, rel))
}

/** 清某 root 的全部草稿/基准（项目关闭等）。 */
export function clearRoot(root: string): void {
  const prefix = `${root}\u0000`
  for (const k of [...drafts.keys()]) if (k.startsWith(prefix)) drafts.delete(k)
  for (const k of [...mtimes.keys()]) if (k.startsWith(prefix)) mtimes.delete(k)
  for (const k of [...eols.keys()]) if (k.startsWith(prefix)) eols.delete(k)
}

/** 测试用。 */
export function clearAllDrafts(): void {
  drafts.clear()
  mtimes.clear()
  eols.clear()
}
