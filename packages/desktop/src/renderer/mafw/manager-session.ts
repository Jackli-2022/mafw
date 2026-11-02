// Lead 替换 Manager（spec 2026-11-02-pod-collaborative-goal-loop §3.1，Task 2 review I-1）。
//
// 网关侧把协调会话的 metadata.role 从 `manager` 改成 `lead`，并把它从 `/api/sessions`
// 列表里隐藏（Lead / Tech Lead 都是内部会话）。桌面因此需要两处兼容：
//   1. 角色判定：`lead` 与历史 `manager` 同义（旧会话、旧 tab、持久化布局里的旧标记）；
//   2. 会话解析：隐藏的 Lead 不在历史列表里，kv 的权威 id 仍是打开它的唯一依据。
//
// 网关的 kv 键名与 API（`manager-session` / `manager.session`）保持原样——这里只做展示层
// 兼容。用户可见文案一律用 Lead。

export type SessionRoleMetadata = { mafw?: { role?: string } } | null | undefined

export type RoleSessionLike = {
  id: string
  title?: string
  metadata?: SessionRoleMetadata
}

/** 解析出来的协调会话（openSessionTab 的入参形态）。 */
export type CoordinatorSession = {
  id: string
  title: string
  manager: true
  metadata: { mafw: { role: "lead" } }
}

/** 协调会话角色：lead 是现行值，manager 是历史值，两者同义。 */
export function isLeadSessionRole(role?: string | null): boolean {
  return role === "lead" || role === "manager"
}

/** 打开中的 tab 角色：metadata 优先，`manager` 标记（旧调用路径/恢复布局）兜底。 */
export function tabSessionRole(
  tab?: { metadata?: SessionRoleMetadata; manager?: boolean } | null,
): string | undefined {
  const role = tab?.metadata?.mafw?.role
  if (role) return role
  return tab?.manager ? "lead" : undefined
}

/** Lead tab 的 metadata（只带 manager 标记的调用点用它补齐角色）。 */
export function leadTabMetadata(): { mafw: { role: "lead" } } {
  return { mafw: { role: "lead" } }
}

/**
 * 解析当前项目的协调会话（Lead）。
 *
 * 优先级：kv 权威 id（`GET /api/manager/session`）→ 历史 metadata 兜底。
 * 网关已把 Lead 从会话列表隐藏，所以 kv id 通常**不在** historySessions 里：此时按 id
 * 直接开 tab（标题 "Lead"），而不是判定"没有 Manager 会话"——否则欢迎页的
 * 新建 Goal / Manager 会话入口和 ChatPane 的 新话题 会静默失效。
 */
export function resolveLeadSession(input: {
  managerSessionId?: string | null
  historySessions?: readonly RoleSessionLike[]
}): CoordinatorSession | null {
  const history = input.historySessions ?? []
  const authId = input.managerSessionId
  if (authId) {
    const known = history.find((s) => s?.id === authId)
    return {
      id: authId,
      title: known?.title || "Lead",
      manager: true,
      metadata: leadTabMetadata(),
    }
  }
  // kv 不可用（旧 gateway / runtime 切换瞬间）时按历史 metadata 找协调会话。
  const legacy = history.find((s) => isLeadSessionRole(s?.metadata?.mafw?.role))
  if (!legacy) return null
  return {
    id: legacy.id,
    title: legacy.title || "Lead",
    manager: true,
    metadata: leadTabMetadata(),
  }
}
