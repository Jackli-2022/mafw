// 会话可见性判定：desktop/TUI 会话列表隐藏基础设施会话。
// 抽为纯函数（原 index.ts listSessions 内联闭包）以便单测。
//
// 隐藏口径（任一命中即隐藏）：
//   1. parentID —— Task 工具子代理
//   2. 标题前缀 —— legacy worker（标题=管线 prompt 首行）
//   3. agent === 'memory-curator' —— 确定性判定：agent 字段持久化在 session 本体，
//      不受 internal-session kv 7 天 TTL 剪枝影响（剪枝曾导致老 worker 会话复活，
//      2026-10-08：09-30 的 13 个 reflect 失败会话在 10-07 剪枝后重新可见）
//   4. role 注册表 —— index-scan / extract / reflect（kv 恢复，新会话主判定）

export interface SessionVisibilityProbe {
  id?: string;
  parentID?: string;
  title?: string;
  agent?: string;
}

export function isHiddenSession(
  s: SessionVisibilityProbe | null | undefined,
  roleFor: (id: string) => string | undefined,
): boolean {
  if (s?.parentID) return true;
  const title: string = s?.title || '';
  if (title.startsWith('# Memory Index')) return true;
  // Worker prompts open with raw JSON / fenced JSON / a "标题：" header —
  // their session titles are that first line. Hide the whole family.
  if (title.startsWith('{') || title.startsWith('```') || title.startsWith('标题：')) return true;
  if (s?.agent === 'memory-curator') return true;
  const role = s?.id ? roleFor(s.id) : undefined;
  return role === 'index-scan' || role === 'extract' || role === 'reflect';
}
