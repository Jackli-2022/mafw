// Pure task-session resolution. The desktop host wraps the renderer in a
// MemoryRouter whose pathname is "/", so resolving from the route is dead;
// callers pass the part's parent session id instead.
export interface TaskSessionLike {
  id: string
  parentID?: string
  title?: string
  time?: { created?: number }
}

export interface TaskAgentLike {
  name: string
}

function agentName(raw: unknown, agents?: readonly TaskAgentLike[]): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined
  const key = raw.toLowerCase()
  const item = agents?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  return item?.name ?? `${raw[0]!.toUpperCase()}${raw.slice(1)}`
}

export function taskSessionForParent(
  input: Record<string, any>,
  parentID: string | undefined,
  sessions: readonly TaskSessionLike[] | undefined,
  agents?: readonly TaskAgentLike[],
): string | undefined {
  if (!parentID) return undefined
  const description = typeof input.description === "string" ? input.description : ""
  const agent = agentName(input.agent, agents)
  return (sessions ?? [])
    .filter((session) => session.parentID === parentID)
    .filter((session) => (description ? (session.title ?? "").startsWith(description) : true))
    .filter((session) => (agent ? (session.title ?? "").includes(`@${agent}`) : true))
    .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0]?.id
}
