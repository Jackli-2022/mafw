// 会话可见性判定：desktop/TUI 会话列表隐藏基础设施会话。
// 抽为纯函数（原 index.ts listSessions 内联闭包）以便单测。
//
// 隐藏口径（任一命中即隐藏）：
//   1. parentID —— Task 工具子代理
//   2. 标题前缀 —— legacy worker（标题=管线 prompt 首行）
//   3. agent === 'memory-curator' / 'mafw-tech-lead' —— 确定性判定：agent 字段持久化在
//      session 本体，不受 internal-session kv 7 天 TTL 剪枝影响（剪枝曾导致老 worker
//      会话复活，2026-10-08：09-30 的 13 个 reflect 失败会话在 10-07 剪枝后重新可见）
//   4. role 注册表 / metadata.mafw.role —— index-scan / extract / reflect（kv 恢复，
//      新会话主判定）+ Pod 协作循环的内部会话（lead / tech-lead）
//
// Pod 协作循环（spec 2026-11-02-pod-collaborative-goal-loop §3.1/§9）：Lead 与 Tech Lead
// 的 runtime session 都是内部实现细节，用户不感知（用户经 Lead 入口 / Goal 的 Tech Lead
// 页面对话）。旧的 `manager` / `manager-archived` 元数据刻意不在名单里——既有会话必须
// 继续可读（兼容层），但新会话不再写这两个值。
//
// 注意 `manager` 角色同样保持可见：kv TTL 剪枝前写入的老会话仍是用户的协调会话，
// 隐藏它们会凭空吞掉历史入口。

export interface SessionVisibilityProbe {
  id?: string;
  parentID?: string;
  title?: string;
  agent?: string;
  metadata?: { mafw?: { role?: string } | null } | null;
}

/** 内部会话角色（internal-session kv 的 role 值；隐藏口径单一来源）。 */
export const INTERNAL_SESSION_ROLES: readonly string[] = [
  'index-scan',
  'extract',
  'reflect',
  'lead',
  'tech-lead',
  'tech_lead',
];

/** 内部会话的 agent 名（persist 在 session 本体上，kv 剪枝后仍可判定）。 */
const INTERNAL_SESSION_AGENTS: readonly string[] = ['memory-curator', 'mafw-tech-lead'];

/** session metadata 里声明的内部角色（`metadata.mafw.role`）。 */
const INTERNAL_METADATA_ROLES: readonly string[] = ['lead', 'tech-lead', 'tech_lead'];

export function isHiddenSession(
  s: SessionVisibilityProbe | null | undefined,
  roleFor: (id: string) => string | undefined = () => undefined,
): boolean {
  if (s?.parentID) return true;
  const title: string = s?.title || '';
  if (title.startsWith('# Memory Index')) return true;
  // Worker prompts open with raw JSON / fenced JSON / a "标题：" header —
  // their session titles are that first line. Hide the whole family.
  if (title.startsWith('{') || title.startsWith('```') || title.startsWith('标题：')) return true;
  if (s?.agent && INTERNAL_SESSION_AGENTS.includes(s.agent)) return true;
  const metaRole = s?.metadata?.mafw?.role;
  if (typeof metaRole === 'string' && INTERNAL_METADATA_ROLES.includes(metaRole)) return true;
  const role = s?.id ? roleFor(s.id) : undefined;
  return !!role && INTERNAL_SESSION_ROLES.includes(role);
}
