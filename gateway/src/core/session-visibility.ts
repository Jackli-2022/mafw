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

/** 会话列表条目（runtime serve / 本地 session store 的并集形状；字段都可选）。 */
export interface SessionInfo {
  id?: string;
  parentID?: string;
  title?: string;
  agent?: string;
  metadata?: { mafw?: { role?: string } | null } | null;
  projectID?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

export interface SelectVisibleSessionsInput<T extends SessionInfo> {
  /** runtime `session.list()` 的返回（serve 形状：没有 parentID） */
  fromServe?: readonly T[];
  /** runtime 会话存储窗口（opencode SQLite / pi listByDirectory），带 parentID */
  dbSessions?: readonly T[];
  /** 本地 session store（`SdkSessionResource.list()`），metadata 的权威来源 */
  localSessions?: readonly T[];
  /** 调用方已知的子会话 id（serve 形状丢 parentID 时由 dbSessions 补齐） */
  childSessionIds?: Iterable<string>;
  /** 当前项目目录（null = 不按项目收敛；仅影响本地独有会话与空合并回退） */
  projectID?: string | null;
  roleFor?: (id: string) => string | undefined;
}

/** 目录比较口径（与 index.ts 的同名 helper 一致：Windows 大小写/分隔符归一）。 */
function normalizeSessionDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * 会话列表的可见性选择（原 index.ts `listSessions` 内联合并逻辑，Task 2 review I-2 抽纯函数）。
 *
 * 语义与内联版本逐条一致：
 *  1. dbSessions 先入（同 id 去重，隐藏会话跳过），顺带收集子会话 id；
 *  2. fromServe 覆盖同 id 的 db 副本（server 状态更新），子会话一律跳过；
 *  3. 合并结果用本地 metadata 富化，并补上「只在本地存在」的会话（registerExternal 的
 *     Lead/协调会话、离线创建的会话），按项目目录收敛；
 *  4. 合并为空（runtime 不可用 / 全被隐藏）时回退到本地存储，**仍走隐藏过滤**。
 *
 * 隐藏判定只用 `isHiddenSession`（含 metadata.mafw.role），所以 Lead 会话在 serve 不带
 * metadata 的情况下也能靠本地记录隐藏。
 */
export function selectVisibleSessions<T extends SessionInfo>(input: SelectVisibleSessionsInput<T>): T[] {
  const roleFor = input.roleFor ?? (() => undefined);
  const localSessions: readonly T[] = input.localSessions ?? [];
  const localMap = new Map<string, T>();
  for (const s of localSessions) if (s?.id) localMap.set(s.id, s);

  const withLocalMetadata = (s: T): T =>
    s?.metadata ? s : ({ ...s, metadata: s?.id ? localMap.get(s.id)?.metadata : undefined } as T);
  const isHidden = (s: T): boolean => isHiddenSession(withLocalMetadata(s), roleFor);

  const childSessionIds = new Set<string>(input.childSessionIds ?? []);
  for (const s of input.dbSessions ?? []) if (s?.parentID && s.id) childSessionIds.add(s.id);

  const merged: T[] = [];
  const seen = new Set<string>();
  for (const s of input.dbSessions ?? []) {
    if (!s?.id || seen.has(s.id)) continue;
    if (isHidden(s)) continue;
    merged.push(s);
    seen.add(s.id);
  }
  for (const s of input.fromServe ?? []) {
    if (!s?.id) continue;
    if (isHidden(s) || childSessionIds.has(s.id)) continue;
    if (seen.has(s.id)) {
      // Server state is fresher — replace the SQLite copy in place.
      const idx = merged.findIndex((m) => m.id === s.id);
      if (idx >= 0) merged[idx] = s;
      continue;
    }
    merged.push(s);
    seen.add(s.id);
  }

  if (merged.length > 0) {
    const enriched = merged.map((s) => {
      const local = s.id ? localMap.get(s.id) : undefined;
      return local?.metadata ? ({ ...s, metadata: local.metadata } as T) : s;
    });
    // 本地独有会话（serve 不知道的 Lead 会话、离线创建的会话）：按项目收敛且绝不漏隐藏。
    const targetDir = input.projectID ? normalizeSessionDir(input.projectID) : null;
    for (const s of localSessions) {
      if (!s?.id || !s.metadata || seen.has(s.id) || isHidden(s)) continue;
      if (targetDir && normalizeSessionDir(s.directory || s.projectID || '') !== targetDir) continue;
      enriched.push(s);
    }
    return enriched;
  }

  // 空合并回退：runtime 没给会话（MCP-only / 未就绪）。与 `listByProject` 同口径
  // （projectID/directory 精确匹配 + created 倒序），隐藏过滤照样生效。
  const projectID = input.projectID;
  const fallback = projectID
    ? localSessions
        .filter((s) => s?.projectID === projectID || s?.directory === projectID)
        .slice()
        .sort((a, b) => (b.time?.created || 0) - (a.time?.created || 0))
    : localSessions.slice();
  return fallback.filter((s) => !isHidden(s));
}

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
