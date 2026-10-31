/**
 * 会话目录提取（2026-10-31）：opencode v2 的 session.get 返回 `location.directory`，
 * 旧形状是顶层 `directory`。office 技能只传 sessionID 时，file-history 路由用它兜底。
 */
export function sessionDirectoryOf(info: any): string | null {
  const dir = info?.location?.directory ?? info?.directory ?? info?.project?.directory;
  return typeof dir === 'string' && dir ? dir : null;
}
