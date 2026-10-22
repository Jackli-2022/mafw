// workbench 根目录解析（文件树/编辑器）：
// spec §5.2 的口径是「普通会话=项目目录；worktree 会话=worktree 目录」。
// 但 manager/内部会话的 directory 可能指向项目之外（实证：home 下的 hash 目录），
// 直接跟随会让文件树显示用户主目录——此处把根钳制回当前项目。
export function resolveWorkbenchRoot(projectPath: string | null, sessionDir: string | null): string | null {
  if (!sessionDir) return projectPath
  if (!projectPath) return sessionDir
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  const s = norm(sessionDir)
  const p = norm(projectPath)
  if (s === p || s.startsWith(p + "/") || s.startsWith(p + "-wt-")) return sessionDir
  return projectPath
}
