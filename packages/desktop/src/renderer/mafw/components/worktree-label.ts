// worktree 会话标注（纯函数，切片 4）：
// 判定「session directory 是否为独立 worktree 目录」+ 生成短徽标。
// directory 来自 opencode serve/DB 的 session.directory；项目主目录来自 Rail 的
// currentProject().worktree（同源字段名）。

/** 目录比较统一为正斜杠 + 小写（Windows 盘符/分隔符形态差异兜底）。 */
function normDir(d: string | undefined | null): string {
  return (d ?? "").replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * session 是否绑定在独立 worktree：directory 存在、与项目主目录不同、
 * 且路径落在「<projectBasename>-wt-」命名约定内。
 */
export function isWorktreeSession(
  directory: string | undefined | null,
  projectDir: string | null | undefined,
): boolean {
  if (!directory || !projectDir) return false
  const d = normDir(directory)
  const p = normDir(projectDir)
  if (d === p) return false
  const base = p.split('/').pop() ?? ''
  return d.split('/').pop()?.startsWith(`${base}-wt-`) ?? false
}

/** 徽标短文案：worktree 目录 basename 剥 `<base>-wt-` 前缀。 */
export function worktreeBadge(
  directory: string | undefined | null,
  projectDir: string | null | undefined,
): string | null {
  if (!isWorktreeSession(directory, projectDir)) return null
  const name = normDir(directory).split('/').pop() ?? ''
  const base = normDir(projectDir ?? '').split('/').pop() ?? ''
  const prefix = `${base}-wt-`
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}
